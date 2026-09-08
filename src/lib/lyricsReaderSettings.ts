import type { KeyValueStore } from './preferencesStore';

export const FONT_SCALE_MIN = 0.75;
export const FONT_SCALE_MAX = 2.5;
export const FONT_SCALE_STEP = 0.125;
export const FONT_SCALE_DEFAULT = 1;

const KEY = 'glentify:lyrics-font-scale';

export function clampFontScale(scale: number): number {
  if (Number.isNaN(scale)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
}

export function stepFontScale(current: number, direction: 1 | -1): number {
  return clampFontScale(current + direction * FONT_SCALE_STEP);
}

export async function loadFontScale(storage: KeyValueStore): Promise<number> {
  const stored = await storage.get<number>(KEY);
  return stored == null ? FONT_SCALE_DEFAULT : clampFontScale(stored);
}

export async function saveFontScale(storage: KeyValueStore, scale: number): Promise<void> {
  await storage.set(KEY, clampFontScale(scale));
}
