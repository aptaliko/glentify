import type { KeyValueStore } from './preferencesStore';

const PREFERENCE_KEY = 'glentify:suggestion-default-view';

export type DefaultViewPreference =
  | { type: 'none' }
  | { type: 'filterGenre'; genreId: number }
  | { type: 'groupByGenre' };

export async function getDefaultViewPreference(storage: KeyValueStore): Promise<DefaultViewPreference> {
  const stored = await storage.get<DefaultViewPreference>(PREFERENCE_KEY);
  return stored ?? { type: 'none' };
}

export async function setDefaultViewPreference(storage: KeyValueStore, pref: DefaultViewPreference): Promise<void> {
  if (pref.type === 'none') {
    await storage.set(PREFERENCE_KEY, null);
    return;
  }
  await storage.set(PREFERENCE_KEY, pref);
}
