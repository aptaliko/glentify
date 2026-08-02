import { Preferences } from '@capacitor/preferences';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T | null): Promise<void>;
}

export const preferencesStore: KeyValueStore = {
  async get<T>(key: string): Promise<T | null> {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : null;
  },
  async set<T>(key: string, value: T | null): Promise<void> {
    if (value === null) {
      await Preferences.remove({ key });
      return;
    }
    await Preferences.set({ key, value: JSON.stringify(value) });
  },
};
