# Offline Collaborator Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding/removing a program collaborator by email on the native admin edit page work offline — viewable from a cache, queued for later sync via the existing generic sync-queue engine, with real-time-online validation errors preserved exactly as they are today.

**Architecture:** A new dedicated IndexedDB cache stores the last-successfully-loaded collaborator list (+ role + current user) per program; a new pure function overlays the sync-queue's own pending items onto that cached/live list for rendering; two new handlers register with the existing `syncQueue.ts` engine (no changes to the engine itself beyond one read-only accessor); the admin edit page's add/remove handlers try the live call first and only enqueue on a genuine network failure.

**Tech Stack:** Next.js App Router (Capacitor/Android native build), IndexedDB, the existing `src/lib/syncQueue.ts` generic write-queue engine, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-offline-collaborator-invites-design.md`

## Global Constraints

- No changes to `src/lib/syncQueue.ts`'s core engine logic (`enqueueTo`, `processQueueWith`, `MAX_ATTEMPTS`, failure classification) — only one new read-only export, `getQueuedActions()`.
- Program title/sequence editing on `admin/local/programs/edit` stays online-only — out of scope (sub-project #6). The only new offline-degradation behavior there is a graceful notice instead of today's silent unhandled-rejection dead end.
- **Deviation from the spec, decided during planning:** the spec described the new collaborators cache as a second object store inside `offlineCache.ts`'s existing `glentify-offline` database. This plan instead gives it its **own dedicated database** (`glentify-collaborators-cache`), matching this codebase's own established precedent: `src/lib/syncQueueStorage.ts` explicitly chose a separate database from `offlineCache.ts` specifically to avoid "two independent modules coordinating IndexedDB version upgrades on one shared database" (see that file's own comment). The same reasoning applies here — this is a second, independent module, and a tiny dedicated database (matching `syncQueueStorage.ts`'s exact ~20-line pattern) costs nothing extra while removing any risk to the existing reference-data cache. `offlineCache.ts` is not touched by this plan at all.
- **Deviation from the spec, decided during planning:** the spec's sketch of `mergeCollaboratorsWithPending`'s `DisplayCollaborator.status` union included a `'pending-remove'` value that the described algorithm (pending removes are silently hidden, no row emitted) never actually produces. This plan drops it from the type — the real status values are `'active' | 'pending-add' | 'needs-attention-add' | 'needs-attention-remove'`.
- **Deviation from the spec, decided during planning:** the spec described `loadCollaborators` reading `role`/`currentUser` from React state to build its cache-write payload. Since `loadProgram` and `loadCurrentUser` both call `setState` and `loadCollaborators` would run in the same async tick (via `Promise.all` in one effect), reading state right after setting it inside that same tick would see the pre-update, stale closure value — a real bug, not a hypothetical one. This plan instead has `loadProgram` and `loadCurrentUser` **return** their fetched values, threaded explicitly into `loadCollaborators(id, role, currentUser)` as parameters, avoiding the stale-closure trap entirely.
- Testing convention (established throughout this project): pure logic in `src/lib/*` with no I/O gets full Vitest coverage; I/O-bound code (IndexedDB reads/writes, `fetch`-calling sync handlers, page components) gets none, verified instead by direct functional checks or the full build/typecheck/lint pass. Do not write a test for `collaboratorsCache.ts`, the two new sync handlers, or the page — this matches `offlineCache.ts`, `handleSessionSaveSync`, and every other page in this codebase, none of which have tests.
- Greek is the UI language throughout — copy any new user-facing string exactly as written in this plan.

---

### Task 1: Collaborators cache, pending-merge helper, and one read-only queue accessor

**Files:**
- Create: `src/lib/collaboratorsCache.ts`
- Create: `src/lib/collaboratorsMerge.ts`
- Test: `src/lib/collaboratorsMerge.test.ts`
- Modify: `src/lib/syncQueue.ts` (add one new export, no other changes)

**Interfaces:**
- Consumes: `QueuedAction` type from `src/lib/syncQueue.ts` (already exists: `{ id, type, payload, attempts, needsAttention, createdAt }`).
- Produces:
  - `CachedCollaborator { id: number; email: string }`, `CachedCollaboratorsData { programId: number; role: 'creator' | 'collaborator'; creator: CachedCollaborator | null; collaborators: CachedCollaborator[]; currentUser: CachedCollaborator; cachedAt: string }` from `collaboratorsCache.ts`.
  - `saveCollaboratorsCache(data: CachedCollaboratorsData): Promise<void>` and `loadCollaboratorsCache(programId: number): Promise<CachedCollaboratorsData | null>` from `collaboratorsCache.ts`.
  - `AddCollaboratorPayload { programId: number; email: string }`, `RemoveCollaboratorPayload { programId: number; userId: number }`, `DisplayCollaborator { id: number | null; email: string; status: 'active' | 'pending-add' | 'needs-attention-add' | 'needs-attention-remove' }` from `collaboratorsMerge.ts`.
  - `mergeCollaboratorsWithPending(base: { id: number; email: string }[], allQueuedActions: QueuedAction[], programId: number): DisplayCollaborator[]` from `collaboratorsMerge.ts` — used by Task 3.
  - `getQueuedActions(): Promise<QueuedAction[]>` from `syncQueue.ts` — used by Task 3.

- [ ] **Step 1: Create the dedicated IndexedDB cache module**

Create `src/lib/collaboratorsCache.ts`:

```ts
// src/lib/collaboratorsCache.ts

export interface CachedCollaborator {
  id: number;
  email: string;
}

export interface CachedCollaboratorsData {
  programId: number;
  role: 'creator' | 'collaborator';
  creator: CachedCollaborator | null;
  collaborators: CachedCollaborator[];
  currentUser: CachedCollaborator;
  cachedAt: string;
}

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database — same reasoning src/lib/syncQueueStorage.ts already established for its own
// database: two independent modules coordinating IndexedDB version upgrades on one shared
// database is a real risk to whatever that database already holds. A second, small,
// single-purpose database avoids that risk entirely.
const DB_NAME = 'glentify-collaborators-cache';
const DB_VERSION = 1;
const STORE_NAME = 'program-collaborators';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'programId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCollaboratorsCache(data: CachedCollaboratorsData): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadCollaboratorsCache(programId: number): Promise<CachedCollaboratorsData | null> {
  const db = await openDb();
  const result = await new Promise<CachedCollaboratorsData | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(programId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}
```

- [ ] **Step 2: Write the failing tests for the pending-merge helper**

Create `src/lib/collaboratorsMerge.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/collaboratorsMerge.test.ts`
Expected: FAIL — `Cannot find module './collaboratorsMerge'` (the file doesn't exist yet).

- [ ] **Step 4: Implement the pending-merge helper**

Create `src/lib/collaboratorsMerge.ts`:

```ts
// src/lib/collaboratorsMerge.ts
import type { QueuedAction } from './syncQueue';

export interface AddCollaboratorPayload {
  programId: number;
  email: string;
}

export interface RemoveCollaboratorPayload {
  programId: number;
  userId: number;
}

export interface DisplayCollaborator {
  id: number | null; // null for a pending add — no server-assigned id yet
  email: string;
  status: 'active' | 'pending-add' | 'needs-attention-add' | 'needs-attention-remove';
}

// Pure — no I/O. Takes the last-known base list (from state or cache) and the full
// sync-queue snapshot, filters to this program's add/remove actions, and produces the
// list to render: pending removes are dropped from the base list (optimistic hide, no
// row shown at all while merely pending); pending adds are appended; anything with
// needsAttention:true renders with a distinct status instead of being silently retried
// forever with no visible sign — a failed remove specifically re-appears (using its
// original base entry) so the user can see it didn't actually go through.
export function mergeCollaboratorsWithPending(
  base: { id: number; email: string }[],
  allQueuedActions: QueuedAction[],
  programId: number
): DisplayCollaborator[] {
  const removals = new Map<number, boolean>(); // userId -> needsAttention
  const adds: { email: string; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (action.type === 'program-remove-collaborator') {
      const payload = action.payload as RemoveCollaboratorPayload;
      if (payload.programId === programId) removals.set(payload.userId, action.needsAttention);
    } else if (action.type === 'program-add-collaborator') {
      const payload = action.payload as AddCollaboratorPayload;
      if (payload.programId === programId) adds.push({ email: payload.email, needsAttention: action.needsAttention });
    }
  }

  const result: DisplayCollaborator[] = base
    .filter((c) => !removals.has(c.id))
    .map((c) => ({ id: c.id, email: c.email, status: 'active' as const }));

  for (const [userId, needsAttention] of removals) {
    if (needsAttention) {
      const original = base.find((c) => c.id === userId);
      if (original) result.push({ id: original.id, email: original.email, status: 'needs-attention-remove' });
    }
    // else: pending, not yet flagged — stays optimistically hidden, no row shown
  }

  for (const add of adds) {
    result.push({ id: null, email: add.email, status: add.needsAttention ? 'needs-attention-add' : 'pending-add' });
  }

  return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/collaboratorsMerge.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Add the read-only queue accessor**

Modify `src/lib/syncQueue.ts` — add this export at the end of the file, immediately after `processQueue`:

```ts
// Read-only introspection for consumers that need to render pending/failed items
// (e.g. an offline collaborators list overlaying its program's own queued actions).
// A direct passthrough to storage — no new engine logic, no serialization needed
// since this never mutates the queue.
export async function getQueuedActions(): Promise<QueuedAction[]> {
  return indexedDbQueueStorage.get();
}
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all existing tests plus the 7 new ones pass (129 total).

- [ ] **Step 8: Commit**

```bash
git add src/lib/collaboratorsCache.ts src/lib/collaboratorsMerge.ts src/lib/collaboratorsMerge.test.ts src/lib/syncQueue.ts
git commit -m "Add offline collaborators cache and pending-merge helper"
```

---

### Task 2: Sync handlers for add/remove collaborator

**Files:**
- Modify: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `AddCollaboratorPayload`, `RemoveCollaboratorPayload` from `src/lib/collaboratorsMerge.ts` (Task 1); `registerHandler`, `SyncOutcome` from `src/lib/syncQueue.ts` (already imported in this file); `nativeApiFetch` (already imported in this file).
- Produces: two new registered handler types, `'program-add-collaborator'` and `'program-remove-collaborator'` — used by Task 3's `enqueue()` calls.

- [ ] **Step 1: Add the two handlers and register them**

Modify `src/lib/syncHandlers.ts` — add the import, the two handler functions, and the two registrations:

```ts
// src/lib/syncHandlers.ts
import { nativeApiFetch } from './nativeApiFetch';
import { registerHandler } from './syncQueue';
import type { SyncOutcome } from './syncQueue';
import type { AddCollaboratorPayload, RemoveCollaboratorPayload } from './collaboratorsMerge';

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

async function handleAddCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, email } = payload as AddCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${programId}/collaborators`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already a collaborator by the time this synced (added by someone else, or by the
  // same offline actor twice) — the intent was already satisfied, nothing to retry.
  if (res.status === 409) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRemoveCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, userId } = payload as RemoveCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${programId}/collaborators/${userId}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // 404 covers two server-side causes (no program access at all, or the target isn't
  // currently a collaborator) that the client can't tell apart from the response —
  // both mean there's nothing left for this queued removal to accomplish.
  if (res.status === 404) return 'success';
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
  registerHandler('program-add-collaborator', handleAddCollaboratorSync);
  registerHandler('program-remove-collaborator', handleRemoveCollaboratorSync);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Functional check of the status-code classification**

No unit test for this file, matching the existing untested `handleSessionSaveSync` (same file) — but the two new status-code special cases (409→success, 404→success) are worth a direct functional check before trusting them, the same way earlier untestable pdfkit code in this project was verified with a throwaway `tsx` script rather than left unverified.

Create a throwaway script (not committed) at `/tmp/check-collaborator-handlers.ts`:

```ts
// Throwaway verification script — not part of the codebase.
import { registerHandler, enqueueTo, processQueueWith } from '../src/lib/syncQueue';
// (adjust the relative path above to wherever you place this file)

async function run() {
  const responses: Record<string, number> = {
    'add-ok': 201,
    'add-409': 409,
    'add-500': 500,
    'remove-ok': 200,
    'remove-404': 404,
  };

  for (const [label, status] of Object.entries(responses)) {
    const outcomes: string[] = [];
    const storage = {
      actions: [] as any[],
      async get() { return this.actions; },
      async set(a: any[]) { this.actions = a; },
    };
    const isAdd = label.startsWith('add');
    const type = isAdd ? 'program-add-collaborator' : 'program-remove-collaborator';
    await enqueueTo(storage, type, isAdd ? { programId: 1, email: 'x@example.com' } : { programId: 1, userId: 2 });

    const handler = async () => {
      const res = { ok: status >= 200 && status < 300, status } as Response;
      if (res.ok) return 'success' as const;
      if (isAdd && status === 409) return 'success' as const;
      if (!isAdd && status === 404) return 'success' as const;
      if (status === 401 || status >= 500) return 'systemic-error' as const;
      return 'item-error' as const;
    };

    const result = await processQueueWith(storage, new Map([[type, handler]]));
    console.log(label, '->', JSON.stringify(result));
  }
}

run();
```

Run: `npx tsx /tmp/check-collaborator-handlers.ts` (adjusting the import path to match where the file is placed relative to `src/lib/syncQueue.ts`)

Expected output — `add-ok`, `add-409`, and `remove-ok`, `remove-404` all show `"processed":1,"remaining":0` (treated as success); `add-500` shows `"blocked":true,"remaining":1` (systemic-error, item untouched). This confirms the classification table above behaves as designed before it's wired into the real handlers. Delete the throwaway script afterward — it exercises the classification logic pattern, not the real handlers (which need a real `fetch`/`Response`), so it doesn't get committed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/syncHandlers.ts
git commit -m "Add sync handlers for offline collaborator add/remove"
```

---

### Task 3: Wire the admin edit page for offline collaborators

**Files:**
- Modify: `src/app/admin/local/programs/edit/page.tsx`

**Interfaces:**
- Consumes: `saveCollaboratorsCache`, `loadCollaboratorsCache`, `CachedCollaboratorsData` from `src/lib/collaboratorsCache.ts` (Task 1); `mergeCollaboratorsWithPending`, `DisplayCollaborator` from `src/lib/collaboratorsMerge.ts` (Task 1); `getQueuedActions`, `enqueue` from `src/lib/syncQueue.ts` (Task 1 added `getQueuedActions`; `enqueue` already exists); `useSyncQueue` from `src/components/SyncQueueProvider.tsx` (already exists, exposes `{ pendingCount, notifyQueueChanged }` among other fields).
- Produces: nothing new consumed by later tasks — this is the last code task.

- [ ] **Step 1: Add the new imports and state**

Modify `src/app/admin/local/programs/edit/page.tsx` — replace the import block (lines 1–8) with:

```ts
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditProgramId, clearSelectedEditProgramId } from '@/lib/adminEditStore';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { saveCollaboratorsCache, loadCollaboratorsCache } from '@/lib/collaboratorsCache';
import { mergeCollaboratorsWithPending } from '@/lib/collaboratorsMerge';
import PageNav from '@/components/PageNav';
```

Then, inside the component (after the existing `useState` declarations, right after `const [collaboratorError, setCollaboratorError] = useState<string | null>(null);`), add:

```ts
  const [collaboratorNotice, setCollaboratorNotice] = useState<string | null>(null);
  const [offlineCollaborators, setOfflineCollaborators] = useState(false);
  const [collaboratorsUnavailable, setCollaboratorsUnavailable] = useState(false);
  const [sequencesUnavailableOffline, setSequencesUnavailableOffline] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
```

- [ ] **Step 2: Rewrite `loadProgram` to degrade gracefully offline and return its role**

Replace the existing `loadProgram` function:

```ts
  async function loadProgram(id: number): Promise<{ role: 'creator' | 'collaborator' } | null> {
    try {
      const res = await nativeApiFetch(`/api/programs/${id}`);
      const data = await res.json();
      setTitle(data.title);
      setSequences(data.sequences);
      setRole(data.role);
      setSequencesUnavailableOffline(false);
      return { role: data.role };
    } catch {
      setSequencesUnavailableOffline(true);
      return null;
    }
  }
```

- [ ] **Step 3: Extract the current-user load into a named, catchable function**

Replace the standalone effect:

```ts
  useEffect(() => {
    nativeApiFetch('/api/account').then((r) => r.json()).then(setCurrentUser);
  }, []);
```

with a named function (no longer its own effect — called from the combined effect in Step 5):

```ts
  async function loadCurrentUser(): Promise<CurrentUser | null> {
    try {
      const res = await nativeApiFetch('/api/account');
      const data = await res.json();
      setCurrentUser(data);
      return data;
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Rewrite `loadCollaborators` to take explicit role/user params and fall back to cache**

Replace the existing `loadCollaborators` function:

```ts
  async function loadCollaborators(
    id: number,
    roleForCache: 'creator' | 'collaborator' | null,
    userForCache: CurrentUser | null
  ) {
    try {
      const res = await nativeApiFetch(`/api/programs/${id}/collaborators`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCollaboratorError(
          typeof body?.error === 'string' ? body.error : 'Αποτυχία φόρτωσης συνεργατών'
        );
        return;
      }
      const data = await res.json();
      setCreator(data.creator);
      setCollaborators(data.collaborators);
      setOfflineCollaborators(false);
      setCollaboratorsUnavailable(false);
      if (roleForCache && userForCache) {
        await saveCollaboratorsCache({
          programId: id,
          role: roleForCache,
          creator: data.creator,
          collaborators: data.collaborators,
          currentUser: userForCache,
          cachedAt: new Date().toISOString(),
        });
      }
    } catch {
      const cached = await loadCollaboratorsCache(id);
      if (cached) {
        setRole(cached.role);
        setCreator(cached.creator);
        setCollaborators(cached.collaborators);
        setCurrentUser(cached.currentUser);
        setOfflineCollaborators(true);
        setCollaboratorsUnavailable(false);
      } else {
        setCollaboratorsUnavailable(true);
      }
    }
  }
```

- [ ] **Step 5: Rewrite the loading effect to thread values through instead of reading stale state**

Replace:

```ts
  useEffect(() => {
    if (programId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProgram(programId);
    loadCollaborators(programId);
  }, [programId]);
```

with:

```ts
  useEffect(() => {
    if (programId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    (async () => {
      // loadProgram and loadCurrentUser both catch their own network failures and never
      // reject, so Promise.all is correct here (no need for allSettled). Their return
      // values are threaded into loadCollaborators explicitly rather than read back from
      // React state in the same tick, which would see the pre-update, stale value.
      const [programResult, user] = await Promise.all([loadProgram(programId), loadCurrentUser()]);
      await loadCollaborators(programId, programResult?.role ?? null, user);
    })();
  }, [programId]);
```

- [ ] **Step 6: Add the pending-actions effect**

Add this new effect right after the effect from Step 5:

```ts
  useEffect(() => {
    if (programId === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getQueuedActions().then(setPendingActions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, pendingCount]);
```

(If `npx eslint` in Step 12 shows this rule wasn't actually triggered here, remove the now-unnecessary disable comment rather than leaving a dead suppression — the established precedent for this rule, `SyncQueueProvider.tsx`'s `refresh()` call, matches this exact shape of a direct state-setting call in an effect body, so it's included proactively.)

- [ ] **Step 7: Rewrite `handleAddCollaborator` to enqueue on network failure**

Replace the existing `handleAddCollaborator` function:

```ts
  async function handleAddCollaborator(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    const email = newCollaboratorEmail;
    try {
      const res = await nativeApiFetch(`/api/programs/${programId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία προσθήκης συνεργάτη');
        return;
      }
      setNewCollaboratorEmail('');
      await loadCollaborators(programId, role, currentUser);
    } catch {
      await enqueue('program-add-collaborator', { programId, email });
      setNewCollaboratorEmail('');
      setCollaboratorNotice('Θα προστεθεί μόλις υπάρξει σύνδεση.');
      notifyQueueChanged();
    }
  }
```

- [ ] **Step 8: Rewrite `handleRemoveCollaborator` to enqueue on network failure**

Replace the existing `handleRemoveCollaborator` function:

```ts
  async function handleRemoveCollaborator(userId: number) {
    if (programId === null) return;
    setCollaboratorError(null);
    setCollaboratorNotice(null);
    try {
      const res = await nativeApiFetch(`/api/programs/${programId}/collaborators/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία αφαίρεσης συνεργάτη');
        return;
      }
      if (userId === currentUser?.id) {
        await clearSelectedEditProgramId(preferencesStore);
        router.push('/admin/programs');
        return;
      }
      await loadCollaborators(programId, role, currentUser);
    } catch {
      await enqueue('program-remove-collaborator', { programId, userId });
      notifyQueueChanged();
      if (userId === currentUser?.id) {
        await clearSelectedEditProgramId(preferencesStore);
        router.push('/admin/programs');
        return;
      }
      setCollaboratorNotice('Θα αφαιρεθεί μόλις υπάρξει σύνδεση.');
    }
  }
```

- [ ] **Step 9: Compute the display list and rewrite the Συνεργάτες card render**

Add this right before the component's `return` statement (after the `if (programId === null)` early-return block, before the main `return (`):

```ts
  const displayCollaborators =
    programId !== null ? mergeCollaboratorsWithPending(collaborators, pendingActions, programId) : [];
```

Replace the entire Συνεργάτες card (from `{role && (` through its matching closing `)}`, currently lines 243–300) with:

```tsx
      {(role !== null || collaboratorsUnavailable) && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3 p-4">
            <h2 className="font-semibold">Συνεργάτες</h2>
            {collaboratorsUnavailable && (
              <p className="text-sm text-base-content/50">Άγνωστο χωρίς σύνδεση.</p>
            )}
            {offlineCollaborators && (
              <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>
            )}
            {collaboratorError && (
              <div role="alert" className="alert alert-error alert-sm">
                <span>{collaboratorError}</span>
              </div>
            )}
            {collaboratorNotice && (
              <div role="status" className="alert alert-info alert-sm">
                <span>{collaboratorNotice}</span>
              </div>
            )}
            {!collaboratorsUnavailable && (
              <>
                <ul className="flex flex-col gap-1">
                  {creator && (
                    <li className="flex items-center gap-2">
                      <span className="flex-1">
                        {creator.email}
                        {currentUser?.id === creator.id && ' (εσύ)'}
                        {' — δημιουργός'}
                      </span>
                    </li>
                  )}
                  {displayCollaborators.map((c, i) => (
                    <li key={c.id ?? `pending-${i}-${c.email}`} className="flex items-center gap-2">
                      <span className="flex-1">
                        {c.email}
                        {currentUser?.id === c.id && ' (εσύ)'}
                        {c.status === 'pending-add' && ' (εκκρεμεί)'}
                        {c.status === 'needs-attention-add' && ' (απέτυχε η προσθήκη)'}
                        {c.status === 'needs-attention-remove' && ' (απέτυχε η αφαίρεση)'}
                      </span>
                      {role === 'creator' && c.id !== null && (
                        <button
                          onClick={() => handleRemoveCollaborator(c.id as number)}
                          className="btn btn-ghost btn-xs text-error"
                        >
                          Αφαίρεση
                        </button>
                      )}
                    </li>
                  ))}
                  {displayCollaborators.length === 0 && !creator && (
                    <li className="text-sm text-base-content/50">Κανένας συνεργάτης ακόμη</li>
                  )}
                </ul>
                {role === 'creator' && (
                  <form onSubmit={handleAddCollaborator} className="flex gap-2">
                    <input
                      type="email"
                      value={newCollaboratorEmail}
                      onChange={(e) => setNewCollaboratorEmail(e.target.value)}
                      placeholder="Email συνεργάτη"
                      className="input input-bordered input-sm flex-1"
                      required
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Προσθήκη</button>
                  </form>
                )}
                {role === 'collaborator' && currentUser && (
                  <button
                    onClick={() => handleRemoveCollaborator(currentUser.id)}
                    className="btn btn-outline btn-error btn-sm self-start"
                  >
                    Αποχώρηση από το πρόγραμμα
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
```

- [ ] **Step 10: Show a graceful notice instead of the sequences UI when offline**

Immediately after the Συνεργάτες card's closing `)}` from Step 9, wrap the existing "add sequence" form and sequences list (currently the `<form onSubmit={handleAddSequence}...>` block and the `<ul className="flex flex-col gap-3">...</ul>` block that follow it) in a conditional:

```tsx
      {sequencesUnavailableOffline ? (
        <p className="text-sm text-base-content/50">
          Η επεξεργασία σειρών δεν είναι διαθέσιμη χωρίς σύνδεση.
        </p>
      ) : (
        <>
          <form onSubmit={handleAddSequence} className="flex gap-2">
            <input
              value={newSeqTitle}
              onChange={(e) => setNewSeqTitle(e.target.value)}
              placeholder="Τίτλος νέας σειράς"
              className="input input-bordered flex-1"
              required
            />
            <button type="submit" className="btn btn-primary">Προσθήκη σειράς</button>
          </form>

          <ul className="flex flex-col gap-3">
            {sequences.map((seq) => (
              <li key={seq.id} className="card border border-base-300 bg-base-100">
                <div className="card-body gap-3 p-4">
                  {editingSeqId === seq.id ? (
                    <form onSubmit={(e) => handleRenameSequence(e, seq.id)} className="flex items-center gap-2">
                      <input
                        value={editingSeqTitle}
                        onChange={(e) => setEditingSeqTitle(e.target.value)}
                        className="input input-bordered input-sm flex-1"
                        autoFocus
                        required
                      />
                      <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                      <button type="button" onClick={() => setEditingSeqId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleToggleExpand(seq.id)} className="btn btn-ghost btn-sm flex-1 justify-start">
                        {expandedSeqId === seq.id ? '▾' : '▸'} {seq.title}
                      </button>
                      <button onClick={() => startEditingSequence(seq)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                      <button onClick={() => handleDeleteSequence(seq.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή σειράς</button>
                    </div>
                  )}

                  {expandedSeqId === seq.id && (
                    <div className="flex flex-col gap-3 border-t border-base-300 pt-3">
                      <ul className="flex flex-col gap-1">
                        {seqSongs.map((entry, i) => (
                          <li key={entry.sequenceSongId} className="flex items-center gap-2">
                            <span className="badge badge-neutral badge-sm">{i + 1}</span>
                            <span className="flex-1">{entry.song.title}</span>
                            <button onClick={() => handleMoveSong(i, -1)} disabled={i === 0} className="btn btn-ghost btn-xs">↑</button>
                            <button onClick={() => handleMoveSong(i, 1)} disabled={i === seqSongs.length - 1} className="btn btn-ghost btn-xs">↓</button>
                            <button onClick={() => handleRemoveSong(entry.sequenceSongId)} className="btn btn-ghost btn-xs text-error">Αφαίρεση</button>
                          </li>
                        ))}
                        {seqSongs.length === 0 && <li className="text-sm text-base-content/50">Κανένα τραγούδι ακόμη</li>}
                      </ul>

                      <form onSubmit={handleSearch} className="flex gap-2">
                        <input
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Αναζήτηση τραγουδιού για προσθήκη"
                          className="input input-bordered input-sm flex-1"
                        />
                        <button type="submit" className="btn btn-sm">Αναζήτηση</button>
                      </form>
                      {searchResults.length > 0 && (
                        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                          {searchResults.map((s) => (
                            <li key={s.id} className="flex items-center gap-2">
                              <span className="flex-1">{s.title}</span>
                              <button onClick={() => handleAddSong(s.id)} className="btn btn-primary btn-xs">+ Προσθήκη</button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
            {sequences.length === 0 && <li className="text-sm text-base-content/50">Καμία σειρά ακόμη</li>}
          </ul>
        </>
      )}
```

(This is the exact pre-existing JSX, unchanged, now wrapped in the offline conditional — no behavior change to sequence editing itself.)

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Lint**

Run: `npx eslint src/app/admin/local/programs/edit/page.tsx`
Expected: no errors (pre-existing warnings elsewhere in the codebase, if any, are unrelated).

- [ ] **Step 13: Run the full test suite**

Run: `npm test`
Expected: same 129 tests as after Task 1 (this task adds no new tests, per the established convention of not testing pages) — all pass, no regressions.

- [ ] **Step 14: Commit**

```bash
git add src/app/admin/local/programs/edit/page.tsx
git commit -m "Make admin collaborators card work offline (view cache, queue add/remove)"
```

---

### Task 4: Full verification

No implementer subagent for this task — verification only, matching the equivalent final task in `docs/superpowers/plans/2026-08-30-offline-pdf-export.md`.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 129 tests pass (122 pre-existing + 7 new from Task 1), 0 failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output.

- [ ] **Step 3: Lint**

Run: `npx eslint 'src/**/*.{ts,tsx}'`
Expected: no errors in any file this plan touched (pre-existing `@next/next/no-img-element` warnings elsewhere are unrelated noise, not a regression).

- [ ] **Step 4: Web build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Mobile build**

Run: `npm run build:mobile`
Expected: succeeds; `admin/local/programs/edit` still appears in the static export route list (confirm via the build's own printed route table — no new static asset is introduced by this plan, unlike the PDF export plan's fonts, so there's nothing new to `ls` for).

- [ ] **Step 6: Note the manual on-device verification gap**

Not blocking, but record in the SDD ledger (and this project's `mobile-roadmap` memory, once this sub-project ships) that the following still needs a real device or emulator: open the edit page for a known program while online (populates the cache); enable airplane mode; reload the page and confirm the cached collaborator list renders with the offline note; add a collaborator by email while offline, confirm it appears tagged pending and is queued; disable airplane mode, confirm it syncs and the pending tag clears; repeat for remove; confirm a deliberately-bad queued add (nonexistent email) eventually surfaces via the app-wide needsAttention badge.
