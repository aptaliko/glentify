import { describe, it, expect } from 'vitest';
import { mergeCollaboratorsWithPending } from './collaboratorsMerge';
import type { QueuedAction } from './syncQueue';

function makeAction(overrides: Partial<QueuedAction>): QueuedAction {
  return {
    id: 'test-id',
    type: 'program-add-collaborator',
    payload: {},
    attempts: 0,
    needsAttention: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeCollaboratorsWithPending', () => {
  const base = [
    { id: 1, email: 'a@example.com' },
    { id: 2, email: 'b@example.com' },
  ];

  it('returns the base list unchanged when there are no queued actions', () => {
    expect(mergeCollaboratorsWithPending(base, [], 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
      { id: 2, email: 'b@example.com', status: 'active' },
    ]);
  });

  it('appends a pending add', () => {
    const actions = [
      makeAction({ type: 'program-add-collaborator', payload: { programId: 100, email: 'new@example.com' } }),
    ];
    expect(mergeCollaboratorsWithPending(base, actions, 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
      { id: 2, email: 'b@example.com', status: 'active' },
      { id: null, email: 'new@example.com', status: 'pending-add' },
    ]);
  });

  it('hides a collaborator with a pending remove', () => {
    const actions = [
      makeAction({ type: 'program-remove-collaborator', payload: { programId: 100, userId: 2 } }),
    ];
    expect(mergeCollaboratorsWithPending(base, actions, 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
    ]);
  });

  it('marks a permanently-failed add as needs-attention-add', () => {
    const actions = [
      makeAction({
        type: 'program-add-collaborator',
        payload: { programId: 100, email: 'bad@example.com' },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeCollaboratorsWithPending(base, actions, 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
      { id: 2, email: 'b@example.com', status: 'active' },
      { id: null, email: 'bad@example.com', status: 'needs-attention-add' },
    ]);
  });

  it('re-shows a permanently-failed remove as needs-attention-remove', () => {
    const actions = [
      makeAction({
        type: 'program-remove-collaborator',
        payload: { programId: 100, userId: 2 },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeCollaboratorsWithPending(base, actions, 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
      { id: 2, email: 'b@example.com', status: 'needs-attention-remove' },
    ]);
  });

  it('ignores actions belonging to a different program', () => {
    const actions = [
      makeAction({ type: 'program-add-collaborator', payload: { programId: 999, email: 'other@example.com' } }),
      makeAction({ type: 'program-remove-collaborator', payload: { programId: 999, userId: 1 } }),
    ];
    expect(mergeCollaboratorsWithPending(base, actions, 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
      { id: 2, email: 'b@example.com', status: 'active' },
    ]);
  });

  it('ignores queued actions of unrelated types', () => {
    const actions = [
      makeAction({ type: 'session-save', payload: { destination: 'new', title: 'x', sequences: [] } }),
    ];
    expect(mergeCollaboratorsWithPending(base, actions, 100)).toEqual([
      { id: 1, email: 'a@example.com', status: 'active' },
      { id: 2, email: 'b@example.com', status: 'active' },
    ]);
  });
});
