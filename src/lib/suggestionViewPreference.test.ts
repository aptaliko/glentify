import { describe, it, expect } from 'vitest';
import { getDefaultViewPreference, setDefaultViewPreference } from './suggestionViewPreference';
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

describe('suggestionViewPreference', () => {
  it('defaults to "none" when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'none' });
  });

  it('round-trips a filterGenre preference', async () => {
    const store = inMemoryStore();
    await setDefaultViewPreference(store, { type: 'filterGenre', genreId: 5 });
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'filterGenre', genreId: 5 });
  });

  it('round-trips a groupByGenre preference', async () => {
    const store = inMemoryStore();
    await setDefaultViewPreference(store, { type: 'groupByGenre' });
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'groupByGenre' });
  });

  it('can be reset back to none', async () => {
    const store = inMemoryStore();
    await setDefaultViewPreference(store, { type: 'filterGenre', genreId: 5 });
    await setDefaultViewPreference(store, { type: 'none' });
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'none' });
  });
});
