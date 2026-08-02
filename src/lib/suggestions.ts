import type { SongRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

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
  return getRegionDescendantIds(currentRegionId, regions).includes(candidateRegionId);
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

export interface GenreGroup {
  genreId: number;
  songs: SongRow[];
}

export function groupByGenre(songs: SongRow[]): GenreGroup[] {
  const byGenre = new Map<number, SongRow[]>();
  for (const song of songs) {
    const list = byGenre.get(song.genreId) ?? [];
    list.push(song);
    byGenre.set(song.genreId, list);
  }
  return [...byGenre.entries()].map(([genreId, groupSongs]) => ({
    genreId,
    songs: [...groupSongs].sort((a, b) => a.title.localeCompare(b.title, 'el')),
  }));
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
  | { mode: 'grouped'; genreGroups: GenreGroup[] };

export function getSuggestions(params: SuggestionParams): SuggestionResult {
  const { currentSongId, currentAxisValues, activeAxisTypes, allSongs, regions, playedSongIds, showPlayed } = params;

  if (activeAxisTypes.size === 0) {
    const visible = allSongs
      .filter(({ song }) => song.id !== currentSongId)
      .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
      .map(({ song }) => song);
    return { mode: 'grouped', genreGroups: groupByGenre(visible) };
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
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
}

export interface CurrentSongPayload {
  id: number;
  title: string;
  lyrics: string | null;
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

export interface GenreGroupPayload {
  genreId: number;
  genreName: string;
  songs: SuggestedSong[];
}

export interface SuggestionsResponsePayload {
  currentSong: CurrentSongPayload | null;
  availableAxisTypes: AvailableAxis[];
  activeAxisTypes: string[];
  mode: 'filtered' | 'grouped';
  candidates: SuggestedSong[];
  genreGroups: GenreGroupPayload[];
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
    return { currentSong: null, availableAxisTypes: [], activeAxisTypes: [], mode: 'grouped', candidates: [], genreGroups: [], listTitle: '' };
  }

  const currentAxisValues = currentSongWithAxes.axisValues;
  const availableAxisTypeKeys = currentAxisValues.map((v) => v.axisType);
  const effectiveActive = requestedActive
    ? new Set([...requestedActive].filter((t) => availableAxisTypeKeys.includes(t)))
    : new Set(availableAxisTypeKeys);

  const lookupNameById: Record<string, Map<number, string>> = {
    region: new Map(lookups.regions.map((r) => [r.id, r.name])),
    rhythm: new Map(lookups.rhythms.map((r) => [r.id, r.name])),
    dromos: new Map(lookups.dromoi.map((d) => [d.id, d.name])),
    composer: new Map(lookups.composers.map((c) => [c.id, c.name])),
  };
  const axisLabelByKey = new Map(lookups.axisTypes.map((t) => [t.key, t.label]));
  const genreNameById = new Map(lookups.genres.map((g) => [g.id, g.name]));

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
    maleKey: currentSongWithAxes.maleKey,
    femaleKey: currentSongWithAxes.femaleKey,
  };

  if (result.mode === 'grouped') {
    return {
      currentSong,
      availableAxisTypes,
      activeAxisTypes: [...effectiveActive],
      mode: 'grouped',
      candidates: [],
      genreGroups: result.genreGroups
        .map((g) => ({
          genreId: g.genreId,
          genreName: genreNameById.get(g.genreId) ?? '?',
          songs: g.songs.map((s) => toSuggestion(s.id, s.title)),
        }))
        .sort((a, b) => a.genreName.localeCompare(b.genreName, 'el')),
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
    genreGroups: [],
    listTitle: `Άλλα τραγούδια με τα ίδια: ${activeLabels.join(', ')}`,
  };
}
