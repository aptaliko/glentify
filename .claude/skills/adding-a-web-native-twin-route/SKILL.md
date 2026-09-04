---
name: adding-a-web-native-twin-route
description: Use when adding any page keyed by a database id to Glentify (a detail page, an
  edit page, anything under a [id] segment). The same page needs a web dynamic route AND a
  query-param-free native twin, because the mobile build is a static export that cannot
  parameterize a DB id at build time. Symptoms: page works on web but 404s in the APK,
  "output: export", "[id]", "local route", "adminEditStore", "static export", "isNativeApp",
  "which id does the native page load".
---

# Adding a Web + Native Twin Route

## Overview

The same `src/app` tree is built twice: full Next.js server for web, and a **static export**
(`output: 'export'`) for native (`scripts/build-mobile.sh`). Static export cannot
parameterize an arbitrary DB id at build time, so **any page keyed by a database id needs
two routes**:

- a `[id]` **dynamic route** for web, and
- a query-param-free **native twin** under a `.../local/...` path.

The build script **deletes** every dynamic `[id]` route it can't statically export during
staging and **hard-fails if any stripped path survives** — so a web-only `[id]` page isn't a
soft degrade on native, it's a missing route. The native twin gets "which id" not from the
URL but from a tiny persisted selector the list page writes right before navigating, or from
data already in the offline cache.

Consequence you can't skip: if you add a `[id]` page and no twin, it works in `npm run dev`
and 404s in the APK.

## When to use

- Adding any page whose route includes a `[id]` (or other DB-id) segment: detail, edit,
  nested resource pages.
- **Not** for a static page with no id in its path (one route serves both builds).

## The established twin pairs (copy the nearest)

| Web (`[id]`) | Native twin | How the twin learns the id |
|---|---|---|
| `programs/[id]` | `programs/local/program` | offline cache / selector |
| `session/[id]` | `session/local` | selector |
| `admin/programs/[id]` | `admin/local/programs/edit` | `adminEditStore` selector |
| `admin/songs/[id]` | `admin/local/songs/edit` | `adminEditStore` selector |

## The selector handoff

`src/lib/adminEditStore.ts` is the pattern for "which id": the **list page writes the
selection right before navigating**, the **twin reads it on mount**.

- List page (e.g. `admin/programs/page.tsx`) calls
  `setSelectedEditProgramId(storage, id)` then navigates to the local twin.
- Twin (`admin/local/programs/edit/page.tsx`) calls `getSelectedEditProgramId(storage)` on
  mount to know what to load; `clearSelectedEditProgramId` when done.

For read-only detail pages, the twin can instead read the entity straight from the offline
cache (`*DetailCache.ts`) by the selected id — no URL param either way.

## Checklist (create a todo per item)

1. **Web route**: create the `[id]` dynamic route under `src/app/...` as normal (Server
   Component or client page hitting the API).
2. **Native twin**: create the `.../local/...` twin page — **no dynamic segment, no
   `searchParams` for the id**. Read the id from `adminEditStore` (writable pages) or the
   offline cache (read-only pages).
3. **Selector write**: in the list/source page, persist the id via the appropriate
   `setSelected...Id` **before** `router.push` to the twin.
4. **Platform gate navigation**: route to `[id]` on web and to the twin on native using
   `isNativeApp()` from `src/lib/platform.ts` — **not** `isNativePlatform()` directly.
   `isNativeApp()` is a build-time constant (`NEXT_PUBLIC_MOBILE_BUILD=1`), so
   server-prerendered HTML and first client render agree; the raw runtime check is `false`
   during prerender and hydration-mismatches a native-only UI.
5. **Native data fetch**: any API call the twin makes must go through
   `nativeApiFetch` (`src/lib/nativeApiFetch.ts`), not bare `fetch` — it resolves the
   absolute API URL and attaches the bearer token. Background/sync callers pass
   `{ redirectOn401: false }`.
6. **Verify staging strips cleanly**: the twin must be reachable in the exported bundle and
   the `[id]` route must be one the build script removes. Run `npm run build:mobile` and
   confirm it doesn't hard-fail on a surviving stripped path.

## Common mistakes

- **Only the `[id]` route.** Works in dev, 404s in the APK, and the mobile build may hard-fail
  on the stripped path. Every id-keyed page needs the twin.
- **Reading the id from the URL in the twin.** Static export has no id in the path. Use the
  selector or the cache.
- **`isNativePlatform()` for render gating.** Hydration mismatch on native-only UI. Use
  `isNativeApp()`.
- **Bare `fetch` in the twin.** No base URL, no token → fails on device (which has no
  `proxy.ts`). Use `nativeApiFetch`.
