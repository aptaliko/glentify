import { describe, it, expect } from 'vitest';
import type { KeyValueStore } from './preferencesStore';
import {
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_DEFAULT,
  clampFontScale,
  stepFontScale,
  loadFontScale,
  saveFontScale,
  loadStageMode,
  saveStageMode,
} from './lyricsReaderSettings';

function fakeStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(key: string) {
      return (data.has(key) ? (data.get(key) as T) : null);
    },
    async set<T>(key: string, value: T | null) {
      if (value === null) data.delete(key);
      else data.set(key, value);
    },
  };
}

describe('clampFontScale', () => {
  it('clamps below the minimum', () => {
    expect(clampFontScale(0.1)).toBe(FONT_SCALE_MIN);
  });
  it('clamps above the maximum', () => {
    expect(clampFontScale(99)).toBe(FONT_SCALE_MAX);
  });
  it('passes through an in-range value', () => {
    expect(clampFontScale(1.5)).toBe(1.5);
  });
  it('falls back to default on NaN', () => {
    expect(clampFontScale(Number.NaN)).toBe(FONT_SCALE_DEFAULT);
  });
});

describe('stepFontScale', () => {
  it('steps up by one step', () => {
    expect(stepFontScale(1, 1)).toBeCloseTo(1.125);
  });
  it('steps down by one step', () => {
    expect(stepFontScale(1, -1)).toBeCloseTo(0.875);
  });
  it('does not step below the minimum', () => {
    expect(stepFontScale(FONT_SCALE_MIN, -1)).toBe(FONT_SCALE_MIN);
  });
  it('does not step above the maximum', () => {
    expect(stepFontScale(FONT_SCALE_MAX, 1)).toBe(FONT_SCALE_MAX);
  });
});

describe('loadFontScale', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await loadFontScale(fakeStore())).toBe(FONT_SCALE_DEFAULT);
  });
  it('returns the clamped stored value', async () => {
    expect(await loadFontScale(fakeStore({ 'glentify:lyrics-font-scale': 99 }))).toBe(FONT_SCALE_MAX);
  });
  it('round-trips a saved value', async () => {
    const store = fakeStore();
    await saveFontScale(store, 1.5);
    expect(await loadFontScale(store)).toBe(1.5);
  });
});

describe('stage mode', () => {
  it('defaults to off when nothing is stored', async () => {
    expect(await loadStageMode(fakeStore())).toBe(false);
  });
  it('reads a stored true', async () => {
    expect(await loadStageMode(fakeStore({ 'glentify:lyrics-stage-mode': true }))).toBe(true);
  });
  it('reads a stored false', async () => {
    expect(await loadStageMode(fakeStore({ 'glentify:lyrics-stage-mode': false }))).toBe(false);
  });
  it('coerces a non-boolean stored value to a boolean', async () => {
    expect(await loadStageMode(fakeStore({ 'glentify:lyrics-stage-mode': 1 }))).toBe(true);
  });
  it('round-trips a saved value', async () => {
    const store = fakeStore();
    await saveStageMode(store, true);
    expect(await loadStageMode(store)).toBe(true);
    await saveStageMode(store, false);
    expect(await loadStageMode(store)).toBe(false);
  });
});
