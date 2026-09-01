# Offline Song CRUD, Phase 1 (text/axes) — Design Spec

## Problem

Sub-project #5 of the "complete all offline features" roadmap (see
`docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md`) is offline CRUD for
songs. George hit the concrete symptom directly: adding a song on the native admin tool while
offline shows "Κανένας άξονας ακόμη" — `SongAxisEditor.tsx` always does a live
`nativeApiFetch('/api/axis-types')` plus one live fetch per lookup table
(`regions`/`genres`/`rhythms`/`dromoi`/`composers`), with zero offline fallback. When any of
those fail, `axisTypes` stays `[]` and the "+ Πρόσθεσε άξονα" UI disappears entirely.

Tracing the full scope surfaced that song create/edit/delete on `admin/songs` (list) and
`admin/local/songs/edit` (edit) are otherwise fully online-only too — same shape of gap as
programs before sub-project #6.

Two things in the fuller design turned out to need genuine cross-action coordination (a
value's real ID isn't known until it syncs, but something else wants to reference it in the
same offline session): attaching a newly-picked image, and creating a brand-new taxonomy value
via "+ Νέα τιμή". Per George's explicit decision, both are deferred to a second spec/plan/SDD
cycle (Phase 2). **This spec covers only Phase 1**: offline create/edit/delete of a song's
text fields and its axis values chosen from already-cached taxonomy values — including the
actual `SongAxisEditor` bug — with no coordination problem to solve.

## Goal

- `SongAxisEditor` renders correctly offline (native), reading axis types and lookup options
  from the already-cached `referenceData` instead of failing silently.
- `admin/songs` (list) renders from a cache when the live fetch fails, with the same
  "χωρίς σύνδεση" treatment as `admin/programs`.
- Create, edit, and delete of a song's title/lyrics/notes/keys/axis-values all queue
  immediately (online or offline) via the existing generic sync-queue engine — no changes to
  its core logic.
- The list optimistically reflects pending creates (non-navigable), pending edits (overlaid),
  and pending deletes (hidden), with permanent failures visible via the existing
  needsAttention handling.

## Non-goals

- Attaching a newly-picked image while offline — Phase 2. In Phase 1, an existing image
  displays read-only in the edit form; the file-picker input is disabled when native.
- Creating a brand-new taxonomy value ("+ Νέα τιμή") while offline — Phase 2, folded in with
  image upload since it needs the same draftId→realId coordination mechanism. In Phase 1 the
  button is disabled whenever the app is running natively, online or offline — see
  Architecture §2 for why this isn't worth special-casing by connectivity: the flow stays
  simple (one native/web split, not a native/web/online/offline matrix) and native admin users
  already have the plain web admin tool available for this rare action in the meantime.
- Any change to `src/lib/syncQueue.ts`'s core engine logic.
- Navigating into a freshly offline-created (not-yet-synced) song's edit page — disallowed,
  same reasoning and precedent as sub-project #6's pending-create programs.
- Offline CRUD for taxonomy values themselves (regions/genres/rhythms/dromoi/composers as
  first-class manageable entities) — separate, still-unstarted roadmap item.
- Real conflict resolution beyond idempotent-delete handling (matches #6).

## Architecture

### 1. Always enqueue, matching #6

`POST /api/songs` and `PATCH /api/songs/[id]` both require the full payload
(`title, lyrics, imageUrl, notes, maleKey, femaleKey, axisValues`) already validated
client-side by the existing form (title required, axis values constructed by
`SongAxisEditor` itself) — no meaningful synchronous server validation is lost by deferring to
the queue. `handleCreate`/`handleUpdate`/`handleDelete` on the native pages always
`enqueue(...)`, online or offline, then optimistically update and move on — the same pattern
sub-project #6 established for programs.

### 2. `SongAxisEditor.tsx` offline fix

The component gains an `isNativeApp()` branch on its data-loading effect:

- **Native:** read `axisTypes` and each lookup table's options directly from
  `loadReferenceData()`'s cached `ReferenceData` (already populated by the home-page sync;
  `referenceData.axisTypes`, `.regions`, `.genres`, `.rhythms`, `.dromoi`, `.composers` already
  exist in that type). No network call, works fully offline.
- **Web:** unchanged — the existing `nativeApiFetch` calls.

This mirrors the exact reuse pattern already established for the suggestions feature
(`songsWithAxes()` reading from `referenceData` instead of a live join). No new caching
module — `referenceData` already has everything this component reads.

The "+ Νέα τιμή" button (`handleCreateValue`) is disabled when `isNativeApp()` (regardless of
connectivity — see Non-goals) with a short inline note that new values require the online
admin tool for now.

### 3. Songs list cache

New module `src/lib/songsListCache.ts`, following `programsListCache.ts` exactly: a dedicated
IndexedDB database (`glentify-songs-list-cache`), storing the single last-successfully-loaded
list.

```ts
export type CachedSong = SongRow; // full row: id, title, lyrics, notes, maleKey, femaleKey, imageUrl, ...

export async function saveSongsListCache(songs: CachedSong[]): Promise<void>;
export async function loadSongsListCache(): Promise<CachedSong[] | null>;
```

`listSongs` already selects every column of `songs` (confirmed by reading
`src/db/queries/songs.ts`) — caching its result verbatim covers both the list view and
pre-filling the edit form; only axis values need a separate source (§5).

`load()` in `admin/songs/page.tsx` tries the live `GET /api/songs` first (try/catch, matching
today's actual UI which only exposes a title-search box — no axis-filter params need
replicating offline). On success, write through to the cache. On failure, fall back to
`loadSongsListCache()`; same three-state treatment as programs (cached+offline-note /
unknown-offline-hide-controls).

### 4. Pending-overlay merge function

New module `src/lib/songsMerge.ts`, mirroring `programsMerge.ts`:

```ts
export interface AxisValueEntry { axisType: string; refId?: number; yearValue?: number }

export interface CreateSongPayload {
  title: string; lyrics: string; imageUrl: string | null; notes: string;
  maleKey: string | null; femaleKey: string | null; axisValues: AxisValueEntry[];
}
export interface UpdateSongPayload extends CreateSongPayload { songId: number }
export interface DeleteSongPayload { songId: number }

export interface DisplaySong {
  id: number | null; // null for a pending create
  title: string;
  status: 'active' | 'pending-create' | 'edited' | 'needs-attention-create' | 'needs-attention-edit' | 'needs-attention-delete';
}

// Pure — no I/O. Same shape of rules as mergeProgramsWithPending:
// - pending delete hides the row, UNLESS needsAttention (e.g. the real, permanent 409 for
//   "song already played in a session" or "is a session's current song" — deleteSong's own
//   documented conflict cases) — a needsAttention delete reappears as a normal active row,
//   never hidden forever for a deletion that never actually happened. This matters more here
//   than for programs: these 409s are genuinely permanent, not a transient races.
// - pending edit overlays its fields onto the existing row (status 'edited'); needsAttention
//   edit reverts to the last-known real fields with a distinct failed tag
// - pending create appends a row with id: null, non-navigable (page enforces this)
export function mergeSongsWithPending(
  base: CachedSong[],
  allQueuedActions: QueuedAction[]
): DisplaySong[];

// Used by the edit page (not the list) to resolve a specific song's current display fields —
// the cached base row overlaid with its own still-queued update, if any, so reopening a song
// mid-sync never silently shows pre-edit data. Pure, same input shape.
export function resolveSongForEdit(
  songId: number,
  base: CachedSong | null,
  allQueuedActions: QueuedAction[]
): { song: CreateSongPayload | null; hasPendingEdit: boolean };
```

Axis values for `resolveSongForEdit`'s *base* (no pending edit) come from the caller filtering
`referenceData.axisValues` by `songId` — this function only handles the overlay, it doesn't
reach into `referenceData` itself (keeps it a pure, single-input-shape function like its
sibling).

### 5. Sync handlers

Three new handlers registered in `src/lib/syncHandlers.ts`, matching the shape of #6's three
exactly (`encodeURIComponent` applied proactively, `redirectOn401: false`, 401/5xx →
`systemic-error`, else `item-error`):

```ts
async function handleCreateSongSync(payload: unknown): Promise<SyncOutcome> {
  const body = payload as CreateSongPayload;
  const res = await nativeApiFetch('/api/songs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined, { redirectOn401: false });
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleUpdateSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId, ...body } = payload as UpdateSongPayload;
  const res = await nativeApiFetch(`/api/songs/${encodeURIComponent(songId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined, { redirectOn401: false });
  if (res.ok) return 'success';
  if (res.status === 404) return 'success'; // already gone — desired end state already true
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleDeleteSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId } = payload as DeleteSongPayload;
  const res = await nativeApiFetch(`/api/songs/${encodeURIComponent(songId)}`,
    { method: 'DELETE' }, undefined, { redirectOn401: false });
  if (res.ok) return 'success';
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  // 409 (song already played in a session / is a session's current song) is a real,
  // permanent conflict — item-error, retried up to the existing cap, then needsAttention.
  // mergeSongsWithPending's needs-attention-delete case (§4) makes the row reappear rather
  // than staying hidden once this happens.
  return 'item-error';
}
```

### 6. Page changes

**`admin/songs/page.tsx`:** `load()` wrapped in try/catch with cache fallback (§3); delete
button enqueues `song-delete` unconditionally instead of calling the live API; the pending-
actions effect (mirroring #6's) feeds `mergeSongsWithPending`, refreshing the base list from
the server when this feature's queued actions drain to zero — the explicit re-check baked in
from the start, not the pendingCount-only version that shipped buggy in #6.

**`admin/songs/new/page.tsx`:** submit enqueues `song-create` unconditionally (no live
attempt) with `imageUrl: null` always (Phase 1 has no offline image picking) when native;
web path unchanged. Image file input disabled when native.

**`admin/local/songs/edit/page.tsx`:** load uses `resolveSongForEdit` (§4) against
`songsListCache` + the queue, plus `referenceData.axisValues` filtered by songId for the base
axis values; submit enqueues `song-update` unconditionally when native. Image file input
disabled when native; existing image (if any) still displays.

## Error handling

| Scenario | Behavior |
|---|---|
| Network failure loading the list, cache present | Show cached list + offline note |
| Network failure loading the list, no cache | "άγνωστο χωρίς σύνδεση", hide create/edit/delete controls |
| Create/edit/delete while offline or online | Always enqueues immediately, optimistic update |
| Queued create permanently fails | needsAttention — pending row stays visible, tagged failed |
| Queued edit permanently fails | needsAttention — row reverts to last-known real fields, tagged failed |
| Queued delete later finds the song already gone (404) | Treated as success |
| Queued delete permanently fails (real 409 — already played, or is a session's current song) | needsAttention — row reappears as a normal active row, never left hidden |
| Reopening the edit page on a song with a still-queued edit | Shows the pending (unsynced) fields, not stale cached data — via `resolveSongForEdit` |

## Testing

- `songsMerge.test.ts`: `mergeSongsWithPending` — no actions; pending create (non-navigable);
  pending edit overlay; pending delete hides; all three needs-attention variants including the
  delete-reappears case; unrelated queued action types ignored. `resolveSongForEdit` — no
  pending edit returns base; pending edit overlays; needsAttention edit falls back to base with
  `hasPendingEdit: false`.
- `SongAxisEditor.test.tsx` (or extend existing coverage if present): native branch reads from
  a stubbed `referenceData` and renders axis types/options without any network call; web branch
  unchanged; "+ Νέα τιμή" disabled when native.
- No test for `songsListCache.ts` (IndexedDB) or the three sync handlers (fetch-calling I/O) or
  the pages — matches established convention.
- Manual on-device verification (named, non-blocking gap): add a song offline with axis values
  chosen from cached options, confirm "Κανένας άξονας ακόμη" no longer appears and the song
  shows pending/non-clickable; go online, confirm it becomes normal; edit an existing song's
  text/axes offline, reopen the edit page before syncing and confirm the pending edit (not
  stale data) shows; delete a song offline, confirm it hides then confirm a real 409 (delete a
  song that's a session's current song) reappears as active rather than vanishing.
