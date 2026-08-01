# Native Mobile (Capacitor) with Offline Live Sessions — Design

## Background

Glentify is a Next.js App Router app deployed to Vercel, backed by Neon Postgres via Drizzle. Every page is already a `'use client'` component that fetches its data from `/api/*` at runtime — no server component reads the database directly. Auth is a single shared `APP_PASSWORD`, enforced by `src/proxy.ts` (this Next.js version's replacement for `middleware.ts`) via an HMAC-derived `glentify_auth` cookie, checked on every request except `/login` and `/api/login`.

The user wants native iOS/Android apps, without giving up the web app or touching the database. The driving reason is **offline use during a live gig**: venues may have no signal, and the app must still show lyrics, run song suggestions, and track which songs were played, for the whole night.

## Goal

Ship native iOS/Android apps (via Capacitor) that:
- Reuse the existing Next.js codebase and UI — the web app is unaffected.
- Work fully offline once a device has synced at least once, including a cold app launch with zero signal.
- Do not add, remove, or alter any database table, column, or row.

## Why not a remote-URL wrapper

The simplest possible Capacitor setup points the native WebView at the live Vercel URL. This was rejected: a cold launch with no signal has nothing to load unless a service worker intercepts the navigation request, and Capacitor's iOS WKWebView support for service workers against a remote origin is restricted (`WKAppBoundDomains`) and not reliable enough to promise "walk into a venue with no signal, open the app, it works." Since that is the actual requirement, this approach is out.

## Architecture

Two build outputs from one codebase:

- **Web** (unchanged): `next build`, deployed to Vercel exactly as today — dynamic API routes, cookie auth, DB access via Drizzle/Neon.
- **Mobile**: a second, separately-invoked build using `output: 'export'`, run against a **staged copy** of `src/app` with `api/`, `admin/`, and `programs/` removed, producing a static HTML/JS/CSS bundle. Capacitor packages that bundle as the native app's local assets for iOS/Android, so the app shell loads instantly with zero network, from a cold start. At runtime, the app still calls the same deployed Vercel API over HTTPS for data — it just doesn't need a server to render pages.

Confirmed by actually running `next build` with `output: 'export'`: Next.js requires every `[param]`-style dynamic route to have `generateStaticParams()`, which is impossible for `/session/[id]` (IDs are runtime/local) and `/programs/[id]`. Since neither admin screens nor program browsing are part of the offline scope, the mobile build's staged copy excludes `admin/` and `programs/` entirely (sidesteps the requirement without touching those files), and mobile gets a **new, separate, non-dynamic route** — `src/app/session/local/page.tsx` — as its live-session entry point instead of reusing `/session/[id]`. The existing `/session/[id]/page.tsx` is untouched and keeps working exactly as today for web; mobile simply never includes it in its build. One visible consequence: mobile's live session lives at `/session/local`, not `/session/<id>` — a different URL shape than web, which is an unavoidable result of the static-export constraint, not a chosen behavior change.

No schema or data changes. The new server-side surface is one additional read-only API route (below) and an auth extension (below) — both purely additive to the existing API.

## New/changed components

- **`src/app/api/reference-data/route.ts`** (new) — bulk `GET` returning everything `buildSuggestionsResponse` (below) needs: all songs (lyrics, keys), their axis values, regions, rhythms, dromoi, composers, axis types, and genres, in one payload. This is what a device caches to run suggestions fully offline.
- **`src/lib/suggestions.ts`** — extract the label/formatting logic currently inline in `GET /api/sessions/[id]/suggestions` (axis labels, genre names, `listTitle`, grouped-vs-filtered shaping) into a new pure `buildSuggestionsResponse()` function. The existing route is refactored to call it (behavior-preserving, covered by tests); this is the one existing route that changes, because mobile must reproduce its output exactly. `listSongs`-style filtering and `getUsedTopLevelRegionsForGenre`-style lookups are **not** extracted from `src/db/queries/` — small equivalent pure versions are written fresh in `src/lib/` for the local data sources below, so the existing, untested `/api/songs` and `/api/genres/[id]/regions` routes are left alone.
- **`src/lib/sessionStore.ts`** (new) — a small interface (`getCurrentState()`, `pickSong(id)`, `endSequence()`, `endSession()`) with two implementations:
  - `RemoteSessionStore` — today's behavior, extracted as-is from `session/[id]/page.tsx` (hits `/api/sessions/...`). Used by web.
  - `LocalSessionStore` — holds current song + played-song set in local storage, calls `buildSuggestionsResponse()` directly against the cached reference-data payload for every state transition (`pickSong`, `endSequence`, `endSession` mirror `advanceToSong`/`endSequence`/`endSession` in `src/db/queries/sessions.ts`). Never touches the network. Used by mobile — mobile sessions are local-only by design (see below), never written to the `sessions` / `session_played_songs` tables.
- **`src/components/SongPicker.tsx`** — the offline "start a new session" flow needs to pick a song from cached data too, so `SongPicker` takes an injectable data-source prop (`listGenres`, `listRegionsForGenre`, `listSongs`), defaulting to today's `fetch`-based behavior (web, unchanged) with a new local implementation (small pure equivalents of the filtering logic, reading the cached reference-data payload) used on mobile.
- **`src/components/LiveSessionView.tsx`** (new) — the presentational JSX currently inline in `session/[id]/page.tsx` (header, lyrics card, suggestion list), extracted so both the untouched `/session/[id]` route (web) and the new `/session/local` route (mobile) render identically from whichever `SessionStore` they're given.
- **`src/app/session/local/page.tsx`** (new, mobile-only) — live-session entry point with no dynamic segment, wired to `LocalSessionStore`, rendering `<LiveSessionView>`. Required because `output: 'export'` cannot support `/session/[id]` (see Architecture).
- **`src/lib/offlineCache.ts`** (new) — thin IndexedDB wrapper: store/retrieve the reference-data payload and the auth token. Kept deliberately dumb (no business logic) so it can be verified on-device rather than unit tested; the logic that matters (`LocalSessionStore`, `buildSuggestionsResponse`) is tested behind an injectable storage interface instead.
- **`src/proxy.ts`** — extend to also accept `Authorization: Bearer <token>` on `/api/*` (web's cookie path is untouched, reuses the existing `isAuthCookieValid` check), and emit CORS headers for the Capacitor app's origin.
- **`src/app/api/login/route.ts`** — also return the token in the JSON response body (already computed server-side for the cookie; just needs exposing) so mobile can capture and store it.
- **`capacitor.config.ts`, `ios/`, `android/`** (new) — standard Capacitor project scaffolding.
- **`scripts/build-mobile.sh`** (new) — stages a copy of `src/app` with `api/`, `admin/`, and `programs/` removed, runs `next build` with `output: 'export'` against that copy, hands the resulting `out/` folder to `npx cap sync`.

## Why mobile sessions are local-only

Nothing in the app today reads session history back (no "past sessions" admin view). Syncing a locally-started session back to the server would require reconciling a temporary local ID against a server-assigned one, with no current feature that consumes the result. Mobile sessions therefore live entirely on the device — current song, played-song list, start/end — and are never written to `sessions` / `session_played_songs`. Starting a new session offline just means generating a local ID and picking the first song from the cached song list; there is nothing to reconcile later.

## Auth for mobile

The bundled app runs from a `capacitor://localhost`-style origin, so the existing `httpOnly`/`sameSite: 'lax'` cookie will not be sent cross-origin to the Vercel API. Instead:

1. `POST /api/login` returns the existing HMAC token in its JSON body (in addition to still setting the cookie, for web).
2. Mobile stores that token via Capacitor Preferences.
3. Every mobile API call sends `Authorization: Bearer <token>`.
4. `src/proxy.ts` accepts either the cookie (web) or the bearer header (mobile), validating both with the same underlying check. CORS headers are added for the Capacitor app's origin so the cross-origin `fetch` calls succeed.

Web behavior is unchanged throughout.

## Data flow

- **Sync**: on app launch (or a manual "Sync" action), if online, mobile calls `GET /api/reference-data` with its bearer token and writes the result to IndexedDB, replacing the previous cache.
- **Login**: mobile POSTs to `/api/login` as today; the response now also includes the token, which mobile persists locally instead of relying on a cookie.
- **Live session (mobile)**: `/session/local` (new route) always uses `LocalSessionStore`. All suggestion computation happens on-device against the cached payload; "mark played" and "current song" updates only touch local storage.
- **Live session (web)**: unchanged — `/session/[id]` always uses `RemoteSessionStore`, hitting the API per action exactly as today.
- **Starting a session (mobile)**: `session/new/page.tsx` detects the native platform and, instead of `POST /api/sessions`, calls `LocalSessionStore`'s local-create path (generates a local ID, picks the starting song via the offline `SongPicker`), then navigates to `/session/local`.

## Error handling

- **Stale/missing cache on mobile**: if suggestions are needed but no sync has ever completed, show an explicit "connect once to download songs" state rather than a blank or broken suggestion list.
- **Expired/invalid token**: a 401 from `/api/reference-data` clears the stored token and routes back to the login screen. Cached song data remains usable for an in-progress session even with a stale token — only the *sync* action itself requires a valid one.
- **Export build misconfiguration**: `scripts/build-mobile.sh` fails loudly if `src/app/api` is still present when `output: 'export'` runs, since Route Handlers using `Request` are unsupported in that mode and would otherwise fail confusingly deep in the Next.js build.

## Testing

- `src/lib/suggestions.ts` already has unit tests; `LocalSessionStore` is a thin wrapper around it, so its tests cover local read/write/played-list bookkeeping, not suggestion logic itself.
- `src/lib/auth.ts` gets a unit test for bearer-token validation alongside the existing cookie test.
- Manual verification: `npm run test`, then a real-device/simulator pass — sync once online, force airplane mode, cold-launch the app, run a full session end-to-end offline. Separately confirm the web app still works untouched (login, admin CRUD, live session) after these changes.

## Out of scope

- Any admin/CRUD screen working offline — those require a connection on both web and mobile, by design (see clarifying discussion: only the live session screen needs offline support).
- Syncing mobile session history back to the server — mobile sessions are local-only and ephemeral to the device (see above).
- App Store / Play Store publishing steps, code signing, native push notifications, or any other native-device feature beyond offline data access.
