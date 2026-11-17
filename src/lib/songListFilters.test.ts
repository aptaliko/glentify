import { describe, it, expect } from 'vitest';
import { filterAdminSongs, paginate, yearsInUse, hasAxisFilter, EMPTY_SONG_FILTERS, type SongAxisRow, type SongListFilters } from './songListFilters';

const songs = [
  { id: 1, title: 'Αγάπη μου' },
  { id: 2, title: 'Καλαματιανός της Νάξου' },
  { id: 3, title: 'Ζεϊμπέκικο' },
  { id: 4, title: 'Χωρίς κατάταξη' },
];

const axes: SongAxisRow[] = [
  { songId: 1, axisType: 'rhythm', refId: 10, yearValue: null },
  { songId: 1, axisType: 'region', refId: 5, yearValue: null },
  { songId: 1, axisType: 'year', refId: null, yearValue: 1998 },
  { songId: 2, axisType: 'rhythm', refId: 11, yearValue: null },
  { songId: 2, axisType: 'region', refId: 5, yearValue: null },
  { songId: 3, axisType: 'rhythm', refId: 10, yearValue: null },
  { songId: 3, axisType: 'dance', refId: 7, yearValue: null },
];

const f = (over: Partial<SongListFilters>): SongListFilters => ({ ...EMPTY_SONG_FILTERS, ...over });

describe('filterAdminSongs', () => {
  it('returns everything with no filters set', () => {
    expect(filterAdminSongs(songs, axes, EMPTY_SONG_FILTERS).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  it('matches the title case-insensitively as a substring, ignoring surrounding spaces', () => {
    expect(filterAdminSongs(songs, axes, f({ search: '  ΑΓΆΠΗ ' })).map((s) => s.id)).toEqual([1]);
    expect(filterAdminSongs(songs, axes, f({ search: ' νάξου ' })).map((s) => s.id)).toEqual([2]);
  });

  it('filters by one lookup value on its axis', () => {
    expect(filterAdminSongs(songs, axes, f({ rhythmId: 10 })).map((s) => s.id)).toEqual([1, 3]);
  });

  it('combines axis filters with AND', () => {
    expect(filterAdminSongs(songs, axes, f({ rhythmId: 10, regionId: 5 })).map((s) => s.id)).toEqual([1]);
    expect(filterAdminSongs(songs, axes, f({ rhythmId: 10, danceId: 7 })).map((s) => s.id)).toEqual([3]);
  });

  it('matches year on yearValue', () => {
    expect(filterAdminSongs(songs, axes, f({ year: 1998 })).map((s) => s.id)).toEqual([1]);
    expect(filterAdminSongs(songs, axes, f({ year: 2001 })).map((s) => s.id)).toEqual([]);
  });

  it('matches exactly, with no parent or child region matching', () => {
    expect(filterAdminSongs(songs, axes, f({ regionId: 4 })).map((s) => s.id)).toEqual([]);
  });

  it('excludes a song with no value on a filtered axis', () => {
    expect(filterAdminSongs(songs, axes, f({ composerId: 99 })).map((s) => s.id)).toEqual([]);
  });

  it('keeps a queued create (id null) for a title search but never for an axis filter', () => {
    const withPending = [...songs, { id: null, title: 'Νέο τραγούδι' }];
    expect(filterAdminSongs(withPending, axes, f({ search: 'νέο' })).map((s) => s.id)).toEqual([null]);
    expect(filterAdminSongs(withPending, axes, f({ rhythmId: 10 })).map((s) => s.id)).toEqual([1, 3]);
  });
});

describe('hasAxisFilter', () => {
  it('ignores the title search', () => {
    expect(hasAxisFilter(f({ search: 'x' }))).toBe(false);
    expect(hasAxisFilter(f({ year: 1998 }))).toBe(true);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, i) => i + 1);

  it('returns the requested page and the page count', () => {
    expect(paginate(items, 2, 20)).toEqual({ items: items.slice(20, 40), page: 2, totalPages: 3 });
    expect(paginate(items, 3, 20).items).toEqual([41, 42, 43, 44, 45]);
  });

  it('clamps a page past the end to the last page', () => {
    expect(paginate(items, 9, 20).page).toBe(3);
  });

  it('clamps a page below 1 to the first page', () => {
    expect(paginate(items, 0, 20).page).toBe(1);
  });

  it('reports one empty page when nothing matches', () => {
    expect(paginate([], 4, 20)).toEqual({ items: [], page: 1, totalPages: 1 });
  });
});

describe('yearsInUse', () => {
  it('lists distinct years, newest first', () => {
    const rows: SongAxisRow[] = [
      { songId: 1, axisType: 'year', refId: null, yearValue: 1998 },
      { songId: 2, axisType: 'year', refId: null, yearValue: 2005 },
      { songId: 3, axisType: 'year', refId: null, yearValue: 1998 },
      { songId: 3, axisType: 'rhythm', refId: 10, yearValue: null },
    ];
    expect(yearsInUse(rows)).toEqual([2005, 1998]);
  });
});
