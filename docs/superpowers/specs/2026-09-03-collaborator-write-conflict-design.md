# Collaborator write-conflict resolution (detect + warn)

**Date:** 2026-09-03
**Status:** Design — approved, not yet planned
**Feature:** Version-guarded shared-program/sequence writes so a stale offline edit is
detected and the user warned, instead of silently overwriting a collaborator's work.

## Problem

The offline write model is last-write-wins with no conflict detection. Song and shared
program/sequence writes apply unconditionally (scoped only by ownership/access). If a user
and a collaborator both edit the same shared program sequence offline, whichever queue drains
last silently wins — the earlier writer's change is destroyed with no signal.

Programs and their sequences are the **only** shared-edit surface (songs and taxonomy are
owner-scoped, so they cannot conflict between users). This work is therefore limited to that
surface.

### Correcting the backlog premise

The feature-backlog item claims "`updatedAt` is stored but never used as a version guard."
That is **false for the tables in question**: `programs`, `program_sequences`, and
`sequence_songs` carry no `updatedAt` column at all (`src/db/schema.ts`). There is no
existing timestamp to repurpose — a version column is genuinely new.

### This is also a live latent bug, not only a nicety

`reorderSequenceSongs` (`src/db/queries/programs.ts`) updates `position` only for the ids
passed in `orderedIds`; any entry absent from that list keeps its old `position`. So if
collaborator A adds a song to a sequence (server now has N+1 entries) and collaborator B's
offline reorder later drains carrying only the N ids B knew about, B's reorder leaves A's new
entry at a stale position that can collide with a reassigned one, producing a nondeterministic
order. The version guard rejects B's stale reorder instead of silently corrupting the order,
so this work fixes a real data-loss path.

## Goals

- Detect when a queued offline write targets a shared program/sequence resource that has
  changed since the edit was captured, and **warn** the user rather than overwrite.
- Preserve the losing writer's intent to the extent the existing sync UI already does: the
  conflicting action surfaces as `needsAttention`, and the rendered list reverts to the
  last-known real (collaborator's) state so the user can see their change did not land and
  redo it.
- Do all of this without breaking already-installed native builds or the web app.

## Non-goals

- **Guided / field-by-field merge UX.** Explicitly declined at brainstorm — this is
  detect + warn only. No diff screen, no per-field pick.
- **Guarding operations that commute.** `sequence-add-song` and `sequence-remove-song`
  merge cleanly (two adds both land; a remove of an already-gone entry is a no-op), and
  `save-sequences` with `destination: 'existing'` appends (`appendSequencesToProgram`).
  These stay last-write-wins and are untouched.
- **Web-side `If-Match`.** v1 is native-only (see Scope). The endpoints accept the header
  but web does not send it.
- **Song / taxonomy conflict detection.** Owner-scoped, cannot conflict between users.

## Scope decisions (settled at brainstorm)

| Decision | Choice |
|---|---|
| Which ops get the guard | **Reorder + renames only**: `sequence-reorder`, `sequence-rename`, `program-rename`. Deletes stay LWW. |
| Web vs native | **Native-only v1**, honor-if-present: endpoints accept `If-Match` when sent but never require it; only native sync sends it. |
| Deleted-target (404) | **In scope**: on a *guarded* op, a 404 (target deleted / access lost) warns like a conflict instead of the current silent `404→success`. |

The guarded operations — `sequence-rename`, `sequence-reorder`, `program-rename` — are the
**conflict-aware set**: they warn on both a `409` (stale version) and a `404` (target gone).
Every other action keeps its current behavior, including today's `404→success` mapping (a
remove-song against an already-deleted sequence is a legitimate no-op success).

## Architecture

### 1. Data model

Add a monotonic version column to each guarded resource:

- `program_sequences.version integer NOT NULL DEFAULT 1`
- `programs.version integer NOT NULL DEFAULT 1`

The version is bumped on every mutation of that resource that a guarded op competes with:

- A `program_sequences.version` bump on: sequence rename, add-song, remove-song, reorder.
  (Add/remove are unguarded as *writers* — they never send `If-Match` — but they must still
  **advance** the sequence's version so that a concurrent guarded reorder/rename is correctly
  detected as stale. Guarding and version-bumping are separate concerns.)
- A `programs.version` bump on: program rename. (Program-level metadata only; sequence edits
  bump the sequence's version, not the program's, so sibling-sequence edits never
  false-conflict a program rename.)

*Rejected alternatives:* a single per-program version false-conflicts edits to different
sequences of the same program; a per-entry (`sequence_songs`) version cannot represent an
ordering, which is the primary thing being guarded. Per-sequence is the correct grain.

**Migration:** a plain `npm run db:generate` + `npm run db:migrate`. This does **not** need
the `db:migrate-to-multiuser` → `db:migrate:finalize` sequence — that sequence exists solely
for the `owner_id` backfill. `NOT NULL DEFAULT 1` populates existing rows.

### 2. Endpoints (native-only, honor-if-present)

The three guarded PATCH routes gain optional optimistic-concurrency handling:

- `PATCH /api/programs/[id]/sequences/[seqId]` (rename)
- `PATCH /api/programs/[id]/sequences/[seqId]/songs` (reorder)
- `PATCH /api/programs/[id]` (program rename)

Behavior, per request:

1. **No `If-Match` header** → today's last-write-wins path, unchanged. This is what keeps
   already-installed APKs and the web app working: native builds point
   `NEXT_PUBLIC_API_BASE_URL` at the deployed web app, so an old APK that has not been
   updated will keep calling these endpoints with no header and must not break. The write
   still bumps the resource's version.
2. **`If-Match: <n>` present and `<n>` equals the current stored version** → apply the write,
   bump the version, respond `200` with the new version in the body
   (e.g. `{ ok: true, version: <n+1> }`).
3. **`If-Match: <n>` present and stale** (`<n>` ≠ current version) → respond `409` with the
   current server version and current value in the body (so the client/merge layer can show
   the collaborator's state), no write applied.
4. **Target not found / access lost** → `404` (unchanged status). The client maps this to a
   conflict *only for guarded ops* (see §3).

Add/remove-song and delete routes are unchanged except that add/remove must bump the parent
sequence's `version` (§1). The header is read case-insensitively; a malformed/non-numeric
`If-Match` is treated as "no header" (LWW) rather than erroring, to stay maximally tolerant of
old clients.

### 3. Sync queue — a fourth outcome

`SyncOutcome` (`src/lib/syncQueue.ts`) today is `'success' | 'item-error' | 'systemic-error'`.
Add `'conflict'`.

- `item-error` is wrong for a stale write: it burns `MAX_ATTEMPTS` (3) doomed retries before
  flagging, but a stale write is stale forever — retrying only delays the warning.
- `systemic-error` is wrong: it stops the whole pass, but a conflict is this item's problem,
  not a connectivity failure; the rest of the queue should keep draining.

`'conflict'` flags the action `needsAttention` immediately (on attempt 1) and continues the
pass — the same "permanently skip until a human acts" state `item-error` reaches at the cap,
but reached in one step. This is a small, pure, unit-testable change to `processQueueWith`
against the fake `QueueStorage`.

The guarded sync handlers (`handleSequenceRenameSync`, `handleSequenceReorderSync`,
`handleRenameProgramSync` in `src/lib/syncHandlers.ts`) map responses:

| Response | Outcome |
|---|---|
| `2xx` | `success` (and record the returned version — §4) |
| `409` | `conflict` |
| `404` | `conflict` (guarded ops only — replaces today's `success`) |
| `401` / `5xx` | `systemic-error` (unchanged) |
| other `4xx` | `item-error` (unchanged) |

Unguarded handlers are untouched and keep `404 → success`.

### 4. Self-conflict on consecutive offline edits (the sharp edge)

The highest-risk trap. `baseVersion` is captured into the payload at enqueue time from the
offline cache, which never advances while offline. Two offline edits to the same sequence both
carry version *N*. Edit 1 syncs and bumps the server to *N+1*; edit 2 would then `409` against
the user's **own** prior write — a false conflict.

Fix, reusing the existing `draftIds.ts` shape (`recordResolution` / `resolveOne`):

- On a successful guarded sync, record the server's returned new version keyed by resource id
  (sequence id or program id) in an IndexedDB-backed map — a "latest known synced version"
  table, analogous to the draft-id → real-id map.
- Before a guarded handler sends, it resolves its payload's `baseVersion` through that map:
  if a newer synced version for this resource is recorded, use it as the `If-Match` value
  instead of the stale captured one.

This makes a chain of the same user's own offline edits sync cleanly, while a genuine
collaborator write (which the user's device never recorded) still conflicts correctly.

The version-resolution helper is a pure function over the map + payload and is unit-tested.
The IndexedDB persistence around it follows `draftIds.ts` and is manually verified.

### 5. Warn UX

No new screen. Reuse the existing sync badge / `needsAttention` surface owned by
`SyncQueueProvider` / `useSyncQueue()`. The merge functions
(`programsMerge.ts` / `sequencesMerge.ts`) already revert a `needsAttention` item to the
last-known real state — for a conflict that is exactly right: the collaborator's version
renders and the user sees their change did not land.

The only UI change is **copy**: distinguish a conflict from a plain failure where the badge /
list surfaces `needsAttention` items — «άλλαξε από συνεργάτη» (changed by a collaborator) for
a conflict vs the existing «απέτυχε» (failed) for an `item-error` at the retry cap. This
requires the `needsAttention` reason to be distinguishable; carry a lightweight
`reason: 'conflict' | 'failed'` (or equivalent) on the flagged action so the UI can pick copy.

## Data flow (conflict case)

1. User A and collaborator B both have the program cached at sequence version `5`.
2. Both go offline and reorder the same sequence. Both enqueue a `sequence-reorder` with
   `baseVersion: 5`.
3. B reconnects first. B's reorder sends `If-Match: 5`, matches, applies, server → version `6`.
   B's device records "sequence X latest synced version = 6".
4. A reconnects. A's reorder sends `If-Match: 5`, server is at `6` → `409`. Handler returns
   `conflict`. The action is flagged `needsAttention` with `reason: 'conflict'`.
5. A's program view (merge layer) reverts that sequence to the last-known real state (B's
   order), and the badge shows «άλλαξε από συνεργάτη». A re-does the reorder if still wanted,
   now against version `6`.

## Testing

Per the project convention (`CLAUDE.md` §Testing convention): **vitest covers pure logic
only.** Concretely:

- **vitest:** the new `'conflict'` branch of `processQueueWith` (via the fake `QueueStorage`),
  and the pure version-resolution helper from §4.
- **Manual, tracked in `docs/manual-testing-checklist.md`:** the three endpoints'
  `If-Match` behavior (absent / match / stale / 404), the guarded sync handlers' response
  mapping, the IndexedDB version-map persistence, and the two-device conflict + self-conflict
  flows on-device.

No API-route or IndexedDB automated tests — that is the established convention, not an
oversight; the plan must not invent them.

## Files touched (anticipated)

- `src/db/schema.ts` — `version` columns; generated migration under `drizzle/`.
- `src/db/queries/programs.ts` — bump version on rename/add/remove/reorder; return new
  version where the guarded routes need it.
- `src/app/api/programs/[id]/route.ts`,
  `src/app/api/programs/[id]/sequences/[seqId]/route.ts`,
  `src/app/api/programs/[id]/sequences/[seqId]/songs/route.ts` — read `If-Match`, `409` on
  stale, return new version.
- `src/lib/syncQueue.ts` — add `'conflict'` to `SyncOutcome`, handle it in `processQueueWith`.
- `src/lib/syncHandlers.ts` — response mapping for the three guarded handlers; send `If-Match`
  resolved through the version map.
- New `src/lib/syncedVersions.ts` (or similar) — the version-map persistence + pure resolver,
  modeled on `draftIds.ts`.
- `src/lib/*Merge.ts` and the badge/list UI — carry and render the `conflict` vs `failed`
  reason (copy only).
- `docs/manual-testing-checklist.md` — new manual checks.

## Open question deferred to the plan

Whether `program-rename` needs its own `programs.version` column or can guard on a cheaper
existing signal. The spec assumes a `programs.version` column for symmetry with sequences;
the plan may simplify if a lighter check is clearly sufficient.
