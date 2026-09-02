# Unify the offline-cache priming triggers

**Status:** Designed — not yet implemented.

## Problem

The native app has, today, **five** independent read-through offline caches, each primed
by a different, unrelated trigger:

| Cache | IndexedDB database | Primed by | Feeds |
| --- | --- | --- | --- |
| `referenceData` (`offlineCache.ts`) | `glentify-offline` | Home "Συγχρονισμός τραγουδιών" button | Σταθερά προγράμματα, Ξεκίνα Live, axis Tags |
| `songsListCache` | `glentify-songs-list-cache` | opening Διαχείριση → Τραγούδια **while online** | admin songs list |
| `programsListCache` | `glentify-programs-list-cache` | opening Διαχείριση → Προγράμματα **while online** | admin programs list |
| `programDetailCache` | `glentify-program-detail-cache` | opening **one** program's editor while online (per-program) | offline program editor |
| `collaboratorsCache` | `glentify-collaborators-cache` | opening **one** program's editor while online (per-program) | offline collaborator UI |

There is no single "prepare this device for offline use" step. A device can be fully synced
for one set of screens and show "άγνωστο / δεν είναι διαθέσιμη χωρίς σύνδεση" on another,
with no indication why. The per-screen "unavailable offline" messages were made actionable
as a stopgap (`3fd6c36`), but the underlying multi-trigger design is unchanged. This was
found 2026-09-02 while investigating an on-device bug report, and is item "Unify the three
independent offline-cache priming triggers" in `docs/feature-backlog.md` (the backlog named
three; the two per-program caches make it five).

Two facts about the current code shape the whole design:

1. **`referenceData` is already a near-superset.** `/api/reference-data` already returns the
   user's full `songs` (`SongRow[]`), `programs` with sequences, `axisValues`, and all
   taxonomy, from a **single consistent DB snapshot**. The satellite caches mostly re-derive
   data reference-data already carries.
2. **The satellite program data is already fetched and then discarded.**
   `listProgramsWithSequencesAndSongs` (`src/db/queries/programs.ts`) internally calls
   `listAccessiblePrograms`, which already computes `role` and `sharedWithEmails` — then
   drops them when building the leaner `OfflineProgram`. The sequence-song **join-row ids**
   that `programDetailCache` needs come from the same `listSongsForSequence` call that view
   already makes.

## Decision

**Consolidate all offline read-data into the single `referenceData` blob, filled by one
extended server call, primed by one trigger.** The four satellite caches are retired; their
consumers read slices of the one blob. This is "pure A" from the brainstorming session.

### Why one server-composed blob, not client-side fan-out

Three alternatives were weighed:

- **One server-composed blob (chosen).** Extend `/api/reference-data` to also carry the
  programs' `role`/`sharedWithEmails`, collaborators, and sequence-song join ids. Priming is
  **one** fetch: atomic, internally consistent (single DB snapshot), no client fan-out. The
  two per-program caches stop being separate fetches and become *slices* of the blob.
- **Client fans out in parallel into one blob.** Keep the existing endpoints, fire them in
  parallel behind the button, assemble a blob. Rejected: the existing endpoints **overlap**
  heavily (songs/programs are returned by `reference-data` *and* by `/api/songs` /
  `/api/programs`), so this re-fetches the same rows two–three times, and — being separate
  requests — the assembled blob can be internally inconsistent (a song present in one slice
  but not yet reflected in another). It also reintroduces a per-program N+1 for the detail
  caches. It buys per-area progress status, which this app does not need for a manual,
  bounded prepare action.
- **Merge the IndexedDB databases into one store.** Rejected, and it was never really on the
  table: every satellite cache module carries a deliberate comment against sharing a database
  (`songsListCache.ts`, `programsListCache.ts`, etc.) because two independent modules
  coordinating IndexedDB version upgrades on one shared store risks corrupting what that store
  already holds. "Pure A" **sidesteps** that constraint rather than breaking it: there remains
  exactly one blob owned by exactly one module (`offlineCache.ts`), so there is no
  cross-module upgrade coordination at all.

### Why "many users" is not a scaling risk

`/api/reference-data` is **owner-scoped** — every request returns exactly one user's own
library (`listSongs(userId)`, `listProgramsWithSequencesAndSongs(userId)`). Another user's
data never enters the blob, so user count does not affect payload size; it is just more
independent requests, each carrying one person's data. Priming is native-only and
**manual/opportunistic**, not a hot server path.

The only axis that grows a single blob is **programs-per-single-user**, and reference-data
**already** bundles that user's full `songs` + programs-with-sequences today. This design
adds only `role`, `sharedWithEmails`, collaborators, and sequence-song join ids — all
proportional to that one user's own program count. So the blob scales exactly as
reference-data already does. For this app's profile (a single γλέντι musician: tens of
programs, hundreds of songs → a few hundred KB of JSON on a manual sync) this is fine. **If a
single user's program count ever reached the hundreds**, the escape hatch is to move the two
per-program slices (detail + collaborators) back out of the blob and prime them lazily on
program-open, as today — i.e. fall back to a hybrid without redesigning the rest.

## Design

### 1. Extended server payload

`ReferenceData` (`src/lib/referenceData.ts`) and `/api/reference-data` gain the data the
satellite caches held. Concretely, `OfflineProgram` (or a superseding type) grows to carry:

- `role: 'creator' | 'collaborator'` — already computed by `listAccessiblePrograms`, drop
  the discard.
- `sharedWithEmails: string[]` — same source, same fix.
- `collaborators` — the shape `collaboratorsCache` needs (`creator`, `collaborators[]`,
  `currentUser`), from `listCollaborators` / the same queries the per-program endpoint uses.
- Per sequence: the sequence-song **join-row id** (`sequenceSongId`) alongside the existing
  `songId`, so the offline program editor can reorder/remove a specific entry — from the
  `entries` that `listSongsForSequence` already returns.

Titles for sequence songs are resolvable from the blob's existing `songs` (+ `sharedSongs`)
by `songId`, so they need not be duplicated per sequence entry — but if the current
`programDetailCache` consumers read a denormalized `title`, the migration of those consumers
(step 4) decides whether to denormalize it into the payload or resolve it client-side. Prefer
resolving client-side to keep the payload lean; denormalize only if a consumer makes that
awkward.

The endpoint remains a **single** query batch producing a **single consistent snapshot** —
no new round trips beyond what it already issues.

### 2. Envelope with `primedAt`

The cached blob becomes an envelope: `{ ...referenceData, primedAt: string }` (ISO
timestamp of the successful prime). `saveReferenceData` stamps it; `loadReferenceData`
returns it.

`normalizeReferenceData` — the established tolerance point for older on-disk blobs (it
already backfills `programs`, `sharedSongs`, `axisTypes`) — additionally backfills the new
program fields (`role`, `sharedWithEmails`, `collaborators`, sequence-song ids) and a
`primedAt: null` for any blob persisted before this change. **This is a read-path migration,
not an IndexedDB version bump**: the store still `put`s at key `'current'`; only the value's
shape grows, and `normalizeReferenceData` absorbs the old shape. No `DB_VERSION` change, no
`onupgradeneeded` migration.

### 3. `primeOfflineData()` orchestrator

A single function (in `offlineCache.ts` or a small new `offlinePriming.ts`) that:

1. fetches `/api/reference-data` via the token-attaching client used today (the Home button's
   existing `fetch(apiUrl('/api/reference-data'), { Authorization })` path),
2. on success, `saveReferenceData` with a fresh `primedAt`,
3. best-effort **deletes the four orphaned satellite databases**
   (`glentify-songs-list-cache`, `glentify-programs-list-cache`,
   `glentify-program-detail-cache`, `glentify-collaborators-cache`) via
   `indexedDB.deleteDatabase`, wrapped so a failure never fails the prime. (Cleanup of dead
   stores left behind by the retired modules; safe to attempt every prime.)

It returns a success/failure result the caller renders. A `401` clears the token and signals
re-login, exactly as the Home handler does today.

### 4. Retire the satellite caches; repoint consumers

Delete `songsListCache.ts`, `programsListCache.ts`, `programDetailCache.ts`,
`collaboratorsCache.ts` and repoint their consumers (~5 files) to read slices of the loaded
`referenceData`:

- `src/app/admin/songs/page.tsx` — read songs from `referenceData.songs` instead of
  `loadSongsListCache()`; drop the `saveSongsListCache` side-effect on live fetch.
- `src/app/admin/programs/page.tsx` — read programs (now with `role`/`sharedWithEmails`) from
  `referenceData.programs`; drop `saveProgramsListCache`.
- `src/app/admin/local/programs/edit/page.tsx` — read program detail + collaborators from the
  matching `referenceData.programs` entry instead of `loadProgramDetail` /
  `loadCollaboratorsCache`.
- `src/app/admin/local/songs/edit/page.tsx` — read from `referenceData.songs`.

The **offline write path is unaffected**: the satellite caches were only ever *written on
live fetch*; the sync queue and the `*Merge.ts` functions read a base list + queue snapshot
and never wrote these caches. The merge functions' base input simply changes source (a
`referenceData` slice instead of a satellite `load*` call) — a mechanical change, and their
pure unit tests are unaffected in spirit.

### 5. One renamed trigger + auto-prime on reconnect

- Home's button is **renamed** from the misnomer `Συγχρονισμός τραγουδιών` to a
  prepare-for-offline label (e.g. `Προετοιμασία για offline`) and calls `primeOfflineData()`.
  Its existing `syncStatus` states (`syncing`/`done`/`error`/`unauthorized`) carry over.
- `SyncQueueProvider` (mounted once from the root layout, already owns the
  `@capacitor/network` connectivity listener) **also** calls `primeOfflineData()` on a
  reconnect event — **after** draining the write queue, never before. Ordering matters: drain
  flushes this device's queued writes to the server first, then the prime re-pulls true server
  state (including any collaborator changes that survived), so the local view converges to
  server truth instead of a stale optimistic version.
- **Vocabulary stays distinct**: *prime* = pull server → cache (read); *sync* = drain the
  write queue (write). They are separate functions and separately named in UI and code.

### 6. Actionable empty states via `primedAt`

Offline screens that find no usable data read `primedAt` to explain *why*:

- `primedAt === null` (never primed) → "Δεν έχει προετοιμαστεί για offline — πάτησε
  Προετοιμασία" (deep-linking to Home's button), replacing the per-screen stopgap strings
  from `3fd6c36`.
- `primedAt` set → screens may show "Τελευταία προετοιμασία πριν από Xh" for confidence.

The exact strings are an implementation detail; the requirement is that a blank offline
screen names the fix and, when primed, can show recency.

## Non-goals

- **Collaborator write-conflict resolution.** The app's write model is **last-write-wins with
  no conflict detection**: `updateSong` and the shared program/sequence writes apply
  unconditionally (scoped by ownership/access); `updatedAt` is stored but never used as a
  version guard, and there is no `If-Match` / 409-on-stale. If a user and a collaborator both
  edit the same program sequence offline, whoever's queue drains last silently wins. This is a
  **pre-existing property of the offline write model**, independent of priming — this feature
  neither introduces, worsens, nor fixes it. (Songs/taxonomy are strictly owner-scoped, so
  they are not a shared-edit surface at all; only programs and their sequences are.) The
  drain-then-prime ordering makes the local view *converge* to whatever landed on the server,
  which is strictly safer than not re-priming, but is **not** conflict resolution. True
  resolution (version columns + `If-Match` on the shared endpoints + a merge/warn UX) is a
  separate, larger feature and gets its own backlog entry.
- **Offline image upload for songs.** Its own backlog item
  (`docs/feature-backlog.md`), unchanged by this work.
- **Merging the IndexedDB databases into one store.** Explicitly rejected above.
- **Changing web behavior.** Priming is native-only; web is untouched (`primeOfflineData`
  is a no-op / never invoked on web, matching how the Home button is already native-gated).

## Affected surfaces (for the implementation plan)

- `src/lib/referenceData.ts` — extended types + `normalizeReferenceData` backfills.
- `src/app/api/reference-data/route.ts` and `src/db/queries/programs.ts` — stop discarding
  `role`/`sharedWithEmails`; add collaborators + sequence-song join ids to the payload.
- `src/lib/offlineCache.ts` (+ possibly a new `offlinePriming.ts`) — `primedAt` envelope,
  `primeOfflineData()`, orphan-DB cleanup.
- `src/app/page.tsx` — rename + rewire the Home button.
- `src/components/SyncQueueProvider.tsx` — drain-then-prime on reconnect.
- `src/app/admin/songs/page.tsx`, `src/app/admin/programs/page.tsx`,
  `src/app/admin/local/programs/edit/page.tsx`, `src/app/admin/local/songs/edit/page.tsx` —
  repoint reads to `referenceData` slices.
- **Delete**: `src/lib/songsListCache.ts`, `src/lib/programsListCache.ts`,
  `src/lib/programDetailCache.ts`, `src/lib/collaboratorsCache.ts` (and their tests, if any).
- `docs/manual-testing-checklist.md` — new native verification items (prime once, go offline,
  confirm every screen works; never-primed empty-state message; reconnect drains-then-primes).
- `docs/feature-backlog.md` — remove this item; add a "collaborator write-conflict resolution"
  item.

## Testing

Per the project convention (Vitest covers pure logic only; IndexedDB / API routes /
Capacitor are verified manually):

- **Unit**: `normalizeReferenceData` backfilling the new fields + `primedAt: null` from an
  old-shape blob; any pure reshaping helper that turns a `referenceData` program slice into
  what the editor consumers previously got from `programDetailCache` / `collaboratorsCache`;
  the `*Merge.ts` functions continue to pass with their base input sourced from a
  `referenceData` slice.
- **Manual** (native, `docs/manual-testing-checklist.md`): prime on Home → go offline →
  confirm admin songs, admin programs, a never-opened program's editor, Σταθερά προγράμματα,
  Ξεκίνα Live, and axis Tags all work; wipe-and-launch shows the never-primed message;
  reconnect after queuing an offline edit drains then re-primes; orphan satellite databases
  are gone after a prime.
