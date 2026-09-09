import type { KeyValueStore } from './preferencesStore';

export const FONT_SCALE_MIN = 0.75;
export const FONT_SCALE_MAX = 2.5;
export const FONT_SCALE_STEP = 0.125;
export const FONT_SCALE_DEFAULT = 1;

const KEY = 'glentify:lyrics-font-scale';
const STAGE_MODE_KEY = 'glentify:lyrics-stage-mode';

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

/**
 * High-contrast "stage mode" for the lyrics reader: full-bleed, chrome hidden,
 * bolder text. Off by default; persisted per device.
 */
export async function loadStageMode(storage: KeyValueStore): Promise<boolean> {
  const stored = await storage.get<boolean>(STAGE_MODE_KEY);
  return stored == null ? false : Boolean(stored);
}

export async function saveStageMode(storage: KeyValueStore, on: boolean): Promise<void> {
  await storage.set(STAGE_MODE_KEY, on);
}
