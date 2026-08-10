import { describe, it, expect } from 'vitest';
import {
  setSelectedEditSongId,
  getSelectedEditSongId,
  setSelectedEditProgramId,
  getSelectedEditProgramId,
} from './adminEditStore';
import type { KeyValueStore } from './preferencesStore';

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

describe('adminEditStore', () => {
  it('returns null for the selected edit song id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedEditSongId(store)).toBeNull();
  });

  it('round-trips the selected edit song id', async () => {
    const store = inMemoryStore();
    await setSelectedEditSongId(store, 5);
    expect(await getSelectedEditSongId(store)).toBe(5);
  });

  it('returns null for the selected edit program id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedEditProgramId(store)).toBeNull();
  });

  it('round-trips the selected edit program id', async () => {
    const store = inMemoryStore();
    await setSelectedEditProgramId(store, 9);
    expect(await getSelectedEditProgramId(store)).toBe(9);
  });

  it('keeps the song and program edit selections independent', async () => {
    const store = inMemoryStore();
    await setSelectedEditSongId(store, 1);
    await setSelectedEditProgramId(store, 2);
    expect(await getSelectedEditSongId(store)).toBe(1);
    expect(await getSelectedEditProgramId(store)).toBe(2);
  });
});
