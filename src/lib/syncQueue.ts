// src/lib/syncQueue.ts

export interface QueuedAction<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  attempts: number;
  needsAttention: boolean;
  createdAt: string;
}

export type SyncOutcome = 'success' | 'item-error' | 'systemic-error';
export type SyncHandler = (payload: unknown) => Promise<SyncOutcome>;

export interface QueueStorage {
  get(): Promise<QueuedAction[]>;
  set(actions: QueuedAction[]): Promise<void>;
}

export interface ProcessResult {
  processed: number;
  remaining: number;
  needsAttention: number;
  blocked: boolean;
}

const MAX_ATTEMPTS = 3;

export async function enqueueTo(storage: QueueStorage, type: string, payload: unknown): Promise<void> {
  const actions = await storage.get();
  const newAction: QueuedAction = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    payload,
    attempts: 0,
    needsAttention: false,
    createdAt: new Date().toISOString(),
  };
  await storage.set([...actions, newAction]);
}

// Gives every eligible (non-needsAttention) item, in queue order as of the start of this
// call, at most one handler invocation — never loops back to retry a just-requeued item
// within the same call. "item-error" moves the item to the back of the queue for the NEXT
// call to pick up; "systemic-error" stops the whole pass immediately, leaving every
// remaining item (including the one that errored) exactly as it was.
export async function processQueueWith(storage: QueueStorage, handlers: Map<string, SyncHandler>): Promise<ProcessResult> {
  const snapshot = await storage.get();
  let current = snapshot;
  let processed = 0;
  const eligible = snapshot.filter((a) => !a.needsAttention);

  for (const action of eligible) {
    const handler = handlers.get(action.type);
    if (!handler) continue; // no handler registered (yet) — leave it, try again next call

    // A handler that throws or whose Promise rejects (most commonly: a real handler's
    // fetch() rejecting because the device is offline) is treated exactly like an explicit
    // 'systemic-error' return — from this loop's point of view, both mean "this handler
    // could not proceed," and both get the same stop-everything-untouched response. Without
    // this, a rejected fetch would propagate out of this function uncaught, defeating the
    // whole point of the systemic-error contract for the single most common real-world case
    // (no connectivity) this queue exists to handle.
    let outcome: SyncOutcome;
    try {
      outcome = await handler(action.payload);
    } catch {
      outcome = 'systemic-error';
    }

    if (outcome === 'success') {
      current = current.filter((a) => a.id !== action.id);
      await storage.set(current);
      processed += 1;
      continue;
    }

    if (outcome === 'systemic-error') {
      await storage.set(current);
      return {
        processed,
        remaining: current.length,
        needsAttention: current.filter((a) => a.needsAttention).length,
        blocked: true,
      };
    }

    // item-error: one more attempt spent, requeued to the back (or flagged, at the cap)
    const attempts = action.attempts + 1;
    const updated: QueuedAction = { ...action, attempts, needsAttention: attempts >= MAX_ATTEMPTS };
    current = [...current.filter((a) => a.id !== action.id), updated];
    await storage.set(current);
  }

  return {
    processed,
    remaining: current.length,
    needsAttention: current.filter((a) => a.needsAttention).length,
    blocked: false,
  };
}

import { indexedDbQueueStorage } from './syncQueueStorage';

const handlerRegistry = new Map<string, SyncHandler>();

// Serializes every call to enqueue()/processQueue() so overlapping triggers (app-mount,
// networkStatusChange, a page's manual notifyQueueChanged() after enqueueing) never race
// on the underlying IndexedDB read-modify-write cycle — each call waits for the previous
// one to fully finish (success or failure) before starting, in call order.
let queueOperationChain: Promise<unknown> = Promise.resolve();

export function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperationChain.then(operation, operation);
  queueOperationChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export function registerHandler(type: string, handler: SyncHandler): void {
  handlerRegistry.set(type, handler);
}

export async function enqueue(type: string, payload: unknown): Promise<void> {
  return serialize(() => enqueueTo(indexedDbQueueStorage, type, payload));
}

export async function processQueue(): Promise<ProcessResult> {
  return serialize(() => processQueueWith(indexedDbQueueStorage, handlerRegistry));
}
