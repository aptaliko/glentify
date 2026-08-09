# Σταθερά Προγράμματα offline στο Android — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Android (Capacitor) build of Glentify show and play back the user's existing Σταθερά Προγράμματα (fixed programs/setlists) offline, after the same sync the app already does for songs.

**Architecture:** Extend the existing `ReferenceData` sync payload (`/api/reference-data`, cached whole in IndexedDB) with a normalized `programs` field. Add three new static, native-only pages that mirror the existing web `/programs` flow but read from the cache instead of fetching, and thread the "which program/sequence am I viewing" selection through local device storage instead of URL params — the same pattern the app already uses for `/session/local`. Update `scripts/build-mobile.sh`'s staging step to keep these new pages while still stripping the web-only `/programs` routes.

**Tech Stack:** Next.js 16 static export (`output: 'export'`), Capacitor `@capacitor/preferences` (via the existing `preferencesStore` wrapper), Vitest.

## Global Constraints

- Read-only on mobile — no create/edit/delete. Editing stays exclusively on web (`/admin/programs`).
- Must work fully offline (airplane mode) after a sync — no new native page may make a network request.
- No new dynamic (`[id]`-style) routes — static export has no server to resolve them on-device. Selection state (which program/sequence is open) goes through local device storage, read by static pages, exactly like `/session/local` already does for the current song.
- Sync stays a single action — extend the existing `/api/reference-data` payload and the existing "Συγχρονισμός τραγουδιών" button; no second sync button/flow.
- Reuse the existing web pages' layout, copy, and empty-state messages verbatim where an equivalent screen exists — don't invent new wording.
- Don't modify `/programs/*` (web) or `/admin/programs` behavior in any way.
- This codebase's convention: pure logic (`src/lib/*.ts`) gets Vitest unit tests; DB-touching query/route/UI code is verified manually.

---

## Task 1: Extend `ReferenceData` with `programs` and wire it into the sync endpoint

**Files:**
- Modify: `src/lib/referenceData.ts`
- Modify: `src/db/queries/programs.ts`
- Modify: `src/app/api/reference-data/route.ts`
- Modify: `src/lib/songPickerData.test.ts`
- Modify: `src/lib/sessionStore.test.ts`

**Interfaces:**
- Consumes: `listPrograms(ownerId)`, `listSequencesForProgram(programId)`, `listSongsForSequence(sequenceId)` (all already exist in `src/db/queries/programs.ts`, unchanged).
- Produces: `OfflineSequence { id: number; title: string; songIds: number[] }`, `OfflineProgram { id: number; title: string; sequences: OfflineSequence[] }`, `ReferenceData.programs: OfflineProgram[]`, `listProgramsWithSequencesAndSongs(ownerId: number): Promise<OfflineProgram[]>` — all consumed by Tasks 3-5.

- [ ] **Step 1: Add the two new types and the `programs` field to `ReferenceData`**

```ts
// src/lib/referenceData.ts
import type { SongRow, SongAxisValueRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface OfflineSequence {
  id: number;
  title: string;
  songIds: number[]; // already in playback order
}

export interface OfflineProgram {
  id: number;
  title: string;
  sequences: OfflineSequence[]; // already in display order (server-side orderBy position)
}

export interface ReferenceData {
  songs: SongRow[];
  axisValues: SongAxisValueRow[];
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
  programs: OfflineProgram[];
}
```

- [ ] **Step 2: Add `listProgramsWithSequencesAndSongs` to `src/db/queries/programs.ts`**

Add this import to the top of the file (alongside the existing imports):

```ts
import type { OfflineProgram } from '@/lib/referenceData';
```

Add this function at the end of the file:

```ts
export async function listProgramsWithSequencesAndSongs(ownerId: number): Promise<OfflineProgram[]> {
  const programList = await listPrograms(ownerId);
  return Promise.all(
    programList.map(async (program) => {
      const sequenceList = await listSequencesForProgram(program.id);
      const sequences = await Promise.all(
        sequenceList.map(async (sequence) => {
          const entries = await listSongsForSequence(sequence.id);
          return { id: sequence.id, title: sequence.title, songIds: entries.map((e) => e.song.id) };
        })
      );
      return { id: program.id, title: program.title, sequences };
    })
  );
}
```

- [ ] **Step 3: Wire it into `/api/reference-data`**

```ts
// src/app/api/reference-data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { listSongs } from '@/db/queries/songs';
import { getAxisValuesForOwner, listAxisTypes } from '@/db/queries/axisValues';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listGenres } from '@/db/queries/genres';
import { listProgramsWithSequencesAndSongs } from '@/db/queries/programs';
import type { ReferenceData } from '@/lib/referenceData';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const ownerId = getUserId(request);
  const [songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs] = await Promise.all([
    listSongs(ownerId),
    getAxisValuesForOwner(ownerId),
    listAxisTypes(),
    listRegions(ownerId),
    listRhythms(ownerId),
    listDromoi(ownerId),
    listComposers(ownerId),
    listGenres(ownerId),
    listProgramsWithSequencesAndSongs(ownerId),
  ]);
  const payload: ReferenceData = { songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs };
  return NextResponse.json(payload);
}
```

- [ ] **Step 4: Fix the two test files that construct `ReferenceData` literals**

`ReferenceData` is no longer satisfied without a `programs` field — `npx tsc --noEmit` will fail on these two files until fixed. In `src/lib/songPickerData.test.ts`, inside the `referenceData()` function, add `programs: [],` as the last property of the returned object (after `genres: [],`). In `src/lib/sessionStore.test.ts`, add `programs: [],` as the last property of the returned object in **both** `referenceData()` and `referenceDataWithThreeSongs()`.

- [ ] **Step 5: Verify**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: all green — the two test files' fixtures now type-check, no other file references `ReferenceData` as a literal.

- [ ] **Step 6: Commit**

```bash
git add src/lib/referenceData.ts src/db/queries/programs.ts src/app/api/reference-data/route.ts src/lib/songPickerData.test.ts src/lib/sessionStore.test.ts
git commit -m "Add programs to the offline reference-data sync payload"
```

---

## Task 2: `src/lib/localProgramsStore.ts` — selection-state helpers

**Files:**
- Create: `src/lib/localProgramsStore.ts`
- Test: `src/lib/localProgramsStore.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore` (existing interface, `src/lib/preferencesStore.ts`: `get<T>(key): Promise<T | null>`, `set<T>(key, value: T | null): Promise<void>`).
- Produces: `setSelectedProgramId(storage: KeyValueStore, id: number): Promise<void>`, `getSelectedProgramId(storage: KeyValueStore): Promise<number | null>`, `setSelectedSequenceId(storage: KeyValueStore, id: number): Promise<void>`, `getSelectedSequenceId(storage: KeyValueStore): Promise<number | null>` — all consumed by Tasks 3-5.

This is the one piece of this feature that is pure logic over an injectable interface (`KeyValueStore`), so — per this codebase's convention — it gets a real Vitest unit test, following the exact same in-memory-store testing pattern already used in `src/lib/sessionStore.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/localProgramsStore.test.ts
import { describe, it, expect } from 'vitest';
import {
  setSelectedProgramId,
  getSelectedProgramId,
  setSelectedSequenceId,
  getSelectedSequenceId,
} from './localProgramsStore';
import type { KeyValueStore } from './preferencesStore';

function inMemoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return (map.has(key) ? (map.get(key) as T) : null);
    },
    async set<T>(key: string, value: T | null) {
      if (value === null) map.delete(key);
      else map.set(key, value);
    },
  };
}

describe('localProgramsStore', () => {
  it('returns null for the selected program id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedProgramId(store)).toBeNull();
  });

  it('round-trips the selected program id', async () => {
    const store = inMemoryStore();
    await setSelectedProgramId(store, 42);
    expect(await getSelectedProgramId(store)).toBe(42);
  });

  it('returns null for the selected sequence id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedSequenceId(store)).toBeNull();
  });

  it('round-trips the selected sequence id', async () => {
    const store = inMemoryStore();
    await setSelectedSequenceId(store, 7);
    expect(await getSelectedSequenceId(store)).toBe(7);
  });

  it('keeps the program and sequence selections independent', async () => {
    const store = inMemoryStore();
    await setSelectedProgramId(store, 1);
    await setSelectedSequenceId(store, 2);
    expect(await getSelectedProgramId(store)).toBe(1);
    expect(await getSelectedSequenceId(store)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- localProgramsStore`
Expected: FAIL with "Cannot find module './localProgramsStore'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/localProgramsStore.ts
import type { KeyValueStore } from './preferencesStore';

const SELECTED_PROGRAM_KEY = 'glentify:selected-program-id';
const SELECTED_SEQUENCE_KEY = 'glentify:selected-sequence-id';

export async function setSelectedProgramId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_PROGRAM_KEY, id);
}

export async function getSelectedProgramId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_PROGRAM_KEY);
}

export async function setSelectedSequenceId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_SEQUENCE_KEY, id);
}

export async function getSelectedSequenceId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_SEQUENCE_KEY);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- localProgramsStore`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/localProgramsStore.ts src/lib/localProgramsStore.test.ts
git commit -m "Add local-storage helpers for the selected program/sequence on mobile"
```

---

## Task 3: `/programs/local` — program list (native)

**Files:**
- Create: `src/app/programs/local/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData()` (`src/lib/offlineCache.ts`), `preferencesStore` (`src/lib/preferencesStore.ts`), `setSelectedProgramId` (Task 2), `ReferenceData`/`OfflineProgram` (Task 1).

- [ ] **Step 1: Write the page**

```tsx
// src/app/programs/local/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedProgramId } from '@/lib/localProgramsStore';
import type { ReferenceData, OfflineProgram } from '@/lib/referenceData';

export default function LocalProgramsPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    loadReferenceData()
      .then(setReferenceData)
      .finally(() => setCheckedCache(true));
  }, []);

  async function handleSelect(program: OfflineProgram) {
    await setSelectedProgramId(preferencesStore, program.id);
    router.push('/programs/local/program');
  }

  if (!checkedCache) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-2">
          <ul className="flex flex-col gap-1">
            {referenceData.programs.map((p) => (
              <li key={p.id}>
                <button onClick={() => handleSelect(p)} className="btn btn-outline btn-lg w-full">
                  {p.title}
                </button>
              </li>
            ))}
            {referenceData.programs.length === 0 && (
              <li className="p-3 text-center text-sm text-base-content/50">Κανένα πρόγραμμα ακόμη</li>
            )}
          </ul>
        </div>
      </div>
      <Link href="/" className="link">Αρχική</Link>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/programs/local/page.tsx
git commit -m "Add native program list page"
```

---

## Task 4: `/programs/local/program` — sequences with preview (native)

**Files:**
- Create: `src/app/programs/local/program/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData()`, `preferencesStore`, `getSelectedProgramId`/`setSelectedSequenceId` (Task 2), `ReferenceData`/`OfflineSequence` (Task 1).

- [ ] **Step 1: Write the page**

```tsx
// src/app/programs/local/program/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedProgramId, setSelectedSequenceId } from '@/lib/localProgramsStore';
import type { ReferenceData, OfflineSequence } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

const PREVIEW_COUNT = 7;

export default function LocalProgramPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    Promise.all([loadReferenceData(), getSelectedProgramId(preferencesStore)])
      .then(([data, id]) => {
        setReferenceData(data);
        setProgramId(id);
      })
      .finally(() => setChecked(true));
  }, []);

  async function handleSelectSequence(sequence: OfflineSequence) {
    await setSelectedSequenceId(preferencesStore, sequence.id);
    router.push('/programs/local/sequence');
  }

  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  const program = referenceData?.programs.find((p) => p.id === programId) ?? null;

  if (!referenceData || !program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Το πρόγραμμα δεν βρέθηκε.</p>
        <Link href="/programs/local" className="btn btn-primary">← Όλα τα προγράμματα</Link>
      </main>
    );
  }

  const songsById = new Map<number, SongRow>(referenceData.songs.map((s) => [s.id, s]));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">{program.title}</h1>
      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        {program.sequences.map((seq) => {
          const songs = seq.songIds.map((id) => songsById.get(id)).filter((s): s is SongRow => s !== undefined);
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                <button onClick={() => handleSelectSequence(seq)} className="btn btn-outline btn-sm w-full shrink-0">
                  {seq.title}
                </button>
                <div className="flex-1 overflow-y-auto">
                  <ul className="flex flex-col gap-1 text-sm text-base-content/60">
                    {songs.slice(0, PREVIEW_COUNT).map((s, i) => (
                      <li key={s.id}>{i + 1}. {s.title}</li>
                    ))}
                  </ul>
                  {remaining > 0 && (
                    <p className="pt-1 text-xs italic text-base-content/40">+{remaining} ακόμα…</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {program.sequences.length === 0 && (
          <p className="col-span-full p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</p>
        )}
      </div>
      <Link href="/programs/local" className="link">← Όλα τα προγράμματα</Link>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/programs/local/program/page.tsx
git commit -m "Add native program-sequences page"
```

---

## Task 5: `/programs/local/sequence` — playback (native)

**Files:**
- Create: `src/app/programs/local/sequence/page.tsx`

**Interfaces:**
- Consumes: `loadReferenceData()`, `preferencesStore`, `getSelectedProgramId`/`getSelectedSequenceId` (Task 2), `ReferenceData` (Task 1).

- [ ] **Step 1: Write the page**

```tsx
// src/app/programs/local/sequence/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedProgramId, getSelectedSequenceId } from '@/lib/localProgramsStore';
import type { ReferenceData } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

export default function LocalSequencePage() {
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [sequenceId, setSequenceId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    Promise.all([
      loadReferenceData(),
      getSelectedProgramId(preferencesStore),
      getSelectedSequenceId(preferencesStore),
    ])
      .then(([data, pId, sId]) => {
        setReferenceData(data);
        setProgramId(pId);
        setSequenceId(sId);
      })
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  const program = referenceData?.programs.find((p) => p.id === programId) ?? null;
  const sequence = program?.sequences.find((s) => s.id === sequenceId) ?? null;
  const songsById = new Map<number, SongRow>((referenceData?.songs ?? []).map((s) => [s.id, s]));
  const songs = sequence
    ? sequence.songIds.map((id) => songsById.get(id)).filter((s): s is SongRow => s !== undefined)
    : [];

  if (!referenceData || !program || !sequence) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Η σειρά δεν βρέθηκε.</p>
        <Link href="/programs/local" className="btn btn-primary">← Όλα τα προγράμματα</Link>
      </main>
    );
  }

  if (songs.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <h1 className="text-2xl font-bold">{sequence.title}</h1>
        <p className="text-base-content/60">Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά.</p>
        <Link href="/programs/local/program" className="btn btn-outline">← Πίσω στις σειρές</Link>
      </main>
    );
  }

  const current = songs[Math.min(index, songs.length - 1)];
  const hasPrevious = index > 0;
  const hasNext = index < songs.length - 1;

  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/programs/local/program" className="btn btn-sm btn-outline">
            ← Σειρές προγράμματος
          </Link>
          <span className="badge badge-neutral">{index + 1} / {songs.length}</span>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{current.title}</h1>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-center">
        <div className="flex flex-1 flex-col items-center gap-4 lg:max-w-3xl">
          <div className="card flex w-full flex-col gap-3 bg-base-100 p-6 shadow sm:p-8">
            {(current.maleKey || current.femaleKey) && (
              <div className="flex justify-center gap-2">
                {current.maleKey && <span className="badge badge-outline">♂ {current.maleKey}</span>}
                {current.femaleKey && <span className="badge badge-outline">♀ {current.femaleKey}</span>}
              </div>
            )}
            {current.lyrics ? (
              <pre className="whitespace-pre-wrap text-center font-sans text-xl sm:text-2xl leading-relaxed text-base-content">
                {current.lyrics}
              </pre>
            ) : (
              <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι για αυτό το τραγούδι.</p>
            )}
          </div>

          <div className="flex w-full gap-3">
            {hasPrevious && (
              <button onClick={() => setIndex((i) => i - 1)} className="btn btn-lg flex-1">
                ← Προηγούμενο
              </button>
            )}
            {hasNext && (
              <button onClick={() => setIndex((i) => i + 1)} className="btn btn-primary btn-lg flex-1">
                Επόμενο →
              </button>
            )}
          </div>
        </div>

        <div className="card w-full bg-base-100 shadow lg:w-72 lg:shrink-0">
          <div className="card-body gap-1 p-4">
            <h2 className="text-sm font-semibold text-base-content/60">Λίστα σειράς</h2>
            <ul className="flex flex-col gap-1">
              {songs.map((s, i) => (
                <li key={s.id}>
                  <button
                    onClick={() => setIndex(i)}
                    className={`btn btn-ghost btn-sm w-full justify-start text-left ${i === index ? 'btn-active' : ''}`}
                  >
                    <span className="badge badge-neutral badge-sm">{i + 1}</span>
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
```

Note: this view intentionally shows only lyrics + keys, no `imageUrl` — the web page it mirrors (`src/app/programs/[id]/sequences/[seqId]/page.tsx`) doesn't show sheet-music images either, so this stays at parity with it rather than adding a new capability.

- [ ] **Step 2: Commit**

```bash
git add src/app/programs/local/sequence/page.tsx
git commit -m "Add native sequence-playback page"
```

---

## Task 6: Home screen button + `build-mobile.sh` staging update

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `scripts/build-mobile.sh`

**Interfaces:**
- Consumes: nothing new (pure routing/build-script change).

- [ ] **Step 1: Add the native-only home screen button**

In `src/app/page.tsx`, the current file has this block:

```tsx
      {!native && (
        <Link href="/programs" className="btn btn-outline btn-lg">
          Σταθερά προγράμματα
        </Link>
      )}
```

Add a native counterpart immediately before it:

```tsx
      {native && (
        <Link href="/programs/local" className="btn btn-outline btn-lg">
          Σταθερά προγράμματα
        </Link>
      )}

      {!native && (
        <Link href="/programs" className="btn btn-outline btn-lg">
          Σταθερά προγράμματα
        </Link>
      )}
```

- [ ] **Step 2: Update the staging step in `scripts/build-mobile.sh`**

The current script has this line among the staging removals:

```bash
rm -rf .mobile-build/src/app/programs
```

Replace that one line with:

```bash
rm -rf ".mobile-build/src/app/programs/[id]"
rm -f ".mobile-build/src/app/programs/page.tsx"
```

This removes the web-only list page and the web-only dynamic program/sequence tree, while leaving `.mobile-build/src/app/programs/local/` (Tasks 3-5) untouched. Leave the rest of the script's staging block (`admin`, `api`, `session/[id]`, `proxy.ts`, and both existing `if [ -d ... ]; then ... abort` checks) exactly as-is — they target unrelated paths.

- [ ] **Step 3: Run the mobile build and verify staging**

```bash
npm run build:mobile
```

Expected: succeeds (same output as before — "Mobile static export written to ./out", Capacitor sync messages). Then confirm the staging removal actually worked as intended:

```bash
ls .mobile-build/src/app/programs
```

Expected: only `local` listed (no `page.tsx`, no `[id]` directory).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx scripts/build-mobile.sh
git commit -m "Add Σταθερά προγράμματα to the native home screen and mobile build staging"
```

---

## Task 7: Manual verification on a real device

**Files:** none (manual checklist only)

- [ ] **Step 1: Rebuild and deploy to the connected Android device**

```bash
npm run build:mobile
```

Then in Android Studio (`npx cap open android` if not already open), press **Run** with the phone selected, same as the existing mobile testing flow.

- [ ] **Step 2: Sync and verify the new screen while online**

Open the app, log in if needed, tap **"Συγχρονισμός τραγουδιών"** and confirm it still reports success (this now also pulls `programs`). From the home screen, tap the new **"Σταθερά προγράμματα"** button. Confirm: the list shows the same programs as the web `/programs` page for this account, tapping one shows its sequences with the same title/preview as the web `/programs/[id]` page, and tapping a sequence opens playback with working "Προηγούμενο"/"Επόμενο" buttons and a working "Λίστα σειράς" jump-to-song sidebar.

- [ ] **Step 3: Verify it works fully offline**

Enable **airplane mode** on the phone. Fully quit and relaunch the app (don't just background it). From the home screen, tap "Σταθερά προγράμματα" again and repeat the same navigation (list → program → sequence → playback, including tapping around in "Λίστα σειράς"). Confirm everything still works with zero network access — this is the core requirement.

- [ ] **Step 4: Verify the empty-cache and empty-program edge cases**

If you have a program with no sequences, or a sequence with no songs, confirm the corresponding empty-state message shows (matching the web copy) rather than a crash or blank screen. If convenient, also verify a fresh install (before ever syncing) shows "Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή." on `/programs/local` rather than an empty list.

- [ ] **Step 5: Confirm nothing else regressed**

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all clean. Confirm the existing "Ξεκίνα Γλέντι" / offline live-session flow still works unaffected (it doesn't touch anything this plan changed, but it's the app's core feature — worth a quick smoke check).
