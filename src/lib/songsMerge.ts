// src/lib/songsMerge.ts
import type { QueuedAction } from './syncQueue';
import type { CachedSong } from './songsListCache';
import type { AxisValueEntry } from './axisEditorData';

export interface CreateSongPayload {
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  axisValues: AxisValueEntry[];
}

export interface UpdateSongPayload extends CreateSongPayload {
  songId: number;
}

export interface DeleteSongPayload {
  songId: number;
}

export interface DisplaySong {
  id: number | null; // null for a pending create — no server-assigned id yet
  title: string;
  lyrics: string | null; // carried through so the list's existing "λείπουν στίχοι" badge still works post-merge
  status: 'active' | 'pending-create' | 'edited' | 'needs-attention-create' | 'needs-attention-edit';
}

const SONG_ACTION_TYPES = new Set(['song-create', 'song-update', 'song-delete']);

// Reused by the list page's pending-actions effect to count how many of this feature's
// own actions are currently queued — same predicate this function uses internally, so
// the two never disagree about what counts.
export function isSongQueueAction(action: QueuedAction): boolean {
  return SONG_ACTION_TYPES.has(action.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

// Pure — no I/O. Same shape of rules as mergeProgramsWithPending (sub-project #6):
// - a pending delete hides its row (optimistic hide); a needsAttention delete instead
//   reappears as a normal active row — these 409s are genuinely permanent (song already
//   played in a session, or is a session's current song, per deleteSong's own documented
//   conflict cases), so hiding it forever would misrepresent server state for a deletion
//   that never actually happened
// - a pending edit overlays its title/lyrics onto the existing row (status 'edited'); a
//   needsAttention edit reverts to the last-known real fields with a distinct failed tag
//   instead of silently keeping unconfirmed data forever
// - a pending create appends a row with id: null, not clickable in the UI layer (this
//   function only marks status; the page enforces non-navigability)
// When the same song has more than one queued 'song-update' (edited twice offline before
// either synced), the later one in queue order wins, since it overwrites the map entry
// set by the earlier one.
// A malformed payload (wrong shape, e.g. restored from IndexedDB) is skipped rather than
// thrown on, since this function runs on the render path.
export function mergeSongsWithPending(base: CachedSong[], allQueuedActions: QueuedAction[]): DisplaySong[] {
  const edits = new Map<number, { title: string; lyrics: string | null; needsAttention: boolean }>();
  const deletes = new Map<number, boolean>(); // songId -> needsAttention
  const creates: { title: string; lyrics: string | null; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (!isRecord(action.payload)) continue;
    const payload = action.payload;
    if (action.type === 'song-update') {
      const { songId, title, lyrics } = payload;
      if (typeof songId === 'number' && typeof title === 'string' && isNullableString(lyrics)) {
        edits.set(songId, { title, lyrics, needsAttention: action.needsAttention });
      }
    } else if (action.type === 'song-delete') {
      const { songId } = payload;
      if (typeof songId === 'number') {
        deletes.set(songId, action.needsAttention);
      }
    } else if (action.type === 'song-create') {
      const { title, lyrics } = payload;
      if (typeof title === 'string' && isNullableString(lyrics)) {
        creates.push({ title, lyrics, needsAttention: action.needsAttention });
      }
    }
  }

  const result: DisplaySong[] = [];

  for (const song of base) {
    const del = deletes.get(song.id);
    if (del === false) continue; // pending, not yet flagged — optimistically hidden
    if (del === true) {
      result.push({ id: song.id, title: song.title, lyrics: song.lyrics, status: 'active' });
      continue;
    }
    const edit = edits.get(song.id);
    if (edit) {
      result.push({
        id: song.id,
        title: edit.needsAttention ? song.title : edit.title,
        lyrics: edit.needsAttention ? song.lyrics : edit.lyrics,
        status: edit.needsAttention ? 'needs-attention-edit' : 'edited',
      });
      continue;
    }
    result.push({ id: song.id, title: song.title, lyrics: song.lyrics, status: 'active' });
  }

  for (const create of creates) {
    result.push({
      id: null,
      title: create.title,
      lyrics: create.lyrics,
      status: create.needsAttention ? 'needs-attention-create' : 'pending-create',
    });
  }

  return result;
}

// Used by the edit page (not the list) to resolve one song's current display fields: the
// cached base row overlaid with its own still-queued update, if any, so reopening a song
// mid-sync never silently shows pre-edit data. `baseAxisValues` is supplied by the
// caller (filtered from referenceData.axisValues by songId) — this function has one
// input shape and doesn't reach into ReferenceData itself, matching resolveSongForEdit's
// sibling mergeSongsWithPending. If more than one 'song-update' is queued for this
// songId, the last one in queue order wins (most recent edit).
export function resolveSongForEdit(
  songId: number,
  base: CachedSong | null,
  baseAxisValues: AxisValueEntry[],
  allQueuedActions: QueuedAction[]
): { song: CreateSongPayload | null; hasPendingEdit: boolean } {
  let pendingEdit: QueuedAction | undefined;
  for (const action of allQueuedActions) {
    if (action.type !== 'song-update' || !isRecord(action.payload)) continue;
    if ((action.payload as Record<string, unknown>).songId === songId) pendingEdit = action;
  }

  if (pendingEdit && !pendingEdit.needsAttention) {
    const payload = pendingEdit.payload as UpdateSongPayload;
    return {
      song: {
        title: payload.title,
        lyrics: payload.lyrics,
        imageUrl: payload.imageUrl,
        notes: payload.notes,
        maleKey: payload.maleKey,
        femaleKey: payload.femaleKey,
        axisValues: payload.axisValues,
      },
      hasPendingEdit: true,
    };
  }

  if (!base) return { song: null, hasPendingEdit: false };

  return {
    song: {
      title: base.title,
      lyrics: base.lyrics,
      imageUrl: base.imageUrl,
      notes: base.notes,
      maleKey: base.maleKey,
      femaleKey: base.femaleKey,
      axisValues: baseAxisValues,
    },
    hasPendingEdit: false,
  };
}
