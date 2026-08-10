import { describe, it, expect } from 'vitest';
import { normalizeReferenceData, collectReferencedSongIds, mergeReferencedSongs } from './referenceData';
import type { ReferenceData } from './referenceData';
import type { SongRow } from '@/db/schema';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

function song(id: number, title: string): SongRow {
  return {
    id,
    title,
    lyrics: null,
    imageUrl: null,
    genreId: 1,
    notes: null,
    maleKey: null,
    femaleKey: null,
    ownerId: 1,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  };
}

function referenceData(): ReferenceData {
  return {
    songs: [],
    axisValues: [],
    regions: [],
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres: [],
    programs: [],
  };
}

describe('normalizeReferenceData', () => {
  it('returns programs unchanged when already an empty array', () => {
    const data = referenceData();
    const result = normalizeReferenceData(data);
    expect(result.programs).toEqual([]);
  });

  it('returns programs unchanged when already populated', () => {
    const data = referenceData();
    data.programs = [{ id: 1, title: 'Program A', sequences: [] }];
    const result = normalizeReferenceData(data);
    expect(result.programs).toEqual([{ id: 1, title: 'Program A', sequences: [] }]);
  });

  it('defaults programs to an empty array when missing (pre-feature cached blob)', () => {
    // Simulates a ReferenceData blob persisted before the `programs` field
    // existed. TypeScript won't normally allow constructing this, so we
    // cast an object literal that omits `programs`.
    const legacyData = {
      songs: [],
      axisValues: [],
      regions: [],
      rhythms: [],
      dromoi: [],
      composers: [],
      axisTypes: [],
      genres: [],
    } as unknown as ReferenceData;

    const result = normalizeReferenceData(legacyData);
    expect(result.programs).toEqual([]);
  });
});

describe('collectReferencedSongIds', () => {
  it('returns an empty array for no programs', () => {
    expect(collectReferencedSongIds([])).toEqual([]);
  });

  it('collects song ids across sequences and programs, de-duplicated', () => {
    const programs = [
      { id: 1, title: 'A', sequences: [{ id: 10, title: 'S1', songIds: [1, 2] }] },
      { id: 2, title: 'B', sequences: [{ id: 20, title: 'S2', songIds: [2, 3] }] },
    ];
    expect(collectReferencedSongIds(programs).sort()).toEqual([1, 2, 3]);
  });
});

describe('mergeReferencedSongs', () => {
  it('appends extra songs not already in ownSongs', () => {
    const own = [song(1, 'Own')];
    const extra = [song(2, 'Extra')];
    expect(mergeReferencedSongs(own, extra)).toEqual([song(1, 'Own'), song(2, 'Extra')]);
  });

  it('does not duplicate a song already owned', () => {
    const own = [song(1, 'Own')];
    const extra = [song(1, 'Own (stale copy)')];
    expect(mergeReferencedSongs(own, extra)).toEqual([song(1, 'Own')]);
  });

  it('returns ownSongs unchanged when there are no extras', () => {
    const own = [song(1, 'Own')];
    expect(mergeReferencedSongs(own, [])).toEqual(own);
  });
});
