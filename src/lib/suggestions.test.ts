import { describe, it, expect } from 'vitest';
import {
  getRegionAncestorIds,
  getRegionDescendantIds,
  defaultFilters,
  matchesFilters,
  orderFilters,
  firstMatchIndex,
  buildSuggestionsResponse,
  type AxisValue,
  type SongWithAxes,
} from './suggestions';
import type { SongRow, RegionRow, RhythmRow, DromosRow, DanceRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

function makeSong(id: number, title: string): SongRow {
  return {
    id,
    title,
    lyrics: 'lyrics',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SongRow;
}

function av(axisType: string, refId: number | null, yearValue: number | null = null): AxisValue {
  return { axisType, refId, yearValue };
}

// Region tree: Νησιά(1) -> Νησιά Αιγαίου(2) -> Κυκλάδες(3) -> Νάξος(4) -> Απείρανθος(5)
//              Νησιά(1) -> Κύθηρα(6)
const regions: RegionRow[] = [
  { id: 1, name: 'Νησιά', parentId: null, ownerId: null },
  { id: 2, name: 'Νησιά Αιγαίου', parentId: 1, ownerId: null },
  { id: 3, name: 'Κυκλάδες', parentId: 2, ownerId: null },
  { id: 4, name: 'Νάξος', parentId: 3, ownerId: null },
  { id: 5, name: 'Απείρανθος', parentId: 4, ownerId: null },
  { id: 6, name: 'Κύθηρα', parentId: 1, ownerId: null },
];

describe('getRegionAncestorIds', () => {
  it('walks up the parent chain to the root', () => {
    expect(getRegionAncestorIds(5, regions)).toEqual([4, 3, 2, 1]);
  });

  it('returns an empty array for a root region', () => {
    expect(getRegionAncestorIds(1, regions)).toEqual([]);
  });
});

describe('getRegionDescendantIds', () => {
  it('collects all descendants at any depth', () => {
    expect(getRegionDescendantIds(2, regions).sort()).toEqual([3, 4, 5]);
  });

  it('returns an empty array for a leaf region', () => {
    expect(getRegionDescendantIds(5, regions)).toEqual([]);
  });
});

describe('defaultFilters', () => {
  it('puts the current region first, then its ancestors, then the other axes', () => {
    const f = defaultFilters([av('region', 5), av('rhythm', 10)], regions);
    expect(f.map((x) => x.refId)).toEqual([5, 4, 3, 2, 1, 10]);
  });
  it('gives only the other axes for a song without a region', () => {
    expect(defaultFilters([av('rhythm', 10)], regions)).toEqual([{ axisType: 'rhythm', refId: 10, yearValue: null }]);
  });
  it('stops at a missing ancestor without throwing and without a phantom chip', () => {
    const broken: RegionRow[] = [{ id: 7, name: 'x', parentId: 999, ownerId: null }];
    expect(defaultFilters([av('region', 7)], broken).map((x) => x.refId)).toEqual([7]);
  });
});

describe('matchesFilters', () => {
  it('requires every filtered axis to match', () => {
    const song = [av('region', 4), av('rhythm', 10)];
    expect(matchesFilters(song, [{ axisType: 'region', refId: 4, yearValue: null }, { axisType: 'rhythm', refId: 10, yearValue: null }])).toBe(true);
    expect(matchesFilters(song, [{ axisType: 'region', refId: 4, yearValue: null }, { axisType: 'rhythm', refId: 99, yearValue: null }])).toBe(false);
  });
  it('ORs multiple values on one axis', () => {
    const f = [{ axisType: 'region', refId: 4, yearValue: null }, { axisType: 'region', refId: 5, yearValue: null }];
    expect(matchesFilters([av('region', 5)], f)).toBe(true);
    expect(matchesFilters([av('region', 3)], f)).toBe(false);
  });
  it('matches region exactly, with no parent or child matching', () => {
    expect(matchesFilters([av('region', 1)], [{ axisType: 'region', refId: 5, yearValue: null }])).toBe(false);
  });
  it('excludes a song with no value on a filtered axis', () => {
    expect(matchesFilters([av('rhythm', 10)], [{ axisType: 'region', refId: 4, yearValue: null }])).toBe(false);
  });
  it('treats no filters as matching everything', () => {
    expect(matchesFilters([], [])).toBe(true);
  });
});

describe('firstMatchIndex and orderFilters', () => {
  it('orders filters by axis order, keeping insertion order within an axis', () => {
    const f = [{ axisType: 'rhythm', refId: 10, yearValue: null }, { axisType: 'region', refId: 5, yearValue: null }, { axisType: 'region', refId: 4, yearValue: null }];
    expect(orderFilters(f, ['region', 'rhythm']).map((x) => x.refId)).toEqual([5, 4, 10]);
  });
  it('returns the earliest matching filter in on-screen order', () => {
    const ordered = [{ axisType: 'region', refId: 5, yearValue: null }, { axisType: 'region', refId: 4, yearValue: null }];
    expect(firstMatchIndex([av('region', 4)], ordered)).toBe(1);
    expect(firstMatchIndex([av('region', 5), av('region', 4)], ordered)).toBe(0);
  });
});

describe('buildSuggestionsResponse', () => {
  const rhythms: RhythmRow[] = [{ id: 1, name: 'Καλαματιανός', ownerId: null }, { id: 2, name: 'Ζεϊμπέκικο', ownerId: null }];
  const dromoi: DromosRow[] = [];
  const dances: DanceRow[] = [{ id: 1, name: 'Τσάμικος', ownerId: null }];
  const composers: ComposerRow[] = [];
  const genres: GenreRow[] = [];
  const axisTypes: AxisTypeRow[] = [
    { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
    { id: 2, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
    { id: 3, key: 'dance', label: 'Χορός', lookupTable: 'dances', hierarchical: false },
    { id: 4, key: 'year', label: 'Έτος', lookupTable: null, hierarchical: false },
  ];
  const lookups = { regions, rhythms, dromoi, dances, composers, axisTypes, genres };

  function current(id: number, title: string, axisValues: AxisValue[]) {
    return { id, title, lyrics: null, imageUrl: null, maleKey: null, femaleKey: null, axisValues };
  }

  it('returns no current song, no applied filters and no candidates when there is no current song', () => {
    const result = buildSuggestionsResponse({
      currentSongWithAxes: null, allSongs: [], playedSongIds: new Set(), showPlayed: false, filters: null, lookups,
    });
    expect(result.currentSong).toBeNull();
    expect(result.appliedFilters).toEqual([]);
    expect(result.mode).toBe('ungrouped');
    expect(result.candidates).toEqual([]);
  });

  it('uses the song defaults (region chain first) when filters is null', () => {
    const cur = makeSong(1, 'Α');
    const allSongs: SongWithAxes[] = [{ song: cur, axisValues: [av('region', 3), av('rhythm', 1)] }];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: current(1, 'Α', [av('region', 3), av('rhythm', 1)]),
      allSongs, playedSongIds: new Set(), showPlayed: false, filters: null, lookups,
    });
    expect(result.appliedFilters.map((f) => f.refId)).toEqual([3, 2, 1, 1]);
    expect(result.mode).toBe('filtered');
  });

  it('drops applied filters whose values are not in the lookups', () => {
    const cur = makeSong(1, 'Α');
    const allSongs: SongWithAxes[] = [{ song: cur, axisValues: [av('region', 3)] }];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: current(1, 'Α', [av('region', 3)]),
      allSongs, playedSongIds: new Set(), showPlayed: false,
      filters: [{ axisType: 'region', refId: 999, yearValue: null }, { axisType: 'region', refId: 3, yearValue: null }],
      lookups,
    });
    expect(result.appliedFilters).toEqual([{ axisType: 'region', refId: 3, yearValue: null }]);
  });

  it('is ungrouped with an alphabetical list when every chip is removed (filters = [])', () => {
    const allSongs: SongWithAxes[] = [
      { song: makeSong(1, 'Α'), axisValues: [av('rhythm', 1)] },
      { song: makeSong(2, 'Γ'), axisValues: [] },
      { song: makeSong(3, 'Β'), axisValues: [av('rhythm', 2)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: current(1, 'Α', [av('rhythm', 1)]),
      allSongs, playedSongIds: new Set(), showPlayed: false, filters: [], lookups,
    });
    expect(result.mode).toBe('ungrouped');
    expect(result.appliedFilters).toEqual([]);
    expect(result.candidates.map((c) => c.title)).toEqual(['Β', 'Γ']);
  });

  it('orders candidates by the first matched filter in on-screen order, then by title', () => {
    const allSongs: SongWithAxes[] = [
      { song: makeSong(1, 'Τρέχον'), axisValues: [av('region', 4)] },
      { song: makeSong(2, 'Α'), axisValues: [av('region', 4)] },
      { song: makeSong(3, 'Β'), axisValues: [av('region', 5)] },
      { song: makeSong(4, 'Γ'), axisValues: [av('region', 4)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: current(1, 'Τρέχον', [av('region', 4)]),
      allSongs, playedSongIds: new Set(), showPlayed: false,
      filters: [{ axisType: 'region', refId: 5, yearValue: null }, { axisType: 'region', refId: 4, yearValue: null }],
      lookups,
    });
    expect(result.candidates.map((c) => c.title)).toEqual(['Β', 'Α', 'Γ']);
  });

  it('marks played songs and hides them unless showPlayed is set', () => {
    const allSongs: SongWithAxes[] = [
      { song: makeSong(1, 'Α'), axisValues: [] },
      { song: makeSong(2, 'Β'), axisValues: [] },
    ];
    const base = {
      currentSongWithAxes: current(1, 'Α', []), allSongs, playedSongIds: new Set([2]), filters: [], lookups,
    };
    expect(buildSuggestionsResponse({ ...base, showPlayed: false }).candidates).toEqual([]);
    expect(buildSuggestionsResponse({ ...base, showPlayed: true }).candidates).toEqual([{ id: 2, title: 'Β', played: true }]);
  });

  it('lists options for every axis that has values, in lookups order, with names', () => {
    const allSongs: SongWithAxes[] = [
      { song: makeSong(1, 'Α'), axisValues: [av('year', null, 1998)] },
      { song: makeSong(2, 'Β'), axisValues: [av('year', null, 1970)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: current(1, 'Α', [av('year', null, 1998)]),
      allSongs, playedSongIds: new Set(), showPlayed: false, filters: null, lookups,
    });
    expect(result.axes.map((a) => a.axisType)).toEqual(['region', 'rhythm', 'dance', 'year']);
    expect(result.axes.find((a) => a.axisType === 'dance')).toEqual({
      axisType: 'dance', label: 'Χορός', options: [{ refId: 1, yearValue: null, name: 'Τσάμικος' }],
    });
    expect(result.axes.find((a) => a.axisType === 'year')!.options).toEqual([
      { refId: null, yearValue: 1970, name: '1970' },
      { refId: null, yearValue: 1998, name: '1998' },
    ]);
  });
});
