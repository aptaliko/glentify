import { describe, it, expect } from 'vitest';
import { getUsedTopLevelRegionsLocal, filterSongsLocal } from './songPickerData';
import type { ReferenceData } from './referenceData';
import type { SongRow, RegionRow } from '@/db/schema';

function makeSong(id: number, title: string, genreId = 1): SongRow {
  return { id, title, lyrics: null, genreId, notes: null, maleKey: null, femaleKey: null, createdAt: new Date(), updatedAt: new Date() } as SongRow;
}

// Νησιά(1) -> Νησιά Αιγαίου(2) -> Κυκλάδες(3) -> Νάξος(4)
const regions: RegionRow[] = [
  { id: 1, name: 'Νησιά', parentId: null, ownerId: null },
  { id: 2, name: 'Νησιά Αιγαίου', parentId: 1, ownerId: null },
  { id: 3, name: 'Κυκλάδες', parentId: 2, ownerId: null },
  { id: 4, name: 'Νάξος', parentId: 3, ownerId: null },
];

function referenceData(): ReferenceData {
  return {
    songs: [makeSong(1, 'Τραγούδι Νάξου', 1), makeSong(2, 'Τραγούδι Άλλου Είδους', 2)],
    axisValues: [{ id: 1, songId: 1, axisType: 'region', refId: 4, yearValue: null }],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres: [],
  };
}

describe('getUsedTopLevelRegionsLocal', () => {
  it('returns the top-level ancestor of every region used by songs of the genre', () => {
    const result = getUsedTopLevelRegionsLocal(1, referenceData());
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it('returns an empty list for a genre with no songs', () => {
    const result = getUsedTopLevelRegionsLocal(99, referenceData());
    expect(result).toEqual([]);
  });
});

describe('filterSongsLocal', () => {
  it('filters by genreId', () => {
    const result = filterSongsLocal(referenceData(), { genreId: 2 });
    expect(result.map((s) => s.id)).toEqual([2]);
  });

  it('filters by case-insensitive title substring', () => {
    const result = filterSongsLocal(referenceData(), { search: 'ναξου' });
    expect(result.map((s) => s.id)).toEqual([1]);
  });

  it('filters by region, including descendants', () => {
    const result = filterSongsLocal(referenceData(), { regionId: 2 });
    expect(result.map((s) => s.id)).toEqual([1]);
  });
});
