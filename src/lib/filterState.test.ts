import { describe, it, expect } from 'vitest';
import {
  addFilter,
  removeFilter,
  valuesForAxis,
  visibleAxes,
  addableAxes,
  closeAxisIfEmpty,
  parseFiltersParam,
  serializeFilters,
} from './filterState';
import type { AxisOptions, FilterValue } from './suggestions';

const region = (refId: number): FilterValue => ({ axisType: 'region', refId, yearValue: null });
const rhythm = (refId: number): FilterValue => ({ axisType: 'rhythm', refId, yearValue: null });
const year = (yearValue: number): FilterValue => ({ axisType: 'year', refId: null, yearValue });

const axes: AxisOptions[] = [
  { axisType: 'region', label: 'Περιοχή', options: [] },
  { axisType: 'rhythm', label: 'Ρυθμός', options: [] },
  { axisType: 'dromos', label: 'Δρόμος', options: [] },
];

describe('addFilter / removeFilter', () => {
  it('addFilter appends and never duplicates', () => {
    expect(addFilter([region(5)], region(4))).toEqual([region(5), region(4)]);
    expect(addFilter([region(5)], region(5))).toEqual([region(5)]);
  });
  it('removeFilter removes only the matching value', () => {
    expect(removeFilter([region(5), region(4)], region(5))).toEqual([region(4)]);
  });
  it('valuesForAxis returns only that axis', () => {
    expect(valuesForAxis([region(5), rhythm(10), region(4)], 'region')).toEqual([region(5), region(4)]);
  });
});

describe('visibleAxes / addableAxes', () => {
  it('shows axes with a chip or open, in axes order', () => {
    const visible = visibleAxes(axes, [rhythm(10)], ['dromos']);
    expect(visible.map((a) => a.axisType)).toEqual(['rhythm', 'dromos']);
  });
  it('addableAxes lists only axes without a visible column', () => {
    const visible = visibleAxes(axes, [rhythm(10)], []);
    expect(addableAxes(axes, visible).map((a) => a.axisType)).toEqual(['region', 'dromos']);
  });
});

describe('closeAxisIfEmpty', () => {
  it('removes the axis only when no chip is left', () => {
    const f = [rhythm(10)];
    expect(closeAxisIfEmpty(['rhythm', 'dromos'], f, 'rhythm')).toEqual(['rhythm', 'dromos']);
    expect(closeAxisIfEmpty(['rhythm', 'dromos'], [], 'rhythm')).toEqual(['dromos']);
  });
});

describe('parseFiltersParam / serializeFilters', () => {
  it('parseFiltersParam: null is absent, empty string is no filters', () => {
    expect(parseFiltersParam(null)).toBeNull();
    expect(parseFiltersParam('')).toEqual([]);
  });
  it('parseFiltersParam drops malformed pairs', () => {
    expect(parseFiltersParam('region:abc,,year:,rhythm:10')).toEqual([{ axisType: 'rhythm', refId: 10, yearValue: null }]);
  });
  it('parseFiltersParam drops a bare word with no colon', () => {
    expect(parseFiltersParam('region')).toEqual([]);
  });
  it('serializeFilters round-trips', () => {
    const f = [region(5), year(1998)];
    expect(parseFiltersParam(serializeFilters(f))).toEqual(f);
  });
  it('serializeFilters writes the URL form', () => {
    expect(serializeFilters([region(12), region(7), year(1998)])).toBe('region:12,region:7,year:1998');
  });
});
