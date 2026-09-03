# Offline song image upload — design

- **Date:** 2026-09-03
- **Status:** Design approved; implementation plan not yet written.
- **Backlog item:** "Offline image upload for songs (#5 Phase 2 remainder)"
  (`docs/feature-backlog.md`).
- **Builds on:** `docs/superpowers/specs/2026-09-01-offline-song-crud-phase1-design.md`
  (§Non-goals explicitly deferred offline image attachment) and the offline-sync
  foundation (`docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md`).

## Problem

During Phase 1 of offline song CRUD, the song image file-picker was disabled whenever
the app runs natively (online *or* offline): a native user can edit a song's text fields
offline, but the image input is `disabled` and shows a "use the admin website" note. An
existing image still renders read-only. This feature lets a native user pick, replace, or
remove a song image while offline, and reconciles the uploaded blob once the device
reconnects.

Image upload today is a **Vercel Blob client-upload**: the browser calls `upload()` from
`@vercel/blob/client`, which hits `POST /api/songs/image-upload` for a short-lived token,
uploads the bytes **directly** to Vercel Blob storage, and then the song write carries the
resulting public `imageUrl`. That flow requires connectivity end to end, so it has no
offline path.

Native song writes (`song-create`, `song-update`) *already* always go through the offline
sync queue regardless of connectivity. The image simply needs to ride that same path.

## Core decision: a separate payload field, never a sentinel in `imageUrl`

The offline-picked image is referenced by a **new payload field**, not by overloading
`imageUrl`:

```
CreateSongPayload / UpdateSongPayload gain:
  pendingImageBlobId: number | null    // a draft blob id (negative), or null

imageUrl stays:  string (a real public URL) | null    // NEVER a sentinel
```

`imageUrl` therefore remains a real URL or `null` at **every existing read site** —
`LiveSessionView.tsx`, `programPdfLocal.ts`, `offlineProgramView.ts`, `sessionStore.ts`,
`programs/local/program`, `admin/local/programs/edit`. None of those change, and no
sentinel string can leak into the PDF generator or the live-session display mid-γλέντι.
This directly honours CLAUDE.md's "thread a new field through every read path
independently" warning by *not* introducing a value those paths would have to learn to
handle.

The three edit cases are representable cleanly:

| Case                     | `imageUrl`   | `pendingImageBlobId` |
| ------------------------ | ------------ | -------------------- |
| Add where none exists    | `null`       | `-123`               |
| Replace an existing image| `<old url>`  | `-123`               |
| Remove an existing image | `null`       | `null`               |
| Untouched                | `<url>`/`null` | `null`             |

## Architecture

### New modules (all under `src/lib/`)

- **`localImageStore.ts`** — a dedicated, single-purpose IndexedDB database (its own
  `DB_NAME`, following `syncQueueStorage.ts`'s stated precedent of *not* sharing
  `glentify-offline`, to avoid multi-module version-upgrade coordination on a database the
  reference-data cache critically holds). Stores the picked `Blob` **directly** (structured
  clone — no base64 round-trip, which would inflate a 10 MB image by ~33%). API roughly:
  - `putLocalImage(draftBlobId, blob, contentType, filename): Promise<void>`
  - `getLocalImage(draftBlobId): Promise<{ blob: Blob; contentType: string; filename: string } | null>`
  - `deleteLocalImage(draftBlobId): Promise<void>`
- **Blob resolution map** — a persisted `draftBlobId → uploadedUrl` (string-valued) record.
  This is the string analogue of `draftIds.ts`'s number→number resolution and is
  **required for idempotency**: `/api/songs/image-upload` sets `addRandomSuffix: true`, so a
  retried `upload()` would mint a *new* pathname → an orphaned, billed, never-referenced
  blob. May live as a small store inside `localImageStore.ts` or a sibling
  `imageResolutions.ts`; the plan decides. API roughly:
  - `recordImageResolution(draftBlobId, url): Promise<void>`
  - `loadImageResolution(draftBlobId): Promise<string | null>`

The queue payload carries only the small `pendingImageBlobId` number — never bytes — so the
whole-array read-modify-write in `syncQueueStorage.ts` never rewrites image data.

### Pick-time validation (shared helper)

A pure helper validates a picked file against the **same limits the upload route declares**
(`allowedContentTypes: ['image/png','image/jpeg','image/webp']`,
`maximumSizeInBytes: 10 * 1024 * 1024`). On violation it returns a reason and nothing is
stored; the page shows an inline Greek error. Making a rejected image near-impossible by
the time bytes reach the handler is what lets the sync handler keep the simple rule "any
`upload()` throw is a `systemic-error`" without having to classify `BlobError` subclasses
(a genuine hard rejection would otherwise block the queue forever, since the queue treats a
throw as retry-forever-systemic, not permanent).

### Sync handler changes (`syncHandlers.ts`)

`handleCreateSongSync` and `handleUpdateSongSync` gain an image step that runs **before** the
existing song POST/PATCH when `pendingImageBlobId != null`. Order matters:

1. **Consult the resolution map first.** If `draftBlobId` already resolves to a URL, use it
   and **skip upload entirely**.
2. Else **load bytes** from `localImageStore`. If bytes are missing *and* unresolved →
   return `item-error` (wait; the create/whatever that owns these bytes is elsewhere — in
   practice this is a defensive branch, since the same submit that set the field also stored
   the bytes).
3. Else **`upload()`** via `@vercel/blob/client` to `apiUrl('/api/songs/image-upload')`
   (native's own origin serves no API — must be the absolute deployed URL, same as the
   page) with the bearer token from `getAuthToken()`. On success, `recordImageResolution`.
   A thrown/rejected `upload()` propagates out of the handler and is caught by
   `processQueueWith` as `systemic-error` → the pass stops, **no attempt consumed** → clean
   retry on reconnect.
4. Put the resolved URL into the request body's `imageUrl`, then perform the song write
   exactly as today.
5. On the song write's **success**, `deleteLocalImage(draftBlobId)`.

Checking the map before the bytes is what makes "delete bytes on success" safe when two
queued updates share one blob id (see the edit-twice-offline edge case).

The existing `imageUrl` semantics of the write are unchanged: when `pendingImageBlobId` is
`null`, the handler sends `imageUrl` (a real URL or `null`) verbatim — this covers the
untouched, removed, and web cases with no special handling.

## Data flow (native, offline)

```
Pick image  ──▶ validate (MIME + size)
                 │ ok
                 ▼
            mintDraftId()  ──▶ putLocalImage(draftBlobId, blob)
                                 │
                                 ▼
            form state: pendingImageBlobId = draftBlobId
                        preview = URL.createObjectURL(blob)
                                 │  submit
                                 ▼
            enqueue('song-create' | 'song-update',
                    { ...fields, imageUrl, pendingImageBlobId })
                                 │  connectivity returns
                                 ▼  processQueue → handler
            resolution map? ─ yes ─▶ reuse URL, skip upload
                     │ no
                     ▼
            upload() ──▶ recordImageResolution(draftBlobId, url)
                                 │
                                 ▼
            song POST/PATCH with imageUrl = url
                                 │ success
                                 ▼
            deleteLocalImage(draftBlobId)
```

## UI surfaces

- **`admin/songs/new` (native branch)** — remove `disabled={native}` and the "not
  supported yet" note. On pick: validate → `mintDraftId()` → `putLocalImage` → set
  `pendingImageBlobId` + a `createObjectURL` preview. The existing native submit already
  enqueues `song-create`; the payload now also carries `pendingImageBlobId`.
- **`admin/local/songs/edit` (native edit twin)** — enable the picker the same way. Preview:
  when `pendingImageBlobId` is set, render the object URL from `localImageStore`; else render
  `imageUrl` as today. `resolveSongForEdit` passes the number through unchanged — the merge
  layer stays pure; the `createObjectURL` IO happens in the page effect.
- **Remove control ("everywhere")** — a small "Αφαίρεση εικόνας" button shown whenever an
  image (real or pending) is displayed, on **web edit, native new, native edit**. It clears
  the preview, sets `imageUrl = null` and `pendingImageBlobId = null`, and — if a draft blob
  was picked in this session — deletes those local bytes.
- **`admin/songs/[id]` (web edit)** — gains only the remove button. Its add/replace eager
  `upload()` path is otherwise byte-for-byte unchanged; `pendingImageBlobId` is always
  absent/`null` on web.
- **`admin/songs/new` (web branch)** — gains the same remove/clear-selection button for
  consistency.
- **Object-URL lifecycle** — revoke the preview object URL on unmount and on re-pick
  (`URL.revokeObjectURL`) to avoid leaks.

## Edge cases

- **Edit-twice-offline, image picked once.** Both `song-update`s carry the same
  `pendingImageBlobId` (`resolveSongForEdit` re-seeds the second form from the first pending
  payload). Handler 1 uploads, records the resolution, deletes the bytes on success. Handler
  2 finds the id already resolved → reuses the URL, no re-upload, no missing-bytes error.
- **Upload succeeds, song write returns `item-error`.** The URL is already recorded, so the
  requeued attempt reuses it — no orphan blob.
- **Upload succeeds, song write returns `404` (treated as success — song deleted before the
  update synced).** Bytes are deleted; the uploaded blob is orphaned. Acceptable (rare, and
  no worse than web's replace-then-delete).
- **Offline during sync.** `upload()` throws → `systemic-error` → pass stops with no attempt
  consumed → retries cleanly on reconnect.
- **Permanent `needsAttention`** (song write hits the 3-attempt cap). **Orphan local bytes
  are retained, not cleaned up** — a deliberate decision, consistent with there being no v1
  `needsAttention` recovery UI. Stated here so it is not an accident.
- **Replace.** The old `imageUrl` is overwritten by the resolved URL in the body; the old
  Vercel Blob is orphaned exactly as web's replace already orphans it — no new behaviour.

## Testing

Per repo convention (vitest for pure logic only):

- **`songsMerge.ts`** — thread `pendingImageBlobId` through `CreateSongPayload` /
  `UpdateSongPayload` and `resolveSongForEdit`; add vitest cases proving the field
  round-trips through a pending edit and that the twice-edited-share case yields the last
  update's fields (and its `pendingImageBlobId`).
- **Pick-time validation helper** — vitest for MIME/size accept + reject.
- **Manual-test only** (IndexedDB / Capacitor / network, no automated coverage by
  convention): `localImageStore.ts`, the resolution map, the handler upload branch, and all
  page UI. Add rows to `docs/manual-testing-checklist.md` covering: pick+add offline →
  reconnect → image appears; replace offline; remove offline; edit-twice-offline with one
  pick; airplane-mode during sync then reconnect; oversized/wrong-type file rejected at pick.

## Non-goals

- The **web upload path stays byte-for-byte the same** (eager direct `upload()`); web gains
  only the remove button.
- **No standalone "upload image to existing song" action** — an image is always submitted as
  part of a song write.
- **No songs-list pending-image indicator** — `mergeSongsWithPending` carries no image data;
  a pending image simply appears once the song syncs.
- **No cleanup of orphaned Vercel Blobs or orphaned local bytes** — matches the existing
  replace-orphaning behaviour and the no-`needsAttention`-recovery-UI stance.
