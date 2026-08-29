# Offline Sync Foundation + Offline Session Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic offline write-queue (enqueue now, auto-sync when connectivity returns) and wire it to the first real consumer: ending a γλέντι natively now offers to save it as a program, fully offline, with the exact same σειρά-preserving quality as the already-shipped web flow.

**Architecture:** A storage-agnostic queue engine (`src/lib/syncQueue.ts`) with an injectable `QueueStorage` interface, backed by a dedicated IndexedDB database in production and an in-memory fake in tests — mirrors this codebase's existing `KeyValueStore` injection pattern. A `SyncQueueProvider` mounted once in the root layout listens for reconnection (`@capacitor/network`) and drives processing; features register a handler per action `type` without the engine knowing anything about them. `LocalSessionStore` gains the same σειρά (sequence) tracking the server already has, and a new session-agnostic `POST /api/programs/save-sequences` endpoint (replacing the session-tied `save-as-program`) lets both an offline-queued save and the existing web flow share one code path.

**Tech Stack:** Next.js 16 App Router, React 19, IndexedDB, `@capacitor/network` (new), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md`

## Global Constraints

- The queue engine has zero knowledge of what it's syncing — it only knows `type` strings and calls whichever handler registered for that type. Every current and future action type is registered in one place, `src/lib/syncHandlers.ts`'s `initSyncHandlers()`.
- Storage is a single JSON array (not per-item rows) in a **dedicated** IndexedDB database (`glentify-sync-queue`, its own DB, NOT reusing `offlineCache.ts`'s `glentify-offline` database) — this is a deliberate plan-level deviation from the spec's suggestion to share a database: two independent files coordinating IndexedDB version upgrades on one shared database is a real risk to `offlineCache.ts`'s already-critical reference-data cache, and a second dedicated database has no such risk. Functionally equivalent, safer.
- Failure classification: a response the server actually returned and rejected (`400`/`403`/`404`, but NOT `401`) is `item-error` — warn, requeue to the back, retry up to 3 attempts total before flagging `needsAttention` and no longer auto-retrying it. No response at all (network failure) or `401`/`5xx` is `systemic-error` — stop processing entirely for this run, don't touch anything else in the queue, retried whole on the next trigger.
- `processQueue()` gives every eligible item **at most one attempt per call** — never loop back and retry a just-requeued item within the same invocation. "Try later" means the next reconnect event, not immediately.
- Background sync must never trigger `nativeApiFetch`'s existing auto-redirect-to-`/login` on a `401` — that behavior stays for foreground callers, but a silent background sync jarring the user with an unannounced navigation is exactly the case the systemic-error/badge path exists to avoid instead.
- This codebase's testing convention: Vitest coverage only for pure logic in `src/lib/*` with no I/O; zero coverage for `src/db/queries/*`, `src/app/api/*`, IndexedDB-touching code, or page-level UI.
- Two new native-native routes get the same platform-exclusion treatment as every other `*/local/*` page: nothing here touches `scripts/build-mobile.sh` since it already strips `src/app/api` wholesale and this plan adds no new `src/app/programs/[id]`/`session/[id]`-style dynamic web-only route.
- Greek user-facing strings throughout, matching existing style.

---

### Task 1: Sync queue engine (pure, TDD)

**Files:**
- Create: `src/lib/syncQueue.ts`
- Test: `src/lib/syncQueue.test.ts`

**Interfaces:**
- Produces: `QueuedAction<TPayload>`, `SyncOutcome`, `SyncHandler`, `QueueStorage`, `ProcessResult` types; `enqueueTo(storage, type, payload)`, `processQueueWith(storage, handlers)` — pure functions used directly by this task's tests and by Task 2's convenience wrappers (defined in this same file, added in Task 2's step). `registerHandler(type, handler)`, `enqueue(type, payload)`, `processQueue()` — convenience wrappers bound to the real storage, added in Task 2 once that storage exists; **do not** implement them in this task, `Task 1` intentionally leaves them out.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/syncQueue.test.ts
import { describe, it, expect, vi } from 'vitest';
import { enqueueTo, processQueueWith } from './syncQueue';
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/syncQueue.test.ts`
Expected: FAIL — `Cannot find module './syncQueue'`.

- [ ] **Step 3: Implement the engine**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/syncQueue.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncQueue.ts src/lib/syncQueue.test.ts
git commit -m "Add generic offline sync-queue engine (pure, storage-injected)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 2: Real IndexedDB storage + default-bound convenience functions

**Files:**
- Create: `src/lib/syncQueueStorage.ts`
- Modify: `src/lib/syncQueue.ts` (append convenience wrappers)

**Interfaces:**
- Consumes: `QueuedAction`, `QueueStorage` (Task 1, imported as types only — avoids a runtime circular dependency between this file and `syncQueue.ts`).
- Produces: `indexedDbQueueStorage: QueueStorage` (this file); `registerHandler(type, handler)`, `enqueue(type, payload)`, `processQueue()` (appended to `syncQueue.ts`) — used by Task 4 (`syncHandlers.ts`), Task 6 (`SyncQueueProvider`), and Task 7 (the native save page).

No test for this task — IndexedDB isn't available in this codebase's Vitest environment (matches `offlineCache.ts`, also untested for the same reason).

- [ ] **Step 1: Write the IndexedDB-backed storage**

```ts
// src/lib/syncQueueStorage.ts
import type { QueuedAction, QueueStorage } from './syncQueue';

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database — two independent modules coordinating IndexedDB version upgrades on one
// shared database is a real risk to the reference-data cache that database already
// critically holds; a second, small, single-purpose database avoids that risk entirely.
const DB_NAME = 'glentify-sync-queue';
const DB_VERSION = 1;
const STORE_NAME = 'queue';
const QUEUE_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const indexedDbQueueStorage: QueueStorage = {
  async get(): Promise<QueuedAction[]> {
    const db = await openDb();
    const result = await new Promise<QueuedAction[] | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(QUEUE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result ?? [];
  },

  async set(actions: QueuedAction[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(actions, QUEUE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};
```

- [ ] **Step 2: Append the convenience wrappers to `syncQueue.ts`**

Add to the end of `src/lib/syncQueue.ts` (the file Task 1 already created — this appends, it does not replace anything already there):

```ts
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
```

Also add the import line (`import { indexedDbQueueStorage } from './syncQueueStorage';`) to the top of `src/lib/syncQueue.ts`, alongside its existing (type-only, from Task 1's own file — there are none yet, this is the first import the file gains).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If a circular-import error appears, confirm `syncQueueStorage.ts` uses `import type { QueuedAction, QueueStorage } from './syncQueue'` — a type-only import, not a value import — which TypeScript erases at compile time and never actually executes as a runtime circular dependency.)

- [ ] **Step 4: Run the full existing test suite**

Run: `npx vitest run src/lib/syncQueue.test.ts`
Expected: still PASS, 8/8 — confirms the new imports/exports didn't break the pure functions Task 1 tested.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncQueue.ts src/lib/syncQueueStorage.ts
git commit -m "Add IndexedDB-backed sync queue storage and default-bound convenience functions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 3: LocalSessionStore sequence tracking + last-ended-session capture (TDD)

**Files:**
- Modify: `src/lib/sessionStore.ts`
- Modify: `src/lib/sessionStore.test.ts` (extend — do not remove any existing test)

**Interfaces:**
- Consumes: `groupBySequenceIndex` (`src/lib/sessionGrouping.ts`, existing, unchanged — the exact same generic pure function `<T extends { sequenceIndex: number }>(rows: T[]): T[][]` the server-side grouping already uses).
- Produces: `getLastEndedSession(storage): Promise<{ sequences: { songIds: number[] }[] } | null>`, `clearLastEndedSession(storage): Promise<void>` — used by Task 7 (native save page). `LocalSessionStore`'s existing public interface (`load`, `pickSong`, `endSequence`, `endSession`, `start`) keeps its exact method signatures — only internal state shape and `endSession`'s behavior change.

- [ ] **Step 1: Write the new failing tests**

Add to the end of `src/lib/sessionStore.test.ts` (keep every existing `describe`/`it` block exactly as-is — this only adds new ones):

```ts
import { getLastEndedSession, clearLastEndedSession } from './sessionStore';

describe('LocalSessionStore sequence tracking', () => {
  it('stamps played songs with the current sequence index, incrementing on endSequence', async () => {
    const storage = inMemoryStore();
    const ref = referenceDataWithThreeSongs();
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.pickSong(2); // song 1 played at sequenceIndex 0
    await store.endSequence(); // song 2 played at sequenceIndex 0, index becomes 1
    await store.pickSong(3); // (no-op mark, current was null)
    await store.endSession(); // song 3 played at sequenceIndex 1

    const lastEnded = await getLastEndedSession(storage);
    expect(lastEnded).toEqual({
      sequences: [{ songIds: [1, 2] }, { songIds: [3] }],
    });
  });

  it('marks the final current song as played on endSession (a pre-existing gap this fixes)', async () => {
    const storage = inMemoryStore();
    const ref = referenceData();
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.endSession(); // song 1 was never explicitly "played" via pickSong/endSequence

    const lastEnded = await getLastEndedSession(storage);
    expect(lastEnded).toEqual({ sequences: [{ songIds: [1] }] });
  });

  it('still fully clears local session state on endSession (existing behavior preserved)', async () => {
    const storage = inMemoryStore();
    const ref = referenceDataWithThreeSongs();
    const store = await LocalSessionStore.start(1, ref, storage);
    await store.pickSong(2);
    await store.endSession();
    expect(await hasLocalSession(storage)).toBe(false);
  });
});

describe('getLastEndedSession / clearLastEndedSession', () => {
  it('is null before any session has ended', async () => {
    const storage = inMemoryStore();
    expect(await getLastEndedSession(storage)).toBeNull();
  });

  it('is a non-destructive read — calling it twice returns the same data', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();

    const first = await getLastEndedSession(storage);
    const second = await getLastEndedSession(storage);
    expect(first).toEqual(second);
    expect(first).not.toBeNull();
  });

  it('clearLastEndedSession removes it', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();
    await clearLastEndedSession(storage);
    expect(await getLastEndedSession(storage)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/sessionStore.test.ts`
Expected: FAIL — `getLastEndedSession`/`clearLastEndedSession` are not exported yet, and the sequence-grouping assertions don't match today's `endSession` (which discards everything with no last-ended-session data at all).

- [ ] **Step 3: Replace the full contents of `src/lib/sessionStore.ts`**

```ts
// src/lib/sessionStore.ts
import { buildSuggestionsResponse, type AxisValue, type SongWithAxes, type SuggestionsResponsePayload } from './suggestions';
import { groupBySequenceIndex } from './sessionGrouping';
import type { ReferenceData } from './referenceData';
import type { KeyValueStore } from './preferencesStore';

export interface SessionStore {
  load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload>;
  pickSong(songId: number): Promise<void>;
  endSequence(): Promise<void>;
  endSession(): Promise<void>;
}

export class RemoteSessionStore implements SessionStore {
  constructor(private sessionId: string) {}

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const searchParams = new URLSearchParams({ showPlayed: String(showPlayed) });
    if (activeAxisTypes !== null) searchParams.set('activeAxisTypes', activeAxisTypes.join(','));
    const res = await fetch(`/api/sessions/${this.sessionId}/suggestions?${searchParams.toString()}`);
    return res.json();
  }

  async pickSong(songId: number): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextSongId: songId }),
    });
  }

  async endSequence(): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/end-sequence`, { method: 'POST' });
  }

  async endSession(): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/end`, { method: 'POST' });
  }
}

interface PlayedEntry {
  songId: number;
  sequenceIndex: number;
}

interface LocalSessionState {
  currentSongId: number | null;
  currentSequenceIndex: number;
  playedEntries: PlayedEntry[];
}

export interface LastEndedSessionSequence {
  songIds: number[];
}

export interface LastEndedSession {
  sequences: LastEndedSessionSequence[];
}

const SESSION_STATE_KEY = 'glentify:local-session';
const LAST_ENDED_SESSION_KEY = 'glentify:local-session-last-ended';

export class LocalSessionStore implements SessionStore {
  constructor(private referenceData: ReferenceData, private storage: KeyValueStore) {}

  static async start(startingSongId: number, referenceData: ReferenceData, storage: KeyValueStore): Promise<LocalSessionStore> {
    const state: LocalSessionState = { currentSongId: startingSongId, currentSequenceIndex: 0, playedEntries: [] };
    await storage.set(SESSION_STATE_KEY, state);
    return new LocalSessionStore(referenceData, storage);
  }

  private async getState(): Promise<LocalSessionState> {
    return (
      (await this.storage.get<LocalSessionState>(SESSION_STATE_KEY)) ?? {
        currentSongId: null,
        currentSequenceIndex: 0,
        playedEntries: [],
      }
    );
  }

  private songsWithAxes(): SongWithAxes[] {
    const axisValuesBySong = new Map<number, AxisValue[]>();
    for (const av of this.referenceData.axisValues) {
      const list = axisValuesBySong.get(av.songId) ?? [];
      list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
      axisValuesBySong.set(av.songId, list);
    }
    return this.referenceData.songs.map((song) => ({ song, axisValues: axisValuesBySong.get(song.id) ?? [] }));
  }

  private markCurrentPlayed(state: LocalSessionState): PlayedEntry[] {
    if (state.currentSongId !== null && !state.playedEntries.some((e) => e.songId === state.currentSongId)) {
      return [...state.playedEntries, { songId: state.currentSongId, sequenceIndex: state.currentSequenceIndex }];
    }
    return state.playedEntries;
  }

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const state = await this.getState();
    const allSongs = this.songsWithAxes();
    const currentEntry = state.currentSongId !== null ? allSongs.find((s) => s.song.id === state.currentSongId) : undefined;

    return buildSuggestionsResponse({
      currentSongWithAxes: currentEntry
        ? {
            id: currentEntry.song.id,
            title: currentEntry.song.title,
            lyrics: currentEntry.song.lyrics,
            imageUrl: currentEntry.song.imageUrl,
            maleKey: currentEntry.song.maleKey,
            femaleKey: currentEntry.song.femaleKey,
            axisValues: currentEntry.axisValues,
          }
        : null,
      allSongs,
      playedSongIds: new Set(state.playedEntries.map((e) => e.songId)),
      showPlayed,
      requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null,
      lookups: {
        regions: this.referenceData.regions,
        rhythms: this.referenceData.rhythms,
        dromoi: this.referenceData.dromoi,
        composers: this.referenceData.composers,
        axisTypes: this.referenceData.axisTypes,
        genres: this.referenceData.genres,
      },
    });
  }

  async pickSong(songId: number): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, {
      currentSongId: songId,
      currentSequenceIndex: state.currentSequenceIndex,
      playedEntries: this.markCurrentPlayed(state),
    });
  }

  async endSequence(): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, {
      currentSongId: null,
      currentSequenceIndex: state.currentSequenceIndex + 1,
      playedEntries: this.markCurrentPlayed(state),
    });
  }

  async endSession(): Promise<void> {
    const state = await this.getState();
    const finalEntries = this.markCurrentPlayed(state);
    const groups = groupBySequenceIndex(finalEntries).map((group) => ({ songIds: group.map((e) => e.songId) }));
    await this.storage.set<LastEndedSession>(LAST_ENDED_SESSION_KEY, { sequences: groups });
    await this.storage.set<LocalSessionState>(SESSION_STATE_KEY, null);
  }
}

export async function getLastEndedSession(storage: KeyValueStore): Promise<LastEndedSession | null> {
  return storage.get<LastEndedSession>(LAST_ENDED_SESSION_KEY);
}

export async function clearLastEndedSession(storage: KeyValueStore): Promise<void> {
  await storage.set<LastEndedSession>(LAST_ENDED_SESSION_KEY, null);
}

export async function hasLocalSession(storage: KeyValueStore): Promise<boolean> {
  const state = await storage.get<LocalSessionState>(SESSION_STATE_KEY);
  return state !== null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/sessionStore.test.ts`
Expected: PASS, all existing tests (unchanged) plus the new ones from Step 1.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sessionStore.ts src/lib/sessionStore.test.ts
git commit -m "Track σειρά structure in LocalSessionStore, capture last-ended-session for offline save

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 4: `POST /api/programs/save-sequences` (replaces the session-tied save endpoint)

**Files:**
- Create: `src/app/api/programs/save-sequences/route.ts`
- Delete: `src/app/api/sessions/[id]/save-as-program/route.ts`

**Interfaces:**
- Consumes: `getSongById(ownerId, id)` (`src/db/queries/songs.ts`, existing, unchanged — signature `(ownerId: number, id: number): Promise<SongRow | undefined>`); `getProgramAccess`, `createProgramFromGroups`, `appendSequencesToProgram` (`src/db/queries/programs.ts`, existing, unchanged); `getUserId` (`src/lib/requestUser.ts`, unchanged).
- Produces: `POST /api/programs/save-sequences` → `{ programId: number }` on success (`201` for `new`, `200` for `existing`) — consumed by Task 5's sync handler and Task 8's updated web save page.

No test for this task — no API route in this codebase has test coverage.

- [ ] **Step 1: Delete the old route**

```bash
git rm "src/app/api/sessions/[id]/save-as-program/route.ts"
```

(Nothing else references this file — `GET /api/sessions/[id]/played-grouped/route.ts` is a separate, still-needed endpoint that isn't touched.)

- [ ] **Step 2: Write the new route**

```ts
// src/app/api/programs/save-sequences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSongById } from '@/db/queries/songs';
import { getProgramAccess, createProgramFromGroups, appendSequencesToProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const sequenceSchema = z.object({
  title: z.string().min(1),
  songIds: z.array(z.number().int()),
});

const schema = z.discriminatedUnion('destination', [
  z.object({ destination: z.literal('new'), title: z.string().min(1), sequences: z.array(sequenceSchema).min(1) }),
  z.object({ destination: z.literal('existing'), programId: z.number().int(), sequences: z.array(sequenceSchema).min(1) }),
]);

export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // The server has no session row to re-derive these song IDs from (unlike the old
  // save-as-program route) — they come straight from the client, so every one must be
  // verified to actually belong to the caller before anything is created.
  const allSongIds = parsed.data.sequences.flatMap((s) => s.songIds);
  for (const songId of allSongIds) {
    const song = await getSongById(userId, songId);
    if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 400 });
  }

  const groups = parsed.data.sequences;

  if (parsed.data.destination === 'new') {
    const program = await createProgramFromGroups(userId, parsed.data.title, groups);
    return NextResponse.json({ programId: program.id }, { status: 201 });
  }

  const role = await getProgramAccess(userId, parsed.data.programId);
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await appendSequencesToProgram(parsed.data.programId, groups);
  return NextResponse.json({ programId: parsed.data.programId });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/programs/save-sequences/route.ts"
git commit -m "Replace session-tied save-as-program route with session-agnostic save-sequences

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 5: `nativeApiFetch` opt-out of the 401 auto-redirect + the session-save sync handler

**Files:**
- Modify: `src/lib/nativeApiFetch.ts`
- Modify: `src/lib/nativeApiFetch.test.ts` (extend — do not remove any existing test)
- Create: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `registerHandler` (Task 2, `src/lib/syncQueue.ts`); `SyncOutcome` (Task 1, type); `nativeApiFetch` (this task, modified signature).
- Produces: `initSyncHandlers(): void` and `SessionSavePayload` type — used by Task 6 (`SyncQueueProvider`) and Task 7 (native save page, for the payload shape it constructs).

No test for `syncHandlers.ts`'s `handleSessionSaveSync`/`initSyncHandlers` — it's a thin fetch-and-classify wrapper with no branching logic worth isolating beyond what `nativeApiFetch.test.ts` already covers for the piece that actually has a decision to test (the redirect opt-out).

- [ ] **Step 1: Write the failing test for the redirect opt-out**

Add to the end of `src/lib/nativeApiFetch.test.ts` (keep every existing test as-is):

```ts
it('does not clear the token or redirect on a 401 when redirectOn401 is false, even natively', async () => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  const mockFetch = vi.fn().mockResolvedValue(new Response('{"error":"Unauthorized"}', { status: 401 }));
  global.fetch = mockFetch;
  const clearToken = vi.fn().mockResolvedValue(undefined);
  const location = { href: '' };
  vi.stubGlobal('window', { location });

  vi.doMock('./authToken', () => ({ getAuthToken: async () => 'stale-token', clearAuthToken: clearToken }));
  vi.doMock('./platform', () => ({ isNativeApp: () => true }));
  vi.resetModules();
  const { nativeApiFetch: freshNativeApiFetch } = await import('./nativeApiFetch');

  const res = await freshNativeApiFetch('/api/regions', undefined, undefined, { redirectOn401: false });

  expect(res.status).toBe(401);
  expect(clearToken).not.toHaveBeenCalled();
  expect(location.href).toBe('');

  vi.unstubAllGlobals();
  vi.doUnmock('./authToken');
  vi.doUnmock('./platform');
  vi.resetModules();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/nativeApiFetch.test.ts`
Expected: FAIL — `nativeApiFetch` doesn't accept a 4th argument yet, so the call compiles but the redirect still fires (existing behavior), failing the `clearToken`/`location.href` assertions.

- [ ] **Step 3: Add the opt-out to `nativeApiFetch`**

In `src/lib/nativeApiFetch.ts`, change the function signature and the 401 check:

```ts
export async function nativeApiFetch(
  path: string,
  init?: RequestInit,
  getToken: () => Promise<string | null> = getAuthToken,
  options?: { redirectOn401?: boolean }
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(apiUrl(path), { ...init, headers });
  const redirectOn401 = options?.redirectOn401 ?? true;
  if (response.status === 401 && isNativeApp() && redirectOn401) {
    await clearAuthToken();
    window.location.href = '/login';
  }
  return response;
}
```

Update the doc comment above the function to note the new parameter: add a sentence after the existing explanation — "A background caller that must not trigger an unannounced navigation (e.g. a silent sync-queue retry) passes `{ redirectOn401: false }`; the default (`true`) preserves today's behavior for every existing caller, none of which pass this option."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/nativeApiFetch.test.ts`
Expected: PASS, all 7 tests (6 existing + 1 new).

- [ ] **Step 5: Write the sync handler**

```ts
// src/lib/syncHandlers.ts
import { nativeApiFetch } from './nativeApiFetch';
import { registerHandler } from './syncQueue';
import type { SyncOutcome } from './syncQueue';

export type SessionSavePayload =
  | { destination: 'new'; title: string; sequences: { title: string; songIds: number[] }[] }
  | { destination: 'existing'; programId: number; sequences: { title: string; songIds: number[] }[] };

async function handleSessionSaveSync(payload: unknown): Promise<SyncOutcome> {
  const res = await nativeApiFetch(
    '/api/programs/save-sequences',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

// The single place every sync-queue action type gets registered. Called once per app
// load by SyncQueueProvider; the `initialized` guard makes a second call (e.g. from a
// React effect re-running) a harmless no-op instead of double-registering.
let initialized = false;

export function initSyncHandlers(): void {
  if (initialized) return;
  initialized = true;
  registerHandler('session-save', handleSessionSaveSync);
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/nativeApiFetch.ts src/lib/nativeApiFetch.test.ts src/lib/syncHandlers.ts
git commit -m "Add nativeApiFetch 401-redirect opt-out and the session-save sync handler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 6: `SyncQueueProvider` + `@capacitor/network`

**Files:**
- Modify: `package.json` (new dependency)
- Create: `src/components/SyncQueueProvider.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `initSyncHandlers` (Task 5); `processQueue`, `ProcessResult` (Task 2); `isNativeApp` (`src/lib/platform.ts`, unchanged).
- Produces: `useSyncQueue(): { pendingCount: number; needsAttentionCount: number; notifyQueueChanged: () => void }` — a React hook, used by Task 7 (native save page, calls `notifyQueueChanged()` after enqueueing).

No test for this task — page/component-level UI has zero automated coverage anywhere in this codebase, and this specifically touches a native-only plugin (`@capacitor/network`) unexercisable outside a device.

- [ ] **Step 1: Install the dependency**

Run: `npm install @capacitor/network`
Expected: `package.json` gains `@capacitor/network` under `"dependencies"` (same category as `@capacitor/filesystem`/`@capacitor/share` — it runs at runtime, not build tooling).

- [ ] **Step 2: Write the provider**

```tsx
// src/components/SyncQueueProvider.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Network } from '@capacitor/network';
import { isNativeApp } from '@/lib/platform';
import { processQueue } from '@/lib/syncQueue';
import { initSyncHandlers } from '@/lib/syncHandlers';

interface SyncQueueContextValue {
  pendingCount: number;
  needsAttentionCount: number;
  notifyQueueChanged: () => void;
}

const SyncQueueContext = createContext<SyncQueueContextValue>({
  pendingCount: 0,
  needsAttentionCount: 0,
  notifyQueueChanged: () => {},
});

export function useSyncQueue(): SyncQueueContextValue {
  return useContext(SyncQueueContext);
}

export default function SyncQueueProvider({ children }: { children: ReactNode }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [needsAttentionCount, setNeedsAttentionCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isNativeApp()) return;
    const result = await processQueue();
    setPendingCount(result.remaining);
    setNeedsAttentionCount(result.needsAttention);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    initSyncHandlers();
    refresh();
    const listenerPromise = Network.addListener('networkStatusChange', (status) => {
      if (status.connected) refresh();
    });
    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, [refresh]);

  return (
    <SyncQueueContext.Provider value={{ pendingCount, needsAttentionCount, notifyQueueChanged: refresh }}>
      {children}
      {isNativeApp() && pendingCount > 0 && (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-full px-3 py-1 text-sm shadow ${
            needsAttentionCount > 0 ? 'bg-error text-error-content' : 'bg-info text-info-content'
          }`}
        >
          {needsAttentionCount > 0 ? `${needsAttentionCount} χρειάζεται προσοχή` : `${pendingCount} εκκρεμεί συγχρονισμός`}
        </div>
      )}
    </SyncQueueContext.Provider>
  );
}
```

- [ ] **Step 3: Mount it from the root layout**

In `src/app/layout.tsx`, add the import:

```tsx
import SyncQueueProvider from "@/components/SyncQueueProvider";
```

And wrap the body's children:

```tsx
    <html
      lang="el"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SyncQueueProvider>{children}</SyncQueueProvider>
      </body>
    </html>
```

`RootLayout` itself stays a Server Component (no `'use client'` added to it) — it's rendering a Client Component as a child, which is allowed in the App Router; the `metadata` export is untouched.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/SyncQueueProvider.tsx src/app/layout.tsx
git commit -m "Add SyncQueueProvider: network-triggered sync + minimal pending-count badge

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 7: Native save page + `session/local/page.tsx` redirect

**Files:**
- Modify: `src/app/session/local/page.tsx`
- Create: `src/app/session/local/save/page.tsx`

**Interfaces:**
- Consumes: `getLastEndedSession`, `clearLastEndedSession` (Task 3); `enqueue` (Task 2); `useSyncQueue` (Task 6); `SessionSavePayload` (Task 5, for the shape enqueued — this task constructs the object literal directly, matching that type, without needing to import it since the shape is inline and self-evident, exactly as the equivalent web page already does).
- No new exports consumed by later tasks — this is the last functional piece.

No test for this task — page-level UI has zero automated coverage anywhere in this codebase (matches the equivalent web save page, also untested).

- [ ] **Step 1: Redirect to the new save page**

In `src/app/session/local/page.tsx`, change:

```tsx
      <LiveSessionView
        store={store}
        onEnded={() => router.push('/')}
        songPickerDataSource={createLocalSongPickerDataSource(referenceData)}
      />
```

to:

```tsx
      <LiveSessionView
        store={store}
        onEnded={() => router.push('/session/local/save')}
        songPickerDataSource={createLocalSongPickerDataSource(referenceData)}
      />
```

(`LiveSessionView` already calls `store.endSession()` before invoking `onEnded()` — for `LocalSessionStore` that's exactly the call that now captures the last-ended-session data from Task 3, before this navigation happens.)

- [ ] **Step 2: Write the save page**

```tsx
// src/app/session/local/save/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageNav from '@/components/PageNav';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getLastEndedSession, clearLastEndedSession } from '@/lib/sessionStore';
import { mergeReferencedSongs } from '@/lib/referenceData';
import { enqueue } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import type { OfflineProgram } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

interface SongEntry {
  id: number;
  title: string;
}

interface SequenceGroup {
  songs: SongEntry[];
}

type Destination = 'new' | 'existing';

function todayLabel(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function LocalSaveSessionPage() {
  const router = useRouter();
  const { notifyQueueChanged } = useSyncQueue();
  const [sequences, setSequences] = useState<SequenceGroup[] | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [destination, setDestination] = useState<Destination>('new');
  const [newTitle, setNewTitle] = useState('');
  const [programs, setPrograms] = useState<OfflineProgram[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getLastEndedSession(preferencesStore), loadReferenceData()]).then(([lastEnded, referenceData]) => {
      if (!lastEnded || lastEnded.sequences.length === 0 || !referenceData) {
        router.replace('/');
        return;
      }
      const songsById = new Map<number, SongRow>(
        mergeReferencedSongs(referenceData.songs, referenceData.sharedSongs).map((s) => [s.id, s])
      );
      const resolved: SequenceGroup[] = lastEnded.sequences.map((seq) => ({
        songs: seq.songIds
          .map((id) => songsById.get(id))
          .filter((s): s is SongRow => s !== undefined)
          .map((s) => ({ id: s.id, title: s.title })),
      }));
      setSequences(resolved);
      setTitles(resolved.map((_, i) => `Σειρά ${i + 1}`));
      setNewTitle(`Γλέντι ${todayLabel()}`);
      setPrograms(referenceData.programs);
    });
  }, [router]);

  useEffect(() => {
    if (!sequences) return;
    const today = todayLabel();
    setTitles(sequences.map((_, i) => (destination === 'existing' ? `${today} — Σειρά ${i + 1}` : `Σειρά ${i + 1}`)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination]);

  function updateTitle(index: number, value: string) {
    setTitles((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  async function handleSave() {
    if (!sequences) return;
    if (destination === 'existing' && selectedProgramId === null) return;
    const sequencePayload = sequences.map((seq, i) => ({ title: titles[i], songIds: seq.songs.map((s) => s.id) }));
    const payload =
      destination === 'new'
        ? { destination: 'new' as const, title: newTitle, sequences: sequencePayload }
        : { destination: 'existing' as const, programId: selectedProgramId as number, sequences: sequencePayload };
    try {
      await enqueue('session-save', payload);
      await clearLastEndedSession(preferencesStore);
      notifyQueueChanged();
      router.replace('/');
    } catch {
      setSaveError('Κάτι πήγε στραβά κατά την αποθήκευση.');
    }
  }

  async function handleSkip() {
    await clearLastEndedSession(preferencesStore);
    router.replace('/');
  }

  if (!sequences) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Αποθήκευση γλεντιού</h1>

      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-3">
          {sequences.map((seq, i) => (
            <div key={i} className="flex flex-col gap-1">
              <input
                className="input input-bordered input-sm w-full"
                value={titles[i] ?? ''}
                onChange={(e) => updateTitle(i, e.target.value)}
              />
              <p className="text-xs text-base-content/50">{seq.songs.map((s) => s.title).join(' · ')}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-3">
          <div className="flex gap-2">
            <button
              className={`btn btn-sm flex-1 ${destination === 'new' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDestination('new')}
            >
              Νέο Σταθερό Πρόγραμμα
            </button>
            <button
              className={`btn btn-sm flex-1 ${destination === 'existing' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDestination('existing')}
            >
              Πρόσθεση σε υπάρχον πρόγραμμα
            </button>
          </div>

          {destination === 'new' ? (
            <input className="input input-bordered w-full" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          ) : (
            <select
              className="select select-bordered w-full"
              value={selectedProgramId ?? ''}
              onChange={(e) => setSelectedProgramId(Number(e.target.value))}
            >
              <option value="" disabled>
                Διάλεξε πρόγραμμα
              </option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}

          {saveError && <p className="text-sm text-error">{saveError}</p>}

          <button
            className="btn btn-primary w-full"
            disabled={destination === 'existing' && selectedProgramId === null}
            onClick={handleSave}
          >
            Αποθήκευση (θα σταλεί μόλις υπάρξει σύνδεση)
          </button>
          <button className="btn btn-ghost w-full" onClick={handleSkip}>
            Παράλειψη
          </button>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/session/local/page.tsx" "src/app/session/local/save/page.tsx"
git commit -m "Add native offline session-save screen (queued, no network required)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 8: Update the web save page to the new endpoint

**Files:**
- Modify: `src/app/session/[id]/save/page.tsx`

**Interfaces:** None new — this task only changes which endpoint an already-existing page calls and what it sends.

- [ ] **Step 1: Update `handleSave`**

In `src/app/session/[id]/save/page.tsx`, change:

```tsx
    const body =
      destination === 'new'
        ? { destination: 'new' as const, title: newTitle, sequenceTitles: titles }
        : { destination: 'existing' as const, programId: selectedProgramId as number, sequenceTitles: titles };
    const res = await fetch(`/api/sessions/${params.id}/save-as-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
```

to:

```tsx
    const sequencePayload = sequences.map((seq, i) => ({ title: titles[i], songIds: seq.songs.map((s) => s.id) }));
    const body =
      destination === 'new'
        ? { destination: 'new' as const, title: newTitle, sequences: sequencePayload }
        : { destination: 'existing' as const, programId: selectedProgramId as number, sequences: sequencePayload };
    const res = await fetch('/api/programs/save-sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
```

Nothing else in the file changes — the `played-grouped` preview fetch, title inputs, destination toggle, and error handling all stay exactly as they are; `sequences` (the already-loaded `SequenceGroup[]` state, each with `songs: SongEntry[]` where `SongEntry` has `id`/`title`) already has everything `sequencePayload` needs.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/session/[id]/save/page.tsx"
git commit -m "Point the web save page at the new session-agnostic save-sequences endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 9: Full verification

**Files:** None — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the 8 new `syncQueue.test.ts` cases, the extended `sessionStore.test.ts` suite, and the extended `nativeApiFetch.test.ts` suite.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint 'src/**/*.{ts,tsx}'`
Expected: no errors in any file this plan touched (there may be pre-existing warnings elsewhere in the repo unrelated to this work — not this task's concern; scope the check to real source, not any stale local `.mobile-build/` build artifact directory, which isn't part of this codebase's actual source and is excluded from this check for exactly that reason).

- [ ] **Step 4: Web build**

Run: `npm run build`
Expected: succeeds. `/api/programs/save-sequences` appears in the route list; `/api/sessions/[id]/save-as-program` does **not** (confirms the deletion took effect, not just that a new route was added alongside it).

- [ ] **Step 5: Mobile build**

Run: `npm run build:mobile`
Expected: succeeds. `session/local/save` appears in the native route list; `@capacitor/network` shows up as a linked native Android plugin alongside `@capacitor/filesystem`/`@capacitor/preferences`/`@capacitor/share` in the `cap sync` output.

- [ ] **Step 6: Manual on-device verification (named gap, not blocking)**

No browser or Android device/emulator is assumed available during implementation. This is the plan's one named gap, flagged the same way past mobile-only work in this project has been: with the device in airplane mode, start a local session, play at least two songs across two `Τέλος σειράς` presses, end the session, confirm the save screen renders the correct σειρές entirely from cache (no network activity), save it, confirm the badge shows "1 εκκρεμεί συγχρονισμός." Re-enable connectivity, confirm the badge disappears automatically within moments (no manual action) and the resulting program/sequences are correct via the admin UI. Separately, confirm a *web* session's save flow still works end-to-end against the new `save-sequences` endpoint (this doesn't require a device, but does require a database — run it against the real dev environment).
