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
    sharedSongs: [],
    axisValues: [],
    regions: [],
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres: [],
    programs: [],
    currentUser: null,
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
    data.programs = [{
      id: 1, title: 'Program A', role: 'creator', sharedWithEmails: [],
      creator: null, collaborators: [], sequences: [], version: 1,
    }];
    const result = normalizeReferenceData(data);
    expect(result.programs).toEqual([{
      id: 1, title: 'Program A', role: 'creator', sharedWithEmails: [],
      creator: null, collaborators: [], sequences: [], version: 1,
    }]);
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

  it('defaults sharedSongs to an empty array when missing (pre-feature cached blob)', () => {
    const legacyData = {
      songs: [],
      axisValues: [],
      regions: [],
      rhythms: [],
      dromoi: [],
      composers: [],
      axisTypes: [],
      genres: [],
      programs: [],
    } as unknown as ReferenceData;

    const result = normalizeReferenceData(legacyData);
    expect(result.sharedSongs).toEqual([]);
  });

  it('defaults axisTypes to an empty array when missing (pre-feature cached blob)', () => {
    // Simulates a ReferenceData blob synced/cached before axisTypes was added to this
    // shape (or from a device that has never re-synced since) — resolveAxisEditorData
    // iterates referenceData.axisTypes directly and throws on undefined, which
    // SongAxisEditor's native branch does not catch, silently stranding the Tags UI
    // with no error shown. See src/lib/axisEditorData.ts.
    const legacyData = {
      songs: [],
      sharedSongs: [],
      axisValues: [],
      regions: [],
      rhythms: [],
      dromoi: [],
      composers: [],
      genres: [],
      programs: [],
    } as unknown as ReferenceData;

    const result = normalizeReferenceData(legacyData);
    expect(result.axisTypes).toEqual([]);
  });

  it('backfills currentUser to null when missing (pre-feature cached blob)', () => {
    const legacy = {
      songs: [], sharedSongs: [], axisValues: [], regions: [], rhythms: [],
      dromoi: [], composers: [], axisTypes: [], genres: [], programs: [],
    } as unknown as ReferenceData;
    expect(normalizeReferenceData(legacy).currentUser).toBeNull();
  });

  it('backfills new program fields and sequence.entries for an old-shape program', () => {
    const legacy = {
      songs: [], sharedSongs: [], axisValues: [], regions: [], rhythms: [],
      dromoi: [], composers: [], axisTypes: [], genres: [],
      programs: [{ id: 1, title: 'A', sequences: [{ id: 10, title: 'S1', songIds: [1, 2] }] }],
    } as unknown as ReferenceData;
    const p = normalizeReferenceData(legacy).programs[0];
    expect(p.role).toBe('creator');
    expect(p.sharedWithEmails).toEqual([]);
    expect(p.creator).toBeNull();
    expect(p.collaborators).toEqual([]);
    expect(p.sequences[0].entries).toEqual([]);
    expect(p.sequences[0].songIds).toEqual([1, 2]); // preserved untouched
  });

  it('leaves a new-shape program unchanged', () => {
    const data = referenceData();
    data.programs = [{
      id: 1, title: 'A', role: 'collaborator', sharedWithEmails: ['x@y.gr'],
      creator: { id: 9, email: 'x@y.gr' }, collaborators: [], version: 3,
      sequences: [{ id: 10, title: 'S1', songIds: [1], entries: [{ sequenceSongId: 100, songId: 1 }], version: 2 }],
    }];
    expect(normalizeReferenceData(data).programs[0]).toEqual(data.programs[0]);
  });
});

describe('collectReferencedSongIds', () => {
  it('returns an empty array for no programs', () => {
    expect(collectReferencedSongIds([])).toEqual([]);
  });

  it('collects song ids across sequences and programs, de-duplicated', () => {
    const programs = [
      {
        id: 1, title: 'A', role: 'creator' as const, sharedWithEmails: [], creator: null, collaborators: [], version: 1,
        sequences: [{ id: 10, title: 'S1', songIds: [1, 2], entries: [], version: 1 }],
      },
      {
        id: 2, title: 'B', role: 'creator' as const, sharedWithEmails: [], creator: null, collaborators: [], version: 1,
        sequences: [{ id: 20, title: 'S2', songIds: [2, 3], entries: [], version: 1 }],
      },
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
