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

function axisValueMap(axisValues: AxisValue[]): Map<string, AxisValue> {
  return new Map(axisValues.map((v) => [v.axisType, v]));
}

function axisValuesMatch(a: AxisValue, b: AxisValue): boolean {
  if (a.axisType === 'year') return a.yearValue === b.yearValue;
  return a.refId === b.refId;
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

export function regionMatchesFilter(candidateRegionId: number, currentRegionId: number, regions: RegionRow[]): boolean {
  if (candidateRegionId === currentRegionId) return true;
  if (getRegionAncestorIds(currentRegionId, regions).includes(candidateRegionId)) return true;
  if (getRegionDescendantIds(currentRegionId, regions).includes(candidateRegionId)) return true;
  return false;
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

export interface FilteredCandidatesParams {
  currentSongId: number;
  currentAxisValues: AxisValue[];
  activeAxisTypes: Set<string>;
  allSongs: SongWithAxes[];
  regions: RegionRow[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
}

export function getFilteredCandidates(params: FilteredCandidatesParams): SongWithAxes[] {
  const { currentSongId, currentAxisValues, activeAxisTypes, allSongs, regions, playedSongIds, showPlayed } = params;
  const currentMap = axisValueMap(currentAxisValues);

  return allSongs
    .filter(({ song }) => song.id !== currentSongId)
    .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
    .filter(({ axisValues }) => {
      const candidateMap = axisValueMap(axisValues);
      for (const axisType of activeAxisTypes) {
        const currentValue = currentMap.get(axisType);
        if (!currentValue) continue;
        const candidateValue = candidateMap.get(axisType);
        if (!candidateValue) return false;
        if (axisType === 'region' && currentValue.refId !== null && candidateValue.refId !== null) {
          if (!regionMatchesFilter(candidateValue.refId, currentValue.refId, regions)) return false;
        } else if (!axisValuesMatch(currentValue, candidateValue)) {
          return false;
        }
      }
      return true;
    });
}

export function rankBySharedAxes(
  candidates: SongWithAxes[],
  currentAxisValues: AxisValue[],
  activeAxisTypes: Set<string>
): SongRow[] {
  const currentMap = axisValueMap(currentAxisValues);
  const inactiveSharedTypes = [...currentMap.keys()].filter((t) => !activeAxisTypes.has(t));

  function score(axisValues: AxisValue[]): number {
    const candidateMap = axisValueMap(axisValues);
    let total = 0;
    for (const axisType of inactiveSharedTypes) {
      const candidateValue = candidateMap.get(axisType);
      if (candidateValue && axisValuesMatch(currentMap.get(axisType)!, candidateValue)) total += 1;
    }
    return total;
  }

  return [...candidates]
    .sort((a, b) => {
      const diff = score(b.axisValues) - score(a.axisValues);
      if (diff !== 0) return diff;
      return a.song.title.localeCompare(b.song.title, 'el');
    })
    .map((c) => c.song);
}

export interface SuggestionParams {
  currentSongId: number;
  currentAxisValues: AxisValue[];
  activeAxisTypes: Set<string>;
  allSongs: SongWithAxes[];
  regions: RegionRow[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
}

export type SuggestionResult =
  | { mode: 'filtered'; candidates: SongRow[] }
  | { mode: 'ungrouped'; songs: SongRow[] };

export function getSuggestions(params: SuggestionParams): SuggestionResult {
  const { currentSongId, currentAxisValues, activeAxisTypes, allSongs, regions, playedSongIds, showPlayed } = params;

  if (activeAxisTypes.size === 0) {
    const visible = allSongs
      .filter(({ song }) => song.id !== currentSongId)
      .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
      .map(({ song }) => song)
      .sort((a, b) => a.title.localeCompare(b.title, 'el'));
    return { mode: 'ungrouped', songs: visible };
  }

  const filtered = getFilteredCandidates({
    currentSongId,
    currentAxisValues,
    activeAxisTypes,
    allSongs,
    regions,
    playedSongIds,
    showPlayed,
  });
  return { mode: 'filtered', candidates: rankBySharedAxes(filtered, currentAxisValues, activeAxisTypes) };
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

export interface AvailableAxis {
  key: string;
  label: string;
  value: string;
}

export interface SuggestedSong {
  id: number;
  title: string;
  played: boolean;
}

export interface SuggestionsResponsePayload {
  currentSong: CurrentSongPayload | null;
  availableAxisTypes: AvailableAxis[];
  activeAxisTypes: string[];
  mode: 'filtered' | 'ungrouped';
  candidates: SuggestedSong[];
  songs: SuggestedSong[];
  listTitle: string;
}

export interface BuildSuggestionsInput {
  currentSongWithAxes: (CurrentSongPayload & { axisValues: AxisValue[] }) | null;
  allSongs: SongWithAxes[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
  requestedActive: Set<string> | null;
  lookups: ReferenceLookups;
}

export function buildSuggestionsResponse(input: BuildSuggestionsInput): SuggestionsResponsePayload {
  const { currentSongWithAxes, allSongs, playedSongIds, showPlayed, requestedActive, lookups } = input;

  if (!currentSongWithAxes) {
    return { currentSong: null, availableAxisTypes: [], activeAxisTypes: [], mode: 'ungrouped', candidates: [], songs: [], listTitle: '' };
  }

  const currentAxisValues = currentSongWithAxes.axisValues;
  const availableAxisTypeKeys = currentAxisValues.map((v) => v.axisType);
  const effectiveActive = requestedActive
    ? new Set([...requestedActive].filter((t) => availableAxisTypeKeys.includes(t)))
    : new Set(availableAxisTypeKeys);

  const lookupNameById: Record<string, Map<number, string>> = {
    region: new Map(lookups.regions.map((r) => [r.id, r.name])),
    genre: new Map(lookups.genres.map((g) => [g.id, g.name])),
    rhythm: new Map(lookups.rhythms.map((r) => [r.id, r.name])),
    dromos: new Map(lookups.dromoi.map((d) => [d.id, d.name])),
    dance: new Map(lookups.dances.map((d) => [d.id, d.name])),
    composer: new Map(lookups.composers.map((c) => [c.id, c.name])),
  };
  const axisLabelByKey = new Map(lookups.axisTypes.map((t) => [t.key, t.label]));

  function labelForAxisValue(v: AxisValue): string {
    if (v.axisType === 'year') return String(v.yearValue);
    const name = v.refId !== null ? lookupNameById[v.axisType]?.get(v.refId) : undefined;
    return name ?? '?';
  }

  const toSuggestion = (id: number, title: string): SuggestedSong => ({ id, title, played: playedSongIds.has(id) });

  const result = getSuggestions({
    currentSongId: currentSongWithAxes.id,
    currentAxisValues,
    activeAxisTypes: effectiveActive,
    allSongs,
    regions: lookups.regions,
    playedSongIds,
    showPlayed,
  });

  const availableAxisTypes: AvailableAxis[] = currentAxisValues.map((v) => ({
    key: v.axisType,
    label: axisLabelByKey.get(v.axisType) ?? v.axisType,
    value: labelForAxisValue(v),
  }));

  const currentSong: CurrentSongPayload = {
    id: currentSongWithAxes.id,
    title: currentSongWithAxes.title,
    lyrics: currentSongWithAxes.lyrics,
    imageUrl: currentSongWithAxes.imageUrl,
    pdfUrl: currentSongWithAxes.pdfUrl ?? null,
    maleKey: currentSongWithAxes.maleKey,
    femaleKey: currentSongWithAxes.femaleKey,
  };

  if (result.mode === 'ungrouped') {
    return {
      currentSong,
      availableAxisTypes,
      activeAxisTypes: [...effectiveActive],
      mode: 'ungrouped',
      candidates: [],
      songs: result.songs.map((s) => toSuggestion(s.id, s.title)),
      listTitle: '',
    };
  }

  const activeLabels = [...effectiveActive].map((key) => axisLabelByKey.get(key) ?? key);
  return {
    currentSong,
    availableAxisTypes,
    activeAxisTypes: [...effectiveActive],
    mode: 'filtered',
    candidates: result.candidates.map((s) => toSuggestion(s.id, s.title)),
    songs: [],
    listTitle: `Άλλα τραγούδια με τα ίδια: ${activeLabels.join(', ')}`,
  };
}
