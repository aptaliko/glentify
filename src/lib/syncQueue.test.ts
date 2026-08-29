// src/lib/syncQueue.test.ts
import { describe, it, expect, vi } from 'vitest';
import { enqueueTo, processQueueWith, serialize } from './syncQueue';
import type { QueuedAction, QueueStorage, SyncHandler } from './syncQueue';

function inMemoryQueueStorage(): QueueStorage {
  let actions: QueuedAction[] = [];
  return {
    async get() {
      return actions;
    },
    async set(next) {
      actions = next;
    },
  };
}

describe('enqueueTo', () => {
  it('appends a new action with default attempts/needsAttention and a generated id', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'session-save', { title: 'Test' });
    const actions = await storage.get();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('session-save');
    expect(actions[0].payload).toEqual({ title: 'Test' });
    expect(actions[0].attempts).toBe(0);
    expect(actions[0].needsAttention).toBe(false);
    expect(typeof actions[0].id).toBe('string');
    expect(actions[0].id.length).toBeGreaterThan(0);
  });

  it('appends after existing actions, preserving order', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'a', 1);
    await enqueueTo(storage, 'b', 2);
    const actions = await storage.get();
    expect(actions.map((a) => a.type)).toEqual(['a', 'b']);
  });
});

describe('processQueueWith', () => {
  it('removes an action on success', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'session-save', { title: 'Test' });
    const handler: SyncHandler = vi.fn().mockResolvedValue('success');
    const handlers = new Map([['session-save', handler]]);

    const result = await processQueueWith(storage, handlers);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await storage.get()).toEqual([]);
    expect(result).toEqual({ processed: 1, remaining: 0, needsAttention: 0, blocked: false });
  });

  it('gives every eligible item at most one attempt per call, requeuing item-errors to the back', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'always-fails', 'A');
    await enqueueTo(storage, 'always-succeeds', 'B');
    const failHandler: SyncHandler = vi.fn().mockResolvedValue('item-error');
    const succeedHandler: SyncHandler = vi.fn().mockResolvedValue('success');
    const handlers = new Map<string, SyncHandler>([
      ['always-fails', failHandler],
      ['always-succeeds', succeedHandler],
    ]);

    const result = await processQueueWith(storage, handlers);

    // Each handler was called exactly once this pass — the requeued A was NOT retried
    // again within the same call.
    expect(failHandler).toHaveBeenCalledTimes(1);
    expect(succeedHandler).toHaveBeenCalledTimes(1);

    const remaining = await storage.get();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload).toBe('A');
    expect(remaining[0].attempts).toBe(1);
    expect(remaining[0].needsAttention).toBe(false);
    expect(result).toEqual({ processed: 1, remaining: 1, needsAttention: 0, blocked: false });
  });

  it('flags an item needsAttention after 3 failed attempts and stops auto-retrying it', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'always-fails', 'A');
    const handler: SyncHandler = vi.fn().mockResolvedValue('item-error');
    const handlers = new Map([['always-fails', handler]]);

    await processQueueWith(storage, handlers); // attempts: 1
    await processQueueWith(storage, handlers); // attempts: 2
    const thirdResult = await processQueueWith(storage, handlers); // attempts: 3 -> needsAttention

    expect(handler).toHaveBeenCalledTimes(3);
    const afterThird = await storage.get();
    expect(afterThird[0].attempts).toBe(3);
    expect(afterThird[0].needsAttention).toBe(true);
    expect(thirdResult.needsAttention).toBe(1);

    // A 4th call must not invoke the handler again — the item is skipped entirely.
    await processQueueWith(storage, handlers);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('stops processing entirely on a systemic-error, leaving the rest of the queue untouched', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'blocks', 'A');
    await enqueueTo(storage, 'never-reached', 'B');
    const blockingHandler: SyncHandler = vi.fn().mockResolvedValue('systemic-error');
    const neverCalledHandler: SyncHandler = vi.fn().mockResolvedValue('success');
    const handlers = new Map<string, SyncHandler>([
      ['blocks', blockingHandler],
      ['never-reached', neverCalledHandler],
    ]);

    const result = await processQueueWith(storage, handlers);

    expect(blockingHandler).toHaveBeenCalledTimes(1);
    expect(neverCalledHandler).not.toHaveBeenCalled();
    const remaining = await storage.get();
    expect(remaining).toHaveLength(2); // both items still present, neither mutated
    expect(remaining[0].attempts).toBe(0);
    expect(result).toEqual({ processed: 0, remaining: 2, needsAttention: 0, blocked: true });
  });

  it('leaves an item with no registered handler untouched and continues with the rest', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'unknown-type', 'A');
    await enqueueTo(storage, 'known-type', 'B');
    const knownHandler: SyncHandler = vi.fn().mockResolvedValue('success');
    const handlers = new Map<string, SyncHandler>([['known-type', knownHandler]]);

    const result = await processQueueWith(storage, handlers);

    expect(knownHandler).toHaveBeenCalledTimes(1);
    const remaining = await storage.get();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload).toBe('A');
    expect(result).toEqual({ processed: 1, remaining: 1, needsAttention: 0, blocked: false });
  });

  it('treats a handler that throws/rejects the same as an explicit systemic-error', async () => {
    const storage = inMemoryQueueStorage();
    await enqueueTo(storage, 'throws', 'A');
    await enqueueTo(storage, 'never-reached', 'B');
    const throwingHandler: SyncHandler = vi.fn().mockRejectedValue(new Error('network down'));
    const neverCalledHandler: SyncHandler = vi.fn().mockResolvedValue('success');
    const handlers = new Map<string, SyncHandler>([
      ['throws', throwingHandler],
      ['never-reached', neverCalledHandler],
    ]);

    const result = await processQueueWith(storage, handlers);

    expect(throwingHandler).toHaveBeenCalledTimes(1);
    expect(neverCalledHandler).not.toHaveBeenCalled();
    const remaining = await storage.get();
    expect(remaining).toHaveLength(2); // both items still present, neither mutated
    expect(remaining[0].attempts).toBe(0);
    expect(result).toEqual({ processed: 0, remaining: 2, needsAttention: 0, blocked: true });
  });
});

describe('serialize', () => {
  it('runs concurrent operations one at a time, in call order, never overlapping', async () => {
    const events: string[] = [];

    function op(name: string, delayMs: number) {
      return serialize(async () => {
        events.push(`${name}-start`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        events.push(`${name}-end`);
        return name;
      });
    }

    // Start both "concurrently" (no await between them) — without serialization, B would
    // start before A finishes, interleaving their start/end markers.
    const [resultA, resultB] = await Promise.all([op('A', 20), op('B', 5)]);

    expect(resultA).toBe('A');
    expect(resultB).toBe('B');
    // A must fully complete (both its start AND end) before B's start appears — proving
    // no interleaving occurred, regardless of each operation's own internal delay.
    expect(events).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });
});
