import { describe, it, expect } from 'vitest';
import { mergeSequencesWithPending } from './sequencesMerge';
import type { CachedProgramDetail } from './referenceData';
import type { QueuedAction } from './syncQueue';

function action(overrides: Partial<QueuedAction>): QueuedAction {
  return { id: 'x', type: 'sequence-create', payload: {}, attempts: 0, needsAttention: false, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}
const titles = new Map<number, string>([[10, 'Α'], [11, 'Β'], [12, 'Γ']]);
const detail: CachedProgramDetail = {
  programId: 1, title: 'Πρόγραμμα', role: 'creator', cachedAt: '2026-01-01T00:00:00.000Z',
  sequences: [{ id: 5, title: 'Σειρά 1', position: 0, songs: [
    { sequenceSongId: 100, songId: 10, title: 'Α' },
    { sequenceSongId: 101, songId: 11, title: 'Β' },
  ] }],
};

describe('mergeSequencesWithPending', () => {
  it('appends a pending-create sequence for this program', () => {
    const out = mergeSequencesWithPending(detail, [action({ type: 'sequence-create', payload: { draftId: -5, programId: 1, title: 'Νέα' } })], titles);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: -5, title: 'Νέα', status: 'pending-create', songs: [] });
  });
  it('renames (last write wins)', () => {
    const out = mergeSequencesWithPending(detail, [
      action({ id: 'a', type: 'sequence-rename', payload: { sequenceId: 5, title: 'Πρώτη' } }),
      action({ id: 'b', type: 'sequence-rename', payload: { sequenceId: 5, title: 'Τελική' } }),
    ], titles);
    expect(out[0].title).toBe('Τελική');
  });
  it('deletes a sequence', () => {
    const out = mergeSequencesWithPending(detail, [action({ type: 'sequence-delete', payload: { sequenceId: 5 } })], titles);
    expect(out).toHaveLength(0);
  });
  it('nets a created-then-deleted draft sequence to absent', () => {
    const out = mergeSequencesWithPending(detail, [
      action({ id: 'a', type: 'sequence-create', payload: { draftId: -5, programId: 1, title: 'Νέα' } }),
      action({ id: 'b', type: 'sequence-delete', payload: { sequenceId: -5 } }),
    ], titles);
    expect(out.map((s) => s.id)).toEqual([5]);
  });
  it('adds a song with looked-up title, and removes one', () => {
    const out = mergeSequencesWithPending(detail, [
      action({ id: 'a', type: 'sequence-add-song', payload: { draftId: -9, sequenceId: 5, songId: 12 } }),
      action({ id: 'b', type: 'sequence-remove-song', payload: { sequenceSongId: 100 } }),
    ], titles);
    expect(out[0].songs.map((s) => s.title)).toEqual(['Β', 'Γ']);
    expect(out[0].songs.find((s) => s.sequenceSongId === -9)?.title).toBe('Γ');
  });
  it('reorders by orderedIds (last wins)', () => {
    const out = mergeSequencesWithPending(detail, [action({ type: 'sequence-reorder', payload: { sequenceId: 5, orderedIds: [101, 100] } })], titles);
    expect(out[0].songs.map((s) => s.sequenceSongId)).toEqual([101, 100]);
  });
});
