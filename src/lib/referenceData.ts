import type { SongRow, SongAxisValueRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface OfflineCollaborator {
  id: number;
  email: string;
}

export interface OfflineSequenceEntry {
  sequenceSongId: number; // program_sequences join-row id, for reorder/remove of a specific entry
  songId: number;
}

export interface OfflineSequence {
  id: number;
  title: string;
  songIds: number[]; // already in playback order — read by programs/local/* + sessionStore; DO NOT remove
  entries: OfflineSequenceEntry[]; // join-row ids for the offline program editor
}

export interface OfflineProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  creator: OfflineCollaborator | null;
  collaborators: OfflineCollaborator[];
  sequences: OfflineSequence[]; // already in display order (server-side orderBy position)
}

export interface ReferenceData {
  songs: SongRow[];
  sharedSongs: SongRow[]; // songs referenced by a shared program's sequences but not owned by the requester — kept separate from `songs` so the offline song picker (src/lib/songPickerData.ts) and session suggestion ranking (src/lib/sessionStore.ts) never treat a collaborator's songs as the user's own; only the program/sequence viewers (src/app/programs/local/*) look across both.
  axisValues: SongAxisValueRow[];
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
  programs: OfflineProgram[];
  currentUser: OfflineCollaborator | null; // the authenticated user of this prime; feeds the offline collaborators UI
}

// The on-disk envelope. primeOfflineData() (Task 3) is the only writer; primedAt stamps
// when it last succeeded, so consumers can show an actionable empty state when it's null.
export interface CachedReferenceData extends ReferenceData {
  primedAt: string | null;
}

// Display/base types relocated here from the deleted satellite cache modules (see Task 9).
// SongRow is structurally assignable to CachedSong (superset), so mergeSongsWithPending can
// take referenceData.songs directly.
export interface CachedSong {
  id: number;
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

export interface CachedSequenceSong {
  sequenceSongId: number;
  songId: number;
  title: string;
}

export interface CachedSequence {
  id: number;
  title: string;
  position: number;
  songs: CachedSequenceSong[];
}

export interface CachedProgramDetail {
  programId: number;
  title: string;
  role: 'creator' | 'collaborator';
  sequences: CachedSequence[];
  cachedAt: string;
}

/**
 * Normalizes a ReferenceData blob loaded from disk/cache, tolerating data
 * persisted before the `programs`/`sharedSongs`/`axisTypes` fields existed. The
 * `ReferenceData` type annotation on `data` is what the compiler expects;
 * real-world cached blobs can still be missing these fields at runtime,
 * which is exactly the case this function exists to handle. A missing
 * `axisTypes` in particular used to make `resolveAxisEditorData` throw
 * (it iterates the array directly), silently stranding SongAxisEditor's
 * native branch with no Tags UI and no error shown — see
 * src/lib/axisEditorData.ts and SongAxisEditor.tsx's native effect.
 *
 * Also backfills `currentUser` and each program's `role`/`sharedWithEmails`/
 * `creator`/`collaborators`/sequence `entries` for a blob primed before those
 * fields existed. These backfilled placeholders (`role: 'creator'`, empty
 * collaborators, empty `entries`, etc.) are only reachable when `primedAt ===
 * null` on the envelope this data came from — the UI shows a re-prime
 * message instead of rendering them in that case, so the placeholders never
 * need to be materially correct, just present so downstream code doesn't
 * throw on a missing field.
 */
export function normalizeReferenceData(data: ReferenceData): ReferenceData {
  return {
    ...data,
    programs: (data.programs ?? []).map((p) => ({
      ...p,
      role: p.role ?? 'creator',
      sharedWithEmails: p.sharedWithEmails ?? [],
      creator: p.creator ?? null,
      collaborators: p.collaborators ?? [],
      sequences: (p.sequences ?? []).map((s) => ({ ...s, entries: s.entries ?? [] })),
    })),
    sharedSongs: data.sharedSongs ?? [],
    axisTypes: data.axisTypes ?? [],
    currentUser: data.currentUser ?? null,
  };
}

export function collectReferencedSongIds(programs: OfflineProgram[]): number[] {
  const ids = new Set<number>();
  for (const program of programs) {
    for (const sequence of program.sequences) {
      for (const id of sequence.songIds) ids.add(id);
    }
  }
  return [...ids];
}

export function mergeReferencedSongs(ownSongs: SongRow[], extraSongs: SongRow[]): SongRow[] {
  const ownIds = new Set(ownSongs.map((s) => s.id));
  return [...ownSongs, ...extraSongs.filter((s) => !ownIds.has(s.id))];
}
