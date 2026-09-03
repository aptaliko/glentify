import type { QueuedAction } from './syncQueue';
import type { CachedProgramDetail } from './referenceData';

export interface DisplaySequenceSong {
  sequenceSongId: number;
  title: string;
}

export interface DisplaySequence {
  id: number;
  title: string;
  songs: DisplaySequenceSong[];
  status: 'active' | 'pending-create';
}

const SEQUENCE_ACTION_TYPES = new Set([
  'sequence-create', 'sequence-rename', 'sequence-delete',
  'sequence-add-song', 'sequence-remove-song', 'sequence-reorder',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSequenceQueueActionForProgram(
  action: QueuedAction,
  programId: number,
  sequenceIdsInProgram: number[]
): boolean {
  if (!SEQUENCE_ACTION_TYPES.has(action.type) || !isRecord(action.payload)) return false;
  const p = action.payload;
  if (action.type === 'sequence-create') return p.programId === programId;
  const seqId = typeof p.sequenceId === 'number' ? p.sequenceId : null;
  if (seqId !== null) return sequenceIdsInProgram.includes(seqId);
  // sequence-remove-song carries only sequenceSongId; the page filters those by presence
  // in the currently-expanded sequence, so program-scoping isn't needed for it here.
  return false;
}

// For each sequence targeted by a needsAttention rename/reorder (which mergeSequencesWithPending
// silently reverts to last-known state), reports why — so the edit page can show the right
// per-sequence note: «άλλαξε από συνεργάτη» for a conflict, the generic failure copy otherwise.
// Keys by the payload's sequenceId as-is (a draft id would send no If-Match and can only 404,
// so matching the raw id is sufficient here).
export function sequenceAttentionReasonById(actions: QueuedAction[]): Map<number, 'conflict' | 'failed'> {
  const out = new Map<number, 'conflict' | 'failed'>();
  for (const a of actions) {
    if (!a.needsAttention) continue;
    if (a.type !== 'sequence-rename' && a.type !== 'sequence-reorder') continue;
    if (!isRecord(a.payload)) continue;
    const seqId = a.payload.sequenceId;
    if (typeof seqId !== 'number') continue;
    out.set(seqId, a.needsAttentionReason === 'conflict' ? 'conflict' : 'failed');
  }
  return out;
}

function reorder(songs: DisplaySequenceSong[], orderedIds: number[]): DisplaySequenceSong[] {
  const byId = new Map(songs.map((s) => [s.sequenceSongId, s]));
  const out: DisplaySequenceSong[] = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s) { out.push(s); byId.delete(id); }
  }
  for (const s of songs) if (byId.has(s.sequenceSongId)) out.push(s); // leftovers keep order
  return out;
}

// Pure — no I/O. Overlays this program's pending sequence actions onto the cached detail.
export function mergeSequencesWithPending(
  detail: CachedProgramDetail,
  actions: QueuedAction[],
  songTitleById: Map<number, string>
): DisplaySequence[] {
  let sequences: DisplaySequence[] = detail.sequences.map((s) => ({
    id: s.id,
    title: s.title,
    status: 'active',
    songs: s.songs.map((e) => ({ sequenceSongId: e.sequenceSongId, title: e.title })),
  }));

  for (const a of actions) {
    if (!isRecord(a.payload)) continue;
    const p = a.payload;
    // A conflict/failed whole-value replacement (rename/reorder flagged needsAttention) must
    // NOT be applied — keep the last-known real state, matching programsMerge's revert. Other
    // action types aren't guarded and their needsAttention handling is out of scope here.
    if (a.needsAttention && (a.type === 'sequence-rename' || a.type === 'sequence-reorder')) continue;
    switch (a.type) {
      case 'sequence-create': {
        if (p.programId === detail.programId && typeof p.draftId === 'number' && typeof p.title === 'string') {
          sequences.push({ id: p.draftId, title: p.title, status: 'pending-create', songs: [] });
        }
        break;
      }
      case 'sequence-rename': {
        if (typeof p.sequenceId === 'number' && typeof p.title === 'string') {
          sequences = sequences.map((s) => (s.id === p.sequenceId ? { ...s, title: p.title as string } : s));
        }
        break;
      }
      case 'sequence-delete': {
        if (typeof p.sequenceId === 'number') sequences = sequences.filter((s) => s.id !== p.sequenceId);
        break;
      }
      case 'sequence-add-song': {
        if (typeof p.sequenceId === 'number' && typeof p.draftId === 'number' && typeof p.songId === 'number') {
          const title = songTitleById.get(p.songId) ?? '—';
          sequences = sequences.map((s) =>
            s.id === p.sequenceId ? { ...s, songs: [...s.songs, { sequenceSongId: p.draftId as number, title }] } : s
          );
        }
        break;
      }
      case 'sequence-remove-song': {
        if (typeof p.sequenceSongId === 'number') {
          sequences = sequences.map((s) => ({ ...s, songs: s.songs.filter((e) => e.sequenceSongId !== p.sequenceSongId) }));
        }
        break;
      }
      case 'sequence-reorder': {
        if (typeof p.sequenceId === 'number' && Array.isArray(p.orderedIds)) {
          const ids = (p.orderedIds as unknown[]).filter((x): x is number => typeof x === 'number');
          sequences = sequences.map((s) => (s.id === p.sequenceId ? { ...s, songs: reorder(s.songs, ids) } : s));
        }
        break;
      }
    }
  }
  return sequences;
}
