# Admin Εργαλείο στο Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all 7 `/admin/*` sections (Τραγούδια, Προγράμματα, Περιοχές, Ρυθμοί, Δρόμοι, Συνθέτες, Είδη) to the Android app as a thin client over the already-deployed API — no offline write queue.

**Architecture:** A new `nativeApiFetch` wrapper (base-URL rewrite + Bearer token) replaces raw `fetch()` in every admin page so calls work cross-origin from the Capacitor WebView, mirroring the one pattern the sync flow already uses manually. Five static taxonomy pages plus the two list pages port into the mobile bundle unchanged except for that fetch swap. The two dynamic (`[id]`) routes — song edit and program edit — cannot exist in a static export, so they get native-only static twins under `admin/local/*` that resolve "which item" from `preferencesStore` instead of a URL param, exactly like `programs/local/*` already does for program viewing.

**Tech Stack:** Next.js 16 App Router (Capacitor static export for mobile), `@capacitor/preferences`, `@vercel/blob/client`, Vitest, daisyUI 5/Tailwind v4.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-10-android-admin-tool-design.md` — this plan implements it.
- Thin client only — every admin action requires a live connection; a failed fetch shows the same error message the web version already shows. No offline queue (that's feature #1 of the mobile roadmap, not this one).
- Full parity: all 7 sections, including image upload from the start.
- This codebase's convention: pure logic (`src/lib/*.ts`) gets Vitest unit tests; DB-touching query/route/UI code is verified manually — no test DB exists, no `*.test.ts` for React pages or API routes anywhere in the repo. Follow that split.
- `nativeApiFetch` must be a no-op wrapper on web (no base URL prefix, no token — the cookie already authenticates there) — verify this explicitly, don't just assume it.
- The two dynamic-route ports (`admin/local/songs/edit`, `admin/local/programs/edit`) must NOT replace the existing web routes (`admin/songs/[id]`, `admin/programs/[id]`) — both continue to exist, web keeps using its dynamic route unchanged.
- All user-facing copy stays in Greek, matching what's already there — this plan only changes networking/routing, not wording.
- The "Συνεργάτες" (collaborators) section on the ported program-edit page depends on API routes from the program-sharing feature (`GET /api/account`, the collaborators routes) that are committed locally but **not yet pushed to `origin/main`** as of this plan. Native testing hits the deployed API — the collaborators portion of Task 9's manual verification cannot pass until that push happens. Say so at that step; don't write a verification step that pretends it can run.

---

## Task 1: `nativeApiFetch` wrapper

**Files:**
- Create: `src/lib/nativeApiFetch.ts`
- Test: `src/lib/nativeApiFetch.test.ts`

**Interfaces:**
- Consumes: `apiUrl(path: string): string` (existing, `src/lib/apiClient.ts`), `getAuthToken(): Promise<string | null>` (existing, `src/lib/authToken.ts`).
- Produces: `nativeApiFetch(path: string, init?: RequestInit, getToken?: () => Promise<string | null>): Promise<Response>` — every later task's admin page imports this instead of calling `fetch` directly.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/nativeApiFetch.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { nativeApiFetch } from './nativeApiFetch';

describe('nativeApiFetch', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalEnv;
    global.fetch = originalFetch;
  });

  it('calls the given path unchanged with no Authorization header when there is no token (web)', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    await nativeApiFetch('/api/regions', undefined, async () => null);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/regions');
    expect((init.headers as Headers).has('Authorization')).toBe(false);
  });

  it('prefixes the base URL and attaches a Bearer token when one is available (native)', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://glentify-kohl.vercel.app';
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    await nativeApiFetch('/api/regions', undefined, async () => 'the-token');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://glentify-kohl.vercel.app/api/regions');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer the-token');
  });

  it('preserves method, body, and existing headers from the caller', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    await nativeApiFetch(
      '/api/regions',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' },
      async () => 'tok'
    );

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"x"}');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok');
  });

  it('defaults to the real getAuthToken when no override is passed', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    // No stored token in this test environment, so getAuthToken() resolves null —
    // confirms the default parameter wires up without throwing.
    await nativeApiFetch('/api/regions');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- nativeApiFetch`
Expected: FAIL with "Cannot find module './nativeApiFetch'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/nativeApiFetch.ts
import { apiUrl } from './apiClient';
import { getAuthToken } from './authToken';

/**
 * Drop-in replacement for `fetch()` in admin pages, so the same code works
 * identically on web (relative path, cookie auth) and native (absolute URL
 * against the deployed API, Bearer token — the cookie never reaches
 * `capacitor://localhost`). `getToken` is injectable for tests; every real
 * caller uses the default.
 */
export async function nativeApiFetch(
  path: string,
  init?: RequestInit,
  getToken: () => Promise<string | null> = getAuthToken
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- nativeApiFetch`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/nativeApiFetch.ts src/lib/nativeApiFetch.test.ts
git commit -m "Add nativeApiFetch wrapper for authenticated cross-origin admin calls"
```

---

## Task 2: `adminEditStore` — which song/program is being edited on native

**Files:**
- Create: `src/lib/adminEditStore.ts`
- Test: `src/lib/adminEditStore.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore` (existing, `src/lib/preferencesStore.ts`).
- Produces: `setSelectedEditSongId(storage, id): Promise<void>`, `getSelectedEditSongId(storage): Promise<number | null>`, `setSelectedEditProgramId(storage, id): Promise<void>`, `getSelectedEditProgramId(storage): Promise<number | null>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/adminEditStore.test.ts
import { describe, it, expect } from 'vitest';
import {
  setSelectedEditSongId,
  getSelectedEditSongId,
  setSelectedEditProgramId,
  getSelectedEditProgramId,
} from './adminEditStore';
import type { KeyValueStore } from './preferencesStore';

function inMemoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return (map.has(key) ? (map.get(key) as T) : null);
    },
    async set<T>(key: string, value: T | null) {
      if (value === null) map.delete(key);
      else map.set(key, value);
    },
  };
}

describe('adminEditStore', () => {
  it('returns null for the selected edit song id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedEditSongId(store)).toBeNull();
  });

  it('round-trips the selected edit song id', async () => {
    const store = inMemoryStore();
    await setSelectedEditSongId(store, 5);
    expect(await getSelectedEditSongId(store)).toBe(5);
  });

  it('returns null for the selected edit program id when nothing was set', async () => {
    const store = inMemoryStore();
    expect(await getSelectedEditProgramId(store)).toBeNull();
  });

  it('round-trips the selected edit program id', async () => {
    const store = inMemoryStore();
    await setSelectedEditProgramId(store, 9);
    expect(await getSelectedEditProgramId(store)).toBe(9);
  });

  it('keeps the song and program edit selections independent', async () => {
    const store = inMemoryStore();
    await setSelectedEditSongId(store, 1);
    await setSelectedEditProgramId(store, 2);
    expect(await getSelectedEditSongId(store)).toBe(1);
    expect(await getSelectedEditProgramId(store)).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- adminEditStore`
Expected: FAIL with "Cannot find module './adminEditStore'"

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/adminEditStore.ts
import type { KeyValueStore } from './preferencesStore';

const SELECTED_EDIT_SONG_KEY = 'glentify:admin-edit-song-id';
const SELECTED_EDIT_PROGRAM_KEY = 'glentify:admin-edit-program-id';

export async function setSelectedEditSongId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_EDIT_SONG_KEY, id);
}

export async function getSelectedEditSongId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_EDIT_SONG_KEY);
}

export async function setSelectedEditProgramId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_EDIT_PROGRAM_KEY, id);
}

export async function getSelectedEditProgramId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_EDIT_PROGRAM_KEY);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- adminEditStore`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/adminEditStore.ts src/lib/adminEditStore.test.ts
git commit -m "Add adminEditStore for native song/program edit target selection"
```

---

## Task 3: `scripts/build-mobile.sh` — stop stripping all of `/admin`

Done early, before any admin page is ported, so every later task can actually build and test on a real device instead of the current wholesale exclusion.

**Files:**
- Modify: `scripts/build-mobile.sh`

**Interfaces:** none (shell script only).

- [ ] **Step 1: Replace the wholesale admin removal with targeted removal of the two dynamic routes**

Current content (find this block):
```bash
rm -rf .mobile-build/src/app/api
rm -rf .mobile-build/src/app/admin
rm -rf ".mobile-build/src/app/programs/[id]"
rm -f ".mobile-build/src/app/programs/page.tsx"
rm -rf .mobile-build/src/app/session/\[id\]
rm -f .mobile-build/src/proxy.ts
```

Replace with:
```bash
rm -rf .mobile-build/src/app/api
rm -rf ".mobile-build/src/app/admin/songs/[id]"
rm -rf ".mobile-build/src/app/admin/programs/[id]"
rm -rf ".mobile-build/src/app/programs/[id]"
rm -f ".mobile-build/src/app/programs/page.tsx"
rm -rf .mobile-build/src/app/session/\[id\]
rm -f .mobile-build/src/proxy.ts
```

- [ ] **Step 2: Add a defensive check for the two dynamic admin routes surviving staging**

Current content (find this block):
```bash
if [ -d .mobile-build/src/app/api ]; then
  echo "build-mobile: src/app/api survived staging, aborting" >&2
  exit 1
fi

if [ -d .mobile-build/src/app/session/\[id\] ]; then
  echo "build-mobile: src/app/session/[id] survived staging, aborting" >&2
  exit 1
fi
```

Add a third check right after it (before the `cat > .mobile-build/next.config.ts` line):
```bash
if [ -d ".mobile-build/src/app/admin/songs/[id]" ] || [ -d ".mobile-build/src/app/admin/programs/[id]" ]; then
  echo "build-mobile: a dynamic admin route survived staging, aborting" >&2
  exit 1
fi
```

- [ ] **Step 3: Run a mobile build to confirm the script still succeeds**

```bash
npm run build:mobile
```

Expected: completes with `Mobile static export written to ./out`, all three abort checks pass silently (no error printed). At this point `/admin/*` (except the two `[id]` routes) is now part of the exported static site, even though its pages still call plain `fetch()` and won't work yet — that's expected, fixed in the following tasks.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-mobile.sh
git commit -m "Stop stripping all of /admin from the mobile build, keep only the two dynamic routes out"
```

---

## Task 4: Port the 5 taxonomy admin pages

**Files:**
- Modify: `src/app/admin/regions/page.tsx`
- Modify: `src/app/admin/rhythms/page.tsx`
- Modify: `src/app/admin/dromoi/page.tsx`
- Modify: `src/app/admin/composers/page.tsx`
- Modify: `src/app/admin/genres/page.tsx`

**Interfaces:**
- Consumes: `nativeApiFetch` (Task 1).

Same mechanical change in all 5 files: add the import, and replace every `fetch(` call with `nativeApiFetch(`. No other line changes — these five pages are otherwise correct as-is for both platforms.

- [ ] **Step 1: `src/app/admin/regions/page.tsx`**

Add to the imports (after `import { useEffect, useState } from 'react';`):
```ts
import { nativeApiFetch } from '@/lib/nativeApiFetch';
```

Replace each of these three call sites:
```ts
const res = await fetch('/api/regions');
```
→
```ts
const res = await nativeApiFetch('/api/regions');
```

```ts
const res = await fetch('/api/regions', {
```
→
```ts
const res = await nativeApiFetch('/api/regions', {
```

```ts
const res = await fetch(`/api/regions/${id}`, { method: 'DELETE' });
```
→
```ts
const res = await nativeApiFetch(`/api/regions/${id}`, { method: 'DELETE' });
```

- [ ] **Step 2: `src/app/admin/rhythms/page.tsx`**

Same three-call-site swap, `/api/rhythms` instead of `/api/regions` (and no `parentId` — this file's shape is otherwise the same as regions).

Add the same import. Replace:
```ts
const res = await fetch('/api/rhythms');
```
→
```ts
const res = await nativeApiFetch('/api/rhythms');
```

```ts
const res = await fetch('/api/rhythms', {
```
→
```ts
const res = await nativeApiFetch('/api/rhythms', {
```

```ts
const res = await fetch(`/api/rhythms/${id}`, { method: 'DELETE' });
```
→
```ts
const res = await nativeApiFetch(`/api/rhythms/${id}`, { method: 'DELETE' });
```

- [ ] **Step 3: `src/app/admin/dromoi/page.tsx`**

Same pattern, `/api/dromoi`. Add the import; replace the three `fetch('/api/dromoi'...)` / `fetch(\`/api/dromoi/${id}\`...)` call sites with `nativeApiFetch`.

- [ ] **Step 4: `src/app/admin/composers/page.tsx`**

Same pattern, `/api/composers`. Add the import; replace the three `fetch('/api/composers'...)` / `fetch(\`/api/composers/${id}\`...)` call sites with `nativeApiFetch`.

- [ ] **Step 5: `src/app/admin/genres/page.tsx`**

Same pattern, `/api/genres`. Add the import; replace the three `fetch('/api/genres'...)` / `fetch(\`/api/genres/${id}\`...)` call sites with `nativeApiFetch`.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Rebuild the mobile bundle**

```bash
npm run build:mobile
```
Expected: succeeds, same as Task 3's build but now these 5 pages' calls go through `nativeApiFetch`.

- [ ] **Step 8: Manual device verification (first real mutating cross-origin request)**

This is the plan's first proof that a mutating (POST/DELETE) cross-origin request actually clears `proxy.ts`'s CORS preflight from a real Capacitor WebView — untested territory until now (native has only ever done GET, via sync).

Install the freshly built app on a device or emulator (per the existing Capacitor Android workflow this repo already uses for `mobile-fixed-programs`), log in, navigate to "Διαχείριση" → Περιοχές (once Task 11 adds the entry point; until then, navigate directly via a temporary `<Link href="/admin/regions">` if needed, or open the URL from the device browser if the WebView allows direct navigation during this task's verification only — remove any temporary link before committing). Confirm: the list loads (GET), creating a new region succeeds (POST) and appears in the list, deleting it succeeds (DELETE). If any of these fail with a CORS or network error, STOP and report — this is the design's flagged unknown, and the rest of this plan builds on it succeeding.

- [ ] **Step 9: Commit**

```bash
git add src/app/admin/regions/page.tsx src/app/admin/rhythms/page.tsx src/app/admin/dromoi/page.tsx src/app/admin/composers/page.tsx src/app/admin/genres/page.tsx
git commit -m "Port the 5 taxonomy admin pages to use nativeApiFetch"
```

---

## Task 5: `SongAxisEditor` — fetch swap

Shared component used by both the song-creation and song-edit forms (web and native) — swapping it once here covers every consumer.

**Files:**
- Modify: `src/components/SongAxisEditor.tsx`

**Interfaces:**
- Consumes: `nativeApiFetch` (Task 1).

- [ ] **Step 1: Add the import**

Add after `import { useEffect, useState } from 'react';`:
```ts
import { nativeApiFetch } from '@/lib/nativeApiFetch';
```

- [ ] **Step 2: Replace the three call sites**

```ts
    fetch('/api/axis-types')
```
→
```ts
    nativeApiFetch('/api/axis-types')
```

```ts
              const res = await fetch(LOOKUP_ENDPOINTS[t.lookupTable as string]);
```
→
```ts
              const res = await nativeApiFetch(LOOKUP_ENDPOINTS[t.lookupTable as string]);
```

```ts
    const res = await fetch(endpoint, {
```
→
```ts
    const res = await nativeApiFetch(endpoint, {
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SongAxisEditor.tsx
git commit -m "Swap SongAxisEditor to nativeApiFetch"
```

---

## Task 6: Port `admin/songs/new` — fetch swap + fixed image upload

**Files:**
- Modify: `src/app/admin/songs/new/page.tsx`

**Interfaces:**
- Consumes: `nativeApiFetch` (Task 1), `apiUrl` (existing, `src/lib/apiClient.ts`), `getAuthToken` (existing, `src/lib/authToken.ts`).

The `@vercel/blob/client` `upload()` function accepts a `headers` option specifically documented for "sending Authorization headers" (confirmed in `node_modules/@vercel/blob/dist/client.d.ts`) and `handleUploadUrl` accepts a full absolute URL, not just a relative path — both problems flagged in the design spec have a direct, supported fix, no workaround needed.

- [ ] **Step 1: Add imports**

Add after the existing imports:
```ts
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { apiUrl } from '@/lib/apiClient';
import { getAuthToken } from '@/lib/authToken';
```

- [ ] **Step 2: Fix the image upload call**

Replace:
```ts
  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/songs/image-upload' });
      setImageUrl(blob.url);
    } catch {
      setError('Αποτυχία μεταφόρτωσης εικόνας');
    } finally {
      setUploading(false);
    }
  }
```
with:
```ts
  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
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

- [ ] **Step 3: Replace the remaining `fetch` call sites**

```ts
    fetch('/api/genres').then((r) => r.json()).then(setGenres);
```
→
```ts
    nativeApiFetch('/api/genres').then((r) => r.json()).then(setGenres);
```

```ts
      fetch(`/api/songs/suggestions?title=${encodeURIComponent(title.trim())}`)
```
→
```ts
      nativeApiFetch(`/api/songs/suggestions?title=${encodeURIComponent(title.trim())}`)
```

```ts
    const res = await fetch('/api/genres', {
```
→
```ts
    const res = await nativeApiFetch('/api/genres', {
```

```ts
    const res = await fetch('/api/songs', {
```
→
```ts
    const res = await nativeApiFetch('/api/songs', {
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Rebuild the mobile bundle and verify image upload on device**

```bash
npm run build:mobile
```

Install on device (or reuse Task 4's install if still current). Navigate to the song-creation form (temporarily via a direct link if Task 11's entry point isn't in place yet, same caveat as Task 4 Step 8 — remove any temporary link before committing), pick an image via the native file picker, confirm it uploads and the preview appears, then submit the song and confirm it's created with that image URL. This is the plan's second flagged unknown (absolute URL + auth header through the Blob SDK) — if the upload fails, STOP and report before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/songs/new/page.tsx
git commit -m "Port song-creation form to nativeApiFetch, fix image upload for native"
```

---

## Task 7: New native song-edit page (`admin/local/songs/edit`)

The native twin of `admin/songs/[id]`, which cannot exist in a static export. Resolves "which song" from `adminEditStore` instead of a URL param; every `fetch` becomes `nativeApiFetch`; image upload gets the same fix as Task 6.

**Files:**
- Create: `src/app/admin/local/songs/edit/page.tsx`

**Interfaces:**
- Consumes: `getSelectedEditSongId` (Task 2), `nativeApiFetch` (Task 1), `apiUrl`/`getAuthToken` (existing), `preferencesStore` (existing), `SongAxisEditor` (Task 5, unchanged signature).
- Produces: nothing new consumed elsewhere — Task 8 links to this route by path string (`/admin/local/songs/edit`), not by importing anything from this file.

- [ ] **Step 1: Write the new page**

```tsx
// src/app/admin/local/songs/edit/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { apiUrl } from '@/lib/apiClient';
import { getAuthToken } from '@/lib/authToken';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditSongId } from '@/lib/adminEditStore';
import SongAxisEditor, { type AxisValueEntry } from '@/components/SongAxisEditor';

interface Option {
  id: number;
  name: string;
}

export default function LocalEditSongPage() {
  const router = useRouter();
  const [songId, setSongId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [genres, setGenres] = useState<Option[]>([]);

  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [genreId, setGenreId] = useState('');
  const [notes, setNotes] = useState('');
  const [maleKey, setMaleKey] = useState('');
  const [femaleKey, setFemaleKey] = useState('');
  const [axisValues, setAxisValues] = useState<AxisValueEntry[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingGenre, setCreatingGenre] = useState(false);
  const [newGenreName, setNewGenreName] = useState('');

  useEffect(() => {
    getSelectedEditSongId(preferencesStore)
      .then(setSongId)
      .finally(() => setChecked(true));
  }, []);

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
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

  async function handleCreateGenre() {
    if (!newGenreName.trim()) return;
    const res = await nativeApiFetch('/api/genres', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGenreName.trim() }),
    });
    if (!res.ok) return;
    const created: Option = await res.json();
    setGenres((prev) => [...prev, created]);
    setGenreId(String(created.id));
    setCreatingGenre(false);
    setNewGenreName('');
  }

  useEffect(() => {
    if (songId === null) return;
    nativeApiFetch('/api/genres').then((r) => r.json()).then(setGenres);
    nativeApiFetch(`/api/songs/${songId}`).then((r) => r.json()).then((song) => {
      setTitle(song.title);
      setLyrics(song.lyrics ?? '');
      setGenreId(String(song.genreId));
      setNotes(song.notes ?? '');
      setMaleKey(song.maleKey ?? '');
      setFemaleKey(song.femaleKey ?? '');
      setImageUrl(song.imageUrl ?? null);
      setAxisValues(
        song.axisValues.map((v: { axisType: string; refId: number | null; yearValue: number | null }) => ({
          axisType: v.axisType,
          refId: v.refId,
          yearValue: v.yearValue,
        }))
      );
    });
  }, [songId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (songId === null) return;
    setError(null);
    const res = await nativeApiFetch(`/api/songs/${songId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        lyrics: lyrics || null,
        genreId: Number(genreId),
        notes: notes || null,
        maleKey: maleKey || null,
        femaleKey: femaleKey || null,
        axisValues,
        imageUrl,
      }),
    });
    if (!res.ok) {
      setError('Αποτυχία ενημέρωσης τραγουδιού');
      return;
    }
    router.push('/admin/songs');
  }

  async function handleDelete() {
    if (songId === null) return;
    setError(null);
    const res = await nativeApiFetch(`/api/songs/${songId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error);
      return;
    }
    router.push('/admin/songs');
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (songId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <p className="text-lg">Δεν έχει επιλεγεί τραγούδι.</p>
        <button onClick={() => router.push('/admin/songs')} className="btn btn-primary">← Πίσω στα τραγούδια</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
      {error && (
        <div role="alert" className="alert alert-error max-w-2xl">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Τίτλος" className="input input-bordered" required />
        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          placeholder="Στίχοι (προαιρετικό, μπορούν να προστεθούν αργότερα)"
          className="textarea textarea-bordered h-48"
        />
        <select
          value={creatingGenre ? '__new__' : genreId}
          onChange={(e) => {
            if (e.target.value === '__new__') {
              setCreatingGenre(true);
            } else {
              setCreatingGenre(false);
              setGenreId(e.target.value);
            }
          }}
          className="select select-bordered"
          required
        >
          <option value="">Είδος...</option>
          {genres.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          <option value="__new__">+ Νέο είδος...</option>
        </select>
        {creatingGenre && (
          <div className="flex gap-2">
            <input
              type="text"
              value={newGenreName}
              onChange={(e) => setNewGenreName(e.target.value)}
              placeholder="Όνομα νέου είδους"
              className="input input-bordered flex-1"
            />
            <button type="button" onClick={handleCreateGenre} className="btn btn-secondary">Δημιουργία</button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className="label-text">Εικόνα παρτιτούρας (προαιρετικό, εναλλακτικά ή μαζί με τους στίχους)</label>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageChange} className="file-input file-input-bordered" />
          {uploading && <span className="loading loading-spinner loading-sm" />}
          {imageUrl && <img src={imageUrl} alt="Προεπισκόπηση παρτιτούρας" className="max-h-64 rounded-box object-contain" />}
        </div>
        <SongAxisEditor value={axisValues} onChange={setAxisValues} />
        <div className="flex gap-3">
          <input value={maleKey} onChange={(e) => setMaleKey(e.target.value)} placeholder="Τόνος (άντρας)" className="input input-bordered flex-1" />
          <input value={femaleKey} onChange={(e) => setFemaleKey(e.target.value)} placeholder="Τόνος (γυναίκα)" className="input input-bordered flex-1" />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Σημειώσεις (προαιρετικό)" className="input input-bordered" />
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary">Αποθήκευση</button>
          <button type="button" onClick={handleDelete} className="btn btn-outline btn-error">Διαγραφή</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors. (This route is unreachable until Task 8 wires navigation to it — that's fine, it type-checks and exists standalone.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/local/songs/edit/page.tsx"
git commit -m "Add native song-edit page (admin/local/songs/edit)"
```

---

## Task 8: Port `admin/songs` list — platform-aware navigation

**Files:**
- Modify: `src/app/admin/songs/page.tsx`

**Interfaces:**
- Consumes: `nativeApiFetch` (Task 1), `isNativeApp` (existing, `src/lib/platform.ts`), `setSelectedEditSongId` (Task 2), `preferencesStore` (existing), the `/admin/local/songs/edit` route (Task 7).

- [ ] **Step 1: Replace the whole file**

```tsx
// src/app/admin/songs/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditSongId } from '@/lib/adminEditStore';

interface Song {
  id: number;
  title: string;
  lyrics: string | null;
}

export default function SongsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState('');

  async function load(q: string) {
    const url = q ? `/api/songs?search=${encodeURIComponent(q)}` : '/api/songs';
    const res = await nativeApiFetch(url);
    setSongs(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load('');
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  async function handleOpenSong(id: number) {
    await setSelectedEditSongId(preferencesStore, id);
    router.push('/admin/local/songs/edit');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Τραγούδια</h1>
        <Link href="/admin/songs/new" className="btn btn-primary">Νέο τραγούδι</Link>
      </div>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Αναζήτηση τίτλου" className="input input-bordered flex-1" />
        <button type="submit" className="btn">Αναζήτηση</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {songs.map((s) => (
          <li key={s.id} className="list-row items-center">
            {native ? (
              <button onClick={() => handleOpenSong(s.id)} className="link link-hover text-left">{s.title}</button>
            ) : (
              <Link href={`/admin/songs/${s.id}`} className="link link-hover">{s.title}</Link>
            )}
            {!s.lyrics && <span className="badge badge-warning badge-sm">λείπουν στίχοι</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Rebuild the mobile bundle and verify the full song-edit flow on device**

```bash
npm run build:mobile
```

On device: Τραγούδια list → tap a song → confirm it navigates to the edit form (not the old dynamic route) with the song's data pre-filled → change the title → save → confirm it returns to the list with the updated title showing.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/songs/page.tsx
git commit -m "Port songs list to native-aware navigation and nativeApiFetch"
```

---

## Task 9: New native program-edit page (`admin/local/programs/edit`)

The native twin of `admin/programs/[id]`, including the "Συνεργάτες" (collaborators) section already built by the program-sharing feature. Resolves "which program" from `adminEditStore`.

**Files:**
- Create: `src/app/admin/local/programs/edit/page.tsx`

**Interfaces:**
- Consumes: `getSelectedEditProgramId` (Task 2), `nativeApiFetch` (Task 1), `preferencesStore` (existing).

- [ ] **Step 1: Write the new page**

```tsx
// src/app/admin/local/programs/edit/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedEditProgramId } from '@/lib/adminEditStore';

interface Sequence {
  id: number;
  title: string;
  position: number;
}

interface Song {
  id: number;
  title: string;
}

interface SequenceSongEntry {
  sequenceSongId: number;
  song: Song;
}

interface CurrentUser {
  id: number;
  email: string;
}

interface Collaborator {
  id: number;
  email: string;
}

export default function LocalEditProgramPage() {
  const router = useRouter();
  const [programId, setProgramId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [title, setTitle] = useState('');
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [newSeqTitle, setNewSeqTitle] = useState('');
  const [expandedSeqId, setExpandedSeqId] = useState<number | null>(null);
  const [seqSongs, setSeqSongs] = useState<SequenceSongEntry[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [editingSeqId, setEditingSeqId] = useState<number | null>(null);
  const [editingSeqTitle, setEditingSeqTitle] = useState('');
  const [role, setRole] = useState<'creator' | 'collaborator' | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [creator, setCreator] = useState<Collaborator | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [newCollaboratorEmail, setNewCollaboratorEmail] = useState('');
  const [collaboratorError, setCollaboratorError] = useState<string | null>(null);

  useEffect(() => {
    getSelectedEditProgramId(preferencesStore)
      .then(setProgramId)
      .finally(() => setChecked(true));
  }, []);

  async function loadProgram(id: number) {
    const res = await nativeApiFetch(`/api/programs/${id}`);
    const data = await res.json();
    setTitle(data.title);
    setSequences(data.sequences);
    setRole(data.role);
  }

  async function loadCollaborators(id: number) {
    const res = await nativeApiFetch(`/api/programs/${id}/collaborators`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCollaboratorError(
        typeof body?.error === 'string' ? body.error : 'Αποτυχία φόρτωσης συνεργατών'
      );
      return;
    }
    const data = await res.json();
    setCreator(data.creator);
    setCollaborators(data.collaborators);
  }

  useEffect(() => {
    if (programId === null) return;
    loadProgram(programId);
    loadCollaborators(programId);
  }, [programId]);

  useEffect(() => {
    nativeApiFetch('/api/account').then((r) => r.json()).then(setCurrentUser);
  }, []);

  async function refreshSequenceSongs(seqId: number) {
    if (programId === null) return;
    const res = await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`);
    const data = await res.json();
    setSeqSongs(data.songs);
  }

  async function handleAddSequence(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newSeqTitle }),
    });
    setNewSeqTitle('');
    await loadProgram(programId);
  }

  async function handleDeleteSequence(seqId: number) {
    if (programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`, { method: 'DELETE' });
    if (expandedSeqId === seqId) setExpandedSeqId(null);
    await loadProgram(programId);
  }

  function startEditingSequence(seq: Sequence) {
    setEditingSeqId(seq.id);
    setEditingSeqTitle(seq.title);
  }

  async function handleRenameSequence(e: React.FormEvent, seqId: number) {
    e.preventDefault();
    if (programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${seqId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editingSeqTitle }),
    });
    setEditingSeqId(null);
    await loadProgram(programId);
  }

  async function handleMoveSong(fromIndex: number, direction: -1 | 1) {
    if (expandedSeqId === null || programId === null) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= seqSongs.length) return;
    const reordered = [...seqSongs];
    [reordered[fromIndex], reordered[toIndex]] = [reordered[toIndex], reordered[fromIndex]];
    setSeqSongs(reordered);
    await nativeApiFetch(`/api/programs/${programId}/sequences/${expandedSeqId}/songs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: reordered.map((entry) => entry.sequenceSongId) }),
    });
  }

  async function handleToggleExpand(seqId: number) {
    if (expandedSeqId === seqId) {
      setExpandedSeqId(null);
      return;
    }
    setExpandedSeqId(seqId);
    setSearch('');
    setSearchResults([]);
    await refreshSequenceSongs(seqId);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const res = await nativeApiFetch(`/api/songs?search=${encodeURIComponent(search)}`);
    setSearchResults(await res.json());
  }

  async function handleAddSong(songId: number) {
    if (expandedSeqId === null || programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${expandedSeqId}/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId }),
    });
    await refreshSequenceSongs(expandedSeqId);
  }

  async function handleRemoveSong(entryId: number) {
    if (expandedSeqId === null || programId === null) return;
    await nativeApiFetch(`/api/programs/${programId}/sequences/${expandedSeqId}/songs/${entryId}`, { method: 'DELETE' });
    await refreshSequenceSongs(expandedSeqId);
  }

  async function handleAddCollaborator(e: React.FormEvent) {
    e.preventDefault();
    if (programId === null) return;
    setCollaboratorError(null);
    const res = await nativeApiFetch(`/api/programs/${programId}/collaborators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newCollaboratorEmail }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία προσθήκης συνεργάτη');
      return;
    }
    setNewCollaboratorEmail('');
    await loadCollaborators(programId);
  }

  async function handleRemoveCollaborator(userId: number) {
    if (programId === null) return;
    setCollaboratorError(null);
    const res = await nativeApiFetch(`/api/programs/${programId}/collaborators/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCollaboratorError(typeof body?.error === 'string' ? body.error : 'Αποτυχία αφαίρεσης συνεργάτη');
      return;
    }
    if (userId === currentUser?.id) {
      router.push('/admin/programs');
      return;
    }
    await loadCollaborators(programId);
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }

  if (programId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <p className="text-lg">Δεν έχει επιλεγεί πρόγραμμα.</p>
        <button onClick={() => router.push('/admin/programs')} className="btn btn-primary">← Πίσω στα προγράμματα</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>

      {role && (
        <div className="card border border-base-300 bg-base-100">
          <div className="card-body gap-3 p-4">
            <h2 className="font-semibold">Συνεργάτες</h2>
            {collaboratorError && (
              <div role="alert" className="alert alert-error alert-sm">
                <span>{collaboratorError}</span>
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {creator && (
                <li className="flex items-center gap-2">
                  <span className="flex-1">
                    {creator.email}
                    {currentUser?.id === creator.id && ' (εσύ)'}
                    {' — δημιουργός'}
                  </span>
                </li>
              )}
              {collaborators.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="flex-1">
                    {c.email}
                    {currentUser?.id === c.id && ' (εσύ)'}
                  </span>
                  {role === 'creator' && (
                    <button onClick={() => handleRemoveCollaborator(c.id)} className="btn btn-ghost btn-xs text-error">
                      Αφαίρεση
                    </button>
                  )}
                </li>
              ))}
              {collaborators.length === 0 && !creator && <li className="text-sm text-base-content/50">Κανένας συνεργάτης ακόμη</li>}
            </ul>
            {role === 'creator' && (
              <form onSubmit={handleAddCollaborator} className="flex gap-2">
                <input
                  type="email"
                  value={newCollaboratorEmail}
                  onChange={(e) => setNewCollaboratorEmail(e.target.value)}
                  placeholder="Email συνεργάτη"
                  className="input input-bordered input-sm flex-1"
                  required
                />
                <button type="submit" className="btn btn-primary btn-sm">Προσθήκη</button>
              </form>
            )}
            {role === 'collaborator' && currentUser && (
              <button
                onClick={() => handleRemoveCollaborator(currentUser.id)}
                className="btn btn-outline btn-error btn-sm self-start"
              >
                Αποχώρηση από το πρόγραμμα
              </button>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleAddSequence} className="flex gap-2">
        <input
          value={newSeqTitle}
          onChange={(e) => setNewSeqTitle(e.target.value)}
          placeholder="Τίτλος νέας σειράς"
          className="input input-bordered flex-1"
          required
        />
        <button type="submit" className="btn btn-primary">Προσθήκη σειράς</button>
      </form>

      <ul className="flex flex-col gap-3">
        {sequences.map((seq) => (
          <li key={seq.id} className="card border border-base-300 bg-base-100">
            <div className="card-body gap-3 p-4">
              {editingSeqId === seq.id ? (
                <form onSubmit={(e) => handleRenameSequence(e, seq.id)} className="flex items-center gap-2">
                  <input
                    value={editingSeqTitle}
                    onChange={(e) => setEditingSeqTitle(e.target.value)}
                    className="input input-bordered input-sm flex-1"
                    autoFocus
                    required
                  />
                  <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                  <button type="button" onClick={() => setEditingSeqId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => handleToggleExpand(seq.id)} className="btn btn-ghost btn-sm flex-1 justify-start">
                    {expandedSeqId === seq.id ? '▾' : '▸'} {seq.title}
                  </button>
                  <button onClick={() => startEditingSequence(seq)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                  <button onClick={() => handleDeleteSequence(seq.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή σειράς</button>
                </div>
              )}

              {expandedSeqId === seq.id && (
                <div className="flex flex-col gap-3 border-t border-base-300 pt-3">
                  <ul className="flex flex-col gap-1">
                    {seqSongs.map((entry, i) => (
                      <li key={entry.sequenceSongId} className="flex items-center gap-2">
                        <span className="badge badge-neutral badge-sm">{i + 1}</span>
                        <span className="flex-1">{entry.song.title}</span>
                        <button onClick={() => handleMoveSong(i, -1)} disabled={i === 0} className="btn btn-ghost btn-xs">↑</button>
                        <button onClick={() => handleMoveSong(i, 1)} disabled={i === seqSongs.length - 1} className="btn btn-ghost btn-xs">↓</button>
                        <button onClick={() => handleRemoveSong(entry.sequenceSongId)} className="btn btn-ghost btn-xs text-error">Αφαίρεση</button>
                      </li>
                    ))}
                    {seqSongs.length === 0 && <li className="text-sm text-base-content/50">Κανένα τραγούδι ακόμη</li>}
                  </ul>

                  <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Αναζήτηση τραγουδιού για προσθήκη"
                      className="input input-bordered input-sm flex-1"
                    />
                    <button type="submit" className="btn btn-sm">Αναζήτηση</button>
                  </form>
                  {searchResults.length > 0 && (
                    <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                      {searchResults.map((s) => (
                        <li key={s.id} className="flex items-center gap-2">
                          <span className="flex-1">{s.title}</span>
                          <button onClick={() => handleAddSong(s.id)} className="btn btn-primary btn-xs">+ Προσθήκη</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
        {sequences.length === 0 && <li className="text-sm text-base-content/50">Καμία σειρά ακόμη</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/admin/local/programs/edit/page.tsx"
git commit -m "Add native program-edit page (admin/local/programs/edit)"
```

---

## Task 10: Port `admin/programs` list — platform-aware navigation

**Files:**
- Modify: `src/app/admin/programs/page.tsx`

**Interfaces:**
- Consumes: `nativeApiFetch` (Task 1), `isNativeApp` (existing), `setSelectedEditProgramId` (Task 2), `preferencesStore` (existing), the `/admin/local/programs/edit` route (Task 9).

- [ ] **Step 1: Replace the whole file**

```tsx
// src/app/admin/programs/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { nativeApiFetch } from '@/lib/nativeApiFetch';
import { isNativeApp } from '@/lib/platform';
import { preferencesStore } from '@/lib/preferencesStore';
import { setSelectedEditProgramId } from '@/lib/adminEditStore';

interface Program {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

function sharedBadgeText(emails: string[]): string {
  if (emails.length === 0) return '';
  if (emails.length === 1) return `μοιράζεται με ${emails[0]}`;
  return `μοιράζεται με ${emails[0]} +${emails.length - 1} ακόμα`;
}

export default function ProgramsAdminPage() {
  const native = isNativeApp();
  const router = useRouter();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  async function load() {
    const res = await nativeApiFetch('/api/programs');
    setPrograms(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await nativeApiFetch('/api/programs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setError('Αποτυχία δημιουργίας προγράμματος');
      return;
    }
    setTitle('');
    await load();
  }

  async function handleDelete(id: number) {
    await nativeApiFetch(`/api/programs/${id}`, { method: 'DELETE' });
    await load();
  }

  function startEditing(p: Program) {
    setEditingId(p.id);
    setEditingTitle(p.title);
  }

  async function handleRename(e: React.FormEvent, id: number) {
    e.preventDefault();
    await nativeApiFetch(`/api/programs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: editingTitle }),
    });
    setEditingId(null);
    await load();
  }

  async function handleOpenProgram(id: number) {
    await setSelectedEditProgramId(preferencesStore, id);
    router.push('/admin/local/programs/edit');
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Προγράμματα</h1>
      {error && (
        <div role="alert" className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Τίτλος προγράμματος"
          className="input input-bordered flex-1"
          required
        />
        <button type="submit" className="btn btn-primary">Προσθήκη</button>
      </form>
      <ul className="list rounded-box bg-base-100 shadow">
        {programs.map((p) => (
          <li key={p.id} className="list-row items-center gap-2">
            {editingId === p.id ? (
              <form onSubmit={(e) => handleRename(e, p.id)} className="flex flex-1 gap-2">
                <input
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  className="input input-bordered input-sm flex-1"
                  autoFocus
                  required
                />
                <button type="submit" className="btn btn-primary btn-sm">Αποθήκευση</button>
                <button type="button" onClick={() => setEditingId(null)} className="btn btn-ghost btn-sm">Άκυρο</button>
              </form>
            ) : (
              <>
                <div className="flex flex-1 flex-col gap-1">
                  {native ? (
                    <button onClick={() => handleOpenProgram(p.id)} className="link link-hover text-left">{p.title}</button>
                  ) : (
                    <Link href={`/admin/programs/${p.id}`} className="link link-hover">{p.title}</Link>
                  )}
                  {p.sharedWithEmails.length > 0 && (
                    <span className="badge badge-ghost badge-xs w-fit">{sharedBadgeText(p.sharedWithEmails)}</span>
                  )}
                </div>
                <button onClick={() => startEditing(p)} className="btn btn-ghost btn-sm">Μετονομασία</button>
                {p.role === 'creator' && (
                  <button onClick={() => handleDelete(p.id)} className="btn btn-ghost btn-sm text-error">Διαγραφή</button>
                )}
              </>
            )}
          </li>
        ))}
        {programs.length === 0 && <li className="list-row text-base-content/50">Κανένα πρόγραμμα ακόμη</li>}
      </ul>
    </div>
  );
}
```

Note: this reuses `sharedBadgeText` from the program-sharing feature's UI, copied inline the same way `src/app/programs/page.tsx` already does — importing `@/lib/programBadge` would be equally valid here (it already exists after the sharing feature shipped); either is fine, this plan copies the existing web file's exact current approach unchanged.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Rebuild the mobile bundle**

```bash
npm run build:mobile
```

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/programs/page.tsx
git commit -m "Port programs list to native-aware navigation and nativeApiFetch"
```

---

## Task 11: Home page entry point

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:** none new — reuses the existing `native`/`loaded` render pattern already in this file.

- [ ] **Step 1: Add the "Διαχείριση" button**

`src/app/page.tsx` already has a web-only admin link:
```tsx
      {!native && <Link href="/admin/songs" className="link">Διαχείριση (admin)</Link>}
```
Add a native equivalent right after the existing native "Σταθερά προγράμματα" block (which reads):
```tsx
      {native && (
        <Link href="/programs/local" className="btn btn-outline btn-lg">
          Σταθερά προγράμματα
        </Link>
      )}
```
Insert immediately after it:
```tsx
      {native && (
        <Link href="/admin/songs" className="btn btn-outline btn-lg">
          Διαχείριση
        </Link>
      )}
```
(Styled as a full `btn btn-outline btn-lg` like the other native buttons, rather than the small text `link` the web version uses — matches how native's other entry points on this page are already bigger tap targets than their web counterparts.)

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Rebuild the mobile bundle**

```bash
npm run build:mobile
```

- [ ] **Step 4: Remove any temporary direct links added during Task 4/6's manual verification**

If Task 4 or Task 6 used a temporary `<Link href="/admin/regions">`-style shortcut to reach a page before this button existed, remove it now — "Διαχείριση" → the songs list → the other sections' nav (via the existing `AdminLayout` navbar, already shared and unchanged) is the real entry point.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "Add native home-page entry point for the admin tool"
```

---

## Task 12: Full manual end-to-end verification

No code changes. Full walkthrough on a real device/emulator, covering all 7 sections plus the two flagged unknowns' final confirmation in context (not in isolation, as Tasks 4/6 already did).

- [ ] **Step 1: Build and install**

```bash
npm run build:mobile
```
Install on device, log in.

- [ ] **Step 2: Home → Διαχείριση**

Tap "Διαχείριση" from the home screen. Confirm it lands on the songs list with the `AdminLayout` navbar visible (Τραγούδια, Προγράμματα, Περιοχές, Ρυθμοί, Δρόμοι, Συνθέτες, Είδη, Αρχική).

- [ ] **Step 3: Taxonomy sections (5×)**

For each of Περιοχές, Ρυθμοί, Δρόμοι, Συνθέτες, Είδη: create one entry, confirm it appears in the list, delete it, confirm it's gone. (Already spot-checked for Περιοχές in Task 4 — this step covers the remaining 4 plus a final confirmation of Περιοχές in the fully-wired app.)

- [ ] **Step 4: Songs — create, edit, delete**

Create a new song with an image upload (full flow, not just the upload step Task 6 already checked in isolation) and at least one axis value via `SongAxisEditor`. From the list, open it — confirm it lands on `admin/local/songs/edit` with the data pre-filled. Change the title, save, confirm the list reflects it. Delete it, confirm it's gone from the list.

- [ ] **Step 5: Programs — create, sequences, songs, and collaborators**

**Prerequisite for the collaborators portion of this step:** the program-sharing feature's 12 commits must be pushed to `origin/main` first (native tests the deployed API). If they aren't yet, stop after the sequences/songs portion below and note the collaborators check as blocked, not failed.

Create a new program. Open it — confirm it lands on `admin/local/programs/edit`. Add a sequence, search for and add a song to it, reorder it, remove it. Rename the sequence, delete it. Once the push has happened: add a collaborator by email, confirm they appear in the list; if a second test account is available, log in as it and confirm the program is visible and editable there too; remove the collaborator and confirm.

- [ ] **Step 6: Confirm web is unaffected**

In a regular browser, visit `/admin/songs`, `/admin/programs`, and one taxonomy page. Confirm every create/edit/delete flow still works exactly as before this plan — the dynamic routes (`admin/songs/[id]`, `admin/programs/[id]`) are still there and functioning for web, untouched.

- [ ] **Step 7: Clean up test data**

Delete any test songs/programs/taxonomy entries created during this verification, on whichever account(s) were used.

No commit for this task — it's a verification checkpoint.
