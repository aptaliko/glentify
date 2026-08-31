# Offline Program CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make create/rename/delete of a whole Σταθερό Πρόγραμμα work offline on the native admin tool's programs list page, queued via the existing generic sync-queue engine, viewable from a cache when offline — while leaving the web version of the same page completely unaffected.

**Architecture:** A new dedicated IndexedDB cache stores the last-successfully-loaded programs list; a new pure function overlays the sync-queue's own pending create/rename/delete items onto that cached/live list for rendering; three new handlers register with the existing `syncQueue.ts` engine (no engine changes); the page's data-loading and mutation functions branch on `isNativeApp()` so web keeps its exact current online-only behavior, unchanged.

**Tech Stack:** Next.js App Router (Capacitor/Android native build, shared with a web build of the same route), IndexedDB, the existing `src/lib/syncQueue.ts` generic write-queue engine, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-offline-program-crud-design.md`

## Global Constraints

- No changes to `src/lib/syncQueue.ts`'s core engine logic — this plan adds no new export to that file at all (unlike sub-project #4, which added `getQueuedActions()` — that function already exists from #4 and this plan reuses it as-is).
- **Deviation from the spec, decided during planning:** `src/app/admin/programs/page.tsx` is not a native-only twin like `admin/local/programs/edit` — the same component serves both the web and native builds (it already branches on `isNativeApp()` to choose between a `<Link>` and a button for navigation). The spec did not call this out explicitly. This plan gates every new offline behavior (cache read/write, queue-based create/rename/delete, the pending-actions effect) behind `isNativeApp()`, so the web version of this page is byte-for-byte unaffected — it keeps today's exact synchronous fetch/create/rename/delete behavior. This matches every other sub-project's implicit scope (the "complete all offline features" initiative has only ever touched native-only pages or native-gated logic) and avoids a website visitor silently getting queued writes and offline UI they never asked for.
- Testing convention (established throughout this project): pure logic in `src/lib/*` with no I/O gets full Vitest coverage; I/O-bound code (IndexedDB, `fetch`-calling sync handlers, the page) gets none. Do not write a test for `programsListCache.ts`, the three sync handlers, or the page — matches `offlineCache.ts`, `collaboratorsCache.ts`, `handleSessionSaveSync`, and every page in this codebase.
- Greek is the UI language throughout — copy any new user-facing string exactly as written in this plan.
- Reuse `CachedProgram` from `src/lib/programsListCache.ts` as the page's canonical list-item type — do not redeclare an equivalent `Program` interface locally in the page (the page already has one today; this plan removes it in favor of the shared type).

---

### Task 1: Programs list cache and pending-merge helper

**Files:**
- Create: `src/lib/programsListCache.ts`
- Create: `src/lib/programsMerge.ts`
- Test: `src/lib/programsMerge.test.ts`

**Interfaces:**
- Consumes: `QueuedAction` type from `src/lib/syncQueue.ts` (already exists).
- Produces:
  - `CachedProgram { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[] }`, `saveProgramsListCache(programs: CachedProgram[]): Promise<void>`, `loadProgramsListCache(): Promise<CachedProgram[] | null>` from `programsListCache.ts` — used by Task 3.
  - `CreateProgramPayload { title: string }`, `RenameProgramPayload { programId: number; title: string }`, `DeleteProgramPayload { programId: number }`, `DisplayProgram { id: number | null; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[]; status: 'active' | 'pending-create' | 'renamed' | 'needs-attention-create' | 'needs-attention-rename' }` from `programsMerge.ts` — the three payload types are used by Task 2; `DisplayProgram` is used by Task 3. Note there is no `'needs-attention-delete'` status: a permanently-failed delete reappears as a plain `'active'` row (see the merge function's own logic and its test in Step 2) — it is not tagged differently from a row that was never touched.
  - `isProgramQueueAction(action: QueuedAction): boolean` and `mergeProgramsWithPending(base: { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[] }[], allQueuedActions: QueuedAction[]): DisplayProgram[]` from `programsMerge.ts` — both used by Task 3.

- [ ] **Step 1: Create the dedicated IndexedDB cache module**

Create `src/lib/programsListCache.ts`:

```ts
// src/lib/programsListCache.ts

export interface CachedProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database, `glentify-sync-queue`, or sub-project #4's `glentify-collaborators-cache` —
// same reasoning established in those modules: two independent modules coordinating
// IndexedDB version upgrades on one shared database is a real risk to whatever that
// database already holds. A second, small, single-purpose database avoids that risk
// entirely.
const DB_NAME = 'glentify-programs-list-cache';
const DB_VERSION = 1;
const STORE_NAME = 'programs-list';
const LIST_KEY = 'current';

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

export async function saveProgramsListCache(programs: CachedProgram[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(programs, LIST_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProgramsListCache(): Promise<CachedProgram[] | null> {
  const db = await openDb();
  const result = await new Promise<CachedProgram[] | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(LIST_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}
```

- [ ] **Step 2: Write the failing tests for the pending-merge helper**

Create `src/lib/programsMerge.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/programsMerge.test.ts`
Expected: FAIL — `Cannot find module './programsMerge'` (the file doesn't exist yet).

- [ ] **Step 4: Implement the pending-merge helper**

Create `src/lib/programsMerge.ts`:

```ts
// src/lib/programsMerge.ts
import type { QueuedAction } from './syncQueue';

export interface CreateProgramPayload {
  title: string;
}

export interface RenameProgramPayload {
  programId: number;
  title: string;
}

export interface DeleteProgramPayload {
  programId: number;
}

export interface DisplayProgram {
  id: number | null; // null for a pending create — no server-assigned id yet
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  status: 'active' | 'pending-create' | 'renamed' | 'needs-attention-create' | 'needs-attention-rename';
}

const PROGRAM_ACTION_TYPES = new Set(['program-create', 'program-rename', 'program-delete']);

// Reused by the page's pending-actions effect to count how many of this feature's own
// actions are currently queued, so it can detect the >0 -> 0 transition (this list's
// queue just drained) and refresh the base list from the server — the same predicate
// this function uses internally, so the two never disagree about what counts.
export function isProgramQueueAction(action: QueuedAction): boolean {
  return PROGRAM_ACTION_TYPES.has(action.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Pure — no I/O. Takes the last-known base list (from state or cache) and the full
// sync-queue snapshot, filters to this feature's three action types, and produces the
// list to render:
// - a pending delete hides its row (optimistic hide); a needsAttention delete instead
//   reappears as a normal active row, since a failed delete means the program is still
//   really there — hiding it forever would misrepresent server state
// - a pending rename overlays its new title onto the existing row (status 'renamed'); a
//   needsAttention rename reverts to the last-known real title with a distinct status
//   instead of silently keeping an unconfirmed title forever
// - a pending create appends a row with id: null and role/sharedWithEmails hardcoded
//   ('creator' / [] — true for anything you just created, since CreateProgramPayload
//   carries only a title), not clickable in the UI layer (this function only marks
//   status; the page enforces non-navigability)
// A malformed payload (wrong shape, restored from IndexedDB) is skipped rather than
// thrown on, since this function runs on the render path.
export function mergeProgramsWithPending(
  base: { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[] }[],
  allQueuedActions: QueuedAction[]
): DisplayProgram[] {
  const renames = new Map<number, { title: string; needsAttention: boolean }>();
  const deletes = new Map<number, boolean>(); // programId -> needsAttention
  const creates: { title: string; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (!isRecord(action.payload)) continue;
    const payload = action.payload;
    if (action.type === 'program-rename') {
      const { programId, title } = payload;
      if (typeof programId === 'number' && typeof title === 'string') {
        renames.set(programId, { title, needsAttention: action.needsAttention });
      }
    } else if (action.type === 'program-delete') {
      const { programId } = payload;
      if (typeof programId === 'number') {
        deletes.set(programId, action.needsAttention);
      }
    } else if (action.type === 'program-create') {
      const { title } = payload;
      if (typeof title === 'string') {
        creates.push({ title, needsAttention: action.needsAttention });
      }
    }
  }

  const result: DisplayProgram[] = [];

  for (const program of base) {
    const del = deletes.get(program.id);
    if (del === false) continue; // pending, not yet flagged — optimistically hidden
    if (del === true) {
      result.push({ ...program, status: 'active' });
      continue;
    }
    const rename = renames.get(program.id);
    if (rename) {
      result.push({
        ...program,
        title: rename.needsAttention ? program.title : rename.title,
        status: rename.needsAttention ? 'needs-attention-rename' : 'renamed',
      });
      continue;
    }
    result.push({ ...program, status: 'active' });
  }

  for (const create of creates) {
    result.push({
      id: null,
      title: create.title,
      role: 'creator',
      sharedWithEmails: [],
      status: create.needsAttention ? 'needs-attention-create' : 'pending-create',
    });
  }

  return result;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/programsMerge.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all existing tests (131, per sub-project #4's final count) plus the 9 new ones pass (140 total).

- [ ] **Step 7: Commit**

```bash
git add src/lib/programsListCache.ts src/lib/programsMerge.ts src/lib/programsMerge.test.ts
git commit -m "Add offline programs list cache and pending-merge helper"
```

---

### Task 2: Sync handlers for create/rename/delete program

**Files:**
- Modify: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `CreateProgramPayload`, `RenameProgramPayload`, `DeleteProgramPayload` from `src/lib/programsMerge.ts` (Task 1); `registerHandler`, `SyncOutcome` from `src/lib/syncQueue.ts` (already imported in this file); `nativeApiFetch` (already imported in this file).
- Produces: three new registered handler types, `'program-create'`, `'program-rename'`, `'program-delete'` — used by Task 3's `enqueue()` calls.

- [ ] **Step 1: Add the three handlers and register them**

Modify `src/lib/syncHandlers.ts` — add the import and the three handler functions, and register them in `initSyncHandlers()` alongside the four existing registrations (do not remove or change `handleSessionSaveSync`, `handleAddCollaboratorSync`, or `handleRemoveCollaboratorSync`, or their existing registrations):

```ts
import type { AddCollaboratorPayload, RemoveCollaboratorPayload } from './collaboratorsMerge';
import type { CreateProgramPayload, RenameProgramPayload, DeleteProgramPayload } from './programsMerge';
```

(add this second import line alongside the existing `collaboratorsMerge` import at the top of the file)

```ts
async function handleCreateProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { title } = payload as CreateProgramPayload;
  const res = await nativeApiFetch(
    '/api/programs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRenameProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, title } = payload as RenameProgramPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleDeleteProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId } = payload as DeleteProgramPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already gone (someone else deleted it, or access is already gone) — the desired end
  // state is already true, matching sub-project #4's remove-collaborator 404-as-success
  // precedent.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

Add these three registrations inside `initSyncHandlers()`, after the existing four:

```ts
  registerHandler('program-create', handleCreateProgramSync);
  registerHandler('program-rename', handleRenameProgramSync);
  registerHandler('program-delete', handleDeleteProgramSync);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Functional check of the status-code classification**

No unit test for this file, matching the existing untested handlers already in it — but the 404-as-success special case for delete is worth a direct functional check before trusting it, the same way sub-project #4's Task 2 verified its own 409/404 special cases.

Create a throwaway script (not committed) at a path of your choosing outside `src/`, e.g. `/tmp/check-program-handlers.ts`:

```ts
// Throwaway verification script — not part of the codebase.
import { enqueueTo, processQueueWith } from '/absolute/path/to/repo/src/lib/syncQueue';
// (use an absolute or correctly relative path to src/lib/syncQueue.ts from wherever you place this file)

async function run() {
  const cases: Record<string, { type: string; status: number }> = {
    'create-ok': { type: 'program-create', status: 201 },
    'create-500': { type: 'program-create', status: 500 },
    'rename-ok': { type: 'program-rename', status: 200 },
    'rename-404': { type: 'program-rename', status: 404 },
    'delete-ok': { type: 'program-delete', status: 200 },
    'delete-404': { type: 'program-delete', status: 404 },
  };

  for (const [label, { type, status }] of Object.entries(cases)) {
    const storage = {
      actions: [] as any[],
      async get() { return this.actions; },
      async set(a: any[]) { this.actions = a; },
    };
    const payload =
      type === 'program-create' ? { title: 'x' } : type === 'program-rename' ? { programId: 1, title: 'x' } : { programId: 1 };
    await enqueueTo(storage, type, payload);

    const handler = async () => {
      const res = { ok: status >= 200 && status < 300, status } as Response;
      if (res.ok) return 'success' as const;
      if (type === 'program-delete' && status === 404) return 'success' as const;
      if (status === 401 || status >= 500) return 'systemic-error' as const;
      return 'item-error' as const;
    };

    const result = await processQueueWith(storage, new Map([[type, handler]]));
    console.log(label, '->', JSON.stringify(result));
  }
}

run();
```

Run: `npx tsx /tmp/check-program-handlers.ts` (adjusting the import path to match where the file is placed relative to `src/lib/syncQueue.ts`)

Expected output — `create-ok`, `rename-ok`, `delete-ok`, and `delete-404` all show `"processed":1,"remaining":0` (treated as success); `create-500` and `rename-404` show `"blocked":true,"remaining":1` for the 500 case (systemic-error) and `"processed":0,"remaining":1,"needsAttention":0` growing toward `needsAttention` for the 404-on-rename case (item-error, not a success shortcut — rename has no idempotent-success special case, only delete does). Delete the throwaway script afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/syncHandlers.ts
git commit -m "Add sync handlers for offline program create/rename/delete"
```

---

### Task 3: Wire the programs list page for offline CRUD (native only)

**Files:**
- Modify: `src/app/admin/programs/page.tsx`

**Interfaces:**
- Consumes: `saveProgramsListCache`, `loadProgramsListCache`, `CachedProgram` from `src/lib/programsListCache.ts` (Task 1); `mergeProgramsWithPending`, `isProgramQueueAction`, `DisplayProgram` from `src/lib/programsMerge.ts` (Task 1); `getQueuedActions`, `enqueue` from `src/lib/syncQueue.ts` (already exist); `useSyncQueue` from `src/components/SyncQueueProvider.tsx` (already exists); `isNativeApp` from `src/lib/platform.ts` (already imported in this file today).
- Produces: nothing new consumed by later tasks — this is the last code task.

- [ ] **Step 1: Replace the imports and local type, add new state**

Replace the full import block (current lines 1–10) with:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditProgramId } from '@/lib/adminEditStore';
import { sharedBadgeText } from '@/lib/programBadge';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { saveProgramsListCache, loadProgramsListCache } from '@/lib/programsListCache';
import type { CachedProgram } from '@/lib/programsListCache';
import { mergeProgramsWithPending, isProgramQueueAction } from '@/lib/programsMerge';
```

Remove the existing local `interface Program { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[]; }` block entirely — `CachedProgram` (imported above) has the identical shape and replaces it everywhere in this file.

Replace the component's opening lines — from `const native = isNativeApp();` through the last of the five original `useState` calls (current lines 20–26) — with:

```ts
  const native = isNativeApp();
  const router = useRouter();
  const [programs, setPrograms] = useState<CachedProgram[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [offlinePrograms, setOfflinePrograms] = useState(false);
  const [programsUnavailable, setProgramsUnavailable] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
```

(`native` and `router` are unchanged from today — this block only adds the five new state variables after them.)

- [ ] **Step 2: Rewrite `load()` to branch on native, with cache fallback**

Replace the existing `load()` function:

```ts
  async function load() {
    if (!native) {
      const res = await nativeApiFetch('/api/programs');
      setPrograms(await res.json());
      return;
    }
    try {
      const res = await nativeApiFetch('/api/programs');
      const data: CachedProgram[] = await res.json();
      setPrograms(data);
      setOfflinePrograms(false);
      setProgramsUnavailable(false);
      try {
        await saveProgramsListCache(data);
      } catch {
        // A cache-write failure must not affect the already-successful state above,
        // nor trigger the offline-UI logic below — the fetch just succeeded.
      }
    } catch {
      const cached = await loadProgramsListCache().catch(() => null);
      if (cached) {
        setPrograms(cached);
        setOfflinePrograms(true);
        setProgramsUnavailable(false);
      } else {
        setProgramsUnavailable(true);
      }
    }
  }
```

- [ ] **Step 3: Add the pending-actions effect (native only)**

Add this new effect immediately after the existing `useEffect(() => { load(); }, [])` effect (unchanged — still calls `load()` on mount with its existing `// eslint-disable-next-line react-hooks/set-state-in-effect` comment):

```ts
  // Tracks this feature's own count of queued create/rename/delete actions across
  // renders, so we can detect the >0 -> 0 transition (this list's last queued action just
  // synced) and refresh the base list from the server — otherwise a just-synced create
  // leaves no active row in its place, and a just-synced delete could leave a stale row
  // around. There's only one programs list (unlike sub-project #4's per-program cache),
  // so this ref just needs a plain count, no keying by id.
  const prevPendingProgramCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!native) return;
    getQueuedActions()
      .then((actions) => {
        setPendingActions(actions);
        const thisFeatureCount = actions.filter(isProgramQueueAction).length;
        const prevCount = prevPendingProgramCountRef.current;
        prevPendingProgramCountRef.current = thisFeatureCount;
        if (prevCount !== null && prevCount > 0 && thisFeatureCount === 0) {
          load();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);
```

- [ ] **Step 4: Rewrite `handleCreate` to branch on native**

Replace the existing `handleCreate` function:

```ts
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!native) {
      const res = await nativeApiFetch('/api/programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setError('Αποτυχία δημιουργίας προγράμματος');
        return;
      }
      setTitle('');
      await load();
      return;
    }
    try {
      await enqueue('program-create', { title });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setTitle('');
    notifyQueueChanged();
  }
```

- [ ] **Step 5: Rewrite `handleDelete` to branch on native**

Replace the existing `handleDelete` function:

```ts
  async function handleDelete(id: number) {
    setError(null);
    if (!native) {
      await nativeApiFetch(`/api/programs/${id}`, { method: 'DELETE' });
      await load();
      return;
    }
    try {
      await enqueue('program-delete', { programId: id });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    notifyQueueChanged();
  }
```

- [ ] **Step 6: Rewrite `handleRename` to branch on native**

Replace the existing `handleRename` function:

```ts
  async function handleRename(e: React.FormEvent, id: number) {
    e.preventDefault();
    setError(null);
    if (!native) {
      await nativeApiFetch(`/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editingTitle }),
      });
      setEditingId(null);
      await load();
      return;
    }
    try {
      await enqueue('program-rename', { programId: id, title: editingTitle });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setEditingId(null);
    notifyQueueChanged();
  }
```

`handleOpenProgram` is unchanged — keep it exactly as it is today. `startEditing`'s parameter type must change, since Step 1 removed the `Program` interface it referenced (`function startEditing(p: Program)`); replace its signature with an inline type matching only what it actually uses:

```ts
  function startEditing(p: { id: number; title: string }) {
    setEditingId(p.id);
    setEditingTitle(p.title);
  }
```

The body is unchanged — only the parameter type changes, from the now-deleted `Program` to this narrower inline shape (this also matches the JSX call site in Step 7, `startEditing({ id: p.id as number, title: p.title })`, which only ever passes these two fields).

- [ ] **Step 7: Compute the display list and rewrite the render**

Add this line right before the component's `return` statement:

```ts
  const displayPrograms = mergeProgramsWithPending(programs, pendingActions);
```

(On web, `pendingActions` is always `[]` — the effect in Step 3 never runs there — so `mergeProgramsWithPending` reduces to an identity pass-through with every row `status: 'active'`; no separate web/native branch is needed in the render itself.)

Replace the entire `return (...)` block with:

```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Προγράμματα</h1>
      {programsUnavailable && (
        <p className="text-sm text-base-content/50">Άγνωστο χωρίς σύνδεση.</p>
      )}
      {offlinePrograms && (
        <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>
      )}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {!programsUnavailable && (
        <>
          <form onSubmit={handleCreate} className="flex gap-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Τίτλος προγράμματος"
              className="input input-bordered flex-1"
              required
            />
            <button type="submit" className="btn btn-primary">Προσθήκη</button>
          </form>
          <ul className="list rounded-box bg-base-100 shadow">
            {displayPrograms.map((p, i) => (
              <li key={p.id ?? `pending-${i}-${p.title}`} className="list-row items-center gap-2">
                {editingId === p.id && p.id !== null ? (
                  <form onSubmit={(e) => handleRename(e, p.id as number)} className="flex flex-1 gap-2">
                    <input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      className="input input-bordered input-sm flex-1"
                      autoFocus
                      required
                    />
                    <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                    <button type="button" onClick={() => setEditingId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-1 flex-col gap-1">
                      {p.id === null ? (
                        <span className="text-base-content/50">{p.title}</span>
                      ) : native ? (
                        <button onClick={() => handleOpenProgram(p.id as number)} className="link link-hover text-left">{p.title}</button>
                      ) : (
                        <Link href={`/admin/programs/${p.id}`} className="link link-hover">{p.title}</Link>
                      )}
                      {p.sharedWithEmails.length > 0 && (
                        <span className="badge badge-ghost badge-xs w-fit">{sharedBadgeText(p.sharedWithEmails)}</span>
                      )}
                      {p.status === 'pending-create' && (
                        <span className="text-xs text-base-content/50">Θα είναι διαθέσιμο μόλις συγχρονιστεί.</span>
                      )}
                      {p.status === 'needs-attention-create' && (
                        <span className="text-xs text-error">Απέτυχε η δημιουργία.</span>
                      )}
                      {p.status === 'renamed' && (
                        <span className="text-xs text-base-content/50">Θα μετονομαστεί μόλις υπάρξει σύνδεση.</span>
                      )}
                      {p.status === 'needs-attention-rename' && (
                        <span className="text-xs text-error">Απέτυχε η μετονομασία.</span>
                      )}
                    </div>
                    {p.id !== null && (
                      <>
                        <button
                          onClick={() => startEditing({ id: p.id as number, title: p.title })}
                          className="btn btn-ghost btn-sm"
                        >
                          Μετονομασία
                        </button>
                        {p.role === 'creator' && (
                          <button onClick={() => handleDelete(p.id as number)} className="btn btn-ghost btn-sm text-error">
                            Διαγραφή
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
            {displayPrograms.length === 0 && <li className="list-row text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
          </ul>
        </>
      )}
    </div>
  );
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Lint**

Run: `npx eslint src/app/admin/programs/page.tsx`
Expected: no errors. If the `react-hooks/exhaustive-deps` disable comment on the Step 3 effect is reported as unused, remove it (matching sub-project #4's established handling of this exact situation) rather than leave a dead suppression; if it IS needed but for a different reason than expected, adjust the comment's placement to match what eslint actually flags.

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: same 140 tests as after Task 1 (this task adds no new tests, per the established convention that pages don't get tests) — all pass, no regressions.

- [ ] **Step 11: Commit**

```bash
git add src/app/admin/programs/page.tsx
git commit -m "Make programs list create/rename/delete work offline on native (web unchanged)"
```

---

### Task 4: Full verification

No implementer subagent for this task — verification only, matching the equivalent final task in `docs/superpowers/plans/2026-08-30-offline-collaborator-invites.md`.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 140 tests pass (131 pre-existing + 9 new from Task 1), 0 failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output.

- [ ] **Step 3: Lint**

Run: `npx eslint 'src/**/*.{ts,tsx}'`
Expected: no errors in any file this plan touched (pre-existing `@next/next/no-img-element` warnings elsewhere are unrelated noise, not a regression).

- [ ] **Step 4: Web build**

Run: `npm run build`
Expected: succeeds. Additionally, since this plan explicitly claims the web version of `admin/programs` is unaffected, manually re-read the rendered JSX in Step 7 of Task 3's diff (or the live file) and confirm: with `native === false`, `load()`'s early-return branch runs (no cache, no queue), `handleCreate`/`handleDelete`/`handleRename` all take their `if (!native)` branch, and the Step 3 effect's `if (!native) return;` guard means `pendingActions` never leaves `[]` — so `displayPrograms` is always the plain base list with `status: 'active'` on every row, and none of the new status-dependent JSX (pending/needs-attention notes, disabled rows) can ever render on web.

- [ ] **Step 5: Mobile build**

Run: `npm run build:mobile`
Expected: succeeds; `admin/programs` still appears in the static export route list.

- [ ] **Step 6: Note the manual on-device verification gap**

Not blocking, but record in the SDD ledger (and this project's `mobile-roadmap` memory, once this sub-project ships) that the following still needs a real device or emulator: create a program offline, confirm it shows as a non-clickable pending row; go online, confirm it becomes a normal navigable row with a real id; rename and delete an existing program offline, confirm both queue and later apply correctly (the renamed program shows its real new title post-sync; the deleted one stays gone); confirm a deliberately-conflicting case (delete a program that's already been deleted, e.g. by another device) resolves via the idempotent-success path without getting stuck in needsAttention.
