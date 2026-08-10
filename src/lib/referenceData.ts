import type { SongRow, SongAxisValueRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface OfflineSequence {
  id: number;
  title: string;
  songIds: number[]; // already in playback order
}

export interface OfflineProgram {
  id: number;
  title: string;
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
}

/**
 * Normalizes a ReferenceData blob loaded from disk/cache, tolerating data
 * persisted before the `programs`/`sharedSongs` fields existed. The
 * `ReferenceData` type annotation on `data` is what the compiler expects;
 * real-world cached blobs can still be missing these fields at runtime,
 * which is exactly the case this function exists to handle.
 */
export function normalizeReferenceData(data: ReferenceData): ReferenceData {
  return { ...data, programs: data.programs ?? [], sharedSongs: data.sharedSongs ?? [] };
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
