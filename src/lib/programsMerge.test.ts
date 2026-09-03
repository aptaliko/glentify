import { describe, it, expect } from 'vitest';
import { mergeProgramsWithPending } from './programsMerge';
import type { QueuedAction } from './syncQueue';

function makeAction(overrides: Partial<QueuedAction>): QueuedAction {
  return {
    id: 'test-id',
    type: 'program-create',
    payload: {},
    attempts: 0,
    needsAttention: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeProgramsWithPending', () => {
  const base = [
    { id: 1, title: 'Πρόγραμμα Α', role: 'creator' as const, sharedWithEmails: [] },
    { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator' as const, sharedWithEmails: ['a@example.com'] },
  ];

  it('returns the base list unchanged when there are no queued actions', () => {
    expect(mergeProgramsWithPending(base, [])).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
    ]);
  });

  it('appends a pending create', () => {
    const actions = [makeAction({ type: 'program-create', payload: { title: 'Νέο Πρόγραμμα' } })];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
      { id: null, title: 'Νέο Πρόγραμμα', role: 'creator', sharedWithEmails: [], status: 'pending-create' },
    ]);
  });

  it('overlays a pending rename onto the existing row', () => {
    const actions = [
      makeAction({ type: 'program-rename', payload: { programId: 1, title: 'Νέος Τίτλος' } }),
    ];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Νέος Τίτλος', role: 'creator', sharedWithEmails: [], status: 'renamed' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
    ]);
  });

  it('hides a row with a pending delete', () => {
    const actions = [makeAction({ type: 'program-delete', payload: { programId: 2 } })];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
    ]);
  });

  it('marks a permanently-failed create as needs-attention-create', () => {
    const actions = [
      makeAction({
        type: 'program-create',
        payload: { title: 'Αποτυχημένο' },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
      { id: null, title: 'Αποτυχημένο', role: 'creator', sharedWithEmails: [], status: 'needs-attention-create' },
    ]);
  });

  it('reverts a permanently-failed rename to the original title', () => {
    const actions = [
      makeAction({
        type: 'program-rename',
        payload: { programId: 1, title: 'Νέος Τίτλος' },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'needs-attention-rename' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
    ]);
  });

  it('marks a conflict rename distinctly from a plain failed rename', () => {
    const conflictBase = [{ id: 1, title: 'Βάση', role: 'creator' as const, sharedWithEmails: [] }];
    const out = mergeProgramsWithPending(conflictBase, [
      makeAction({ type: 'program-rename', payload: { programId: 1, title: 'Νέο' }, needsAttention: true, needsAttentionReason: 'conflict' }),
    ]);
    expect(out[0].status).toBe('conflict-rename');
    expect(out[0].title).toBe('Βάση');
  });

  it('re-shows a permanently-failed delete as a normal active row', () => {
    const actions = [
      makeAction({
        type: 'program-delete',
        payload: { programId: 2 },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
    ]);
  });

  it('ignores queued actions of unrelated types', () => {
    const actions = [
      makeAction({ type: 'session-save', payload: { destination: 'new', title: 'x', sequences: [] } }),
      makeAction({ type: 'program-add-collaborator', payload: { programId: 1, email: 'x@example.com' } }),
    ];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
    ]);
  });

  it('skips a malformed payload instead of throwing', () => {
    const actions = [
      makeAction({ type: 'program-rename', payload: null }),
      makeAction({ type: 'program-delete', payload: 'not-an-object' }),
      makeAction({ type: 'program-create', payload: { title: 42 } }),
    ];
    expect(mergeProgramsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Πρόγραμμα Α', role: 'creator', sharedWithEmails: [], status: 'active' },
      { id: 2, title: 'Πρόγραμμα Β', role: 'collaborator', sharedWithEmails: ['a@example.com'], status: 'active' },
    ]);
  });
});
