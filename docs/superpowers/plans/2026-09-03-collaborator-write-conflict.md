# Collaborator Write-Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when a queued offline write targets a shared program/sequence that a collaborator changed since the edit was captured, and warn the user instead of silently overwriting.

**Architecture:** Add a per-sequence and per-program `version` column. The three whole-value-replacement PATCH routes (sequence rename, sequence reorder, program rename) honor an optional `If-Match: <version>` header — absent means today's last-write-wins (old APKs and web unaffected), present-and-stale means `409`. The native sync queue gains a fourth `'conflict'` outcome that flags `needsAttention` immediately, reusing the existing merge "revert to last-known real state" behavior as the warn UX. A `draftIds`-shaped version map records each resource's post-write version so a user's own consecutive offline edits don't false-conflict.

**Tech Stack:** Next.js (App Router, this repo's forked version — read `node_modules/next/dist/docs/` before touching routes), Drizzle/Postgres, Vitest, IndexedDB, Capacitor.

**Spec:** `docs/superpowers/specs/2026-09-03-collaborator-write-conflict-design.md`

## Global Constraints

- **`If-Match` is optional, never required.** A request with no `If-Match` header MUST follow today's last-write-wins path unchanged. Native points `NEXT_PUBLIC_API_BASE_URL` at the deployed web app, so an un-updated APK keeps calling these endpoints headerless and must not break. A malformed/non-numeric `If-Match` is treated as absent (LWW), not an error.
- **Guarded set = exactly three ops:** `sequence-rename`, `sequence-reorder`, `program-rename`. These warn on both `409` (stale) and `404` (target gone). Every other action keeps current behavior including `404 → success`.
- **Add/remove-song and reorder still BUMP the sequence version** even though add/remove are not guarded *writers* — bumping and guarding are separate concerns; a guarded reorder/rename must see a collaborator's add/remove as a version change.
- **Testing convention (`CLAUDE.md`):** vitest covers pure logic only. Unit-test the `syncQueue` outcome branch, the version resolver, and the merge changes. Endpoints, query DB code, IndexedDB persistence, and page wiring are verified manually and recorded in `docs/manual-testing-checklist.md` — do NOT write API-route or IndexedDB automated tests.
- **Version columns:** `NOT NULL DEFAULT 1`, monotonically increasing. Migration is a plain `db:generate` + `db:migrate` (no multiuser/finalize sequence — that exists only for the `owner_id` backfill).
- **Greek UI copy.** Conflict copy is «άλλαξε από συνεργάτη»; the existing failure copy «απέτυχε» stays for non-conflict `needsAttention`.

---

### Task 1: Schema — version columns + migration

**Files:**
- Modify: `src/db/schema.ts:104-115` (programs, programSequences tables)
- Create: generated migration under `drizzle/` (via `npm run db:generate`)

**Interfaces:**
- Produces: `programs.version` and `program_sequences.version` (`integer NOT NULL DEFAULT 1`). `ProgramRow` and `ProgramSequenceRow` (`$inferSelect`) now include `version: number`.

- [ ] **Step 1: Add the columns**

In `src/db/schema.ts`, add `version` to both tables (Drizzle `integer` is already imported):

```ts
export const programs = pgTable('programs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  ownerId: integer('owner_id').notNull().references(() => users.id),
  version: integer('version').notNull().default(1),
});

export const programSequences = pgTable('program_sequences', {
  id: serial('id').primaryKey(),
  programId: integer('program_id').notNull().references(() => programs.id),
  title: text('title').notNull(),
  position: integer('position').notNull(),
  version: integer('version').notNull().default(1),
});
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new SQL file appears under `drizzle/` adding both `version` columns with `DEFAULT 1 NOT NULL`. Open it and confirm it does NOT touch `owner_id` or any other column.

- [ ] **Step 3: Verify the build typechecks**

Run: `npm run build`
Expected: PASS. `ProgramRow`/`ProgramSequenceRow` now carry `version`; nothing references it yet, so no call-site errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add version columns to programs and program_sequences"
```

---

### Task 2: Query layer — version bumping + If-Match helpers

**Files:**
- Modify: `src/db/queries/programs.ts` (`updateSequence:68`, `updateProgram:35`, `addSongToSequence:93`, `removeSongFromSequence:102`, `reorderSequenceSongs:106`)
- Modify: `src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts:26` (removeSongFromSequence signature change)

**Interfaces:**
- Produces:
  - `updateSequence(id: number, title: string): Promise<ProgramSequenceRow>` — now also bumps `version`.
  - `updateSequenceIfMatch(id: number, title: string, expectedVersion: number): Promise<ProgramSequenceRow | null>` — updates+bumps only if current `version === expectedVersion`; `null` on mismatch.
  - `bumpSequenceVersion(sequenceId: number): Promise<void>` — unconditional `version += 1`.
  - `bumpSequenceVersionIfMatch(sequenceId: number, expectedVersion: number): Promise<number | null>` — bumps only on match; returns new version or `null`.
  - `updateProgram(id, title): Promise<ProgramRow | undefined>` — now bumps `version`.
  - `updateProgramIfMatch(id: number, title: string, expectedVersion: number): Promise<ProgramRow | null>`.
  - `removeSongFromSequence(sequenceId: number, sequenceSongId: number): Promise<void>` — signature gains `sequenceId`, bumps the sequence version.
  - `addSongToSequence` / `reorderSequenceSongs` unchanged signatures, now bump the sequence version.
- Consumes: `sql` from `drizzle-orm` (add to the existing import on line 3).

- [ ] **Step 1: Import `sql`**

In `src/db/queries/programs.ts` line 3, extend the import:

```ts
import { eq, and, asc, max, inArray, sql } from 'drizzle-orm';
```

- [ ] **Step 2: Bump version in `updateSequence` and add the guarded twin**

Replace `updateSequence` (line 68) with:

```ts
export async function updateSequence(id: number, title: string): Promise<ProgramSequenceRow> {
  const rows = await db
    .update(programSequences)
    .set({ title, version: sql`${programSequences.version} + 1` })
    .where(eq(programSequences.id, id))
    .returning();
  return rows[0];
}

export async function updateSequenceIfMatch(
  id: number,
  title: string,
  expectedVersion: number
): Promise<ProgramSequenceRow | null> {
  const rows = await db
    .update(programSequences)
    .set({ title, version: sql`${programSequences.version} + 1` })
    .where(and(eq(programSequences.id, id), eq(programSequences.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}
```

- [ ] **Step 3: Add sequence version bump helpers**

Add near `reorderSequenceSongs`:

```ts
export async function bumpSequenceVersion(sequenceId: number): Promise<void> {
  await db
    .update(programSequences)
    .set({ version: sql`${programSequences.version} + 1` })
    .where(eq(programSequences.id, sequenceId));
}

export async function bumpSequenceVersionIfMatch(
  sequenceId: number,
  expectedVersion: number
): Promise<number | null> {
  const rows = await db
    .update(programSequences)
    .set({ version: sql`${programSequences.version} + 1` })
    .where(and(eq(programSequences.id, sequenceId), eq(programSequences.version, expectedVersion)))
    .returning({ version: programSequences.version });
  return rows[0]?.version ?? null;
}
```

- [ ] **Step 4: Make the song mutations bump the parent sequence version**

Replace `addSongToSequence`, `removeSongFromSequence`, `reorderSequenceSongs` (lines 93-113):

```ts
export async function addSongToSequence(sequenceId: number, songId: number): Promise<void> {
  const [{ value }] = await db
    .select({ value: max(sequenceSongs.position) })
    .from(sequenceSongs)
    .where(eq(sequenceSongs.sequenceId, sequenceId));
  const nextPosition = (value ?? -1) + 1;
  await db.insert(sequenceSongs).values({ sequenceId, songId, position: nextPosition });
  await bumpSequenceVersion(sequenceId);
}

export async function removeSongFromSequence(sequenceId: number, sequenceSongId: number): Promise<void> {
  await db.delete(sequenceSongs).where(eq(sequenceSongs.id, sequenceSongId));
  await bumpSequenceVersion(sequenceId);
}

export async function reorderSequenceSongs(sequenceId: number, orderedSequenceSongIds: number[]): Promise<void> {
  for (const [position, sequenceSongId] of orderedSequenceSongIds.entries()) {
    await db
      .update(sequenceSongs)
      .set({ position })
      .where(and(eq(sequenceSongs.id, sequenceSongId), eq(sequenceSongs.sequenceId, sequenceId)));
  }
  await bumpSequenceVersion(sequenceId);
}
```

`bumpSequenceVersion` is defined in Step 3 — declaration order within a module doesn't matter for hoisted `function` declarations, but keep Step 3's block above these if your linter's `no-use-before-define` is on (this repo's isn't for functions).

- [ ] **Step 5: Update the one `removeSongFromSequence` caller**

In `src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts:26`, pass the sequence id (already in scope as `sequence.id`):

```ts
await removeSongFromSequence(sequence.id, Number(entryId));
```

- [ ] **Step 6: Bump version in `updateProgram` and add the guarded twin**

Replace `updateProgram` (line 35):

```ts
export async function updateProgram(id: number, title: string): Promise<ProgramRow | undefined> {
  const rows = await db
    .update(programs)
    .set({ title, version: sql`${programs.version} + 1` })
    .where(eq(programs.id, id))
    .returning();
  return rows[0];
}

export async function updateProgramIfMatch(
  id: number,
  title: string,
  expectedVersion: number
): Promise<ProgramRow | null> {
  const rows = await db
    .update(programs)
    .set({ title, version: sql`${programs.version} + 1` })
    .where(and(eq(programs.id, id), eq(programs.version, expectedVersion)))
    .returning();
  return rows[0] ?? null;
}
```

- [ ] **Step 7: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS. (No automated DB test — repo convention.)

- [ ] **Step 8: Commit**

```bash
git add src/db/queries/programs.ts "src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts"
git commit -m "feat: version-bumping and If-Match query helpers for programs/sequences"
```

---

### Task 3: Endpoints — honor optional If-Match (409 on stale)

**Files:**
- Modify: `src/app/api/programs/[id]/sequences/[seqId]/route.ts` (PATCH, rename)
- Modify: `src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts` (PATCH, reorder)
- Modify: `src/app/api/programs/[id]/route.ts` (PATCH, program rename)
- Modify: `docs/manual-testing-checklist.md`

**Interfaces:**
- Consumes: `updateSequenceIfMatch`, `bumpSequenceVersionIfMatch`, `bumpSequenceVersion`, `updateProgramIfMatch` (Task 2).
- Produces: guarded PATCH routes that, when `If-Match: <n>` is present, return `200 { ...value, version }` on match or `409 { error, version }` on stale; when absent, behave as today (and still bump version).

- [ ] **Step 1: Add a shared header parser**

Create `src/lib/ifMatch.ts`:

```ts
// Parses an optional If-Match header as an integer version. Returns null for a
// missing or non-numeric value, which callers treat as "no guard" (last-write-wins).
export function parseIfMatch(request: { headers: { get(name: string): string | null } }): number | null {
  const raw = request.headers.get('if-match');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}
```

- [ ] **Step 2: Guard the sequence-rename PATCH**

In `src/app/api/programs/[id]/sequences/[seqId]/route.ts`, import the parser and the guarded query, and replace the body of `PATCH` after the schema parse (line 41):

```ts
import { parseIfMatch } from '@/lib/ifMatch';
// add updateSequenceIfMatch to the existing '@/db/queries/programs' import
```

```ts
  const expected = parseIfMatch(request);
  if (expected !== null) {
    const updated = await updateSequenceIfMatch(Number(seqId), parsed.data.title, expected);
    if (!updated) {
      const current = await getSequenceById(Number(seqId));
      return NextResponse.json({ error: 'Άλλαξε από συνεργάτη', version: current?.version ?? null }, { status: 409 });
    }
    return NextResponse.json(updated);
  }
  const updated = await updateSequence(Number(seqId), parsed.data.title);
  return NextResponse.json(updated);
```

- [ ] **Step 3: Guard the reorder PATCH**

In `src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts`, import `parseIfMatch`, `bumpSequenceVersionIfMatch`, `getSequenceById` (already imported). Replace the reorder body after schema parse (line 45):

```ts
  const expected = parseIfMatch(request);
  if (expected !== null) {
    const newVersion = await bumpSequenceVersionIfMatch(Number(seqId), expected);
    if (newVersion === null) {
      const current = await getSequenceById(Number(seqId));
      return NextResponse.json({ error: 'Άλλαξε από συνεργάτη', version: current?.version ?? null }, { status: 409 });
    }
    await reorderSequenceSongs(Number(seqId), parsed.data.orderedIds);
    return NextResponse.json({ ok: true, version: newVersion });
  }
  await reorderSequenceSongs(Number(seqId), parsed.data.orderedIds);
  return NextResponse.json({ ok: true });
```

Note: `reorderSequenceSongs` bumps the version again in the LWW branch (Task 2 Step 4). In the guarded branch the gate already bumped it, so do NOT double-bump — `reorderSequenceSongs` bumping a second time is harmless for correctness (version only ever needs to *change*), but to keep versions predictable, extract the positional updates into a non-bumping helper if you prefer. Acceptable v1: leave the extra bump; a reorder advancing the version by 2 is fine because nothing depends on the increment size, only on inequality. Record this choice in the checklist.

- [ ] **Step 4: Guard the program-rename PATCH**

In `src/app/api/programs/[id]/route.ts`, import `parseIfMatch` and add `updateProgramIfMatch` to the query import. Replace the PATCH body after schema parse (line 25):

```ts
  const expected = parseIfMatch(request);
  if (expected !== null) {
    const program = await updateProgramIfMatch(Number(id), parsed.data.title, expected);
    if (!program) {
      const current = await getProgramById(Number(id));
      return NextResponse.json({ error: 'Άλλαξε από συνεργάτη', version: current?.version ?? null }, { status: 409 });
    }
    return NextResponse.json(program);
  }
  const program = await updateProgram(Number(id), parsed.data.title);
  return NextResponse.json(program);
```

- [ ] **Step 5: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Record manual checks**

Add to `docs/manual-testing-checklist.md` under a new "Collaborator write-conflict" section:

```markdown
## Collaborator write-conflict resolution

- [ ] Sequence rename with no If-Match header behaves as before (web edit page still works).
- [ ] Sequence rename with a matching If-Match returns 200 and the row's version increments.
- [ ] Sequence rename with a stale If-Match returns 409 with the current version, no title change.
- [ ] Same three cases for reorder (PATCH .../songs) and program rename (PATCH /api/programs/[id]).
- [ ] A collaborator's add-song bumps the sequence version, so a concurrent stale reorder 409s.
- [ ] A malformed If-Match (e.g. "abc") is treated as no header (LWW), not a 400.
```

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/programs" src/lib/ifMatch.ts docs/manual-testing-checklist.md
git commit -m "feat: honor optional If-Match with 409 on the three guarded PATCH routes"
```

---

### Task 4: Sync queue — a fourth `'conflict'` outcome

**Files:**
- Modify: `src/lib/syncQueue.ts`
- Test: `src/lib/syncQueue.test.ts` (existing)

**Interfaces:**
- Produces: `SyncOutcome` now includes `'conflict'`. `QueuedAction` gains `needsAttentionReason?: 'conflict' | 'failed'`. `processQueueWith`: `'conflict'` sets `needsAttention: true`, `needsAttentionReason: 'conflict'` on attempt 1 and continues the pass; an `item-error` reaching `MAX_ATTEMPTS` sets `needsAttentionReason: 'failed'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/syncQueue.test.ts` (follow the file's existing fake-`QueueStorage` setup):

```ts
it('flags conflict immediately with reason "conflict" and keeps draining', async () => {
  const storage = makeStorage([
    action({ id: 'a', type: 'x' }),
    action({ id: 'b', type: 'y' }),
  ]);
  const handlers = new Map<string, SyncHandler>([
    ['x', async () => 'conflict'],
    ['y', async () => 'success'],
  ]);
  const result = await processQueueWith(storage, handlers);
  const remaining = await storage.get();
  const a = remaining.find((x) => x.id === 'a')!;
  expect(a.needsAttention).toBe(true);
  expect(a.needsAttentionReason).toBe('conflict');
  expect(a.attempts).toBe(1);
  expect(remaining.find((x) => x.id === 'b')).toBeUndefined(); // y still processed
  expect(result.blocked).toBe(false);
});

it('sets reason "failed" when an item-error reaches the attempt cap', async () => {
  const storage = makeStorage([action({ id: 'a', type: 'x', attempts: 2 })]);
  const handlers = new Map<string, SyncHandler>([['x', async () => 'item-error']]);
  await processQueueWith(storage, handlers);
  const a = (await storage.get()).find((x) => x.id === 'a')!;
  expect(a.needsAttention).toBe(true);
  expect(a.needsAttentionReason).toBe('failed');
});
```

(Match the exact helper names — `makeStorage`/`action` — already used in the file; adapt if they differ.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/syncQueue.test.ts`
Expected: FAIL — `'conflict'` not assignable to `SyncOutcome`, `needsAttentionReason` undefined.

- [ ] **Step 3: Implement**

In `src/lib/syncQueue.ts`:

```ts
export type SyncOutcome = 'success' | 'item-error' | 'systemic-error' | 'conflict';
```

Add to `QueuedAction`:

```ts
  needsAttentionReason?: 'conflict' | 'failed';
```

In `processQueueWith`, add a `conflict` branch before the `item-error` block (after the `systemic-error` block, ~line 87):

```ts
    if (outcome === 'conflict') {
      const flagged: QueuedAction = { ...action, needsAttention: true, needsAttentionReason: 'conflict' };
      current = current.map((a) => (a.id === action.id ? flagged : a));
      await storage.set(current);
      continue;
    }
```

Change the `item-error` update to stamp the reason at the cap:

```ts
    const attempts = action.attempts + 1;
    const needsAttention = attempts >= MAX_ATTEMPTS;
    const updated: QueuedAction = {
      ...action,
      attempts,
      needsAttention,
      needsAttentionReason: needsAttention ? 'failed' : action.needsAttentionReason,
    };
    current = [...current.filter((a) => a.id !== action.id), updated];
```

Note the `conflict` item stays in place (mapped, not moved to the back) so it's excluded from the next pass by the `!a.needsAttention` filter — same permanent-skip semantics as a capped `item-error`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/syncQueue.test.ts`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncQueue.ts src/lib/syncQueue.test.ts
git commit -m "feat: add 'conflict' sync outcome that flags needsAttention immediately"
```

---

### Task 5: Version map — `syncedVersions.ts` (pure resolver + IndexedDB store)

**Files:**
- Create: `src/lib/syncedVersions.ts`
- Test: `src/lib/syncedVersions.test.ts`

**Interfaces:**
- Produces:
  - `type VersionResource = 'sequence' | 'program'`
  - `type VersionMap = Record<string, number>`
  - `resolveVersion(map: VersionMap, resource: VersionResource, id: number, baseVersion: number): number` — pure; returns the recorded post-write version if newer than `baseVersion`, else `baseVersion`.
  - `recordSyncedVersion(resource: VersionResource, id: number, version: number): Promise<void>` — IndexedDB.
  - `loadSyncedVersionMap(): Promise<VersionMap>` — IndexedDB.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test for the pure resolver**

Create `src/lib/syncedVersions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveVersion } from './syncedVersions';

describe('resolveVersion', () => {
  it('returns baseVersion when nothing recorded', () => {
    expect(resolveVersion({}, 'sequence', 5, 3)).toBe(3);
  });
  it('returns the recorded version when it is newer', () => {
    expect(resolveVersion({ 'sequence:5': 7 }, 'sequence', 5, 3)).toBe(7);
  });
  it('keeps baseVersion when the recorded version is older or equal', () => {
    expect(resolveVersion({ 'sequence:5': 3 }, 'sequence', 5, 4)).toBe(4);
  });
  it('scopes by resource type and id', () => {
    const map = { 'sequence:5': 9 };
    expect(resolveVersion(map, 'program', 5, 2)).toBe(2);
    expect(resolveVersion(map, 'sequence', 6, 2)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/syncedVersions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (modeled on `draftIds.ts`)**

Create `src/lib/syncedVersions.ts`:

```ts
export type VersionResource = 'sequence' | 'program';
export type VersionMap = Record<string, number>;

function keyFor(resource: VersionResource, id: number): string {
  return `${resource}:${id}`;
}

// Pure. The last version this device saw the server accept for a resource, used to
// forward a stale captured baseVersion so a user's own consecutive offline edits don't
// false-conflict. Returns baseVersion when nothing newer is recorded.
export function resolveVersion(map: VersionMap, resource: VersionResource, id: number, baseVersion: number): number {
  const recorded = map[keyFor(resource, id)];
  return recorded !== undefined && recorded > baseVersion ? recorded : baseVersion;
}

// --- IndexedDB-backed store (not unit-tested, per repo convention) ---

const DB_NAME = 'glentify-synced-versions';
const DB_VERSION = 1;
const STORE_NAME = 'versions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recordSyncedVersion(resource: VersionResource, id: number, version: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(version, keyFor(resource, id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSyncedVersionMap(): Promise<VersionMap> {
  const db = await openDb();
  const map = await new Promise<VersionMap>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as number[];
      const out: VersionMap = {};
      keys.forEach((k, i) => { out[k] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return map;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/syncedVersions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/syncedVersions.ts src/lib/syncedVersions.test.ts
git commit -m "feat: synced-version map to forward baseVersion past a user's own writes"
```

---

### Task 6: Guarded sync handlers — send If-Match, map 409/404 → conflict, record version

**Files:**
- Modify: `src/lib/syncHandlers.ts` (`handleSequenceRenameSync:283`, `handleSequenceReorderSync:358`, `handleRenameProgramSync:168`, and the payload interfaces at 168/249/253)
- Modify: `docs/manual-testing-checklist.md`

**Interfaces:**
- Consumes: `resolveVersion`, `recordSyncedVersion`, `loadSyncedVersionMap` (Task 5); `baseVersion` on the three guarded payloads (stamped in Task 8 — until then it's `undefined`, and a `undefined` baseVersion means "send no If-Match", i.e. LWW, which is safe).
- Produces: the three guarded handlers return `'conflict'` on `409`/`404`, `'success'` on `2xx` (recording the returned version), unchanged mapping otherwise.

- [ ] **Step 1: Import the version map**

In `src/lib/syncHandlers.ts` line 8 area, add:

```ts
import { loadSyncedVersionMap, recordSyncedVersion, resolveVersion } from './syncedVersions';
```

- [ ] **Step 2: Extend the guarded payload types with `baseVersion`**

```ts
interface SeqRenamePayload { programId: number; sequenceId: number; title: string; baseVersion?: number }
interface SeqReorderPayload { programId: number; sequenceId: number; orderedIds: number[]; baseVersion?: number }
```

And for program rename, the payload comes from `RenameProgramPayload` (`programsMerge.ts`) — add `baseVersion?: number` there (Task 8 also reads it). For now, in the handler, read it via a local widened type:

```ts
const { programId, title, baseVersion } = payload as RenameProgramPayload & { baseVersion?: number };
```

- [ ] **Step 3: Add an If-Match helper inside syncHandlers**

```ts
// Builds headers for a guarded write: attaches If-Match only when a baseVersion is present,
// forwarding it past the device's own already-synced writes so a user's consecutive offline
// edits to one resource don't 409 against themselves.
async function guardedHeaders(resource: 'sequence' | 'program', id: number, baseVersion: number | undefined): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof baseVersion === 'number') {
    const map = await loadSyncedVersionMap();
    headers['If-Match'] = String(resolveVersion(map, resource, id, baseVersion));
  }
  return headers;
}
```

- [ ] **Step 4: Update `handleSequenceRenameSync`**

```ts
async function handleSequenceRenameSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, title, baseVersion } = payload as SeqRenamePayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}`,
    { method: 'PATCH', headers: await guardedHeaders('sequence', sid, baseVersion), body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.version === 'number') await recordSyncedVersion('sequence', sid, body.version);
    return 'success';
  }
  if (res.status === 409 || res.status === 404) return 'conflict';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

- [ ] **Step 5: Update `handleSequenceReorderSync`**

Keep the existing draft-resolution of `orderedIds`; change only the headers, the ok-branch version recording, and the 404/409 mapping:

```ts
async function handleSequenceReorderSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, sequenceId, orderedIds, baseVersion } = payload as SeqReorderPayload;
  const pid = await resolveSeqId('sequence', programId);
  const sid = await resolveSeqId('sequence', sequenceId);
  if (pid === null || sid === null) return 'item-error';
  const map = await loadDraftMap();
  const resolved = resolveMany(map, 'sequence-song', orderedIds);
  if (!resolved.allResolved) return 'item-error';
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(pid)}/sequences/${encodeURIComponent(sid)}/songs`,
    { method: 'PATCH', headers: await guardedHeaders('sequence', sid, baseVersion), body: JSON.stringify({ orderedIds: resolved.ids }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.version === 'number') await recordSyncedVersion('sequence', sid, body.version);
    return 'success';
  }
  if (res.status === 409 || res.status === 404) return 'conflict';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

- [ ] **Step 6: Update `handleRenameProgramSync`**

```ts
async function handleRenameProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, title, baseVersion } = payload as RenameProgramPayload & { baseVersion?: number };
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'PATCH', headers: await guardedHeaders('program', programId, baseVersion), body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    const body = await res.json().catch(() => null);
    if (body && typeof body.version === 'number') await recordSyncedVersion('program', programId, body.version);
    return 'success';
  }
  if (res.status === 409 || res.status === 404) return 'conflict';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

Note: `programId` here is never a draft (program renames only apply to synced programs), so no `resolveSeqId` is needed — matching the existing handler.

- [ ] **Step 7: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 8: Record manual checks**

Append to the checklist section from Task 3:

```markdown
- [ ] Two devices editing the same sequence offline: the second to sync surfaces «άλλαξε από συνεργάτη», the first wins.
- [ ] Same user's two consecutive offline renames of one sequence both sync cleanly (no self-conflict) after reconnect.
- [ ] Renaming a sequence a collaborator deleted (404) surfaces as a conflict, not a silent discard.
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/syncHandlers.ts docs/manual-testing-checklist.md
git commit -m "feat: guarded sync handlers send If-Match and map 409/404 to conflict"
```

---

### Task 7: Carry `version` end-to-end into the offline caches

**Files:**
- Modify: `src/lib/referenceData.ts` (`OfflineSequence:13`, `OfflineProgram:20`, `CachedSequence:69`, `CachedProgramDetail:76`, `normalizeReferenceData:104`)
- Modify: `src/db/queries/programs.ts` (`listProgramsWithSequencesAndSongs:115`)
- Modify: `src/lib/offlineProgramView.ts`
- Modify: `src/app/admin/programs/page.tsx` (`ProgramListItem` type / base list)

**Interfaces:**
- Produces: `version: number` present on `OfflineSequence`, `OfflineProgram`, `CachedSequence`, and on the base program-list item consumed by `mergeProgramsWithPending`. `CachedProgramDetail` gains program-level `version`.
- Consumes: `sequence.version` / `program.version` from Task 1's rows.

- [ ] **Step 1: Add `version` to the cache types**

In `src/lib/referenceData.ts`:

```ts
export interface OfflineSequence {
  id: number;
  title: string;
  songIds: number[];
  entries: OfflineSequenceEntry[];
  version: number;
}
```

```ts
export interface OfflineProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  creator: OfflineCollaborator | null;
  collaborators: OfflineCollaborator[];
  sequences: OfflineSequence[];
  version: number;
}
```

```ts
export interface CachedSequence {
  id: number;
  title: string;
  position: number;
  songs: CachedSequenceSong[];
  version: number;
}
```

```ts
export interface CachedProgramDetail {
  programId: number;
  title: string;
  role: 'creator' | 'collaborator';
  sequences: CachedSequence[];
  cachedAt: string;
  version: number;
}
```

- [ ] **Step 2: Backfill in `normalizeReferenceData`**

In the `programs` map (line 107) add `version` defaults so pre-existing blobs don't break:

```ts
    programs: (data.programs ?? []).map((p) => ({
      ...p,
      role: p.role ?? 'creator',
      sharedWithEmails: p.sharedWithEmails ?? [],
      creator: p.creator ?? null,
      collaborators: p.collaborators ?? [],
      version: (p as OfflineProgram).version ?? 1,
      sequences: (p.sequences ?? []).map((s) => ({ ...s, entries: s.entries ?? [], version: (s as OfflineSequence).version ?? 1 })),
    })),
```

(A blob primed before versions existed only renders behind a re-prime prompt — see the existing doc comment — so `1` is a safe placeholder; the next prime overwrites it with real server values.)

- [ ] **Step 3: Populate `version` in the server builder**

In `src/db/queries/programs.ts` `listProgramsWithSequencesAndSongs` (line ~126), add `version` to each sequence and to the program object:

```ts
          return {
            id: sequence.id,
            title: sequence.title,
            songIds: seqEntries.map((e) => e.song.id),
            entries: seqEntries.map((e) => ({ sequenceSongId: e.sequenceSongId, songId: e.song.id })),
            version: sequence.version,
          };
```

```ts
      return {
        id: program.id,
        title: program.title,
        role: program.role,
        sharedWithEmails: program.sharedWithEmails,
        creator: program.creator,
        collaborators: program.collaborators,
        sequences,
        version: program.version,
      };
```

`program.version` requires the `listAccessiblePrograms` row to carry it — verify that query selects `programs.version` (it selects the program row). If it projects specific columns, add `version: programs.version`. Confirm by reading `listAccessiblePrograms` in the same file.

- [ ] **Step 4: Carry `version` through `offlineProgramView.ts`**

In the reshape function, add program `version` and per-sequence `version`:

```ts
    programId: program.id,
    title: program.title,
    role: program.role,
    version: program.version,
    sequences: program.sequences.map((s) => ({
      id: s.id,
      title: s.title,
      position: /* existing */,
      songs: /* existing */,
      version: s.version,
    })),
    cachedAt: /* existing */,
```

(Read the current file for the exact `position`/`songs`/`cachedAt` expressions — add only the two `version` lines.)

- [ ] **Step 5: Carry `version` in the edit page's online `loadSequences`**

In `src/app/admin/local/programs/edit/page.tsx` (line ~89-104): the GET response's `data.sequences` items are typed `{ id, title, position }` — widen to include `version` and set it on the built `CachedSequence`, and set the program `version` on `detail`:

```ts
        (data.sequences as { id: number; title: string; position: number; version: number }[]).map(async (seq) => {
          // ...existing song-building...
          return { id: seq.id, title: seq.title, position: seq.position, songs, version: seq.version };
        })
```

```ts
      const detail: CachedProgramDetail = { programId: id, title: data.title, role: data.role, sequences, cachedAt: '', version: data.version };
```

(`data.version` is the program row's version, already returned by `GET /api/programs/[id]` via `{ ...program, role, sequences }`.)

- [ ] **Step 6: Add `version` to the admin/programs base list item**

In `src/app/admin/programs/page.tsx`, find the `ProgramListItem` type (the element type of the `programs` state, line 22) and add `version: number`. Ensure the loader that fills `programs` (from the API list or the offline blob) carries `version`. `mergeProgramsWithPending`'s `base` param type only needs the fields it reads, so no change there — the page reads `version` directly in Task 8.

- [ ] **Step 7: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS. Fix any spot the compiler flags where a `CachedSequence`/`OfflineProgram`/`OfflineSequence` literal now misses `version`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/referenceData.ts src/db/queries/programs.ts src/lib/offlineProgramView.ts "src/app/admin/local/programs/edit/page.tsx" src/app/admin/programs/page.tsx
git commit -m "feat: carry sequence/program version through the offline caches"
```

---

### Task 8: Stamp `baseVersion` into the guarded enqueue payloads

**Files:**
- Modify: `src/app/admin/local/programs/edit/page.tsx` (`handleRenameSequence:243`, `handleMoveSong:252`)
- Modify: `src/app/admin/programs/page.tsx` (`handleRename:153`)
- Modify: `src/lib/programsMerge.ts` (`RenameProgramPayload:8` — add `baseVersion?`)

**Interfaces:**
- Consumes: `version` on cached sequences/programs (Task 7); the guarded handlers' `baseVersion` (Task 6).
- Produces: `sequence-rename`, `sequence-reorder`, `program-rename` payloads now include `baseVersion`.

- [ ] **Step 1: Add `baseVersion` to `RenameProgramPayload`**

In `src/lib/programsMerge.ts`:

```ts
export interface RenameProgramPayload {
  programId: number;
  title: string;
  baseVersion?: number;
}
```

- [ ] **Step 2: Stamp `baseVersion` on sequence rename**

In the edit page `handleRenameSequence`, read the base version from `baseSequenceDetailRef.current` (the pre-overlay `CachedProgramDetail`, line ~71):

```ts
  async function handleRenameSequence(e: React.FormEvent, seqId: number) {
    e.preventDefault();
    if (programId === null) return;
    const baseVersion = baseSequenceDetailRef.current?.sequences.find((s) => s.id === seqId)?.version;
    await enqueue('sequence-rename', { programId, sequenceId: seqId, title: editingSeqTitle, baseVersion });
    setEditingSeqId(null);
    await notifyQueueChanged();
    await loadSequences(programId);
  }
```

- [ ] **Step 3: Stamp `baseVersion` on reorder**

In `handleMoveSong`:

```ts
    const baseVersion = baseSequenceDetailRef.current?.sequences.find((s) => s.id === expandedSeqId)?.version;
    await enqueue('sequence-reorder', {
      programId,
      sequenceId: expandedSeqId,
      orderedIds: reordered.map((entry) => entry.sequenceSongId),
      baseVersion,
    });
```

A draft (pending-create) sequence has no server version yet; `baseVersion` is then `undefined`, so no `If-Match` is sent — correct, since there's nothing on the server to conflict with.

- [ ] **Step 4: Stamp `baseVersion` on program rename**

In `src/app/admin/programs/page.tsx` `handleRename`, in the native branch (line ~167):

```ts
      const baseVersion = programs.find((p) => p.id === id)?.version;
      await enqueue('program-rename', { programId: id, title: editingTitle, baseVersion });
```

- [ ] **Step 5: Verify build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/admin/local/programs/edit/page.tsx" src/app/admin/programs/page.tsx src/lib/programsMerge.ts
git commit -m "feat: stamp baseVersion into guarded offline enqueue payloads"
```

---

### Task 9: `sequencesMerge` — revert a needsAttention rename/reorder

**Files:**
- Modify: `src/lib/sequencesMerge.ts` (`mergeSequencesWithPending:52`)
- Test: `src/lib/sequencesMerge.test.ts`

**Interfaces:**
- Produces: `mergeSequencesWithPending` skips applying a `sequence-rename` or `sequence-reorder` action when `action.needsAttention` is true (the conflict reverted to last-known real state), matching `programsMerge`'s existing behavior. Other action types are unaffected.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/sequencesMerge.test.ts`:

```ts
it('reverts a needsAttention rename to the base title', () => {
  const detail = { programId: 1, title: 'P', role: 'creator', cachedAt: '', version: 1,
    sequences: [{ id: 5, title: 'Βάση', position: 0, version: 2, songs: [] }] } as const;
  const out = mergeSequencesWithPending(detail, [
    action({ id: 'a', type: 'sequence-rename', payload: { sequenceId: 5, title: 'Νέο' }, needsAttention: true }),
  ], new Map());
  expect(out[0].title).toBe('Βάση'); // reverted, not 'Νέο'
});

it('reverts a needsAttention reorder to the base order', () => {
  const detail = { programId: 1, title: 'P', role: 'creator', cachedAt: '', version: 1,
    sequences: [{ id: 5, title: 'S', position: 0, version: 2,
      songs: [{ sequenceSongId: 100, title: 'A' }, { sequenceSongId: 101, title: 'B' }] }] } as const;
  const out = mergeSequencesWithPending(detail, [
    action({ id: 'a', type: 'sequence-reorder', payload: { sequenceId: 5, orderedIds: [101, 100] }, needsAttention: true }),
  ], new Map());
  expect(out[0].songs.map((s) => s.sequenceSongId)).toEqual([100, 101]); // base order kept
});
```

(Use the file's existing `action` helper; ensure it lets you set `needsAttention`. If it doesn't, extend it — it wraps a `QueuedAction`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/sequencesMerge.test.ts`
Expected: FAIL — the rename/reorder is currently applied regardless of `needsAttention`.

- [ ] **Step 3: Implement**

In `mergeSequencesWithPending`, guard only the two whole-value cases. At the top of the `for (const a of actions)` loop body, after computing `p`:

```ts
    const reverted = a.needsAttention && (a.type === 'sequence-rename' || a.type === 'sequence-reorder');
    if (reverted) continue; // conflict/failed whole-value replacement: keep last-known real state
```

Leave every other case (`sequence-create`, `sequence-delete`, add/remove-song) unchanged — those aren't guarded and their `needsAttention` handling is out of scope here.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/sequencesMerge.test.ts`
Expected: PASS (existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sequencesMerge.ts src/lib/sequencesMerge.test.ts
git commit -m "feat: sequencesMerge reverts a needsAttention rename/reorder to last-known state"
```

---

### Task 10: Warn UX — distinguish conflict copy

**Files:**
- Modify: `src/components/SyncQueueProvider.tsx` (context + badge, lines 13-72)
- Modify: `src/lib/programsMerge.ts` (`DisplayProgram` status + `mergeProgramsWithPending`)
- Modify: `src/app/admin/programs/page.tsx` (render the conflict status)
- Modify: `src/app/admin/local/programs/edit/page.tsx` (per-sequence conflict note)
- Test: `src/lib/programsMerge.test.ts`

**Interfaces:**
- Consumes: `needsAttentionReason` (Task 4); `getQueuedActions` (existing).
- Produces: badge shows «X άλλαξαν από συνεργάτη» when any needsAttention action has reason `'conflict'`; `DisplayProgram.status` gains `'conflict-rename'`; the two edit surfaces render conflict copy.

- [ ] **Step 1: programsMerge — a conflict-rename status (write failing test first)**

Add to `src/lib/programsMerge.test.ts`:

```ts
it('marks a conflict rename distinctly from a plain failed rename', () => {
  const base = [{ id: 1, title: 'Βάση', role: 'creator' as const, sharedWithEmails: [] }];
  const out = mergeProgramsWithPending(base, [
    makeAction({ type: 'program-rename', payload: { programId: 1, title: 'Νέο' }, needsAttention: true, needsAttentionReason: 'conflict' }),
  ]);
  expect(out[0].status).toBe('conflict-rename');
  expect(out[0].title).toBe('Βάση');
});
```

Run: `npx vitest run src/lib/programsMerge.test.ts` → FAIL.

- [ ] **Step 2: programsMerge — implement**

Extend the `DisplayProgram['status']` union with `'conflict-rename'`. In the rename branch (line ~65) capture the reason, and when reverting choose the status by reason:

```ts
      renames.set(programId, { title, needsAttention: action.needsAttention, reason: action.needsAttentionReason });
```

```ts
    const rename = renames.get(program.id);
    if (rename) {
      result.push({
        ...program,
        title: rename.needsAttention ? program.title : rename.title,
        status: rename.needsAttention
          ? (rename.reason === 'conflict' ? 'conflict-rename' : 'needs-attention-rename')
          : 'renamed',
      });
      continue;
    }
```

(Update the local `renames` map's value type to include `reason?: 'conflict' | 'failed'`.)

Run: `npx vitest run src/lib/programsMerge.test.ts` → PASS.

- [ ] **Step 3: admin/programs page — render conflict copy**

Next to the existing `needs-attention-rename` render (line ~251), add:

```tsx
{p.status === 'conflict-rename' && (
  <span className="text-xs text-error">Άλλαξε από συνεργάτη — η μετονομασία δεν εφαρμόστηκε.</span>
)}
```

- [ ] **Step 4: Badge — surface a conflict count**

In `src/components/SyncQueueProvider.tsx`, compute a `conflictCount` in `refresh()` from the queue snapshot (import `getQueuedActions` from `@/lib/syncQueue`), store it in state alongside `needsAttentionCount`, and add it to the context value:

```ts
const actions = await getQueuedActions();
setConflictCount(actions.filter((a) => a.needsAttention && a.needsAttentionReason === 'conflict').length);
```

In the badge copy, prefer the conflict message when present:

```tsx
{needsAttentionCount > 0
  ? (conflictCount > 0
      ? `${conflictCount} άλλαξαν από συνεργάτη`
      : `${needsAttentionCount} χρειάζεται προσοχή`)
  : blocked
    ? 'Ο συγχρονισμός σταμάτησε προσωρινά'
    : `${pendingCount} εκκρεμεί συγχρονισμός`}
```

- [ ] **Step 5: Edit page — per-sequence conflict note**

In `src/app/admin/local/programs/edit/page.tsx`, the merged `displaySequences` now silently revert on conflict (Task 9). To tell the user *which* sequence conflicted, read the queue: for each rendered sequence, if a `sequence-rename`/`sequence-reorder` action with `needsAttention && needsAttentionReason === 'conflict'` targets its `id` (from `pendingActions`, already loaded for the merge), show:

```tsx
<span className="text-xs text-error">Άλλαξε από συνεργάτη — η αλλαγή δεν εφαρμόστηκε.</span>
```

Add a small pure helper in `sequencesMerge.ts` if it keeps the JSX clean, e.g. `conflictedSequenceIds(actions): Set<number>`, and unit-test it; otherwise inline the filter. (Helper + test is the tidier choice given the testing convention.)

- [ ] **Step 6: Verify build + tests**

Run: `npm run lint && npm run build && npm test`
Expected: PASS (full vitest suite green).

- [ ] **Step 7: Record manual checks + commit**

Append to the checklist:

```markdown
- [ ] The sync badge reads «N άλλαξαν από συνεργάτη» (not the generic «χρειάζεται προσοχή») when a conflict is outstanding.
- [ ] The conflicted program row / sequence shows the «Άλλαξε από συνεργάτη» note, and its value matches the collaborator's, not the discarded edit.
```

```bash
git add src/components/SyncQueueProvider.tsx src/lib/programsMerge.ts src/lib/programsMerge.test.ts src/lib/sequencesMerge.ts src/lib/sequencesMerge.test.ts "src/app/admin/programs/page.tsx" "src/app/admin/local/programs/edit/page.tsx" docs/manual-testing-checklist.md
git commit -m "feat: distinguish collaborator-conflict copy in the badge and edit surfaces"
```

---

## Self-Review

**Spec coverage:**
- Data model (per-sequence + per-program version) → Task 1. ✓
- Version bumping incl. add/remove commuting writers → Task 2. ✓
- Endpoints honor-if-present `If-Match`, 409 on stale, 404-as-conflict → Tasks 3 (server) + 6 (client mapping). ✓
- New `'conflict'` SyncOutcome flagging needsAttention on attempt 1 → Task 4. ✓
- Self-conflict fix via draftIds-shaped version map → Tasks 5 (map) + 6 (handlers resolve through it). ✓
- Warn UX reusing merge revert + copy → Tasks 9 (sequence revert) + 10 (copy). ✓
- Native-only, honor-if-present (web/old-APK safe) → Global Constraints + Task 3 absent-header path. ✓
- Testing convention (pure logic only) → unit tests in Tasks 4/5/9/10, manual checklist in 3/6/10. ✓

**Placeholder scan:** No "TBD"/"handle edge cases" — every code step shows the code. Two steps ask the implementer to *read a current expression before editing* (Task 7 Step 4 `offlineProgramView.ts`, Task 10 Step 5 helper) rather than reproducing unrelated surrounding lines; the change to make is spelled out in both.

**Type consistency:** `version: number` is the same name across `ProgramRow`/`ProgramSequenceRow`/`OfflineSequence`/`OfflineProgram`/`CachedSequence`/`CachedProgramDetail`. `baseVersion?` is the consistent payload field (Tasks 6/8). `needsAttentionReason: 'conflict' | 'failed'` is identical in `QueuedAction` (Task 4), the merge reads (Tasks 9/10), and the badge (Task 10). Query names match between Task 2 (definitions) and Tasks 3/6 (consumers): `updateSequenceIfMatch`, `bumpSequenceVersionIfMatch`, `updateProgramIfMatch`, `bumpSequenceVersion`.

**One flagged verification (not a gap):** Task 7 Step 3 notes to confirm `listAccessiblePrograms` projects `programs.version`; if it selects specific columns, add it. This is a read-then-adjust instruction, not a placeholder.

**Deferred-to-plan spec item resolved:** the spec left open whether `program-rename` needs its own `programs.version`. This plan commits to giving `programs` a `version` column (Task 1) for symmetry — simplest correct choice, no cheaper signal was clearly sufficient.
