import { describe, it, expect } from 'vitest';
import { filterSongsLocal } from './songPickerData';
import type { ReferenceData } from './referenceData';
import type { SongRow, RegionRow } from '@/db/schema';

function makeSong(id: number, title: string): SongRow {
  return { id, title, lyrics: null, notes: null, maleKey: null, femaleKey: null, createdAt: new Date(), updatedAt: new Date() } as SongRow;
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
    songs: [makeSong(1, 'Τραγούδι Νάξου'), makeSong(2, 'Τραγούδι Άλλου Είδους')],
    sharedSongs: [],
    axisValues: [
      { id: 1, songId: 1, axisType: 'region', refId: 4, yearValue: null },
      { id: 2, songId: 1, axisType: 'genre', refId: 1, yearValue: null },
      { id: 3, songId: 2, axisType: 'genre', refId: 2, yearValue: null },
      { id: 4, songId: 1, axisType: 'rhythm', refId: 10, yearValue: null },
      { id: 5, songId: 2, axisType: 'rhythm', refId: 11, yearValue: null },
      { id: 6, songId: 1, axisType: 'year', refId: null, yearValue: 1975 },
      { id: 7, songId: 2, axisType: 'year', refId: null, yearValue: 1990 },
    ],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres: [],
    programs: [],
    currentUser: null,
  };
}

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

  it('filters by rhythmId', () => {
    const result = filterSongsLocal(referenceData(), { rhythmId: 11 });
    expect(result.map((s) => s.id)).toEqual([2]);
  });

  it('filters by year', () => {
    const result = filterSongsLocal(referenceData(), { year: 1975 });
    expect(result.map((s) => s.id)).toEqual([1]);
  });
});
