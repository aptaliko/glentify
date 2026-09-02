# Offline Sequence & Taxonomy CRUD — Design Spec

**Date:** 2026-09-02
**Roadmap items:** #6 (sequence-level CRUD inside a fixed program) + #7 (taxonomy CRUD: regions/genres/rhythms/dromoi/composers), both made to work offline.
**Status:** Approved approach; ready for implementation planning.

## 1. Goal & scope

Make two already-shipped **online** admin surfaces work **offline** on the native (Capacitor) build, following the established always-enqueue offline architecture (sub-projects #1–#5):

- **#6 — Sequences inside a Σταθερό Πρόγραμμα.** The native page `src/app/admin/local/programs/edit/page.tsx` already renders the full sequence-editing UI as a thin client (`nativeApiFetch` straight to the server); offline it shows *"Η επεξεργασία σειρών δεν είναι διαθέσιμη χωρίς σύνδεση."* The six operations must instead queue offline and overlay locally:
  1. Add a sequence
  2. Rename a sequence
  3. Delete a sequence
  4. Add a song to a sequence (search + pick)
  5. Remove a song from a sequence
  6. Reorder songs within a sequence (↑/↓)
- **#7 — Taxonomy admin (regions, genres, rhythms, dromoi, composers).** The five pages under `src/app/admin/{regions,genres,rhythms,dromoi,composers}/page.tsx` each read a live list and offer create + delete. All must work offline:
  1. **Read** the list offline (from the manually-synced `referenceData` cache).
  2. **Create** a value offline (enqueue).
  3. **Delete** a value offline (enqueue).
  4. **Create-and-immediately-assign:** unblock **"+ Νέα τιμή"** inside `SongAxisEditor` so a value created offline can be assigned to a song in the *same* offline session (Phase-1 song CRUD explicitly deferred this).

Both #6 and #7 introduce the same underlying problem — an entity created offline has no server ID yet, but later offline actions reference it — so they share **one generic draft-ID resolution mechanism** (§3), which is the core of this spec and the reason they ship together.

### In scope
- Offline queue + local overlay for all six sequence operations and all taxonomy create/delete operations.
- The generic draft-ID resolution mechanism spanning taxonomy values, songs, sequences, and sequence-song entries.
- Unblocking "+ Νέα τιμή" in `SongAxisEditor` on native, wired to the mechanism.

### Out of scope (non-goals)
- **Taxonomy rename.** The web pages only expose create + delete; there is no rename to make offline. (Regions have a PATCH route, but no client UI uses it.) Not adding new feature surface.
- **Offline validation of taxonomy deletes.** The cached data is stale (manual-sync only), so a local "is it referenced?" pre-check would give false confidence. We allow the delete and let a real server `409` land as `needsAttention` (§5).
- **Attaching a newly-picked song image offline.** Still deferred, exactly as in Phase-1 song CRUD.
- **iOS.** Parked (blocked on Xcode).
- **A needsAttention recovery/retry UI.** Out of scope here, same as every prior sub-project; failed items surface via the existing badge/needsAttention flags.

## 2. Architecture at a glance

Reuse every existing primitive unchanged:

- **`src/lib/syncQueue.ts`** — strict-FIFO, serialized. Drains eligible (non-needsAttention) items **in enqueue order, one at a time**. `success` removes an item; `item-error` sends it to the back and increments attempts (→ `needsAttention` at 3); `systemic-error` (incl. any offline fetch rejection) halts the whole pass, untouched. **No engine changes.**
- **`src/lib/syncHandlers.ts`** — one handler per action type, registered once. New handlers added here.
- **Per-feature IndexedDB cache + pure merge function** for the local overlay, driven by `SyncQueueProvider` / `notifyQueueChanged`.
- **Sync-handler outcome contract:** `redirectOn401: false`; `401`/`5xx` → `systemic-error`; `404` → `success` (idempotent — target already gone / access gone; sequence routes return **404**, not 403, for no-access); real `409` → `item-error` (retried to cap → `needsAttention`); `403` on taxonomy delete (non-owner) → `item-error` (permanent, surfaces via `needsAttention`); anything else → `item-error`.

New modules this spec adds:

| Module | Responsibility |
|---|---|
| `src/lib/draftIds.ts` | Mint device-unique **negative** draft IDs; the persisted `draft → real` resolution store; `resolveId`/`recordResolution`. |
| `src/lib/taxonomyMerge.ts` | Pure overlay of pending create/delete actions onto a `referenceData` taxonomy list (per entity). |
| `src/lib/programDetailCache.ts` | IndexedDB cache (`glentify-program-detail-cache`) of a program's full **editable** sequence structure (incl. join-row IDs). |
| `src/lib/sequencesMerge.ts` | Pure overlay of pending sequence actions onto a cached program detail. |
| New handlers in `src/lib/syncHandlers.ts` | `region-create`/`-delete` (×5 taxonomy entities), `sequence-create`/`-rename`/`-delete`, `sequence-add-song`/`-remove-song`/`-reorder`. |

## 3. The generic draft-ID resolution mechanism (core)

### 3.1 Draft IDs are negative integers
Every entity ID in the system is a positive Postgres serial. So an offline-created entity is assigned a **negative** integer draft ID via `mintDraftId()`. This keeps every existing payload field typed `number` (or `number | null`) — `axisValues[].refId`, `sequence.id`, `songId`, `sequenceSongId`, region `parentId` — with **zero type churn**. A negative ID renders fine in the overlay UI and is unambiguously "not yet real."

```ts
// src/lib/draftIds.ts
let counter = 0;
export function mintDraftId(): number {
  // Device-unique, monotonic, always negative. Date.now() guards across app
  // restarts; the per-session counter guards rapid same-ms taps.
  return -(Date.now() * 1000 + (counter++ % 1000));
}
export function isDraftId(id: number): boolean {
  return id < 0;
}
```

### 3.2 The resolution store
An IndexedDB key-value store (`glentify-draft-resolutions`) mapping a namespaced key to the real server ID:

```ts
type DraftEntity =
  | 'region' | 'genre' | 'rhythm' | 'dromos' | 'composer'
  | 'song' | 'sequence' | 'sequence-song';

// key = `${entity}:${draftId}`  →  realId (positive)
export async function recordResolution(entity: DraftEntity, draftId: number, realId: number): Promise<void>;
export async function resolveId(entity: DraftEntity, id: number): Promise<number | null>;
// resolveId returns id unchanged when id >= 0 (already real); the mapped real id
// when a draft has been resolved; null when a draft is still unresolved.
```

The store is **persisted** because a sync pass can span app restarts.

### 3.3 How ordering does the work (no engine changes)
Because the queue is strict FIFO and every create is enqueued *before* the action that references it:

1. A create action (e.g. `region-create`) carries its own `draftId` in the payload. On `success` (the `201` response's real `id`), its handler calls `recordResolution('region', draftId, realId)`.
2. A later action referencing that draft (e.g. `song-update` whose `axisValues[].refId` is the negative draft) resolves each negative ID via `resolveId` **before** building its request body:
   - all resolved → send with real IDs → normal outcome.
   - any still unresolved → return **`item-error`** (do not send a bad payload). The item requeues to the back; the create ahead of it will resolve on this or a later pass.

**Self-correcting ordering:** if the create hits `item-error` and moves to the back, the dependent that follows also hits "unresolved → `item-error`" and moves behind it, restoring their original relative order. If the create ultimately fails to `needsAttention` (3 attempts), the dependent likewise exhausts its attempts and lands in `needsAttention` — the agreed **dependent-failure default**: the assignment is parked/visible, never silently dropped.

### 3.4 Which fields get resolved, per action
Every handler resolves the negative IDs in its own payload before sending:

| Action | Fields resolved | Records on success |
|---|---|---|
| `region-create` (& genre/rhythm/dromos/composer) | `parentId` (regions only, may be a draft parent) | `recordResolution('<entity>', draftId, realId)` |
| `region-delete` (×5) | `id` | — |
| `song-create` / `song-update` | `axisValues[].refId` (draft taxonomy values); `songId` (update of a still-unsynced draft song) | `song-create` records `song` |
| `sequence-create` | `programId` (may be a draft program from offline program-create) | records `sequence` |
| `sequence-rename` / `sequence-delete` | `sequenceId` | — |
| `sequence-add-song` | `sequenceId`, `songId` (either may be draft) | records `sequence-song` (the join-row id from the response) |
| `sequence-remove-song` | `sequenceSongId` | — |
| `sequence-reorder` | `sequenceId`, every id in `orderedIds[]` | — |

## 4. Feature designs

### 4.1 Taxonomy (#7)

**Read (offline).** The five admin pages currently call `nativeApiFetch('/api/regions')` on mount with no fallback. Change each to: try live; on success render + (the list is already in `referenceData` via manual sync, so no new cache is needed for reads); on failure, read the entity list from `loadReferenceData()` and overlay pending actions via `taxonomyMerge`. Pending creates appear (with their negative draft id, marked *"(εκκρεμεί)"*); pending deletes are hidden.

**Create (offline).** `handleCreate` always `enqueue('region-create', { draftId, name, parentId })` (draftId minted up front), then `notifyQueueChanged()`. The new value shows immediately via the overlay.

**Delete (offline).** `handleDelete` always `enqueue('region-delete', { id })`. The overlay hides the value immediately. If `id` is a still-unsynced draft, no special queue surgery is needed for correctness: on sync the `region-create` runs first (real id recorded), then `region-delete` resolves the draft to that real id and deletes it (`200`/`404` → `success`). The merge just hides it locally in the meantime.

**Create-and-assign (`SongAxisEditor`, "+ Νέα τιμή").** On native + offline, "+ Νέα τιμή" is currently disabled. Unblock it: tapping it mints a draftId, `enqueue('<entity>-create', { draftId, name, parentId: null })`, adds the draft value to the editor's in-memory option list (so it's selectable now and shows in the dropdown), and selects it. The song's later `song-update`/`song-create` carries `refId = draftId`; §3 resolves it at sync. Because the taxonomy-create is enqueued when the button is tapped (before the song save), FIFO ordering holds.

### 4.2 Sequences (#6)

**Cache.** `referenceData.programs` (`OfflineProgram`) holds nested sequences but only `songIds[]`, not the join-row `sequenceSongId` that remove/reorder require. So introduce `programDetailCache.ts` (`glentify-program-detail-cache`), populated incrementally from the edit page's live loads — exactly the `collaboratorsCache` pattern:

```ts
interface CachedProgramDetail {
  programId: number;
  title: string;
  role: 'creator' | 'collaborator';
  sequences: {
    id: number;
    title: string;
    position: number;
    songs: { sequenceSongId: number; songId: number; title: string }[];
  }[];
  cachedAt: string;
}
```
- On a successful `loadProgram` (the sequence list), write title/role/sequences (songs left as last-cached).
- On a successful `refreshSequenceSongs(seqId)` (an expand), write that sequence's `songs`.
- A program never opened online has no cache entry → offline keeps today's *"δεν είναι διαθέσιμη χωρίς σύνδεση"* message, consistent with `collaboratorsCache`'s unavailable-offline fallback.

**Offline reads.** When the live load fails, read `programDetailCache`, overlay pending sequence actions via `sequencesMerge`, and render. Song **search** for "add song" reads the owner-scoped `songsListCache`/`referenceData.songs` (never `sharedSongs`).

**Writes.** Each of the six handlers switches from "fire live `nativeApiFetch`, then reload" to **always-enqueue**:

| Op | Action + payload |
|---|---|
| Add sequence | `enqueue('sequence-create', { draftId, programId, title })` |
| Rename sequence | `enqueue('sequence-rename', { sequenceId, title })` |
| Delete sequence | `enqueue('sequence-delete', { sequenceId })` |
| Add song | `enqueue('sequence-add-song', { draftId, sequenceId, songId })` (draftId = the new join row) |
| Remove song | `enqueue('sequence-remove-song', { sequenceSongId })` |
| Reorder | `enqueue('sequence-reorder', { sequenceId, orderedIds })` — **full ordered array** of `sequenceSongId`s |

**Reorder is idempotent, last-wins.** The payload is always the complete ordered array, never a "move X up one" delta — so repeated offline reorders collapse to the last one, surviving a stale base, mirroring the song-update last-queued-edit-wins already tested in Phase 1.

**Merge overlay (`sequencesMerge`).** Applies pending actions onto the cached detail: create adds a draft sequence; rename/delete adjust in place; add-song appends a draft entry (title looked up from the songs cache); remove-song hides an entry; reorder reorders. Create-then-delete of the same draft sequence (or add-then-remove of the same draft entry) needs no queue surgery: on sync the create resolves to a real id and the later delete/remove resolves that id and deletes it. The overlay just shows the net local state in the meantime.

## 5. Sync handlers & outcome contract (per action)

All handlers use `redirectOn401: false` and the shared contract. Specifics:

- **`<entity>-create`** → POST. `201` → `recordResolution` + `success`. `401`/`5xx` → `systemic-error`. `400` (validation) → `item-error`. Unresolved draft `parentId` → `item-error`.
- **`<entity>-delete`** → DELETE. `ok`/`404` → `success` (already gone). `403` (non-owner) → `item-error` (permanent; surfaces via `needsAttention`). `409` (referenced) → `item-error` (the expected conflict; → `needsAttention`). `401`/`5xx` → `systemic-error`.
- **`sequence-create`** → POST `/api/programs/{programId}/sequences`. Resolve draft `programId` first. `201` → record + `success`. `404` → `success` (program/access gone). `401`/`5xx` → `systemic-error`. else `item-error`.
- **`sequence-rename`** → PATCH `…/sequences/{seqId}`. Resolve `sequenceId`. `ok` → `success`. `404` → `success`. `401`/`5xx` → `systemic-error`. else `item-error`.
- **`sequence-delete`** → DELETE `…/sequences/{seqId}`. Resolve `sequenceId`. `ok`/`404` → `success`. `401`/`5xx` → `systemic-error`. else `item-error`.
- **`sequence-add-song`** → POST `…/sequences/{seqId}/songs`. Resolve `sequenceId` + `songId`. `201` → record join-row id + `success`. `404` → `success` (sequence/song/access gone). `401`/`5xx` → `systemic-error`. else `item-error`.
- **`sequence-remove-song`** → DELETE `…/sequences/{seqId}/songs/{entryId}`. Resolve `sequenceSongId`. `ok`/`404` → `success`. `401`/`5xx` → `systemic-error`. else `item-error`.
- **`sequence-reorder`** → PATCH `…/sequences/{seqId}/songs`. Resolve `sequenceId` + every `orderedIds[]` entry. `ok` → `success`. `404` → `success`. `401`/`5xx` → `systemic-error`. else `item-error`.

**Unresolved-draft rule (applies to every handler above):** if any negative ID in the payload has no resolution yet, return `item-error` immediately (no fetch), so the referenced create ahead in the queue can resolve first.

## 6. File structure

- **Create:** `src/lib/draftIds.ts`, `src/lib/taxonomyMerge.ts`, `src/lib/programDetailCache.ts`, `src/lib/sequencesMerge.ts` (+ their `.test.ts`).
- **Modify:** `src/lib/syncHandlers.ts` (new handlers + `initSyncHandlers` registrations); `src/app/admin/{regions,genres,rhythms,dromoi,composers}/page.tsx` (offline read overlay + enqueue create/delete); `src/app/admin/local/programs/edit/page.tsx` (offline read from `programDetailCache` + enqueue the six ops, incremental cache writes); `src/components/SongAxisEditor.tsx` (unblock "+ Νέα τιμή" offline, wire to draft create).
- **Reuse unchanged:** `syncQueue.ts`, `offlineCache.ts`/`referenceData.ts`, `songsListCache.ts`, `SyncQueueProvider`, `nativeApiFetch`.

## 7. Testing strategy

Vitest runs **node environment only — no DOM**. Tests target the pure/logic modules, matching Phase 1:

- **`draftIds.test.ts`** — `mintDraftId` uniqueness + always-negative; `isDraftId`; resolution store record/resolve; `resolveId` passthrough for real IDs, `null` for unresolved drafts.
- **`taxonomyMerge.test.ts`** — pending create appears; pending delete hides; a draft that is both created and deleted shows as absent in the overlay.
- **`sequencesMerge.test.ts`** — each of the six ops overlays correctly; reorder is last-wins; a draft sequence/entry both created and deleted shows as absent; draft entries carry looked-up titles.
- **`programDetailCache.test.ts`** — round-trip; incremental song-list write updates one sequence without clobbering others.
- **Handler tests** (extend `syncHandlers.test.ts` if present, else add) — the outcome contract per action, **especially** the unresolved-draft → `item-error` path and the `recordResolution`-on-success path; `404`/`403`/`409` mappings.

## 8. Implementation ordering (for the plan)

One spec, sequenced in three layers so each is independently testable:
1. **Foundation:** `draftIds.ts` (+ tests) — nothing else can resolve drafts without it.
2. **Taxonomy (#7):** `taxonomyMerge.ts`, the five pages, the create/delete handlers, and the `SongAxisEditor` "+ Νέα τιμή" wiring — exercises the mechanism end-to-end on the simplest entities.
3. **Sequences (#6):** `programDetailCache.ts`, `sequencesMerge.ts`, the edit-page rewire, and the six sequence handlers.

## 9. Manual testing
On-device manual testing steps for both features are appended to `docs/manual-testing-checklist.md` **after** implementation completes (per the standing request), so they can be run against the built app.
