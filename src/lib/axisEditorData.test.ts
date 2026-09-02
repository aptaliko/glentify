import { describe, it, expect } from 'vitest';
import { resolveAxisEditorData } from './axisEditorData';
import type { ReferenceData } from './referenceData';

function makeReferenceData(overrides: Partial<ReferenceData> = {}): ReferenceData {
  return {
    songs: [],
    sharedSongs: [],
    axisValues: [],
    regions: [],
    rhythms: [],
    dromoi: [],
    composers: [],
    genres: [],
    axisTypes: [],
    programs: [],
    currentUser: null,
    ...overrides,
  };
}

describe('resolveAxisEditorData', () => {
  it('returns empty axisTypes and optionsByAxis for empty reference data', () => {
    expect(resolveAxisEditorData(makeReferenceData())).toEqual({ axisTypes: [], optionsByAxis: {} });
  });

  it('maps each lookup axis type to its matching referenceData field', () => {
    const referenceData = makeReferenceData({
      axisTypes: [
        { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
        { id: 2, key: 'genre', label: 'Είδος', lookupTable: 'genres', hierarchical: false },
      ],
      regions: [{ id: 10, name: 'Κρήτη', parentId: null, ownerId: null }],
      genres: [{ id: 20, name: 'Δημοτικό', ownerId: null }],
    });
    expect(resolveAxisEditorData(referenceData)).toEqual({
      axisTypes: referenceData.axisTypes,
      optionsByAxis: {
        region: [{ id: 10, name: 'Κρήτη', parentId: null, ownerId: null }],
        genre: [{ id: 20, name: 'Δημοτικό', ownerId: null }],
      },
    });
  });

  it('leaves a non-lookup axis type (e.g. year) with no optionsByAxis entry', () => {
    const referenceData = makeReferenceData({
      axisTypes: [{ id: 3, key: 'year', label: 'Έτος', lookupTable: null, hierarchical: false }],
    });
    expect(resolveAxisEditorData(referenceData)).toEqual({ axisTypes: referenceData.axisTypes, optionsByAxis: {} });
  });

  it('covers all five lookup fields', () => {
    const referenceData = makeReferenceData({
      axisTypes: [
        { id: 1, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
        { id: 2, key: 'dromos', label: 'Δρόμος', lookupTable: 'dromoi', hierarchical: false },
        { id: 3, key: 'composer', label: 'Συνθέτης', lookupTable: 'composers', hierarchical: false },
      ],
      rhythms: [{ id: 30, name: 'Συρτός', ownerId: null }],
      dromoi: [{ id: 40, name: 'Ουσάκ', ownerId: null }],
      composers: [{ id: 50, name: 'Ανώνυμος', ownerId: null }],
    });
    expect(resolveAxisEditorData(referenceData).optionsByAxis).toEqual({
      rhythm: [{ id: 30, name: 'Συρτός', ownerId: null }],
      dromos: [{ id: 40, name: 'Ουσάκ', ownerId: null }],
      composer: [{ id: 50, name: 'Ανώνυμος', ownerId: null }],
    });
  });
});
