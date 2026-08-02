import type { RegionRow, SongRow } from '@/db/schema';
import { getRegionDescendantIds } from './suggestions';
import type { ReferenceData } from './referenceData';

export interface SongPickerGenre {
  id: number;
  name: string;
}

export interface SongPickerRegion {
  id: number;
  name: string;
}

export interface SongPickerSong {
  id: number;
  title: string;
}

export interface SongPickerFilters {
  genreId?: number;
  regionId?: number;
  search?: string;
}

export interface SongPickerDataSource {
  listGenres(): Promise<SongPickerGenre[]>;
  listRegionsForGenre(genreId: number): Promise<SongPickerRegion[]>;
  listSongs(filters: SongPickerFilters): Promise<SongPickerSong[]>;
}

export const remoteSongPickerDataSource: SongPickerDataSource = {
  async listGenres() {
    const res = await fetch('/api/genres');
    return res.json();
  },
  async listRegionsForGenre(genreId: number) {
    const res = await fetch(`/api/genres/${genreId}/regions`);
    return res.json();
  },
  async listSongs(filters: SongPickerFilters) {
    const params = new URLSearchParams();
    if (filters.genreId) params.set('genreId', String(filters.genreId));
    if (filters.regionId) params.set('regionId', String(filters.regionId));
    if (filters.search) params.set('search', filters.search);
    const res = await fetch(`/api/songs?${params.toString()}`);
    return res.json();
  },
};

function findTopLevelRegionId(regionId: number, byId: Map<number, RegionRow>): number {
  let current = byId.get(regionId);
  while (current && current.parentId !== null) {
    current = byId.get(current.parentId);
  }
  return current ? current.id : regionId;
}

export function getUsedTopLevelRegionsLocal(genreId: number, data: ReferenceData): RegionRow[] {
  const genreSongIds = new Set(data.songs.filter((s) => s.genreId === genreId).map((s) => s.id));
  if (genreSongIds.size === 0) return [];
  const byId = new Map(data.regions.map((r) => [r.id, r]));
  const topLevelIds = new Set<number>();
  for (const av of data.axisValues) {
    if (av.axisType === 'region' && genreSongIds.has(av.songId) && av.refId !== null) {
      topLevelIds.add(findTopLevelRegionId(av.refId, byId));
    }
  }
  return data.regions.filter((r) => topLevelIds.has(r.id));
}

export function filterSongsLocal(data: ReferenceData, filters: SongPickerFilters): SongRow[] {
  let results = data.songs;
  if (filters.search) {
    const q = filters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    results = results.filter((s) => s.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  }
  if (filters.genreId) results = results.filter((s) => s.genreId === filters.genreId);
  if (!filters.regionId) return results;

  const allowedRegionIds = new Set([filters.regionId, ...getRegionDescendantIds(filters.regionId, data.regions)]);
  const songIds = new Set(results.map((s) => s.id));
  const matchingSongIds = new Set(
    data.axisValues
      .filter((av) => av.axisType === 'region' && songIds.has(av.songId) && av.refId !== null && allowedRegionIds.has(av.refId))
      .map((av) => av.songId)
  );
  return results.filter((s) => matchingSongIds.has(s.id));
}

export function createLocalSongPickerDataSource(data: ReferenceData): SongPickerDataSource {
  return {
    async listGenres() {
      return data.genres.map((g) => ({ id: g.id, name: g.name }));
    },
    async listRegionsForGenre(genreId: number) {
      return getUsedTopLevelRegionsLocal(genreId, data).map((r) => ({ id: r.id, name: r.name }));
    },
    async listSongs(filters: SongPickerFilters) {
      return filterSongsLocal(data, filters).map((s) => ({ id: s.id, title: s.title }));
    },
  };
}
