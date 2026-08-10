import { describe, it, expect } from 'vitest';
import {
  setSelectedProgramId,
  getSelectedProgramId,
  setSelectedSequenceId,
  getSelectedSequenceId,
} from './localProgramsStore';
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

describe('localProgramsStore', () => {
  it('returns null for the selected program id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedProgramId(store)).toBeNull();
  });

  it('round-trips the selected program id', async () => {
    const store = inMemoryStore();
    await setSelectedProgramId(store, 42);
    expect(await getSelectedProgramId(store)).toBe(42);
  });

  it('returns null for the selected sequence id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedSequenceId(store)).toBeNull();
  });

  it('round-trips the selected sequence id', async () => {
    const store = inMemoryStore();
    await setSelectedSequenceId(store, 7);
    expect(await getSelectedSequenceId(store)).toBe(7);
  });

  it('keeps the program and sequence selections independent', async () => {
    const store = inMemoryStore();
    await setSelectedProgramId(store, 1);
    await setSelectedSequenceId(store, 2);
    expect(await getSelectedProgramId(store)).toBe(1);
    expect(await getSelectedSequenceId(store)).toBe(2);
  });
});
