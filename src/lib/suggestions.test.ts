import { describe, it, expect } from 'vitest';
import {
  getRegionAncestorIds,
  getRegionDescendantIds,
  regionMatchesFilter,
  getFilteredCandidates,
  rankBySharedAxes,
  groupByGenre,
  getSuggestions,
  buildSuggestionsResponse,
  type AxisValue,
  type SongWithAxes,
} from './suggestions';
import type { SongRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

function makeSong(id: number, title: string, genreId = 1): SongRow {
  return {
    id,
    title,
    lyrics: 'lyrics',
    genreId,
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
  { id: 1, name: 'Νησιά', parentId: null },
  { id: 2, name: 'Νησιά Αιγαίου', parentId: 1 },
  { id: 3, name: 'Κυκλάδες', parentId: 2 },
  { id: 4, name: 'Νάξος', parentId: 3 },
  { id: 5, name: 'Απείρανθος', parentId: 4 },
  { id: 6, name: 'Κύθηρα', parentId: 1 },
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

describe('regionMatchesFilter', () => {
  it('matches the exact same region', () => {
    expect(regionMatchesFilter(4, 4, regions)).toBe(true);
  });

  it('matches a broader ancestor region', () => {
    expect(regionMatchesFilter(1, 5, regions)).toBe(true); // candidate tagged broadly "Νησιά", current is narrow "Απείρανθος"
  });

  it('matches a narrower descendant region', () => {
    expect(regionMatchesFilter(5, 1, regions)).toBe(true); // candidate tagged narrowly, current is broad
  });

  it('does not match an unrelated branch', () => {
    expect(regionMatchesFilter(6, 5, regions)).toBe(false); // Κύθηρα vs Απείρανθος share only the "Νησιά" great-ancestor via Νησιά(1), but 6's parent is 1 directly, not on the Απείρανθος branch
  });
});

describe('getFilteredCandidates', () => {
  const current: SongWithAxes = {
    song: makeSong(1, 'Current'),
    axisValues: [av('rhythm', 10), av('region', 4), av('dromos', 100)],
  };
  const rhythmMatch: SongWithAxes = { song: makeSong(2, 'Rhythm match'), axisValues: [av('rhythm', 10), av('region', 99), av('dromos', 200)] };
  const rhythmMismatch: SongWithAxes = { song: makeSong(3, 'Rhythm mismatch'), axisValues: [av('rhythm', 20)] };
  const noRhythmAxis: SongWithAxes = { song: makeSong(4, 'No rhythm axis'), axisValues: [av('composer', 1)] };
  const allSongs = [current, rhythmMatch, rhythmMismatch, noRhythmAxis];

  it('excludes the current song', () => {
    const result = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.some((c) => c.song.id === 1)).toBe(false);
  });

  it('AND-filters on every active axis, excluding songs missing the axis entirely', () => {
    const result = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.map((c) => c.song.id).sort()).toEqual([2]);
  });

  it('region filtering is ancestor/descendant inclusive', () => {
    const broadCandidate: SongWithAxes = { song: makeSong(5, 'Broad region'), axisValues: [av('region', 1)] };
    const result = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: [av('region', 4)], activeAxisTypes: new Set(['region']),
      allSongs: [current, broadCandidate], regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.map((c) => c.song.id)).toEqual([5]);
  });

  it('excludes already-played songs unless showPlayed is true', () => {
    const hidden = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set([2]), showPlayed: false,
    });
    expect(hidden.some((c) => c.song.id === 2)).toBe(false);

    const shown = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set([2]), showPlayed: true,
    });
    expect(shown.some((c) => c.song.id === 2)).toBe(true);
  });
});

describe('rankBySharedAxes', () => {
  const currentAxisValues: AxisValue[] = [av('rhythm', 10), av('region', 4), av('dromos', 100)];

  it('ranks candidates higher when they share inactive-but-present axes', () => {
    const bothShared: SongWithAxes = { song: makeSong(2, 'Both shared'), axisValues: [av('rhythm', 10), av('region', 4), av('dromos', 100)] };
    const oneShared: SongWithAxes = { song: makeSong(3, 'One shared'), axisValues: [av('rhythm', 10), av('region', 999), av('dromos', 100)] };
    const noneShared: SongWithAxes = { song: makeSong(4, 'None shared'), axisValues: [av('rhythm', 10), av('region', 999), av('dromos', 999)] };

    const result = rankBySharedAxes([noneShared, oneShared, bothShared], currentAxisValues, new Set(['rhythm']));
    expect(result.map((s) => s.id)).toEqual([2, 3, 4]);
  });

  it('breaks ties alphabetically by title', () => {
    const b: SongWithAxes = { song: makeSong(2, 'Beta'), axisValues: [] };
    const a: SongWithAxes = { song: makeSong(3, 'Alpha'), axisValues: [] };
    const result = rankBySharedAxes([b, a], currentAxisValues, new Set(['rhythm']));
    expect(result.map((s) => s.title)).toEqual(['Alpha', 'Beta']);
  });
});

describe('groupByGenre', () => {
  it('groups songs by genreId and sorts titles alphabetically within each group', () => {
    const songs = [makeSong(1, 'Ζήτα', 5), makeSong(2, 'Άλφα', 5), makeSong(3, 'Βήτα', 9)];
    const groups = groupByGenre(songs);
    const genre5 = groups.find((g) => g.genreId === 5)!;
    const genre9 = groups.find((g) => g.genreId === 9)!;
    expect(genre5.songs.map((s) => s.title)).toEqual(['Άλφα', 'Ζήτα']);
    expect(genre9.songs.map((s) => s.title)).toEqual(['Βήτα']);
  });
});

describe('getSuggestions', () => {
  const current: SongWithAxes = { song: makeSong(1, 'Current'), axisValues: [av('rhythm', 10), av('region', 4)] };
  const match: SongWithAxes = { song: makeSong(2, 'Match', 3), axisValues: [av('rhythm', 10), av('region', 4)] };
  const otherGenre: SongWithAxes = { song: makeSong(3, 'Other genre song', 7), axisValues: [] };
  const allSongs = [current, match, otherGenre];

  it('returns a filtered ranked list when at least one axis is active', () => {
    const result = getSuggestions({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.mode).toBe('filtered');
    if (result.mode === 'filtered') expect(result.candidates.map((s) => s.id)).toEqual([2]);
  });

  it('falls back to genre-grouped when no axis is active', () => {
    const result = getSuggestions({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.mode).toBe('grouped');
    if (result.mode === 'grouped') {
      expect(result.genreGroups.map((g) => g.genreId).sort()).toEqual([3, 7]);
    }
  });
});

describe('buildSuggestionsResponse', () => {
  const rhythms: RhythmRow[] = [{ id: 1, name: 'Καλαματιανός' }];
  const dromoi: DromosRow[] = [{ id: 1, name: 'Ραστ' }];
  const composers: ComposerRow[] = [];
  const axisTypes: AxisTypeRow[] = [
    { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
    { id: 2, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  ];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό' }];
  const lookups = { regions, rhythms, dromoi, composers, axisTypes, genres };

  it('returns an empty grouped response when there is no current song', () => {
    const result = buildSuggestionsResponse({
      currentSongWithAxes: null,
      allSongs: [],
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result).toEqual({
      currentSong: null,
      availableAxisTypes: [],
      activeAxisTypes: [],
      mode: 'grouped',
      candidates: [],
      genreGroups: [],
      listTitle: '',
    });
  });

  it('builds a filtered response with human-readable axis labels and a listTitle', () => {
    const current = makeSong(1, 'Τραγούδι Α');
    const candidate = makeSong(2, 'Τραγούδι Β');
    const allSongs = [
      { song: current, axisValues: [av('region', 3), av('rhythm', 1)] },
      { song: candidate, axisValues: [av('region', 3), av('rhythm', 1)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: { id: 1, title: 'Τραγούδι Α', lyrics: null, maleKey: null, femaleKey: null, axisValues: [av('region', 3), av('rhythm', 1)] },
      allSongs,
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result.mode).toBe('filtered');
    expect(result.availableAxisTypes).toEqual([
      { key: 'region', label: 'Περιοχή', value: 'Κυκλάδες' },
      { key: 'rhythm', label: 'Ρυθμός', value: 'Καλαματιανός' },
    ]);
    expect(result.candidates).toEqual([{ id: 2, title: 'Τραγούδι Β', played: false }]);
    expect(result.listTitle).toBe('Άλλα τραγούδια με τα ίδια: Περιοχή, Ρυθμός');
  });
});
