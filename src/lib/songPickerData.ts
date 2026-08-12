import type { SongRow } from '@/db/schema';
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

export interface SongPickerRhythm {
  id: number;
  name: string;
}

export interface SongPickerDromos {
  id: number;
  name: string;
}

export interface SongPickerComposer {
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
  rhythmId?: number;
  dromosId?: number;
  composerId?: number;
  year?: number;
  search?: string;
}

export interface SongPickerDataSource {
  listGenres(): Promise<SongPickerGenre[]>;
  listRegions(): Promise<SongPickerRegion[]>;
  listRhythms(): Promise<SongPickerRhythm[]>;
  listDromoi(): Promise<SongPickerDromos[]>;
  listComposers(): Promise<SongPickerComposer[]>;
  listSongs(filters: SongPickerFilters): Promise<SongPickerSong[]>;
  /** All songs, unfiltered — used by the new SongPicker's default paginated view. */
  listAllSongs(): Promise<SongPickerSong[]>;
}

export const remoteSongPickerDataSource: SongPickerDataSource = {
  async listGenres() {
    const res = await fetch('/api/genres');
    return res.json();
  },
  async listRegions() {
    const res = await fetch('/api/regions');
    return res.json();
  },
  async listRhythms() {
    const res = await fetch('/api/rhythms');
    return res.json();
  },
  async listDromoi() {
    const res = await fetch('/api/dromoi');
    return res.json();
  },
  async listComposers() {
    const res = await fetch('/api/composers');
    return res.json();
  },
  async listSongs(filters: SongPickerFilters) {
    const params = new URLSearchParams();
    if (filters.genreId) params.set('genreId', String(filters.genreId));
    if (filters.regionId) params.set('regionId', String(filters.regionId));
    if (filters.rhythmId) params.set('rhythmId', String(filters.rhythmId));
    if (filters.dromosId) params.set('dromosId', String(filters.dromosId));
    if (filters.composerId) params.set('composerId', String(filters.composerId));
    if (filters.year) params.set('year', String(filters.year));
    if (filters.search) params.set('search', filters.search);
    const res = await fetch(`/api/songs?${params.toString()}`);
    return res.json();
  },
  async listAllSongs() {
    const res = await fetch('/api/songs');
    return res.json();
  },
};

export function filterSongsLocal(data: ReferenceData, filters: SongPickerFilters): SongRow[] {
  let results = data.songs;
  if (filters.search) {
    const q = filters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    results = results.filter((s) => s.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  }
  if (filters.genreId) {
    const genreSongIds = new Set(
      data.axisValues.filter((av) => av.axisType === 'genre' && av.refId === filters.genreId).map((av) => av.songId)
    );
    results = results.filter((s) => genreSongIds.has(s.id));
  }
  if (filters.rhythmId) {
    const rhythmSongIds = new Set(
      data.axisValues.filter((av) => av.axisType === 'rhythm' && av.refId === filters.rhythmId).map((av) => av.songId)
    );
    results = results.filter((s) => rhythmSongIds.has(s.id));
  }
  if (filters.dromosId) {
    const dromosSongIds = new Set(
      data.axisValues.filter((av) => av.axisType === 'dromos' && av.refId === filters.dromosId).map((av) => av.songId)
    );
    results = results.filter((s) => dromosSongIds.has(s.id));
  }
  if (filters.composerId) {
    const composerSongIds = new Set(
      data.axisValues.filter((av) => av.axisType === 'composer' && av.refId === filters.composerId).map((av) => av.songId)
    );
    results = results.filter((s) => composerSongIds.has(s.id));
  }
  if (filters.year) {
    const yearSongIds = new Set(
      data.axisValues.filter((av) => av.axisType === 'year' && av.yearValue === filters.year).map((av) => av.songId)
    );
    results = results.filter((s) => yearSongIds.has(s.id));
  }
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
    async listRegions() {
      return data.regions.map((r) => ({ id: r.id, name: r.name }));
    },
    async listRhythms() {
      return data.rhythms.map((r) => ({ id: r.id, name: r.name }));
    },
    async listDromoi() {
      return data.dromoi.map((d) => ({ id: d.id, name: d.name }));
    },
    async listComposers() {
      return data.composers.map((c) => ({ id: c.id, name: c.name }));
    },
    async listSongs(filters: SongPickerFilters) {
      return filterSongsLocal(data, filters).map((s) => ({ id: s.id, title: s.title }));
    },
    async listAllSongs() {
      return data.songs.map((s) => ({ id: s.id, title: s.title }));
    },
  };
}
