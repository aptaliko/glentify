import type { SongRow, RegionRow } from '@/db/schema';

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
