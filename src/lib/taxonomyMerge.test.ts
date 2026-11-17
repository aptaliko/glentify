import { describe, it, expect } from 'vitest';
import { mergeTaxonomyWithPending, taxonomyInUseMessage, type TaxonomyBaseValue } from './taxonomyMerge';
import type { QueuedAction } from './syncQueue';

function action(overrides: Partial<QueuedAction>): QueuedAction {
  return { id: 'x', type: 'regions-create', payload: {}, attempts: 0, needsAttention: false, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}
const base: TaxonomyBaseValue[] = [
  { id: 1, name: 'Σμύρνη', parentId: null },
  { id: 2, name: 'Πόλη', parentId: null },
];

describe('mergeTaxonomyWithPending', () => {
  it('appends a pending create with its draft id', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'regions-create', payload: { draftId: -5, name: 'Κρήτη', parentId: null } })], 'regions');
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ id: -5, name: 'Κρήτη', parentId: null, status: 'pending-create' });
  });
  it('hides a pending delete', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'regions-delete', payload: { id: 1 } })], 'regions');
    expect(out.map((v) => v.id)).toEqual([2]);
  });
  it('keeps a needs-attention delete visible as active', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'regions-delete', payload: { id: 1 }, needsAttention: true })], 'regions');
    expect(out.find((v) => v.id === 1)?.status).toBe('active');
  });
  it('nets a created-then-deleted draft to absent', () => {
    const out = mergeTaxonomyWithPending(base, [
      action({ id: 'a', type: 'regions-create', payload: { draftId: -5, name: 'Κρήτη', parentId: null } }),
      action({ id: 'b', type: 'regions-delete', payload: { id: -5 } }),
    ], 'regions');
    expect(out.map((v) => v.id)).toEqual([1, 2]);
  });
  it('ignores actions for a different entity', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'genres-create', payload: { draftId: -9, name: 'Ρεμπέτικο', parentId: null } })], 'regions');
    expect(out).toHaveLength(2);
  });
});

describe('taxonomyInUseMessage', () => {
  it('returns the in-use message when a song references the value on its axis', () => {
    expect(taxonomyInUseMessage('rhythms', 1, [{ axisType: 'rhythm', refId: 1 }])).toBe(
      'Ο ρυθμός χρησιμοποιείται από τραγούδι'
    );
  });
  it('returns null when no song uses the value', () => {
    expect(taxonomyInUseMessage('rhythms', 2, [{ axisType: 'rhythm', refId: 1 }])).toBeNull();
  });
  it('matches the axis, not just the id: a region with the same id is not a rhythm use', () => {
    expect(taxonomyInUseMessage('rhythms', 1, [{ axisType: 'region', refId: 1 }])).toBeNull();
  });
  it('uses the entity-specific message', () => {
    expect(taxonomyInUseMessage('dromoi', 3, [{ axisType: 'dromos', refId: 3 }])).toBe('Ο δρόμος χρησιμοποιείται από τραγούδι');
    expect(taxonomyInUseMessage('regions', 3, [{ axisType: 'region', refId: 3 }])).toBe('Η περιοχή χρησιμοποιείται από τραγούδι');
  });
  it('ignores year-only axis values (no refId)', () => {
    expect(taxonomyInUseMessage('rhythms', 1, [{ axisType: 'year', refId: null }])).toBeNull();
  });
});
