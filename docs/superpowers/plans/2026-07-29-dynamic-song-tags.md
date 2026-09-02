# Dynamic Song Classification (Tags) Implementation Plan

> **Status: COMPLETE.** Implemented — confirmed directly against `src/db/schema.ts` (`axisTypes`/`songAxisValues`, no fixed rhythm/region/dromos columns on `songs`) and `src/lib/suggestions.ts`. Folded into the repo's early history rather than tracked as individual per-task commits (no granular history exists from before that point in this repo).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed Region/Rhythm/Dromos columns on `songs` with a flexible per-song set of typed axis values (tags), so non-traditional songs (rembetika, laika, entechna) can be classified only by the axes that actually apply to them, and the live-session suggestion engine becomes a single dynamically-filtered list driven by whichever axes the user has toggled on.

**Architecture:** A new generic `song_axis_values(song_id, axis_type, ref_id, year_value)` join table replaces the fixed FK columns, with a small fixed `axis_types` dictionary (region/rhythm/dromos/composer/year) seeded in code. `regions`/`rhythms`/`dromoi` stay real lookup tables (region keeps its parent-hierarchy); a new `composers` table is added. `transition_rules` and its admin page are removed outright — rhythm filtering becomes an opt-in toggle, not a system-enforced hard filter. The suggestion engine (`src/lib/suggestions.ts`) is rewritten around active-axis AND-filtering (with ancestor/descendant-inclusive region matching) producing one dynamically-titled list, falling back to a Genre-grouped, alphabetized view when no axis is active.

**Tech Stack:** Next.js 16 (App Router, `src/` layout), TypeScript, Drizzle ORM (`drizzle-orm/neon-http`), Neon Postgres, Tailwind v4, Vitest, Zod.

## Global Constraints

- Axis types are a fixed set for this plan: `region` (hierarchical, lookup table `regions`), `rhythm` (lookup `rhythms`), `dromos` (lookup `dromoi`), `composer` (lookup `composers`), `year` (no lookup table, raw integer). Copied verbatim from the spec — do not add others.
- A song has at most one value per axis type (`UNIQUE(songId, axisType)` on `song_axis_values`).
- `genreId` on `songs` stays a required, fixed FK column — it is descriptive metadata, not a dynamic axis, and drives no automatic per-genre config.
- Axis toggles default to **all ON** when a song is first opened in the live session.
- Region filtering matches the current song's region, any ancestor of it (any depth up), and any descendant of it (any depth down) — not exact-match only.
- When zero axes are active, the candidate list groups by Genre (alphabetical genre name), alphabetical by title within each group.
- `transitionRules` table, `/admin/transition-rules` page, and `/api/transition-rules*` routes are deleted entirely, not hidden or flagged off.
- `axis_types` has no admin CRUD UI — it is a fixed, code-seeded dictionary. Adding a new axis type in the future is a code change (new lookup table + seed row), not a runtime admin operation — out of scope for this plan.
- This codebase does not unit-test query-layer files (`src/db/queries/*.ts` have no corresponding test files today — only pure-logic files like `src/lib/suggestions.ts` do). Follow that existing convention: query-layer tasks are verified with a manual one-off script run against the dev DB, not a Vitest suite.
- Every `npm run db:seed*` / `npm run db:migrate*` style script in this plan follows the existing pattern: run via `dotenv -e .env.local -- tsx scripts/<name>.ts`, added as a `package.json` script.
- Run `npm run lint`, `npm run test`, and `npm run build` at the end of every task; all three must be clean before moving on.

---

### Task 1: Schema — additive tables + nullable old FK columns

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `scripts/smoke-schema.ts`
- Create: `drizzle/00XX_*.sql` (generated, not hand-written)

**Interfaces:**
- Produces: `composers` table + `ComposerRow` type; `axisTypes` table + `AxisTypeRow` type; `songAxisValues` table + `SongAxisValueRow` type. `songs.regionId`/`rhythmId`/`dromosId` become nullable (still present as columns — dropped only in Task 9).

- [ ] **Step 1: Edit `src/db/schema.ts`**

Add `boolean` and `unique` to the import, add the three new tables and their types, and relax the three FK columns on `songs` to nullable:

```ts
import { pgTable, serial, text, integer, timestamp, boolean, unique } from 'drizzle-orm/pg-core';
```

Change the `songs` table definition (only the three FK lines):

```ts
  regionId: integer('region_id').references(() => regions.id),
  rhythmId: integer('rhythm_id').references(() => rhythms.id),
  dromosId: integer('dromos_id').references(() => dromoi.id),
```

Add after the `genres` table definition (before `songs`):

```ts
export const composers = pgTable('composers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});
```

Add after the `songs` table definition (before `transitionRules` — `transitionRules` itself is untouched in this task, it's removed in Task 9):

```ts
export const axisTypes = pgTable('axis_types', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  label: text('label').notNull(),
  lookupTable: text('lookup_table'),
  hierarchical: boolean('hierarchical').notNull().default(false),
});

export const songAxisValues = pgTable(
  'song_axis_values',
  {
    id: serial('id').primaryKey(),
    songId: integer('song_id').notNull().references(() => songs.id),
    axisType: text('axis_type').notNull().references(() => axisTypes.key),
    refId: integer('ref_id'),
    yearValue: integer('year_value'),
  },
  (table) => ({
    uniqueSongAxis: unique().on(table.songId, table.axisType),
  })
);
```

Add to the type exports at the bottom of the file:

```ts
export type ComposerRow = typeof composers.$inferSelect;
export type AxisTypeRow = typeof axisTypes.$inferSelect;
export type SongAxisValueRow = typeof songAxisValues.$inferSelect;
```

- [ ] **Step 2: Extend `scripts/smoke-schema.ts` to cover the new tables**

Replace the whole file with:

```ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const [region] = await db.insert(schema.regions).values({ name: 'Smoke Region', parentId: null }).returning();
  const [rhythm] = await db.insert(schema.rhythms).values({ name: 'Smoke Rhythm' }).returning();
  const [dromos] = await db.insert(schema.dromoi).values({ name: 'Smoke Dromos' }).returning();
  const [genre] = await db.insert(schema.genres).values({ name: 'Smoke Genre' }).returning();
  const [composer] = await db.insert(schema.composers).values({ name: 'Smoke Composer' }).returning();
  const [axisType] = await db
    .insert(schema.axisTypes)
    .values({ key: 'smoke_axis', label: 'Smoke Axis', lookupTable: null, hierarchical: false })
    .returning();

  const [song] = await db.insert(schema.songs).values({
    title: 'Smoke Song',
    lyrics: 'la la la',
    genreId: genre.id,
  }).returning();

  const [axisValue] = await db
    .insert(schema.songAxisValues)
    .values({ songId: song.id, axisType: axisType.key, refId: null, yearValue: 1950 })
    .returning();

  const [rule] = await db.insert(schema.transitionRules).values({ fromRhythmId: rhythm.id, toRhythmId: rhythm.id }).returning();
  const [session] = await db.insert(schema.sessions).values({ label: 'Smoke Session', currentSongId: song.id }).returning();
  const [played] = await db.insert(schema.sessionPlayedSongs).values({ sessionId: session.id, songId: song.id }).returning();

  if (
    !region.id || !rhythm.id || !dromos.id || !genre.id || !composer.id || !axisType.id ||
    !song.id || !axisValue.id || !rule.id || !session.id || !played.id
  ) {
    throw new Error('One or more inserts did not return an id');
  }

  await db.delete(schema.sessionPlayedSongs).where(eq(schema.sessionPlayedSongs.id, played.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
  await db.delete(schema.transitionRules).where(eq(schema.transitionRules.id, rule.id));
  await db.delete(schema.songAxisValues).where(eq(schema.songAxisValues.id, axisValue.id));
  await db.delete(schema.songs).where(eq(schema.songs.id, song.id));
  await db.delete(schema.axisTypes).where(eq(schema.axisTypes.id, axisType.id));
  await db.delete(schema.composers).where(eq(schema.composers.id, composer.id));
  await db.delete(schema.genres).where(eq(schema.genres.id, genre.id));
  await db.delete(schema.dromoi).where(eq(schema.dromoi.id, dromos.id));
  await db.delete(schema.rhythms).where(eq(schema.rhythms.id, rhythm.id));
  await db.delete(schema.regions).where(eq(schema.regions.id, region.id));

  console.log('Schema smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Generate and run the migration**

```bash
npm run db:generate
```

Expected: a new file under `drizzle/`, e.g. `drizzle/0002_*.sql`, containing `CREATE TABLE "composers"...`, `CREATE TABLE "axis_types"...`, `CREATE TABLE "song_axis_values"...`, and `ALTER TABLE "songs" ALTER COLUMN "region_id" DROP NOT NULL;` (and same for `rhythm_id`, `dromos_id`).

```bash
npm run db:migrate
```

Expected: `Migrations applied successfully`.

- [ ] **Step 4: Run the smoke test**

```bash
npm run db:smoke
```

Expected: `Schema smoke test passed`.

- [ ] **Step 5: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

Expected: all clean (existing `suggestions.test.ts` still passes unchanged — nothing consuming the new tables yet).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts scripts/smoke-schema.ts drizzle/
git commit -m "Add composers/axisTypes/songAxisValues tables, make song FK columns nullable"
```

---

### Task 2: Query layer for the axis-value system

**Files:**
- Create: `src/db/queries/composers.ts`
- Create: `src/db/queries/axisValues.ts`
- Modify: `src/db/queries/regions.ts`
- Modify: `src/db/queries/rhythms.ts`
- Modify: `src/db/queries/dromoi.ts`
- Create: `scripts/verify-axis-queries.ts` (throwaway manual verification, matches existing convention — see Global Constraints)

**Interfaces:**
- Consumes: `composers`, `axisTypes`, `songAxisValues`, `songs` tables from Task 1.
- Produces: `listComposers`, `createComposer`, `updateComposer`, `deleteComposer` (same shape as `queries/genres.ts`). `listAxisTypes(): Promise<AxisTypeRow[]>`, `getAxisValuesForSong(songId: number): Promise<SongAxisValueRow[]>`, `getAxisValuesForSongIds(songIds: number[]): Promise<SongAxisValueRow[]>`, `replaceSongAxisValues(songId: number, values: {axisType: string; refId: number | null; yearValue: number | null}[]): Promise<void>`. These are consumed by Task 5's `queries/songs.ts` rewrite and Task 6's suggestions route.

- [ ] **Step 1: Create `src/db/queries/composers.ts`**

```ts
import { db } from '../client';
import { composers, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { ComposerRow } from '../schema';

export async function listComposers(): Promise<ComposerRow[]> {
  return db.select().from(composers);
}

export async function createComposer(data: { name: string }): Promise<ComposerRow> {
  const rows = await db.insert(composers).values(data).returning();
  return rows[0];
}

export async function updateComposer(id: number, data: { name: string }): Promise<ComposerRow> {
  const rows = await db.update(composers).set(data).where(eq(composers.id, id)).returning();
  return rows[0];
}

export async function deleteComposer(id: number): Promise<void> {
  const [usage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'composer'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (usage) throw new Error('Ο συνθέτης χρησιμοποιείται από τραγούδι');
  await db.delete(composers).where(eq(composers.id, id));
}
```

- [ ] **Step 2: Create `src/db/queries/axisValues.ts`**

```ts
import { db } from '../client';
import { songAxisValues, axisTypes } from '../schema';
import { eq, inArray } from 'drizzle-orm';
import type { SongAxisValueRow, AxisTypeRow } from '../schema';

export async function listAxisTypes(): Promise<AxisTypeRow[]> {
  return db.select().from(axisTypes);
}

export async function getAxisValuesForSong(songId: number): Promise<SongAxisValueRow[]> {
  return db.select().from(songAxisValues).where(eq(songAxisValues.songId, songId));
}

export async function getAxisValuesForSongIds(songIds: number[]): Promise<SongAxisValueRow[]> {
  if (songIds.length === 0) return [];
  return db.select().from(songAxisValues).where(inArray(songAxisValues.songId, songIds));
}

export interface AxisValueInput {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

export async function replaceSongAxisValues(songId: number, values: AxisValueInput[]): Promise<void> {
  await db.delete(songAxisValues).where(eq(songAxisValues.songId, songId));
  if (values.length === 0) return;
  await db.insert(songAxisValues).values(values.map((v) => ({ songId, ...v })));
}
```

- [ ] **Step 3: Rewrite the "used by song" delete-guard in `src/db/queries/regions.ts`**

Replace the whole file:

```ts
import { db } from '../client';
import { regions, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { RegionRow } from '../schema';

export async function listRegions(): Promise<RegionRow[]> {
  return db.select().from(regions);
}

export async function createRegion(data: { name: string; parentId: number | null }): Promise<RegionRow> {
  const rows = await db.insert(regions).values(data).returning();
  return rows[0];
}

export async function updateRegion(id: number, data: { name: string; parentId: number | null }): Promise<RegionRow> {
  const rows = await db.update(regions).set(data).where(eq(regions.id, id)).returning();
  return rows[0];
}

export async function deleteRegion(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'region'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Η περιοχή χρησιμοποιείται από τραγούδι');
  const [childRegion] = await db.select({ id: regions.id }).from(regions).where(eq(regions.parentId, id)).limit(1);
  if (childRegion) throw new Error('Η περιοχή έχει θυγατρικές περιοχές');
  await db.delete(regions).where(eq(regions.id, id));
}
```

- [ ] **Step 4: Rewrite `src/db/queries/rhythms.ts`**

Replace the whole file (drops the `transitionRules` usage check — that concept is gone):

```ts
import { db } from '../client';
import { rhythms, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { RhythmRow } from '../schema';

export async function listRhythms(): Promise<RhythmRow[]> {
  return db.select().from(rhythms);
}

export async function createRhythm(data: { name: string }): Promise<RhythmRow> {
  const rows = await db.insert(rhythms).values(data).returning();
  return rows[0];
}

export async function updateRhythm(id: number, data: { name: string }): Promise<RhythmRow> {
  const rows = await db.update(rhythms).set(data).where(eq(rhythms.id, id)).returning();
  return rows[0];
}

export async function deleteRhythm(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'rhythm'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο ρυθμός χρησιμοποιείται από τραγούδι');
  await db.delete(rhythms).where(eq(rhythms.id, id));
}
```

- [ ] **Step 5: Rewrite `src/db/queries/dromoi.ts`**

Replace the whole file:

```ts
import { db } from '../client';
import { dromoi, songAxisValues } from '../schema';
import { eq, and } from 'drizzle-orm';
import type { DromosRow } from '../schema';

export async function listDromoi(): Promise<DromosRow[]> {
  return db.select().from(dromoi);
}

export async function createDromos(data: { name: string }): Promise<DromosRow> {
  const rows = await db.insert(dromoi).values(data).returning();
  return rows[0];
}

export async function updateDromos(id: number, data: { name: string }): Promise<DromosRow> {
  const rows = await db.update(dromoi).set(data).where(eq(dromoi.id, id)).returning();
  return rows[0];
}

export async function deleteDromos(id: number): Promise<void> {
  const [songUsage] = await db
    .select({ id: songAxisValues.id })
    .from(songAxisValues)
    .where(and(eq(songAxisValues.axisType, 'dromos'), eq(songAxisValues.refId, id)))
    .limit(1);
  if (songUsage) throw new Error('Ο δρόμος χρησιμοποιείται από τραγούδι');
  await db.delete(dromoi).where(eq(dromoi.id, id));
}
```

- [ ] **Step 6: Create `scripts/verify-axis-queries.ts` and run it manually**

```ts
import { createComposer, listComposers, deleteComposer } from '../src/db/queries/composers';
import { replaceSongAxisValues, getAxisValuesForSong, getAxisValuesForSongIds } from '../src/db/queries/axisValues';
import { db } from '../src/db/client';
import { songs, genres } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const [genre] = await db.insert(genres).values({ name: 'Verify Genre' }).returning();
  const [song] = await db.insert(songs).values({ title: 'Verify Song', genreId: genre.id }).returning();

  const composer = await createComposer({ name: 'Verify Composer' });
  if (!(await listComposers()).some((c) => c.id === composer.id)) throw new Error('composer not listed');

  await replaceSongAxisValues(song.id, [
    { axisType: 'composer', refId: composer.id, yearValue: null },
    { axisType: 'year', refId: null, yearValue: 1955 },
  ]);
  const values = await getAxisValuesForSong(song.id);
  if (values.length !== 2) throw new Error(`expected 2 axis values, got ${values.length}`);

  await replaceSongAxisValues(song.id, [{ axisType: 'year', refId: null, yearValue: 1960 }]);
  const replaced = await getAxisValuesForSong(song.id);
  if (replaced.length !== 1 || replaced[0].yearValue !== 1960) throw new Error('replace did not overwrite as expected');

  const bulk = await getAxisValuesForSongIds([song.id]);
  if (bulk.length !== 1) throw new Error('bulk fetch mismatch');

  let deleteGuardTripped = false;
  await replaceSongAxisValues(song.id, [{ axisType: 'composer', refId: composer.id, yearValue: null }]);
  try {
    await deleteComposer(composer.id);
  } catch {
    deleteGuardTripped = true;
  }
  if (!deleteGuardTripped) throw new Error('deleteComposer should have refused while in use');

  await replaceSongAxisValues(song.id, []);
  await deleteComposer(composer.id);
  await db.delete(songs).where(eq(songs.id, song.id));
  await db.delete(genres).where(eq(genres.id, genre.id));

  console.log('Axis query layer verification passed');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `dotenv -e .env.local -- npx tsx scripts/verify-axis-queries.ts`
Expected: `Axis query layer verification passed`. Delete the file afterward — it is a one-off verification script, not a checked-in tool (unlike `smoke-schema.ts`, which is a repeated-use script).

```bash
rm scripts/verify-axis-queries.ts
```

- [ ] **Step 7: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add src/db/queries/composers.ts src/db/queries/axisValues.ts src/db/queries/regions.ts src/db/queries/rhythms.ts src/db/queries/dromoi.ts
git commit -m "Add composers/axisValues query layer; repoint region/rhythm/dromos delete-guards at songAxisValues"
```

---

### Task 3: Seed axis types + migrate existing song data

**Files:**
- Create: `scripts/seed-axis-types.ts`
- Create: `scripts/migrate-axis-values.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `axisTypes`, `songAxisValues` (Task 1 schema), `replaceSongAxisValues` (Task 2).
- Produces: seeded rows in `axis_types` (5 rows: region/rhythm/dromos/composer/year) and `song_axis_values` rows for every existing song's old `regionId`/`rhythmId`/`dromosId`. Task 5 and Task 6 depend on `axis_types` being seeded (they read it to build UI labels and validate `axisType` inputs).

- [ ] **Step 1: Create `scripts/seed-axis-types.ts`**

```ts
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { axisTypes } from '../src/db/schema';

const AXIS_TYPES: { key: string; label: string; lookupTable: string | null; hierarchical: boolean }[] = [
  { key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
  { key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  { key: 'dromos', label: 'Δρόμος', lookupTable: 'dromoi', hierarchical: false },
  { key: 'composer', label: 'Συνθέτης', lookupTable: 'composers', hierarchical: false },
  { key: 'year', label: 'Χρονολογία', lookupTable: null, hierarchical: false },
];

async function main() {
  let created = 0;
  for (const at of AXIS_TYPES) {
    const existing = await db.select().from(axisTypes).where(eq(axisTypes.key, at.key));
    if (existing[0]) continue;
    await db.insert(axisTypes).values(at);
    created++;
  }
  console.log(`Axis types created: ${created}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Create `scripts/migrate-axis-values.ts`**

```ts
import { db } from '../src/db/client';
import { songs } from '../src/db/schema';
import { getAxisValuesForSong, replaceSongAxisValues, type AxisValueInput } from '../src/db/queries/axisValues';

async function main() {
  const allSongs = await db.select().from(songs);
  let migrated = 0;
  let skipped = 0;

  for (const song of allSongs) {
    const existing = await getAxisValuesForSong(song.id);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    const values: AxisValueInput[] = [];
    if (song.regionId !== null) values.push({ axisType: 'region', refId: song.regionId, yearValue: null });
    if (song.rhythmId !== null) values.push({ axisType: 'rhythm', refId: song.rhythmId, yearValue: null });
    if (song.dromosId !== null) values.push({ axisType: 'dromos', refId: song.dromosId, yearValue: null });
    if (values.length === 0) continue;
    await replaceSongAxisValues(song.id, values);
    migrated++;
  }

  console.log(`Songs migrated: ${migrated}`);
  console.log(`Songs skipped (already had axis values): ${skipped}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Add package.json scripts**

In `package.json`, in the `"scripts"` block, add after `"db:seed"`:

```json
    "db:seed:axis-types": "dotenv -e .env.local -- tsx scripts/seed-axis-types.ts",
    "db:migrate-axis-values": "dotenv -e .env.local -- tsx scripts/migrate-axis-values.ts"
```

- [ ] **Step 4: Run both scripts against the dev DB**

```bash
npm run db:seed:axis-types
```
Expected: `Axis types created: 5` (or fewer if re-run — idempotent).

```bash
npm run db:migrate-axis-values
```
Expected: `Songs migrated: 450` (or whatever the current total song count is), `Songs skipped (already had axis values): 0`. Re-running it must print `Songs migrated: 0`, `Songs skipped (already had axis values): 450` — confirming idempotency.

- [ ] **Step 5: Spot-check row counts**

```bash
dotenv -e .env.local -- npx tsx -e "
import { db } from './src/db/client';
import { songAxisValues } from './src/db/schema';
db.select().from(songAxisValues).then((rows) => console.log('song_axis_values rows:', rows.length));
"
```
Expected: roughly 3× the total song count (one row each for region/rhythm/dromos per migrated song).

- [ ] **Step 6: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-axis-types.ts scripts/migrate-axis-values.ts package.json
git commit -m "Add axis-type seed and one-time migration of existing song FK data into song_axis_values"
```

---

### Task 4: Rewrite the suggestion engine for dynamic axes

**Files:**
- Modify: `src/lib/suggestions.ts`
- Modify: `src/lib/suggestions.test.ts`

**Interfaces:**
- Consumes: `SongRow`, `RegionRow` from `@/db/schema` (only `id`/`title`/`genreId` from `SongRow` are used — `regionId`/`rhythmId`/`dromosId` on `SongRow` are ignored even though the columns still exist on the type until Task 9).
- Produces: `AxisValue` type, `getRegionAncestorIds`, `getRegionDescendantIds`, `regionMatchesFilter`, `getFilteredCandidates`, `rankBySharedAxes`, `groupByGenre`, `getSuggestions` (new signature). Consumed by Task 6's suggestions API route.

- [ ] **Step 1: Write the new `src/lib/suggestions.ts` (replace the whole file)**

```ts
import type { SongRow, RegionRow } from '@/db/schema';

export interface AxisValue {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

export interface SongWithAxes {
  song: SongRow;
  axisValues: AxisValue[];
}

function axisValueMap(axisValues: AxisValue[]): Map<string, AxisValue> {
  return new Map(axisValues.map((v) => [v.axisType, v]));
}

function axisValuesMatch(a: AxisValue, b: AxisValue): boolean {
  if (a.axisType === 'year') return a.yearValue === b.yearValue;
  return a.refId === b.refId;
}

export function getRegionAncestorIds(regionId: number, regions: RegionRow[]): number[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const ancestors: number[] = [];
  let current = byId.get(regionId);
  while (current && current.parentId !== null) {
    ancestors.push(current.parentId);
    current = byId.get(current.parentId);
  }
  return ancestors;
}

export function getRegionDescendantIds(regionId: number, regions: RegionRow[]): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const r of regions) {
    if (r.parentId !== null) {
      const list = childrenByParent.get(r.parentId) ?? [];
      list.push(r.id);
      childrenByParent.set(r.parentId, list);
    }
  }
  const result: number[] = [];
  const stack = [...(childrenByParent.get(regionId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    result.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

export function regionMatchesFilter(candidateRegionId: number, currentRegionId: number, regions: RegionRow[]): boolean {
  if (candidateRegionId === currentRegionId) return true;
  if (getRegionAncestorIds(currentRegionId, regions).includes(candidateRegionId)) return true;
  return getRegionDescendantIds(currentRegionId, regions).includes(candidateRegionId);
}

export interface FilteredCandidatesParams {
  currentSongId: number;
  currentAxisValues: AxisValue[];
  activeAxisTypes: Set<string>;
  allSongs: SongWithAxes[];
  regions: RegionRow[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
}

export function getFilteredCandidates(params: FilteredCandidatesParams): SongWithAxes[] {
  const { currentSongId, currentAxisValues, activeAxisTypes, allSongs, regions, playedSongIds, showPlayed } = params;
  const currentMap = axisValueMap(currentAxisValues);

  return allSongs
    .filter(({ song }) => song.id !== currentSongId)
    .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
    .filter(({ axisValues }) => {
      const candidateMap = axisValueMap(axisValues);
      for (const axisType of activeAxisTypes) {
        const currentValue = currentMap.get(axisType);
        if (!currentValue) continue;
        const candidateValue = candidateMap.get(axisType);
        if (!candidateValue) return false;
        if (axisType === 'region' && currentValue.refId !== null && candidateValue.refId !== null) {
          if (!regionMatchesFilter(candidateValue.refId, currentValue.refId, regions)) return false;
        } else if (!axisValuesMatch(currentValue, candidateValue)) {
          return false;
        }
      }
      return true;
    });
}

export function rankBySharedAxes(
  candidates: SongWithAxes[],
  currentAxisValues: AxisValue[],
  activeAxisTypes: Set<string>
): SongRow[] {
  const currentMap = axisValueMap(currentAxisValues);
  const inactiveSharedTypes = [...currentMap.keys()].filter((t) => !activeAxisTypes.has(t));

  function score(axisValues: AxisValue[]): number {
    const candidateMap = axisValueMap(axisValues);
    let total = 0;
    for (const axisType of inactiveSharedTypes) {
      const candidateValue = candidateMap.get(axisType);
      if (candidateValue && axisValuesMatch(currentMap.get(axisType)!, candidateValue)) total += 1;
    }
    return total;
  }

  return [...candidates]
    .sort((a, b) => {
      const diff = score(b.axisValues) - score(a.axisValues);
      if (diff !== 0) return diff;
      return a.song.title.localeCompare(b.song.title, 'el');
    })
    .map((c) => c.song);
}

export interface GenreGroup {
  genreId: number;
  songs: SongRow[];
}

export function groupByGenre(songs: SongRow[]): GenreGroup[] {
  const byGenre = new Map<number, SongRow[]>();
  for (const song of songs) {
    const list = byGenre.get(song.genreId) ?? [];
    list.push(song);
    byGenre.set(song.genreId, list);
  }
  return [...byGenre.entries()].map(([genreId, groupSongs]) => ({
    genreId,
    songs: [...groupSongs].sort((a, b) => a.title.localeCompare(b.title, 'el')),
  }));
}

export interface SuggestionParams {
  currentSongId: number;
  currentAxisValues: AxisValue[];
  activeAxisTypes: Set<string>;
  allSongs: SongWithAxes[];
  regions: RegionRow[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
}

export type SuggestionResult =
  | { mode: 'filtered'; candidates: SongRow[] }
  | { mode: 'grouped'; genreGroups: GenreGroup[] };

export function getSuggestions(params: SuggestionParams): SuggestionResult {
  const { currentSongId, currentAxisValues, activeAxisTypes, allSongs, regions, playedSongIds, showPlayed } = params;

  if (activeAxisTypes.size === 0) {
    const visible = allSongs
      .filter(({ song }) => song.id !== currentSongId)
      .filter(({ song }) => showPlayed || !playedSongIds.has(song.id))
      .map(({ song }) => song);
    return { mode: 'grouped', genreGroups: groupByGenre(visible) };
  }

  const filtered = getFilteredCandidates({
    currentSongId,
    currentAxisValues,
    activeAxisTypes,
    allSongs,
    regions,
    playedSongIds,
    showPlayed,
  });
  return { mode: 'filtered', candidates: rankBySharedAxes(filtered, currentAxisValues, activeAxisTypes) };
}
```

- [ ] **Step 2: Write the new `src/lib/suggestions.test.ts` (replace the whole file)**

```ts
import { describe, it, expect } from 'vitest';
import {
  getRegionAncestorIds,
  getRegionDescendantIds,
  regionMatchesFilter,
  getFilteredCandidates,
  rankBySharedAxes,
  groupByGenre,
  getSuggestions,
  type AxisValue,
  type SongWithAxes,
} from './suggestions';
import type { SongRow, RegionRow } from '@/db/schema';

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

function av(axisType: string, refId: number | null, yearValue: number | null = null): AxisValue {
  return { axisType, refId, yearValue };
}

// Region tree: Νησιά(1) -> Νησιά Αιγαίου(2) -> Κυκλάδες(3) -> Νάξος(4) -> Απείρανθος(5)
//              Νησιά(1) -> Κύθηρα(6)
const regions: RegionRow[] = [
  { id: 1, name: 'Νησιά', parentId: null },
  { id: 2, name: 'Νησιά Αιγαίου', parentId: 1 },
  { id: 3, name: 'Κυκλάδες', parentId: 2 },
  { id: 4, name: 'Νάξος', parentId: 3 },
  { id: 5, name: 'Απείρανθος', parentId: 4 },
  { id: 6, name: 'Κύθηρα', parentId: 1 },
];

describe('getRegionAncestorIds', () => {
  it('walks up the parent chain to the root', () => {
    expect(getRegionAncestorIds(5, regions)).toEqual([4, 3, 2, 1]);
  });

  it('returns an empty array for a root region', () => {
    expect(getRegionAncestorIds(1, regions)).toEqual([]);
  });
});

describe('getRegionDescendantIds', () => {
  it('collects all descendants at any depth', () => {
    expect(getRegionDescendantIds(2, regions).sort()).toEqual([3, 4, 5]);
  });

  it('returns an empty array for a leaf region', () => {
    expect(getRegionDescendantIds(5, regions)).toEqual([]);
  });
});

describe('regionMatchesFilter', () => {
  it('matches the exact same region', () => {
    expect(regionMatchesFilter(4, 4, regions)).toBe(true);
  });

  it('matches a broader ancestor region', () => {
    expect(regionMatchesFilter(1, 5, regions)).toBe(true); // candidate tagged broadly "Νησιά", current is narrow "Απείρανθος"
  });

  it('matches a narrower descendant region', () => {
    expect(regionMatchesFilter(5, 1, regions)).toBe(true); // candidate tagged narrowly, current is broad
  });

  it('does not match an unrelated branch', () => {
    expect(regionMatchesFilter(6, 5, regions)).toBe(false); // Κύθηρα vs Απείρανθος share only the "Νησιά" great-ancestor via Νησιά(1), but 6's parent is 1 directly, not on the Απείρανθος branch
  });
});

describe('getFilteredCandidates', () => {
  const current: SongWithAxes = {
    song: makeSong(1, 'Current'),
    axisValues: [av('rhythm', 10), av('region', 4), av('dromos', 100)],
  };
  const rhythmMatch: SongWithAxes = { song: makeSong(2, 'Rhythm match'), axisValues: [av('rhythm', 10), av('region', 99), av('dromos', 200)] };
  const rhythmMismatch: SongWithAxes = { song: makeSong(3, 'Rhythm mismatch'), axisValues: [av('rhythm', 20)] };
  const noRhythmAxis: SongWithAxes = { song: makeSong(4, 'No rhythm axis'), axisValues: [av('composer', 1)] };
  const allSongs = [current, rhythmMatch, rhythmMismatch, noRhythmAxis];

  it('excludes the current song', () => {
    const result = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.some((c) => c.song.id === 1)).toBe(false);
  });

  it('AND-filters on every active axis, excluding songs missing the axis entirely', () => {
    const result = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.map((c) => c.song.id).sort()).toEqual([2]);
  });

  it('region filtering is ancestor/descendant inclusive', () => {
    const broadCandidate: SongWithAxes = { song: makeSong(5, 'Broad region'), axisValues: [av('region', 1)] };
    const result = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: [av('region', 4)], activeAxisTypes: new Set(['region']),
      allSongs: [current, broadCandidate], regions, playedSongIds: new Set(), showPlayed: false,
    });
    expect(result.map((c) => c.song.id)).toEqual([5]);
  });

  it('excludes already-played songs unless showPlayed is true', () => {
    const hidden = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set([2]), showPlayed: false,
    });
    expect(hidden.some((c) => c.song.id === 2)).toBe(false);

    const shown = getFilteredCandidates({
      currentSongId: 1, currentAxisValues: current.axisValues, activeAxisTypes: new Set(['rhythm']),
      allSongs, regions, playedSongIds: new Set([2]), showPlayed: true,
    });
    expect(shown.some((c) => c.song.id === 2)).toBe(true);
  });
});

describe('rankBySharedAxes', () => {
  const currentAxisValues: AxisValue[] = [av('rhythm', 10), av('region', 4), av('dromos', 100)];

  it('ranks candidates higher when they share inactive-but-present axes', () => {
    const bothShared: SongWithAxes = { song: makeSong(2, 'Both shared'), axisValues: [av('rhythm', 10), av('region', 4), av('dromos', 100)] };
    const oneShared: SongWithAxes = { song: makeSong(3, 'One shared'), axisValues: [av('rhythm', 10), av('region', 999), av('dromos', 100)] };
    const noneShared: SongWithAxes = { song: makeSong(4, 'None shared'), axisValues: [av('rhythm', 10), av('region', 999), av('dromos', 999)] };

    const result = rankBySharedAxes([noneShared, oneShared, bothShared], currentAxisValues, new Set(['rhythm']));
    expect(result.map((s) => s.id)).toEqual([2, 3, 4]);
  });

  it('breaks ties alphabetically by title', () => {
    const b: SongWithAxes = { song: makeSong(2, 'Beta'), axisValues: [] };
    const a: SongWithAxes = { song: makeSong(3, 'Alpha'), axisValues: [] };
    const result = rankBySharedAxes([b, a], currentAxisValues, new Set(['rhythm']));
    expect(result.map((s) => s.title)).toEqual(['Alpha', 'Beta']);
  });
});

describe('groupByGenre', () => {
  it('groups songs by genreId and sorts titles alphabetically within each group', () => {
    const songs = [makeSong(1, 'Ζήτα', 5), makeSong(2, 'Άλφα', 5), makeSong(3, 'Βήτα', 9)];
    const groups = groupByGenre(songs);
    const genre5 = groups.find((g) => g.genreId === 5)!;
    const genre9 = groups.find((g) => g.genreId === 9)!;
    expect(genre5.songs.map((s) => s.title)).toEqual(['Άλφα', 'Ζήτα']);
    expect(genre9.songs.map((s) => s.title)).toEqual(['Βήτα']);
  });
});

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

- [ ] **Step 3: Run the tests**

```bash
npm run test
```
Expected: all tests in `suggestions.test.ts` pass. Double-check the `regionMatchesFilter` "does not match an unrelated branch" case by hand against the tree comment above before trusting a green run — it is the one case worth eyeballing.

- [ ] **Step 4: Verify lint/build**

```bash
npm run lint
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/suggestions.ts src/lib/suggestions.test.ts
git commit -m "Rewrite suggestion engine around dynamic active axes, ancestor/descendant region matching, and genre-grouped fallback"
```

---

### Task 5: Songs/composers/axis-types API layer

**Files:**
- Modify: `src/db/queries/songs.ts`
- Modify: `src/app/api/songs/route.ts`
- Modify: `src/app/api/songs/[id]/route.ts`
- Create: `src/app/api/composers/route.ts`
- Create: `src/app/api/composers/[id]/route.ts`
- Create: `src/app/api/axis-types/route.ts`

**Interfaces:**
- Consumes: `replaceSongAxisValues`, `getAxisValuesForSong` (Task 2), `listComposers`/`createComposer`/`updateComposer`/`deleteComposer` (Task 2), `listAxisTypes` (Task 2).
- Produces: `getSongWithAxisValues(id)` returning `SongRow & { axisValues: SongAxisValueRow[] }`, consumed by Task 7's admin edit form and Task 6's suggestions route. `POST/PATCH /api/songs` now accept `{ title, lyrics, genreId, notes, axisValues: {axisType, refId, yearValue}[] }` instead of fixed `regionId`/`rhythmId`/`dromosId`.

- [ ] **Step 1: Rewrite `src/db/queries/songs.ts`**

Replace the whole file:

```ts
import { db } from '../client';
import { songs, sessionPlayedSongs, sessions } from '../schema';
import { eq, ilike, and, type SQL } from 'drizzle-orm';
import type { SongRow, SongAxisValueRow } from '../schema';
import { replaceSongAxisValues, getAxisValuesForSong, type AxisValueInput } from './axisValues';

export interface SongFilters {
  search?: string;
  genreId?: number;
}

export async function listSongs(filters: SongFilters = {}): Promise<SongRow[]> {
  const conditions: SQL[] = [];
  if (filters.search) conditions.push(ilike(songs.title, `%${filters.search}%`));
  if (filters.genreId) conditions.push(eq(songs.genreId, filters.genreId));

  if (conditions.length === 0) return db.select().from(songs);
  return db.select().from(songs).where(and(...conditions));
}

export async function getSongById(id: number): Promise<SongRow | undefined> {
  const rows = await db.select().from(songs).where(eq(songs.id, id));
  return rows[0];
}

export interface SongWithAxisValues extends SongRow {
  axisValues: SongAxisValueRow[];
}

export async function getSongWithAxisValues(id: number): Promise<SongWithAxisValues | undefined> {
  const song = await getSongById(id);
  if (!song) return undefined;
  const axisValues = await getAxisValuesForSong(id);
  return { ...song, axisValues };
}

export interface SongInput {
  title: string;
  lyrics: string | null;
  genreId: number;
  notes: string | null;
  axisValues: AxisValueInput[];
}

export async function createSong(data: SongInput): Promise<SongRow> {
  const rows = await db
    .insert(songs)
    .values({ title: data.title, lyrics: data.lyrics, genreId: data.genreId, notes: data.notes })
    .returning();
  const song = rows[0];
  await replaceSongAxisValues(song.id, data.axisValues);
  return song;
}

export async function updateSong(id: number, data: SongInput): Promise<SongRow> {
  const rows = await db
    .update(songs)
    .set({ title: data.title, lyrics: data.lyrics, genreId: data.genreId, notes: data.notes, updatedAt: new Date() })
    .where(eq(songs.id, id))
    .returning();
  await replaceSongAxisValues(id, data.axisValues);
  return rows[0];
}

export async function deleteSong(id: number): Promise<void> {
  const [playedUsage] = await db.select({ id: sessionPlayedSongs.id }).from(sessionPlayedSongs).where(eq(sessionPlayedSongs.songId, id)).limit(1);
  if (playedUsage) throw new Error('Το τραγούδι έχει παιχτεί σε κάποιο session και δεν μπορεί να διαγραφεί');
  const [currentUsage] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.currentSongId, id)).limit(1);
  if (currentUsage) throw new Error('Το τραγούδι είναι το τρέχον τραγούδι ενός ενεργού session');
  await db.delete(songs).where(eq(songs.id, id));
}
```

- [ ] **Step 2: Rewrite `src/app/api/songs/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listSongs, createSong } from '@/db/queries/songs';

const axisValueSchema = z.object({
  axisType: z.enum(['region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const createSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  genreId: z.number().int(),
  notes: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const songs = await listSongs({
    search: params.get('search') ?? undefined,
    genreId: params.get('genreId') ? Number(params.get('genreId')) : undefined,
  });
  return NextResponse.json(songs);
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await createSong(parsed.data);
  return NextResponse.json(song, { status: 201 });
}
```

- [ ] **Step 3: Rewrite `src/app/api/songs/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSongWithAxisValues, updateSong, deleteSong } from '@/db/queries/songs';

const axisValueSchema = z.object({
  axisType: z.enum(['region', 'rhythm', 'dromos', 'composer', 'year']),
  refId: z.number().int().nullable(),
  yearValue: z.number().int().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1),
  lyrics: z.string().nullable(),
  genreId: z.number().int(),
  notes: z.string().nullable(),
  axisValues: z.array(axisValueSchema),
});

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const song = await getSongWithAxisValues(Number(id));
  if (!song) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });
  return NextResponse.json(song);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const song = await updateSong(Number(id), parsed.data);
  return NextResponse.json(song);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteSong(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
```

- [ ] **Step 4: Create `src/app/api/composers/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listComposers, createComposer } from '@/db/queries/composers';

const createSchema = z.object({ name: z.string().min(1) });

export async function GET() {
  return NextResponse.json(await listComposers());
}

export async function POST(request: NextRequest) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const composer = await createComposer(parsed.data);
  return NextResponse.json(composer, { status: 201 });
}
```

- [ ] **Step 5: Create `src/app/api/composers/[id]/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { updateComposer, deleteComposer } from '@/db/queries/composers';

const updateSchema = z.object({ name: z.string().min(1) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const composer = await updateComposer(Number(id), parsed.data);
  return NextResponse.json(composer);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteComposer(Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
}
```

- [ ] **Step 6: Create `src/app/api/axis-types/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { listAxisTypes } from '@/db/queries/axisValues';

export async function GET() {
  return NextResponse.json(await listAxisTypes());
}
```

- [ ] **Step 7: Manual verification against the dev server**

```bash
npm run dev &
sleep 2
curl -s http://localhost:3000/api/axis-types | head -c 300
curl -s -X POST http://localhost:3000/api/composers -H "Content-Type: application/json" -d '{"name":"Verify Composer"}'
kill %1
```
Expected: the axis-types call returns the 5 seeded rows; the composer POST returns a 201 with an id. Delete the test composer afterward via `DELETE /api/composers/<id>` or the admin UI once Task 7 exists.

- [ ] **Step 8: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add src/db/queries/songs.ts src/app/api/songs src/app/api/composers src/app/api/axis-types
git commit -m "Rewrite songs API around axisValues payload; add composers and axis-types API routes"
```

---

### Task 6: Suggestions API route rewrite

**Files:**
- Modify: `src/app/api/sessions/[id]/suggestions/route.ts`

**Interfaces:**
- Consumes: `getSongWithAxisValues`, `listSongs` (Task 5), `getAxisValuesForSongIds`, `listAxisTypes` (Task 2), `listRegions`/`listRhythms`/`listDromoi`/`listComposers`/`listGenres` (existing + Task 2), `getSuggestions`/`AxisValue` (Task 4).
- Produces: the JSON contract consumed by Task 8's session page — see response shape in Step 1.

- [ ] **Step 1: Rewrite `src/app/api/sessions/[id]/suggestions/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, getPlayedSongIds } from '@/db/queries/sessions';
import { listSongs, getSongWithAxisValues } from '@/db/queries/songs';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listAxisTypes, getAxisValuesForSongIds } from '@/db/queries/axisValues';
import { listGenres } from '@/db/queries/genres';
import { getSuggestions, type AxisValue, type SongWithAxes } from '@/lib/suggestions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });

  const showPlayed = request.nextUrl.searchParams.get('showPlayed') === 'true';
  const hasActiveParam = request.nextUrl.searchParams.has('activeAxisTypes');
  const requestedActive = new Set(
    (request.nextUrl.searchParams.get('activeAxisTypes') ?? '').split(',').filter(Boolean)
  );

  if (session.currentSongId === null) {
    return NextResponse.json({
      currentSong: null,
      availableAxisTypes: [],
      activeAxisTypes: [],
      mode: 'grouped',
      candidates: [],
      genreGroups: [],
      listTitle: '',
    });
  }

  const [allSongs, regions, rhythms, dromoi, composers, axisTypes, genres, playedSongIdList, currentSongWithAxes] =
    await Promise.all([
      listSongs(),
      listRegions(),
      listRhythms(),
      listDromoi(),
      listComposers(),
      listAxisTypes(),
      listGenres(),
      getPlayedSongIds(sessionId),
      getSongWithAxisValues(session.currentSongId),
    ]);

  if (!currentSongWithAxes) return NextResponse.json({ error: 'Το τρέχον τραγούδι δεν βρέθηκε' }, { status: 500 });

  const allAxisValues = await getAxisValuesForSongIds(allSongs.map((s) => s.id));
  const axisValuesBySong = new Map<number, AxisValue[]>();
  for (const av of allAxisValues) {
    const list = axisValuesBySong.get(av.songId) ?? [];
    list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
    axisValuesBySong.set(av.songId, list);
  }
  const songsWithAxes: SongWithAxes[] = allSongs.map((song) => ({
    song,
    axisValues: axisValuesBySong.get(song.id) ?? [],
  }));

  const currentAxisValues: AxisValue[] = currentSongWithAxes.axisValues.map((v) => ({
    axisType: v.axisType,
    refId: v.refId,
    yearValue: v.yearValue,
  }));
  const availableAxisTypeKeys = currentAxisValues.map((v) => v.axisType);
  const effectiveActive = hasActiveParam
    ? new Set([...requestedActive].filter((t) => availableAxisTypeKeys.includes(t)))
    : new Set(availableAxisTypeKeys);

  const lookupNameById: Record<string, Map<number, string>> = {
    region: new Map(regions.map((r) => [r.id, r.name])),
    rhythm: new Map(rhythms.map((r) => [r.id, r.name])),
    dromos: new Map(dromoi.map((d) => [d.id, d.name])),
    composer: new Map(composers.map((c) => [c.id, c.name])),
  };
  const axisLabelByKey = new Map(axisTypes.map((t) => [t.key, t.label]));
  const genreNameById = new Map(genres.map((g) => [g.id, g.name]));

  function labelForAxisValue(v: AxisValue): string {
    if (v.axisType === 'year') return String(v.yearValue);
    const name = v.refId !== null ? lookupNameById[v.axisType]?.get(v.refId) : undefined;
    return name ?? '?';
  }

  const playedSet = new Set(playedSongIdList);
  const toSuggestion = (id: number, title: string) => ({ id, title, played: playedSet.has(id) });

  const result = getSuggestions({
    currentSongId: session.currentSongId,
    currentAxisValues,
    activeAxisTypes: effectiveActive,
    allSongs: songsWithAxes,
    regions,
    playedSongIds: playedSet,
    showPlayed,
  });

  const availableAxisTypes = currentAxisValues.map((v) => ({
    key: v.axisType,
    label: axisLabelByKey.get(v.axisType) ?? v.axisType,
    value: labelForAxisValue(v),
  }));

  if (result.mode === 'grouped') {
    return NextResponse.json({
      currentSong: { id: currentSongWithAxes.id, title: currentSongWithAxes.title, lyrics: currentSongWithAxes.lyrics },
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
    });
  }

  const activeLabels = [...effectiveActive].map((key) => axisLabelByKey.get(key) ?? key);
  return NextResponse.json({
    currentSong: { id: currentSongWithAxes.id, title: currentSongWithAxes.title, lyrics: currentSongWithAxes.lyrics },
    availableAxisTypes,
    activeAxisTypes: [...effectiveActive],
    mode: 'filtered',
    candidates: result.candidates.map((s) => toSuggestion(s.id, s.title)),
    genreGroups: [],
    listTitle: `Άλλα τραγούδια με ίδιο ${activeLabels.join(', ')}`,
  });
}
```

- [ ] **Step 2: Manual verification against the dev server**

Requires an existing session with a current song set (use the admin UI / `/session/new` flow, or reuse an existing one from earlier in this project).

```bash
npm run dev &
sleep 2
curl -s "http://localhost:3000/api/sessions/1/suggestions" | head -c 800
curl -s "http://localhost:3000/api/sessions/1/suggestions?activeAxisTypes=" | head -c 800
kill %1
```
Expected: first call (no `activeAxisTypes` param) returns `mode: "filtered"` with `activeAxisTypes` equal to all axes the current song has (default-all-ON). Second call (`activeAxisTypes=` explicitly empty) returns `mode: "grouped"` with `genreGroups` populated.

- [ ] **Step 3: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sessions/\[id\]/suggestions/route.ts
git commit -m "Rewrite suggestions API route around dynamic active axes and genre-grouped fallback"
```

---

### Task 7: Admin UI — composers page, dynamic song tag editor, nav cleanup

**Files:**
- Create: `src/components/SongAxisEditor.tsx`
- Create: `src/app/admin/composers/page.tsx`
- Modify: `src/app/admin/songs/new/page.tsx`
- Modify: `src/app/admin/songs/[id]/page.tsx`
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: `/api/axis-types`, `/api/regions`, `/api/rhythms`, `/api/dromoi`, `/api/composers` (Task 5/existing), `/api/songs`, `/api/songs/[id]` (Task 5, now returning `axisValues`).
- Produces: `SongAxisEditor` component with `{ value: AxisValueEntry[]; onChange: (v: AxisValueEntry[]) => void }` props, reused by both song admin pages.

- [ ] **Step 1: Create `src/components/SongAxisEditor.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';

interface AxisType {
  id: number;
  key: string;
  label: string;
  lookupTable: string | null;
  hierarchical: boolean;
}

interface Option {
  id: number;
  name: string;
}

export interface AxisValueEntry {
  axisType: string;
  refId: number | null;
  yearValue: number | null;
}

const LOOKUP_ENDPOINTS: Record<string, string> = {
  regions: '/api/regions',
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
  const [newAxisType, setNewAxisType] = useState('');
  const [newRefId, setNewRefId] = useState('');
  const [newYear, setNewYear] = useState('');

  useEffect(() => {
    fetch('/api/axis-types')
      .then((r) => r.json())
      .then(async (types: AxisType[]) => {
        setAxisTypes(types);
        const entries = await Promise.all(
          types
            .filter((t) => t.lookupTable)
            .map(async (t) => {
              const res = await fetch(LOOKUP_ENDPOINTS[t.lookupTable as string]);
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

  return (
    <div className="flex flex-col gap-2 border p-3">
      <span className="text-sm font-semibold text-gray-600">Άξονες / Tags</span>
      <ul className="flex flex-col gap-1">
        {value.map((entry) => (
          <li key={entry.axisType} className="flex items-center gap-2">
            <span>{labelFor(entry)}</span>
            <button type="button" onClick={() => handleRemove(entry.axisType)} className="text-red-600 text-sm">
              Αφαίρεση
            </button>
          </li>
        ))}
        {value.length === 0 && <li className="text-sm text-gray-400">Κανένας άξονας ακόμη</li>}
      </ul>
      {availableAxisTypes.length > 0 && (
        <div className="flex gap-2 items-center flex-wrap">
          <select
            value={newAxisType}
            onChange={(e) => {
              setNewAxisType(e.target.value);
              setNewRefId('');
              setNewYear('');
            }}
            className="border p-2"
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
              className="border p-2 w-28"
            />
          )}
          {selectedType && selectedType.key !== 'year' && (
            <select value={newRefId} onChange={(e) => setNewRefId(e.target.value)} className="border p-2">
              <option value="">Τιμή...</option>
              {(optionsByAxis[selectedType.key] ?? []).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          {selectedType && (
            <button type="button" onClick={handleAdd} className="border p-2 bg-blue-600 text-white">
              Προσθήκη
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/admin/composers/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';

interface Composer {
  id: number;
  name: string;
}

export default function ComposersAdminPage() {
  const [composers, setComposers] = useState<Composer[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/composers');
    setComposers(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/composers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας συνθέτη');
      return;
    }
    setName('');
    await load();
  }

  async function handleDelete(id: number) {
    setError(null);
    const res = await fetch(`/api/composers/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error);
      return;
    }
    await load();
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Συνθέτες</h1>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <form onSubmit={handleCreate} className="flex gap-2 mb-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Όνομα συνθέτη" className="border p-2" required />
        <button type="submit" className="border p-2 bg-blue-600 text-white">Προσθήκη</button>
      </form>
      <ul>
        {composers.map((c) => (
          <li key={c.id} className="flex gap-2 items-center py-1">
            <span>{c.name}</span>
            <button onClick={() => handleDelete(c.id)} className="text-red-600">Διαγραφή</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/admin/songs/new/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';

interface Option {
  id: number;
  name: string;
}

export default function NewSongPage() {
  const router = useRouter();
  const [genres, setGenres] = useState<Option[]>([]);
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [genreId, setGenreId] = useState('');
  const [notes, setNotes] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/genres').then((r) => r.json()).then(setGenres);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        lyrics: lyrics || null,
        genreId: Number(genreId),
        notes: notes || null,
        axisValues,
      }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Νέο τραγούδι</h1>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-2xl">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Τίτλος" className="border p-2" required />
        <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Στίχοι (προαιρετικό, μπορούν να προστεθούν αργότερα)" className="border p-2 h-48" />
        <select value={genreId} onChange={(e) => setGenreId(e.target.value)} className="border p-2" required>
          <option value="">Είδος...</option>
          {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <SongAxisEditor value={axisValues} onChange={setAxisValues} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="border p-2" />
        <button type="submit" className="border p-2 bg-blue-600 text-white">Αποθήκευση</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/app/admin/songs/[id]/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';

interface Option {
  id: number;
  name: string;
}

export default function EditSongPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [genres, setGenres] = useState<Option[]>([]);

  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [genreId, setGenreId] = useState('');
  const [notes, setNotes] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/genres').then((r) => r.json()).then(setGenres);
    fetch(`/api/songs/${params.id}`).then((r) => r.json()).then((song) => {
      setTitle(song.title);
      setLyrics(song.lyrics ?? '');
      setGenreId(String(song.genreId));
      setNotes(song.notes ?? '');
      setAxisValues(
        song.axisValues.map((v: { axisType: string; refId: number | null; yearValue: number | null }) => ({
          axisType: v.axisType,
          refId: v.refId,
          yearValue: v.yearValue,
        }))
      );
    });
  }, [params.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/songs/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        lyrics: lyrics || null,
        genreId: Number(genreId),
        notes: notes || null,
        axisValues,
      }),
    });
    if (!res.ok) {
      setError('Αποτυχία ενημέρωσης τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  async function handleDelete() {
    setError(null);
    const res = await fetch(`/api/songs/${params.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error);
      return;
    }
    router.push('/admin/songs');
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Επεξεργασία τραγουδιού</h1>
      {error && <p className="text-red-600 mb-2">{error}</p>}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 max-w-2xl">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Τίτλος" className="border p-2" required />
        <textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Στίχοι (προαιρετικό, μπορούν να προστεθούν αργότερα)" className="border p-2 h-48" />
        <select value={genreId} onChange={(e) => setGenreId(e.target.value)} className="border p-2" required>
          <option value="">Είδος...</option>
          {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <SongAxisEditor value={axisValues} onChange={setAxisValues} />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="border p-2" />
        <div className="flex gap-2">
          <button type="submit" className="border p-2 bg-blue-600 text-white">Αποθήκευση</button>
          <button type="button" onClick={handleDelete} className="border p-2 text-red-600">Διαγραφή</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Update `src/app/admin/layout.tsx` nav**

```tsx
import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <nav className="flex flex-wrap gap-4 p-4 bg-gray-100 border-b">
        <Link href="/admin/songs">Τραγούδια</Link>
        <Link href="/admin/regions">Περιοχές</Link>
        <Link href="/admin/rhythms">Ρυθμοί</Link>
        <Link href="/admin/dromoi">Δρόμοι</Link>
        <Link href="/admin/composers">Συνθέτες</Link>
        <Link href="/admin/genres">Είδη</Link>
        <Link href="/" className="ml-auto">Αρχική</Link>
      </nav>
      <main className="p-4">{children}</main>
    </div>
  );
}
```

(The `/admin/transition-rules` link is removed here; the page itself is deleted in Task 9 along with the table it manages.)

- [ ] **Step 6: Manual check in the browser**

```bash
npm run dev
```
Open `/admin/composers` — create and delete a composer. Open `/admin/songs/new` — add a Region, a Rhythm, and a Year tag to a test song, save, then reopen it via `/admin/songs/<id>` and confirm all three tags are pre-populated with the correct human-readable labels.

- [ ] **Step 7: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/components/SongAxisEditor.tsx src/app/admin/composers src/app/admin/songs src/app/admin/layout.tsx
git commit -m "Add composers admin page and dynamic axis-tag editor to song admin forms"
```

---

### Task 8: Live session UI — dynamic toggles and single list

**Files:**
- Modify: `src/app/session/[id]/page.tsx`

**Interfaces:**
- Consumes: the `/api/sessions/[id]/suggestions` contract from Task 6 (`currentSong`, `availableAxisTypes`, `activeAxisTypes`, `mode`, `candidates`, `genreGroups`, `listTitle`).

**Note:** this replaces the earlier three-parallel-list layout (and its "Πλαϊνά/Πάνω-κάτω" arrangement toggle) with a single dynamically-titled list, per the design — there is now only one list to arrange, so the layout toggle is removed along with it.

- [ ] **Step 1: Rewrite `src/app/session/[id]/page.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import SongPicker from '@/components/SongPicker';

interface CurrentSong {
  id: number;
  title: string;
  lyrics: string | null;
}

interface AvailableAxis {
  key: string;
  label: string;
  value: string;
}

interface SuggestedSong {
  id: number;
  title: string;
  played: boolean;
}

interface GenreGroup {
  genreId: number;
  genreName: string;
  songs: SuggestedSong[];
}

interface SuggestionsResponse {
  currentSong: CurrentSong | null;
  availableAxisTypes: AvailableAxis[];
  activeAxisTypes: string[];
  mode: 'filtered' | 'grouped';
  candidates: SuggestedSong[];
  genreGroups: GenreGroup[];
  listTitle: string;
}

function SongButton({ song, onPick }: { song: SuggestedSong; onPick: (songId: number) => void }) {
  return (
    <button
      onClick={() => onPick(song.id)}
      className={`w-full text-left rounded-lg px-3 py-3 text-base transition-colors active:scale-[0.99] ${
        song.played ? 'text-neutral-400 italic' : 'text-neutral-800 hover:bg-blue-50 active:bg-blue-100'
      }`}
    >
      {song.title}
      {song.played ? ' · ειπωμένο' : ''}
    </button>
  );
}

function LyricsCard({ lyrics }: { lyrics: string | null }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm p-6 sm:p-8">
      {lyrics ? (
        <pre className="whitespace-pre-wrap font-sans text-xl sm:text-2xl leading-relaxed text-neutral-900">{lyrics}</pre>
      ) : (
        <p className="text-lg italic text-neutral-400">Δεν έχουν προστεθεί ακόμη στίχοι για αυτό το τραγούδι.</p>
      )}
    </div>
  );
}

export default function LiveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [showPlayed, setShowPlayed] = useState(false);
  const [manualActiveAxisTypes, setManualActiveAxisTypes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const searchParams = new URLSearchParams({ showPlayed: String(showPlayed) });
    if (manualActiveAxisTypes !== null) {
      searchParams.set('activeAxisTypes', manualActiveAxisTypes.join(','));
    }
    const res = await fetch(`/api/sessions/${params.id}/suggestions?${searchParams.toString()}`);
    setData(await res.json());
  }, [params.id, showPlayed, manualActiveAxisTypes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function toggleAxis(key: string) {
    const current = manualActiveAxisTypes ?? data?.activeAxisTypes ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setManualActiveAxisTypes(next);
  }

  async function handlePick(songId: number) {
    await fetch(`/api/sessions/${params.id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextSongId: songId }),
    });
    setManualActiveAxisTypes(null);
    await load();
  }

  async function handleEndSequence() {
    await fetch(`/api/sessions/${params.id}/end-sequence`, { method: 'POST' });
    setManualActiveAxisTypes(null);
    await load();
  }

  async function handleEndSession() {
    await fetch(`/api/sessions/${params.id}/end`, { method: 'POST' });
    router.push('/');
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-lg text-neutral-500">Φόρτωση...</p>
      </main>
    );
  }

  if (!data.currentSong) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 p-4">
        <h1 className="text-2xl font-bold text-neutral-900">Διάλεξε τραγούδι για να συνεχίσεις</h1>
        <SongPicker onSelect={handlePick} />
      </main>
    );
  }

  const currentSong = data.currentSong;

  return (
    <main className="flex min-h-screen flex-col bg-neutral-50">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className="flex select-none items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" className="h-4 w-4" checked={showPlayed} onChange={(e) => setShowPlayed(e.target.checked)} />
            Δείξε τα ειπωμένα
          </label>
          {data.availableAxisTypes.map((axis) => {
            const isActive = data.activeAxisTypes.includes(axis.key);
            return (
              <button
                key={axis.key}
                onClick={() => toggleAxis(axis.key)}
                className={`rounded-full border px-3 py-2 text-sm ${
                  isActive ? 'border-blue-600 bg-blue-600 text-white' : 'border-neutral-300 bg-white text-neutral-600'
                }`}
              >
                {axis.label}: {axis.value}
              </button>
            );
          })}
          <button
            onClick={handleEndSequence}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            Τέλος σειράς
          </button>
          <button onClick={handleEndSession} className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">
            Λήξη session
          </button>
        </div>
        <h1 className="text-center text-xl font-bold text-neutral-900 sm:text-2xl">{currentSong.title}</h1>
      </header>

      <div className="flex-1 p-4 sm:p-6">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <LyricsCard lyrics={currentSong.lyrics} />
          <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <h2 className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              {data.mode === 'filtered' ? data.listTitle : 'Όλα τα τραγούδια'}
            </h2>
            <div className="flex max-h-[36rem] flex-col gap-1 overflow-y-auto p-2">
              {data.mode === 'filtered' &&
                (data.candidates.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-neutral-400">Καμία πρόταση</p>
                ) : (
                  data.candidates.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
              {data.mode === 'grouped' &&
                data.genreGroups.map((group) => (
                  <div key={group.genreId} className="flex flex-col gap-1">
                    <h3 className="px-3 pt-2 text-xs font-semibold uppercase text-neutral-400">{group.genreName}</h3>
                    {group.songs.map((s) => (
                      <SongButton key={s.id} song={s} onPick={handlePick} />
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Manual check in the browser**

```bash
npm run dev
```
Start a session with a song that has region+rhythm+dromos tags. Confirm: all three toggle buttons render, all active by default, list title reads "Άλλα τραγούδια με ίδιο Ρυθμό, Περιοχή, Δρόμο". Click one off — confirm the list title shrinks and the candidate set widens. Click every toggle off — confirm the view switches to genre-grouped headers. Pick a song with only Composer+Year tags (a σύγχρονο song, if any exist yet in the data — otherwise create one via `/admin/songs/new` for this check) and confirm only those two toggles appear.

- [ ] **Step 3: Verify lint/test/build**

```bash
npm run lint
npm run test
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/session/\[id\]/page.tsx
git commit -m "Rewrite live session UI around dynamic axis toggles and a single suggestion list"
```

---

### Task 9: Drop legacy columns/table

**Files:**
- Modify: `src/db/schema.ts`
- Delete: `src/db/queries/transitionRules.ts`
- Delete: `src/app/api/transition-rules/route.ts`
- Delete: `src/app/api/transition-rules/[id]/route.ts`
- Delete: `src/app/admin/transition-rules/page.tsx`
- Modify: `scripts/smoke-schema.ts`

**Interfaces:**
- Nothing in the codebase should reference `songs.regionId`/`rhythmId`/`dromosId`, `transitionRules`, or `TransitionRuleRow` after this task — verified by `npm run build`'s TypeScript check.

- [ ] **Step 1: Confirm nothing still references the columns/table being dropped**

```bash
grep -rn "regionId\|rhythmId\|dromosId" src --include="*.ts" --include="*.tsx" | grep -v "songAxisValues\|axisType"
grep -rln "transitionRules\|TransitionRuleRow" src
```
Expected: no matches (Tasks 4–8 already removed every reference). If anything shows up, stop and fix it before proceeding — this task is a destructive schema change and must not run while application code still depends on what it removes.

- [ ] **Step 2: Delete the transition-rules files**

```bash
git rm src/db/queries/transitionRules.ts
git rm -r "src/app/api/transition-rules"
git rm -r "src/app/admin/transition-rules"
```

- [ ] **Step 3: Edit `src/db/schema.ts`**

Remove the three FK lines from `songs`:

```ts
  regionId: integer('region_id').references(() => regions.id),
  rhythmId: integer('rhythm_id').references(() => rhythms.id),
  dromosId: integer('dromos_id').references(() => dromoi.id),
```

Remove the whole `transitionRules` table definition:

```ts
export const transitionRules = pgTable('transition_rules', {
  id: serial('id').primaryKey(),
  fromRhythmId: integer('from_rhythm_id').notNull().references(() => rhythms.id),
  toRhythmId: integer('to_rhythm_id').notNull().references(() => rhythms.id),
});
```

Remove its type export:

```ts
export type TransitionRuleRow = typeof transitionRules.$inferSelect;
```

- [ ] **Step 4: Edit `scripts/smoke-schema.ts`**

Remove every line referencing `region`, `rhythm`, `dromos` insertion tied to the song, and the `rule`/`transitionRules` block. Replace the whole file:

```ts
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql, { schema });

  const [genre] = await db.insert(schema.genres).values({ name: 'Smoke Genre' }).returning();
  const [composer] = await db.insert(schema.composers).values({ name: 'Smoke Composer' }).returning();
  const [axisType] = await db
    .insert(schema.axisTypes)
    .values({ key: 'smoke_axis', label: 'Smoke Axis', lookupTable: null, hierarchical: false })
    .returning();

  const [song] = await db.insert(schema.songs).values({ title: 'Smoke Song', lyrics: 'la la la', genreId: genre.id }).returning();

  const [axisValue] = await db
    .insert(schema.songAxisValues)
    .values({ songId: song.id, axisType: axisType.key, refId: null, yearValue: 1950 })
    .returning();

  const [session] = await db.insert(schema.sessions).values({ label: 'Smoke Session', currentSongId: song.id }).returning();
  const [played] = await db.insert(schema.sessionPlayedSongs).values({ sessionId: session.id, songId: song.id }).returning();

  if (!genre.id || !composer.id || !axisType.id || !song.id || !axisValue.id || !session.id || !played.id) {
    throw new Error('One or more inserts did not return an id');
  }

  await db.delete(schema.sessionPlayedSongs).where(eq(schema.sessionPlayedSongs.id, played.id));
  await db.delete(schema.sessions).where(eq(schema.sessions.id, session.id));
  await db.delete(schema.songAxisValues).where(eq(schema.songAxisValues.id, axisValue.id));
  await db.delete(schema.songs).where(eq(schema.songs.id, song.id));
  await db.delete(schema.axisTypes).where(eq(schema.axisTypes.id, axisType.id));
  await db.delete(schema.composers).where(eq(schema.composers.id, composer.id));
  await db.delete(schema.genres).where(eq(schema.genres.id, genre.id));

  console.log('Schema smoke test passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Generate and run the final migration**

```bash
npm run db:generate
```
Expected: a new migration containing `ALTER TABLE "songs" DROP COLUMN "region_id";` (and `rhythm_id`, `dromos_id`), and `DROP TABLE "transition_rules";`.

```bash
npm run db:migrate
```
Expected: `Migrations applied successfully`.

- [ ] **Step 6: Run the smoke test**

```bash
npm run db:smoke
```
Expected: `Schema smoke test passed`.

- [ ] **Step 7: Full verification**

```bash
npm run lint
npm run test
npm run build
```
Expected: all clean — this is the final gate confirming no dangling references survived the cleanup.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Drop legacy songs.regionId/rhythmId/dromosId columns and transitionRules table"
```

---

## Self-Review Notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-29-dynamic-song-tags-design.md` maps to a task — data model (Tasks 1–3), suggestion engine behavior (Task 4), admin changes (Task 7), migration of existing data (Task 3), API layer implied by both (Tasks 5–6), and the explicit removal of `transitionRules` (Task 9, staged safely after nothing references it).
- **Sequencing was adjusted from a naive read of the spec:** the spec doesn't itself dictate migration order, but dropping `songs.regionId`/`rhythmId`/`dromosId` before the application code stops writing them would break every `createSong`/`updateSong` call. This plan makes those columns nullable early (Task 1) and defers the actual `DROP COLUMN`/`DROP TABLE` to Task 9, once Task 4–8 have already cut the application over to `song_axis_values` entirely.
- **Testing approach follows existing convention** (Global Constraints) rather than introducing a new DB-integration-test pattern this codebase doesn't otherwise use — query-layer tasks get a one-off manual verification script; the suggestion-engine task (pure functions) gets full Vitest TDD, matching how `suggestions.test.ts` already worked.
