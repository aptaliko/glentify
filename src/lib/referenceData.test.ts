import { describe, it, expect } from 'vitest';
import { normalizeReferenceData } from './referenceData';
import type { ReferenceData } from './referenceData';

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
