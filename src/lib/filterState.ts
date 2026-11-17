import { filterKey, type AxisOptions, type FilterValue } from './suggestions';

// Pure helpers for the suggestion filter columns. Shared by the server route (URL params) and the client views.

export function addFilter(filters: FilterValue[], value: FilterValue): FilterValue[] {
  const key = filterKey(value);
  if (filters.some((f) => filterKey(f) === key)) return filters;
  return [...filters, value];
}

export function removeFilter(filters: FilterValue[], value: FilterValue): FilterValue[] {
  const key = filterKey(value);
  return filters.filter((f) => filterKey(f) !== key);
}

export function valuesForAxis(filters: FilterValue[], axisType: string): FilterValue[] {
  return filters.filter((f) => f.axisType === axisType);
}

// Axes that have at least one chip or are open, in the order of `axes`.
export function visibleAxes(axes: AxisOptions[], filters: FilterValue[], openAxes: string[]): AxisOptions[] {
  const withChips = new Set(filters.map((f) => f.axisType));
  return axes.filter((a) => withChips.has(a.axisType) || openAxes.includes(a.axisType));
}

export function addableAxes(axes: AxisOptions[], visible: AxisOptions[]): AxisOptions[] {
  const shown = new Set(visible.map((a) => a.axisType));
  return axes.filter((a) => !shown.has(a.axisType));
}

// Closing a column is only automatic when its last chip is removed; an open empty column stays open.
export function closeAxisIfEmpty(openAxes: string[], filters: FilterValue[], axisType: string): string[] {
  if (filters.some((f) => f.axisType === axisType)) return openAxes;
  return openAxes.filter((a) => a !== axisType);
}

// URL form: "region:12,region:7,year:1998". Returns null when the param is absent (use defaults).
// Malformed pairs are dropped rather than failing the request, so a stale link still loads.
export function parseFiltersParam(raw: string | null): FilterValue[] | null {
  if (raw === null) return null;
  const result: FilterValue[] = [];
  for (const pair of raw.split(',')) {
    const colon = pair.indexOf(':');
    if (colon <= 0) continue;
    const axisType = pair.slice(0, colon);
    const value = pair.slice(colon + 1);
    if (!/^\d+$/.test(value)) continue;
    const n = Number(value);
    if (axisType === 'year') {
      result.push({ axisType, refId: null, yearValue: n });
    } else {
      result.push({ axisType, refId: n, yearValue: null });
    }
  }
  return result;
}

export function serializeFilters(filters: FilterValue[]): string {
  return filters.map((f) => `${f.axisType}:${f.refId ?? f.yearValue}`).join(',');
}
