import { describe, it, expect } from 'vitest';
import { mintDraftId, isDraftId, resolveOne, resolveMany, type DraftMap } from './draftIds';

describe('mintDraftId / isDraftId', () => {
  it('mints unique, always-negative ids', () => {
    const a = mintDraftId();
    const b = mintDraftId();
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(0);
    expect(a).not.toBe(b);
    expect(isDraftId(a)).toBe(true);
    expect(isDraftId(42)).toBe(false);
    expect(isDraftId(0)).toBe(false);
  });
});

describe('resolveOne', () => {
  const map: DraftMap = { 'regions:-5': 100, 'song:-9': 200 };
  it('passes real ids through unchanged', () => {
    expect(resolveOne(map, 'regions', 100)).toBe(100);
  });
  it('maps a resolved draft to its real id', () => {
    expect(resolveOne(map, 'regions', -5)).toBe(100);
  });
  it('returns null for an unresolved draft', () => {
    expect(resolveOne(map, 'regions', -6)).toBeNull();
  });
  it('namespaces by entity', () => {
    expect(resolveOne(map, 'song', -5)).toBeNull();
  });
});

describe('resolveMany', () => {
  const map: DraftMap = { 'sequence-song:-1': 11, 'sequence-song:-2': 12 };
  it('resolves all when possible', () => {
    expect(resolveMany(map, 'sequence-song', [-1, -2, 5])).toEqual({ ids: [11, 12, 5], allResolved: true });
  });
  it('flags allResolved false and keeps nulls out of ids when one is unresolved', () => {
    const r = resolveMany(map, 'sequence-song', [-1, -3]);
    expect(r.allResolved).toBe(false);
    expect(r.ids).toEqual([11]);
  });
});
