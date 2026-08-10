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
 * persisted before the `programs` field existed. The `ReferenceData` type
 * annotation on `data` is what the compiler expects; real-world cached
 * blobs can still be missing `programs` at runtime, which is exactly the
 * case this function exists to handle.
 */
export function normalizeReferenceData(data: ReferenceData): ReferenceData {
  return { ...data, programs: data.programs ?? [] };
}
