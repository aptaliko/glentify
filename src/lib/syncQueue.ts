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

    const outcome = await handler(action.payload);

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

export function registerHandler(type: string, handler: SyncHandler): void {
  handlerRegistry.set(type, handler);
}

export async function enqueue(type: string, payload: unknown): Promise<void> {
  return enqueueTo(indexedDbQueueStorage, type, payload);
}

export async function processQueue(): Promise<ProcessResult> {
  return processQueueWith(indexedDbQueueStorage, handlerRegistry);
}
