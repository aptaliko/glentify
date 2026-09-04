# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this app is

Glentify is a live-performance setlist tool for Greek musicians. During a γλέντι (live gig)
it shows the current song's lyrics plus ranked suggestions for what to play next, based on
shared classification axes (ρυθμός/rhythm, περιοχή/region, δρόμος/dromos, composer, year,
genre) rather than a fixed setlist. Domain vocabulary in code/comments/UI strings is Greek —
γλέντι = live session, σειρά = a run/sequence of songs within a session or program. The
original MVP spec (`docs/superpowers/specs/2026-07-26-panigyri-setlist-app-design.md`) is in
Greek and is a good primer on the domain, but is **out of date on the data model** — read
`docs/superpowers/specs/2026-07-29-dynamic-song-tags-design.md` and
`2026-08-12-remove-genre-column-design.md` for the model actually in `src/db/schema.ts`.
`docs/superpowers/specs/` and `docs/superpowers/plans/` hold one design + implementation
plan per feature, filed by date — check there before assuming why something is shaped the
way it is.

## Commands

```bash
npm run dev              # Next.js dev server
npm run build             # production web build
npm run lint               # eslint
npm test                    # vitest run — full suite, non-watch
npx vitest run src/lib/suggestions.test.ts   # single test file
npx vitest run -t "test name substring"        # single test by name

npm run dev:up             # local dev: (re)start Docker Postgres + neon-http proxy, migrate, seed. `-- --reset` wipes data
npm run dev:down            # stop the local Docker stack
npm run db:generate        # drizzle-kit generate — after editing src/db/schema.ts
npm run db:migrate          # apply migrations (needs .env.local / DATABASE_URL)
npm run build:mobile        # stage + static-export the native (Capacitor) bundle into out/, `cap sync`, then build a debug APK
```

**Local dev runs against Docker, not prod.** `npm run dev:up` (`scripts/dev-up.sh`) tears
down any previous run, starts Postgres + a neon-http proxy (`docker-compose.yml`), then runs
migrate → `db:migrate-to-multiuser` (admin `admin@local`/`admin`, backfills `owner_id`) →
`seed-axis-types` → `seed-dev` (Greek test data). The proxy exists so local keeps the SAME
`drizzle-orm/neon-http` driver as prod (identical behaviour, incl. no interactive
transactions) instead of swapping to `pg`. `NEON_LOCAL=1` in `.env.local` flips the app +
scripts to the proxy via `src/db/neonConfig.ts` (a no-op in prod).

Setup order for a fresh database (any environment) is `db:migrate` → `db:migrate-to-multiuser`.
The `owner_id NOT NULL` constraint is migration `0012` in the normal `./drizzle` folder — safe
on a fresh, empty DB and a harmless no-op on already-finalized prod. (Historically it lived in a
separate `drizzle-finalize/` folder run as a third `db:migrate:finalize` step, to avoid tightening
before the one-time single→multi-user backfill; that folder/step was removed once prod was
migrated, since every new DB now starts empty and multi-user.) See `README.md` for full setup.

**Installable debug APK**: `npm run build:mobile` (`scripts/build-mobile.sh`) ends by
running `cd android && ./gradlew assembleDebug` itself, so every run leaves a fresh
`android/app/build/outputs/apk/debug/app-debug.apk` — no separate step needed. Gradle
auto-signs it with the default debug keystore — installable via `adb install` or copying
to the device, but not a Play Store release build; `android/app/build.gradle` has no
`release` `signingConfig`, so `assembleRelease` produces an unsigned APK that won't
install as-is.

`@capacitor/android` 8.x requires Java 21 source/target compatibility
(`node_modules/@capacitor/android/capacitor/build.gradle`). If `~/.gradle/gradle.properties`
(GRADLE_USER_HOME — a machine-wide file, not part of this repo) pins `org.gradle.java.home`
to an older JDK, the APK step in `build-mobile.sh` resolves a JDK 21 itself via
`/usr/libexec/java_home -v 21` (macOS) and passes it through `GRADLE_OPTS` for just that
invocation — it doesn't touch the global pin, in case another project on the same machine
depends on it. If no JDK 21 is found, the script logs a warning and skips the APK step
without failing the rest of the mobile build (`out/` and `android/` are still refreshed);
install a JDK 21 and rerun, or build the APK manually:

```bash
cd android && GRADLE_OPTS="-Dorg.gradle.java.home=$(/usr/libexec/java_home -v 21)" ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

(or point at a specific JDK 21 install directly, e.g. a SDKMAN path, if `java_home` finds
none).

Gradle auto-signs this with the default debug keystore — installable via `adb install` or
copying to the device, but not a Play Store release build. `android/app/build.gradle` has
no `release` `signingConfig`, so `assembleRelease` produces an unsigned APK that won't
install as-is.

## Architecture

### Data model & ownership

`src/db/schema.ts` (Drizzle/Postgres). Songs are classified generically: `axisTypes` (a
fixed, code-seeded list — region/rhythm/dromos/composer/year/genre) and `songAxisValues`
(one row per song per axis actually set, `refId` pointing into the axis's lookup table, or
`yearValue` for the `year` axis, unique on `(songId, axisType)`). There is no per-song
fixed rhythm/region/genre column — adding a new axis means a new lookup table plus a seed
row, not a schema migration on `songs`. The suggestion engine (`src/lib/suggestions.ts`:
`getFilteredCandidates`/`rankBySharedAxes`/`getSuggestions`) is itself axis-agnostic; it
ranks candidates by whichever axes the current song has, toggled at the call site.

A new column on `programs`/`program_sequences` (e.g. the `version` conflict guard) must be
threaded through **every** read path independently — the offline-blob builder
(`listProgramsWithSequencesAndSongs`), the online list path
(`listAccessiblePrograms`/`summarize`), *and* the detail `GET /api/programs/[id]` — because a
client-side `as` cast on a fetch response asserts the field without producing it, so a missed
projection compiles clean and passes vitest yet is `undefined` at runtime. Grep the field
across those three sites when adding one.

Every account-scoped table carries `ownerId`. On `songs`/`programs`/`sessions` it's
`NOT NULL` — no cross-user visibility. On the taxonomy tables (`regions`, `rhythms`,
`dromoi`, `genres`, `composers`) it's **nullable**: `NULL` means a shared baseline row,
editable only by `role: 'admin'` users; non-null means a user's own private addition to
that list. Programs additionally support collaborators
(`programCollaborators`/`getProgramAccess` in `src/db/queries/programs.ts`, returning
`'creator' | 'collaborator' | null`) — a program a user can't access 404s, never 403s, so
as not to leak that a given ID exists.

`src/db/queries/*.ts` is one file per entity, plain functions taking Drizzle's `db` client
directly — no repository/service class layer.

### Auth

Homegrown, not a library: `src/lib/auth.ts` signs a `userId.expiresAt.hmacSignature` token
(HMAC-SHA256 over `AUTH_SECRET`, 30-day TTL, no refresh). `src/proxy.ts` — **not**
`middleware.ts`; this Next.js version renamed it (see `AGENTS.md`/`node_modules/next/dist/docs/`)
— verifies the token from either the `glentify_auth` cookie (web) or an `Authorization:
Bearer` header (native, since the cookie never reaches `capacitor://localhost`), and injects
the resolved `x-user-id` header for every downstream route/page. API routes read it via
`getUserId(request)` in `src/lib/requestUser.ts`, which throws if the header is missing —
that should only happen if a route bypasses the proxy's matcher.

### One codebase, two builds: web vs native

The same `src/app` tree is built twice, for genuinely different runtimes:

- **Web** (`npm run build`, deployed to Vercel): full Next.js server — API routes, dynamic
  `[id]` routes, `proxy.ts` cookie auth, Server Components hitting the DB directly.
- **Native** (`npm run build:mobile` → `scripts/build-mobile.sh`): rsyncs the repo into
  `.mobile-build/`, **deletes** everything a static export can't have —
  `src/app/api`, every dynamic `[id]` route under `admin/songs`, `admin/programs`,
  `programs`, `session`, and `proxy.ts` itself — then runs `next build` there with
  `output: 'export'`, `NEXT_PUBLIC_MOBILE_BUILD=1` and `NEXT_PUBLIC_API_BASE_URL` pointed at
  the deployed web app (the on-device origin serves only static files, never the API). The
  script hard-fails if any stripped path survives staging. The result is copied to `out/`
  and handed to `npx cap sync` (Capacitor → `android/`, `ios/`).

Consequences for adding a feature that needs to work on both:

- Any page keyed by a database ID needs **two** routes: a `[id]` dynamic route for web, and
  a query-param-free `.../local/...` twin for native (e.g. `programs/[id]` +
  `programs/local/program`, `session/[id]` + `session/local`,
  `admin/programs/[id]` + `admin/local/programs/edit`). Static export can't parameterize an
  arbitrary DB id at build time, so the native twin instead reads "which id" from a tiny
  persisted selector (`src/lib/adminEditStore.ts`) that the list page writes right before
  navigating, or from data already in the offline cache — never from the URL.
- Native code must call through `nativeApiFetch` (`src/lib/nativeApiFetch.ts`), not bare
  `fetch` — it resolves the absolute API URL, attaches the bearer token, and (by default)
  clears the token and hard-redirects to `/login` on a `401`, since native has no
  `proxy.ts` to do that page-level redirect for it. Background sync callers must pass
  `{ redirectOn401: false }` to avoid an unannounced navigation mid-sync.
- Gate platform-specific rendering with `isNativeApp()` (`src/lib/platform.ts`), not
  `isNativePlatform()` directly — the former is a build-time constant in the mobile bundle
  (`NEXT_PUBLIC_MOBILE_BUILD=1`), so server-prerendered HTML and first client render always
  agree; the latter reads a runtime global and is `false` during any prerender, which would
  hydration-mismatch a native-only UI.

### Offline sync

Native writes must work with no connectivity and reconcile once the device reconnects. The
pieces, all under `src/lib/`:

- **`offlineCache.ts`** + `*ListCache.ts`/`*DetailCache.ts` files — read-through IndexedDB
  caches of server data (reference data, songs list, programs list/detail), each one JSON
  blob per store, refreshed opportunistically on live fetches.
- **`syncQueue.ts`** — a generic, injectable-storage (`QueueStorage`) FIFO of
  `{ type, payload }` actions in IndexedDB. `enqueue()` appends; `processQueue()` walks it
  once, invoking the handler registered for each action's `type`:
  `'success'` removes it, `'item-error'` (request rejected — bad data, not found) requeues
  it to the back up to 3 attempts before flagging `needsAttention` (permanently skipped
  until a human acts), `'systemic-error'` (network failure or `401`, i.e. not this item's
  fault) stops the whole pass immediately, queue untouched. Triggered by
  `@capacitor/network` connectivity events, never polled.
- **`syncHandlers.ts`** — `initSyncHandlers()` is the single place every action type gets
  registered (`registerHandler('song-create', ...)` etc.) against `nativeApiFetch`; this is
  the file to extend when adding a new offline-writable action.
- **`draftIds.ts`** — offline-created entities (a song added while offline, say) get a
  negative, device-unique `mintDraftId()` instead of a real id, so UI can reference them
  before the create has synced. Once the sync handler's create succeeds, the real id is
  recorded (IndexedDB) and later payloads referencing the draft id resolve through it
  (`resolveOne`/`resolveMany`); an unresolved reference returns `'item-error'` so the
  dependent action waits its turn rather than failing outright.
- **`*Merge.ts`** files (`programsMerge.ts`, `songsMerge.ts`, `sequencesMerge.ts`,
  `taxonomyMerge.ts`, `collaboratorsMerge.ts`) — the recurring UI pattern: a pure function
  takes the last-known base list (from cache) plus the full queue snapshot, and produces
  what to render — a pending create appears un-clickable with a placeholder id, a pending
  delete optimistically disappears, a `needsAttention` item reverts to (or restores) the
  last-known real state instead of hiding a failure. No network/IO in these functions by
  design, so they're fully unit-tested and reusable between the page effect that renders the
  list and the count used to detect "this feature's queue just drained, refetch the base."
- **`SyncQueueProvider.tsx`**, mounted once from the root layout (so it survives
  client-side navigation), owns the connectivity listener, calls `initSyncHandlers()` once
  per app load, and exposes `useSyncQueue()` (pending/needsAttention counts,
  `notifyQueueChanged()` for a page to ping the badge right after enqueueing). It's a no-op
  on web.

Design rationale for any of this is in `docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md`
and the later `offline-*-design.md` specs that registered new action types against it.

### Testing convention

Vitest covers pure logic only — the merge functions, `suggestions.ts`, `syncQueue.ts`
(via a fake `QueueStorage`), `auth.ts`, password/token hashing, grouping/formatting
helpers. Nothing that touches IndexedDB directly, an API route, or Capacitor plugins has
automated coverage (by established convention, not oversight) — those are verified
manually, tracked in `docs/manual-testing-checklist.md` for the native-only surface.
