# Offline Song Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a native user pick, replace, or remove a song image while offline, reconciling the uploaded blob through the existing sync queue once the device reconnects; and add a "remove image" control to the web edit/new pages so both platforms reach add/replace/remove parity.

**Architecture:** The offline-picked image is referenced by a new `pendingImageBlobId` payload field (a negative draft id) while `imageUrl` stays a real public URL or `null` at every read site. Bytes live in a dedicated IndexedDB store; a persisted `draftBlobId → uploadedUrl` map gives the upload idempotency. The upload is folded into the existing `song-create`/`song-update` sync handlers (no separate action), which upload the bytes via Vercel Blob client-upload, then perform the song write with the resolved URL.

**Tech Stack:** Next.js (App Router, this repo's forked version — read `node_modules/next/dist/docs/` before touching routing), React client components, TypeScript, `@vercel/blob/client` (`upload`), IndexedDB, Capacitor (Android WebView), Vitest, daisyUI/Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-03-offline-song-image-upload-design.md`

## Global Constraints

- **`imageUrl` is NEVER a sentinel** — always a real public URL or `null` at every read site. The offline reference is carried in the separate `pendingImageBlobId` field only.
- **Allowed image types:** `image/png`, `image/jpeg`, `image/webp`. **Max size:** `10 * 1024 * 1024` bytes (10 MB). These must match `src/app/api/songs/image-upload/route.ts` exactly.
- **Native must call the API through the deployed origin** — use `apiUrl('/api/songs/image-upload')` and `nativeApiFetch`, never bare `fetch`; native's own origin serves no API.
- **Draft ids are negative** (`mintDraftId()` from `src/lib/draftIds.ts`). Real ids are `>= 0`.
- **Testing convention (CLAUDE.md):** Vitest covers **pure logic only**. Modules that touch IndexedDB, Capacitor, `@vercel/blob/client`, or the network get **no** automated tests — they are verified with `npx tsc --noEmit` + `npm run lint` and tracked in `docs/manual-testing-checklist.md`.
- **UI strings are Greek.** Match the existing tone of neighboring strings.
- **Web upload path is unchanged** except for the added remove button — web keeps its eager direct `upload()`.
- Commit after every task with a `feat:`/`test:`/`docs:` message.

---

### Task 1: Pick-time image validation helper (pure)

A pure validator so a rejected image is near-impossible before bytes ever reach the sync handler — this is what lets the handler keep the simple "any `upload()` throw = systemic-error" rule.

**Files:**
- Create: `src/lib/imageValidation.ts`
- Test: `src/lib/imageValidation.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ALLOWED_IMAGE_TYPES: readonly ['image/png', 'image/jpeg', 'image/webp']`
  - `MAX_IMAGE_BYTES: number` (= `10 * 1024 * 1024`)
  - `IMAGE_ACCEPT_ATTR: string` (= `'image/png,image/jpeg,image/webp'`, for the `<input accept>`)
  - `type ImageValidationResult = { ok: true } | { ok: false; reason: string }`
  - `validateImageFile(file: { type: string; size: number }): ImageValidationResult` — takes only `{ type, size }` so tests need no real `File`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/imageValidation.test.ts
import { describe, it, expect } from 'vitest';
import { validateImageFile, MAX_IMAGE_BYTES } from './imageValidation';

describe('validateImageFile', () => {
  it('accepts a png within the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: 1024 })).toEqual({ ok: true });
  });

  it('accepts jpeg and webp', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1 }).ok).toBe(true);
    expect(validateImageFile({ type: 'image/webp', size: 1 }).ok).toBe(true);
  });

  it('rejects an unsupported mime type with a Greek reason', () => {
    const result = validateImageFile({ type: 'image/gif', size: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('rejects a file over the size limit', () => {
    const result = validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 });
    expect(result.ok).toBe(false);
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateImageFile({ type: 'image/png', size: MAX_IMAGE_BYTES }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/imageValidation.test.ts`
Expected: FAIL — `imageValidation.ts` does not exist / `validateImageFile` not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/imageValidation.ts

// Mirrors the ceilings declared in src/app/api/songs/image-upload/route.ts. Keeping these
// in sync is what makes a server-side upload rejection near-impossible, so the sync handler
// can treat any upload() throw as a transient systemic-error rather than a permanent block.
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_ACCEPT_ATTR = ALLOWED_IMAGE_TYPES.join(',');

export type ImageValidationResult = { ok: true } | { ok: false; reason: string };

export function validateImageFile(file: { type: string; size: number }): ImageValidationResult {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: 'Μη υποστηριζόμενος τύπος εικόνας. Επιτρέπονται PNG, JPEG ή WebP.' };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: 'Η εικόνα ξεπερνά το όριο των 10MB.' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/imageValidation.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/imageValidation.ts src/lib/imageValidation.test.ts
git commit -m "feat: pure image pick-time validation helper"
```

---

### Task 2: Add `pendingImageBlobId` to the song payload types and thread it through `resolveSongForEdit`

Extends the payload interfaces and the edit-resolver so the field round-trips, and updates the existing tests (which assert exact object shapes) to include it. `mergeSongsWithPending` is deliberately left untouched — no list indicator (spec §Non-goals).

**Files:**
- Modify: `src/lib/songsMerge.ts`
- Test: `src/lib/songsMerge.test.ts` (update existing expectations + add new cases)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `CreateSongPayload` and `UpdateSongPayload` gain `pendingImageBlobId: number | null`.
  - `resolveSongForEdit(...)` now returns a `song` object that includes `pendingImageBlobId` (from the pending payload, or `null` from the base row).

- [ ] **Step 1: Update the failing tests**

In `src/lib/songsMerge.test.ts`, add `pendingImageBlobId: null` to the shared `emptySongFields`:

```ts
const emptySongFields = { imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: [] as AxisValueEntry[], pendingImageBlobId: null };
```

In the `resolveSongForEdit` describe block, every expected `song: { ... }` object must gain `pendingImageBlobId`. Update the four existing expectations so each `song` literal includes it:

- "returns the base row ... no pending edit" → `song` gains `pendingImageBlobId: null`.
- "overlays a pending edit" → the queued payload gains `pendingImageBlobId: null` and the expected `song` gains `pendingImageBlobId: null`.
- "falls back to the base fields ..." → expected `song` gains `pendingImageBlobId: null`.
- "two queued edits, later wins" → both queued payloads gain `pendingImageBlobId: null`, expected `song` gains `pendingImageBlobId: null`.

Then add two NEW cases proving the field carries through:

```ts
  it('carries a pending image blob id from the queued edit into the resolved song', () => {
    const actions = [
      makeAction({
        type: 'song-update',
        payload: { songId: 1, title: 'Με εικόνα', lyrics: null, imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: [], pendingImageBlobId: -42 },
      }),
    ];
    const result = resolveSongForEdit(1, base, baseAxisValues, actions);
    expect(result.song?.pendingImageBlobId).toBe(-42);
    expect(result.song?.imageUrl).toBe(null);
  });

  it('when the same song is edited twice offline, the later edit\'s pending image blob id wins', () => {
    const actions = [
      makeAction({ type: 'song-update', payload: { songId: 1, title: 'Πρώτη', lyrics: null, imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: [], pendingImageBlobId: -1 } }),
      makeAction({ type: 'song-update', payload: { songId: 1, title: 'Δεύτερη', lyrics: null, imageUrl: null, notes: null, maleKey: null, femaleKey: null, axisValues: [], pendingImageBlobId: -2 } }),
    ];
    const result = resolveSongForEdit(1, base, baseAxisValues, actions);
    expect(result.song?.pendingImageBlobId).toBe(-2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/songsMerge.test.ts`
Expected: FAIL — the `resolveSongForEdit` returned object lacks `pendingImageBlobId`, so the updated `.toEqual` expectations and the two new `.pendingImageBlobId` assertions fail; TypeScript also errors that `pendingImageBlobId` is not on the payload type.

- [ ] **Step 3: Implement the type + resolver changes**

In `src/lib/songsMerge.ts`, add the field to `CreateSongPayload`:

```ts
export interface CreateSongPayload {
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  axisValues: AxisValueEntry[];
  // A negative draft id referencing locally-stored image bytes to upload on sync, or null.
  // imageUrl stays a real URL/null; this field is the ONLY offline image reference.
  pendingImageBlobId: number | null;
}
```

(`UpdateSongPayload extends CreateSongPayload`, so it inherits the field automatically.)

In `resolveSongForEdit`, add `pendingImageBlobId` to BOTH returned `song` literals. Pending-edit branch:

```ts
      song: {
        title: payload.title,
        lyrics: payload.lyrics,
        imageUrl: payload.imageUrl,
        notes: payload.notes,
        maleKey: payload.maleKey,
        femaleKey: payload.femaleKey,
        axisValues: payload.axisValues,
        pendingImageBlobId: payload.pendingImageBlobId ?? null,
      },
```

Base-row branch (the cached base has no pending image):

```ts
    song: {
      title: base.title,
      lyrics: base.lyrics,
      imageUrl: base.imageUrl,
      notes: base.notes,
      maleKey: base.maleKey,
      femaleKey: base.femaleKey,
      axisValues: baseAxisValues,
      pendingImageBlobId: null,
    },
```

Leave `mergeSongsWithPending` and `DisplaySong` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/songsMerge.test.ts`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `songsMerge.ts`. (Errors from the pages/handlers still referencing the old payload shape are expected only if they construct the payload with an object typed as `CreateSongPayload`; the native pages use untyped object literals passed to `enqueue`, so they should not error yet. If `tsc` reports an error in a page, note it — Tasks 5/6 add the field there.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/songsMerge.ts src/lib/songsMerge.test.ts
git commit -m "feat: thread pendingImageBlobId through song payloads and resolveSongForEdit"
```

---

### Task 3: Local image byte store + resolution map (IndexedDB)

A dedicated, single-purpose IndexedDB database (its own name, following `syncQueueStorage.ts`'s precedent of not sharing `glentify-offline`). Two object stores: the picked `Blob`s, and the `draftBlobId → uploadedUrl` resolution map. No vitest — IndexedDB, manual-only per convention.

**Files:**
- Create: `src/lib/localImageStore.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LocalImage { blob: Blob; contentType: string; filename: string }`
  - `putLocalImage(draftBlobId: number, image: LocalImage): Promise<void>`
  - `getLocalImage(draftBlobId: number): Promise<LocalImage | null>`
  - `deleteLocalImage(draftBlobId: number): Promise<void>`
  - `recordImageResolution(draftBlobId: number, url: string): Promise<void>`
  - `loadImageResolution(draftBlobId: number): Promise<string | null>`

- [ ] **Step 1: Write the module**

```ts
// src/lib/localImageStore.ts

// Dedicated database — deliberately NOT sharing offlineCache.ts's `glentify-offline` or the
// sync queue's `glentify-sync-queue`, matching syncQueueStorage.ts's stated reasoning that
// independent modules coordinating version upgrades on one database is a real risk to the
// caches those databases hold. Two object stores:
//   `images`      keyed by draftBlobId -> LocalImage (the picked Blob + metadata)
//   `resolutions` keyed by draftBlobId -> uploaded public URL (string)
// The resolution map gives the sync handler idempotency: /api/songs/image-upload sets
// addRandomSuffix, so a retried upload() would mint a new orphan blob without it.
const DB_NAME = 'glentify-local-images';
const DB_VERSION = 1;
const IMAGES_STORE = 'images';
const RESOLUTIONS_STORE = 'resolutions';

export interface LocalImage {
  blob: Blob;
  contentType: string;
  filename: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGES_STORE)) db.createObjectStore(IMAGES_STORE);
      if (!db.objectStoreNames.contains(RESOLUTIONS_STORE)) db.createObjectStore(RESOLUTIONS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putValue(store: string, key: number, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getValue<T>(store: string, key: number): Promise<T | null> {
  const db = await openDb();
  const result = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function putLocalImage(draftBlobId: number, image: LocalImage): Promise<void> {
  await putValue(IMAGES_STORE, draftBlobId, image);
}

export async function getLocalImage(draftBlobId: number): Promise<LocalImage | null> {
  return getValue<LocalImage>(IMAGES_STORE, draftBlobId);
}

export async function deleteLocalImage(draftBlobId: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).delete(draftBlobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function recordImageResolution(draftBlobId: number, url: string): Promise<void> {
  await putValue(RESOLUTIONS_STORE, draftBlobId, url);
}

export async function loadImageResolution(draftBlobId: number): Promise<string | null> {
  return getValue<string>(RESOLUTIONS_STORE, draftBlobId);
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors from `localImageStore.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/localImageStore.ts
git commit -m "feat: local image byte store and draftBlobId->url resolution map"
```

---

### Task 4: Fold image upload into the song-create/song-update sync handlers

Adds the image step to `handleCreateSongSync` and `handleUpdateSongSync`. No vitest — network + IndexedDB + `@vercel/blob/client`, manual-only per convention.

**Files:**
- Modify: `src/lib/syncHandlers.ts`

**Interfaces:**
- Consumes: `CreateSongPayload`/`UpdateSongPayload` with `pendingImageBlobId` (Task 2); `getLocalImage`, `deleteLocalImage`, `recordImageResolution`, `loadImageResolution` (Task 3); `apiUrl` (`src/lib/apiClient.ts`), `getAuthToken` (`src/lib/authToken.ts`), `upload` from `@vercel/blob/client`.
- Produces: no new exports.

- [ ] **Step 1: Add imports**

At the top of `src/lib/syncHandlers.ts`, add:

```ts
import { upload } from '@vercel/blob/client';
import { apiUrl } from './apiClient';
import { getAuthToken } from './authToken';
import { getLocalImage, deleteLocalImage, recordImageResolution, loadImageResolution } from './localImageStore';
```

- [ ] **Step 2: Add the shared image-resolution helper**

Add above `handleCreateSongSync`:

```ts
// Resolves a pending offline image to a public URL for a song write.
//   - returns null when there is no pending image (caller sends payload.imageUrl as-is:
//     a real URL for an untouched image, or null for an untouched-empty / removed image)
//   - returns 'item-error' when bytes are missing AND unresolved (defensive; normally the
//     same submit that set pendingImageBlobId also stored the bytes)
//   - returns the URL when resolved from the map (skips re-upload) or after a fresh upload()
// A thrown/rejected upload() propagates out to processQueueWith, which maps it to
// systemic-error (pass stops, no attempt consumed) — correct for the offline case.
async function resolvePendingImageUrl(pendingImageBlobId: number | null | undefined): Promise<string | null | 'item-error'> {
  if (pendingImageBlobId === null || pendingImageBlobId === undefined) return null;
  const alreadyUploaded = await loadImageResolution(pendingImageBlobId);
  if (alreadyUploaded !== null) return alreadyUploaded;
  const local = await getLocalImage(pendingImageBlobId);
  if (local === null) return 'item-error';
  const token = await getAuthToken();
  const blob = await upload(local.filename, local.blob, {
    access: 'public',
    handleUploadUrl: apiUrl('/api/songs/image-upload'),
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  await recordImageResolution(pendingImageBlobId, blob.url);
  return blob.url;
}
```

- [ ] **Step 3: Rewrite `handleCreateSongSync`**

Replace the existing `handleCreateSongSync` with:

```ts
async function handleCreateSongSync(payload: unknown): Promise<SyncOutcome> {
  const { pendingImageBlobId, ...rest } = payload as CreateSongPayload;
  const resolvedImage = await resolvePendingImageUrl(pendingImageBlobId);
  if (resolvedImage === 'item-error') return 'item-error';
  const body = { ...rest, imageUrl: resolvedImage ?? rest.imageUrl };
  const res = await nativeApiFetch(
    '/api/songs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) {
    if (pendingImageBlobId != null) await deleteLocalImage(pendingImageBlobId);
    return 'success';
  }
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

- [ ] **Step 4: Rewrite `handleUpdateSongSync`**

Replace the existing `handleUpdateSongSync` with:

```ts
async function handleUpdateSongSync(payload: unknown): Promise<SyncOutcome> {
  const { songId, pendingImageBlobId, ...rest } = payload as UpdateSongPayload;
  const resolvedImage = await resolvePendingImageUrl(pendingImageBlobId);
  if (resolvedImage === 'item-error') return 'item-error';
  const body = { ...rest, imageUrl: resolvedImage ?? rest.imageUrl };
  const res = await nativeApiFetch(
    `/api/songs/${encodeURIComponent(songId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    { redirectOn401: false }
  );
  // Already gone (deleted elsewhere before this update synced) — the desired end state
  // can't be reached, but there's nothing left to update either; matches
  // handleDeleteProgramSync's 404-as-success precedent.
  if (res.ok || res.status === 404) {
    if (pendingImageBlobId != null) await deleteLocalImage(pendingImageBlobId);
    return 'success';
  }
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

Note: `body` no longer contains `songId` or `pendingImageBlobId` (both destructured out) — the PATCH body matches what the route expects today plus the resolved `imageUrl`.

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`upload`, `apiUrl`, `getAuthToken` all resolve; `CreateSongPayload`/`UpdateSongPayload` now carry `pendingImageBlobId`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/syncHandlers.ts
git commit -m "feat: upload pending offline image inside song-create/song-update handlers"
```

---

### Task 5: Native new-song page — enable picker, validate, store, preview, remove, pass field

**Files:**
- Modify: `src/app/admin/songs/new/page.tsx`

**Interfaces:**
- Consumes: `validateImageFile`, `IMAGE_ACCEPT_ATTR` (Task 1); `putLocalImage`, `deleteLocalImage` (Task 3); `mintDraftId` (`src/lib/draftIds.ts`); `pendingImageBlobId` field on the enqueued `song-create` payload (Task 2).

- [ ] **Step 1: Add imports**

Add to the existing import block:

```ts
import { validateImageFile, IMAGE_ACCEPT_ATTR } from '@/lib/imageValidation';
import { putLocalImage, deleteLocalImage } from '@/lib/localImageStore';
import { mintDraftId } from '@/lib/draftIds';
```

Remove the now-unused `import { upload } from '@vercel/blob/client';` ONLY after confirming the web branch below still uses it — the web branch keeps `upload`, so **do not remove it**. (The web and native branches share this page; `upload` stays.)

- [ ] **Step 2: Add state for the pending draft id and preview**

Below the existing `const [imageUrl, setImageUrl] = useState<string | null>(null);` add:

```ts
  const [pendingImageBlobId, setPendingImageBlobId] = useState<number | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
```

Add a cleanup effect so object URLs are revoked:

```ts
  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);
```

- [ ] **Step 3: Split the image handler by platform**

Replace `handleImageChange` with a version that, on native, validates + stores locally instead of uploading:

```ts
  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (native) {
      const validation = validateImageFile(file);
      if (!validation.ok) {
        setError(validation.reason);
        e.target.value = '';
        return;
      }
      const draftId = mintDraftId();
      try {
        await putLocalImage(draftId, { blob: file, contentType: file.type, filename: file.name });
      } catch {
        setError('Αποτυχία αποθήκευσης εικόνας.');
        return;
      }
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
      setPendingImageBlobId(draftId);
      setLocalPreviewUrl(URL.createObjectURL(file));
      setImageUrl(null); // a fresh pending image supersedes any prior real URL
      return;
    }
    // Web: eager direct upload, unchanged.
    setUploading(true);
    try {
      const token = await getAuthToken();
      const blob = await upload(file.name, file, {
        access: 'public',
        handleUploadUrl: apiUrl('/api/songs/image-upload'),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      setImageUrl(blob.url);
    } catch {
      setError('Αποτυχία μεταφόρτωσης εικόνας');
    } finally {
      setUploading(false);
    }
  }
```

- [ ] **Step 4: Add a remove handler**

```ts
  async function handleRemoveImage() {
    if (native && pendingImageBlobId != null) {
      try {
        await deleteLocalImage(pendingImageBlobId);
      } catch {
        // best-effort cleanup; clearing the form state below is what matters
      }
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setPendingImageBlobId(null);
    setImageUrl(null);
  }
```

- [ ] **Step 5: Include the field in the enqueued payload**

In `handleSubmit`, replace the single existing image line `imageUrl: native ? null : imageUrl,` in the `body` object with these two lines:

```ts
      imageUrl,
      pendingImageBlobId: native ? pendingImageBlobId : null,
```

Rationale: on native, `imageUrl` is `null` after a pending pick or a remove (and for the no-image case), so sending it directly is correct — the pending reference travels in `pendingImageBlobId`. On web, `pendingImageBlobId` is `null` and `imageUrl` holds the eagerly-uploaded URL as before.

- [ ] **Step 6: Update the JSX — enable the input, show local preview, add remove button**

Replace the image `<div className="flex flex-col gap-2"> ... </div>` block with:

```tsx
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept={IMAGE_ACCEPT_ATTR} onChange={handleImageChange} className="file-input file-input-bordered" />
          {uploading && <span className="loading loading-spinner loading-sm" />}
          {(localPreviewUrl || imageUrl) && (
            <>
              <img src={localPreviewUrl ?? imageUrl ?? undefined} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />
              <button type="button" onClick={handleRemoveImage} className="btn btn-sm btn-outline btn-error self-start">Αφαίρεση εικόνας</button>
            </>
          )}
        </div>
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. Confirm no unused-import warnings (the `native` "not supported" note is gone; the disabled attr is gone).

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/songs/new/page.tsx
git commit -m "feat: native offline image pick + remove on new-song page"
```

---

### Task 6: Native edit-song page — enable picker, pending preview, remove, pass field

**Files:**
- Modify: `src/app/admin/local/songs/edit/page.tsx`

**Interfaces:**
- Consumes: same helpers as Task 5, plus `getLocalImage` (Task 3) is NOT needed here because the preview for a freshly-picked image uses the in-memory `File`; a pending image restored from a prior session's queue is shown via its `pendingImageBlobId` resolved through `getLocalImage`. See Step 3.

- [ ] **Step 1: Add imports**

```ts
import { validateImageFile, IMAGE_ACCEPT_ATTR } from '@/lib/imageValidation';
import { putLocalImage, deleteLocalImage, getLocalImage } from '@/lib/localImageStore';
import { mintDraftId } from '@/lib/draftIds';
```

- [ ] **Step 2: Add state + revoke effect**

Below `const [imageUrl, setImageUrl] = useState<string | null>(null);` add:

```ts
  const [pendingImageBlobId, setPendingImageBlobId] = useState<number | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);
```

- [ ] **Step 3: Restore a pending image's preview when the resolver reports one**

The resolver effect already calls `setImageUrl(result.song.imageUrl)`. Extend that `if (result.song) { ... }` block to also seed the pending image id and, if present, build a preview from the stored bytes:

```ts
        if (result.song) {
          setTitle(result.song.title);
          setLyrics(result.song.lyrics ?? '');
          setNotes(result.song.notes ?? '');
          setMaleKey(result.song.maleKey ?? '');
          setFemaleKey(result.song.femaleKey ?? '');
          setImageUrl(result.song.imageUrl);
          setAxisValues(result.song.axisValues);
          setNotFound(false);
          const pendingId = result.song.pendingImageBlobId;
          setPendingImageBlobId(pendingId);
          if (pendingId != null) {
            getLocalImage(pendingId)
              .then((local) => {
                if (local) setLocalPreviewUrl(URL.createObjectURL(local.blob));
              })
              .catch(() => {/* no preview if bytes are gone; imageUrl still shows if any */});
          }
        } else {
```

(Leave the rest of the effect unchanged.)

- [ ] **Step 4: Add the same image handler + remove handler as Task 5 (native-only page)**

This page is native-only, so no web branch is needed:

```ts
  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const validation = validateImageFile(file);
    if (!validation.ok) {
      setError(validation.reason);
      e.target.value = '';
      return;
    }
    const draftId = mintDraftId();
    try {
      await putLocalImage(draftId, { blob: file, contentType: file.type, filename: file.name });
    } catch {
      setError('Αποτυχία αποθήκευσης εικόνας.');
      return;
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setPendingImageBlobId(draftId);
    setLocalPreviewUrl(URL.createObjectURL(file));
    setImageUrl(null); // a fresh pending image supersedes the existing real URL
  }

  async function handleRemoveImage() {
    if (pendingImageBlobId != null) {
      try {
        await deleteLocalImage(pendingImageBlobId);
      } catch {
        // best-effort
      }
    }
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    setLocalPreviewUrl(null);
    setPendingImageBlobId(null);
    setImageUrl(null);
  }
```

- [ ] **Step 5: Pass the field in the enqueued `song-update` payload**

In `handleSubmit`, replace the `imageUrl,` line inside the `enqueue('song-update', { ... })` object with:

```ts
        imageUrl,
        pendingImageBlobId,
```

(Remove the old `imageUrl, // read-only in Phase 1 ...` comment line.)

- [ ] **Step 6: Update the JSX — enable input, local preview, remove button**

Replace the image `<div className="flex flex-col gap-2"> ... </div>` block with:

```tsx
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept={IMAGE_ACCEPT_ATTR} onChange={handleImageChange} className="file-input file-input-bordered" />
          {(localPreviewUrl || imageUrl) && (
            <>
              <img src={localPreviewUrl ?? imageUrl ?? undefined} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />
              <button type="button" onClick={handleRemoveImage} className="btn btn-sm btn-outline btn-error self-start">Αφαίρεση εικόνας</button>
            </>
          )}
        </div>
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/admin/local/songs/edit/page.tsx
git commit -m "feat: native offline image pick/replace/remove on edit-song page"
```

---

### Task 7: Web edit + web new — add the "remove image" button

Brings web to add/replace/remove parity. Web keeps its eager `upload()`; removal just clears `imageUrl`.

**Files:**
- Modify: `src/app/admin/songs/[id]/page.tsx`
- Modify: `src/app/admin/songs/new/page.tsx` (web branch of the shared page — the remove button added in Task 5 already covers web because it renders whenever `imageUrl` is set and `handleRemoveImage` clears it; VERIFY this and only add a change if the button is currently gated behind a native-only condition).

- [ ] **Step 1: Verify the new-song page already covers web removal**

Re-read `src/app/admin/songs/new/page.tsx` as modified in Task 5. The remove button renders on `(localPreviewUrl || imageUrl)` and `handleRemoveImage` works on web (it only touches `deleteLocalImage` when `native && pendingImageBlobId != null`). Confirm no native-only gate wraps the button. If correct, no further change to the new page — note it and move on.

- [ ] **Step 2: Add remove state handling to the web edit page**

In `src/app/admin/songs/[id]/page.tsx`, add a remove handler after `handleImageChange`:

```ts
  function handleRemoveImage() {
    setImageUrl(null);
  }
```

- [ ] **Step 3: Render the remove button in the web edit page JSX**

Replace the image preview line:

```tsx
          {imageUrl && <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />}
```

with:

```tsx
          {imageUrl && (
            <>
              <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />
              <button type="button" onClick={handleRemoveImage} className="btn btn-sm btn-outline btn-error self-start">Αφαίρεση εικόνας</button>
            </>
          )}
```

The existing `handleSubmit` already sends `imageUrl` in the PATCH body, so a cleared `imageUrl` persists the removal — no other change needed.

- [ ] **Step 4: Typecheck + lint + full test suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type/lint errors; all vitest passes (Task 1 + Task 2 suites included).

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/songs/\[id\]/page.tsx src/app/admin/songs/new/page.tsx
git commit -m "feat: add remove-image control to web edit/new song pages"
```

---

### Task 8: Manual-testing checklist rows + final verification

**Files:**
- Modify: `docs/manual-testing-checklist.md`

- [ ] **Step 1: Read the existing checklist to match its format**

Run: open `docs/manual-testing-checklist.md`, note the section/heading and checkbox style used for offline song CRUD.

- [ ] **Step 2: Add rows for this feature**

Under the offline song section (matching the file's existing format), add:

```markdown
### Offline song image upload
- [ ] Native + offline: create a new song, pick an image, save → row appears; reconnect → image is attached after sync.
- [ ] Native + offline: edit an existing image-less song, add an image, save → reconnect → image attached.
- [ ] Native + offline: edit a song that has an image, replace it, save → reconnect → new image shown, old one no longer referenced.
- [ ] Native + offline: edit a song that has an image, tap "Αφαίρεση εικόνας", save → reconnect → image removed server-side.
- [ ] Native: reject flow — pick a >10MB file or a non-PNG/JPEG/WebP → inline Greek error, nothing stored.
- [ ] Native: edit the same song twice offline after picking one image → reconnect → exactly one blob uploaded, both edits apply, no orphan re-upload.
- [ ] Native: pick an image offline, save, reopen the edit page BEFORE reconnecting → the pending image still previews.
- [ ] Native: airplane mode ON, trigger a sync, then reconnect → upload + song write complete cleanly with no duplicate.
- [ ] Web: edit a song, remove its image, save → image removed. (Regression: add/replace still work.)
```

- [ ] **Step 3: Run the full verification suite one last time**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean typecheck, clean lint, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add docs/manual-testing-checklist.md
git commit -m "docs: manual-testing checklist rows for offline song image upload"
```

---

## Self-Review

**Spec coverage:**
- Core `pendingImageBlobId` field, `imageUrl` never a sentinel → Task 2. ✓
- Local IndexedDB blob store + string resolution map → Task 3. ✓
- Pick-time validation matching route limits → Task 1, used in Tasks 5/6. ✓
- Upload folded into song handlers, map-before-bytes ordering, delete-on-success, systemic-error on throw, `apiUrl` for `handleUploadUrl` → Task 4. ✓
- Native new-song picker enable + preview + remove + field → Task 5. ✓
- Native edit picker enable + pending preview + replace + remove + field → Task 6. ✓
- Remove "everywhere" incl. web edit + web new → Tasks 5 (web branch) + 7. ✓
- Edit-twice-offline single blob (resolution reuse) → Task 4 helper + Task 2 test. ✓
- 404-as-success still deletes bytes → Task 4 update handler. ✓
- No list indicator (`mergeSongsWithPending` untouched) → Task 2 leaves it alone. ✓
- Orphan bytes retained on needsAttention (no cleanup) → not a code path; nothing deletes them, consistent by omission; called out in spec. ✓
- Object-URL lifecycle (revoke) → Tasks 5/6. ✓
- Testing convention (vitest pure only; rest manual) → Tasks 1/2 vitest, 3/4/5/6 tsc+lint, 8 checklist. ✓
- Non-goal web path unchanged except remove → Tasks 5/7 keep eager `upload()`. ✓

**Placeholder scan:** No TBD/TODO; every code step has literal code. The one judgement step (Task 7 Step 1 "verify") is a real verification action with a defined pass condition, not a deferred decision.

**Type consistency:** `pendingImageBlobId: number | null` used identically across `CreateSongPayload`/`UpdateSongPayload` (Task 2), the handler destructures (Task 4), and page state (Tasks 5/6). `LocalImage`/`putLocalImage`/`getLocalImage`/`deleteLocalImage`/`recordImageResolution`/`loadImageResolution` names match between Task 3 (definition) and Task 4 (use). `IMAGE_ACCEPT_ATTR`/`validateImageFile` names match between Task 1 and Tasks 5/6.
