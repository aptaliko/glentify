# Offline Song CRUD, Phase 1 (text/axes) Implementation Plan

> **Status (2026-09-02): COMPLETE.** All 9 tasks below landed as commits `96b34bb..6f2f268` (2026-09-01), pushed to `origin/main`. This plan file itself was written and executed but never committed at the time — committed retroactively now as the historical record, hence every `- [ ]` checkbox below is stale/unchecked despite the work being done; don't read the unchecked boxes as "not started." `npm test`/`tsc --noEmit`/`eslint`/`npm run build`/`npm run build:mobile` were all re-verified green as part of that retroactive audit. Known follow-ups found during that same audit, not part of this plan: (1) `SongAxisEditor`'s native branch had no error handling around a malformed/legacy cached `ReferenceData` blob, fixed separately (`normalizeReferenceData` now backfills `axisTypes`, and the component now shows an actionable message instead of silently rendering nothing on any "no usable axis data" case); (2) Task 9 Step 6's manual on-device verification items for this feature were never added to `docs/manual-testing-checklist.md` until this same 2026-09-02 pass.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `SongAxisEditor`'s silent-failure offline bug, and make create/edit/delete of a song's title/lyrics/notes/keys/axis-values work offline on the native admin tool (`admin/songs` list, `admin/songs/new`, `admin/local/songs/edit`), queued via the existing generic sync-queue engine, with the list viewable from a cache when offline — while leaving every web version of these pages completely unaffected.

**Architecture:** `SongAxisEditor` gains a native branch that reads axis types and lookup options straight out of the already-cached `ReferenceData` instead of five live fetches (extracted into a small pure `resolveAxisEditorData` helper, so it's testable without a DOM). A new dedicated IndexedDB cache stores the last-successfully-loaded songs list; a new pure function overlays the sync-queue's own pending create/update/delete items onto that cached/live list for rendering, and a sibling pure function resolves one song's current fields (base + any still-queued edit) for the edit page. Three new handlers register with the existing `syncQueue.ts` engine (no engine changes). The three page files branch their data-loading and mutation functions on `isNativeApp()` (or, for the native-only edit route, simply always use the offline-safe path) so web keeps its exact current online-only behavior, unchanged. Along the way, `DELETE /api/songs/[id]` is fixed to return a genuine 404 for "song not found" instead of folding it into the same 409 as a real conflict — required for the delete sync handler's idempotent-success handling to actually work.

**Tech Stack:** Next.js App Router (Capacitor/Android native build, shared with a web build of the same routes), IndexedDB, the existing `src/lib/syncQueue.ts` generic write-queue engine, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-offline-song-crud-phase1-design.md`

## Global Constraints

- No changes to `src/lib/syncQueue.ts`'s core engine logic — this plan adds no new export to that file at all; it only adds three new registered handler types via the existing `registerHandler`.
- Testing convention (established throughout this project, confirmed by this plan's own search — `src/db/queries/` and `src/app/api/` have zero existing test files): pure logic in `src/lib/*` with no I/O gets full Vitest coverage; I/O-bound code (IndexedDB, `fetch`-calling sync handlers, API routes, pages) gets none.
- Greek is the UI language throughout — copy any new user-facing string exactly as written in this plan.
- Reuse `CachedSong` (from `songsListCache.ts`), `DisplaySong`/`CreateSongPayload`/`UpdateSongPayload`/`DeleteSongPayload` (from `songsMerge.ts`), and `AxisType`/`Option`/`AxisValueEntry` (from `axisEditorData.ts`) exactly as declared in this plan — do not redeclare equivalent types locally in a page or component.
- **Deviation from the spec, decided during planning (Task 1):** `DELETE /api/songs/[id]` currently maps *every* thrown error — "song not found" included — to a 409 response (`deleteSong()` throws a plain `Error` for both cases; the route's `catch` doesn't distinguish them). The spec's §5 `handleDeleteSongSync` and its own error-handling table assume `res.status === 404` means "already gone" — that branch is unreachable against the code as it stands today. This plan adds a pre-check to the route (mirroring `admin/programs`'s DELETE route, which already checks existence and returns a real 404 before attempting the mutation) so the spec's documented 404-as-success behavior is actually reachable. Without this fix, a delete that syncs after the song is already gone (e.g. deleted from another device) gets misclassified as a permanent conflict, pinning a needsAttention badge forever with no v1 recovery UI.
- **Deviation from the spec, decided during planning (Tasks 2–3):** the spec's §4 declares `AxisValueEntry { axisType: string; refId?: number; yearValue?: number }` (optional fields) and `CreateSongPayload { ...; lyrics: string; notes: string; ... }` (non-nullable). Neither matches reality: `SongAxisEditor.tsx` already exports a *different* `AxisValueEntry` shape (`refId: number | null; yearValue: number | null` — required, nullable), which is also exactly what the server's zod schema (`src/app/api/songs/route.ts`) and `AxisValueInput` (`src/db/queries/axisValues.ts`) expect; and the existing form code already normalizes empty lyrics/notes to `null` before sending (`lyrics || null`), matching the API's `nullable()` schema, not a bare `string`. This plan uses `AxisValueEntry { axisType: string; refId: number | null; yearValue: number | null }` (moved into a new shared module, `src/lib/axisEditorData.ts`, and re-exported from `SongAxisEditor.tsx` for existing importers) and `CreateSongPayload { ...; lyrics: string | null; notes: string | null; ... }` throughout. Building the payload to the spec's literal shape would produce a body the API's zod schema rejects (400 → `item-error` → 3 retries → permanent needsAttention) for every song with axis values or empty lyrics/notes.
- **Deviation from the spec, decided during planning (Task 3):** the spec's §3 says caching `listSongs`'s result "verbatim" (i.e. `CachedSong = SongRow`) covers the list and edit prefill. `SongRow` includes `ownerId`, `createdAt`, and `updatedAt` (the latter two typed `Date` by Drizzle, but arriving through `res.json()` as strings — a type lie no code happens to read today). This plan instead hand-writes `CachedSong` with only the seven fields the list and edit form actually use, matching `programsListCache.ts`'s own `CachedProgram` precedent (a hand-written minimal interface, not a DB-row alias).
- **Deviation from the spec, decided during planning (Task 5):** the spec's Testing section asks for a `SongAxisEditor.test.tsx` that renders the component. This codebase has zero `.test.tsx` files and `vitest.config.ts` sets `environment: 'node'` (no DOM) — adding `jsdom`/`happy-dom` and `@testing-library/react` for one component test is infrastructure the spec never authorized, and importing `SongAxisEditor.tsx` from a test would also pull in `@capacitor/core` via `platform.ts` in a non-browser environment. Instead, this plan extracts the native branch's pure data transformation into `src/lib/axisEditorData.ts` (`resolveAxisEditorData`) and fully unit-tests *that* — covering "native branch reads from a stubbed referenceData ... without any network call" at the data layer. The actual render and the disabled "+ Νέα τιμή" option are left to the manual on-device verification the spec's Testing section already names (Task 9 restates it).
- The Vitest baseline as of planning time is **147 passing tests** (`npm test`, 21 files). Every "Expected: N tests pass" below is derived from that baseline plus this plan's own new tests — if the actual count differs when you run it, trust the actual output and the "all pass, 0 failures" condition, not the specific number written here.

---

### Task 1: Fix `DELETE /api/songs/[id]` to distinguish "not found" (404) from a real conflict (409)

**Files:**
- Modify: `src/app/api/songs/[id]/route.ts:1-4` (imports), `:33-41` (DELETE handler)

**Interfaces:**
- Consumes: `getSongById` from `src/db/queries/songs.ts` (already exists, already used elsewhere in this same file's GET handler).
- Produces: `DELETE /api/songs/[id]` now returns `404 { error: 'Δεν βρέθηκε' }` when the song doesn't exist (or doesn't belong to this owner), and reserves `409` for the two real conflicts `deleteSong()` can still throw (played in a session; is a session's current song) — relied on by Task 4's `handleDeleteSongSync`.

- [ ] **Step 1: Add the `getSongById` import**

In `src/app/api/songs/[id]/route.ts`, change the top import line:

```ts
import { getSongWithAxisValues, updateSong, deleteSong } from '@/db/queries/songs';
```

to:

```ts
import { getSongWithAxisValues, getSongById, updateSong, deleteSong } from '@/db/queries/songs';
```

- [ ] **Step 2: Add the existence check to the DELETE handler**

Replace the existing `DELETE` function:

```ts
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  try {
    await deleteSong(ownerId, Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
```

with:

```ts
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  // Check existence first (mirroring admin/programs's DELETE route) so "already gone" is
  // a real 404, distinct from the two genuine conflicts deleteSong() can still throw for
  // (played in a session; is a session's current song), which stay 409. Without this, a
  // sync-queue delete that lands after the song was already removed elsewhere gets
  // misclassified as a permanent conflict instead of the no-op success it actually is.
  const song = await getSongById(ownerId, Number(id));
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  try {
    await deleteSong(ownerId, Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
```

(`deleteSong()` itself still has its own internal not-found throw as defense-in-depth for the race window between this check and the delete — extremely unlikely in practice, and harmless: it would still surface as a 409 with a clear Greek message, not a crash.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Confirm both existing web callers are unaffected**

Read `src/app/admin/songs/[id]/page.tsx:79-88` and `src/app/admin/local/songs/edit/page.tsx:98-109` (both already read during planning) — both do `const res = await fetch(...); if (!res.ok) { const body = await res.json(); setError(body.error); return; }`, branching only on `res.ok`/the error message, never on the specific status code. A 404 with `{ error: 'Δεν βρέθηκε' }` behaves identically to today's 409 from these two callers' point of view — no visible change on either page. No test needed (this file has no existing test coverage and the project convention is not to add any for API routes).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/songs/[id]/route.ts
git commit -m "Return a real 404 for deleting an already-gone song, not 409"
```

---

### Task 2: Extract axis-editor data resolution into a pure, testable module

**Files:**
- Create: `src/lib/axisEditorData.ts`
- Test: `src/lib/axisEditorData.test.ts`

**Interfaces:**
- Consumes: `ReferenceData` (type-only) from `src/lib/referenceData.ts` (already exists).
- Produces: `AxisType { id: number; key: string; label: string; lookupTable: string | null; hierarchical: boolean }`, `Option { id: number; name: string }`, `AxisValueEntry { axisType: string; refId: number | null; yearValue: number | null }`, and `resolveAxisEditorData(referenceData: ReferenceData): { axisTypes: AxisType[]; optionsByAxis: Record<string, Option[]> }` — all consumed by Task 5 (`SongAxisEditor.tsx`) and, for `AxisValueEntry` only, by Task 3 (`songsMerge.ts`).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/axisEditorData.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveAxisEditorData } from './axisEditorData';
import type { ReferenceData } from './referenceData';

function makeReferenceData(overrides: Partial<ReferenceData> = {}): ReferenceData {
  return {
    songs: [],
    sharedSongs: [],
    axisValues: [],
    regions: [],
    rhythms: [],
    dromoi: [],
    composers: [],
    genres: [],
    axisTypes: [],
    programs: [],
    ...overrides,
  };
}

describe('resolveAxisEditorData', () => {
  it('returns empty axisTypes and optionsByAxis for empty reference data', () => {
    expect(resolveAxisEditorData(makeReferenceData())).toEqual({ axisTypes: [], optionsByAxis: {} });
  });

  it('maps each lookup axis type to its matching referenceData field', () => {
    const referenceData = makeReferenceData({
      axisTypes: [
        { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
        { id: 2, key: 'genre', label: 'Είδος', lookupTable: 'genres', hierarchical: false },
      ],
      regions: [{ id: 10, name: 'Κρήτη', parentId: null, ownerId: null }],
      genres: [{ id: 20, name: 'Δημοτικό', ownerId: null }],
    });
    expect(resolveAxisEditorData(referenceData)).toEqual({
      axisTypes: referenceData.axisTypes,
      optionsByAxis: {
        region: [{ id: 10, name: 'Κρήτη', parentId: null, ownerId: null }],
        genre: [{ id: 20, name: 'Δημοτικό', ownerId: null }],
      },
    });
  });

  it('leaves a non-lookup axis type (e.g. year) with no optionsByAxis entry', () => {
    const referenceData = makeReferenceData({
      axisTypes: [{ id: 3, key: 'year', label: 'Έτος', lookupTable: null, hierarchical: false }],
    });
    expect(resolveAxisEditorData(referenceData)).toEqual({ axisTypes: referenceData.axisTypes, optionsByAxis: {} });
  });

  it('covers all five lookup fields', () => {
    const referenceData = makeReferenceData({
      axisTypes: [
        { id: 1, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
        { id: 2, key: 'dromos', label: 'Δρόμος', lookupTable: 'dromoi', hierarchical: false },
        { id: 3, key: 'composer', label: 'Συνθέτης', lookupTable: 'composers', hierarchical: false },
      ],
      rhythms: [{ id: 30, name: 'Συρτός', ownerId: null }],
      dromoi: [{ id: 40, name: 'Ουσάκ', ownerId: null }],
      composers: [{ id: 50, name: 'Ανώνυμος', ownerId: null }],
    });
    expect(resolveAxisEditorData(referenceData).optionsByAxis).toEqual({
      rhythm: [{ id: 30, name: 'Συρτός', ownerId: null }],
      dromos: [{ id: 40, name: 'Ουσάκ', ownerId: null }],
      composer: [{ id: 50, name: 'Ανώνυμος', ownerId: null }],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/axisEditorData.test.ts`
Expected: FAIL — `Cannot find module './axisEditorData'` (the file doesn't exist yet).

- [ ] **Step 3: Implement the module**

Create `src/lib/axisEditorData.ts`:

```ts
// src/lib/axisEditorData.ts
import type { ReferenceData } from './referenceData';

export interface AxisType {
  id: number;
  key: string;
  label: string;
  lookupTable: string | null;
  hierarchical: boolean;
}

export interface Option {
  id: number;
  name: string;
}

export interface AxisValueEntry {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

// The five lookup tables an axis type can point at — same set SongAxisEditor's web
// branch fetches individually (see LOOKUP_ENDPOINTS there), and, not by coincidence,
// exactly the field names ReferenceData already carries them under.
const LOOKUP_FIELDS = ['regions', 'genres', 'rhythms', 'dromoi', 'composers'] as const;
type LookupField = (typeof LOOKUP_FIELDS)[number];

function isLookupField(value: string): value is LookupField {
  return (LOOKUP_FIELDS as readonly string[]).includes(value);
}

// Pure — no I/O, no fetch. Turns a cached ReferenceData blob into exactly the shape
// SongAxisEditor's native branch needs to render: every axis type, and for each one that
// has a lookupTable, that table's already-owner-scoped options straight from the cache
// (src/app/api/reference-data/route.ts already filters regions/genres/rhythms/dromoi/
// composers to what this user can see — no re-filtering needed here). Total on its input:
// an axis type whose lookupTable isn't one of the five known fields is still included in
// axisTypes with no entry in optionsByAxis — SongAxisEditor's `optionsByAxis[key] ?? []`
// already treats a missing entry as no options, so this never needs to throw.
export function resolveAxisEditorData(referenceData: ReferenceData): { axisTypes: AxisType[]; optionsByAxis: Record<string, Option[]> } {
  const optionsByAxis: Record<string, Option[]> = {};
  for (const type of referenceData.axisTypes) {
    if (type.lookupTable && isLookupField(type.lookupTable)) {
      optionsByAxis[type.key] = referenceData[type.lookupTable];
    }
  }
  return { axisTypes: referenceData.axisTypes, optionsByAxis };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/axisEditorData.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all previously-passing tests still pass, plus the 4 new ones (151 total against the 147 baseline).

- [ ] **Step 6: Commit**

```bash
git add src/lib/axisEditorData.ts src/lib/axisEditorData.test.ts
git commit -m "Extract pure axis-editor data resolution for offline reuse"
```

---

### Task 3: Songs list cache and pending-merge helper

**Files:**
- Create: `src/lib/songsListCache.ts`
- Create: `src/lib/songsMerge.ts`
- Test: `src/lib/songsMerge.test.ts`

**Interfaces:**
- Consumes: `QueuedAction` from `src/lib/syncQueue.ts` (already exists); `AxisValueEntry` (type-only) from `src/lib/axisEditorData.ts` (Task 2).
- Produces:
  - `CachedSong { id: number; title: string; lyrics: string | null; imageUrl: string | null; notes: string | null; maleKey: string | null; femaleKey: string | null }`, `saveSongsListCache(songs: CachedSong[]): Promise<void>`, `loadSongsListCache(): Promise<CachedSong[] | null>` from `songsListCache.ts` — used by Task 6 and Task 8.
  - `CreateSongPayload { title: string; lyrics: string | null; imageUrl: string | null; notes: string | null; maleKey: string | null; femaleKey: string | null; axisValues: AxisValueEntry[] }`, `UpdateSongPayload extends CreateSongPayload { songId: number }`, `DeleteSongPayload { songId: number }` from `songsMerge.ts` — used by Task 4 (sync handlers) and Tasks 7–8 (pages).
  - `DisplaySong { id: number | null; title: string; lyrics: string | null; status: 'active' | 'pending-create' | 'edited' | 'needs-attention-create' | 'needs-attention-edit' }` — note `lyrics` is carried through so the list's existing "λείπουν στίχοι" badge keeps working post-merge (the spec's own `DisplaySong` sketch omitted it; this plan adds it back since nothing in the spec asks to drop that indicator). There is no `'needs-attention-delete'` status, matching sub-project #6's identical `DisplayProgram` precedent: a permanently-failed delete reappears as a plain `'active'` row (see the merge function's own logic below), it is not tagged differently from a row that was never touched.
  - `isSongQueueAction(action: QueuedAction): boolean`, `mergeSongsWithPending(base: CachedSong[], allQueuedActions: QueuedAction[]): DisplaySong[]`, `resolveSongForEdit(songId: number, base: CachedSong | null, baseAxisValues: AxisValueEntry[], allQueuedActions: QueuedAction[]): { song: CreateSongPayload | null; hasPendingEdit: boolean }` from `songsMerge.ts` — used by Task 6 (`mergeSongsWithPending`, `isSongQueueAction`) and Task 8 (`resolveSongForEdit`). Note `resolveSongForEdit` takes `baseAxisValues` as an explicit fourth parameter — it does not reach into `ReferenceData` itself; the caller (Task 8) filters `referenceData.axisValues` by `songId` first.

- [ ] **Step 1: Create the dedicated IndexedDB cache module**

Create `src/lib/songsListCache.ts`:

```ts
// src/lib/songsListCache.ts

export interface CachedSong {
  id: number;
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database, `glentify-sync-queue`, sub-project #4's `glentify-collaborators-cache`, or
// sub-project #6's `glentify-programs-list-cache` — same reasoning established in those
// modules: two independent modules coordinating IndexedDB version upgrades on one shared
// database is a real risk to whatever that database already holds. A second, small,
// single-purpose database avoids that risk entirely.
const DB_NAME = 'glentify-songs-list-cache';
const DB_VERSION = 1;
const STORE_NAME = 'songs-list';
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

export async function saveSongsListCache(songs: CachedSong[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(songs, LIST_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSongsListCache(): Promise<CachedSong[] | null> {
  const db = await openDb();
  const result = await new Promise<CachedSong[] | undefined>((resolve, reject) => {
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

Create `src/lib/songsMerge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeSongsWithPending, resolveSongForEdit } from './songsMerge';
import type { QueuedAction } from './syncQueue';
import type { CachedSong } from './songsListCache';
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
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/lib/songsMerge.test.ts`
Expected: FAIL — `Cannot find module './songsMerge'` (the file doesn't exist yet).

- [ ] **Step 4: Implement the pending-merge helper**

Create `src/lib/songsMerge.ts`:

```ts
// src/lib/songsMerge.ts
import type { QueuedAction } from './syncQueue';
import type { CachedSong } from './songsListCache';
import type { AxisValueEntry } from './axisEditorData';

export interface CreateSongPayload {
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  axisValues: AxisValueEntry[];
}

export interface UpdateSongPayload extends CreateSongPayload {
  songId: number;
}

export interface DeleteSongPayload {
  songId: number;
}

export interface DisplaySong {
  id: number | null; // null for a pending create — no server-assigned id yet
  title: string;
  lyrics: string | null; // carried through so the list's existing "λείπουν στίχοι" badge still works post-merge
  status: 'active' | 'pending-create' | 'edited' | 'needs-attention-create' | 'needs-attention-edit';
}

const SONG_ACTION_TYPES = new Set(['song-create', 'song-update', 'song-delete']);

// Reused by the list page's pending-actions effect to count how many of this feature's
// own actions are currently queued — same predicate this function uses internally, so
// the two never disagree about what counts.
export function isSongQueueAction(action: QueuedAction): boolean {
  return SONG_ACTION_TYPES.has(action.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

// Pure — no I/O. Same shape of rules as mergeProgramsWithPending (sub-project #6):
// - a pending delete hides its row (optimistic hide); a needsAttention delete instead
//   reappears as a normal active row — these 409s are genuinely permanent (song already
//   played in a session, or is a session's current song, per deleteSong's own documented
//   conflict cases), so hiding it forever would misrepresent server state for a deletion
//   that never actually happened
// - a pending edit overlays its title/lyrics onto the existing row (status 'edited'); a
//   needsAttention edit reverts to the last-known real fields with a distinct failed tag
//   instead of silently keeping unconfirmed data forever
// - a pending create appends a row with id: null, not clickable in the UI layer (this
//   function only marks status; the page enforces non-navigability)
// When the same song has more than one queued 'song-update' (edited twice offline before
// either synced), the later one in queue order wins, since it overwrites the map entry
// set by the earlier one.
// A malformed payload (wrong shape, e.g. restored from IndexedDB) is skipped rather than
// thrown on, since this function runs on the render path.
export function mergeSongsWithPending(base: CachedSong[], allQueuedActions: QueuedAction[]): DisplaySong[] {
  const edits = new Map<number, { title: string; lyrics: string | null; needsAttention: boolean }>();
  const deletes = new Map<number, boolean>(); // songId -> needsAttention
  const creates: { title: string; lyrics: string | null; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (!isRecord(action.payload)) continue;
    const payload = action.payload;
    if (action.type === 'song-update') {
      const { songId, title, lyrics } = payload;
      if (typeof songId === 'number' && typeof title === 'string' && isNullableString(lyrics)) {
        edits.set(songId, { title, lyrics, needsAttention: action.needsAttention });
      }
    } else if (action.type === 'song-delete') {
      const { songId } = payload;
      if (typeof songId === 'number') {
        deletes.set(songId, action.needsAttention);
      }
    } else if (action.type === 'song-create') {
      const { title, lyrics } = payload;
      if (typeof title === 'string' && isNullableString(lyrics)) {
        creates.push({ title, lyrics, needsAttention: action.needsAttention });
      }
    }
  }

  const result: DisplaySong[] = [];

  for (const song of base) {
    const del = deletes.get(song.id);
    if (del === false) continue; // pending, not yet flagged — optimistically hidden
    if (del === true) {
      result.push({ id: song.id, title: song.title, lyrics: song.lyrics, status: 'active' });
      continue;
    }
    const edit = edits.get(song.id);
    if (edit) {
      result.push({
        id: song.id,
        title: edit.needsAttention ? song.title : edit.title,
        lyrics: edit.needsAttention ? song.lyrics : edit.lyrics,
        status: edit.needsAttention ? 'needs-attention-edit' : 'edited',
      });
      continue;
    }
    result.push({ id: song.id, title: song.title, lyrics: song.lyrics, status: 'active' });
  }

  for (const create of creates) {
    result.push({
      id: null,
      title: create.title,
      lyrics: create.lyrics,
      status: create.needsAttention ? 'needs-attention-create' : 'pending-create',
    });
  }

  return result;
}

// Used by the edit page (not the list) to resolve one song's current display fields: the
// cached base row overlaid with its own still-queued update, if any, so reopening a song
// mid-sync never silently shows pre-edit data. `baseAxisValues` is supplied by the
// caller (filtered from referenceData.axisValues by songId) — this function has one
// input shape and doesn't reach into ReferenceData itself, matching resolveSongForEdit's
// sibling mergeSongsWithPending. If more than one 'song-update' is queued for this
// songId, the last one in queue order wins (most recent edit).
export function resolveSongForEdit(
  songId: number,
  base: CachedSong | null,
  baseAxisValues: AxisValueEntry[],
  allQueuedActions: QueuedAction[]
): { song: CreateSongPayload | null; hasPendingEdit: boolean } {
  let pendingEdit: QueuedAction | undefined;
  for (const action of allQueuedActions) {
    if (action.type !== 'song-update' || !isRecord(action.payload)) continue;
    if ((action.payload as Record<string, unknown>).songId === songId) pendingEdit = action;
  }

  if (pendingEdit && !pendingEdit.needsAttention) {
    const payload = pendingEdit.payload as UpdateSongPayload;
    return {
      song: {
        title: payload.title,
        lyrics: payload.lyrics,
        imageUrl: payload.imageUrl,
        notes: payload.notes,
        maleKey: payload.maleKey,
        femaleKey: payload.femaleKey,
        axisValues: payload.axisValues,
      },
      hasPendingEdit: true,
    };
  }

  if (!base) return { song: null, hasPendingEdit: false };

  return {
    song: {
      title: base.title,
      lyrics: base.lyrics,
      imageUrl: base.imageUrl,
      notes: base.notes,
      maleKey: base.maleKey,
      femaleKey: base.femaleKey,
      axisValues: baseAxisValues,
    },
    hasPendingEdit: false,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/songsMerge.test.ts`
Expected: PASS — 13 tests (9 for `mergeSongsWithPending`, 4 for `resolveSongForEdit`).

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all previously-passing tests still pass, plus the 13 new ones (164 total against the 151 from Task 2).

- [ ] **Step 7: Commit**

```bash
git add src/lib/songsListCache.ts src/lib/songsMerge.ts src/lib/songsMerge.test.ts
git commit -m "Add offline songs list cache and pending-merge helper"
```

---

### Task 4: Sync handlers for create/update/delete song

**Files:**
- Modify: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `CreateSongPayload`, `UpdateSongPayload`, `DeleteSongPayload` from `src/lib/songsMerge.ts` (Task 3); `registerHandler`, `SyncOutcome` from `src/lib/syncQueue.ts` (already imported in this file); `nativeApiFetch` (already imported in this file); Task 1's fixed `DELETE /api/songs/[id]` route (a real 404 for "not found").
- Produces: three new registered handler types, `'song-create'`, `'song-update'`, `'song-delete'` — used by Tasks 7–8's `enqueue()` calls.

- [ ] **Step 1: Add the import**

In `src/lib/syncHandlers.ts`, add this import line alongside the existing `programsMerge` import (both near the top of the file):

```ts
import type { CreateSongPayload, UpdateSongPayload, DeleteSongPayload } from './songsMerge';
```

- [ ] **Step 2: Add the three handler functions**

Add these three functions after `handleDeleteProgramSync` and before the `// The single place every sync-queue action type gets registered.` comment:

```ts
async function handleCreateSongSync(payload: unknown): Promise<SyncOutcome> {
  const body = payload as CreateSongPayload;
  const res = await nativeApiFetch(
    '/api/songs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleUpdateSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId, ...body } = payload as UpdateSongPayload;
  const res = await nativeApiFetch(
    `/api/songs/${encodeURIComponent(songId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already gone (deleted elsewhere before this update synced) — the desired end state
  // can't be reached, but there's nothing left to update either; matches
  // handleDeleteProgramSync's 404-as-success precedent.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleDeleteSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId } = payload as DeleteSongPayload;
  const res = await nativeApiFetch(
    `/api/songs/${encodeURIComponent(songId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already gone — the desired end state is already true. Reachable as a genuine 404
  // since Task 1 fixed the route to distinguish "not found" from a real conflict.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  // 409: a real, permanent conflict (song already played in a session, or is a session's
  // current song — deleteSong's own documented conflict cases). item-error, retried up
  // to the existing cap, then needsAttention; mergeSongsWithPending's needs-attention
  // delete case makes the row reappear rather than staying hidden once this happens.
  return 'item-error';
}
```

- [ ] **Step 3: Register the three handlers**

Inside `initSyncHandlers()`, add these three lines after the existing `program-*` registrations:

```ts
  registerHandler('song-create', handleCreateSongSync);
  registerHandler('song-update', handleUpdateSongSync);
  registerHandler('song-delete', handleDeleteSongSync);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Functional check of the status-code classification**

No unit test for this file, matching the existing untested handlers already in it — but the 404-as-success special cases for update and delete are worth a direct functional check, the same way sub-project #6 verified its own.

Create a throwaway script (not committed), e.g. `/private/tmp/claude-502/-Users-george-farantos-Projects-Personal-glentify/a3d1bb20-5943-4d43-b60b-2384cb60290d/scratchpad/check-song-handlers.ts` (or any scratch path outside `src/`):

```ts
// Throwaway verification script — not part of the codebase.
import { enqueueTo, processQueueWith } from '/absolute/path/to/repo/src/lib/syncQueue';
// (use the correct absolute or relative path to src/lib/syncQueue.ts from wherever you place this file)

async function run() {
  const cases: Record<string, { type: string; status: number }> = {
    'create-ok': { type: 'song-create', status: 201 },
    'create-500': { type: 'song-create', status: 500 },
    'update-ok': { type: 'song-update', status: 200 },
    'update-404': { type: 'song-update', status: 404 },
    'delete-ok': { type: 'song-delete', status: 200 },
    'delete-404': { type: 'song-delete', status: 404 },
    'delete-409': { type: 'song-delete', status: 409 },
  };

  for (const [label, { type, status }] of Object.entries(cases)) {
    const storage = {
      actions: [] as any[],
      async get() { return this.actions; },
      async set(a: any[]) { this.actions = a; },
    };
    const payload =
      type === 'song-create' ? { title: 'x' } : type === 'song-update' ? { songId: 1, title: 'x' } : { songId: 1 };
    await enqueueTo(storage, type, payload);

    const handler = async () => {
      const res = { ok: status >= 200 && status < 300, status } as Response;
      if (res.ok) return 'success' as const;
      if ((type === 'song-update' || type === 'song-delete') && status === 404) return 'success' as const;
      if (status === 401 || status >= 500) return 'systemic-error' as const;
      return 'item-error' as const;
    };

    const result = await processQueueWith(storage, new Map([[type, handler]]));
    console.log(label, '->', JSON.stringify(result));
  }
}

run();
```

Run: `npx tsx <path-to-script>` (adjusting the import path to match where you placed it relative to `src/lib/syncQueue.ts`)

Expected output — `create-ok`, `update-ok`, `update-404`, `delete-ok`, `delete-404` all show `"processed":1,"remaining":0` (treated as success); `create-500` shows `"blocked":true,"remaining":1` (systemic-error); `delete-409` shows `"processed":0,"remaining":1,"needsAttention":0` (item-error, not treated as success — only 404 gets the idempotent-success shortcut, 409 does not). Delete the throwaway script afterward.

- [ ] **Step 6: Commit**

```bash
git add src/lib/syncHandlers.ts
git commit -m "Add sync handlers for offline song create/update/delete"
```

---

### Task 5: `SongAxisEditor.tsx` offline native fix

**Files:**
- Modify: `src/components/SongAxisEditor.tsx` (full-file rewrite — see Step 1)

**Interfaces:**
- Consumes: `resolveAxisEditorData`, `AxisType`, `Option`, `AxisValueEntry` from `src/lib/axisEditorData.ts` (Task 2); `isNativeApp` from `src/lib/platform.ts` (already exists); `loadReferenceData` from `src/lib/offlineCache.ts` (already exists).
- Produces: `SongAxisEditor` (default export, unchanged props signature) still re-exports `AxisValueEntry` as a named type export, so the three existing importers (`src/app/admin/songs/new/page.tsx`, `src/app/admin/local/songs/edit/page.tsx`, `src/app/admin/songs/[id]/page.tsx`) need zero changes to their `import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor'` lines.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `src/components/SongAxisEditor.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { loadReferenceData } from '@/lib/offlineCache';
import { resolveAxisEditorData } from '@/lib/axisEditorData';
import type { AxisType, Option, AxisValueEntry } from '@/lib/axisEditorData';

export type { AxisValueEntry };

const LOOKUP_ENDPOINTS: Record<string, string> = {
  regions: '/api/regions',
  genres: '/api/genres',
  rhythms: '/api/rhythms',
  dromoi: '/api/dromoi',
  composers: '/api/composers',
};

export default function SongAxisEditor({
  value,
  onChange,
}: {
  value: AxisValueEntry[];
  onChange: (value: AxisValueEntry[]) => void;
}) {
  const [axisTypes, setAxisTypes] = useState<AxisType[]>([]);
  const [optionsByAxis, setOptionsByAxis] = useState<Record<string, Option[]>>({});
  const [referenceDataMissing, setReferenceDataMissing] = useState(false);
  const [newAxisType, setNewAxisType] = useState('');
  const [newRefId, setNewRefId] = useState('');
  const [newYear, setNewYear] = useState('');
  const [creatingValue, setCreatingValue] = useState(false);
  const [newValueName, setNewValueName] = useState('');

  useEffect(() => {
    if (isNativeApp()) {
      // Offline-safe: reads the already-cached ReferenceData blob instead of the five
      // live fetches below, so this renders correctly with no network at all — the fix
      // for "Κανένας άξονας ακόμη" swallowing the whole "+ Πρόσθεσε άξονα" UI offline.
      loadReferenceData().then((data) => {
        if (!data) {
          setAxisTypes([]);
          setOptionsByAxis({});
          setReferenceDataMissing(true);
          return;
        }
        const { axisTypes: types, optionsByAxis: options } = resolveAxisEditorData(data);
        setAxisTypes(types);
        setOptionsByAxis(options);
        setReferenceDataMissing(false);
      });
      return;
    }
    nativeApiFetch('/api/axis-types')
      .then((r) => r.json())
      .then(async (types: AxisType[]) => {
        setAxisTypes(types);
        const entries = await Promise.all(
          types
            .filter((t) => t.lookupTable)
            .map(async (t) => {
              const res = await nativeApiFetch(LOOKUP_ENDPOINTS[t.lookupTable as string]);
              const options: Option[] = await res.json();
              return [t.key, options] as const;
            })
        );
        setOptionsByAxis(Object.fromEntries(entries));
      });
  }, []);

  const usedAxisTypes = new Set(value.map((v) => v.axisType));
  const availableAxisTypes = axisTypes.filter((t) => !usedAxisTypes.has(t.key));
  const selectedType = axisTypes.find((t) => t.key === newAxisType);

  function labelFor(entry: AxisValueEntry): string {
    const axisType = axisTypes.find((t) => t.key === entry.axisType);
    if (!axisType) return entry.axisType;
    if (axisType.key === 'year') return `${axisType.label}: ${entry.yearValue}`;
    const options = optionsByAxis[axisType.key] ?? [];
    const option = options.find((o) => o.id === entry.refId);
    return `${axisType.label}: ${option?.name ?? entry.refId}`;
  }

  function handleAdd() {
    if (!selectedType) return;
    if (selectedType.key === 'year') {
      if (!newYear) return;
      onChange([...value, { axisType: selectedType.key, refId: null, yearValue: Number(newYear) }]);
    } else {
      if (!newRefId) return;
      onChange([...value, { axisType: selectedType.key, refId: Number(newRefId), yearValue: null }]);
    }
    setNewAxisType('');
    setNewRefId('');
    setNewYear('');
  }

  function handleRemove(axisType: string) {
    onChange(value.filter((v) => v.axisType !== axisType));
  }

  async function handleCreateValue() {
    if (!selectedType?.lookupTable || !newValueName.trim()) return;
    const endpoint = LOOKUP_ENDPOINTS[selectedType.lookupTable];
    const body = selectedType.lookupTable === 'regions' ? { name: newValueName.trim(), parentId: null } : { name: newValueName.trim() };
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

  return (
    <div className="card border border-base-300 bg-base-100">
      <div className="card-body gap-2 p-4">
        <span className="text-sm font-semibold text-base-content/70">Άξονες / Tags</span>
        <div className="flex flex-wrap gap-2">
          {value.map((entry) => (
            <span key={entry.axisType} className="badge badge-lg badge-outline gap-2">
              {labelFor(entry)}
              <button
                type="button"
                onClick={() => handleRemove(entry.axisType)}
                aria-label="Αφαίρεση"
                className="cursor-pointer text-error"
              >
                ✕
              </button>
            </span>
          ))}
          {value.length === 0 && <span className="text-sm text-base-content/40">Κανένας άξονας ακόμη</span>}
        </div>
        {availableAxisTypes.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <select
              value={newAxisType}
              onChange={(e) => {
                setNewAxisType(e.target.value);
                setNewRefId('');
                setNewYear('');
                setCreatingValue(false);
                setNewValueName('');
              }}
              className="select select-bordered select-sm"
            >
              <option value="">+ Πρόσθεσε άξονα...</option>
              {availableAxisTypes.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            {selectedType?.key === 'year' && (
              <input
                type="number"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                placeholder="Έτος"
                className="input input-bordered input-sm w-28"
              />
            )}
            {selectedType && selectedType.key !== 'year' && (
              <>
                <select
                  value={creatingValue ? '__new__' : newRefId}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setCreatingValue(true);
                      setNewRefId('');
                    } else {
                      setCreatingValue(false);
                      setNewRefId(e.target.value);
                    }
                  }}
                  className="select select-bordered select-sm"
                >
                  <option value="">Τιμή...</option>
                  {(optionsByAxis[selectedType.key] ?? []).map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                  <option value="__new__" disabled={isNativeApp()}>+ Νέα τιμή...</option>
                </select>
                {isNativeApp() && (
                  <span className="text-xs text-base-content/50">Νέες τιμές μόνο από την ιστοσελίδα διαχείρισης προς το παρόν.</span>
                )}
                {creatingValue && (
                  <>
                    <input
                      type="text"
                      value={newValueName}
                      onChange={(e) => setNewValueName(e.target.value)}
                      placeholder="Όνομα νέας τιμής"
                      className="input input-bordered input-sm"
                    />
                    <button type="button" onClick={handleCreateValue} className="btn btn-secondary btn-sm">Δημιουργία</button>
                  </>
                )}
              </>
            )}
            {selectedType && (
              <button type="button" onClick={handleAdd} className="btn btn-primary btn-sm">
                Προσθήκη
              </button>
            )}
          </div>
        ) : referenceDataMissing ? (
          <span className="text-sm text-warning">Δεν υπάρχουν ακόμη αποθηκευμένα δεδομένα αξόνων — συνδέσου μία φορά για να συγχρονιστούν.</span>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/components/SongAxisEditor.tsx`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: same as after Task 3 (this task adds no new tests — no `.test.tsx` infra is being added, per the Global Constraints deviation note) — all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/components/SongAxisEditor.tsx
git commit -m "Fix SongAxisEditor to read axis types/options from cache when native"
```

---

### Task 6: Wire the songs list page for offline cache + pending overlay (native only)

**Files:**
- Modify: `src/app/admin/songs/page.tsx` (full-file rewrite — see Step 1)

**Interfaces:**
- Consumes: `saveSongsListCache`, `loadSongsListCache`, `CachedSong` from `src/lib/songsListCache.ts` (Task 3); `mergeSongsWithPending`, `isSongQueueAction` from `src/lib/songsMerge.ts` (Task 3); `getQueuedActions` from `src/lib/syncQueue.ts` (already exists); `useSyncQueue` from `src/components/SyncQueueProvider.tsx` (already exists); `isNativeApp` from `src/lib/platform.ts` (already imported in this file today).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `src/app/admin/songs/page.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditSongId } from '@/lib/adminEditStore';
import { getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import { saveSongsListCache, loadSongsListCache } from '@/lib/songsListCache';
import type { CachedSong } from '@/lib/songsListCache';
import { mergeSongsWithPending, isSongQueueAction } from '@/lib/songsMerge';

export default function SongsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [songs, setSongs] = useState<CachedSong[]>([]);
  const [search, setSearch] = useState('');
  const [offlineSongs, setOfflineSongs] = useState(false);
  const [songsUnavailable, setSongsUnavailable] = useState(false);
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
  const { pendingCount } = useSyncQueue();

  async function load(q: string) {
    const url = q ? `/api/songs?search=${encodeURIComponent(q)}` : '/api/songs';
    if (!native) {
      const res = await nativeApiFetch(url);
      setSongs(await res.json());
      return;
    }
    try {
      const res = await nativeApiFetch(url);
      const data: CachedSong[] = await res.json();
      setSongs(data);
      setOfflineSongs(false);
      setSongsUnavailable(false);
      // Only the unfiltered list is a safe base to cache — caching a search result would
      // silently truncate the offline list to whatever was last searched for.
      if (!q) {
        try {
          await saveSongsListCache(data);
        } catch {
          // A cache-write failure must not affect the already-successful state above.
        }
      }
    } catch {
      const cached = await loadSongsListCache().catch(() => null);
      if (cached) {
        const filtered = q ? cached.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())) : cached;
        setSongs(filtered);
        setOfflineSongs(true);
        setSongsUnavailable(false);
      } else {
        setSongsUnavailable(true);
      }
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load('');
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  async function handleOpenSong(id: number) {
    await setSelectedEditSongId(preferencesStore, id);
    router.push('/admin/local/songs/edit');
  }

  // Tracks this feature's own count of currently-queued, still-retryable song actions
  // (needsAttention ones excluded — those never leave the queue, so counting them would
  // mean the >0 -> 0 transition below could never fire again once one gets stuck) so we
  // can detect "this list's queue just drained" and refresh the base list from the
  // server. This exclusion is the explicit re-check baked in from the start — sub-project
  // #6's equivalent programs-list effect shipped without it.
  const prevPendingSongCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!native) return;
    getQueuedActions()
      .then((actions) => {
        setPendingActions(actions);
        const thisFeatureCount = actions.filter((a) => isSongQueueAction(a) && !a.needsAttention).length;
        const prevCount = prevPendingSongCountRef.current;
        prevPendingSongCountRef.current = thisFeatureCount;
        if (prevCount !== null && prevCount > 0 && thisFeatureCount === 0) {
          load(search);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount]);

  const displaySongs = mergeSongsWithPending(songs, pendingActions);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Τραγούδια</h1>
        <Link href="/admin/songs/new" className="btn btn-primary">Νέο τραγούδι</Link>
      </div>
      {songsUnavailable && <p className="text-sm text-base-content/50">Άγνωστο χωρίς σύνδεση.</p>}
      {offlineSongs && <p className="text-sm text-warning">Χωρίς σύνδεση — τελευταία γνωστά δεδομένα.</p>}
      {!songsUnavailable && (
        <>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Αναζήτηση τίτλου" className="input input-bordered flex-1" />
            <button type="submit" className="btn">Αναζήτηση</button>
          </form>
          <ul className="list rounded-box bg-base-100 shadow">
            {displaySongs.map((s, i) => (
              <li key={s.id ?? `pending-${i}-${s.title}`} className="list-row items-center gap-2">
                {s.id === null ? (
                  <span className="text-base-content/50">{s.title}</span>
                ) : native ? (
                  <button onClick={() => handleOpenSong(s.id as number)} className="link link-hover text-left">{s.title}</button>
                ) : (
                  <Link href={`/admin/songs/${s.id}`} className="link link-hover">{s.title}</Link>
                )}
                {!s.lyrics && <span className="badge badge-warning badge-sm">λείπουν στίχοι</span>}
                {s.status === 'pending-create' && <span className="text-xs text-base-content/50">Θα είναι διαθέσιμο μόλις συγχρονιστεί.</span>}
                {s.status === 'needs-attention-create' && <span className="text-xs text-error">Απέτυχε η δημιουργία.</span>}
                {s.status === 'edited' && <span className="text-xs text-base-content/50">Θα ενημερωθεί μόλις υπάρξει σύνδεση.</span>}
                {s.status === 'needs-attention-edit' && <span className="text-xs text-error">Απέτυχε η ενημέρωση.</span>}
              </li>
            ))}
            {displaySongs.length === 0 && <li className="list-row text-base-content/50">Κανένα τραγούδι ακόμη</li>}
          </ul>
        </>
      )}
    </div>
  );
}
```

Note: `native` is `false` on web, so the pending-actions effect's `if (!native) return;` guard means `pendingActions` never leaves `[]` there — `mergeSongsWithPending` reduces to an identity pass-through (`status: 'active'` on every row), and `load()`'s `if (!native)` branch keeps web's exact original behavior (no cache, no try/catch).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/app/admin/songs/page.tsx`
Expected: no errors. If the `react-hooks/exhaustive-deps` disable comment is reported as unused, remove it (matching sub-project #6's established handling of this exact situation) rather than leave a dead suppression.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: same as after Task 5 — this task adds no new tests (pages don't get tests, per convention) — all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/songs/page.tsx
git commit -m "Make songs list render from cache offline with pending-action overlay (native only)"
```

---

### Task 7: Wire the new-song page for offline create (native only)

**Files:**
- Modify: `src/app/admin/songs/new/page.tsx` (full-file rewrite — see Step 1)

**Interfaces:**
- Consumes: `enqueue` from `src/lib/syncQueue.ts` (already exists); `useSyncQueue` from `src/components/SyncQueueProvider.tsx` (already exists); `isNativeApp` from `src/lib/platform.ts`.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `src/app/admin/songs/new/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import PageNav from '@/components/PageNav';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { apiUrl } from '@/lib/apiClient';
import { getAuthToken } from '@/lib/authToken';
import { isNativeApp } from '@/lib/platform';
import { enqueue } from '@/lib/syncQueue';
import { useSyncQueue } from '@/components/SyncQueueProvider';

export default function NewSongPage() {
  const router = useRouter();
  const native = isNativeApp();
  const { notifyQueueChanged } = useSyncQueue();
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [notes, setNotes] = useState('');
  const [maleKey, setMaleKey] = useState('');
  const [femaleKey, setFemaleKey] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: apiUrl('/api/songs/image-upload'),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      setImageUrl(blob.url);
    } catch {
      setError('Αποτυχία μεταφόρτωσης εικόνας');
    } finally {
      setUploading(false);
    }
  }

  interface SuggestionSong {
    id: number;
    title: string;
    lyrics: string | null;
    notes: string | null;
    maleKey: string | null;
    femaleKey: string | null;
    axisValues: AxisValueEntry[];
  }

  const [suggestions, setSuggestions] = useState<SuggestionSong[]>([]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (title.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      nativeApiFetch(`/api/songs/suggestions?title=${encodeURIComponent(title.trim())}`)
        .then((r) => r.json())
        .then(setSuggestions);
    }, 300);
    return () => clearTimeout(timeout);
  }, [title]);

  function applySuggestion(s: SuggestionSong) {
    setLyrics(s.lyrics ?? '');
    setNotes(s.notes ?? '');
    setMaleKey(s.maleKey ?? '');
    setFemaleKey(s.femaleKey ?? '');
    setAxisValues(s.axisValues);
    setSuggestions([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const body = {
      title,
      lyrics: lyrics || null,
      notes: notes || null,
      maleKey: maleKey || null,
      femaleKey: femaleKey || null,
      axisValues,
      // Phase 1 never lets native pick a new image (see the disabled file input below) —
      // always null there, regardless of what web's upload flow may have set.
      imageUrl: native ? null : imageUrl,
    };
    if (native) {
      try {
        await enqueue('song-create', body);
      } catch {
        setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
        return;
      }
      await notifyQueueChanged();
      router.push('/admin/songs');
      return;
    }
    const res = await nativeApiFetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
      <h1 className="text-xl font-bold">Νέο τραγούδι</h1>
      {error && (
        <div role="alert" className="alert alert-error max-w-2xl">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Τίτλος" className="input input-bordered" required />
        {suggestions.length > 0 && (
          <div className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-3">
            <p className="text-sm font-semibold">Βρέθηκαν παρόμοια τραγούδια — χρησιμοποίησε ένα ως βάση:</p>
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span>{s.title}</span>
                <button type="button" onClick={() => applySuggestion(s)} className="btn btn-sm btn-outline">
                  Χρησιμοποίησε ως βάση
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Στίχοι (προαιρετικό, μπορούν να προστεθούν αργότερα)"
          className="textarea textarea-bordered h-48"
        />
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} disabled={native} className="file-input file-input-bordered" />
          {native && <span className="text-xs text-base-content/50">Η προσθήκη εικόνας από τη native εφαρμογή δεν υποστηρίζεται ακόμη — χρησιμοποίησε την ιστοσελίδα διαχείρισης.</span>}
          {uploading && <span className="loading loading-spinner loading-sm" />}
          {imageUrl && <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />}
        </div>
        <SongAxisEditor value={axisValues} onChange={setAxisValues} />
        <div className="flex gap-3">
          <input value={maleKey} onChange={(e) => setMaleKey(e.target.value)} placeholder="Τόνος (άντρας)" className="input input-bordered flex-1" />
          <input value={femaleKey} onChange={(e) => setFemaleKey(e.target.value)} placeholder="Τόνος (γυναίκα)" className="input input-bordered flex-1" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="input input-bordered" />
        <button type="submit" className="btn btn-primary">Αποθήκευση</button>
      </form>
    </div>
  );
}
```

Note: `imageUrl` can only ever be set on native if `handleImageChange` fires, which it can't while the file input is `disabled` — so `imageUrl && <img .../>` never renders on native either, no extra guard needed there. The title-suggestions live fetch (`useEffect` above `applySuggestion`) is intentionally left untouched — offline suggestions are out of this spec's scope; it simply returns no suggestions offline, same as any other transient fetch failure today.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/app/admin/songs/new/page.tsx`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: same as after Task 6 — all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/songs/new/page.tsx
git commit -m "Make new-song creation queue offline on native (web unchanged)"
```

---

### Task 8: Wire the local song-edit page for offline edit/delete (native-only route)

**Files:**
- Modify: `src/app/admin/local/songs/edit/page.tsx` (full-file rewrite — see Step 1)

**Interfaces:**
- Consumes: `loadSongsListCache` (Task 3); `resolveSongForEdit`, `UpdateSongPayload` (type-only, via cast) from `src/lib/songsMerge.ts` (Task 3); `loadReferenceData` from `src/lib/offlineCache.ts`; `getQueuedActions`, `enqueue` from `src/lib/syncQueue.ts`; `useSyncQueue` from `src/components/SyncQueueProvider.tsx`; `SongAxisEditor`/`AxisValueEntry` (Task 5).
- Produces: nothing new consumed by later tasks.

This route (`/admin/local/songs/edit`) is only ever navigated to from the native branch of `admin/songs/page.tsx` (Task 6) — the web branch links to `/admin/songs/[id]` instead, a separate file this plan does not touch. So unlike Tasks 6–7, this page does not need an `isNativeApp()` branch in its data/mutation logic — it always uses the offline-safe cache+queue path. It does, however, drop its existing live-fetch image-upload flow entirely (Non-goal: image picking is Phase 2), since this page is native-only and Phase 1 never lets native pick a new image.

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `src/app/admin/local/songs/edit/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditSongId, clearSelectedEditSongId } from '@/lib/adminEditStore';
import { loadReferenceData } from '@/lib/offlineCache';
import { loadSongsListCache } from '@/lib/songsListCache';
import { getQueuedActions, enqueue } from '@/lib/syncQueue';
import { resolveSongForEdit } from '@/lib/songsMerge';
import { useSyncQueue } from '@/components/SyncQueueProvider';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';
import PageNav from '@/components/PageNav';

export default function LocalEditSongPage() {
  const router = useRouter();
  const { notifyQueueChanged } = useSyncQueue();
  const [songId, setSongId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [hasPendingEdit, setHasPendingEdit] = useState(false);

  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [notes, setNotes] = useState('');
  const [maleKey, setMaleKey] = useState('');
  const [femaleKey, setFemaleKey] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSelectedEditSongId(preferencesStore)
      .then(setSongId)
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (songId === null) return;
    Promise.all([loadSongsListCache(), loadReferenceData(), getQueuedActions()]).then(
      ([cachedSongs, referenceData, actions]) => {
        const base = cachedSongs?.find((s) => s.id === songId) ?? null;
        const baseAxisValues: AxisValueEntry[] = (referenceData?.axisValues ?? [])
          .filter((v) => v.songId === songId)
          .map((v) => ({ axisType: v.axisType, refId: v.refId, yearValue: v.yearValue }));
        const result = resolveSongForEdit(songId, base, baseAxisValues, actions);
        setHasPendingEdit(result.hasPendingEdit);
        if (result.song) {
          setTitle(result.song.title);
          setLyrics(result.song.lyrics ?? '');
          setNotes(result.song.notes ?? '');
          setMaleKey(result.song.maleKey ?? '');
          setFemaleKey(result.song.femaleKey ?? '');
          setImageUrl(result.song.imageUrl);
          setAxisValues(result.song.axisValues);
          setNotFound(false);
        } else {
          setNotFound(true);
        }
        setResolved(true);
      }
    );
  }, [songId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (songId === null) return;
    setError(null);
    try {
      await enqueue('song-update', {
        songId,
        title,
        lyrics: lyrics || null,
        notes: notes || null,
        maleKey: maleKey || null,
        femaleKey: femaleKey || null,
        axisValues,
        imageUrl, // read-only in Phase 1 — carried through unchanged, never re-picked here
      });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await notifyQueueChanged();
    router.push('/admin/songs');
  }

  async function handleDelete() {
    if (songId === null) return;
    setError(null);
    try {
      await enqueue('song-delete', { songId });
    } catch {
      setError('Αποτυχία αποθήκευσης. Δοκίμασε ξανά.');
      return;
    }
    await clearSelectedEditSongId(preferencesStore);
    await notifyQueueChanged();
    router.push('/admin/songs');
  }

  if (!checked || (songId !== null && !resolved)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (songId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <p className="text-lg">Δεν έχει επιλεγεί τραγούδι.</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <p className="text-lg">Το τραγούδι δεν βρέθηκε στα αποθηκευμένα δεδομένα.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
      {hasPendingEdit && (
        <p className="text-sm text-base-content/50">Δείχνονται οι μη συγχρονισμένες αλλαγές.</p>
      )}
      {error && (
        <div role="alert" className="alert alert-error max-w-2xl">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Τίτλος" className="input input-bordered" required />
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Στίχοι (προαιρετικό, μπορούν να προστεθούν αργότερα)"
          className="textarea textarea-bordered h-48"
        />
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled className="file-input file-input-bordered" />
          <span className="text-xs text-base-content/50">Η αλλαγή εικόνας από τη native εφαρμογή δεν υποστηρίζεται ακόμη — χρησιμοποίησε την ιστοσελίδα διαχείρισης.</span>
          {imageUrl && <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />}
        </div>
        <SongAxisEditor value={axisValues} onChange={setAxisValues} />
        <div className="flex gap-3">
          <input value={maleKey} onChange={(e) => setMaleKey(e.target.value)} placeholder="Τόνος (άντρας)" className="input input-bordered flex-1" />
          <input value={femaleKey} onChange={(e) => setFemaleKey(e.target.value)} placeholder="Τόνος (γυναίκα)" className="input input-bordered flex-1" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="input input-bordered" />
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">Αποθήκευση</button>
          <button type="button" onClick={handleDelete} className="btn btn-outline btn-error">Διαγραφή</button>
        </div>
      </form>
    </div>
  );
}
```

Note on `handleDelete`: this always enqueues, matching the spec's Architecture §1. A real conflict (song already played in a session, or is a session's current song) is no longer knowable synchronously here — it surfaces later on the songs list (Task 6) as `needs-attention` once the queued delete permanently fails, per the spec's documented Error handling table. This is a deliberate trade-off of the "always enqueue" architecture, not an oversight.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint src/app/admin/local/songs/edit/page.tsx`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: same as after Task 7 — all pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/local/songs/edit/page.tsx
git commit -m "Make local song edit/delete queue offline via resolveSongForEdit"
```

---

### Task 9: Full verification

No implementer subagent for this task — verification only, matching the equivalent final task in `docs/superpowers/plans/2026-08-31-offline-program-crud.md`.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: 164 tests pass (147 baseline + 4 from Task 2 + 13 from Task 3), 0 failures. If the actual count differs, trust the "all pass, 0 failures" outcome over this specific number.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit code 0, no output.

- [ ] **Step 3: Lint**

Run: `npx eslint 'src/**/*.{ts,tsx}'`
Expected: no errors in any file this plan touched (pre-existing warnings elsewhere are unrelated noise, not a regression).

- [ ] **Step 4: Web build**

Run: `npm run build`
Expected: succeeds. Additionally, re-confirm the web-unaffected claim for each of the three pages this plan changed:
- `admin/songs/page.tsx`: with `native === false`, `load()` takes its `if (!native)` early-return branch (no cache, no try/catch), and the pending-actions effect's `if (!native) return;` means `pendingActions` stays `[]` forever, so `mergeSongsWithPending` always returns every row as `status: 'active'` — none of the new status-dependent JSX can render.
- `admin/songs/new/page.tsx`: with `native === false`, `handleSubmit` takes the unchanged live-`nativeApiFetch` branch below the `if (native)` block, and the file input is never `disabled`.
- `admin/local/songs/edit/page.tsx`: never reached from the web build at all (nothing on the web branch of `admin/songs/page.tsx` links to it, and this plan added no new link to it either) — this file's behavior on web is moot.

- [ ] **Step 5: Mobile build**

Run: `npm run build:mobile`
Expected: succeeds; `admin/songs`, `admin/songs/new`, and `admin/local/songs/edit` all still appear in the static export route list.

- [ ] **Step 6: Note the manual on-device verification gap**

Not blocking, but record (in this project's manual-testing checklist and the `mobile-roadmap` memory, once this sub-project ships) that the following still needs a real device or emulator, per the spec's own Testing section:
- Add a song offline with axis values chosen from cached options — confirm "Κανένας άξονας ακόμη" no longer strips the whole "+ Πρόσθεσε άξονα" UI, and the new song shows as a pending, non-clickable row on the list.
- Go online, confirm the sync-queue drains and the song becomes a normal row with a real id.
- Edit an existing song's text/axes offline, reopen its edit page before the edit has synced — confirm the pending (unsynced) fields show, not stale cached data (`hasPendingEdit` note visible).
- Delete a song offline, confirm it hides from the list immediately; separately, delete a song that is a session's current song (or has been played in a session) — confirm the real, permanent 409 makes it reappear as a normal active row rather than staying hidden forever.
- Confirm "+ Νέα τιμή..." is disabled (with its inline note) inside `SongAxisEditor` whenever running natively, online or offline.
- Confirm the image file input is disabled (with its inline note) on both `admin/songs/new` (native) and `admin/local/songs/edit`, and that an existing image still displays read-only on the edit page.
