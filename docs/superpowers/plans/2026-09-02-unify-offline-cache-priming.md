# Unify Offline-Cache Priming Triggers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the native app's five independent offline read-caches into the single `referenceData` blob, filled by one extended `/api/reference-data` call, primed by one renamed trigger that also runs (after draining writes) on reconnect.

**Architecture:** The server composes one consistent, owner-scoped snapshot (songs, programs with sequences + roles + collaborators + sequence-song join ids, taxonomy, current user). A single `primeOfflineData()` orchestrator is the *only* writer of the cached blob and stamps a `primedAt` timestamp on it. The four satellite cache modules (`songsListCache`, `programsListCache`, `programDetailCache`, `collaboratorsCache`) are deleted; their consumers read slices of the one blob through pure adapter functions. Old on-disk blobs are tolerated on the read path by `normalizeReferenceData` (no IndexedDB version bump), and `primedAt === null` gates every degraded old-shape path behind an actionable "prepare for offline" empty state.

**Tech Stack:** Next.js (this repo renames `middleware.ts` → `proxy.ts`; read `node_modules/next/dist/docs/` before touching framework code), Drizzle/Postgres, Capacitor (native static export), IndexedDB, Vitest (pure logic only), TypeScript, daisyUI/Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-02-unify-offline-cache-priming-design.md` — the plan argues from this spec; executors read both.

## Global Constraints

- **Testing convention overrides the TDD template.** Per `CLAUDE.md`, Vitest covers **pure logic only**. Do NOT add `fake-indexeddb`, route tests, or Capacitor mocks. Tasks touching IndexedDB, API routes, React pages, or Capacitor end with `npm run lint && npx tsc --noEmit && npm test` (all green) **plus named manual verification steps written into `docs/manual-testing-checklist.md`** — those concrete manual steps are the substitute for a test, not an omission.
- **Vocabulary stays distinct:** *prime* = pull server → cache (read); *sync* = drain the write queue (write). Separate functions, separately named in UI and code. Never rename one into the other.
- **`primeOfflineData()` is the single writer of the cached blob.** After Task 10 no other code path calls `saveReferenceData` for a full prime. `primedAt !== null` therefore means "written by new code, new fields trustworthy"; `primedAt === null` means "old or never-primed, show the re-prime message."
- **A consumer that today writes its satellite cache on a live fetch DROPS that write — it does not redirect the write into the blob.** Re-populating the blob per-screen would rebuild the multi-writer fan-out this feature deletes. The blob is refreshed only by `primeOfflineData()`.
- **`OfflineSequence.songIds` is load-bearing on the live-γλέντι path** (`programs/local/*`, `sessionStore.ts`) and MUST be preserved unchanged. The sequence-song join ids are added as a **new, additive** `entries` field — never by replacing `songIds`.
- **Web behavior is untouched.** Priming is native-only. `admin/songs/page.tsx` and `admin/programs/page.tsx` are shared web+native with `if (!native)` early returns; their web branch MUST stay a plain live fetch with **no `loadReferenceData()` anywhere on it** — the blob is never primed on web, so routing web through it would silently break the web admin pages.
- **Greek domain vocabulary** in UI strings/comments is intentional; match surrounding style. New UI copy is Greek.
- **Attribution** on every commit message footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WYS9ktLBENcRM6LQEzufej
  ```
- Work happens on branch `unify-offline-cache-priming` (already created; the design spec is its first commit).

---

### Task 1: Extend `ReferenceData` types, relocate shared display types, backfill `normalizeReferenceData`

Pure-logic foundation. Everything downstream consumes these types.

**Files:**
- Modify: `src/lib/referenceData.ts`
- Modify: `src/lib/referenceData.test.ts`
- Modify: `src/lib/songsMerge.ts:3` (import path only), `src/lib/songsMerge.test.ts:4` (import path only)
- Modify: `src/lib/sequencesMerge.ts:2` (import path only), `src/lib/sequencesMerge.test.ts:3` (import path only)

**Interfaces:**
- Produces (consumed by every later task):
  - `OfflineCollaborator = { id: number; email: string }`
  - `OfflineSequenceEntry = { sequenceSongId: number; songId: number }`
  - `OfflineSequence = { id: number; title: string; songIds: number[]; entries: OfflineSequenceEntry[] }` — `songIds` KEPT, `entries` NEW
  - `OfflineProgram = { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[]; creator: OfflineCollaborator | null; collaborators: OfflineCollaborator[]; sequences: OfflineSequence[] }`
  - `ReferenceData` gains `currentUser: OfflineCollaborator | null`
  - `CachedReferenceData = ReferenceData & { primedAt: string | null }` (the on-disk envelope; Task 3 saves/loads it)
  - Relocated verbatim into `referenceData.ts` (their cache modules are deleted in Task 9): `CachedSong`, `CachedSequenceSong`, `CachedSequence`, `CachedProgramDetail`
  - `normalizeReferenceData(data): ReferenceData` — now also backfills `currentUser`, each program's `role`/`sharedWithEmails`/`creator`/`collaborators`, and each sequence's `entries`.

- [ ] **Step 1: Write the failing tests** — extend `src/lib/referenceData.test.ts`.

First update the existing `referenceData()` factory and the two `normalizeReferenceData` "already populated" / `collectReferencedSongIds` literals to the new shape (add `currentUser: null`; give the populated program `role`/`sharedWithEmails`/`creator`/`collaborators`; give sequences `entries: []` alongside `songIds`). Then add:

```ts
it('backfills currentUser to null when missing (pre-feature cached blob)', () => {
  const legacy = {
    songs: [], sharedSongs: [], axisValues: [], regions: [], rhythms: [],
    dromoi: [], composers: [], axisTypes: [], genres: [], programs: [],
  } as unknown as ReferenceData;
  expect(normalizeReferenceData(legacy).currentUser).toBeNull();
});

it('backfills new program fields and sequence.entries for an old-shape program', () => {
  const legacy = {
    songs: [], sharedSongs: [], axisValues: [], regions: [], rhythms: [],
    dromoi: [], composers: [], axisTypes: [], genres: [],
    programs: [{ id: 1, title: 'A', sequences: [{ id: 10, title: 'S1', songIds: [1, 2] }] }],
  } as unknown as ReferenceData;
  const p = normalizeReferenceData(legacy).programs[0];
  expect(p.role).toBe('creator');
  expect(p.sharedWithEmails).toEqual([]);
  expect(p.creator).toBeNull();
  expect(p.collaborators).toEqual([]);
  expect(p.sequences[0].entries).toEqual([]);
  expect(p.sequences[0].songIds).toEqual([1, 2]); // preserved untouched
});

it('leaves a new-shape program unchanged', () => {
  const data = referenceData();
  data.programs = [{
    id: 1, title: 'A', role: 'collaborator', sharedWithEmails: ['x@y.gr'],
    creator: { id: 9, email: 'x@y.gr' }, collaborators: [],
    sequences: [{ id: 10, title: 'S1', songIds: [1], entries: [{ sequenceSongId: 100, songId: 1 }] }],
  }];
  expect(normalizeReferenceData(data).programs[0]).toEqual(data.programs[0]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/referenceData.test.ts`
Expected: FAIL — type errors on the new `OfflineProgram` fields / `currentUser`, and the new backfill assertions fail.

- [ ] **Step 3: Implement the type changes and backfill**

In `src/lib/referenceData.ts`, replace the `OfflineSequence`/`OfflineProgram`/`ReferenceData` block and extend `normalizeReferenceData`:

```ts
export interface OfflineCollaborator {
  id: number;
  email: string;
}

export interface OfflineSequenceEntry {
  sequenceSongId: number; // program_sequences join-row id, for reorder/remove of a specific entry
  songId: number;
}

export interface OfflineSequence {
  id: number;
  title: string;
  songIds: number[]; // already in playback order — read by programs/local/* + sessionStore; DO NOT remove
  entries: OfflineSequenceEntry[]; // join-row ids for the offline program editor
}

export interface OfflineProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  creator: OfflineCollaborator | null;
  collaborators: OfflineCollaborator[];
  sequences: OfflineSequence[]; // already in display order (server-side orderBy position)
}

export interface ReferenceData {
  songs: SongRow[];
  sharedSongs: SongRow[]; // see original comment — songs referenced by a shared program but not owned by the requester
  axisValues: SongAxisValueRow[];
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
  programs: OfflineProgram[];
  currentUser: OfflineCollaborator | null; // the authenticated user of this prime; feeds the offline collaborators UI
}

// The on-disk envelope. primeOfflineData() (Task 3) is the only writer; primedAt stamps
// when it last succeeded, so consumers can show an actionable empty state when it's null.
export interface CachedReferenceData extends ReferenceData {
  primedAt: string | null;
}

// Display/base types relocated here from the deleted satellite cache modules (see Task 9).
// SongRow is structurally assignable to CachedSong (superset), so mergeSongsWithPending can
// take referenceData.songs directly.
export interface CachedSong {
  id: number;
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

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
```

Extend `normalizeReferenceData` (keep the existing doc comment, append a note that these placeholders are only reachable when `primedAt === null`, where the UI shows the re-prime message instead of rendering them):

```ts
export function normalizeReferenceData(data: ReferenceData): ReferenceData {
  return {
    ...data,
    programs: (data.programs ?? []).map((p) => ({
      ...p,
      role: p.role ?? 'creator',
      sharedWithEmails: p.sharedWithEmails ?? [],
      creator: p.creator ?? null,
      collaborators: p.collaborators ?? [],
      sequences: (p.sequences ?? []).map((s) => ({ ...s, entries: s.entries ?? [] })),
    })),
    sharedSongs: data.sharedSongs ?? [],
    axisTypes: data.axisTypes ?? [],
    currentUser: data.currentUser ?? null,
  };
}
```

Then repoint the type-only imports (no logic change):
- `src/lib/songsMerge.ts:3` and `src/lib/songsMerge.test.ts:4`: `import type { CachedSong } from './referenceData';`
- `src/lib/sequencesMerge.ts:2` and `src/lib/sequencesMerge.test.ts:3`: `import type { CachedProgramDetail } from './referenceData';`

- [ ] **Step 4: Run the full suite to verify green**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS. `referenceData.test.ts`, `songsMerge.test.ts`, `sequencesMerge.test.ts` all pass; no type errors. (`collectReferencedSongIds` is unchanged — it still reads `songIds`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/referenceData.ts src/lib/referenceData.test.ts src/lib/songsMerge.ts src/lib/songsMerge.test.ts src/lib/sequencesMerge.ts src/lib/sequencesMerge.test.ts
git commit -m "feat: extend ReferenceData with program roles, collaborators, sequence entries, currentUser"
```

---

### Task 2: Populate the extended payload from the database

Wire the new fields through the query and API route. No new round trips — `summarize()` already fetches collaborators and the creator.

**Files:**
- Modify: `src/db/queries/programs.ts` (`AccessibleProgram`, `summarize`, `listProgramsWithSequencesAndSongs`)
- Modify: `src/app/api/reference-data/route.ts`

**Interfaces:**
- Consumes: `OfflineProgram`, `OfflineCollaborator`, `ReferenceData.currentUser` (Task 1).
- Produces: `/api/reference-data` GET returns the fully-populated `ReferenceData`; `listAccessiblePrograms` returns `AccessibleProgram` widened with `creator`/`collaborators` (additive — `/api/programs` GET returns this directly; the extra fields are harmless to its existing consumers).

- [ ] **Step 1: Widen `AccessibleProgram` and `summarize`** in `src/db/queries/programs.ts`.

```ts
export interface AccessibleProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  creator: { id: number; email: string } | null; // NEW
  collaborators: { id: number; email: string }[]; // NEW
}
```

In `summarize` (line ~187), it already computes `collaborators` and `creator`; return them structured too:

```ts
async function summarize(program: ProgramRow, role: 'creator' | 'collaborator'): Promise<AccessibleProgram> {
  const collaborators = await listCollaborators(program.id);
  const creator = program.ownerId === userId ? null : await getUserById(program.ownerId);
  const emails = [
    ...(creator ? [creator.email] : []),
    ...collaborators.filter((c) => c.id !== userId).map((c) => c.email),
  ];
  return {
    id: program.id,
    title: program.title,
    role,
    sharedWithEmails: emails,
    creator: creator ? { id: creator.id, email: creator.email } : null,
    collaborators,
  };
}
```

- [ ] **Step 2: Thread the new fields into `listProgramsWithSequencesAndSongs`** (line ~115). Add `entries` per sequence (keep `songIds`), and carry `role`/`sharedWithEmails`/`creator`/`collaborators`:

```ts
export async function listProgramsWithSequencesAndSongs(userId: number): Promise<OfflineProgram[]> {
  const programList = await listAccessiblePrograms(userId);
  return Promise.all(
    programList.map(async (program) => {
      const sequenceList = await listSequencesForProgram(program.id);
      const sequences = await Promise.all(
        sequenceList.map(async (sequence) => {
          const seqEntries = await listSongsForSequence(sequence.id);
          return {
            id: sequence.id,
            title: sequence.title,
            songIds: seqEntries.map((e) => e.song.id),
            entries: seqEntries.map((e) => ({ sequenceSongId: e.sequenceSongId, songId: e.song.id })),
          };
        })
      );
      return {
        id: program.id,
        title: program.title,
        role: program.role,
        sharedWithEmails: program.sharedWithEmails,
        creator: program.creator,
        collaborators: program.collaborators,
        sequences,
      };
    })
  );
}
```

- [ ] **Step 3: Add `currentUser` to the reference-data payload** in `src/app/api/reference-data/route.ts`.

Add `getUserById` import (`import { getUserById } from '@/db/queries/users';`), fetch the current user inside the existing `Promise.all` (append `getUserById(userId)` and destructure it), then include it:

```ts
const payload: ReferenceData = {
  songs: ownSongs, sharedSongs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs,
  currentUser: currentUser ? { id: currentUser.id, email: currentUser.email } : null,
};
```

- [ ] **Step 4: Verify types + lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS, no type errors. (No unit test — DB queries and API routes are verified manually per convention.)

- [ ] **Step 5: Manual verification (documented, not automated)**

With the web dev server running (`npm run dev`) and logged in, hit `/api/reference-data` in the browser and confirm the JSON now contains, for each program: `role`, `sharedWithEmails`, `creator`, `collaborators`, and per sequence both `songIds` and `entries` (each entry `{ sequenceSongId, songId }`); and a top-level `currentUser: { id, email }`. Note this check in the PR description.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/programs.ts src/app/api/reference-data/route.ts
git commit -m "feat: bundle program roles, collaborators, sequence join ids, and current user into /api/reference-data"
```

---

### Task 3: `primedAt` envelope, `primeOfflineData()` orchestrator, orphan-DB cleanup

The single-writer entry point. Native-only behavior, but the module stays importable everywhere.

**Files:**
- Modify: `src/lib/offlineCache.ts`

**Interfaces:**
- Consumes: `ReferenceData`, `CachedReferenceData`, `normalizeReferenceData` (Task 1); `apiUrl` (`@/lib/apiClient`), `getAuthToken`/`clearAuthToken` (`@/lib/authToken`).
- Produces:
  - `saveReferenceData(data: ReferenceData): Promise<void>` — now stamps `primedAt` with `new Date().toISOString()`.
  - `loadReferenceData(): Promise<CachedReferenceData | null>` — returns the envelope (normalized `ReferenceData` + `primedAt`).
  - `primeOfflineData(): Promise<{ status: 'ok' | 'error' | 'unauthorized' }>` — the only full-prime writer; fetches, saves, best-effort deletes the four orphan databases.

- [ ] **Step 1: Envelope the save/load** in `src/lib/offlineCache.ts`. `put` still uses `STORE_NAME`/`REFERENCE_DATA_KEY` — **no `DB_VERSION` bump, no `onupgradeneeded` change**; only the stored value's shape grows.

```ts
import { normalizeReferenceData, type ReferenceData, type CachedReferenceData } from './referenceData';
import { apiUrl } from './apiClient';
import { getAuthToken, clearAuthToken } from './authToken';

// ...DB_NAME / DB_VERSION / STORE_NAME / REFERENCE_DATA_KEY / openDb unchanged...

export async function saveReferenceData(data: ReferenceData): Promise<void> {
  const envelope: CachedReferenceData = { ...data, primedAt: new Date().toISOString() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(envelope, REFERENCE_DATA_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadReferenceData(): Promise<CachedReferenceData | null> {
  const db = await openDb();
  const result = await new Promise<CachedReferenceData | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(REFERENCE_DATA_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!result) return null;
  return { ...normalizeReferenceData(result), primedAt: result.primedAt ?? null };
}
```

- [ ] **Step 2: Add `primeOfflineData()` and orphan cleanup** to the same file.

```ts
// Databases owned by the retired satellite cache modules (Task 9). Cleaned up best-effort
// on every prime so a device that primed under the old design doesn't leave dead stores
// behind. A failure here must never fail the prime.
const ORPHAN_DB_NAMES = [
  'glentify-songs-list-cache',
  'glentify-programs-list-cache',
  'glentify-program-detail-cache',
  'glentify-collaborators-cache',
];

function deleteOrphanDatabases(): void {
  for (const name of ORPHAN_DB_NAMES) {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      // best-effort — a blocked/failed delete must not affect the prime result
    }
  }
}

// The single writer of the offline blob. Pulls one consistent server snapshot and stamps
// primedAt. Mirrors the auth/401 handling the Home button used to do inline.
export async function primeOfflineData(): Promise<{ status: 'ok' | 'error' | 'unauthorized' }> {
  try {
    const token = await getAuthToken();
    const res = await fetch(apiUrl('/api/reference-data'), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.status === 401) {
      await clearAuthToken();
      return { status: 'unauthorized' };
    }
    if (!res.ok) return { status: 'error' };
    await saveReferenceData(await res.json());
    deleteOrphanDatabases();
    return { status: 'ok' };
  } catch {
    return { status: 'error' };
  }
}
```

- [ ] **Step 3: Verify types + lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. (Existing callers of `loadReferenceData` still typecheck — `CachedReferenceData extends ReferenceData`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/offlineCache.ts
git commit -m "feat: add primedAt envelope, primeOfflineData orchestrator, and orphan-db cleanup"
```

---

### Task 4: Pure adapters — `toProgramDetail` and `toCollaboratorsView`

The pure reshaping layer that lets the program editor read a blob slice through the *unchanged* `mergeSequencesWithPending` and its collaborators UI. This is where the real test value of the feature lives.

**Files:**
- Create: `src/lib/offlineProgramView.ts`
- Create: `src/lib/offlineProgramView.test.ts`

**Interfaces:**
- Consumes: `OfflineProgram`, `OfflineCollaborator`, `CachedProgramDetail`, `SongRow` (Task 1).
- Produces:
  - `toProgramDetail(program: OfflineProgram, songTitleById: Map<number, string>): CachedProgramDetail` — reshapes a blob program into what `mergeSequencesWithPending` expects; resolves each entry's title from the map (`'—'` when absent).
  - `toCollaboratorsView(program: OfflineProgram, currentUser: OfflineCollaborator | null): { role: 'creator' | 'collaborator'; creator: OfflineCollaborator | null; collaborators: OfflineCollaborator[]; currentUser: OfflineCollaborator | null }`
  - `buildSongTitleMap(songs: SongRow[], sharedSongs: SongRow[]): Map<number, string>` — helper the editor uses to feed `toProgramDetail` (covers both owned and shared-program songs).

- [ ] **Step 1: Write the failing tests** — `src/lib/offlineProgramView.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { toProgramDetail, toCollaboratorsView, buildSongTitleMap } from './offlineProgramView';
import type { OfflineProgram } from './referenceData';
import type { SongRow } from '@/db/schema';

const FIXED = new Date('2026-01-01T00:00:00.000Z');
function song(id: number, title: string): SongRow {
  return { id, title, lyrics: null, imageUrl: null, notes: null, maleKey: null, femaleKey: null, ownerId: 1, createdAt: FIXED, updatedAt: FIXED };
}

const program: OfflineProgram = {
  id: 7, title: 'Πρόγραμμα', role: 'collaborator', sharedWithEmails: ['a@b.gr'],
  creator: { id: 2, email: 'a@b.gr' }, collaborators: [{ id: 3, email: 'c@d.gr' }],
  sequences: [{
    id: 10, title: 'Σειρά 1', songIds: [1, 2],
    entries: [{ sequenceSongId: 100, songId: 1 }, { sequenceSongId: 101, songId: 2 }],
  }],
};

describe('buildSongTitleMap', () => {
  it('maps ids to titles across owned and shared songs', () => {
    const m = buildSongTitleMap([song(1, 'Ένα')], [song(2, 'Δύο')]);
    expect(m.get(1)).toBe('Ένα');
    expect(m.get(2)).toBe('Δύο');
  });
});

describe('toProgramDetail', () => {
  it('reshapes a program into CachedProgramDetail with per-entry sequenceSongId and resolved titles', () => {
    const detail = toProgramDetail(program, buildSongTitleMap([song(1, 'Ένα'), song(2, 'Δύο')], []));
    expect(detail.programId).toBe(7);
    expect(detail.title).toBe('Πρόγραμμα');
    expect(detail.role).toBe('collaborator');
    expect(detail.sequences[0].songs).toEqual([
      { sequenceSongId: 100, songId: 1, title: 'Ένα' },
      { sequenceSongId: 101, songId: 2, title: 'Δύο' },
    ]);
  });

  it('falls back to em-dash for an unresolved song title', () => {
    const detail = toProgramDetail(program, new Map());
    expect(detail.sequences[0].songs[0].title).toBe('—');
  });

  it('assigns sequence positions by array order', () => {
    const detail = toProgramDetail(program, new Map());
    expect(detail.sequences[0].position).toBe(0);
  });
});

describe('toCollaboratorsView', () => {
  it('passes role, creator, collaborators, and currentUser through from the blob', () => {
    const cu = { id: 3, email: 'c@d.gr' };
    const view = toCollaboratorsView(program, cu);
    expect(view).toEqual({
      role: 'collaborator',
      creator: { id: 2, email: 'a@b.gr' },
      collaborators: [{ id: 3, email: 'c@d.gr' }],
      currentUser: cu,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/offlineProgramView.test.ts`
Expected: FAIL with "toProgramDetail is not a function" (module doesn't exist yet).

- [ ] **Step 3: Implement `src/lib/offlineProgramView.ts`**

```ts
import type { SongRow } from '@/db/schema';
import type { OfflineProgram, OfflineCollaborator, CachedProgramDetail } from './referenceData';

export function buildSongTitleMap(songs: SongRow[], sharedSongs: SongRow[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const s of songs) map.set(s.id, s.title);
  for (const s of sharedSongs) if (!map.has(s.id)) map.set(s.id, s.title);
  return map;
}

// Reshapes one blob program into the CachedProgramDetail that mergeSequencesWithPending
// already consumes, so the merge function and its tests stay untouched. cachedAt carries
// no meaning here (the blob's freshness is its primedAt) — set to empty string.
export function toProgramDetail(
  program: OfflineProgram,
  songTitleById: Map<number, string>
): CachedProgramDetail {
  return {
    programId: program.id,
    title: program.title,
    role: program.role,
    cachedAt: '',
    sequences: program.sequences.map((seq, position) => ({
      id: seq.id,
      title: seq.title,
      position,
      songs: seq.entries.map((e) => ({
        sequenceSongId: e.sequenceSongId,
        songId: e.songId,
        title: songTitleById.get(e.songId) ?? '—',
      })),
    })),
  };
}

export function toCollaboratorsView(
  program: OfflineProgram,
  currentUser: OfflineCollaborator | null
): { role: 'creator' | 'collaborator'; creator: OfflineCollaborator | null; collaborators: OfflineCollaborator[]; currentUser: OfflineCollaborator | null } {
  return {
    role: program.role,
    creator: program.creator,
    collaborators: program.collaborators,
    currentUser,
  };
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/lib/offlineProgramView.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offlineProgramView.ts src/lib/offlineProgramView.test.ts
git commit -m "feat: add pure adapters mapping a reference-data program slice to editor views"
```

---

### Task 5: Repoint the admin songs list (`admin/songs/page.tsx`)

**Files:**
- Modify: `src/app/admin/songs/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData` (Task 3, returns `CachedReferenceData`), `CachedSong` (Task 1, from `@/lib/referenceData`), `mergeSongsWithPending` (unchanged).

- [ ] **Step 1: Swap the cache imports.** Remove `import { saveSongsListCache, loadSongsListCache } from '@/lib/songsListCache';` and `import type { CachedSong } from '@/lib/songsListCache';`. Add:

```ts
import { loadReferenceData } from '@/lib/offlineCache';
import type { CachedSong } from '@/lib/referenceData';
```

- [ ] **Step 2: Rework `load(q)`.** Keep the web branch (`if (!native)`) as a plain live fetch — **no `loadReferenceData` on it**. On native: still live-fetch when online (fresh data), but drop the `saveSongsListCache` write; on the offline catch, read from the blob and use `primedAt` for the empty state.

```ts
const [neverPrimed, setNeverPrimed] = useState(false);
// ...
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
    setNeverPrimed(false);
  } catch {
    const cached = await loadReferenceData().catch(() => null);
    if (cached && cached.primedAt !== null) {
      const filtered = q ? cached.songs.filter((s) => s.title.toLowerCase().includes(q.toLowerCase())) : cached.songs;
      setSongs(filtered);
      setOfflineSongs(true);
      setSongsUnavailable(false);
      setNeverPrimed(false);
    } else {
      setSongsUnavailable(true);
      setNeverPrimed(!cached || cached.primedAt === null);
    }
  }
}
```

(`referenceData.songs` is `SongRow[]`, structurally assignable to `CachedSong[]`.)

- [ ] **Step 3: Make the unavailable message actionable via `primedAt`.** Replace the stopgap `songsUnavailable` paragraph (the `3fd6c36` string) so, when never primed, it names the fix and links Home:

```tsx
{songsUnavailable && (
  <p className="text-sm text-base-content/50">
    {neverPrimed
      ? 'Δεν έχει προετοιμαστεί για offline χρήση. '
      : 'Άγνωστο χωρίς σύνδεση. '}
    <Link href="/" className="link">Προετοιμασία για offline</Link>
  </p>
)}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. Confirm the file no longer references `songsListCache`.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/songs/page.tsx
git commit -m "refactor: read admin songs offline list from the reference-data blob"
```

---

### Task 6: Repoint the admin programs list (`admin/programs/page.tsx`)

**Files:**
- Modify: `src/app/admin/programs/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData` (Task 3), `CachedProgram` (see below), `mergeProgramsWithPending` (unchanged — its base needs `{ id, title, role, sharedWithEmails }`, which `OfflineProgram` supplies as a superset).

- [ ] **Step 1: Swap imports.** Remove `import { saveProgramsListCache, loadProgramsListCache } from '@/lib/programsListCache';` and `import type { CachedProgram } from '@/lib/programsListCache';`. Add `import { loadReferenceData } from '@/lib/offlineCache';`. Keep a local `CachedProgram` shape for the state type (the live `/api/programs` response shape) — define it inline or reuse `OfflineProgram`; simplest is to type the state as the live shape:

```ts
import type { OfflineProgram } from '@/lib/referenceData';
// state: use a structural subset both sources satisfy
type ProgramListItem = { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[] };
```
Change `useState<CachedProgram[]>` → `useState<ProgramListItem[]>` and the `data: CachedProgram[]` annotation likewise. (`OfflineProgram` is assignable to `ProgramListItem`.)

- [ ] **Step 2: Rework `load()`.** Keep the web branch untouched. On native, drop `saveProgramsListCache`; offline read from the blob, gated on `primedAt`:

```ts
const [neverPrimed, setNeverPrimed] = useState(false);
// ...
async function load() {
  if (!native) {
    const res = await nativeApiFetch('/api/programs');
    setPrograms(await res.json());
    return;
  }
  try {
    const res = await nativeApiFetch('/api/programs');
    const data: ProgramListItem[] = await res.json();
    setPrograms(data);
    setOfflinePrograms(false);
    setProgramsUnavailable(false);
    setNeverPrimed(false);
  } catch {
    const cached = await loadReferenceData().catch(() => null);
    if (cached && cached.primedAt !== null) {
      setPrograms(cached.programs);
      setOfflinePrograms(true);
      setProgramsUnavailable(false);
      setNeverPrimed(false);
    } else {
      setProgramsUnavailable(true);
      setNeverPrimed(!cached || cached.primedAt === null);
    }
  }
}
```

- [ ] **Step 3: Make the unavailable message actionable** (same pattern as Task 5, Step 3) — replace the `programsUnavailable` stopgap paragraph with a `neverPrimed`-aware message that links `/` with text `Προετοιμασία για offline`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. Confirm the file no longer references `programsListCache`.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/programs/page.tsx
git commit -m "refactor: read admin programs offline list from the reference-data blob"
```

---

### Task 7: Repoint the local song editor (`admin/local/songs/edit/page.tsx`)

**Files:**
- Modify: `src/app/admin/local/songs/edit/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData` (already imported here), `CachedSong` (Task 1). This page already reads `loadReferenceData()` for axis values; it only needs to stop reading `loadSongsListCache()` for the base song.

- [ ] **Step 1: Swap imports.** Remove `import { loadSongsListCache, type CachedSong } from '@/lib/songsListCache';`. Add `import type { CachedSong } from '@/lib/referenceData';` (`loadReferenceData` import stays).

- [ ] **Step 2: Drop `loadSongsListCache` from the load effect.** The effect (line ~77) currently does `Promise.all([fetchLiveSong(songId), loadSongsListCache(), loadReferenceData(), getQueuedActions()])`. Remove the `loadSongsListCache()` element and derive the cached base from `referenceData.songs`:

```ts
Promise.all([fetchLiveSong(songId), loadReferenceData(), getQueuedActions()])
  .then(([live, referenceData, actions]) => {
    const cachedBase: CachedSong | null =
      referenceData?.songs.find((s) => s.id === songId) ?? null;
    const base = live?.base ?? cachedBase;
    const baseAxisValues: AxisValueEntry[] =
      live?.baseAxisValues ??
      (referenceData?.axisValues ?? [])
        .filter((v) => v.songId === songId)
        .map((v) => ({ axisType: v.axisType, refId: v.refId, yearValue: v.yearValue }));
    const result = resolveSongForEdit(songId, base, baseAxisValues, actions);
    // ...unchanged from here...
```

(`referenceData.songs` is `SongRow[]`; `.find(...)` yields a `SongRow` assignable to `CachedSong`.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. Confirm no `songsListCache` reference remains in the file.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/local/songs/edit/page.tsx
git commit -m "refactor: resolve local song editor base from the reference-data blob"
```

---

### Task 8: Repoint the local program editor (`admin/local/programs/edit/page.tsx`)

The largest consumer — sequences, collaborators, and song search all move to the blob via Task 4's adapters. Drops the `saveProgramDetail`/`saveSequenceSongs`/`saveCollaboratorsCache` writes (no redirect into the blob).

**Files:**
- Modify: `src/app/admin/local/programs/edit/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData` (Task 3); `toProgramDetail`, `toCollaboratorsView`, `buildSongTitleMap` (Task 4); `mergeSequencesWithPending`, `mergeCollaboratorsWithPending` (unchanged); `CachedProgramDetail`/`CachedSequenceSong` (Task 1, from `@/lib/referenceData`).

- [ ] **Step 1: Swap imports.** Remove the three satellite imports (`collaboratorsCache`, `programDetailCache`, `songsListCache` lines 11/13/16). Add:

```ts
import { loadReferenceData } from '@/lib/offlineCache';
import { toProgramDetail, toCollaboratorsView, buildSongTitleMap } from '@/lib/offlineProgramView';
import type { CachedProgramDetail, CachedSequenceSong } from '@/lib/referenceData';
```

- [ ] **Step 2: Rework `loadSequences(id)`.** Keep the online branch (live `/api/programs/[id]` + per-sequence fetch) so an online editor sees fresh data — but **delete the `saveProgramDetail(detail)` write**. Build `songTitles` from the blob (owned + shared), and on the offline catch read the program slice from the blob through `toProgramDetail`:

```ts
async function loadSequences(id: number): Promise<'creator' | 'collaborator' | null> {
  const [actions, cached] = await Promise.all([getQueuedActions(), loadReferenceData().catch(() => null)]);
  const titles = buildSongTitleMap(cached?.songs ?? [], cached?.sharedSongs ?? []);
  setSongTitles(titles);
  try {
    const res = await nativeApiFetch(`/api/programs/${id}`);
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    setTitle(data.title);
    setRole(data.role);
    const sequences = await Promise.all(
      (data.sequences as { id: number; title: string; position: number }[]).map(async (seq) => {
        const sres = await nativeApiFetch(`/api/programs/${id}/sequences/${seq.id}`);
        if (!sres.ok) throw new Error('bad status');
        const sdata = await sres.json();
        const rawSongs = Array.isArray(sdata.songs)
          ? (sdata.songs as { sequenceSongId: number; song: { id: number; title: string } }[])
          : [];
        const songs: CachedSequenceSong[] = rawSongs.map((e) => ({
          sequenceSongId: e.sequenceSongId, songId: e.song.id, title: e.song.title,
        }));
        return { id: seq.id, title: seq.title, position: seq.position, songs };
      })
    );
    const detail: CachedProgramDetail = { programId: id, title: data.title, role: data.role, sequences, cachedAt: '' };
    setSequencesUnavailableOffline(false);
    setDisplaySequences(mergeSequencesWithPending(detail, actions, titles));
    return data.role;
  } catch {
    const program = cached?.programs.find((p) => p.id === id) ?? null;
    if (program && cached && cached.primedAt !== null) {
      const detail = toProgramDetail(program, titles);
      setTitle(detail.title);
      setRole(detail.role);
      setSequencesUnavailableOffline(false);
      setDisplaySequences(mergeSequencesWithPending(detail, actions, titles));
      return detail.role;
    }
    setSequencesUnavailableOffline(true);
    return null;
  }
}
```

- [ ] **Step 3: Rework `loadCollaborators(...)`.** Keep the online branch but **delete the `saveCollaboratorsCache(...)` write**. On the offline catch, read the program slice through `toCollaboratorsView`:

```ts
} catch {
  const cached = await loadReferenceData().catch(() => null);
  const program = cached?.programs.find((p) => p.id === id) ?? null;
  if (program && cached && cached.primedAt !== null) {
    const view = toCollaboratorsView(program, cached.currentUser);
    setRole(view.role);
    setCreator(view.creator);
    setCollaborators(view.collaborators);
    if (view.currentUser) setCurrentUser(view.currentUser);
    setOfflineCollaborators(true);
    setCollaboratorsUnavailable(false);
  } else {
    setCollaboratorsUnavailable(true);
  }
}
```

- [ ] **Step 4: Rework `handleToggleExpand`'s offline-refresh branch.** Keep the live `/api/programs/[id]/sequences/[seqId]` fetch that refreshes the expanded sequence into React state, but **delete the `saveSequenceSongs(...)` write and the `loadProgramDetail(...)` re-read**. Rebuild the merged view from the blob slice instead:

```ts
try {
  const res = await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`);
  if (!res.ok) throw new Error('bad status');
  const data = await res.json();
  const rawSongs = Array.isArray(data.songs)
    ? (data.songs as { sequenceSongId: number; song: { id: number; title: string } }[])
    : [];
  const freshSongs: CachedSequenceSong[] = rawSongs.map((e) => ({
    sequenceSongId: e.sequenceSongId, songId: e.song.id, title: e.song.title,
  }));
  const [actions, cached] = await Promise.all([getQueuedActions(), loadReferenceData().catch(() => null)]);
  const program = cached?.programs.find((p) => p.id === programId);
  if (program) {
    // Rebuild from the blob slice (real ids) with the just-fetched sequence's songs overlaid,
    // then re-apply the queue overlay. Draft sequences absent from the blob come back through
    // the queue overlay in mergeSequencesWithPending.
    const detail = toProgramDetail(program, songTitles);
    const withFresh: CachedProgramDetail = {
      ...detail,
      sequences: detail.sequences.map((s) => (s.id === seqId ? { ...s, songs: freshSongs } : s)),
    };
    setDisplaySequences(mergeSequencesWithPending(withFresh, actions, songTitles));
  }
} catch {
  // offline — displaySequences already holds the cached+overlaid songs
}
```

- [ ] **Step 5: Rework `handleSearch`'s offline fallback** — replace `loadSongsListCache()` with the blob:

```ts
} catch {
  const cached = await loadReferenceData().catch(() => null);
  const q = search.toLowerCase();
  setSearchResults(
    (cached?.songs ?? []).filter((s) => s.title.toLowerCase().includes(q)).map((s) => ({ id: s.id, title: s.title }))
  );
}
```

- [ ] **Step 6: Make the offline messages actionable.** Where `sequencesUnavailableOffline` / `collaboratorsUnavailable` render the stopgap strings, add a `Link href="/"` with `Προετοιμασία για offline` when the blob was never primed. (Both currently show "…δεν είναι διαθέσιμη χωρίς σύνδεση" / "Άγνωστο χωρίς σύνδεση." — append the prepare link.)

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. Confirm the file no longer references `collaboratorsCache`, `programDetailCache`, or `songsListCache`.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/local/programs/edit/page.tsx
git commit -m "refactor: read local program editor sequences and collaborators from the reference-data blob"
```

---

### Task 9: Delete the four satellite cache modules

Last code step in the migration — done only after every consumer (Tasks 5–8) reads the blob, so the tree never sits half-migrated.

**Files:**
- Delete: `src/lib/songsListCache.ts`, `src/lib/programsListCache.ts`, `src/lib/programDetailCache.ts`, `src/lib/collaboratorsCache.ts`

- [ ] **Step 1: Verify nothing imports them.**

Run: `grep -rn "songsListCache\|programsListCache\|programDetailCache\|collaboratorsCache" src` (exclude the doomed files' own header comments).
Expected: no `import` lines remain. If any do, that consumer was missed — fix it before deleting.

- [ ] **Step 2: Delete the files.**

```bash
git rm src/lib/songsListCache.ts src/lib/programsListCache.ts src/lib/programDetailCache.ts src/lib/collaboratorsCache.ts
```

- [ ] **Step 3: Verify green**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS — no dangling imports, no failing tests.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: delete the four retired satellite offline caches"
```

---

### Task 10: Rename the Home trigger and wire it to `primeOfflineData()`

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `primeOfflineData` (Task 3). Removes the inline fetch/token/`saveReferenceData` block — `page.tsx` must no longer call `saveReferenceData` directly (single-writer invariant).

- [ ] **Step 1: Swap imports.** Change `import { getAuthToken, clearAuthToken } from '@/lib/authToken';` → `import { clearAuthToken } from '@/lib/authToken';` (`getAuthToken` moved into `primeOfflineData`; `clearAuthToken` stays for `handleLogout`). Change `import { saveReferenceData } from '@/lib/offlineCache';` → `import { primeOfflineData } from '@/lib/offlineCache';`. Keep `import { apiUrl } from '@/lib/apiClient';` — `handleLogout` still uses it.

- [ ] **Step 2: Replace `handleSync`** with a prime call (rename to `handlePrime` for vocabulary clarity):

```ts
async function handlePrime() {
  setSyncStatus('syncing');
  const result = await primeOfflineData();
  if (result.status === 'unauthorized') { setSyncStatus('unauthorized'); return; }
  setSyncStatus(result.status === 'ok' ? 'done' : 'error');
}
```

- [ ] **Step 3: Rename the button label and success copy.** Update the button (`onClick={handlePrime}`) text from `Συγχρονισμός τραγουδιών` / `Συγχρονισμός...` to `Προετοιμασία για offline` / `Προετοιμασία...`, and adjust the status lines to prepare-for-offline wording (`done` → `Έτοιμο για offline χρήση` stays fine; `error` → `Η προετοιμασία απέτυχε — χρειάζεται σύνδεση`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. Confirm `page.tsx` no longer calls `saveReferenceData`.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: rename Home sync button to Προετοιμασία για offline and route it through primeOfflineData"
```

---

### Task 11: Drain-then-prime on reconnect in `SyncQueueProvider`

**Files:**
- Modify: `src/components/SyncQueueProvider.tsx`

**Interfaces:**
- Consumes: `primeOfflineData` (Task 3), `processQueue` (already imported). Ordering is load-bearing: **drain the write queue first, then prime** — so this device's queued writes reach the server before the prime re-pulls server truth, and the local view converges instead of reverting to a stale optimistic state.

- [ ] **Step 1: Prime after a successful drain on reconnect.** Add `import { primeOfflineData } from '@/lib/offlineCache';`. In the `Network.addListener('networkStatusChange', ...)` handler, after `refresh()` (which runs `processQueue()`), prime:

```ts
const listenerPromise = Network.addListener('networkStatusChange', async (status) => {
  if (!status.connected) return;
  await refresh();       // drain the write queue first
  await primeOfflineData(); // then re-pull server truth into the blob
});
```

Keep the mount-time `refresh()` as-is (do not prime on every mount — priming stays manual + reconnect-triggered; a mount that is already online would otherwise prime on every navigation). `primeOfflineData` is safe to call regardless of connectivity (it returns `{ status: 'error' }` when the fetch fails) but is only wired to the connected branch here.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/SyncQueueProvider.tsx
git commit -m "feat: re-prime offline data after draining the write queue on reconnect"
```

---

### Task 12: Documentation — manual-testing checklist and feature backlog

Closes the loop the spec's "Affected surfaces" calls out. This is a real task, not a note.

**Files:**
- Modify: `docs/manual-testing-checklist.md`
- Modify: `docs/feature-backlog.md`

- [ ] **Step 1: Add native verification items** to `docs/manual-testing-checklist.md` (match its existing checkbox format):

```markdown
- [ ] Tap Προετοιμασία για offline on Home while online → shows Έτοιμο για offline χρήση.
- [ ] Then enable airplane mode and confirm ALL of these work offline: Διαχείριση → Τραγούδια,
      Διαχείριση → Προγράμματα, opening a program's editor that was NEVER individually opened
      before (sequences + collaborators render), Σταθερά προγράμματα, Ξεκίνα Live, and a song's
      axis Tags.
- [ ] Fresh install (or clear app data) → go offline before ever priming → every offline screen
      shows "Δεν έχει προετοιμαστεί για offline χρήση" with a Προετοιμασία για offline link, not a
      bare "άγνωστο".
- [ ] Queue an offline program/sequence edit, then reconnect → the write queue drains AND the blob
      re-primes (edit persists server-side; reopening shows server truth, not a stale optimistic copy).
- [ ] After any successful prime, confirm the four old databases are gone in DevTools →
      Application → IndexedDB: glentify-songs-list-cache, glentify-programs-list-cache,
      glentify-program-detail-cache, glentify-collaborators-cache.
```

- [ ] **Step 2: Update `docs/feature-backlog.md`.** Remove the entire "## Unify the three independent offline-cache priming triggers" section (lines ~22–39). Add a new backlog item:

```markdown
## Collaborator write-conflict resolution

The offline write model is last-write-wins with no conflict detection: song and shared
program/sequence writes apply unconditionally (scoped by ownership/access); `updatedAt` is
stored but never used as a version guard, and there is no `If-Match` / 409-on-stale. If a user
and a collaborator both edit the same shared program sequence offline, whichever queue drains
last silently wins. This is a pre-existing property of the offline write model, called out as a
Non-goal of the offline-cache priming unification
(`docs/superpowers/specs/2026-09-02-unify-offline-cache-priming-design.md`). Real resolution
needs version columns + `If-Match` on the shared program/sequence endpoints + a merge/warn UX.
Only programs and their sequences are a shared-edit surface (songs/taxonomy are owner-scoped).
Not yet brainstormed/spec'd.
```

- [ ] **Step 3: Commit**

```bash
git add docs/manual-testing-checklist.md docs/feature-backlog.md
git commit -m "docs: add offline-priming manual checks; retire backlog item, add write-conflict item"
```

---

## Final Verification (after all tasks)

- [ ] `npx tsc --noEmit && npm run lint && npm test` — all green.
- [ ] `grep -rn "songsListCache\|programsListCache\|programDetailCache\|collaboratorsCache\|saveReferenceData" src` — the only `saveReferenceData` reference is inside `offlineCache.ts` (called by `primeOfflineData`); no satellite-cache references remain.
- [ ] `npm run build:mobile` succeeds (static export + `cap sync`; APK step may warn/skip if no JDK 21 — that's fine per `CLAUDE.md`), proving the native bundle still stages without the deleted modules.
- [ ] Work through the new `docs/manual-testing-checklist.md` items on a device/emulator.
