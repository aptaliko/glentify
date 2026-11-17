import type { SongRow, RegionRow, RhythmRow, DromosRow, DanceRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface AxisValue {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

export interface SongWithAxes {
  song: SongRow;
  axisValues: AxisValue[];
}

export function getRegionAncestorIds(regionId: number, regions: RegionRow[]): number[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const ancestors: number[] = [];
  let current = byId.get(regionId);
  while (current && current.parentId !== null) {
    ancestors.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return ancestors;
}

export function getRegionDescendantIds(regionId: number, regions: RegionRow[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const r of regions) {
    if (r.parentId !== null) {
      const list = childrenByParent.get(r.parentId) ?? [];
      list.push(r.id);
      childrenByParent.set(r.parentId, list);
    }
  }
  const result: number[] = [];
  const stack = [...(childrenByParent.get(regionId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    result.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

export interface FilterValue {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

// Default filters: the song's region followed by its ancestors (current first), then one value per other axis.
// Ancestor ids missing from `regions` are dropped, so a dangling parentId never becomes a phantom chip.
export function defaultFilters(current: AxisValue[], regions: RegionRow[]): FilterValue[] {
  const known = new Set(regions.map((r) => r.id));
  const result: FilterValue[] = [];
  const region = current.find((v) => v.axisType === 'region');
  if (region && region.refId !== null) {
    result.push({ axisType: 'region', refId: region.refId, yearValue: null });
    for (const id of getRegionAncestorIds(region.refId, regions)) {
      if (known.has(id)) result.push({ axisType: 'region', refId: id, yearValue: null });
    }
  }
  for (const v of current) {
    if (v.axisType === 'region') continue;
    result.push({ axisType: v.axisType, refId: v.refId, yearValue: v.yearValue });
  }
  return result;
}

export function filterKey(v: FilterValue): string {
  return `${v.axisType}:${v.refId ?? v.yearValue}`;
}

// Stable sort by position in axisOrder; axes not in axisOrder go last, keeping insertion order.
export function orderFilters(filters: FilterValue[], axisOrder: string[]): FilterValue[] {
  const rank = (f: FilterValue) => {
    const i = axisOrder.indexOf(f.axisType);
    return i === -1 ? axisOrder.length : i;
  };
  return [...filters].sort((a, b) => rank(a) - rank(b));
}

function valueMatchesFilter(v: AxisValue, f: FilterValue): boolean {
  if (v.axisType !== f.axisType) return false;
  if (f.axisType === 'year') return v.yearValue === f.yearValue;
  return v.refId === f.refId;
}

// Every filtered axis must be satisfied by one of its selected values (OR within an axis, AND across axes).
export function matchesFilters(candidate: AxisValue[], filters: FilterValue[]): boolean {
  const byAxis = new Map<string, FilterValue[]>();
  for (const f of filters) {
    const list = byAxis.get(f.axisType) ?? [];
    list.push(f);
    byAxis.set(f.axisType, list);
  }
  for (const fs of byAxis.values()) {
    if (!fs.some((f) => candidate.some((v) => valueMatchesFilter(v, f)))) return false;
  }
  return true;
}

// Index in orderedFilters of the first filter the candidate satisfies, or MAX_SAFE_INTEGER if none does.
export function firstMatchIndex(candidate: AxisValue[], orderedFilters: FilterValue[]): number {
  const i = orderedFilters.findIndex((f) => candidate.some((v) => valueMatchesFilter(v, f)));
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

export interface ReferenceLookups {
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  dances: DanceRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
}

export interface CurrentSongPayload {
  id: number;
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  pdfUrl?: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

export interface SuggestedSong {
  id: number;
  title: string;
  played: boolean;
}

export interface FilterOption {
  refId: number | null;
  yearValue: number | null;
  name: string;
}

export interface AxisOptions {
  axisType: string;
  label: string;
  options: FilterOption[];
}

export interface SuggestionsResponsePayload {
  currentSong: CurrentSongPayload | null;
  appliedFilters: FilterValue[];
  mode: 'filtered' | 'ungrouped';
  axes: AxisOptions[];
  candidates: SuggestedSong[];
}

export interface BuildSuggestionsInput {
  currentSongWithAxes: (CurrentSongPayload & { axisValues: AxisValue[] }) | null;
  allSongs: SongWithAxes[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
  // null means "not chosen by the user yet": use the song's defaults.
  filters: FilterValue[] | null;
  lookups: ReferenceLookups;
}

// Every axis type that has at least one option, in lookups.axisTypes order. Options are sorted by name,
// years ascending. Years come from the songs themselves, since they have no lookup table.
function buildAxisOptions(lookups: ReferenceLookups, allSongs: SongWithAxes[]): AxisOptions[] {
  const years = [
    ...new Set(allSongs.flatMap((s) => s.axisValues.filter((v) => v.axisType === 'year').map((v) => v.yearValue))),
  ]
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);

  const fromLookup = (rows: { id: number; name: string }[]): FilterOption[] =>
    rows
      .map((r) => ({ refId: r.id, yearValue: null, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'el'));

  const optionsByKey: Record<string, FilterOption[]> = {
    region: fromLookup(lookups.regions),
    rhythm: fromLookup(lookups.rhythms),
    dromos: fromLookup(lookups.dromoi),
    dance: fromLookup(lookups.dances),
    composer: fromLookup(lookups.composers),
    genre: fromLookup(lookups.genres),
    year: years.map((y) => ({ refId: null, yearValue: y, name: String(y) })),
  };

  return lookups.axisTypes
    .map((t) => ({ axisType: t.key, label: t.label, options: optionsByKey[t.key] ?? [] }))
    .filter((a) => a.options.length > 0);
}

export function buildSuggestionsResponse(input: BuildSuggestionsInput): SuggestionsResponsePayload {
  const { currentSongWithAxes, allSongs, playedSongIds, showPlayed, filters, lookups } = input;

  const axes = buildAxisOptions(lookups, allSongs);
  const axisOrder = axes.map((a) => a.axisType);
  const knownFilterKeys = new Set(axes.flatMap((a) => a.options.map((o) => filterKey({ axisType: a.axisType, refId: o.refId, yearValue: o.yearValue }))));

  if (!currentSongWithAxes) {
    return { currentSong: null, appliedFilters: [], mode: 'ungrouped', axes, candidates: [] };
  }

  const requested = filters ?? defaultFilters(currentSongWithAxes.axisValues, lookups.regions);
  const seen = new Set<string>();
  const appliedFilters = requested.filter((f) => {
    const key = filterKey(f);
    if (!knownFilterKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const ordered = orderFilters(appliedFilters, axisOrder);

  const candidates = allSongs
    .filter(({ song }) => song.id !== currentSongWithAxes.id)
    .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
    .filter(({ axisValues }) => matchesFilters(axisValues, appliedFilters))
    .sort((a, b) => {
      const diff = firstMatchIndex(a.axisValues, ordered) - firstMatchIndex(b.axisValues, ordered);
      if (diff !== 0) return diff;
      return a.song.title.localeCompare(b.song.title, 'el');
    })
    .map(({ song }) => ({ id: song.id, title: song.title, played: playedSongIds.has(song.id) }));

  const currentSong: CurrentSongPayload = {
    id: currentSongWithAxes.id,
    title: currentSongWithAxes.title,
    lyrics: currentSongWithAxes.lyrics,
    imageUrl: currentSongWithAxes.imageUrl,
    pdfUrl: currentSongWithAxes.pdfUrl ?? null,
    maleKey: currentSongWithAxes.maleKey,
    femaleKey: currentSongWithAxes.femaleKey,
  };

  return {
    currentSong,
    appliedFilters,
    mode: appliedFilters.length > 0 ? 'filtered' : 'ungrouped',
    axes,
    candidates,
  };
}
