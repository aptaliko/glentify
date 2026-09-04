---
name: adding-a-classification-axis
description: Use when adding a new song classification axis to Glentify (a new way to tag
  and rank songs alongside region/rhythm/dromos/composer/year/genre). The suggestion engine
  is axis-agnostic, so a new axis is a lookup table + an axis_types seed row + call-site
  wiring, NOT a schema migration on songs. Symptoms: "new axis", "axisType", "axis_types",
  "songAxisValues", "lookupTable", "seed-axis-types", "rankBySharedAxes", "how do I add a
  tag dimension".
---

# Adding a Classification Axis

## Overview

Songs are classified **generically**. There is no per-song rhythm/region/genre column — a
song's tags live in `songAxisValues` (one row per song per axis set, unique on
`(songId, axisType)`), keyed by an `axis_types` row. The suggestion engine
(`src/lib/suggestions.ts`: `getFilteredCandidates` / `rankBySharedAxes` / `getSuggestions`)
is itself axis-agnostic — it ranks by whichever axes the current song has. So adding a new
axis is **data + wiring, never a migration on `songs`**.

Two silent-failure traps: (1) forget the `axis_types` seed row and the axis effectively
doesn't exist; (2) forget to include it in the active axis set at the suggestion call site
and it never influences ranking — with no error anywhere.

Design background: `docs/superpowers/specs/2026-07-29-dynamic-song-tags-design.md` and
`2026-08-12-remove-genre-column-design.md`.

## When to use

- Adding a new dimension songs can be tagged and ranked by.
- **Not** for adding a *value* to an existing axis (that's a lookup-table row / taxonomy
  add — see the taxonomy CRUD path, and for offline, `adding-offline-action`).

## Anatomy of an axis

An axis is defined by one `axis_types` row (`src/db/schema.ts`, `axisTypes` table; seeded by
`scripts/seed-axis-types.ts`):

```ts
{ key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true }
```

- `key` — the stable code id used everywhere (`songAxisValues.axisType` FKs to it).
- `label` — Greek display name.
- `lookupTable` — the table holding the axis's values, OR `null` for a scalar axis. The
  `year` axis is `null` and stores its value in `songAxisValues.yearValue` instead of `refId`.
- `hierarchical` — true only for parent/child axes (like `region`, whose values nest).

## Checklist (create a todo per item)

1. **Lookup table** (skip if scalar like `year`): add a `pgTable` in `src/db/schema.ts`
   modeled on `rhythms`/`genres`. It carries a **nullable `ownerId`** (`NULL` = shared
   baseline row editable only by `role: 'admin'`; non-null = a user's private addition) —
   match the existing taxonomy tables exactly. Add its `$inferSelect` type export.
2. **Migration**: `npm run db:generate` → `npm run db:migrate`.
3. **Seed row**: add the axis to the `AXIS_TYPES` array in `scripts/seed-axis-types.ts` and
   run it. Without this row the axis silently does not exist.
4. **Reference data**: expose the new lookup values through `src/lib/referenceData.ts` (and
   the `/api/reference-data` route) so the editor and offline cache can read them.
5. **Editor wiring**: surface the axis in `SongAxisEditor.tsx` / `axisEditorData.ts` so it
   can actually be set on a song.
6. **Suggestion call site**: include the new axis `key` in the `activeAxisTypes` set passed
   into `rankBySharedAxes` / `getSuggestions` at the call sites
   (`src/app/api/songs/suggestions/route.ts`, `src/app/api/sessions/[id]/suggestions/route.ts`).
   The engine is axis-agnostic — it only ranks by axes you hand it. **Omit this and the axis
   is tag-only, never influencing suggestions, with no error.**
7. **Tests**: `suggestions.test.ts` and `referenceData.test.ts` are pure and already cover
   the shape — add cases for the new axis rather than trusting the axis-agnostic engine
   blindly.
8. **Offline (if writable on-device)**: a new user-addable lookup value = a new offline
   action. Follow `adding-offline-action` (new `*-create`/`*-delete` handlers + merge +
   manual-checklist row). The `TAXONOMY_ENTITIES` list in `syncHandlers.ts` is the pattern.

## Common mistakes

- **Migrating `songs`.** There is no column to add. If you're editing the `songs` table you're
  on the wrong path — the value goes in `songAxisValues`.
- **Skipping the seed row.** The lookup table can exist and be empty-of-meaning without the
  `axis_types` row that makes it an axis. Symptom: nothing references the new tag anywhere.
- **Skipping the call-site toggle.** Ranking silently ignores the axis. There is no error —
  suggestions just don't change. Verify by tagging two songs on the new axis and confirming
  the shared tag lifts the suggestion rank.
- **Non-nullable `ownerId` on the lookup table.** Breaks the shared-baseline-vs-private
  model; taxonomy tables are deliberately nullable there, unlike songs/programs/sessions.
