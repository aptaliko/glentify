import { describe, it, expect } from 'vitest';
import { mergeSongsWithPending, resolveSongForEdit } from './songsMerge';
import type { QueuedAction } from './syncQueue';
import type { CachedSong } from './referenceData';
import type { AxisValueEntry } from './axisEditorData';

function makeAction(overrides: Partial<QueuedAction>): QueuedAction {
  return {
    id: 'test-id',
    type: 'song-create',
    payload: {},
    attempts: 0,
    needsAttention: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const emptySongFields = { imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: [] as AxisValueEntry[] };

describe('mergeSongsWithPending', () => {
  const base: CachedSong[] = [
    { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', imageUrl: null, notes: null, maleKey: null, femaleKey: null },
    { id: 2, title: 'Τραγούδι Β', lyrics: null, imageUrl: null, notes: null, maleKey: null, femaleKey: null },
  ];

  it('returns the base list unchanged when there are no queued actions', () => {
    expect(mergeSongsWithPending(base, [])).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });

  it('appends a pending create', () => {
    const actions = [makeAction({ type: 'song-create', payload: { title: 'Νέο Τραγούδι', lyrics: null, ...emptySongFields } })];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
      { id: null, title: 'Νέο Τραγούδι', lyrics: null, status: 'pending-create' },
    ]);
  });

  it('overlays a pending edit onto the existing row', () => {
    const actions = [
      makeAction({ type: 'song-update', payload: { songId: 1, title: 'Νέος Τίτλος', lyrics: 'Νέοι στίχοι', ...emptySongFields } }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Νέος Τίτλος', lyrics: 'Νέοι στίχοι', status: 'edited' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });

  it('hides a row with a pending delete', () => {
    const actions = [makeAction({ type: 'song-delete', payload: { songId: 2 } })];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
    ]);
  });

  it('marks a permanently-failed create as needs-attention-create', () => {
    const actions = [
      makeAction({
        type: 'song-create',
        payload: { title: 'Αποτυχημένο', lyrics: null, ...emptySongFields },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
      { id: null, title: 'Αποτυχημένο', lyrics: null, status: 'needs-attention-create' },
    ]);
  });

  it('reverts a permanently-failed edit to the original fields', () => {
    const actions = [
      makeAction({
        type: 'song-update',
        payload: { songId: 1, title: 'Απορριφθέν', lyrics: 'x', ...emptySongFields },
        needsAttention: true,
        attempts: 3,
      }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'needs-attention-edit' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });

  it('re-shows a permanently-failed delete as a normal active row', () => {
    const actions = [
      makeAction({ type: 'song-delete', payload: { songId: 2 }, needsAttention: true, attempts: 3 }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });

  it('ignores queued actions of unrelated types', () => {
    const actions = [
      makeAction({ type: 'program-create', payload: { title: 'x' } }),
      makeAction({ type: 'session-save', payload: { destination: 'new', title: 'x', sequences: [] } }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });

  it('skips a malformed payload instead of throwing', () => {
    const actions = [
      makeAction({ type: 'song-update', payload: null }),
      makeAction({ type: 'song-delete', payload: 'not-an-object' }),
      makeAction({ type: 'song-create', payload: { title: 42 } }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Τραγούδι Α', lyrics: 'Στίχοι Α', status: 'active' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });

  it('when the same song has two queued edits, the later one in queue order wins', () => {
    const actions = [
      makeAction({ type: 'song-update', payload: { songId: 1, title: 'Πρώτη επεξεργασία', lyrics: 'Πρώτοι στίχοι', ...emptySongFields } }),
      makeAction({ type: 'song-update', payload: { songId: 1, title: 'Δεύτερη επεξεργασία', lyrics: 'Δεύτεροι στίχοι', ...emptySongFields } }),
    ];
    expect(mergeSongsWithPending(base, actions)).toEqual([
      { id: 1, title: 'Δεύτερη επεξεργασία', lyrics: 'Δεύτεροι στίχοι', status: 'edited' },
      { id: 2, title: 'Τραγούδι Β', lyrics: null, status: 'active' },
    ]);
  });
});

describe('resolveSongForEdit', () => {
  const base: CachedSong = {
    id: 1,
    title: 'Τραγούδι Α',
    lyrics: 'Στίχοι Α',
    imageUrl: 'https://example.com/a.png',
    notes: 'Σημείωση',
    maleKey: 'Ρε',
    femaleKey: 'Λα',
  };
  const baseAxisValues: AxisValueEntry[] = [{ axisType: 'genre', refId: 5, yearValue: null }];

  it('returns the base row and its axis values when there is no pending edit', () => {
    expect(resolveSongForEdit(1, base, baseAxisValues, [])).toEqual({
      song: {
        title: 'Τραγούδι Α',
        lyrics: 'Στίχοι Α',
        imageUrl: 'https://example.com/a.png',
        notes: 'Σημείωση',
        maleKey: 'Ρε',
        femaleKey: 'Λα',
        axisValues: baseAxisValues,
      },
      hasPendingEdit: false,
    });
  });

  it('overlays a pending edit', () => {
    const newAxisValues: AxisValueEntry[] = [{ axisType: 'year', refId: null, yearValue: 1990 }];
    const actions = [
      makeAction({
        type: 'song-update',
        payload: { songId: 1, title: 'Νέος Τίτλος', lyrics: 'Νέοι στίχοι', imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: newAxisValues },
      }),
    ];
    expect(resolveSongForEdit(1, base, baseAxisValues, actions)).toEqual({
      song: { title: 'Νέος Τίτλος', lyrics: 'Νέοι στίχοι', imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: newAxisValues },
      hasPendingEdit: true,
    });
  });

  it('falls back to the base fields when the only pending edit needs attention', () => {
    const actions = [
      makeAction({
        type: 'song-update',
        payload: { songId: 1, title: 'Απορριφθέν', lyrics: 'x', imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: [] },
        needsAttention: true,
      }),
    ];
    expect(resolveSongForEdit(1, base, baseAxisValues, actions)).toEqual({
      song: {
        title: 'Τραγούδι Α',
        lyrics: 'Στίχοι Α',
        imageUrl: 'https://example.com/a.png',
        notes: 'Σημείωση',
        maleKey: 'Ρε',
        femaleKey: 'Λα',
        axisValues: baseAxisValues,
      },
      hasPendingEdit: false,
    });
  });

  it('returns a null song when there is no base row and no pending edit', () => {
    expect(resolveSongForEdit(99, null, [], [])).toEqual({ song: null, hasPendingEdit: false });
  });

  it('when the same song has two queued edits, the later one in queue order wins', () => {
    const firstAxisValues: AxisValueEntry[] = [{ axisType: 'genre', refId: 1, yearValue: null }];
    const secondAxisValues: AxisValueEntry[] = [{ axisType: 'year', refId: null, yearValue: 1995 }];
    const actions = [
      makeAction({
        type: 'song-update',
        payload: { songId: 1, title: 'Πρώτη επεξεργασία', lyrics: 'Πρώτοι στίχοι', imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: firstAxisValues },
      }),
      makeAction({
        type: 'song-update',
        payload: { songId: 1, title: 'Δεύτερη επεξεργασία', lyrics: 'Δεύτεροι στίχοι', imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: secondAxisValues },
      }),
    ];
    expect(resolveSongForEdit(1, base, baseAxisValues, actions)).toEqual({
      song: { title: 'Δεύτερη επεξεργασία', lyrics: 'Δεύτεροι στίχοι', imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: secondAxisValues },
      hasPendingEdit: true,
    });
  });
});
