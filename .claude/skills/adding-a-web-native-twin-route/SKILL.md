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

## First: which family are you in? (this decides everything below)

There are **two real patterns**, and the codebase splits by feature family — don't assume
the admin one:

- **Surviving-list + internal gate (admin family):** `admin/songs/page.tsx` /
  `admin/programs/page.tsx` exist in *both* builds and gate per-item navigation internally
  with `isNativeApp()` → `router.push('/admin/local/...')`. Selector: `adminEditStore.ts`.
- **Deleted-web-list + fork-at-entry (programs / session family):** the web list
  (`programs/page.tsx`) is **`rm`'d from the native bundle**; a *separate* `programs/local/page.tsx`
  exists, and the web/native fork happens **once at the entry point** (`src/app/page.tsx`:
  `native ? /programs/local : /programs`), not per-item. Selector: **`localProgramsStore.ts`**
  (`getSelectedProgramId`, key `glentify:selected-program-id`) — a *different* store and key
  from `adminEditStore`'s `glentify:admin-edit-program-id`. Reaching for the admin selector
  here loads the wrong id.

Read `build-mobile.sh` + `src/app/page.tsx` to see which family your route joins before wiring
navigation.

## The selector handoff

The **source page writes the selection right before navigating**, the **twin reads it on
mount** — using the store for *your family* (above).

- Admin: `setSelectedEditProgramId` → twin reads `getSelectedEditProgramId`, `clear…` when done.
- Programs: `setSelectedProgramId` → twin reads `getSelectedProgramId`.

For a read-only viewer twin the id comes from the selector but the *data* comes from the
whole-blob offline cache (`loadReferenceData()`), not a `*DetailCache`. **Program/sequence
viewers must resolve songs across both `referenceData.songs` AND `referenceData.sharedSongs`
via `mergeReferencedSongs`** — skip it and a collaborator's shared program renders with songs
silently missing.

## Checklist (create a todo per item)

1. **Web route**: create the `[id]` dynamic route under `src/app/...` as normal (Server
   Component or client page hitting the API).
2. **Native twin**: create the `.../local/...` twin page — **no dynamic segment, no
   `searchParams` for the id**. Read the id from `adminEditStore` (writable pages) or the
   offline cache (read-only pages).
3. **Selector write**: in the list/source page, persist the id via the appropriate
   `setSelected...Id` **before** `router.push` to the twin.
4. **Wire navigation per your family** (see the two patterns above). Admin family: gate the
   per-item link with `isNativeApp()` from `src/lib/platform.ts` (**not** `isNativePlatform()`
   — that's `false` during prerender and hydration-mismatches native-only UI). Programs/session
   family: no per-item gate — add the affordance to each family's existing viewer, already on
   the correct side of the entry fork.
5. **Native data fetch** (only if the twin hits the API): go through `nativeApiFetch`
   (`src/lib/nativeApiFetch.ts`), not bare `fetch` — absolute URL + bearer token;
   background/sync callers pass `{ redirectOn401: false }`. A cache-served viewer twin makes
   no API call at all.
6. **Verify staging by inspecting `out/`, not by trusting a hard-fail.** `build-mobile.sh`
   `rm`'s the stripped paths, but its `exit 1` survival guards only cover `api/`,
   `session/[id]`, and the two `admin/*/[id]` dirs — there is **no guard for `programs/[id]`**.
   So confirm directly: after staging, `grep .mobile-build/src/app/programs` shows `[id]` gone,
   and `out/.../local/.../index.html` for your twin was emitted. If you add a newly-stripped
   `[id]` family, add its own `if [ -d … ]; then … exit 1; fi` guard.

## Common mistakes

- **Only the `[id]` route.** Works in dev, 404s in the APK, and the mobile build may hard-fail
  on the stripped path. Every id-keyed page needs the twin.
- **Reading the id from the URL in the twin.** Static export has no id in the path. Use the
  selector or the cache.
- **`isNativePlatform()` for render gating.** Hydration mismatch on native-only UI. Use
  `isNativeApp()`.
- **Bare `fetch` in the twin.** No base URL, no token → fails on device (which has no
  `proxy.ts`). Use `nativeApiFetch`.
- **Twin links back to `/programs/${id}`.** A twin's own back/next links must target twin
  routes (`PageNav backHref="/programs/local..."`) — an `[id]` link 404s on device.
- **Wrong selector store.** `adminEditStore` (`glentify:admin-edit-program-id`) and
  `localProgramsStore` (`glentify:selected-program-id`) are near-identical names for different
  families. Use the one your family uses.
