# Program Sharing (Collaborative Ownership) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Σταθερό Πρόγραμμα (fixed program) have multiple co-owners with equal edit rights, added by email, with only the original creator able to manage membership or delete the program.

**Architecture:** A new `program_collaborators` join table sits alongside the existing `programs`/`program_sequences`/`sequence_songs` tables. `programs.ownerId` keeps its column but is reinterpreted as "creator." A new `getProgramAccess(userId, programId)` query helper replaces every route's current `getProgramById(ownerId, id)` ownership check, returning `'creator' | 'collaborator' | null` — every nested route (sequences, songs-in-sequence) is regated through it. `listPrograms`/`listProgramsWithSequencesAndSongs` grow a sibling `listAccessiblePrograms` that unions owned + collaborated programs. The mobile offline `reference-data` payload is extended to include songs referenced by shared programs even when owned by a different user, so the existing id-lookup in the native views keeps resolving. Content cleanup (on collaborator removal/leave and on the existing GDPR account-deletion flow) strips a departing user's own songs out of any shared program's sequences without touching the program itself.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Neon Postgres (`neon-http`, no pooling), Zod, Vitest, daisyUI 5/Tailwind v4.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-10-program-sharing-design.md` — this plan implements it. One correction made while planning (see note in Task 2): the spec's framing of the nested routes as an unguarded "security gap" was inaccurate — every route already calls `getProgramById(ownerId, ...)` before mutating, so today's behavior is single-owner-only, not unchecked. The engineering task is unchanged either way: broaden that same check to accept collaborators.
- Every schema change goes through `npm run db:generate` then `npm run db:migrate` (drizzle-kit) — never hand-written migration SQL. **Local dev and production share the same Neon database** (no separate test DB) — `db:migrate` alters real data, run it deliberately.
- This schema never uses `onDelete: 'cascade'` on any FK (confirmed: zero occurrences in `src/db/schema.ts` today) — every existing cascade (e.g. `deleteProgram`, `deleteUserCascade`) is done by hand, in dependency order, inside the query function. `program_collaborators`' FKs follow the same plain (no-cascade) style, and its cleanup is added explicitly to both `deleteProgram` and `deleteUserCascade`.
- This codebase's convention: pure logic (`src/lib/*.ts`) gets Vitest unit tests; DB-touching query/route/UI code is verified manually (no `src/db/queries/*.test.ts` or `src/app/api/**/*.test.ts` files exist anywhere in the repo) — follow that split, don't invent a new pattern.
- The song picker used when adding a song to a sequence stays scoped to the requester's own songs (`getSongById(userId, songId)` — unchanged, already correct for this) — nobody browses another collaborator's whole library through it.
- Only the program creator (`programs.ownerId`) can add/remove collaborators or delete the whole program. Every other program mutation (rename, sequences, songs-in-sequence) is open to creator + all collaborators equally.
- All new user-facing copy is in Greek, matching the existing app.
- `x-user-id` is set only by `src/proxy.ts` server-side (verified already, unchanged by this plan) — every route keeps reading it via the existing `getUserId(request)` helper, no parallel mechanism.

---

## Task 1: `program_collaborators` table

**Files:**
- Modify: `src/db/schema.ts`
- Test: manual (schema-only change, verified via the migration run in this task)

**Interfaces:**
- Produces: `programCollaborators` table (`id`, `programId` FK → `programs.id`, `userId` FK → `users.id`, `addedAt`), unique on `(programId, userId)`, and exported type `ProgramCollaboratorRow`.

- [ ] **Step 1: Add the table**

Add to `src/db/schema.ts`, directly after the `sequenceSongs` table definition:

```ts
export const programCollaborators = pgTable(
  'program_collaborators',
  {
    id: serial('id').primaryKey(),
    programId: integer('program_id').notNull().references(() => programs.id),
    userId: integer('user_id').notNull().references(() => users.id),
    addedAt: timestamp('added_at').notNull().defaultNow(),
  },
  (table) => ({
    uniqueProgramUser: unique().on(table.programId, table.userId),
  })
);
```

`unique` is already imported at the top of the file (used by `songAxisValues`) — no import change needed.

- [ ] **Step 2: Add the exported type**

Add alongside the other `export type ...Row` lines at the bottom of `src/db/schema.ts`:

```ts
export type ProgramCollaboratorRow = typeof programCollaborators.$inferSelect;
```

- [ ] **Step 3: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: drizzle-kit prints a new migration file (e.g. `drizzle/0008_*.sql`) creating `program_collaborators` with its two FKs and unique constraint; `db:migrate` applies it with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Add program_collaborators table"
```

---

## Task 2: Program access checks — query layer + every route

This is one atomic task on purpose: `getProgramById`'s signature changes from `(ownerId, id)` to `(id)`, which every caller must update in the same commit or the build won't type-check. Verify with `npx tsc --noEmit` at the end, not a unit test (this is DB/route wiring, not pure logic).

**Files:**
- Modify: `src/db/queries/programs.ts`
- Modify: `src/app/api/programs/route.ts`
- Modify: `src/app/api/programs/[id]/route.ts`
- Modify: `src/app/api/programs/[id]/sequences/route.ts`
- Modify: `src/app/api/programs/[id]/sequences/[seqId]/route.ts`
- Modify: `src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts`
- Modify: `src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts`

**Interfaces:**
- Produces: `ProgramAccessRole = 'creator' | 'collaborator' | null`; `getProgramAccess(userId: number, programId: number): Promise<ProgramAccessRole>`; `getProgramById(id: number): Promise<ProgramRow | undefined>` (ownerId param removed); `updateProgram(id: number, title: string)`; `deleteProgram(id: number)` (both ownerId params removed — the calling route now checks access first).
- Consumes (Task 1): `programCollaborators` table.

- [ ] **Step 1: Rewrite `src/db/queries/programs.ts`**

```ts
import { db } from '../client';
import { programs, programSequences, sequenceSongs, songs, programCollaborators } from '../schema';
import { eq, and, asc, max, inArray } from 'drizzle-orm';
import type { ProgramRow, ProgramSequenceRow, SongRow } from '../schema';
import type { OfflineProgram } from '@/lib/referenceData';
import { getUserById } from './users';

export type ProgramAccessRole = 'creator' | 'collaborator' | null;

export async function getProgramById(id: number): Promise<ProgramRow | undefined> {
  const rows = await db.select().from(programs).where(eq(programs.id, id));
  return rows[0];
}

export async function getProgramAccess(userId: number, programId: number): Promise<ProgramAccessRole> {
  const program = await getProgramById(programId);
  if (!program) return null;
  if (program.ownerId === userId) return 'creator';
  const rows = await db
    .select()
    .from(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
  return rows[0] ? 'collaborator' : null;
}

export async function listPrograms(ownerId: number): Promise<ProgramRow[]> {
  return db.select().from(programs).where(eq(programs.ownerId, ownerId));
}

export async function createProgram(ownerId: number, title: string): Promise<ProgramRow> {
  const rows = await db.insert(programs).values({ ownerId, title }).returning();
  return rows[0];
}

export async function updateProgram(id: number, title: string): Promise<ProgramRow | undefined> {
  const rows = await db.update(programs).set({ title }).where(eq(programs.id, id)).returning();
  return rows[0];
}

export async function deleteProgram(id: number): Promise<void> {
  const sequences = await db.select({ id: programSequences.id }).from(programSequences).where(eq(programSequences.programId, id));
  const sequenceIds = sequences.map((s) => s.id);
  if (sequenceIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.sequenceId, sequenceIds));
  await db.delete(programSequences).where(eq(programSequences.programId, id));
  await db.delete(programCollaborators).where(eq(programCollaborators.programId, id));
  await db.delete(programs).where(eq(programs.id, id));
}

export async function listSequencesForProgram(programId: number): Promise<ProgramSequenceRow[]> {
  return db.select().from(programSequences).where(eq(programSequences.programId, programId)).orderBy(asc(programSequences.position));
}

export async function getSequenceById(id: number): Promise<ProgramSequenceRow | undefined> {
  const rows = await db.select().from(programSequences).where(eq(programSequences.id, id));
  return rows[0];
}

export async function createSequence(programId: number, title: string): Promise<ProgramSequenceRow> {
  const [{ value }] = await db
    .select({ value: max(programSequences.position) })
    .from(programSequences)
    .where(eq(programSequences.programId, programId));
  const nextPosition = (value ?? -1) + 1;
  const rows = await db.insert(programSequences).values({ programId, title, position: nextPosition }).returning();
  return rows[0];
}

export async function updateSequence(id: number, title: string): Promise<ProgramSequenceRow> {
  const rows = await db.update(programSequences).set({ title }).where(eq(programSequences.id, id)).returning();
  return rows[0];
}

export async function deleteSequence(id: number): Promise<void> {
  await db.delete(sequenceSongs).where(eq(sequenceSongs.sequenceId, id));
  await db.delete(programSequences).where(eq(programSequences.id, id));
}

export interface SequenceSongEntry {
  sequenceSongId: number;
  song: SongRow;
}

export async function listSongsForSequence(sequenceId: number): Promise<SequenceSongEntry[]> {
  const rows = await db
    .select({ sequenceSongId: sequenceSongs.id, song: songs })
    .from(sequenceSongs)
    .innerJoin(songs, eq(sequenceSongs.songId, songs.id))
    .where(eq(sequenceSongs.sequenceId, sequenceId))
    .orderBy(asc(sequenceSongs.position));
  return rows;
}

export async function addSongToSequence(sequenceId: number, songId: number): Promise<void> {
  const [{ value }] = await db
    .select({ value: max(sequenceSongs.position) })
    .from(sequenceSongs)
    .where(eq(sequenceSongs.sequenceId, sequenceId));
  const nextPosition = (value ?? -1) + 1;
  await db.insert(sequenceSongs).values({ sequenceId, songId, position: nextPosition });
}

export async function removeSongFromSequence(sequenceSongId: number): Promise<void> {
  await db.delete(sequenceSongs).where(eq(sequenceSongs.id, sequenceSongId));
}

export async function reorderSequenceSongs(sequenceId: number, orderedSequenceSongIds: number[]): Promise<void> {
  for (const [position, sequenceSongId] of orderedSequenceSongIds.entries()) {
    await db
      .update(sequenceSongs)
      .set({ position })
      .where(and(eq(sequenceSongs.id, sequenceSongId), eq(sequenceSongs.sequenceId, sequenceId)));
  }
}

export async function listProgramsWithSequencesAndSongs(userId: number): Promise<OfflineProgram[]> {
  const programList = await listAccessiblePrograms(userId);
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

export interface AccessibleProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

export async function listCollaborators(programId: number): Promise<{ id: number; email: string }[]> {
  const rows = await db
    .select({ userId: programCollaborators.userId })
    .from(programCollaborators)
    .where(eq(programCollaborators.programId, programId));
  const users = await Promise.all(rows.map((r) => getUserById(r.userId)));
  return users.filter((u): u is NonNullable<typeof u> => u !== undefined).map((u) => ({ id: u.id, email: u.email }));
}

export async function isCollaborator(programId: number, userId: number): Promise<boolean> {
  const rows = await db
    .select()
    .from(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
  return rows.length > 0;
}

export async function addCollaborator(programId: number, userId: number): Promise<void> {
  await db.insert(programCollaborators).values({ programId, userId });
}

export async function removeCollaboratorContent(programId: number, userId: number): Promise<void> {
  const sequences = await db.select({ id: programSequences.id }).from(programSequences).where(eq(programSequences.programId, programId));
  const sequenceIds = sequences.map((s) => s.id);
  if (sequenceIds.length === 0) return;
  const userSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, userId));
  const userSongIds = userSongs.map((s) => s.id);
  if (userSongIds.length === 0) return;
  await db
    .delete(sequenceSongs)
    .where(and(inArray(sequenceSongs.sequenceId, sequenceIds), inArray(sequenceSongs.songId, userSongIds)));
}

export async function removeCollaborator(programId: number, userId: number): Promise<void> {
  await removeCollaboratorContent(programId, userId);
  await db
    .delete(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
}

export async function listAccessiblePrograms(userId: number): Promise<AccessibleProgram[]> {
  const owned = await listPrograms(userId);
  const collabRows = await db
    .select({ program: programs })
    .from(programCollaborators)
    .innerJoin(programs, eq(programCollaborators.programId, programs.id))
    .where(eq(programCollaborators.userId, userId));
  const collaborated = collabRows.map((r) => r.program);

  async function summarize(program: ProgramRow, role: 'creator' | 'collaborator'): Promise<AccessibleProgram> {
    const collaborators = await listCollaborators(program.id);
    const creator = program.ownerId === userId ? null : await getUserById(program.ownerId);
    const emails = [
      ...(creator ? [creator.email] : []),
      ...collaborators.filter((c) => c.id !== userId).map((c) => c.email),
    ];
    return { id: program.id, title: program.title, role, sharedWithEmails: emails };
  }

  return Promise.all([
    ...owned.map((p) => summarize(p, 'creator' as const)),
    ...collaborated.map((p) => summarize(p, 'collaborator' as const)),
  ]);
}
```

Note: `listAccessiblePrograms`, `listCollaborators`, `isCollaborator`, `addCollaborator`, `removeCollaborator`, `removeCollaboratorContent` are placed here (rather than a separate Task 3) because `listProgramsWithSequencesAndSongs`, defined earlier in the same file, already calls `listAccessiblePrograms` — keeping them in one file/one task avoids a forward-reference across commits.

- [ ] **Step 2: Update `src/app/api/programs/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listAccessiblePrograms, createProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const createSchema = z.object({ title: z.string().min(1) });

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  return NextResponse.json(await listAccessiblePrograms(userId));
}

export async function POST(request: NextRequest) {
  const ownerId = getUserId(request);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const program = await createProgram(ownerId, parsed.data.title);
  return NextResponse.json(program, { status: 201 });
}
```

- [ ] **Step 3: Update `src/app/api/programs/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramById, getProgramAccess, updateProgram, deleteProgram, listSequencesForProgram } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const updateSchema = z.object({ title: z.string().min(1) });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const program = await getProgramById(Number(id));
  const sequences = await listSequencesForProgram(Number(id));
  return NextResponse.json({ ...program, role, sequences });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const program = await updateProgram(Number(id), parsed.data.title);
  return NextResponse.json(program);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  if (role !== 'creator') {
    return NextResponse.json({ error: 'Μόνο ο δημιουργός μπορεί να διαγράψει το πρόγραμμα' }, { status: 403 });
  }
  await deleteProgram(Number(id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Update `src/app/api/programs/[id]/sequences/route.ts`**

```ts
// src/app/api/programs/[id]/sequences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramAccess, createSequence } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const createSchema = z.object({ title: z.string().min(1) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const sequence = await createSequence(Number(id), parsed.data.title);
  return NextResponse.json(sequence, { status: 201 });
}
```

- [ ] **Step 5: Update `src/app/api/programs/[id]/sequences/[seqId]/route.ts`**

```ts
// src/app/api/programs/[id]/sequences/[seqId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getProgramAccess,
  getSequenceById,
  updateSequence,
  deleteSequence,
  listSongsForSequence,
  type ProgramAccessRole,
} from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

const updateSchema = z.object({ title: z.string().min(1) });

async function assertSequenceAccess(userId: number, programId: number, seqId: number): Promise<ProgramAccessRole> {
  const role = await getProgramAccess(userId, programId);
  if (!role) return null;
  const sequence = await getSequenceById(seqId);
  if (!sequence || sequence.programId !== programId) return null;
  return role;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  const role = await assertSequenceAccess(userId, Number(id), Number(seqId));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const sequence = await getSequenceById(Number(seqId));
  const songs = await listSongsForSequence(Number(seqId));
  return NextResponse.json({ ...sequence, songs });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  const role = await assertSequenceAccess(userId, Number(id), Number(seqId));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const updated = await updateSequence(Number(seqId), parsed.data.title);
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  const role = await assertSequenceAccess(userId, Number(id), Number(seqId));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await deleteSequence(Number(seqId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Update `src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts`**

```ts
// src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramAccess, getSequenceById, addSongToSequence, reorderSequenceSongs } from '@/db/queries/programs';
import { getSongById } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const addSchema = z.object({ songId: z.number().int() });
const reorderSchema = z.object({ orderedIds: z.array(z.number().int()) });

async function assertSequenceAccess(userId: number, programId: number, seqId: number): Promise<boolean> {
  const role = await getProgramAccess(userId, programId);
  if (!role) return false;
  const sequence = await getSequenceById(seqId);
  return sequence !== undefined && sequence.programId === programId;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  if (!(await assertSequenceAccess(userId, Number(id), Number(seqId)))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // addSongToSequence doesn't validate songId ownership, so without this check a caller could
  // graft another user's song into a sequence and read it back via GET on the sequence. Scoped
  // to the requester's own songs, not the program creator's — each collaborator adds from their
  // own library only (per design: reading songs already in the program is shared, picking new
  // ones to add is not).
  const song = await getSongById(userId, parsed.data.songId);
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  await addSongToSequence(Number(seqId), parsed.data.songId);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; seqId: string }> }) {
  const userId = getUserId(request);
  const { id, seqId } = await params;
  if (!(await assertSequenceAccess(userId, Number(id), Number(seqId)))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  const parsed = reorderSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await reorderSequenceSongs(Number(seqId), parsed.data.orderedIds);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Update `src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts`**

```ts
// src/app/api/programs/[id]/sequences/[seqId]/songs/[entryId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getProgramAccess, getSequenceById, listSongsForSequence, removeSongFromSequence } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seqId: string; entryId: string }> }
) {
  const userId = getUserId(request);
  const { id, seqId, entryId } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  const sequence = await getSequenceById(Number(seqId));
  if (!sequence || sequence.programId !== Number(id)) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  // removeSongFromSequence deletes by sequenceSongId alone (no sequenceId in its WHERE),
  // so the entry's membership in this sequence must be confirmed here, not just the sequence's
  // membership in the program above — otherwise a caller with access to *some* sequence could
  // delete another sequence's entry by id.
  const entries = await listSongsForSequence(sequence.id);
  if (!entries.some((entry) => entry.sequenceSongId === Number(entryId))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }
  await removeSongFromSequence(Number(entryId));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. This is the automated check for this task — every changed call site must agree with the new signatures.

- [ ] **Step 9: Commit**

```bash
git add src/db/queries/programs.ts src/app/api/programs
git commit -m "Broaden program access checks from ownerId-only to creator-or-collaborator"
```

---

## Task 3: Collaborator management routes

**Files:**
- Create: `src/app/api/programs/[id]/collaborators/route.ts`
- Create: `src/app/api/programs/[id]/collaborators/[userId]/route.ts`

**Interfaces:**
- Consumes: `getProgramAccess`, `listCollaborators`, `addCollaborator`, `isCollaborator`, `removeCollaborator` (Task 2), `getUserByEmail` (existing, `src/db/queries/users.ts`).
- Produces: `GET/POST /api/programs/[id]/collaborators`, `DELETE /api/programs/[id]/collaborators/[userId]`.

- [ ] **Step 1: Write `src/app/api/programs/[id]/collaborators/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProgramAccess, listCollaborators, addCollaborator, isCollaborator } from '@/db/queries/programs';
import { getUserByEmail } from '@/db/queries/users';
import { getUserId } from '@/lib/requestUser';

const addSchema = z.object({ email: z.email() });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(await listCollaborators(Number(id)));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const role = await getProgramAccess(userId, Number(id));
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  if (role !== 'creator') {
    return NextResponse.json({ error: 'Μόνο ο δημιουργός μπορεί να προσθέσει συνεργάτες' }, { status: 403 });
  }

  const parsed = addSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const target = await getUserByEmail(parsed.data.email);
  if (!target) return NextResponse.json({ error: 'Δεν βρέθηκε χρήστης με αυτό το email' }, { status: 404 });
  if (target.id === userId) {
    return NextResponse.json({ error: 'Είσαι ήδη ο δημιουργός αυτού του προγράμματος' }, { status: 400 });
  }
  if (await isCollaborator(Number(id), target.id)) {
    return NextResponse.json({ error: 'Είναι ήδη συνεργάτης' }, { status: 409 });
  }

  await addCollaborator(Number(id), target.id);
  return NextResponse.json(await listCollaborators(Number(id)), { status: 201 });
}
```

- [ ] **Step 2: Write `src/app/api/programs/[id]/collaborators/[userId]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getProgramAccess, isCollaborator, removeCollaborator } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const requesterId = getUserId(request);
  const { id, userId: targetUserIdStr } = await params;
  const programId = Number(id);
  const targetUserId = Number(targetUserIdStr);

  const role = await getProgramAccess(requesterId, programId);
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  if (role !== 'creator' && requesterId !== targetUserId) {
    return NextResponse.json({ error: 'Μπορείς να αφαιρέσεις μόνο τον εαυτό σου' }, { status: 403 });
  }
  if (!(await isCollaborator(programId, targetUserId))) {
    return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  }

  await removeCollaborator(programId, targetUserId);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/programs/[id]/collaborators
git commit -m "Add collaborator add/list/remove API routes"
```

---

## Task 4: Program list — shared programs, badges, creator-only delete

**Files:**
- Modify: `src/app/programs/page.tsx`
- Modify: `src/app/admin/programs/page.tsx`

**Interfaces:**
- Consumes: `GET /api/programs` now returns `AccessibleProgram[]` (Task 2): `{ id, title, role, sharedWithEmails }`.

- [ ] **Step 1: Update `src/app/programs/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Program {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

function sharedBadgeText(emails: string[]): string {
  if (emails.length === 0) return '';
  if (emails.length === 1) return `μοιράζεται με ${emails[0]}`;
  return `μοιράζεται με ${emails[0]} +${emails.length - 1}`;
}

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    fetch('/api/programs').then((r) => r.json()).then(setPrograms);
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
      <div className="card w-full max-w-md bg-base-100 shadow">
        <div className="card-body gap-2">
          <ul className="flex flex-col gap-1">
            {programs.map((p) => (
              <li key={p.id} className="flex flex-col gap-1">
                <Link href={`/programs/${p.id}`} className="btn btn-outline btn-lg w-full">
                  {p.title}
                </Link>
                {p.sharedWithEmails.length > 0 && (
                  <span className="badge badge-ghost badge-sm self-center">{sharedBadgeText(p.sharedWithEmails)}</span>
                )}
              </li>
            ))}
            {programs.length === 0 && <li className="p-3 text-center text-sm text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
          </ul>
        </div>
      </div>
      <Link href="/" className="link">Αρχική</Link>
    </main>
  );
}
```

- [ ] **Step 2: Update `src/app/admin/programs/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Program {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

function sharedBadgeText(emails: string[]): string {
  if (emails.length === 0) return '';
  if (emails.length === 1) return `μοιράζεται με ${emails[0]}`;
  return `μοιράζεται με ${emails[0]} +${emails.length - 1}`;
}

export default function ProgramsAdminPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  async function load() {
    const res = await fetch('/api/programs');
    setPrograms(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/programs', {
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
  }

  async function handleDelete(id: number) {
    await fetch(`/api/programs/${id}`, { method: 'DELETE' });
    await load();
  }

  function startEditing(p: Program) {
    setEditingId(p.id);
    setEditingTitle(p.title);
  }

  async function handleRename(e: React.FormEvent, id: number) {
    e.preventDefault();
    await fetch(`/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editingTitle }),
    });
    setEditingId(null);
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Προγράμματα</h1>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
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
        {programs.map((p) => (
          <li key={p.id} className="list-row items-center gap-2">
            {editingId === p.id ? (
              <form onSubmit={(e) => handleRename(e, p.id)} className="flex flex-1 gap-2">
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
                  <Link href={`/admin/programs/${p.id}`} className="link link-hover">{p.title}</Link>
                  {p.sharedWithEmails.length > 0 && (
                    <span className="badge badge-ghost badge-xs w-fit">{sharedBadgeText(p.sharedWithEmails)}</span>
                  )}
                </div>
                <button onClick={() => startEditing(p)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                {p.role === 'creator' && (
                  <button onClick={() => handleDelete(p.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
                )}
              </>
            )}
          </li>
        ))}
        {programs.length === 0 && <li className="list-row text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
      </ul>
    </div>
  );
}
```

(Rename stays available to every role, per the full co-editing decision — only the "Διαγραφή" button is gated on `role === 'creator'`.)

- [ ] **Step 3: Commit**

```bash
git add src/app/programs/page.tsx src/app/admin/programs/page.tsx
git commit -m "Show shared-program badges and gate program deletion to the creator"
```

---

## Task 5: Content cleanup on collaborator removal and account deletion

Collaborator removal/self-leave already calls `removeCollaboratorContent` inside `removeCollaborator` (Task 2). This task closes the other path: the existing GDPR `deleteUserCascade` only ever touched the deleted user's *own* rows — it must now also strip that user's songs out of *other* users' shared programs, and must delete `program_collaborators` rows on both sides (their own memberships elsewhere, and anyone else's membership on programs they owned) before the FK-constrained tables underneath are dropped.

**Files:**
- Modify: `src/db/queries/accountDeletion.ts`

**Interfaces:**
- Consumes: `programCollaborators` table (Task 1).

- [ ] **Step 1: Rewrite `deleteUserCascade`**

```ts
import { db } from '../client';
import {
  users,
  songs,
  programs,
  sessions,
  sessionPlayedSongs,
  programSequences,
  sequenceSongs,
  programCollaborators,
  songAxisValues,
  regions,
  rhythms,
  dromoi,
  genres,
  composers,
  passwordResetTokens,
} from '../schema';
import { eq, inArray } from 'drizzle-orm';

export async function deleteUserCascade(userId: number): Promise<void> {
  const ownedSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, userId));
  const songIds = ownedSongs.map((s) => s.id);

  const ownedPrograms = await db.select({ id: programs.id }).from(programs).where(eq(programs.ownerId, userId));
  const programIds = ownedPrograms.map((p) => p.id);
  const sequences = programIds.length
    ? await db.select({ id: programSequences.id }).from(programSequences).where(inArray(programSequences.programId, programIds))
    : [];
  const sequenceIds = sequences.map((s) => s.id);

  const ownedSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.ownerId, userId));
  const sessionIds = ownedSessions.map((s) => s.id);

  // Clear every sequence entry in programs this user owns (their own content AND any
  // collaborator's songs added to those sequences) — required before the programSequences
  // delete below, since sequence_songs has no ON DELETE CASCADE.
  if (sequenceIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.sequenceId, sequenceIds));
  // Also clear this user's own songs out of sequences in *other* users' shared programs
  // where this user was a collaborator — required before the songs delete below, and this
  // is the cross-user cleanup a plain per-owner cascade would otherwise miss.
  if (songIds.length) await db.delete(sequenceSongs).where(inArray(sequenceSongs.songId, songIds));

  if (programIds.length) await db.delete(programSequences).where(inArray(programSequences.programId, programIds));
  if (sessionIds.length) await db.delete(sessionPlayedSongs).where(inArray(sessionPlayedSongs.sessionId, sessionIds));
  if (songIds.length) await db.delete(songAxisValues).where(inArray(songAxisValues.songId, songIds));

  // program_collaborators has no ON DELETE CASCADE either: clear this user's own
  // memberships on other people's programs, and clear anyone else's membership on the
  // programs this user owns — both must go before the `programs` delete below.
  await db.delete(programCollaborators).where(eq(programCollaborators.userId, userId));
  if (programIds.length) await db.delete(programCollaborators).where(inArray(programCollaborators.programId, programIds));

  await db.delete(programs).where(eq(programs.ownerId, userId));
  await db.delete(sessions).where(eq(sessions.ownerId, userId));
  await db.delete(songs).where(eq(songs.ownerId, userId));

  await db.delete(regions).where(eq(regions.ownerId, userId));
  await db.delete(rhythms).where(eq(rhythms.ownerId, userId));
  await db.delete(dromoi).where(eq(dromoi.ownerId, userId));
  await db.delete(genres).where(eq(genres.ownerId, userId));
  await db.delete(composers).where(eq(composers.ownerId, userId));

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}
```

- [ ] **Step 2: Manual verification with a throwaway account (not the real accounts)**

This is the highest-risk change in the whole plan — a missed FK ordering here means account deletion 500s. Verify with a disposable account, not `farantosgeo@gmail.com`/`farantosee@gmail.com`.

```bash
npm run dev
```

In another terminal (replace `<ADMIN_TOKEN>` with a bearer token from logging in as `farantosgeo@gmail.com` via `POST /api/login`, or just log in as the admin in a browser and copy the `glentify_auth` cookie value):

```bash
# 1. Register a throwaway collaborator account
curl -s -X POST http://localhost:3000/api/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"throwaway-cleanup-test@example.com","password":"testpassword123"}' | tee /tmp/throwaway.json

# 2. As the admin, create a test program and share it with the throwaway account
curl -s -X POST http://localhost:3000/api/programs \
  -H 'Content-Type: application/json' -H "Cookie: glentify_auth=<ADMIN_TOKEN>" \
  -d '{"title":"Cleanup test"}' | tee /tmp/program.json
# note the returned id as PROGRAM_ID, then:
curl -s -X POST http://localhost:3000/api/programs/<PROGRAM_ID>/collaborators \
  -H 'Content-Type: application/json' -H "Cookie: glentify_auth=<ADMIN_TOKEN>" \
  -d '{"email":"throwaway-cleanup-test@example.com"}'
```

Log in as the throwaway account, add one of its own songs into a sequence of that shared program (create a song first via `/api/songs`, then a sequence via `/api/programs/<PROGRAM_ID>/sequences`, then add the song). Then, still as the throwaway account:

```bash
curl -s -i -X DELETE http://localhost:3000/api/account -H "Cookie: glentify_auth=<THROWAWAY_TOKEN>"
```

Expected: `200 {"ok":true}`, not a 500. Then, as the admin, `GET /api/programs/<PROGRAM_ID>/sequences/<SEQ_ID>` — expected: the sequence still exists, the throwaway account's song entry is gone, nothing else about the program changed. Delete the test program afterward (`DELETE /api/programs/<PROGRAM_ID>`) to leave no test data behind.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries/accountDeletion.ts
git commit -m "Extend GDPR account deletion to clean up shared-program content"
```

---

## Task 6: Collaborator management UI

**Files:**
- Modify: `src/app/api/account/route.ts` (add a `GET` so the client can learn its own id/email)
- Modify: `src/app/admin/programs/[id]/page.tsx`

**Interfaces:**
- Produces: `GET /api/account` → `{ id: number; email: string; role: 'admin' | 'user' }`.
- Consumes: `GET/POST /api/programs/[id]/collaborators`, `DELETE /api/programs/[id]/collaborators/[userId]` (Task 3); `role` field on `GET /api/programs/[id]` (Task 2).

- [ ] **Step 1: Add `GET` to `src/app/api/account/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserById, countAdmins } from '@/db/queries/users';
import { deleteUserCascade } from '@/db/queries/accountDeletion';
import { getUserId } from '@/lib/requestUser';
import { getAuthCookieName } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ id: user.id, email: user.email, role: user.role });
}

export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (user.role === 'admin') {
    const admins = await countAdmins();
    if (admins <= 1) {
      return NextResponse.json({ error: 'Δεν μπορείς να διαγράψεις τον μοναδικό admin λογαριασμό' }, { status: 409 });
    }
  }

  await deleteUserCascade(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(getAuthCookieName());
  return response;
}
```

- [ ] **Step 2: Add collaborator state, data-loading, and handlers to `src/app/admin/programs/[id]/page.tsx`**

Add these interfaces near the top, alongside the existing `Sequence`/`Song`/`SequenceSongEntry` ones:

```tsx
interface CurrentUser {
  id: number;
  email: string;
}

interface Collaborator {
  id: number;
  email: string;
}
```

Add this state, alongside the existing `useState` calls:

```tsx
const [role, setRole] = useState<'creator' | 'collaborator' | null>(null);
const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('');
const [collaboratorError, setCollaboratorError] = useState<string | null>(null);
```

Change `loadProgram` to also capture `role`, and add `loadCollaborators`:

```tsx
async function loadProgram() {
  const res = await fetch(`/api/programs/${params.id}`);
  const data = await res.json();
  setTitle(data.title);
  setSequences(data.sequences);
  setRole(data.role);
}

async function loadCollaborators() {
  const res = await fetch(`/api/programs/${params.id}/collaborators`);
  setCollaborators(await res.json());
}
```

Update the existing effect that calls `loadProgram()` to also call `loadCollaborators()`, and add a one-time effect for the current user:

```tsx
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  loadProgram();
  // eslint-disable-next-line react-hooks/set-state-in-effect
  loadCollaborators();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [params.id]);

useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  fetch('/api/account').then((r) => r.json()).then(setCurrentUser);
}, []);
```

Add these handlers, alongside the existing `handleAddSequence`/`handleDeleteSequence` etc.:

```tsx
async function handleAddCollaborator(e: React.FormEvent) {
  e.preventDefault();
  setCollaboratorError(null);
  const res = await fetch(`/api/programs/${params.id}/collaborators`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newCollaboratorEmail }),
  });
  if (!res.ok) {
    const body = await res.json();
    setCollaboratorError(typeof body.error === 'string' ? body.error : 'Αποτυχία προσθήκης συνεργάτη');
    return;
  }
  setNewCollaboratorEmail('');
  await loadCollaborators();
}

async function handleRemoveCollaborator(userId: number) {
  await fetch(`/api/programs/${params.id}/collaborators/${userId}`, { method: 'DELETE' });
  await loadCollaborators();
}
```

- [ ] **Step 3: Add the "Συνεργάτες" section to the JSX**

Insert this block right after the `<h1 className="text-xl font-bold">{title}</h1>` line, before the "Προσθήκη σειράς" form:

```tsx
{role && (
  <div className="card border border-base-300 bg-base-100">
    <div className="card-body gap-3 p-4">
      <h2 className="font-semibold">Συνεργάτες</h2>
      {collaboratorError && (
        <div role="alert" className="alert alert-error alert-sm">
          <span>{collaboratorError}</span>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {collaborators.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span className="flex-1">{c.email}</span>
            {role === 'creator' && (
              <button onClick={() => handleRemoveCollaborator(c.id)} className="btn btn-ghost btn-xs text-error">
                Αφαίρεση
              </button>
            )}
          </li>
        ))}
        {collaborators.length === 0 && <li className="text-sm text-base-content/50">Κανένας συνεργάτης ακόμη</li>}
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
    </div>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/account/route.ts src/app/admin/programs/[id]/page.tsx
git commit -m "Add collaborator management UI to the program detail page"
```

---

## Task 7: Reference-data / mobile — include shared programs' songs

**Files:**
- Modify: `src/lib/referenceData.ts`
- Modify: `src/lib/referenceData.test.ts`
- Modify: `src/db/queries/songs.ts`
- Modify: `src/app/api/reference-data/route.ts`

**Interfaces:**
- Produces (pure, tested): `collectReferencedSongIds(programs: OfflineProgram[]): number[]`, `mergeReferencedSongs(ownSongs: SongRow[], extraSongs: SongRow[]): SongRow[]`.
- Produces (DB): `getSongsByIds(ids: number[]): Promise<SongRow[]>` in `src/db/queries/songs.ts` — deliberately unscoped by `ownerId`, since these ids come from sequences the requester already has program-level access to (Task 2's access check), not from a general song browse.

- [ ] **Step 1: Write the failing tests for the pure merge/collect helpers**

Add to `src/lib/referenceData.test.ts` (keep the existing `normalizeReferenceData` tests, add these):

```ts
import { collectReferencedSongIds, mergeReferencedSongs } from './referenceData';
import type { SongRow } from '@/db/schema';

function song(id: number, title: string): SongRow {
  return {
    id,
    title,
    lyrics: null,
    imageUrl: null,
    genreId: 1,
    notes: null,
    maleKey: null,
    femaleKey: null,
    ownerId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('collectReferencedSongIds', () => {
  it('returns an empty array for no programs', () => {
    expect(collectReferencedSongIds([])).toEqual([]);
  });

  it('collects song ids across sequences and programs, de-duplicated', () => {
    const programs = [
      { id: 1, title: 'A', sequences: [{ id: 10, title: 'S1', songIds: [1, 2] }] },
      { id: 2, title: 'B', sequences: [{ id: 20, title: 'S2', songIds: [2, 3] }] },
    ];
    expect(collectReferencedSongIds(programs).sort()).toEqual([1, 2, 3]);
  });
});

describe('mergeReferencedSongs', () => {
  it('appends extra songs not already in ownSongs', () => {
    const own = [song(1, 'Own')];
    const extra = [song(2, 'Extra')];
    expect(mergeReferencedSongs(own, extra)).toEqual([song(1, 'Own'), song(2, 'Extra')]);
  });

  it('does not duplicate a song already owned', () => {
    const own = [song(1, 'Own')];
    const extra = [song(1, 'Own (stale copy)')];
    expect(mergeReferencedSongs(own, extra)).toEqual([song(1, 'Own')]);
  });

  it('returns ownSongs unchanged when there are no extras', () => {
    const own = [song(1, 'Own')];
    expect(mergeReferencedSongs(own, [])).toEqual(own);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- referenceData
```

Expected: FAIL — `collectReferencedSongIds`/`mergeReferencedSongs` not exported yet.

- [ ] **Step 3: Add the implementation to `src/lib/referenceData.ts`**

Add these two functions after `normalizeReferenceData`:

```ts
export function collectReferencedSongIds(programs: OfflineProgram[]): number[] {
  const ids = new Set<number>();
  for (const program of programs) {
    for (const sequence of program.sequences) {
      for (const id of sequence.songIds) ids.add(id);
    }
  }
  return [...ids];
}

export function mergeReferencedSongs(ownSongs: SongRow[], extraSongs: SongRow[]): SongRow[] {
  const ownIds = new Set(ownSongs.map((s) => s.id));
  return [...ownSongs, ...extraSongs.filter((s) => !ownIds.has(s.id))];
}
```

Add `SongRow` to the existing type-only import at the top of the file:

```ts
import type { SongRow, SongAxisValueRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';
```

(`SongRow` replaces nothing — it's a new addition to that same import line, which already imports the other row types.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- referenceData
```

Expected: PASS (all `normalizeReferenceData` + new `collectReferencedSongIds`/`mergeReferencedSongs` tests).

- [ ] **Step 5: Add `getSongsByIds` to `src/db/queries/songs.ts`**

Add this function anywhere among the other exported functions (e.g. after `getSongById`):

```ts
export async function getSongsByIds(ids: number[]): Promise<SongRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(songs).where(inArray(songs.id, ids));
}
```

(`inArray` is already imported at the top of this file.)

- [ ] **Step 6: Update `src/app/api/reference-data/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { listSongs, getSongsByIds } from '@/db/queries/songs';
import { getAxisValuesForOwner, listAxisTypes } from '@/db/queries/axisValues';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listGenres } from '@/db/queries/genres';
import { listProgramsWithSequencesAndSongs } from '@/db/queries/programs';
import { collectReferencedSongIds, mergeReferencedSongs } from '@/lib/referenceData';
import type { ReferenceData } from '@/lib/referenceData';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const [ownSongs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs] = await Promise.all([
    listSongs(userId),
    getAxisValuesForOwner(userId),
    listAxisTypes(),
    listRegions(userId),
    listRhythms(userId),
    listDromoi(userId),
    listComposers(userId),
    listGenres(userId),
    listProgramsWithSequencesAndSongs(userId),
  ]);

  // Shared programs can reference songs owned by a collaborator, not just the requester —
  // those ids won't be in `ownSongs` (listSongs is strictly owner-scoped), so the client-side
  // songId -> song lookup used by the offline program views would otherwise silently fail for
  // them. Fetch just the missing ones and merge them in.
  const referencedIds = collectReferencedSongIds(programs);
  const ownIds = new Set(ownSongs.map((s) => s.id));
  const missingIds = referencedIds.filter((id) => !ownIds.has(id));
  const extraSongs = missingIds.length ? await getSongsByIds(missingIds) : [];
  const songs = mergeReferencedSongs(ownSongs, extraSongs);

  const payload: ReferenceData = { songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres, programs };
  return NextResponse.json(payload);
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/referenceData.ts src/lib/referenceData.test.ts src/db/queries/songs.ts src/app/api/reference-data/route.ts
git commit -m "Include collaborators' songs from shared programs in reference-data payload"
```

---

## Task 8: Manual end-to-end verification

No code changes — this is the full walkthrough with the two real accounts (`farantosgeo@gmail.com`, `farantosee@gmail.com`), browser-based since it needs two simultaneously-authenticated sessions (use two browser profiles or one normal + one incognito window). Does **not** delete either real account — account-deletion cleanup was already verified with a throwaway account in Task 5.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Creator creates and shares a program**

Log in as `farantosgeo@gmail.com`. Go to `/admin/programs`, create a program ("Sharing test"). Open it, confirm the new "Συνεργάτες" section shows "Κανένας συνεργάτης ακόμη" and an add-by-email form. Add `farantosee@gmail.com`. Expected: appears in the collaborators list immediately, no error.

- [ ] **Step 3: Collaborator sees it automatically**

In the second browser session, log in as `farantosee@gmail.com`. Go to `/programs` and `/admin/programs`. Expected: "Sharing test" appears in both lists with a "μοιράζεται με farantosgeo@gmail.com" badge, and in `/admin/programs` it has "Μετονομασία" but **no** "Διαγραφή" button.

- [ ] **Step 4: Collaborator co-edits**

As `farantosee@gmail.com`, open `/admin/programs/<id>`, add a sequence, and add one of their own songs to it (create a throwaway song first if the account has none). Expected: succeeds. Confirm the "Συνεργάτες" section here shows the creator's email listed as a collaborator-visible peer, and shows an "Αποχώρηση από το πρόγραμμα" button instead of the add-collaborator form.

- [ ] **Step 5: Creator sees the collaborator's edit**

Back in the `farantosgeo@gmail.com` session, reload `/admin/programs/<id>`. Expected: the new sequence and song added in Step 4 are visible and editable (rename it, move it, remove it — confirm each works).

- [ ] **Step 6: Non-member is blocked**

`curl -i http://localhost:3000/api/programs/<id>` with no cookie — expected `401`. If a third, unrelated account is available, log in as it and confirm `GET /api/programs/<id>` returns `404` (not visible, not editable) and `POST /api/programs/<id>/sequences` also `404`s.

- [ ] **Step 7: Removal strips only the removed collaborator's content**

As the creator, remove `farantosee@gmail.com` from the collaborators list. Expected: succeeds, they disappear from the list. Reload the sequence from Step 4 — expected: the song `farantosee@gmail.com` added is gone, the sequence itself still exists (not deleted), any songs the creator had added to the same sequence are untouched. Confirm `farantosee@gmail.com` no longer sees "Sharing test" in their `/programs` list.

- [ ] **Step 8: Mobile sanity check (if a device/emulator is available)**

Re-share the program with `farantosee@gmail.com` (repeat Step 2's add), sync on an Android build logged in as that account (`npm run build:mobile`, per `2026-08-09-mobile-fixed-programs-design.md`'s existing flow), and confirm "Sharing test" appears in "Σταθερά προγράμματα" and plays back correctly offline, including a song owned by the creator (not just the collaborator's own songs). If no device is available right now, note this step as deferred rather than skipped.

- [ ] **Step 9: Clean up test data**

Delete the "Sharing test" program as its creator (`farantosgeo@gmail.com`) so no leftover test program remains in the shared database.

No commit for this task — it's a verification checkpoint, not a code change.
