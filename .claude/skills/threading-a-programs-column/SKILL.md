---
name: threading-a-programs-column
description: Use when adding a new column to the programs or program_sequences table
  (a conflict guard, a flag, a timestamp, any per-program/per-sequence field) that the
  client needs to read. Ensures the field is projected in every read path, not just the
  schema and writes. Symptoms: field is undefined on device but the migration ran, works
  in one list but not another, a client `as` cast that compiles but returns undefined,
  "version", "program_sequences", "listAccessiblePrograms", "reference-data blob".
---

# Threading a programs/program_sequences Column Through Read Paths

## Overview

Adding a column to `programs` or `program_sequences` is deceptively partial. The schema
change + migration + write paths compile and pass vitest — but the field reaches the client
only through read paths that **hand-build their response object**; a path that spreads a full
`SELECT *` row carries the field for free, and the two list paths are **chained**, not
independent. A client-side `as SomeType` cast on a fetch response *asserts* the field
exists without *producing* it, so a missed projection compiles clean, passes every unit
test, and is silently `undefined` at runtime on the device.

**The trap in one sentence:** the type says the field is there; only the SELECT decides
whether it actually is.

## When to use

- Adding any readable column to `programs` or `program_sequences`.
- **Not** for a write-only/internal column the client never reads (e.g. a server-only
  audit field) — though even then, confirm no read path *should* expose it.

## The rule: find every HAND-BUILT projection; `SELECT *`-spread routes flow for free

The trap isn't "three independent paths" — it's that some paths hand-build the response
object field-by-field (those need your field added) while others spread a full row (those
carry a new `programs` column automatically). And the two list paths are **chained**, not
independent — so order matters. Add your field to each hand-built projection below:

1. **Online list — do this FIRST** — `listAccessiblePrograms(userId)` (returns
   `AccessibleProgram`) in `src/db/queries/programs.ts`. Its inner `summarize()` hand-builds
   the object field-by-field (`id/title/role/.../version`), so add the field to **both** the
   `AccessibleProgram` interface and the `summarize` return. Consumed verbatim by
   `GET /api/programs` (`src/app/api/programs/route.ts`).

2. **Offline blob — downstream of #1** — `listProgramsWithSequencesAndSongs(userId)` in the
   same file **calls `listAccessiblePrograms`** and re-maps its result into the hand-built
   `OfflineProgram` shape (defined in `src/lib/referenceData.ts`). So the field must be on
   `AccessibleProgram` (#1) *before* you can project it here, plus added to the `OfflineProgram`
   interface. Not independent from #1 — chained to it.

3. **Detail — usually NO change** — `GET /api/programs/[id]`
   (`src/app/api/programs/[id]/route.ts`) returns `{ ...program, role, sequences }` where
   `program` is a `SELECT *` row, so a new `programs` column flows through **automatically**.
   Change it only if it switches to an explicit column projection. The hand-built thing on the
   detail *offline* path is `CachedProgramDetail` (`referenceData.ts`) — update that instead.

If the column is on `program_sequences`: the sequence objects in #2 are hand-built
(`version: sequence.version`) so update them; the detail route's `sequences` also come from a
`SELECT *` (`listSequencesForProgram`) and flow automatically.

**Client render:** threading data to the client isn't the same as *using* it. A list-level
field (a badge, a filter) also needs adding to `DisplayProgram` + the base type in
`src/lib/programsMerge.ts` (`mergeProgramsWithPending`) and the list page's filter. A
detail-level field goes to `offlineProgramView.ts` instead.

## Verification (do this, don't assume)

```bash
# The field must appear in every HAND-BUILT projection (the two list paths + the offline
# interfaces). The detail route spreads SELECT *, so it needs no hit for a `programs` column.
grep -rn "yourNewField" src/db/queries/programs.ts src/lib/referenceData.ts
```

Expect hits in `AccessibleProgram` + `summarize`, the `OfflineProgram` mapper, and the
`OfflineProgram`/`CachedProgramDetail` interfaces. A hit only in the schema + write query is
the bug, pre-shipped.

## Checklist (create a todo per item)

1. Add the column to `programs`/`program_sequences` in `src/db/schema.ts`.
2. `npm run db:generate`, then `npm run db:migrate` (see README for the full multi-user
   sequence if this is a fresh DB). A nullable, no-default column skips the backfill/finalize.
3. Update the write path(s) that set it.
4. **First** project it in the online list — `AccessibleProgram` interface + `summarize` +
   consumed by `GET /api/programs`.
5. **Then** the offline blob (downstream of #4) — `listProgramsWithSequencesAndSongs` mapper +
   the `OfflineProgram` interface in `referenceData.ts`.
6. Detail route (`GET /api/programs/[id]`): **no change** for a `programs` column (it spreads
   `SELECT *`). For offline detail, update `CachedProgramDetail` in `referenceData.ts`.
7. Grep the hand-built sites (command above) — confirm the field is present in each.
8. If the client renders it: add to `DisplayProgram`/`programsMerge.ts` (+ page filter) for a
   list field, or `offlineProgramView.ts` for a detail field.

## Common mistakes

- **Trusting an `as` cast.** `const p = (await res.json()) as ProgramDetail` makes TypeScript
  believe the field is present. It compiles; the value is `undefined`. Only the SELECT proves
  presence.
- **Assuming the two lists are independent.** They're chained: the offline blob calls
  `listAccessiblePrograms`, so you must extend `AccessibleProgram` first, then project in the
  offline mapper. Fixing only one leaves the field on the type but `undefined` in the blob.
- **"Projecting" the detail route unnecessarily.** It spreads `SELECT *`, so a `programs`
  column already flows — no change there. The detail field that *is* hand-built is
  `CachedProgramDetail` (offline). Don't hunt for a projection that isn't needed.
- **Threading data but not using it.** A badge/filter also needs the field on `DisplayProgram`
  / `programsMerge.ts` and the list page's filter — the projection alone renders nothing.
