import type { SongRow, SongAxisValueRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface ReferenceData {
  songs: SongRow[];
  axisValues: SongAxisValueRow[];
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
}
