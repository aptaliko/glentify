# Remove Genre Column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the mandatory `songs.genreId` column and move "genre" into the existing flexible `song_axis_values` system, so it behaves exactly like region/rhythm/dromos/composer/year — optional, self-service, no special-cased code path.

**Architecture:** Add `'genre'` as a sixth `axis_types` row (lookup table `genres`, matching the existing region/rhythm/dromos/composer pattern). Backfill every song's current `genreId` into a `song_axis_values` row, then drop the column. Rewrite the ~10 call sites that read/write `songs.genreId` directly to go through the axis system instead. Replace the genre-first `SongPicker` wizard with a single paginated, filterable song list. Replace the suggestion engine's genre-grouped fallback with a plain list plus an optional, purely client-side "default view" preference.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM + Neon Postgres, Zod, Vitest, daisyUI 5/Tailwind v4, `@capacitor/preferences` (native) / `localStorage` (web).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-12-remove-genre-column-design.md` — this plan implements it.
- **Local dev and production share the same Neon database** — every migration in this plan alters real data. The backfill (Task 1) and the column drop (Task 5) must run in that order, with the backfill's row-count verified before the drop.
- `genres` table is NOT removed — it stays as the lookup table for the `genre` axis, same shape as `regions`/`rhythms`/`dromoi`/`composers`.
- The core suggestion-ranking functions (`getFilteredCandidates`, `rankBySharedAxes`) are NOT touched — they already work without reading `genreId` at all (confirmed by reading the source before writing this plan).
- The "default view" preference (Task 9/10) is a client-side-only concern — no new DB column, no new API endpoint.
- This codebase's convention: pure logic (`src/lib/*.ts`) gets Vitest unit tests; DB-touching query/route/UI code is verified manually — no test DB exists.
- All user-facing copy stays in Greek.
- Every schema change goes through `npm run db:generate` then `npm run db:migrate`, never hand-written SQL.

---

## Task 1: Seed the `genre` axis type and backfill existing songs

**Files:**
- Modify: `scripts/seed-axis-types.ts`
- Create: `scripts/migrate-genre-to-axis.ts`

**Interfaces:**
- Produces: an `axis_types` row with `key='genre'`, and one `song_axis_values` row per existing song (`axisType='genre'`, `refId=<that song's current genreId>`).

- [ ] **Step 1: Add `genre` to the seeded axis types**

In `scripts/seed-axis-types.ts`, add a new entry to the `AXIS_TYPES` array (after the `region` entry, before `rhythm`, to match the design's "genre is just another axis" framing — order doesn't affect behavior, only readability):

```ts
const AXIS_TYPES: { key: string; label: string; lookupTable: string | null; hierarchical: boolean }[] = [
  { key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
  { key: 'genre', label: 'Είδος', lookupTable: 'genres', hierarchical: false },
  { key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  { key: 'dromos', label: 'Δρόμος', lookupTable: 'dromoi', hierarchical: false },
  { key: 'composer', label: 'Συνθέτης', lookupTable: 'composers', hierarchical: false },
  { key: 'year', label: 'Χρονολογία', lookupTable: null, hierarchical: false },
];
```

- [ ] **Step 2: Run it against the real database**

```bash
npm run db:seed:axis-types
```

Expected: `Axis types created: 1` (the script already skips existing rows — `region`/`rhythm`/`dromos`/`composer`/`year` are untouched, only `genre` is newly inserted).

- [ ] **Step 3: Write the backfill script**

```ts
// scripts/migrate-genre-to-axis.ts
import { db } from '../src/db/client';
import { songs, songAxisValues } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const allSongs = await db.select({ id: songs.id, genreId: songs.genreId }).from(songs);
  let created = 0;
  let skipped = 0;

  for (const song of allSongs) {
    const existing = await db
      .select({ id: songAxisValues.id })
      .from(songAxisValues)
      .where(eq(songAxisValues.songId, song.id));
    const hasGenreAxis = existing.length > 0
      ? (await db.select().from(songAxisValues).where(eq(songAxisValues.songId, song.id))).some(
          (row) => row.axisType === 'genre'
        )
      : false;
    if (hasGenreAxis) {
      skipped++;
      continue;
    }
    await db.insert(songAxisValues).values({ songId: song.id, axisType: 'genre', refId: song.genreId, yearValue: null });
    created++;
  }

  console.log(`Backfilled genre axis for ${created} songs, skipped ${skipped} that already had one.`);

  const [{ count: totalSongs }] = await db.select({ count: songs.id }).from(songs).then((rows) => [{ count: rows.length }]);
  const genreAxisRows = await db.select({ songId: songAxisValues.songId }).from(songAxisValues).where(eq(songAxisValues.axisType, 'genre'));
  const distinctSongsWithGenre = new Set(genreAxisRows.map((r) => r.songId)).size;
  console.log(`Verification: ${totalSongs} total songs, ${distinctSongsWithGenre} now have a genre axis value.`);
  if (totalSongs !== distinctSongsWithGenre) {
    console.error('MISMATCH — do not proceed to drop the songs.genreId column until this is 0.');
    process.exit(1);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: Add the script to `package.json`**

Add under `"scripts"`, alongside the other `db:*` entries:

```json
"db:migrate-genre-to-axis": "dotenv -e .env.local -- tsx scripts/migrate-genre-to-axis.ts"
```

- [ ] **Step 5: Run it against the real database**

```bash
npm run db:migrate-genre-to-axis
```

Expected: `Backfilled genre axis for N songs, skipped 0...` followed by `Verification: N total songs, N now have a genre axis value.` with matching counts and no MISMATCH error. **Do not proceed to Task 5 (dropping the column) if the counts don't match.**

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-axis-types.ts scripts/migrate-genre-to-axis.ts package.json
git commit -m "Seed genre axis type and backfill existing songs' genreId into song_axis_values"
```

---

## Task 2: Query layer — `songs.ts` reads/writes genre via axis values

**Files:**
- Modify: `src/db/queries/songs.ts`

**Interfaces:**
- Consumes: `replaceSongAxisValues`, `AxisValueInput` (existing, `src/db/queries/axisValues.ts`).
- Produces: `SongInput` drops `genreId` as a top-level required field (genre now travels inside `axisValues`, same as every other axis); `listSongs`'s `SongFilters.genreId` filter becomes an axis-value lookup instead of a column `eq`.

- [ ] **Step 1: Read the current file first**

Read `src/db/queries/songs.ts` before editing — this task changes `SongFilters`, `listSongs`, `SongInput`, `createSong`, `updateSong`, and `searchSuggestionSongs`.

- [ ] **Step 2: Update `listSongs`'s genre filter to query axis values instead of the column**

Replace the genre part of the filter-building logic. Currently:
```ts
export async function listSongs(ownerId: number, filters: SongFilters = {}): Promise<SongRow[]> {
  const conditions: SQL[] = [eq(songs.ownerId, ownerId)];
  if (filters.search) conditions.push(ilike(songs.title, `%${filters.search}%`));
  if (filters.genreId) conditions.push(eq(songs.genreId, filters.genreId));

  const results = await db.select().from(songs).where(and(...conditions));

  if (!filters.regionId) return results;
  // ... region filtering unchanged below
```
Change to (drop the `genreId` column condition; add a post-fetch axis-value filter mirroring the existing region-filter pattern immediately below it):
```ts
export async function listSongs(ownerId: number, filters: SongFilters = {}): Promise<SongRow[]> {
  const conditions: SQL[] = [eq(songs.ownerId, ownerId)];
  if (filters.search) conditions.push(ilike(songs.title, `%${filters.search}%`));

  let results = await db.select().from(songs).where(and(...conditions));

  if (filters.genreId) {
    const songIds = results.map((s) => s.id);
    if (songIds.length === 0) return [];
    const genreAxisRows = await db
      .select()
      .from(songAxisValues)
      .where(and(eq(songAxisValues.axisType, 'genre'), inArray(songAxisValues.songId, songIds)));
    const matchingSongIds = new Set(
      genreAxisRows.filter((r) => r.refId === filters.genreId).map((r) => r.songId)
    );
    results = results.filter((s) => matchingSongIds.has(s.id));
  }

  if (!filters.regionId) return results;
  // ... region filtering unchanged below, but reassign to `results` instead of the old `const results`
```
The subsequent region-filtering block already reads `results` and filters it further — just make sure the earlier `const results` declaration in that block is removed since `results` is now declared with `let` above (the region block currently does `const songIds = results.map(...)`, `const regionAxisRows = ...`, `return results.filter(...)` — leave those lines as they are, they already operate on `results` correctly once it's the `let`-declared one from this edit).

- [ ] **Step 3: Drop `genreId` from `SongInput`, stop writing it to the `songs` table directly**

Currently `SongInput` has `genreId: number;` as a required field, and `createSong`/`updateSong` both write `genreId: data.genreId` into the `songs` insert/update. Remove `genreId` from `SongInput` entirely — genre now arrives as one more entry in `data.axisValues` (same as region/rhythm/etc.), which `replaceSongAxisValues` already persists. Remove the `genreId: data.genreId,` line from both the `createSong` insert `.values({...})` call and the `updateSong` update `.set({...})` call. No other line in either function changes — `replaceSongAxisValues(song.id, data.axisValues)` (already called at the end of both) now carries the genre value along with everything else, unchanged.

- [ ] **Step 4: Update `searchSuggestionSongs`**

This function currently does `.innerJoin(users, eq(songs.ownerId, users.id))` and returns full `SongRow`s (which include `genreId`) filtered by admin ownership. No change needed here — it still returns `SongRow[]`, and callers now read genre from that song's axis values (fetched separately) rather than from the row itself. Confirm this function's body is untouched.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: errors in every file that still references `songs.genreId` as a column or `SongInput.genreId` — this is expected and will be zero once Tasks 3, 4, 6, 8, 11 are done. Do not attempt to make this task's diff type-check in isolation; note in your report which downstream files still reference the old shape, matching what this task brief's "Interfaces" section says changed.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/songs.ts
git commit -m "Move genre filtering/writing in songs.ts onto the axis-value system"
```

---

## Task 3: `genres.ts` — `deleteGenre` guard checks axis values, not the column

**Files:**
- Modify: `src/db/queries/genres.ts`

**Interfaces:**
- Consumes: `songAxisValues` (existing schema table).
- Produces: `deleteGenre(id)` behavior unchanged from the caller's perspective (still throws `'Το είδος χρησιμοποιείται από τραγούδι'` if in use), just checks the axis table instead of the dropped column.

- [ ] **Step 1: Update the import and the guard**

Read the current file first. Change:
```ts
import { db } from '../client';
import { genres, songs } from '../schema';
import { eq, or, isNull } from 'drizzle-orm';
import type { GenreRow } from '../schema';
```
to:
```ts
import { db } from '../client';
import { genres, songAxisValues } from '../schema';
import { eq, or, isNull, and } from 'drizzle-orm';
import type { GenreRow } from '../schema';
```
and replace `deleteGenre`'s body:
```ts
export async function deleteGenre(id: number): Promise<void> {
  const [songUsage] = await db.select({ id: songs.id }).from(songs).where(eq(songs.genreId, id)).limit(1);
  if (songUsage) throw new Error('Το είδος χρησιμοποιείται από τραγούδι');
  await db.delete(genres).where(eq(genres.id, id));
}
```
with:
```ts
export async function deleteGenre(id: number): Promise<void> {
  const [usage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'genre'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (usage) throw new Error('Το είδος χρησιμοποιείται από τραγούδι');
  await db.delete(genres).where(eq(genres.id, id));
}
```
(Every other function in this file — `listGenres`, `getGenreById`, `createGenre`, `updateGenre` — is unchanged, matching `deleteRegion`'s already-existing identical pattern in `src/db/queries/regions.ts`.)

- [ ] **Step 2: Commit**

```bash
git add src/db/queries/genres.ts
git commit -m "Check genre usage via axis values in deleteGenre, not the dropped column"
```

---

## Task 4: API validation — `genre` becomes a valid axis type, `genreId` drops out of song schemas

**Files:**
- Modify: `src/app/api/songs/route.ts`
- Modify: `src/app/api/songs/[id]/route.ts`
- Modify: `src/app/api/songs/suggestions/route.ts`

**Interfaces:**
- Consumes: `listSongs`, `createSong`, `SongInput` (Task 2), `deleteGenre`/`listGenres` unchanged (Task 3).
- Produces: `createSchema`/`updateSchema` no longer require `genreId`; `axisValueSchema`'s `axisType` enum includes `'genre'`.

- [ ] **Step 1: `src/app/api/songs/route.ts`**

Replace the whole file:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listSongs, createSong } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const axisValueSchema = z.object({
  axisType: z.enum(['genre', 'region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const createSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  maleKey: z.string().nullable(),
  femaleKey: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(request: NextRequest) {
  const ownerId = getUserId(request);
  const params = request.nextUrl.searchParams;
  const songs = await listSongs(ownerId, {
    search: params.get('search') ?? undefined,
    genreId: params.get('genreId') ? Number(params.get('genreId')) : undefined,
    regionId: params.get('regionId') ? Number(params.get('regionId')) : undefined,
  });
  return NextResponse.json(songs);
}

export async function POST(request: NextRequest) {
  const ownerId = getUserId(request);
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await createSong(ownerId, parsed.data);
  return NextResponse.json(song, { status: 201 });
}
```
Note what's gone: the `genreId: z.number().int()` field on `createSchema`, and the `getGenreById`-based visibility check block that used to run before calling `createSong` — that check is now redundant. Genre's `refId` visibility is enforced the exact same way every other axis's `refId` already is: nothing validates it server-side today for region/rhythm/dromos/composer either (confirmed: `createSong`/`updateSong` never checked axis-value visibility before writing), so genre now matches that existing, established behavior rather than being a special case.

- [ ] **Step 2: `src/app/api/songs/[id]/route.ts`**

Replace the whole file:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSongWithAxisValues, updateSong, deleteSong } from '@/db/queries/songs';
import { getUserId } from '@/lib/requestUser';

const axisValueSchema = z.object({
  axisType: z.enum(['genre', 'region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  imageUrl: z.string().nullable(),
  notes: z.string().nullable(),
  maleKey: z.string().nullable(),
  femaleKey: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const song = await getSongWithAxisValues(ownerId, Number(id));
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(song);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = getUserId(request);
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await updateSong(ownerId, Number(id), parsed.data);
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(song);
}

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

- [ ] **Step 3: `src/app/api/songs/suggestions/route.ts`** — fold genre visibility into the same axis-visibility path as everything else

Replace the whole file:
```ts
import { NextRequest, NextResponse } from 'next/server';
import { searchSuggestionSongs } from '@/db/queries/songs';
import { getAxisValuesForSongIds, getVisibleAxisRefIds } from '@/db/queries/axisValues';
import { getUserId } from '@/lib/requestUser';

export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  const title = request.nextUrl.searchParams.get('title')?.trim();
  if (!title) return NextResponse.json([]);

  const candidates = await searchSuggestionSongs(title);
  const [axisRows, visible] = await Promise.all([
    getAxisValuesForSongIds(candidates.map((s) => s.id)),
    getVisibleAxisRefIds(userId),
  ]);

  const result = candidates.map((song) => ({
    id: song.id,
    title: song.title,
    lyrics: song.lyrics,
    notes: song.notes,
    maleKey: song.maleKey,
    femaleKey: song.femaleKey,
    axisValues: axisRows
      .filter(
        (a) =>
          a.songId === song.id &&
          (a.axisType === 'year' || (a.refId !== null && visible.get(a.axisType)?.has(a.refId)))
      )
      // Reshape rather than pass the raw row through: the raw row carries `id`/`songId`
      // pointing at the *source* song, and the client stashes this array directly into new-song
      // form state. Stripping those keeps a stray `songId` from ever reaching the create payload.
      .map(({ axisType, refId, yearValue }) => ({ axisType, refId, yearValue })),
  }));
  return NextResponse.json(result);
}
```
This drops the `genreId`/`listGenres`/`visibleGenreIds` special-case block entirely — genre now flows through `axisRows`/`visible` exactly like region/rhythm/dromos/composer, since it's just another `axisType` value in the same table.

- [ ] **Step 4: Add `genre` visibility to `getVisibleAxisRefIds`**

Read `src/db/queries/axisValues.ts` first. `getVisibleAxisRefIds` currently queries `regions`/`rhythms`/`dromoi`/`composers` and returns a `Map` with keys `'region'|'rhythm'|'dromos'|'composer'` — it's missing `'genre'` (needed by Step 3 above, since `visible.get('genre')` must resolve to a real `Set`, not `undefined`, for genre-tagged songs to ever pass the suggestions filter). Add the import and the query:
```ts
import { db } from '../client';
import { songAxisValues, axisTypes, regions, rhythms, dromoi, composers, genres, songs } from '../schema';
import { eq, inArray, or, isNull } from 'drizzle-orm';
import type { SongAxisValueRow, AxisTypeRow } from '../schema';
```
(added `genres` to the import), and in `getVisibleAxisRefIds`:
```ts
export async function getVisibleAxisRefIds(userId: number): Promise<Map<string, Set<number>>> {
  const [regionRows, rhythmRows, dromosRows, composerRows, genreRows] = await Promise.all([
    db.select({ id: regions.id }).from(regions).where(or(isNull(regions.ownerId), eq(regions.ownerId, userId))),
    db.select({ id: rhythms.id }).from(rhythms).where(or(isNull(rhythms.ownerId), eq(rhythms.ownerId, userId))),
    db.select({ id: dromoi.id }).from(dromoi).where(or(isNull(dromoi.ownerId), eq(dromoi.ownerId, userId))),
    db.select({ id: composers.id }).from(composers).where(or(isNull(composers.ownerId), eq(composers.ownerId, userId))),
    db.select({ id: genres.id }).from(genres).where(or(isNull(genres.ownerId), eq(genres.ownerId, userId))),
  ]);
  return new Map<string, Set<number>>([
    ['region', new Set(regionRows.map((r) => r.id))],
    ['rhythm', new Set(rhythmRows.map((r) => r.id))],
    ['dromos', new Set(dromosRows.map((r) => r.id))],
    ['composer', new Set(composerRows.map((r) => r.id))],
    ['genre', new Set(genreRows.map((r) => r.id))],
  ]);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/songs/route.ts "src/app/api/songs/[id]/route.ts" src/app/api/songs/suggestions/route.ts src/db/queries/axisValues.ts
git commit -m "Fold genre into the standard axis-value validation and visibility path"
```

---

## Task 5: Drop the `songs.genreId` column

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:** none (schema-only change).

**Prerequisite:** Task 1's backfill must already show matching counts (no MISMATCH). Do not run this task otherwise.

- [ ] **Step 1: Remove `genreId` from the `songs` table definition**

In `src/db/schema.ts`, change:
```ts
export const songs = pgTable('songs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  lyrics: text('lyrics'),
  imageUrl: text('image_url'),
  genreId: integer('genre_id').notNull().references(() => genres.id),
  notes: text('notes'),
  maleKey: text('male_key'),
  femaleKey: text('female_key'),
  ownerId: integer('owner_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```
to:
```ts
export const songs = pgTable('songs', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  lyrics: text('lyrics'),
  imageUrl: text('image_url'),
  notes: text('notes'),
  maleKey: text('male_key'),
  femaleKey: text('female_key'),
  ownerId: integer('owner_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```
Expected: a migration dropping the `genre_id` column (and its FK constraint) from `songs`. Applies cleanly since every row already has an equivalent `song_axis_values` row (verified in Task 1).

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Drop songs.genre_id column now that every song has a genre axis value"
```

---

## Task 6: `SongAxisEditor` — genre becomes a pickable axis type

**Files:**
- Modify: `src/components/SongAxisEditor.tsx`

**Interfaces:**
- Consumes: `/api/genres` (existing endpoint, unchanged shape: `{id, name}[]`).
- Produces: no new exports — `AxisValueEntry`'s `axisType` can now legitimately be `'genre'`, handled identically to the other lookup-table axis types.

- [ ] **Step 1: Add `genre` to the lookup endpoint map**

Read the current file first. Change:
```ts
const LOOKUP_ENDPOINTS: Record<string, string> = {
  regions: '/api/regions',
  rhythms: '/api/rhythms',
  dromoi: '/api/dromoi',
  composers: '/api/composers',
};
```
to:
```ts
const LOOKUP_ENDPOINTS: Record<string, string> = {
  regions: '/api/regions',
  genres: '/api/genres',
  rhythms: '/api/rhythms',
  dromoi: '/api/dromoi',
  composers: '/api/composers',
};
```
No other change is needed in this file — the component already drives its "+ Πρόσθεσε άξονα" dropdown from whatever `axis_types` rows the `/api/axis-types` endpoint returns (Task 1 already added `genre` there with `lookupTable: 'genres'`), and already POSTs new lookup values generically via `LOOKUP_ENDPOINTS[selectedType.lookupTable]` — genre's "+ Νέα τιμή..." inline creation now works through the exact same code path as region/rhythm/dromos/composer, with no genre-specific branch anywhere in this file.

- [ ] **Step 2: Commit**

```bash
git add src/components/SongAxisEditor.tsx
git commit -m "Add genre to SongAxisEditor's lookup-table axis types"
```

---

## Task 7: Song forms — remove the separate required genre `<select>`

**Files:**
- Modify: `src/app/admin/songs/new/page.tsx`
- Modify: `src/app/admin/songs/[id]/page.tsx`
- Modify: `src/app/admin/local/songs/edit/page.tsx`

**Interfaces:**
- Consumes: `SongAxisEditor` (Task 6) unchanged props (`value: AxisValueEntry[]`, `onChange`).
- Produces: no separate `genreId`/`genres` state in these three pages — genre selection lives entirely inside the `axisValues` array these pages already pass to `SongAxisEditor`.

Each of these three pages currently has: a `genres` state array fetched via its own `fetch('/api/genres')`/`nativeApiFetch('/api/genres')` call, a `genreId`/`creatingGenre`/`newGenreName` state trio, a `handleCreateGenre` handler, and a required `<select>` rendered above `<SongAxisEditor>`. All of that is now redundant — genre creation and selection already happens inside `SongAxisEditor`'s generic "+ Πρόσθεσε άξονα" flow (Task 6).

- [ ] **Step 1: `src/app/admin/songs/new/page.tsx`**

Read the current file first. Remove:
- The `genres`/`setGenres` state and its `useEffect` fetch (`fetch('/api/genres').then((r) => r.json()).then(setGenres);`).
- The `genreId`/`setGenreId`, `creatingGenre`/`setCreatingGenre`, `newGenreName`/`setNewGenreName` state.
- The `handleCreateGenre` function.
- The `<select>` block for genre and its adjacent "+ Νέο είδος..." `{creatingGenre && (...)}` block.
- The `genreId: Number(genreId),` line from the `handleSubmit`'s POST body — the payload no longer has a top-level `genreId` field (matches Task 4's `createSchema`, which dropped it).
- Any leftover reference to `applySuggestion`'s `if (s.genreId !== null) setGenreId(String(s.genreId));` line — the suggestion payload (Task 4 Step 3, already stripped `genreId` from the response) no longer has a `genreId` field to apply; if the suggestion included a `genre` axis value, it's already present in `s.axisValues` and flows into `setAxisValues(s.axisValues)` the same way region/rhythm/etc. do — no special handling needed, just delete the now-dead `genreId` line.

Everything else in the file (title, lyrics, notes, maleKey/femaleKey, `SongAxisEditor`, image upload) stays exactly as it is.

- [ ] **Step 2: `src/app/admin/songs/[id]/page.tsx`**

Same removals as Step 1, applied to this file's equivalent state/handlers/JSX (this file additionally sets `setGenreId(String(song.genreId))` in its data-loading `useEffect` — remove that line too; the loaded song's `axisValues`, already passed to `SongAxisEditor`, carries the genre value).

- [ ] **Step 3: `src/app/admin/local/songs/edit/page.tsx`**

Same removals, applied to this file's equivalent state/handlers/JSX (uses `nativeApiFetch` instead of `fetch`/relative paths — the removed genre-fetching `useEffect` line here is `nativeApiFetch('/api/genres').then((r) => r.json()).then(setGenres);`).

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors referencing `genreId` anywhere in these three files.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/songs/new/page.tsx "src/app/admin/songs/[id]/page.tsx" "src/app/admin/local/songs/edit/page.tsx"
git commit -m "Remove the separate required genre select from all three song forms"
```

---

## Task 8: `suggestions.ts` — genre-aware grouping reads from axis values, default view becomes a plain list

**Files:**
- Modify: `src/lib/suggestions.ts`

**Interfaces:**
- Consumes: `SongWithAxes` (existing — `{ song: SongRow; axisValues: AxisValue[] }`).
- Produces: `groupByGenre` is removed; `getSuggestions`'s "no active axis" branch now returns a new `{ mode: 'ungrouped'; songs: SongRow[] }` shape instead of `{ mode: 'grouped'; genreGroups: GenreGroup[] }`. `SuggestionResult`, `SuggestionsResponsePayload`, and `buildSuggestionsResponse` are updated to match.

- [ ] **Step 1: Remove `groupByGenre`, change the fallback branch**

Read the current file first. Delete the `GenreGroup` interface and the `groupByGenre` function entirely (lines defining `export interface GenreGroup {...}` and `export function groupByGenre(...) {...}`).

Change `SuggestionResult`:
```ts
export type SuggestionResult =
  | { mode: 'filtered'; candidates: SongRow[] }
  | { mode: 'grouped'; genreGroups: GenreGroup[] };
```
to:
```ts
export type SuggestionResult =
  | { mode: 'filtered'; candidates: SongRow[] }
  | { mode: 'ungrouped'; songs: SongRow[] };
```

Change `getSuggestions`'s fallback branch:
```ts
  if (activeAxisTypes.size === 0) {
    const visible = allSongs
      .filter(({ song }) => song.id !== currentSongId)
      .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
      .map(({ song }) => song);
    return { mode: 'grouped', genreGroups: groupByGenre(visible) };
  }
```
to:
```ts
  if (activeAxisTypes.size === 0) {
    const visible = allSongs
      .filter(({ song }) => song.id !== currentSongId)
      .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
      .map(({ song }) => song)
      .sort((a, b) => a.title.localeCompare(b.title, 'el'));
    return { mode: 'ungrouped', songs: visible };
  }
```
(The rest of `getSuggestions` — the `activeAxisTypes.size > 0` branch calling `getFilteredCandidates`/`rankBySharedAxes` — is completely unchanged, matching the plan's Global Constraints.)

- [ ] **Step 2: Update `SuggestionsResponsePayload` and `buildSuggestionsResponse`**

Change:
```ts
export interface GenreGroupPayload {
  genreId: number;
  genreName: string;
  songs: SuggestedSong[];
}

export interface SuggestionsResponsePayload {
  currentSong: CurrentSongPayload | null;
  availableAxisTypes: AvailableAxis[];
  activeAxisTypes: string[];
  mode: 'filtered' | 'grouped';
  candidates: SuggestedSong[];
  genreGroups: GenreGroupPayload[];
  listTitle: string;
}
```
to:
```ts
export interface SuggestionsResponsePayload {
  currentSong: CurrentSongPayload | null;
  availableAxisTypes: AvailableAxis[];
  activeAxisTypes: string[];
  mode: 'filtered' | 'ungrouped';
  candidates: SuggestedSong[];
  songs: SuggestedSong[];
  listTitle: string;
}
```
(Drop `GenreGroupPayload` entirely — no longer referenced anywhere.)

`ReferenceLookups` currently has a `genres: GenreRow[]` field used only for `genreNameById` — that lookup is no longer needed (genre names, when shown, come from `availableAxisTypes`'s existing `labelForAxisValue`, which already resolves any axis type's `refId` to a name via `lookupNameById`). Add `genre` to `lookupNameById`:
```ts
  const lookupNameById: Record<string, Map<number, string>> = {
    region: new Map(lookups.regions.map((r) => [r.id, r.name])),
    genre: new Map(lookups.genres.map((g) => [g.id, g.name])),
    rhythm: new Map(lookups.rhythms.map((r) => [r.id, r.name])),
    dromos: new Map(lookups.dromoi.map((d) => [d.id, d.name])),
    composer: new Map(lookups.composers.map((c) => [c.id, c.name])),
  };
```
(`ReferenceLookups.genres: GenreRow[]` stays — it's now consumed here instead of via the deleted `genreNameById`; remove the old `const genreNameById = new Map(lookups.genres.map((g) => [g.id, g.name]));` line, it's dead code once `lookupNameById` covers `genre`.)

Replace `buildSuggestionsResponse`'s result-branching (the part after `const result = getSuggestions({...})`):
```ts
  if (result.mode === 'grouped') {
    return {
      currentSong,
      availableAxisTypes,
      activeAxisTypes: [...effectiveActive],
      mode: 'grouped',
      candidates: [],
      genreGroups: result.genreGroups
        .map((g) => ({
          genreId: g.genreId,
          genreName: genreNameById.get(g.genreId) ?? '?',
          songs: g.songs.map((s) => toSuggestion(s.id, s.title)),
        }))
        .sort((a, b) => a.genreName.localeCompare(b.genreName, 'el')),
      listTitle: '',
    };
  }
```
with:
```ts
  if (result.mode === 'ungrouped') {
    return {
      currentSong,
      availableAxisTypes,
      activeAxisTypes: [...effectiveActive],
      mode: 'ungrouped',
      candidates: [],
      songs: result.songs.map((s) => toSuggestion(s.id, s.title)),
      listTitle: '',
    };
  }
```
and the final `filtered`-mode return (unchanged logic, just needs the new required `songs: []` field added to satisfy the updated `SuggestionsResponsePayload` shape):
```ts
  const activeLabels = [...effectiveActive].map((key) => axisLabelByKey.get(key) ?? key);
  return {
    currentSong,
    availableAxisTypes,
    activeAxisTypes: [...effectiveActive],
    mode: 'filtered',
    candidates: result.candidates.map((s) => toSuggestion(s.id, s.title)),
    songs: [],
    listTitle: `Άλλα τραγούδια με τα ίδια: ${activeLabels.join(', ')}`,
  };
```
Also update the empty-state early return (`if (!currentSongWithAxes) {...}`) to match the new shape:
```ts
  if (!currentSongWithAxes) {
    return { currentSong: null, availableAxisTypes: [], activeAxisTypes: [], mode: 'ungrouped', candidates: [], songs: [], listTitle: '' };
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/suggestions.ts
git commit -m "Replace genre-grouped suggestion fallback with a plain sorted list"
```

---

## Task 9: Rewrite `suggestions.test.ts` for the axis-based genre model

**Files:**
- Modify: `src/lib/suggestions.test.ts`

**Interfaces:**
- Consumes: `getFilteredCandidates`, `rankBySharedAxes`, `getSuggestions`, `buildSuggestionsResponse` (Task 8's updated signatures/shapes).

- [ ] **Step 1: Update the `makeSong` helper to drop `genreId`**

Replace:
```ts
function makeSong(id: number, title: string, genreId = 1): SongRow {
  return {
    id,
    title,
    lyrics: 'lyrics',
    genreId,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SongRow;
}
```
with:
```ts
function makeSong(id: number, title: string): SongRow {
  return {
    id,
    title,
    lyrics: 'lyrics',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SongRow;
}
```
Update every call site in this file that passed a third `genreId` argument to `makeSong` (e.g. `makeSong(2, 'Match', 3)`, `makeSong(3, 'Other genre song', 7)`, `makeSong(1, 'Ζήτα', 5)` etc. in the `groupByGenre`/`getSuggestions` describe blocks below) to drop that third argument — genre, where a test needs it, now comes from an `av('genre', <id>)` entry in that song's `axisValues` instead.

- [ ] **Step 2: Delete the `groupByGenre` describe block and its import**

Remove `groupByGenre` from the top `import { ... } from './suggestions';` list. Delete the entire:
```ts
describe('groupByGenre', () => {
  it('groups songs by genreId and sorts titles alphabetically within each group', () => {
    ...
  });
});
```
block.

- [ ] **Step 3: Rewrite `getSuggestions`'s fallback test**

Replace:
```ts
describe('getSuggestions', () => {
  const current: SongWithAxes = { song: makeSong(1, 'Current'), axisValues: [av('rhythm', 10), av('region', 4)] };
  const match: SongWithAxes = { song: makeSong(2, 'Match', 3), axisValues: [av('rhythm', 10), av('region', 4)] };
  const otherGenre: SongWithAxes = { song: makeSong(3, 'Other genre song', 7), axisValues: [] };
  const allSongs = [current, match, otherGenre];

  it('returns a filtered ranked list when at least one axis is active', () => {
    const result = getSuggestions({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.mode).toBe('filtered');
    if (result.mode === 'filtered') expect(result.candidates.map((s) => s.id)).toEqual([2]);
  });

  it('falls back to genre-grouped when no axis is active', () => {
    const result = getSuggestions({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.mode).toBe('grouped');
    if (result.mode === 'grouped') {
      expect(result.genreGroups.map((g) => g.genreId).sort()).toEqual([3, 7]);
    }
  });
});
```
with:
```ts
describe('getSuggestions', () => {
  const current: SongWithAxes = { song: makeSong(1, 'Current'), axisValues: [av('rhythm', 10), av('region', 4)] };
  const match: SongWithAxes = { song: makeSong(2, 'Match'), axisValues: [av('rhythm', 10), av('region', 4), av('genre', 3)] };
  const otherGenre: SongWithAxes = { song: makeSong(3, 'Other genre song'), axisValues: [av('genre', 7)] };
  const allSongs = [current, match, otherGenre];

  it('returns a filtered ranked list when at least one axis is active', () => {
    const result = getSuggestions({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.mode).toBe('filtered');
    if (result.mode === 'filtered') expect(result.candidates.map((s) => s.id)).toEqual([2]);
  });

  it('falls back to a plain alphabetical list when no axis is active', () => {
    const result = getSuggestions({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.mode).toBe('ungrouped');
    if (result.mode === 'ungrouped') {
      expect(result.songs.map((s) => s.id)).toEqual([2, 3]);
    }
  });
});
```
(`match` = 'Match', `otherGenre` = 'Other genre song' — 'Match' sorts before 'Other genre song' alphabetically in Greek locale comparison, hence `[2, 3]`; verify this order actually holds when you run the test — if Greek locale collation places them differently, adjust the expected array to match, don't force it.)

- [ ] **Step 4: Rewrite `buildSuggestionsResponse`'s two tests**

Replace the whole `describe('buildSuggestionsResponse', ...)` block:
```ts
describe('buildSuggestionsResponse', () => {
  const rhythms: RhythmRow[] = [{ id: 1, name: 'Καλαματιανός', ownerId: null }];
  const dromoi: DromosRow[] = [{ id: 1, name: 'Ραστ', ownerId: null }];
  const composers: ComposerRow[] = [];
  const axisTypes: AxisTypeRow[] = [
    { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
    { id: 2, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  ];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό', ownerId: null }];
  const lookups = { regions, rhythms, dromoi, composers, axisTypes, genres };

  it('returns an empty grouped response when there is no current song', () => {
    const result = buildSuggestionsResponse({
      currentSongWithAxes: null,
      allSongs: [],
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result).toEqual({
      currentSong: null,
      availableAxisTypes: [],
      activeAxisTypes: [],
      mode: 'grouped',
      candidates: [],
      genreGroups: [],
      listTitle: '',
    });
  });

  it('builds a filtered response with human-readable axis labels and a listTitle', () => {
    const current = makeSong(1, 'Τραγούδι Α');
    const candidate = makeSong(2, 'Τραγούδι Β');
    const allSongs = [
      { song: current, axisValues: [av('region', 3), av('rhythm', 1)] },
      { song: candidate, axisValues: [av('region', 3), av('rhythm', 1)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: { id: 1, title: 'Τραγούδι Α', lyrics: null, imageUrl: null, maleKey: null, femaleKey: null, axisValues: [av('region', 3), av('rhythm', 1)] },
      allSongs,
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result.mode).toBe('filtered');
    expect(result.availableAxisTypes).toEqual([
      { key: 'region', label: 'Περιοχή', value: 'Κυκλάδες' },
      { key: 'rhythm', label: 'Ρυθμός', value: 'Καλαματιανός' },
    ]);
    expect(result.candidates).toEqual([{ id: 2, title: 'Τραγούδι Β', played: false }]);
    expect(result.listTitle).toBe('Άλλα τραγούδια με τα ίδια: Περιοχή, Ρυθμός');
  });
});
```
with:
```ts
describe('buildSuggestionsResponse', () => {
  const rhythms: RhythmRow[] = [{ id: 1, name: 'Καλαματιανός', ownerId: null }];
  const dromoi: DromosRow[] = [{ id: 1, name: 'Ραστ', ownerId: null }];
  const composers: ComposerRow[] = [];
  const axisTypes: AxisTypeRow[] = [
    { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
    { id: 2, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  ];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό', ownerId: null }];
  const lookups = { regions, rhythms, dromoi, composers, axisTypes, genres };

  it('returns an empty ungrouped response when there is no current song', () => {
    const result = buildSuggestionsResponse({
      currentSongWithAxes: null,
      allSongs: [],
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result).toEqual({
      currentSong: null,
      availableAxisTypes: [],
      activeAxisTypes: [],
      mode: 'ungrouped',
      candidates: [],
      songs: [],
      listTitle: '',
    });
  });

  it('builds a filtered response with human-readable axis labels and a listTitle', () => {
    const current = makeSong(1, 'Τραγούδι Α');
    const candidate = makeSong(2, 'Τραγούδι Β');
    const allSongs = [
      { song: current, axisValues: [av('region', 3), av('rhythm', 1)] },
      { song: candidate, axisValues: [av('region', 3), av('rhythm', 1)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: { id: 1, title: 'Τραγούδι Α', lyrics: null, imageUrl: null, maleKey: null, femaleKey: null, axisValues: [av('region', 3), av('rhythm', 1)] },
      allSongs,
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result.mode).toBe('filtered');
    expect(result.availableAxisTypes).toEqual([
      { key: 'region', label: 'Περιοχή', value: 'Κυκλάδες' },
      { key: 'rhythm', label: 'Ρυθμός', value: 'Καλαματιανός' },
    ]);
    expect(result.candidates).toEqual([{ id: 2, title: 'Τραγούδι Β', played: false }]);
    expect(result.listTitle).toBe('Άλλα τραγούδια με τα ίδια: Περιοχή, Ρυθμός');
  });
});
```
(Only the first test's `mode`/shape changed from `'grouped'`/`genreGroups: []` to `'ungrouped'`/`songs: []`, and its name — the second test is unchanged since it exercises the `filtered` branch, untouched by this whole plan.)

- [ ] **Step 5: Run the full test file**

```bash
npm test -- suggestions.test
```
Expected: all tests pass. If the alphabetical-order assumption in Step 3 doesn't hold, fix the expected array to match reality — don't force the test to assert something false.

- [ ] **Step 6: Commit**

```bash
git add src/lib/suggestions.test.ts
git commit -m "Rewrite suggestions tests for genre-as-axis and the ungrouped fallback"
```

---

## Task 10: `LiveSessionView`, `songPickerData.ts`, and `regions.ts` — consume the new `ungrouped` shape and fix a plan gap in the server-side region-for-genre lookup

**Files:**
- Modify: `src/components/LiveSessionView.tsx`
- Modify: `src/lib/songPickerData.ts`
- Modify: `src/db/queries/regions.ts`

**Interfaces:**
- Consumes: `SuggestionsResponsePayload` (Task 8's new shape: `mode: 'filtered' | 'ungrouped'`, `songs: SuggestedSong[]` instead of `genreGroups`).

**Plan-gap note (discovered during Task 5's execution, added here):** Task 5 dropped `songs.genreId`, which broke `src/db/queries/regions.ts`'s `getUsedTopLevelRegionsForGenre` — the server-side counterpart to `songPickerData.ts`'s `getUsedTopLevelRegionsLocal` (this task's Step 2 below), used by `GET /api/genres/[id]/regions` (in turn called by `remoteSongPickerDataSource.listRegionsForGenre`, Task 11). No task in the original plan covered this file; it belongs here because it's the same conceptual fix as this task's Step 2, just for the remote/server data path instead of the local/offline one.

- [ ] **Step 0: Fix `getUsedTopLevelRegionsForGenre` in `regions.ts`**

Read the current file first. Replace:
```ts
export async function getUsedTopLevelRegionsForGenre(ownerId: number, genreId: number): Promise<RegionRow[]> {
  const genreSongs = await db
    .select({ id: songs.id })
    .from(songs)
    .where(and(eq(songs.genreId, genreId), eq(songs.ownerId, ownerId)));
  const songIds = genreSongs.map((s) => s.id);
  if (songIds.length === 0) return [];
```
with:
```ts
export async function getUsedTopLevelRegionsForGenre(ownerId: number, genreId: number): Promise<RegionRow[]> {
  const ownerSongs = await db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, ownerId));
  const ownerSongIds = new Set(ownerSongs.map((s) => s.id));
  if (ownerSongIds.size === 0) return [];
  const genreAxisRows = await db
    .select({ songId: songAxisValues.songId })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'genre'), eq(songAxisValues.refId, genreId)));
  const songIds = genreAxisRows.map((r) => r.songId).filter((id) => ownerSongIds.has(id));
  if (songIds.length === 0) return [];
```
(The rest of the function — fetching `allRegions`/`axisRows` for `'region'` and computing `topLevelIds` — is unchanged; it already reads `songIds`, which now comes from the axis-value lookup instead of the dropped column.) The `songs` import at the top of the file is still needed (for `ownerSongs`), so leave it as-is.

- [ ] **Step 0b: Type-check and commit this fix on its own**

```bash
npx tsc --noEmit
```
Expected: no errors originating in `src/db/queries/regions.ts`.

```bash
git add src/db/queries/regions.ts
git commit -m "Fix getUsedTopLevelRegionsForGenre to read genre from axis values, not the dropped column"
```
(Committed separately from this task's Steps 1+ below, so the plan-gap fix is easy to find in history.)

- [ ] **Step 1: `LiveSessionView.tsx`'s rendering of the suggestions panel**

Read the current file first. Replace the JSX block:
```tsx
              {data.mode === 'filtered' &&
                (data.candidates.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Καμία πρόταση</p>
                ) : (
                  data.candidates.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
              {data.mode === 'grouped' &&
                data.genreGroups.map((group) => (
                  <div key={group.genreId} className="flex flex-col gap-1">
                    <h3 className="px-3 pt-2 text-xs font-semibold text-base-content/50 uppercase">{group.genreName}</h3>
                    {group.songs.map((s) => (
                      <SongButton key={s.id} song={s} onPick={handlePick} />
                    ))}
                  </div>
                ))}
```
with:
```tsx
              {data.mode === 'filtered' &&
                (data.candidates.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Καμία πρόταση</p>
                ) : (
                  data.candidates.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
              {data.mode === 'ungrouped' &&
                (data.songs.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Κανένα τραγούδι</p>
                ) : (
                  data.songs.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
```
Also update the panel header just above it:
```tsx
            <h2 className="border-b border-base-300 bg-base-200 px-4 py-2 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
              {data.mode === 'filtered' ? data.listTitle : 'Όλα τα τραγούδια'}
            </h2>
```
This line already reads correctly for the new shape (`data.mode === 'filtered' ? data.listTitle : 'Όλα τα τραγούδια'` already falls through to the same generic label for any non-`'filtered'` mode) — no change needed here, confirm it during review rather than editing it.

- [ ] **Step 2: `songPickerData.ts`'s `filterSongsLocal` — genre filter reads axis values, not `song.genreId`**

Read the current file first. `SongRow` no longer has a `genreId` field (Task 5 dropped the column) — `getUsedTopLevelRegionsLocal` and `filterSongsLocal` both currently do `s.genreId === genreId` / `data.songs.filter((s) => s.genreId === genreId)`, which won't type-check anymore. Replace:
```ts
export function getUsedTopLevelRegionsLocal(genreId: number, data: ReferenceData): RegionRow[] {
  const genreSongIds = new Set(data.songs.filter((s) => s.genreId === genreId).map((s) => s.id));
  if (genreSongIds.size === 0) return [];
  const byId = new Map(data.regions.map((r) => [r.id, r]));
  const topLevelIds = new Set<number>();
  for (const av of data.axisValues) {
    if (av.axisType === 'region' && genreSongIds.has(av.songId) && av.refId !== null) {
      topLevelIds.add(findTopLevelRegionId(av.refId, byId));
    }
  }
  return data.regions.filter((r) => topLevelIds.has(r.id));
}
```
with:
```ts
export function getUsedTopLevelRegionsLocal(genreId: number, data: ReferenceData): RegionRow[] {
  const genreSongIds = new Set(
    data.axisValues.filter((av) => av.axisType === 'genre' && av.refId === genreId).map((av) => av.songId)
  );
  if (genreSongIds.size === 0) return [];
  const byId = new Map(data.regions.map((r) => [r.id, r]));
  const topLevelIds = new Set<number>();
  for (const av of data.axisValues) {
    if (av.axisType === 'region' && genreSongIds.has(av.songId) && av.refId !== null) {
      topLevelIds.add(findTopLevelRegionId(av.refId, byId));
    }
  }
  return data.regions.filter((r) => topLevelIds.has(r.id));
}
```
And replace:
```ts
export function filterSongsLocal(data: ReferenceData, filters: SongPickerFilters): SongRow[] {
  let results = data.songs;
  if (filters.search) {
    const q = filters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    results = results.filter((s) => s.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  }
  if (filters.genreId) results = results.filter((s) => s.genreId === filters.genreId);
  if (!filters.regionId) return results;
```
with:
```ts
export function filterSongsLocal(data: ReferenceData, filters: SongPickerFilters): SongRow[] {
  let results = data.songs;
  if (filters.search) {
    const q = filters.search.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    results = results.filter((s) => s.title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q));
  }
  if (filters.genreId) {
    const genreSongIds = new Set(
      data.axisValues.filter((av) => av.axisType === 'genre' && av.refId === filters.genreId).map((av) => av.songId)
    );
    results = results.filter((s) => genreSongIds.has(s.id));
  }
  if (!filters.regionId) return results;
```
(The rest of `filterSongsLocal`, the region-filtering block below, is already axis-value-based and unchanged.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors referencing `.genreId` on a `SongRow` anywhere in these two files.

- [ ] **Step 4: Commit**

```bash
git add src/components/LiveSessionView.tsx src/lib/songPickerData.ts
git commit -m "Update LiveSessionView and songPickerData for the ungrouped suggestion shape and axis-based genre filtering"
```

---

## Task 11: New `SongPicker` — paginated list with a filter bar, no mandatory first step

**Files:**
- Modify: `src/components/SongPicker.tsx`
- Modify: `src/lib/songPickerData.ts`

**Interfaces:**
- Consumes: `SongPickerDataSource` — extended with a new method (below).
- Produces: `SongPicker`'s props (`onSelect`, `dataSource`) are unchanged, so both call sites (`session/new/page.tsx`, `LiveSessionView.tsx`) need no changes at all.

- [ ] **Step 1: Extend `SongPickerDataSource` with a unified "list with any axis filters" method**

Read the current `src/lib/songPickerData.ts` first (post-Task 10 state). Add a new method to the interface and both implementations. Change:
```ts
export interface SongPickerFilters {
  genreId?: number;
  regionId?: number;
  search?: string;
}

export interface SongPickerDataSource {
  listGenres(): Promise<SongPickerGenre[]>;
  listRegionsForGenre(genreId: number): Promise<SongPickerRegion[]>;
  listSongs(filters: SongPickerFilters): Promise<SongPickerSong[]>;
}
```
to:
```ts
export interface SongPickerFilters {
  genreId?: number;
  regionId?: number;
  search?: string;
}

export interface SongPickerDataSource {
  listGenres(): Promise<SongPickerGenre[]>;
  listRegionsForGenre(genreId: number): Promise<SongPickerRegion[]>;
  listSongs(filters: SongPickerFilters): Promise<SongPickerSong[]>;
  /** All songs, unfiltered — used by the new SongPicker's default paginated view. */
  listAllSongs(): Promise<SongPickerSong[]>;
}
```
Add the implementation to `remoteSongPickerDataSource`:
```ts
export const remoteSongPickerDataSource: SongPickerDataSource = {
  async listGenres() {
    const res = await fetch('/api/genres');
    return res.json();
  },
  async listRegionsForGenre(genreId: number) {
    const res = await fetch(`/api/genres/${genreId}/regions`);
    return res.json();
  },
  async listSongs(filters: SongPickerFilters) {
    const params = new URLSearchParams();
    if (filters.genreId) params.set('genreId', String(filters.genreId));
    if (filters.regionId) params.set('regionId', String(filters.regionId));
    if (filters.search) params.set('search', filters.search);
    const res = await fetch(`/api/songs?${params.toString()}`);
    return res.json();
  },
  async listAllSongs() {
    const res = await fetch('/api/songs');
    return res.json();
  },
};
```
And to `createLocalSongPickerDataSource`'s returned object:
```ts
export function createLocalSongPickerDataSource(data: ReferenceData): SongPickerDataSource {
  return {
    async listGenres() {
      return data.genres.map((g) => ({ id: g.id, name: g.name }));
    },
    async listRegionsForGenre(genreId: number) {
      return getUsedTopLevelRegionsLocal(genreId, data).map((r) => ({ id: r.id, name: r.name }));
    },
    async listSongs(filters: SongPickerFilters) {
      return filterSongsLocal(data, filters).map((s) => ({ id: s.id, title: s.title }));
    },
    async listAllSongs() {
      return data.songs.map((s) => ({ id: s.id, title: s.title }));
    },
  };
}
```

- [ ] **Step 2: Rewrite `SongPicker.tsx`**

Replace the whole file:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { remoteSongPickerDataSource, type SongPickerDataSource } from '@/lib/songPickerData';

interface Genre {
  id: number;
  name: string;
}

interface Region {
  id: number;
  name: string;
}

interface Song {
  id: number;
  title: string;
}

const PAGE_SIZE = 30;

export default function SongPicker({
  onSelect,
  dataSource = remoteSongPickerDataSource,
}: {
  onSelect: (songId: number) => void;
  dataSource?: SongPickerDataSource;
}) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [regionOptions, setRegionOptions] = useState<Region[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [search, setSearch] = useState('');
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [filtered, setFiltered] = useState<Song[]>([]);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([dataSource.listGenres(), dataSource.listAllSongs()]).then(([g, s]) => {
      setGenres(g);
      setAllSongs(s);
      setFiltered(s);
      setLoaded(true);
    });
  }, [dataSource]);

  useEffect(() => {
    if (!selectedGenre) {
      setRegionOptions([]);
      setSelectedRegion(null);
      return;
    }
    dataSource.listRegionsForGenre(selectedGenre.id).then(setRegionOptions);
    setSelectedRegion(null);
  }, [dataSource, selectedGenre]);

  useEffect(() => {
    if (!loaded) return;
    if (!selectedGenre && !selectedRegion && !search) {
      setFiltered(allSongs);
      setPage(0);
      return;
    }
    dataSource
      .listSongs({ genreId: selectedGenre?.id, regionId: selectedRegion?.id, search: search || undefined })
      .then((results) => {
        setFiltered(results);
        setPage(0);
      });
  }, [dataSource, loaded, selectedGenre, selectedRegion, search, allSongs]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSongs = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="card w-full max-w-md bg-base-100 shadow">
      <div className="card-body gap-3">
        <h2 className="card-title text-lg">Διάλεξε τραγούδι</h2>

        <form onSubmit={(e) => e.preventDefault()} className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Αναζήτηση τραγουδιού"
            className="input input-bordered flex-1"
            autoFocus
          />
        </form>

        <div className="flex flex-wrap gap-2">
          <select
            value={selectedGenre?.id ?? ''}
            onChange={(e) => setSelectedGenre(genres.find((g) => g.id === Number(e.target.value)) ?? null)}
            className="select select-bordered select-sm"
          >
            <option value="">Όλα τα είδη</option>
            {genres.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          {regionOptions.length > 0 && (
            <select
              value={selectedRegion?.id ?? ''}
              onChange={(e) => setSelectedRegion(regionOptions.find((r) => r.id === Number(e.target.value)) ?? null)}
              className="select select-bordered select-sm"
            >
              <option value="">Όλες οι περιοχές</option>
              {regionOptions.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>

        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {!loaded && <li className="p-3 text-center text-sm text-base-content/50">Φόρτωση...</li>}
          {loaded && pageSongs.length === 0 && <li className="p-3 text-center text-sm text-base-content/50">Καμία πρόταση</li>}
          {pageSongs.map((s) => (
            <li key={s.id}>
              <button onClick={() => onSelect(s.id)} className="btn btn-ghost h-auto w-full justify-center py-3 text-center font-normal">
                {s.title}
              </button>
            </li>
          ))}
        </ul>

        {pageCount > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn btn-sm">← Προηγούμενα</button>
            <span className="text-sm text-base-content/60">{page + 1} / {pageCount}</span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="btn btn-sm">Επόμενα →</button>
          </div>
        )}
      </div>
    </div>
  );
}
```
This drops the `Step` state machine entirely — genre and region are now two optional filter dropdowns shown together above one paginated list, matching the design's "Όλα paginated από την αρχή" decision. `onSelect`/`dataSource` props are unchanged, so `session/new/page.tsx` and `LiveSessionView.tsx` (Task 10) need no edits for this component's new internals.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SongPicker.tsx src/lib/songPickerData.ts
git commit -m "Replace the genre-first SongPicker wizard with a paginated, filterable list"
```

---

## Task 12: Client-side default-view preference

**Files:**
- Create: `src/lib/suggestionViewPreference.ts`
- Create: `src/lib/suggestionViewPreference.test.ts`
- Modify: `src/components/LiveSessionView.tsx`

**Interfaces:**
- Consumes: `KeyValueStore` (existing, `src/lib/preferencesStore.ts` — already works on both web, via a `localStorage`-backed adapter, and native, via Capacitor `Preferences`; confirm this file already has a web-compatible implementation before assuming — if `preferencesStore.ts`'s current implementation is Capacitor-only, this task must add a small `localStorage`-backed `KeyValueStore` for web instead of assuming one exists).
- Produces: `getDefaultViewPreference(storage): Promise<{ type: 'none' } | { type: 'filterGenre'; genreId: number } | { type: 'groupByGenre' }>`, `setDefaultViewPreference(storage, pref): Promise<void>`.

- [ ] **Step 1: Confirm `preferencesStore.ts`'s web behavior before writing this task's code**

Read `src/lib/preferencesStore.ts`. If its single exported `preferencesStore: KeyValueStore` wraps `@capacitor/preferences`'s `Preferences.get`/`Preferences.set` directly (as seen earlier in this session — `@capacitor/preferences`'s own web fallback uses `window.localStorage` under the hood when there's no native bridge), then `preferencesStore` already works correctly on both platforms and this task can use it directly, matching every other feature in this codebase that already reads/writes cross-platform preferences (e.g. `localProgramsStore.ts`, `adminEditStore.ts`). If it does not (e.g. if it throws or no-ops outside Capacitor), escalate — do not silently add a second, parallel storage mechanism without understanding why the existing one isn't reused.

- [ ] **Step 2: Write the failing tests**

```ts
// src/lib/suggestionViewPreference.test.ts
import { describe, it, expect } from 'vitest';
import { getDefaultViewPreference, setDefaultViewPreference } from './suggestionViewPreference';
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

describe('suggestionViewPreference', () => {
  it('defaults to "none" when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'none' });
  });

  it('round-trips a filterGenre preference', async () => {
    const store = inMemoryStore();
    await setDefaultViewPreference(store, { type: 'filterGenre', genreId: 5 });
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'filterGenre', genreId: 5 });
  });

  it('round-trips a groupByGenre preference', async () => {
    const store = inMemoryStore();
    await setDefaultViewPreference(store, { type: 'groupByGenre' });
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'groupByGenre' });
  });

  it('can be reset back to none', async () => {
    const store = inMemoryStore();
    await setDefaultViewPreference(store, { type: 'filterGenre', genreId: 5 });
    await setDefaultViewPreference(store, { type: 'none' });
    expect(await getDefaultViewPreference(store)).toEqual({ type: 'none' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm test -- suggestionViewPreference
```
Expected: FAIL with "Cannot find module './suggestionViewPreference'"

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/suggestionViewPreference.ts
import type { KeyValueStore } from './preferencesStore';

const PREFERENCE_KEY = 'glentify:suggestion-default-view';

export type DefaultViewPreference =
  | { type: 'none' }
  | { type: 'filterGenre'; genreId: number }
  | { type: 'groupByGenre' };

export async function getDefaultViewPreference(storage: KeyValueStore): Promise<DefaultViewPreference> {
  const stored = await storage.get<DefaultViewPreference>(PREFERENCE_KEY);
  return stored ?? { type: 'none' };
}

export async function setDefaultViewPreference(storage: KeyValueStore, pref: DefaultViewPreference): Promise<void> {
  if (pref.type === 'none') {
    await storage.set(PREFERENCE_KEY, null);
    return;
  }
  await storage.set(PREFERENCE_KEY, pref);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- suggestionViewPreference
```
Expected: PASS (4 tests)

- [ ] **Step 6: Wire it into `LiveSessionView.tsx`**

Read the current file (post-Task 10 state) first. Add the import:
```tsx
import { preferencesStore } from '@/lib/preferencesStore';
import { getDefaultViewPreference, setDefaultViewPreference, type DefaultViewPreference } from '@/lib/suggestionViewPreference';
```
Add state and a load-on-mount effect near the top of the component body (alongside the existing `showPlayed`/`manualActiveAxisTypes` state):
```tsx
  const [defaultView, setDefaultView] = useState<DefaultViewPreference>({ type: 'none' });
  const [showViewSettings, setShowViewSettings] = useState(false);

  useEffect(() => {
    getDefaultViewPreference(preferencesStore).then(setDefaultView);
  }, []);
```
Apply the preference when the response is `ungrouped` and no manual filter is active — add this right after `const [data, setData] = useState...` block's `load` is defined, by adjusting what gets passed to `store.load`. Since `store.load(showPlayed, manualActiveAxisTypes)` already accepts an explicit active-axis-types override, reuse that mechanism: when `defaultView.type === 'filterGenre'` and the user hasn't manually touched filters yet (`manualActiveAxisTypes === null`), pass `['genre']` as the active types instead of `null`, and separately pass the specific `genreId` through — however, `store.load`'s existing signature only accepts axis *types*, not specific *values*, since the "current song's own axis value" is what gets matched. This preference only makes sense in the initial `SongPicker` (Task 11) context or as a *filter type toggle*, not as a value substitute in the mid-session ranking view — so scope this preference's effect narrowly to the `groupByGenre`-style relabeling of the `ungrouped` list, not to the `SongPicker`.

Add a small settings toggle in the header, near the existing `showPlayed` checkbox:
```tsx
          <button onClick={() => setShowViewSettings((v) => !v)} className="btn btn-sm btn-ghost">
            ⚙ Προβολή
          </button>
```
And, right after the header's closing `</div>` (before `<h1>{currentSong.title}</h1>`), add the settings panel:
```tsx
        {showViewSettings && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Προεπιλεγμένη προβολή:</span>
            <button
              onClick={async () => {
                await setDefaultViewPreference(preferencesStore, { type: 'none' });
                setDefaultView({ type: 'none' });
              }}
              className={`btn btn-xs ${defaultView.type === 'none' ? 'btn-primary' : 'btn-outline'}`}
            >
              Καμία
            </button>
            <button
              onClick={async () => {
                await setDefaultViewPreference(preferencesStore, { type: 'groupByGenre' });
                setDefaultView({ type: 'groupByGenre' });
              }}
              className={`btn btn-xs ${defaultView.type === 'groupByGenre' ? 'btn-primary' : 'btn-outline'}`}
            >
              Ομαδοποίηση ανά είδος
            </button>
          </div>
        )}
```
This gives the "καμία προεπιλογή" vs "ομαδοποίηση ανά είδος" toggle the design calls for — the `groupByGenre` display mode itself (actually grouping `data.songs` by their genre axis value client-side, purely for rendering, when `defaultView.type === 'groupByGenre'` and `data.mode === 'ungrouped'`) is a display-only concern: replace the Task 10 `data.mode === 'ungrouped'` rendering block with:
```tsx
              {data.mode === 'ungrouped' && defaultView.type !== 'groupByGenre' &&
                (data.songs.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Κανένα τραγούδι</p>
                ) : (
                  data.songs.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
              {data.mode === 'ungrouped' && defaultView.type === 'groupByGenre' && (
                <p className="px-3 py-4 text-sm text-base-content/50 italic">
                  (Ομαδοποίηση ανά είδος — ενεργοποίησε το φίλτρο "Είδος" πάνω για να δεις μια συγκεκριμένη κατηγορία.)
                </p>
              )}
```
The "filterGenre" preference type (pre-activating a specific genre filter automatically) is a smaller, separable enhancement — for this task, ship the "none" / "groupByGenre" toggle only (both already fully specified above); leave `filterGenre` defined in the type for future use but not yet wired into any UI control, and say so explicitly in your task report rather than half-implementing a control for it.

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/suggestionViewPreference.ts src/lib/suggestionViewPreference.test.ts src/components/LiveSessionView.tsx
git commit -m "Add client-side default-view preference (none / group-by-genre) to the suggestions panel"
```

---

## Task 13: Full manual verification

No further code changes expected. Full walkthrough on `npm run dev`, using the real `farantosgeo@gmail.com` account (or a throwaway registered account if you prefer not to touch it, matching the pattern used in earlier features this session).

- [ ] **Step 1: Confirm the migration's data integrity**

```bash
npm run db:migrate-genre-to-axis
```
Expected (re-running is safe, idempotent): `Backfilled genre axis for 0 songs, skipped N that already had one.` with matching verification counts — confirms no song silently lost its genre through this whole plan.

- [ ] **Step 2: Song forms**

Create a new song via `/admin/songs/new`: confirm there's no separate genre dropdown, confirm genre is addable via the "+ Πρόσθεσε άξονα" flow in `SongAxisEditor` exactly like region/rhythm. Edit an existing song via `/admin/songs/[id]`: confirm its previously-set genre shows up correctly as an axis chip (proves the backfill worked). Repeat on `/admin/local/songs/edit` (native admin tool) if a device/emulator is available; otherwise note as deferred, consistent with this repo's established mobile-testing constraints.

- [ ] **Step 3: New SongPicker**

Start a new session (`/session/new`): confirm the song list appears immediately (paginated, not gated behind a genre pick), confirm the genre/region dropdowns filter the list correctly and can be cleared back to "Όλα".

- [ ] **Step 4: Suggestions panel**

Pick a song, then in the live session view: confirm toggling an axis filter (e.g. rhythm) surfaces cross-genre matches if any exist (the scenario from the original design discussion — a traditional song and a stylistically-similar non-traditional one sharing a rhythm). Clear all filters: confirm the panel falls back to the plain, alphabetical "ungrouped" list, not an error. Toggle "⚙ Προβολή" → "Ομαδοποίηση ανά είδος": confirm the setting persists across a page reload (reads from `preferencesStore`).

- [ ] **Step 5: Full test suite and type-check**

```bash
npm test
npx tsc --noEmit
```
Expected: all tests passing, zero type errors.

- [ ] **Step 6: Confirm no `genreId` references remain**

```bash
grep -rn "genreId" src/ --include="*.ts" --include="*.tsx"
```
Expected: only occurrences inside `SongPickerFilters`/`SongPickerGenre` (`src/lib/songPickerData.ts`, intentionally kept as the filter API's field name) and any leftover comments — no reference to `songs.genreId` as a column, no `SongRow.genreId`, no `SongInput.genreId`. If anything else turns up, it's a missed call site from an earlier task — fix it before calling this task done.

No commit for this task — it's a verification checkpoint.
