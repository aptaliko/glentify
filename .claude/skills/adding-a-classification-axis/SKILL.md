---
name: adding-a-classification-axis
description: Use when adding a new song classification axis to Glentify (a new way to tag
  and rank songs alongside region/rhythm/dromos/composer/year/genre). The suggestion engine
  ranks by the current song's own tags, so a new axis is a lookup table + an axis_types seed
  row + reference/label wiring, NOT a schema migration on songs and NOT a call-site toggle. Symptoms: "new axis", "axisType", "axis_types",
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
4. **Query module + reference data.** Add `src/db/queries/<axis>.ts` (a `list<Axis>(userId)`
   with the owner-or-shared `or(isNull(ownerId), eq(ownerId, userId))` filter, modeled on
   `genres.ts`). Then thread the values through **two files, not one**:
   - `src/app/api/reference-data/route.ts` — the query runs *here*; add it to the `Promise.all`
     and the payload. (`src/lib/referenceData.ts` is pure types + `normalizeReferenceData`, it
     runs no query — add the interface field and a `?? []` backfill there so old cached blobs
     don't strand the native editor.)
   - `src/db/queries/axisValues.ts` → **`getVisibleAxisRefIds`**: this hardcodes the visible
     ref-ids per axis into a `Map`, and `/api/songs/suggestions` filters candidate tags by it.
     Add your axis's `['<axis>', new Set(...)]` entry — **miss it and tags are silently dropped
     from title-search suggestions.**
5. **Editor wiring — two hardcoded allowlists.** Add `'<lookupTable>'` to `LOOKUP_FIELDS` in
   `axisEditorData.ts` (else the native editor renders the axis with **zero options, no error**)
   AND `'<axis>': '/api/<lookupTable>'` to `LOOKUP_ENDPOINTS` in `SongAxisEditor.tsx`.
6. **Suggestion *label* wiring — NOT a call-site toggle.** The engine derives its active axis
   set from the current song's own tags (`effectiveActive = requestedActive ?? new Set(current
   song's axis keys)` in `buildSuggestionsResponse`), so a seeded+tagged axis **ranks
   automatically** — there is no `activeAxisTypes` array to add a key to, and
   `src/app/api/songs/suggestions/route.ts` doesn't rank at all. What you MUST wire is the
   **label map**, which is hardcoded to the existing 5 axes; skip it and the axis ranks but
   renders as `?`:
   - `src/lib/suggestions.ts`: add your axis to the `ReferenceLookups` interface AND to the
     `lookupNameById` map inside `buildSuggestionsResponse`.
   - `src/app/api/sessions/[id]/suggestions/route.ts`: add the list query to its `Promise.all`
     and to **both** `lookups` objects.
   - `src/lib/sessionStore.ts` → `toReferenceLookups`: add the axis — this is the **offline**
     ranking/label path, parallel to the API route. Miss it and it's labelled on web, `?` on device.
7. **Admin taxonomy CRUD** (so users can actually add values): `/api/<lookupTable>/route.ts`
   + `[id]/route.ts` and `admin/<lookupTable>/page.tsx` + a nav link, modeled on `admin/genres`.
   An admin-created value gets `ownerId: null` (shared), a normal user's gets `ownerId: user.id`.
8. **Offline (yes for any user-addable list).** A new user-addable value = a new offline action.
   **First add `'<lookupTable>'` to the `DraftEntity` union in `draftIds.ts`** (or
   `TAXONOMY_ENTITIES: DraftEntity[]` in `syncHandlers.ts` won't typecheck), then follow
   `adding-offline-action` (the `TAXONOMY_ENTITIES` loop auto-registers `*-create`/`*-delete`;
   `mergeTaxonomyWithPending` + a manual-checklist row).
9. **Tests**: add the new axis to `suggestions.test.ts` (two songs sharing the axis lift rank)
   and `referenceData.test.ts` / `axisEditorData.test.ts` (normalize backfill + option resolution).

## Common mistakes

- **Migrating `songs`.** There is no column to add. If you're editing the `songs` table you're
  on the wrong path — the value goes in `songAxisValues`.
- **Skipping the seed row.** The lookup table can exist and be empty-of-meaning without the
  `axis_types` row that makes it an axis. Symptom: nothing references the new tag anywhere.
- **Hunting for a "call-site toggle" that doesn't exist.** The engine ranks by the current
  song's own tags — there's no static axis set to edit. The silent failure is *labels*, not
  ranking: skip `lookupNameById` / `ReferenceLookups` / `toReferenceLookups` and the axis
  ranks correctly but shows `?`; skip `getVisibleAxisRefIds` and its tags vanish from
  title-search suggestions. Verify by tagging two songs and confirming the shared tag both
  lifts rank **and** renders its label — on web *and* on device.
- **Non-nullable `ownerId` on the lookup table.** Breaks the shared-baseline-vs-private
  model; taxonomy tables are deliberately nullable there, unlike songs/programs/sessions.
