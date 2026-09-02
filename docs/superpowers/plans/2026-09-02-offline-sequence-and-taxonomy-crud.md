# Offline Sequence & Taxonomy CRUD Implementation Plan

> **Status: COMPLETE.** All 10 tasks landed as commits `b62c52d..0668447` (2026-09-02), pushed to `origin/main`. Re-verified via `npm test`/`tsc --noEmit`/`eslint`/`npm run build`/`npm run build:mobile`, all green, during the 2026-09-02 audit that also fixed this same plan file's sibling, `2026-09-01-offline-song-crud-phase1.md`, having been left untracked.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fixed-program sequence editing (#6) and taxonomy admin CRUD (#7) work offline on the native build, sharing one generic negative-draft-ID resolution mechanism so a value created offline can be assigned to a song in the same session.

**Architecture:** Reuse the existing always-enqueue offline stack (`syncQueue.ts` strict-FIFO engine, per-feature IndexedDB cache + pure merge overlay, one handler per action type in `syncHandlers.ts`, `SyncQueueProvider` badge). Offline-created entities get **negative** draft IDs; a persisted `draft→real` store resolves them at sync time; because the queue is FIFO and each create is enqueued before its referencing action, ordering does the coordination with **no engine changes**.

**Tech Stack:** Next.js 16 App Router (Capacitor native build from same source), TypeScript, IndexedDB, Vitest (node environment only — no DOM/jsdom), daisyUI.

**Spec:** `docs/superpowers/specs/2026-09-02-offline-sequence-and-taxonomy-crud-design.md`

## Global Constraints

- **Read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code** (AGENTS.md — this Next.js has breaking changes vs. training data).
- **Tests run in Vitest node environment only** — no DOM, no jsdom, no React render tests. Test **pure logic** only.
- **Convention: do NOT unit-test IndexedDB cache modules or sync handlers** — the repo has none (no `songsListCache.test.ts`, `collaboratorsCache.test.ts`, or `syncHandlers.test.ts`). Push all testable decisions into pure functions and test those.
- **Sync-handler outcome contract:** every handler passes `{ redirectOn401: false }`; `401`/`5xx` → `systemic-error`; `404` → `success` (idempotent, target/access gone); real `409` → `item-error` (→ `needsAttention` at 3 attempts); `403` (taxonomy non-owner) → `item-error`; unresolved draft id in payload → `item-error` (no fetch); else `item-error`.
- **Draft IDs are negative integers**; every real DB id is a positive serial. `isDraftId(id) === id < 0`.
- **Ownership boundary:** offline song search for "add song to sequence" reads owner-scoped `songsListCache`/`referenceData.songs`, NEVER `referenceData.sharedSongs`.
- **Each IndexedDB cache is its own database** (never share `glentify-offline`/`glentify-sync-queue`) — two modules coordinating version upgrades on one DB risks its data.
- **UI copy is Greek**, matching surrounding code.
- **Commit** after each task with a `feat:`/`test:` message.

---

## File Structure

- **Create:**
  - `src/lib/draftIds.ts` (+ `.test.ts`) — mint/detect draft ids; pure resolution helpers; IndexedDB `draft→real` store.
  - `src/lib/taxonomyMerge.ts` (+ `.test.ts`) — pure overlay of pending taxonomy create/delete onto a cached list.
  - `src/lib/programDetailCache.ts` — IndexedDB cache of a program's editable sequence structure.
  - `src/lib/sequencesMerge.ts` (+ `.test.ts`) — pure overlay of pending sequence actions onto a cached detail.
- **Modify:**
  - `src/lib/syncHandlers.ts` — taxonomy + sequence handlers, registrations.
  - `src/app/admin/regions/page.tsx`, `.../genres/page.tsx`, `.../rhythms/page.tsx`, `.../dromoi/page.tsx`, `.../composers/page.tsx` — offline read overlay + enqueue create/delete.
  - `src/app/admin/local/programs/edit/page.tsx` — offline read from cache + enqueue six ops + incremental cache writes.
  - `src/components/SongAxisEditor.tsx` — unblock "+ Νέα τιμή" offline, wire to draft create.
  - `docs/manual-testing-checklist.md` — append manual steps (final task).
- **Reuse unchanged:** `syncQueue.ts`, `offlineCache.ts`/`referenceData.ts`, `songsListCache.ts`, `axisEditorData.ts`, `SyncQueueProvider`, `nativeApiFetch.ts`.

**Naming alignment:** taxonomy action types are driven off the axis `lookupTable` string (`regions`/`genres`/`rhythms`/`dromoi`/`composers`), so `SongAxisEditor` (`selectedType.lookupTable`), the admin pages, and the handlers all agree with zero mapping. Action types: `${lookupTable}-create`, `${lookupTable}-delete`. Draft entity namespaces reuse those same strings, plus `song`, `sequence`, `sequence-song`.

---

## Task 1: Draft-ID foundation (`draftIds.ts`)

**Files:**
- Create: `src/lib/draftIds.ts`
- Test: `src/lib/draftIds.test.ts`

**Interfaces:**
- Produces:
  - `mintDraftId(): number` — device-unique, monotonic, always `< 0`.
  - `isDraftId(id: number): boolean` — `id < 0`.
  - `type DraftEntity = 'regions'|'genres'|'rhythms'|'dromoi'|'composers'|'song'|'sequence'|'sequence-song'`.
  - `type DraftMap = Record<string, number>` — key `${entity}:${draftId}` → real id.
  - `resolveOne(map: DraftMap, entity: DraftEntity, id: number): number | null` — pure. Returns `id` if `id >= 0`; the mapped real id if present; `null` if a draft is still unresolved.
  - `resolveMany(map: DraftMap, entity: DraftEntity, ids: number[]): { ids: number[]; allResolved: boolean }` — pure; resolves each via `resolveOne`, `allResolved` false if any is `null`.
  - `recordResolution(entity: DraftEntity, draftId: number, realId: number): Promise<void>` — IndexedDB-backed default store.
  - `loadDraftMap(): Promise<DraftMap>` — reads the whole map (handlers call this once per invocation).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/draftIds.test.ts
import { describe, it, expect } from 'vitest';
import { mintDraftId, isDraftId, resolveOne, resolveMany, type DraftMap } from './draftIds';

describe('mintDraftId / isDraftId', () => {
  it('mints unique, always-negative ids', () => {
    const a = mintDraftId();
    const b = mintDraftId();
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(0);
    expect(a).not.toBe(b);
    expect(isDraftId(a)).toBe(true);
    expect(isDraftId(42)).toBe(false);
    expect(isDraftId(0)).toBe(false);
  });
});

describe('resolveOne', () => {
  const map: DraftMap = { 'regions:-5': 100, 'song:-9': 200 };
  it('passes real ids through unchanged', () => {
    expect(resolveOne(map, 'regions', 100)).toBe(100);
  });
  it('maps a resolved draft to its real id', () => {
    expect(resolveOne(map, 'regions', -5)).toBe(100);
  });
  it('returns null for an unresolved draft', () => {
    expect(resolveOne(map, 'regions', -6)).toBeNull();
  });
  it('namespaces by entity', () => {
    expect(resolveOne(map, 'song', -5)).toBeNull();
  });
});

describe('resolveMany', () => {
  const map: DraftMap = { 'sequence-song:-1': 11, 'sequence-song:-2': 12 };
  it('resolves all when possible', () => {
    expect(resolveMany(map, 'sequence-song', [-1, -2, 5])).toEqual({ ids: [11, 12, 5], allResolved: true });
  });
  it('flags allResolved false and keeps nulls out of ids when one is unresolved', () => {
    const r = resolveMany(map, 'sequence-song', [-1, -3]);
    expect(r.allResolved).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/draftIds.test.ts`
Expected: FAIL — module `./draftIds` not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/draftIds.ts

export type DraftEntity =
  | 'regions' | 'genres' | 'rhythms' | 'dromoi' | 'composers'
  | 'song' | 'sequence' | 'sequence-song';

export type DraftMap = Record<string, number>;

let counter = 0;

// Device-unique, monotonic, always negative. Date.now() guards across app restarts;
// the per-session counter guards rapid same-millisecond taps.
export function mintDraftId(): number {
  return -(Date.now() * 1000 + (counter++ % 1000));
}

export function isDraftId(id: number): boolean {
  return id < 0;
}

function keyFor(entity: DraftEntity, draftId: number): string {
  return `${entity}:${draftId}`;
}

// Pure. Real ids (>= 0) pass through; a resolved draft maps to its real id; an
// unresolved draft returns null so the caller can defer (item-error).
export function resolveOne(map: DraftMap, entity: DraftEntity, id: number): number | null {
  if (id >= 0) return id;
  const real = map[keyFor(entity, id)];
  return real === undefined ? null : real;
}

export function resolveMany(
  map: DraftMap,
  entity: DraftEntity,
  ids: number[]
): { ids: number[]; allResolved: boolean } {
  const resolved: number[] = [];
  let allResolved = true;
  for (const id of ids) {
    const r = resolveOne(map, entity, id);
    if (r === null) allResolved = false;
    else resolved.push(r);
  }
  return { ids: resolved, allResolved };
}

// --- IndexedDB-backed default store (not unit-tested, per repo convention) ---

const DB_NAME = 'glentify-draft-resolutions';
const DB_VERSION = 1;
const STORE_NAME = 'resolutions';

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

export async function recordResolution(entity: DraftEntity, draftId: number, realId: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(realId, keyFor(entity, draftId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDraftMap(): Promise<DraftMap> {
  const db = await openDb();
  const map = await new Promise<DraftMap>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as number[];
      const out: DraftMap = {};
      keys.forEach((k, i) => { out[k] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/draftIds.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/draftIds.ts src/lib/draftIds.test.ts
git commit -m "feat: add negative draft-id foundation with pure resolution helpers"
```

---

## Task 2: Taxonomy merge overlay (`taxonomyMerge.ts`)

**Files:**
- Create: `src/lib/taxonomyMerge.ts`
- Test: `src/lib/taxonomyMerge.test.ts`

**Interfaces:**
- Consumes: `QueuedAction` from `./syncQueue`; `DraftEntity` from `./draftIds`.
- Produces:
  - `interface TaxonomyBaseValue { id: number; name: string; parentId?: number | null }`
  - `interface DisplayTaxonomyValue { id: number; name: string; parentId: number | null; status: 'active' | 'pending-create' | 'needs-attention-create' }`
  - `mergeTaxonomyWithPending(base: TaxonomyBaseValue[], actions: QueuedAction[], entity: DraftEntity): DisplayTaxonomyValue[]`
  - `isTaxonomyQueueAction(action: QueuedAction, entity: DraftEntity): boolean`

Action payload shapes (created by the pages/handlers):
- `${entity}-create`: `{ draftId: number; name: string; parentId: number | null }`
- `${entity}-delete`: `{ id: number }`

Merge rules (mirror `mergeSongsWithPending`):
- A pending delete (`needsAttention === false`) hides its row (optimistic).
- A `needsAttention` delete leaves the row visible as `active` (the 409/403 is real; hiding forever would misrepresent server state).
- A pending create appends a row with its draft id; `needsAttention` create → `needs-attention-create`, else `pending-create`.
- A draft created **and** deleted in the queue: the delete removes the matching pending-create row, so it shows as absent.
- Malformed payloads are skipped (runs on the render path).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/taxonomyMerge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeTaxonomyWithPending, type TaxonomyBaseValue } from './taxonomyMerge';
import type { QueuedAction } from './syncQueue';

function action(overrides: Partial<QueuedAction>): QueuedAction {
  return { id: 'x', type: 'regions-create', payload: {}, attempts: 0, needsAttention: false, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}
const base: TaxonomyBaseValue[] = [
  { id: 1, name: 'Σμύρνη', parentId: null },
  { id: 2, name: 'Πόλη', parentId: null },
];

describe('mergeTaxonomyWithPending', () => {
  it('appends a pending create with its draft id', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'regions-create', payload: { draftId: -5, name: 'Κρήτη', parentId: null } })], 'regions');
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ id: -5, name: 'Κρήτη', parentId: null, status: 'pending-create' });
  });
  it('hides a pending delete', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'regions-delete', payload: { id: 1 } })], 'regions');
    expect(out.map((v) => v.id)).toEqual([2]);
  });
  it('keeps a needs-attention delete visible as active', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'regions-delete', payload: { id: 1 }, needsAttention: true })], 'regions');
    expect(out.find((v) => v.id === 1)?.status).toBe('active');
  });
  it('nets a created-then-deleted draft to absent', () => {
    const out = mergeTaxonomyWithPending(base, [
      action({ id: 'a', type: 'regions-create', payload: { draftId: -5, name: 'Κρήτη', parentId: null } }),
      action({ id: 'b', type: 'regions-delete', payload: { id: -5 } }),
    ], 'regions');
    expect(out.map((v) => v.id)).toEqual([1, 2]);
  });
  it('ignores actions for a different entity', () => {
    const out = mergeTaxonomyWithPending(base, [action({ type: 'genres-create', payload: { draftId: -9, name: 'Ρεμπέτικο', parentId: null } })], 'regions');
    expect(out).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/taxonomyMerge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/taxonomyMerge.ts
import type { QueuedAction } from './syncQueue';
import type { DraftEntity } from './draftIds';

export interface TaxonomyBaseValue {
  id: number;
  name: string;
  parentId?: number | null;
}

export interface DisplayTaxonomyValue {
  id: number;
  name: string;
  parentId: number | null;
  status: 'active' | 'pending-create' | 'needs-attention-create';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isTaxonomyQueueAction(action: QueuedAction, entity: DraftEntity): boolean {
  return action.type === `${entity}-create` || action.type === `${entity}-delete`;
}

// Pure — no I/O. Overlays this entity's pending create/delete actions onto the cached
// list, same rule-shape as mergeSongsWithPending.
export function mergeTaxonomyWithPending(
  base: TaxonomyBaseValue[],
  actions: QueuedAction[],
  entity: DraftEntity
): DisplayTaxonomyValue[] {
  const deletes = new Map<number, boolean>(); // id -> needsAttention
  const creates: { draftId: number; name: string; parentId: number | null; needsAttention: boolean }[] = [];

  for (const a of actions) {
    if (!isRecord(a.payload)) continue;
    if (a.type === `${entity}-delete`) {
      const { id } = a.payload;
      if (typeof id === 'number') deletes.set(id, a.needsAttention);
    } else if (a.type === `${entity}-create`) {
      const { draftId, name, parentId } = a.payload;
      if (typeof draftId === 'number' && typeof name === 'string') {
        creates.push({
          draftId,
          name,
          parentId: typeof parentId === 'number' ? parentId : null,
          needsAttention: a.needsAttention,
        });
      }
    }
  }

  const result: DisplayTaxonomyValue[] = [];
  for (const v of base) {
    const del = deletes.get(v.id);
    if (del === false) continue; // optimistically hidden
    result.push({ id: v.id, name: v.name, parentId: v.parentId ?? null, status: 'active' });
  }
  for (const c of creates) {
    if (deletes.get(c.draftId) !== undefined) continue; // created then deleted -> absent
    result.push({
      id: c.draftId,
      name: c.name,
      parentId: c.parentId,
      status: c.needsAttention ? 'needs-attention-create' : 'pending-create',
    });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/taxonomyMerge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomyMerge.ts src/lib/taxonomyMerge.test.ts
git commit -m "feat: add pure taxonomy pending-overlay merge"
```

---

## Task 3: Taxonomy sync handlers

**Files:**
- Modify: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `loadDraftMap`, `recordResolution`, `resolveOne`, `isDraftId`, `DraftEntity` from `./draftIds`; `nativeApiFetch`; `registerHandler`, `SyncOutcome`.
- Produces (registered action types): `regions-create`, `regions-delete`, `genres-create`, `genres-delete`, `rhythms-create`, `rhythms-delete`, `dromoi-create`, `dromoi-delete`, `composers-create`, `composers-delete`.

Generic factory approach avoids ten near-identical handlers. Endpoint for entity `e` is `/api/${e}` (POST) and `/api/${e}/${id}` (DELETE) — confirmed against `src/app/api/regions/route.ts` and `.../[id]/route.ts` (mirror routes exist for all five).

- [ ] **Step 1: Add the taxonomy handler factories and payload types**

Add near the top of `src/lib/syncHandlers.ts` (after existing imports):

```ts
import { loadDraftMap, recordResolution, resolveOne, isDraftId, type DraftEntity } from './draftIds';

interface TaxonomyCreatePayload { draftId: number; name: string; parentId: number | null }
interface TaxonomyDeletePayload { id: number }

const TAXONOMY_ENTITIES: DraftEntity[] = ['regions', 'genres', 'rhythms', 'dromoi', 'composers'];

function makeTaxonomyCreateHandler(entity: DraftEntity) {
  return async function (payload: unknown): Promise<SyncOutcome> {
    const { draftId, name, parentId } = payload as TaxonomyCreatePayload;
    // Regions can have a draft parent created earlier in the same offline session.
    let resolvedParent: number | null = parentId;
    if (parentId !== null && isDraftId(parentId)) {
      const map = await loadDraftMap();
      const r = resolveOne(map, 'regions', parentId);
      if (r === null) return 'item-error'; // parent create hasn't synced yet — wait
      resolvedParent = r;
    }
    const body = entity === 'regions' ? { name, parentId: resolvedParent } : { name };
    const res = await nativeApiFetch(
      `/api/${entity}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      undefined,
      { redirectOn401: false }
    );
    if (res.ok) {
      const created = await res.json();
      if (created && typeof created.id === 'number') await recordResolution(entity, draftId, created.id);
      return 'success';
    }
    if (res.status === 401 || res.status >= 500) return 'systemic-error';
    return 'item-error';
  };
}

function makeTaxonomyDeleteHandler(entity: DraftEntity) {
  return async function (payload: unknown): Promise<SyncOutcome> {
    const { id } = payload as TaxonomyDeletePayload;
    // A draft created and deleted in the same session: the create synced first and recorded
    // its real id; resolve to it. If unresolved, the create is still queued ahead — wait.
    let realId = id;
    if (isDraftId(id)) {
      const map = await loadDraftMap();
      const r = resolveOne(map, entity, id);
      if (r === null) return 'item-error';
      realId = r;
    }
    const res = await nativeApiFetch(
      `/api/${entity}/${encodeURIComponent(realId)}`,
      { method: 'DELETE' },
      undefined,
      { redirectOn401: false }
    );
    if (res.ok) return 'success';
    if (res.status === 404) return 'success'; // already gone
    if (res.status === 401 || res.status >= 500) return 'systemic-error';
    // 403 (non-owner) and 409 (still referenced by a song axis value / has child regions)
    // are both permanent — item-error retries to the cap, then surfaces via needsAttention.
    return 'item-error';
  };
}
```

- [ ] **Step 2: Register the ten handlers**

In `initSyncHandlers()`, after the existing `registerHandler('song-delete', …)` line:

```ts
  for (const entity of TAXONOMY_ENTITIES) {
    registerHandler(`${entity}-create`, makeTaxonomyCreateHandler(entity));
    registerHandler(`${entity}-delete`, makeTaxonomyDeleteHandler(entity));
  }
```

- [ ] **Step 3: Verify it typechecks and lints**

Run: `npx tsc --noEmit && npx next lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/syncHandlers.ts
git commit -m "feat: add offline taxonomy create/delete sync handlers with draft resolution"
```

---

## Task 4: Rewire the five taxonomy admin pages for offline

**Files:**
- Modify: `src/app/admin/regions/page.tsx`, `src/app/admin/genres/page.tsx`, `src/app/admin/rhythms/page.tsx`, `src/app/admin/dromoi/page.tsx`, `src/app/admin/composers/page.tsx`

**Interfaces:**
- Consumes: `mergeTaxonomyWithPending`, `DisplayTaxonomyValue`, `isTaxonomyQueueAction` from `taxonomyMerge`; `mintDraftId` from `draftIds`; `enqueue`, `getQueuedActions` from `syncQueue`; `useSyncQueue`; `loadReferenceData` from `offlineCache`.

This is a **batch task**: the five pages share the same shape. `regions` is the only one with `parentId`; genres/rhythms/dromoi/composers are `{id, name}` only. Apply the pattern to all five, dropping `parentId` handling for the four non-region pages. The full worked example is `regions`; the others are the same minus the parent `<select>` and `parentId`.

The `entity` string per page: `regions`, `genres`, `rhythms`, `dromoi`, `composers`. The `referenceData` field of the same name holds the cached list.

- [ ] **Step 1: Rewrite `src/app/admin/regions/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { loadReferenceData } from '@/lib/offlineCache';
import { enqueue, getQueuedActions } from '@/lib/syncQueue';
import { mergeTaxonomyWithPending, type DisplayTaxonomyValue } from '@/lib/taxonomyMerge';
import { mintDraftId } from '@/lib/draftIds';
import { useSyncQueue } from '@/components/SyncQueueProvider';

const ENTITY = 'regions' as const;

export default function RegionsAdminPage() {
  const { pendingCount, notifyQueueChanged } = useSyncQueue();
  const [regions, setRegions] = useState<DisplayTaxonomyValue[]>([]);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  async function load() {
    const actions = await getQueuedActions();
    try {
      const res = await nativeApiFetch('/api/regions');
      if (!res.ok) throw new Error('bad status');
      const base = await res.json();
      setRegions(mergeTaxonomyWithPending(base, actions, ENTITY));
      setOffline(false);
    } catch {
      const data = await loadReferenceData();
      setRegions(mergeTaxonomyWithPending(data?.regions ?? [], actions, ENTITY));
      setOffline(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await enqueue('regions-create', {
        draftId: mintDraftId(),
        name,
        parentId: parentId ? Number(parentId) : null,
      });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    setName('');
    setParentId('');
    await notifyQueueChanged();
  }

  async function handleDelete(id: number) {
    setError(null);
    try {
      await enqueue('regions-delete', { id });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await notifyQueueChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Περιοχές</h1>
      {offline && <p className="text-sm text-warning">Χωρίς σύνδεση — οι αλλαγές θα συγχρονιστούν αργότερα.</p>}
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα περιοχής" className="input input-bordered flex-1" required />
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="select select-bordered">
          <option value="">Χωρίς γονική περιοχή</option>
          {regions.filter((r) => r.id >= 0).map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {regions.map((r) => (
          <li key={r.id} className="list-row items-center">
            <span>
              {r.name}
              {r.parentId ? ` (γονική: ${regions.find((p) => p.id === r.parentId)?.name ?? '?'})` : ''}
              {r.status === 'pending-create' && ' (εκκρεμεί)'}
              {r.status === 'needs-attention-create' && ' (απέτυχε)'}
            </span>
            <button onClick={() => handleDelete(r.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Notes carried into the four non-region pages: drop the `parentId` state, the parent `<select>`, and the `(γονική: …)` label; the create enqueue is `{ draftId: mintDraftId(), name, parentId: null }`; the header labels stay as each page currently has them (Είδη / Ρυθμοί / Δρόμοι / Συνθέτες); `ENTITY` and the `referenceData` field become `genres`/`rhythms`/`dromoi`/`composers`. A parent-select `filter((r) => r.id >= 0)` prevents choosing a still-unsynced draft as a parent (its child would reference an unresolvable draft-of-a-draft edge we don't need in v1).

- [ ] **Step 2: Apply the same rewrite to genres, rhythms, dromoi, composers**

Repeat Step 1's structure in each of the four files with the entity/field/label substitutions above and no parent handling.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npx next lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/regions/page.tsx src/app/admin/genres/page.tsx src/app/admin/rhythms/page.tsx src/app/admin/dromoi/page.tsx src/app/admin/composers/page.tsx
git commit -m "feat: taxonomy admin pages read offline and enqueue create/delete"
```

---

## Task 5: Unblock "+ Νέα τιμή" offline in `SongAxisEditor`

**Files:**
- Modify: `src/components/SongAxisEditor.tsx`

**Interfaces:**
- Consumes: `mintDraftId` from `draftIds`; `enqueue` from `syncQueue`; `useSyncQueue`; existing `isNativeApp`, `Option`.

On native, tapping "+ Νέα τιμή" and Δημιουργία must mint a draft id, enqueue the taxonomy create (so it precedes the song save in FIFO order), add the draft `Option` to the in-memory list, and select it (`newRefId = String(draftId)`). The song's later `song-update`/`song-create` carries `refId = draftId`, resolved at sync. The web branch keeps the live-POST behavior.

- [ ] **Step 1: Add imports and queue hook**

At the top of `SongAxisEditor.tsx`:

```tsx
import { enqueue } from '@/lib/syncQueue';
import { mintDraftId } from '@/lib/draftIds';
import { useSyncQueue } from '@/components/SyncQueueProvider';
```

Inside the component, add: `const { notifyQueueChanged } = useSyncQueue();`

- [ ] **Step 2: Enable the option on native**

Change the disabled option (currently `<option value="__new__" disabled={isNativeApp()}>+ Νέα τιμή...</option>`) to:

```tsx
                  <option value="__new__">+ Νέα τιμή...</option>
```

Remove the adjacent native-only hint span:

```tsx
                {isNativeApp() && (
                  <span className="text-xs text-base-content/50">Νέες τιμές μόνο από την ιστοσελίδα διαχείρισης προς το παρόν.</span>
                )}
```

- [ ] **Step 3: Branch `handleCreateValue` for native (enqueue) vs web (live POST)**

Replace the existing `handleCreateValue` with:

```tsx
  async function handleCreateValue() {
    if (!selectedType?.lookupTable || !newValueName.trim()) return;
    const table = selectedType.lookupTable;
    const name = newValueName.trim();

    if (isNativeApp()) {
      const draftId = mintDraftId();
      try {
        await enqueue(`${table}-create`, { draftId, name, parentId: null });
      } catch {
        return;
      }
      const created: Option = { id: draftId, name };
      setOptionsByAxis((prev) => ({ ...prev, [selectedType.key]: [...(prev[selectedType.key] ?? []), created] }));
      setNewRefId(String(draftId));
      setCreatingValue(false);
      setNewValueName('');
      await notifyQueueChanged();
      return;
    }

    const endpoint = LOOKUP_ENDPOINTS[table];
    const body = table === 'regions' ? { name, parentId: null } : { name };
    const res = await nativeApiFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    const created: Option = await res.json();
    setOptionsByAxis((prev) => ({ ...prev, [selectedType.key]: [...(prev[selectedType.key] ?? []), created] }));
    setNewRefId(String(created.id));
    setCreatingValue(false);
    setNewValueName('');
  }
```

Note: `handleAdd` already does `refId: Number(newRefId)` — for a draft this yields the negative draft id, exactly what the song payload must carry. No change needed there.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit && npx next lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/SongAxisEditor.tsx
git commit -m "feat: enable offline '+ Νέα τιμή' taxonomy create-and-assign in SongAxisEditor"
```

---

## Task 6: Program-detail cache (`programDetailCache.ts`)

**Files:**
- Create: `src/lib/programDetailCache.ts`

**Interfaces:**
- Produces:
  - `interface CachedSequenceSong { sequenceSongId: number; songId: number; title: string }`
  - `interface CachedSequence { id: number; title: string; position: number; songs: CachedSequenceSong[] }`
  - `interface CachedProgramDetail { programId: number; title: string; role: 'creator' | 'collaborator'; sequences: CachedSequence[]; cachedAt: string }`
  - `saveProgramDetail(detail: CachedProgramDetail): Promise<void>`
  - `loadProgramDetail(programId: number): Promise<CachedProgramDetail | null>`
  - `saveSequenceSongs(programId: number, sequenceId: number, songs: CachedSequenceSong[]): Promise<void>` — updates one sequence's songs in place without clobbering the rest (used on expand).

Not unit-tested (IndexedDB cache, per convention). Same raw-IndexedDB shape as `collaboratorsCache.ts` with `keyPath: 'programId'`.

- [ ] **Step 1: Implement**

```ts
// src/lib/programDetailCache.ts

export interface CachedSequenceSong {
  sequenceSongId: number;
  songId: number;
  title: string;
}

export interface CachedSequence {
  id: number;
  title: string;
  position: number;
  songs: CachedSequenceSong[];
}

export interface CachedProgramDetail {
  programId: number;
  title: string;
  role: 'creator' | 'collaborator';
  sequences: CachedSequence[];
  cachedAt: string;
}

// Dedicated database — same reasoning as collaboratorsCache.ts / songsListCache.ts:
// never share glentify-offline / glentify-sync-queue, to avoid cross-module IndexedDB
// version-upgrade risk.
const DB_NAME = 'glentify-program-detail-cache';
const DB_VERSION = 1;
const STORE_NAME = 'program-detail';

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

export async function saveProgramDetail(detail: CachedProgramDetail): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(detail);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProgramDetail(programId: number): Promise<CachedProgramDetail | null> {
  const db = await openDb();
  const result = await new Promise<CachedProgramDetail | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(programId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

// Updates one sequence's songs in place (used when an expand fetches a sequence's songs
// online), leaving every other sequence untouched. No-op if the program isn't cached yet.
export async function saveSequenceSongs(
  programId: number,
  sequenceId: number,
  songs: CachedSequenceSong[]
): Promise<void> {
  const existing = await loadProgramDetail(programId);
  if (!existing) return;
  const sequences = existing.sequences.map((s) => (s.id === sequenceId ? { ...s, songs } : s));
  await saveProgramDetail({ ...existing, sequences, cachedAt: new Date().toISOString() });
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/programDetailCache.ts
git commit -m "feat: add program-detail IndexedDB cache for offline sequence editing"
```

---

## Task 7: Sequence merge overlay (`sequencesMerge.ts`)

**Files:**
- Create: `src/lib/sequencesMerge.ts`
- Test: `src/lib/sequencesMerge.test.ts`

**Interfaces:**
- Consumes: `QueuedAction`; `CachedSequence`, `CachedSequenceSong`, `CachedProgramDetail` from `programDetailCache`.
- Produces:
  - `interface DisplaySequenceSong { sequenceSongId: number; title: string }`
  - `interface DisplaySequence { id: number; title: string; songs: DisplaySequenceSong[]; status: 'active' | 'pending-create' }`
  - `mergeSequencesWithPending(detail: CachedProgramDetail, actions: QueuedAction[], songTitleById: Map<number, string>): DisplaySequence[]`
  - `isSequenceQueueActionForProgram(action: QueuedAction, programId: number, sequenceIdsInProgram: number[]): boolean`

Action payload shapes (created by the edit page / consumed by handlers):
- `sequence-create`: `{ draftId: number; programId: number; title: string }`
- `sequence-rename`: `{ sequenceId: number; title: string }`
- `sequence-delete`: `{ sequenceId: number }`
- `sequence-add-song`: `{ draftId: number; sequenceId: number; songId: number }`
- `sequence-remove-song`: `{ sequenceSongId: number }`
- `sequence-reorder`: `{ sequenceId: number; orderedIds: number[] }`

Merge rules:
- Start from `detail.sequences` (as `active`); append `sequence-create` for this program (matched by `programId`) as `pending-create` with empty songs.
- `sequence-rename` overwrites `title` on the matching sequence (last-wins by queue order).
- `sequence-delete` removes the matching sequence (including a still-draft one — created-then-deleted nets to absent).
- Within each sequence: `sequence-add-song` appends `{ sequenceSongId: draftId, title: songTitleById.get(songId) ?? '—' }`; `sequence-remove-song` removes the entry with the matching `sequenceSongId` (works for draft entries too — add-then-remove nets to absent); `sequence-reorder` reorders the sequence's current entries by `orderedIds` (last reorder wins; entries not present in `orderedIds` are appended in their existing order; ids in `orderedIds` not present are ignored).
- Malformed payloads skipped.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sequencesMerge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeSequencesWithPending } from './sequencesMerge';
import type { CachedProgramDetail } from './programDetailCache';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/sequencesMerge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sequencesMerge.ts
import type { QueuedAction } from './syncQueue';
import type { CachedProgramDetail } from './programDetailCache';

export interface DisplaySequenceSong {
  sequenceSongId: number;
  title: string;
}

export interface DisplaySequence {
  id: number;
  title: string;
  songs: DisplaySequenceSong[];
  status: 'active' | 'pending-create';
}

const SEQUENCE_ACTION_TYPES = new Set([
  'sequence-create', 'sequence-rename', 'sequence-delete',
  'sequence-add-song', 'sequence-remove-song', 'sequence-reorder',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isSequenceQueueActionForProgram(
  action: QueuedAction,
  programId: number,
  sequenceIdsInProgram: number[]
): boolean {
  if (!SEQUENCE_ACTION_TYPES.has(action.type) || !isRecord(action.payload)) return false;
  const p = action.payload;
  if (action.type === 'sequence-create') return p.programId === programId;
  const seqId = typeof p.sequenceId === 'number' ? p.sequenceId : null;
  if (seqId !== null) return sequenceIdsInProgram.includes(seqId);
  // sequence-remove-song carries only sequenceSongId; the page filters those by presence
  // in the currently-expanded sequence, so program-scoping isn't needed for it here.
  return false;
}

function reorder(songs: DisplaySequenceSong[], orderedIds: number[]): DisplaySequenceSong[] {
  const byId = new Map(songs.map((s) => [s.sequenceSongId, s]));
  const out: DisplaySequenceSong[] = [];
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s) { out.push(s); byId.delete(id); }
  }
  for (const s of songs) if (byId.has(s.sequenceSongId)) out.push(s); // leftovers keep order
  return out;
}

// Pure — no I/O. Overlays this program's pending sequence actions onto the cached detail.
export function mergeSequencesWithPending(
  detail: CachedProgramDetail,
  actions: QueuedAction[],
  songTitleById: Map<number, string>
): DisplaySequence[] {
  let sequences: DisplaySequence[] = detail.sequences.map((s) => ({
    id: s.id,
    title: s.title,
    status: 'active',
    songs: s.songs.map((e) => ({ sequenceSongId: e.sequenceSongId, title: e.title })),
  }));

  for (const a of actions) {
    if (!isRecord(a.payload)) continue;
    const p = a.payload;
    switch (a.type) {
      case 'sequence-create': {
        if (p.programId === detail.programId && typeof p.draftId === 'number' && typeof p.title === 'string') {
          sequences.push({ id: p.draftId, title: p.title, status: 'pending-create', songs: [] });
        }
        break;
      }
      case 'sequence-rename': {
        if (typeof p.sequenceId === 'number' && typeof p.title === 'string') {
          sequences = sequences.map((s) => (s.id === p.sequenceId ? { ...s, title: p.title as string } : s));
        }
        break;
      }
      case 'sequence-delete': {
        if (typeof p.sequenceId === 'number') sequences = sequences.filter((s) => s.id !== p.sequenceId);
        break;
      }
      case 'sequence-add-song': {
        if (typeof p.sequenceId === 'number' && typeof p.draftId === 'number' && typeof p.songId === 'number') {
          const title = songTitleById.get(p.songId) ?? '—';
          sequences = sequences.map((s) =>
            s.id === p.sequenceId ? { ...s, songs: [...s.songs, { sequenceSongId: p.draftId as number, title }] } : s
          );
        }
        break;
      }
      case 'sequence-remove-song': {
        if (typeof p.sequenceSongId === 'number') {
          sequences = sequences.map((s) => ({ ...s, songs: s.songs.filter((e) => e.sequenceSongId !== p.sequenceSongId) }));
        }
        break;
      }
      case 'sequence-reorder': {
        if (typeof p.sequenceId === 'number' && Array.isArray(p.orderedIds)) {
          const ids = (p.orderedIds as unknown[]).filter((x): x is number => typeof x === 'number');
          sequences = sequences.map((s) => (s.id === p.sequenceId ? { ...s, songs: reorder(s.songs, ids) } : s));
        }
        break;
      }
    }
  }
  return sequences;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/sequencesMerge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sequencesMerge.ts src/lib/sequencesMerge.test.ts
git commit -m "feat: add pure sequence pending-overlay merge"
```

---

## Task 8: Sequence sync handlers

**Files:**
- Modify: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `loadDraftMap`, `recordResolution`, `resolveOne`, `resolveMany`, `isDraftId`.
- Produces (registered): `sequence-create`, `sequence-rename`, `sequence-delete`, `sequence-add-song`, `sequence-remove-song`, `sequence-reorder`.

Routes (confirmed): POST `/api/programs/{programId}/sequences` → `201` with the sequence (`{id,...}`); PATCH/DELETE `/api/programs/{programId}/sequences/{seqId}`; POST `/api/programs/{programId}/sequences/{seqId}/songs` (body `{songId}`) → `201`; PATCH same path (body `{orderedIds}`); DELETE `/api/programs/{programId}/sequences/{seqId}/songs/{entryId}`. No-access returns `404` (via `role` check), never `403`. **Program id is needed in every path but the routes derive access from it — the payloads carry `programId` where the create needs it; rename/delete/song ops need the program id too, so include `programId` in every sequence payload (added in Task 9).**

Amended payloads (Task 9 enqueues these; Task 7 already tolerates extra fields):
- `sequence-create`: `{ draftId, programId, title }`
- `sequence-rename`: `{ programId, sequenceId, title }`
- `sequence-delete`: `{ programId, sequenceId }`
- `sequence-add-song`: `{ draftId, programId, sequenceId, songId }`
- `sequence-remove-song`: `{ programId, sequenceId, sequenceSongId }`
- `sequence-reorder`: `{ programId, sequenceId, orderedIds }`

- [ ] **Step 1: Add the six handlers**

Add to `src/lib/syncHandlers.ts`:

```ts
interface SeqCreatePayload { draftId: number; programId: number; title: string }
interface SeqRenamePayload { programId: number; sequenceId: number; title: string }
interface SeqDeletePayload { programId: number; sequenceId: number }
interface SeqAddSongPayload { draftId: number; programId: number; sequenceId: number; songId: number }
interface SeqRemoveSongPayload { programId: number; sequenceId: number; sequenceSongId: number }
interface SeqReorderPayload { programId: number; sequenceId: number; orderedIds: number[] }

// Resolves a possibly-draft id against the current draft map; returns null if still
// unresolved (caller returns item-error to wait for the create ahead in the queue).
async function resolveSeqId(entity: 'sequence' | 'sequence-song' | 'song', id: number): Promise<number | null> {
  if (!isDraftId(id)) return id;
  const map = await loadDraftMap();
  return resolveOne(map, entity, id);
}

async function handleSequenceCreateSync(payload: unknown): Promise<SyncOutcome> {
  const { draftId, programId, title } = payload as SeqCreatePayload;
  const pid = await resolveSeqId('sequence', programId); // program may itself be a draft
  if (pid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const created = await res.json();
    if (created && typeof created.id === 'number') await recordResolution('sequence', draftId, created.id);
    return 'success';
  }
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceRenameSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, title } = payload as SeqRenamePayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok || res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceDeleteSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId } = payload as SeqDeletePayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok || res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceAddSongSync(payload: unknown): Promise<SyncOutcome> {
  const { draftId, programId, sequenceId, songId } = payload as SeqAddSongPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  const song = await resolveSeqId('song', songId);
  if (pid === null || sid === null || song === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId: song }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    // The route returns { ok: true }; if it also returns the join-row id, record it so a
    // later reorder/remove referencing this draft entry can resolve. When absent, a draft
    // remove/reorder of this brand-new entry can't resolve and will surface via needsAttention
    // — acceptable v1 (the common flow adds then syncs before reordering).
    if (body && typeof body.sequenceSongId === 'number') await recordResolution('sequence-song', draftId, body.sequenceSongId);
    return 'success';
  }
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceRemoveSongSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, sequenceSongId } = payload as SeqRemoveSongPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  const entry = await resolveSeqId('sequence-song', sequenceSongId);
  if (pid === null || sid === null || entry === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs/${encodeURIComponent(entry)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok || res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleSequenceReorderSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, orderedIds } = payload as SeqReorderPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const map = await loadDraftMap();
  const resolved = resolveMany(map, 'sequence-song', orderedIds);
  if (!resolved.allResolved) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedIds: resolved.ids }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok || res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

- [ ] **Step 2: Register them**

In `initSyncHandlers()`, after the taxonomy loop from Task 3:

```ts
  registerHandler('sequence-create', handleSequenceCreateSync);
  registerHandler('sequence-rename', handleSequenceRenameSync);
  registerHandler('sequence-delete', handleSequenceDeleteSync);
  registerHandler('sequence-add-song', handleSequenceAddSongSync);
  registerHandler('sequence-remove-song', handleSequenceRemoveSongSync);
  registerHandler('sequence-reorder', handleSequenceReorderSync);
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit && npx next lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/syncHandlers.ts
git commit -m "feat: add offline sequence CRUD sync handlers with draft resolution"
```

---

## Task 9: Rewire the program edit page for offline sequences

**Files:**
- Modify: `src/app/admin/local/programs/edit/page.tsx`

**Interfaces:**
- Consumes: `loadProgramDetail`, `saveProgramDetail`, `saveSequenceSongs`, `CachedProgramDetail`, `CachedSequenceSong` from `programDetailCache`; `mergeSequencesWithPending`, `DisplaySequence` from `sequencesMerge`; `mintDraftId` from `draftIds`; `enqueue`, `getQueuedActions` from `syncQueue`; `loadSongsListCache` from `songsListCache`; existing `useSyncQueue`, `nativeApiFetch`.

The page keeps its current collaborators section unchanged. The sequence section changes from live-thin-client to always-enqueue + offline overlay. Because the merge output type differs from the current `Sequence`/`SequenceSongEntry` shapes, the rendering block for sequences is rewritten to consume `DisplaySequence`.

Key behaviors:
- **Load (online):** after a successful `loadProgram` + per-sequence song fetch, write the full `CachedProgramDetail` (title/role/sequences with songs) via `saveProgramDetail`. On expand, `saveSequenceSongs` for that sequence.
- **Load (offline):** `loadProgramDetail`; if present, overlay pending actions with `mergeSequencesWithPending` (song titles from `loadSongsListCache`) and render; if absent, keep today's "δεν είναι διαθέσιμη χωρίς σύνδεση" message.
- **Writes:** all six handlers `enqueue(...)` then `notifyQueueChanged()`; no live fetch, no reload — the overlay (recomputed on `pendingCount` change) reflects the change.
- **Song search (add song):** online uses `/api/songs?search=`; offline filters `loadSongsListCache()` by title (own songs only).

- [ ] **Step 1: Read the Next.js data-fetching guide**

Run: `ls node_modules/next/dist/docs/` and read the App Router client-fetching / offline-relevant guide before editing.
Expected: confirm no API deprecations affect `nativeApiFetch` usage in a client component.

- [ ] **Step 2: Add imports and offline-overlay state**

Add imports:

```tsx
import { loadProgramDetail, saveProgramDetail, saveSequenceSongs, type CachedProgramDetail, type CachedSequenceSong } from '@/lib/programDetailCache';
import { mergeSequencesWithPending, type DisplaySequence } from '@/lib/sequencesMerge';
import { mintDraftId } from '@/lib/draftIds';
import { loadSongsListCache } from '@/lib/songsListCache';
```

Add a display-model state and a song-title map, and derive expanded songs from the merged model instead of a separate fetch:

```tsx
  const [displaySequences, setDisplaySequences] = useState<DisplaySequence[]>([]);
  const [songTitles, setSongTitles] = useState<Map<number, string>>(new Map());
```

Replace the `sequences`/`seqSongs` render source with `displaySequences`. The expanded sequence's songs become `displaySequences.find((s) => s.id === expandedSeqId)?.songs ?? []`.

- [ ] **Step 3: Rewrite the load path to cache online + overlay offline**

Replace `loadProgram` and the sequences-loading effect with a combined loader:

```tsx
  async function loadSequences(id: number) {
    const [actions, songsCache] = await Promise.all([getQueuedActions(), loadSongsListCache()]);
    const titles = new Map<number, string>((songsCache ?? []).map((s) => [s.id, s.title]));
    setSongTitles(titles);
    try {
      const res = await nativeApiFetch(`/api/programs/${id}`);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      setTitle(data.title);
      setRole(data.role);
      // Fetch each sequence's songs so the offline cache is complete for later editing.
      const sequences = await Promise.all(
        (data.sequences as { id: number; title: string; position: number }[]).map(async (seq) => {
          const sres = await nativeApiFetch(`/api/programs/${id}/sequences/${seq.id}`);
          const sdata = await sres.json();
          const songs: CachedSequenceSong[] = (sdata.songs as { sequenceSongId: number; song: { id: number; title: string } }[])
            .map((e) => ({ sequenceSongId: e.sequenceSongId, songId: e.song.id, title: e.song.title }));
          return { id: seq.id, title: seq.title, position: seq.position, songs };
        })
      );
      const detail: CachedProgramDetail = { programId: id, title: data.title, role: data.role, sequences, cachedAt: new Date().toISOString() };
      await saveProgramDetail(detail);
      setSequencesUnavailableOffline(false);
      setDisplaySequences(mergeSequencesWithPending(detail, actions, titles));
    } catch {
      const cached = await loadProgramDetail(id).catch(() => null);
      if (cached) {
        setTitle(cached.title);
        setRole(cached.role);
        setSequencesUnavailableOffline(false);
        setDisplaySequences(mergeSequencesWithPending(cached, actions, titles));
      } else {
        setSequencesUnavailableOffline(true);
      }
    }
  }
```

Call `loadSequences(programId)` from the existing `programId` effect and re-run it on `pendingCount` change (so enqueues re-overlay). Keep `loadCurrentUser`/`loadCollaborators` as they are.

- [ ] **Step 4: Convert the six write handlers to enqueue**

Replace the existing `handleAddSequence`, `handleDeleteSequence`, `handleRenameSequence`, `handleMoveSong`, `handleAddSong`, `handleRemoveSong` with:

```tsx
  async function handleAddSequence(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    await enqueue('sequence-create', { draftId: mintDraftId(), programId, title: newSeqTitle });
    setNewSeqTitle('');
    await notifyQueueChanged();
  }

  async function handleDeleteSequence(seqId: number) {
    if (programId === null) return;
    await enqueue('sequence-delete', { programId, sequenceId: seqId });
    if (expandedSeqId === seqId) setExpandedSeqId(null);
    await notifyQueueChanged();
  }

  async function handleRenameSequence(e: React.FormEvent, seqId: number) {
    e.preventDefault();
    if (programId === null) return;
    await enqueue('sequence-rename', { programId, sequenceId: seqId, title: editingSeqTitle });
    setEditingSeqId(null);
    await notifyQueueChanged();
  }

  async function handleMoveSong(fromIndex: number, direction: -1 | 1) {
    if (expandedSeqId === null || programId === null) return;
    const current = displaySequences.find((s) => s.id === expandedSeqId)?.songs ?? [];
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= current.length) return;
    const reordered = [...current];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    await enqueue('sequence-reorder', { programId, sequenceId: expandedSeqId, orderedIds: reordered.map((e) => e.sequenceSongId) });
    await notifyQueueChanged();
  }

  async function handleAddSong(songId: number) {
    if (expandedSeqId === null || programId === null) return;
    await enqueue('sequence-add-song', { draftId: mintDraftId(), programId, sequenceId: expandedSeqId, songId });
    setSearch('');
    setSearchResults([]);
    await notifyQueueChanged();
  }

  async function handleRemoveSong(entryId: number) {
    if (expandedSeqId === null || programId === null) return;
    await enqueue('sequence-remove-song', { programId, sequenceId: expandedSeqId, sequenceSongId: entryId });
    await notifyQueueChanged();
  }
```

- [ ] **Step 5: Make expand + search offline-capable**

Replace `handleToggleExpand`, `refreshSequenceSongs`, and `handleSearch`:

```tsx
  async function handleToggleExpand(seqId: number) {
    if (expandedSeqId === seqId) { setExpandedSeqId(null); return; }
    setExpandedSeqId(seqId);
    setSearch('');
    setSearchResults([]);
    if (programId === null) return;
    // Best-effort online refresh of this sequence's songs into the cache; offline this
    // throws and we keep the already-merged cached/overlaid songs.
    try {
      const res = await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`);
      const data = await res.json();
      const songs: CachedSequenceSong[] = (data.songs as { sequenceSongId: number; song: { id: number; title: string } }[])
        .map((e) => ({ sequenceSongId: e.sequenceSongId, songId: e.song.id, title: e.song.title }));
      await saveSequenceSongs(programId, seqId, songs);
      const actions = await getQueuedActions();
      const cached = await loadProgramDetail(programId);
      if (cached) setDisplaySequences(mergeSequencesWithPending(cached, actions, songTitles));
    } catch {
      // offline — displaySequences already holds the cached+overlaid songs
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await nativeApiFetch(`/api/songs?search=${encodeURIComponent(search)}`);
      setSearchResults(await res.json());
    } catch {
      const cache = (await loadSongsListCache()) ?? [];
      const q = search.toLowerCase();
      setSearchResults(cache.filter((s) => s.title.toLowerCase().includes(q)).map((s) => ({ id: s.id, title: s.title })));
    }
  }
```

- [ ] **Step 6: Update the sequences JSX to render `displaySequences`**

In the sequences list, iterate `displaySequences` instead of `sequences`; use `seq.status === 'pending-create'` to append `' (εκκρεμεί)'` to the title and to hide the Μετονομασία/song-editing affordances on a not-yet-synced draft sequence (a draft sequence's rename/song-ops can't resolve until it syncs — allow them only on `status === 'active'`). The expanded song list iterates `displaySequences.find((s) => s.id === expandedSeqId)?.songs ?? []` with `entry.sequenceSongId` as key and `entry.title` as label; the ↑/↓/Αφαίρεση buttons call the handlers above. Remove the now-unused `Sequence`, `SequenceSongEntry`, `seqSongs`, and `setSeqSongs` declarations.

- [ ] **Step 7: Verify build**

Run: `npx tsc --noEmit && npx next lint`
Expected: no new errors; no unused-variable warnings for removed state.

- [ ] **Step 8: Run the full test suite**

Run: `npx vitest run`
Expected: all pass (no regressions; new pure-module tests green).

- [ ] **Step 9: Commit**

```bash
git add src/app/admin/local/programs/edit/page.tsx
git commit -m "feat: offline sequence CRUD on the program edit page via cache + overlay"
```

---

## Task 10: Append manual testing steps

**Files:**
- Modify: `docs/manual-testing-checklist.md`

- [ ] **Step 1: Append the offline sequence & taxonomy section**

Append to `docs/manual-testing-checklist.md`:

```markdown
## Offline Sequence & Taxonomy CRUD (#6 + #7)

Preconditions: native build installed; tap "Συγχρονισμός τραγουδιών" on the home page once while online so `referenceData` (taxonomy + programs) is cached; open the target program's edit page once while online so its detail is cached.

### Taxonomy admin offline (regions/genres/rhythms/dromoi/composers)
- [ ] Go offline (airplane mode). Open Περιοχές — the list renders from cache with an "Χωρίς σύνδεση" notice.
- [ ] Create a value offline → it appears immediately tagged "(εκκρεμεί)"; the sync badge increments.
- [ ] Delete a cached value offline → it disappears immediately.
- [ ] Repeat create for Είδη, Ρυθμοί, Δρόμοι, Συνθέτες.
- [ ] Go online → badge drains; reopen each page → pending values are now real (no "(εκκρεμεί)"), deletes stuck.
- [ ] Offline-delete a value that IS used by a song, then go online → it lands in needsAttention (still referenced / 409); the row reappears.

### Create-and-assign inside a song (SongAxisEditor)
- [ ] Offline, edit a song → Άξονες → pick an axis → "+ Νέα τιμή" is now enabled → create a value → it's selected → Προσθήκη → Αποθήκευση.
- [ ] Go online → the taxonomy value syncs first, then the song update, and the song shows the new axis value assigned (verify on the web admin).

### Sequences offline (inside a Σταθερό Πρόγραμμα)
- [ ] Offline, open the previously-cached program's edit page → sequences render (no "δεν είναι διαθέσιμη" message).
- [ ] Add a sequence → appears "(εκκρεμεί)".
- [ ] On an existing sequence: rename it; expand it; add a song (search works offline over cached songs); remove a song; reorder with ↑/↓.
- [ ] Delete a sequence.
- [ ] Confirm each action increments the sync badge and the UI updates immediately.
- [ ] Go online → badge drains → reload → every change persisted server-side in the right order (added songs present, reorder applied, deletes gone).
- [ ] Edge: open a program that was NEVER opened online while offline → shows "δεν είναι διαθέσιμη χωρίς σύνδεση" (expected).
```

- [ ] **Step 2: Commit**

```bash
git add docs/manual-testing-checklist.md
git commit -m "docs: add manual testing steps for offline sequence & taxonomy CRUD"
```

---

## Self-Review

**1. Spec coverage:**
- §3 mechanism → Task 1 (`draftIds`) + resolution in Tasks 3 & 8 handlers. ✓
- §4.1 taxonomy read/create/delete → Tasks 2, 3, 4. ✓
- §4.1 "+ Νέα τιμή" create-and-assign → Task 5. ✓
- §4.2 sequences cache/reads/writes/reorder → Tasks 6, 7, 8, 9. ✓
- §5 outcome contract (404/403/409, unresolved-draft→item-error) → Tasks 3 & 8 handlers. ✓
- §7 testing (pure modules only) → draftIds/taxonomyMerge/sequencesMerge tests; caches & handlers untested per convention. ✓
- §8 ordering (foundation → taxonomy → sequences) → Task order 1 → 2-5 → 6-9. ✓
- §9 manual steps after completion → Task 10. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has real code. ✓

**3. Type consistency:** `mintDraftId`/`isDraftId`/`resolveOne`/`resolveMany`/`loadDraftMap`/`recordResolution` (Task 1) used identically in Tasks 3, 5, 8. `DisplayTaxonomyValue`/`mergeTaxonomyWithPending` (Task 2) match Task 4 usage. `CachedProgramDetail`/`CachedSequenceSong`/`saveSequenceSongs` (Task 6) match Tasks 7 & 9. `mergeSequencesWithPending(detail, actions, songTitleById)` signature (Task 7) matches Task 9 calls. Action-type strings (`${entity}-create/-delete`, `sequence-*`) consistent between page enqueues, merges, and handler registrations. Sequence payloads include `programId` in every variant (Task 8 note) — Task 9 enqueues match. ✓

---

## Execution Handoff

Plan complete. Execution options: **(1) Subagent-Driven (recommended)** — fresh subagent per task, review between tasks; **(2) Inline Execution** — batch with checkpoints.
