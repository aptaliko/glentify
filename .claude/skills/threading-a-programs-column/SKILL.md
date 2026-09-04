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
only through the read paths that **explicitly project it**, and there are **three
independent ones**. A client-side `as SomeType` cast on a fetch response *asserts* the field
exists without *producing* it, so a missed projection compiles clean, passes every unit
test, and is silently `undefined` at runtime on the device.

**The trap in one sentence:** the type says the field is there; only the SELECT decides
whether it actually is.

## When to use

- Adding any readable column to `programs` or `program_sequences`.
- **Not** for a write-only/internal column the client never reads (e.g. a server-only
  audit field) — though even then, confirm no read path *should* expose it.

## The three read paths (grep the field name across ALL of them)

Every new client-readable field must be added to each, independently:

1. **Offline blob builder** — `listProgramsWithSequencesAndSongs(userId)` in
   `src/db/queries/programs.ts`. This is what the native app caches for offline use. It
   builds the `OfflineProgram` shape by hand (see the `version: program.version` /
   `version: sequence.version` lines) — a field not spelled out here never reaches offline.

2. **Online list path** — `listAccessiblePrograms(userId)` (returns `AccessibleProgram`) in
   the same file, consumed by `GET /api/programs` (`src/app/api/programs/route.ts`). Add the
   field to the `AccessibleProgram` interface **and** its SELECT/mapping.

3. **Detail path** — `GET /api/programs/[id]` (`src/app/api/programs/[id]/route.ts`). The
   single-program fetch the detail page uses. Project the field in its response body too.

If the column is on `program_sequences`, the sequence-level projections inside paths 1 and 3
are the ones to update (e.g. the `sequences.map(... version: sequence.version ...)` block).

## Verification (do this, don't assume)

```bash
# The field must appear in all three read sites, not just schema + writes.
grep -rn "yourNewField" src/db/queries/programs.ts \
  src/app/api/programs/route.ts \
  "src/app/api/programs/[id]/route.ts"
```

Expect a hit in **each**. A `grep` that finds it in the schema and the write query but not
in a read path is the bug, pre-shipped.

## Checklist (create a todo per item)

1. Add the column to `programs`/`program_sequences` in `src/db/schema.ts`.
2. `npm run db:generate`, then `npm run db:migrate` (see README for the full multi-user
   sequence if this is a fresh DB).
3. Update the write path(s) that set it.
4. Project it in **path 1** (`listProgramsWithSequencesAndSongs` + `OfflineProgram` shape).
5. Project it in **path 2** (`AccessibleProgram` + `listAccessiblePrograms` +
   `GET /api/programs`).
6. Project it in **path 3** (`GET /api/programs/[id]`).
7. Grep the field across all three (command above) — confirm a hit in each.
8. If native reads it offline, confirm the offline view type
   (`offlineProgramView.ts`) and any `*Merge.ts` that renders it carry the field too.

## Common mistakes

- **Trusting an `as` cast.** `const p = (await res.json()) as ProgramDetail` makes TypeScript
  believe the field is present. It compiles; the value is `undefined`. Only the SELECT proves
  presence.
- **Updating one list and shipping.** The online list and the offline blob are *different
  functions*; fixing `listAccessiblePrograms` does nothing for offline users, and vice versa.
- **Forgetting the detail route.** It's easy to miss because it's an API route file, not in
  `queries/programs.ts` with the other two.
