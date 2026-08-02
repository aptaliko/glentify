import { describe, it, expect } from 'vitest';
import { LocalSessionStore, hasLocalSession } from './sessionStore';
import type { KeyValueStore } from './preferencesStore';
import type { ReferenceData } from './referenceData';
import type { SongRow, RegionRow, GenreRow } from '@/db/schema';

function makeSong(id: number, title: string, genreId = 1): SongRow {
  return { id, title, lyrics: null, genreId, notes: null, maleKey: null, femaleKey: null, createdAt: new Date(), updatedAt: new Date() } as SongRow;
}

function inMemoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return (map.has(key) ? (map.get(key) as T) : null);
    },
    async set<T>(key: string, value: T | null) {
      if (value === null) map.delete(key);
      else map.set(key, value);
    },
  };
}

function referenceData(): ReferenceData {
  const regions: RegionRow[] = [];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό' }];
  return {
    songs: [makeSong(1, 'Τραγούδι Α'), makeSong(2, 'Τραγούδι Β')],
    axisValues: [],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres,
  };
}

describe('LocalSessionStore', () => {
  it('starts a session with the given starting song and no played songs', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    const data = await store.load(false, null);
    expect(data.currentSong?.id).toBe(1);
    expect(data.mode).toBe('grouped');
    expect(data.genreGroups[0].songs.map((s) => s.id)).toEqual([2]);
  });

  it('marks the current song played and advances on pickSong', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.pickSong(2);
    const data = await store.load(true, null);
    expect(data.currentSong?.id).toBe(2);
    const song1 = data.genreGroups.flatMap((g) => g.songs).find((s) => s.id === 1);
    expect(song1?.played).toBe(true);
  });

  it('clears the current song on endSequence, keeping played history', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSequence();
    const data = await store.load(true, null);
    expect(data.currentSong).toBeNull();
  });

  it('clears all local state on endSession', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();
    const data = await store.load(true, null);
    expect(data.currentSong).toBeNull();
    const song1 = data.genreGroups.flatMap((g) => g.songs).find((s) => s.id === 1);
    expect(song1?.played).toBeUndefined();
  });
});

describe('hasLocalSession', () => {
  it('is false before any session has started', async () => {
    expect(await hasLocalSession(inMemoryStore())).toBe(false);
  });

  it('is true after starting a session', async () => {
    const storage = inMemoryStore();
    await LocalSessionStore.start(1, referenceData(), storage);
    expect(await hasLocalSession(storage)).toBe(true);
  });

  it('is false again after endSession', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();
    expect(await hasLocalSession(storage)).toBe(false);
  });
});
