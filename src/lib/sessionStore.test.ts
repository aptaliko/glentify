import { describe, it, expect } from 'vitest';
import { LocalSessionStore, hasLocalSession, getLastEndedSession, clearLastEndedSession } from './sessionStore';
import type { KeyValueStore } from './preferencesStore';
import type { ReferenceData } from './referenceData';
import type { SongRow, RegionRow, GenreRow } from '@/db/schema';

function makeSong(id: number, title: string): SongRow {
  return { id, title, lyrics: null, notes: null, maleKey: null, femaleKey: null, createdAt: new Date(), updatedAt: new Date() } as SongRow;
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
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό', ownerId: null }];
  return {
    songs: [makeSong(1, 'Τραγούδι Α'), makeSong(2, 'Τραγούδι Β')],
    sharedSongs: [],
    axisValues: [],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres,
    programs: [],
  };
}

function referenceDataWithThreeSongs(): ReferenceData {
  const regions: RegionRow[] = [];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό', ownerId: null }];
  return {
    songs: [makeSong(1, 'Τραγούδι Α'), makeSong(2, 'Τραγούδι Β'), makeSong(3, 'Τραγούδι Γ')],
    sharedSongs: [],
    axisValues: [],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres,
    programs: [],
  };
}

describe('LocalSessionStore', () => {
  it('starts a session with the given starting song and no played songs', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    const data = await store.load(false, null);
    expect(data.currentSong?.id).toBe(1);
    expect(data.mode).toBe('ungrouped');
    expect(data.songs.map((s) => s.id)).toEqual([2]);
  });

  it('marks the current song played and advances on pickSong', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.pickSong(2);
    const data = await store.load(true, null);
    expect(data.currentSong?.id).toBe(2);
    const song1 = data.songs.find((s) => s.id === 1);
    expect(song1?.played).toBe(true);
  });

  it('clears the current song on endSequence, keeping played history', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceDataWithThreeSongs(), storage);
    await store.pickSong(2); // marks song 1 as played, current = 2
    await store.pickSong(3); // marks song 2 as played, current = 3
    await store.endSequence(); // marks song 3 as played, current = null
    // To verify played history was kept, pick a new song and inspect songs
    await store.pickSong(1); // current = 1, playedSongIds should still be [2, 3]
    const data = await store.load(true, null);
    expect(data.currentSong?.id).toBe(1);
    // Song 2 and 3 should show as played (proving endSequence preserved playedSongIds)
    const song2 = data.songs.find((s) => s.id === 2);
    const song3 = data.songs.find((s) => s.id === 3);
    expect(song2?.played).toBe(true);
    expect(song3?.played).toBe(true);
  });

  it('clears all local state on endSession', async () => {
    const storage = inMemoryStore();
    const ref = referenceDataWithThreeSongs();

    // Build up some played history on the same store instance
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.pickSong(2); // marks song 1 as played, current = 2
    await store.pickSong(3); // marks song 2 as played, current = 3

    // Verify played history exists before endSession
    let data = await store.load(true, null);
    const song1Before = data.songs.find((s) => s.id === 1);
    const song2Before = data.songs.find((s) => s.id === 2);
    expect(song1Before?.played).toBe(true);
    expect(song2Before?.played).toBe(true);

    // Clear everything via endSession on the same store instance
    await store.endSession();

    // Call pickSong directly on the SAME store instance (no new start() call)
    // This exposes what endSession actually left in storage without masking it
    await store.pickSong(1);
    data = await store.load(true, null);

    // Song 2 and 3 should NOT be marked as played if endSession correctly cleared playedSongIds
    // If endSession was buggy (e.g. just called endSequence), they would still be marked as played
    const song2After = data.songs.find((s) => s.id === 2);
    const song3After = data.songs.find((s) => s.id === 3);
    expect(song2After?.played).toBe(false);
    expect(song3After?.played).toBe(false);
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

  it('is still true after endSequence (played history preserved for resume)', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSequence();
    expect(await hasLocalSession(storage)).toBe(true);
  });
});

describe('LocalSessionStore sequence tracking', () => {
  it('stamps played songs with the current sequence index, incrementing on endSequence', async () => {
    const storage = inMemoryStore();
    const ref = referenceDataWithThreeSongs();
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.pickSong(2); // song 1 played at sequenceIndex 0
    await store.endSequence(); // song 2 played at sequenceIndex 0, index becomes 1
    await store.pickSong(3); // (no-op mark, current was null)
    await store.endSession(); // song 3 played at sequenceIndex 1

    const lastEnded = await getLastEndedSession(storage);
    expect(lastEnded).toEqual({
      sequences: [{ songIds: [1, 2] }, { songIds: [3] }],
    });
  });

  it('marks the final current song as played on endSession (a pre-existing gap this fixes)', async () => {
    const storage = inMemoryStore();
    const ref = referenceData();
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.endSession(); // song 1 was never explicitly "played" via pickSong/endSequence

    const lastEnded = await getLastEndedSession(storage);
    expect(lastEnded).toEqual({ sequences: [{ songIds: [1] }] });
  });

  it('still fully clears local session state on endSession (existing behavior preserved)', async () => {
    const storage = inMemoryStore();
    const ref = referenceDataWithThreeSongs();
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.pickSong(2);
    await store.endSession();
    expect(await hasLocalSession(storage)).toBe(false);
  });

  it('treats a legacy-shaped persisted record (missing playedEntries) as no session, instead of crashing', async () => {
    const storage = inMemoryStore();
    // Simulate a record written by the pre-this-update app version.
    await storage.set('glentify:local-session', { currentSongId: 1, playedSongIds: [] });
    const store = new LocalSessionStore(referenceData(), storage);

    const data = await store.load(false, null);
    expect(data.currentSong).toBeNull();

    // Confirm it also doesn't crash on the write paths.
    await store.pickSong(1);
    await store.endSession();
  });
});

describe('getLastEndedSession / clearLastEndedSession', () => {
  it('is null before any session has ended', async () => {
    const storage = inMemoryStore();
    expect(await getLastEndedSession(storage)).toBeNull();
  });

  it('is a non-destructive read — calling it twice returns the same data', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();

    const first = await getLastEndedSession(storage);
    const second = await getLastEndedSession(storage);
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
  });

  it('clearLastEndedSession removes it', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();
    await clearLastEndedSession(storage);
    expect(await getLastEndedSession(storage)).toBeNull();
  });
});
