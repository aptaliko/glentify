# Native Mobile (Capacitor) with Offline Live Sessions Implementation Plan

> **Status: COMPLETE.** All 14 tasks landed as commits `62c8f54..2e9120f`, ending in `781ce34` ("Fix final-review findings") and a later plan amendment (`2e9120f`, Task 14).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship native iOS/Android apps (via Capacitor) that reuse the existing Next.js codebase, run the live-session/suggestion flow fully offline after one sync, and leave the web app and database completely unaffected.

**Architecture:** Web keeps its normal `next build` deploy untouched. A separate build script stages a copy of `src/app` (dropping `api/`, `admin/`, `programs/`), builds it with `output: 'export'`, and hands the static bundle to Capacitor. Both platforms call the same deployed API for data; mobile additionally caches a bulk reference-data payload and runs the suggestion engine locally via a swappable `SessionStore`.

**Tech Stack:** Next.js 16 (App Router, Turbopack), TypeScript, Drizzle/Neon, Vitest, Capacitor 6 (`@capacitor/core`, `@capacitor/preferences`, `@capacitor/ios`, `@capacitor/android`), `dotenv-cli` (already a devDependency).

## Global Constraints

- No database schema or data changes (spec: "without touching the database").
- The web app's existing routes, behavior, and `/session/[id]` URL shape must not change, **except** that mobile gets a new, separate `/session/local` route — this is a confirmed, unavoidable consequence of `output: 'export'` requiring `generateStaticParams()` on `[id]` routes, verified by actually running the export build (see design doc, "Architecture").
- Mobile sessions (current song, played list) are local-only and are never written to the `sessions` / `session_played_songs` tables.
- All new UI copy is in Greek, matching existing strings in the codebase.
- `npm test` (`vitest run`) must stay green after every task.
- Existing convention: only pure `src/lib/*` logic gets unit tests; API routes, pages, and native scaffolding are verified manually (see README's "Testing" section) — follow this, don't invent a new testing layer.

---

### Task 1: Mobile build script and verified static export

**Files:**
- Create: `scripts/build-mobile.sh`
- Create: `src/app/session/local/page.tsx` (temporary placeholder — real implementation lands in Task 10)
- Modify: `.gitignore`

**Interfaces:**
- Produces: a working `npm run build:mobile` that writes a static export to `./out`, and a real (if minimal) `/session/local` route that later tasks will flesh out. Every later task that touches `src/app` must keep `npm run build:mobile` passing.

This task exists first, before any other mobile code, because it's the one step that could invalidate the whole approach — confirmed by hand that `output: 'export'` fails on `/session/[id]` and `/programs/[id]` (`generateStaticParams()` required), which is why the mobile build excludes `admin/`, `programs/`, and `api/` and gets its own non-dynamic `/session/local` route.

- [ ] **Step 1: Add the mobile build staging directory to `.gitignore`**

Add these two lines under the `# next.js` section of `.gitignore`:

```
/.mobile-build/
```

- [ ] **Step 2: Create the placeholder `/session/local` route**

```tsx
// src/app/session/local/page.tsx
'use client';

export default function LocalSessionPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200">
      <span className="loading loading-spinner loading-lg text-primary" />
    </main>
  );
}
```

- [ ] **Step 3: Write `scripts/build-mobile.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf .mobile-build out
mkdir -p .mobile-build

rsync -a \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude .mobile-build \
  --exclude out \
  --exclude ios \
  --exclude android \
  . .mobile-build/

ln -s ../node_modules .mobile-build/node_modules

rm -rf .mobile-build/src/app/api
rm -rf .mobile-build/src/app/admin
rm -rf .mobile-build/src/app/programs
rm -f .mobile-build/src/proxy.ts

if [ -d .mobile-build/src/app/api ]; then
  echo "build-mobile: src/app/api survived staging, aborting" >&2
  exit 1
fi

cat > .mobile-build/next.config.ts <<'CONFIG'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
};

export default nextConfig;
CONFIG

(cd .mobile-build && npx dotenv -e .env.local -- npx next build)

cp -R .mobile-build/out out
echo "Mobile static export written to ./out"
```

- [ ] **Step 4: Make the script executable and add the npm script**

```bash
chmod +x scripts/build-mobile.sh
```

In `package.json`, add to `"scripts"`:

```json
"build:mobile": "bash scripts/build-mobile.sh"
```

- [ ] **Step 5: Run it and verify the export actually succeeds**

Run: `npm run build:mobile`
Expected: ends with `Mobile static export written to ./out`, and `ls out` shows `index.html`, `login`, `login.html`, `session/new.html` (or `session/new/index.html`), `session/local.html` (or `session/local/index.html`) — no `api` directory anywhere under `out`.

- [ ] **Step 6: Verify the normal web build is unaffected**

Run: `npm run build`
Expected: succeeds exactly as before (dynamic build, no `output: 'export'` — this uses the real, untouched `next.config.ts`).

- [ ] **Step 7: Commit**

```bash
git add scripts/build-mobile.sh package.json .gitignore src/app/session/local/page.tsx
git commit -m "Add mobile static export build script"
```

---

### Task 2: Extract `buildSuggestionsResponse` as shared pure logic

**Files:**
- Modify: `src/lib/suggestions.ts`
- Modify: `src/lib/suggestions.test.ts`
- Modify: `src/app/api/sessions/[id]/suggestions/route.ts`

**Interfaces:**
- Produces: `buildSuggestionsResponse(input: BuildSuggestionsInput): SuggestionsResponsePayload`, `ReferenceLookups`, `SuggestionsResponsePayload`, `AvailableAxis`, `SuggestedSong`, `GenreGroupPayload` — exported from `src/lib/suggestions.ts`. These are the exact types Task 7 (`LocalSessionStore`) and Task 9 (`LiveSessionView`) consume.
- Consumes: existing `getSuggestions`, `AxisValue`, `SongWithAxes` from the same file (unchanged).

This is the one existing route that changes behavior-preservingly — mobile has to reproduce its output byte-for-byte, so the formatting logic (axis labels, genre names, `listTitle`) has to live in one shared place, not be duplicated.

- [ ] **Step 1: Write the failing test for `buildSuggestionsResponse`**

Add to `src/lib/suggestions.test.ts` (reuse the existing `makeSong`, `av`, and `regions` fixtures already in that file):

```ts
import { buildSuggestionsResponse } from './suggestions';
import type { RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

describe('buildSuggestionsResponse', () => {
  const rhythms: RhythmRow[] = [{ id: 1, name: 'Καλαματιανός' }];
  const dromoi: DromosRow[] = [{ id: 1, name: 'Ραστ' }];
  const composers: ComposerRow[] = [];
  const axisTypes: AxisTypeRow[] = [
    { id: 1, key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
    { id: 2, key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  ];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό' }];
  const lookups = { regions, rhythms, dromoi, composers, axisTypes, genres };

  it('returns an empty grouped response when there is no current song', () => {
    const result = buildSuggestionsResponse({
      currentSongWithAxes: null,
      allSongs: [],
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result).toEqual({
      currentSong: null,
      availableAxisTypes: [],
      activeAxisTypes: [],
      mode: 'grouped',
      candidates: [],
      genreGroups: [],
      listTitle: '',
    });
  });

  it('builds a filtered response with human-readable axis labels and a listTitle', () => {
    const current = makeSong(1, 'Τραγούδι Α');
    const candidate = makeSong(2, 'Τραγούδι Β');
    const allSongs = [
      { song: current, axisValues: [av('region', 3), av('rhythm', 1)] },
      { song: candidate, axisValues: [av('region', 3), av('rhythm', 1)] },
    ];
    const result = buildSuggestionsResponse({
      currentSongWithAxes: { id: 1, title: 'Τραγούδι Α', lyrics: null, maleKey: null, femaleKey: null, axisValues: [av('region', 3), av('rhythm', 1)] },
      allSongs,
      playedSongIds: new Set(),
      showPlayed: false,
      requestedActive: null,
      lookups,
    });
    expect(result.mode).toBe('filtered');
    expect(result.availableAxisTypes).toEqual([
      { key: 'region', label: 'Περιοχή', value: 'Κυκλάδες' },
      { key: 'rhythm', label: 'Ρυθμός', value: 'Καλαματιανός' },
    ]);
    expect(result.candidates).toEqual([{ id: 2, title: 'Τραγούδι Β', played: false }]);
    expect(result.listTitle).toBe('Άλλα τραγούδια με τα ίδια: Περιοχή, Ρυθμός');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/suggestions.test.ts`
Expected: FAIL — `buildSuggestionsResponse is not exported` / not defined.

- [ ] **Step 3: Add the types and implementation to `src/lib/suggestions.ts`**

Append to the end of `src/lib/suggestions.ts`:

```ts
import type { RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface ReferenceLookups {
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
}

export interface CurrentSongPayload {
  id: number;
  title: string;
  lyrics: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

export interface AvailableAxis {
  key: string;
  label: string;
  value: string;
}

export interface SuggestedSong {
  id: number;
  title: string;
  played: boolean;
}

export interface GenreGroupPayload {
  genreId: number;
  genreName: string;
  songs: SuggestedSong[];
}

export interface SuggestionsResponsePayload {
  currentSong: CurrentSongPayload | null;
  availableAxisTypes: AvailableAxis[];
  activeAxisTypes: string[];
  mode: 'filtered' | 'grouped';
  candidates: SuggestedSong[];
  genreGroups: GenreGroupPayload[];
  listTitle: string;
}

export interface BuildSuggestionsInput {
  currentSongWithAxes: (CurrentSongPayload & { axisValues: AxisValue[] }) | null;
  allSongs: SongWithAxes[];
  playedSongIds: Set<number>;
  showPlayed: boolean;
  requestedActive: Set<string> | null;
  lookups: ReferenceLookups;
}

export function buildSuggestionsResponse(input: BuildSuggestionsInput): SuggestionsResponsePayload {
  const { currentSongWithAxes, allSongs, playedSongIds, showPlayed, requestedActive, lookups } = input;

  if (!currentSongWithAxes) {
    return { currentSong: null, availableAxisTypes: [], activeAxisTypes: [], mode: 'grouped', candidates: [], genreGroups: [], listTitle: '' };
  }

  const currentAxisValues = currentSongWithAxes.axisValues;
  const availableAxisTypeKeys = currentAxisValues.map((v) => v.axisType);
  const effectiveActive = requestedActive
    ? new Set([...requestedActive].filter((t) => availableAxisTypeKeys.includes(t)))
    : new Set(availableAxisTypeKeys);

  const lookupNameById: Record<string, Map<number, string>> = {
    region: new Map(lookups.regions.map((r) => [r.id, r.name])),
    rhythm: new Map(lookups.rhythms.map((r) => [r.id, r.name])),
    dromos: new Map(lookups.dromoi.map((d) => [d.id, d.name])),
    composer: new Map(lookups.composers.map((c) => [c.id, c.name])),
  };
  const axisLabelByKey = new Map(lookups.axisTypes.map((t) => [t.key, t.label]));
  const genreNameById = new Map(lookups.genres.map((g) => [g.id, g.name]));

  function labelForAxisValue(v: AxisValue): string {
    if (v.axisType === 'year') return String(v.yearValue);
    const name = v.refId !== null ? lookupNameById[v.axisType]?.get(v.refId) : undefined;
    return name ?? '?';
  }

  const toSuggestion = (id: number, title: string): SuggestedSong => ({ id, title, played: playedSongIds.has(id) });

  const result = getSuggestions({
    currentSongId: currentSongWithAxes.id,
    currentAxisValues,
    activeAxisTypes: effectiveActive,
    allSongs,
    regions: lookups.regions,
    playedSongIds,
    showPlayed,
  });

  const availableAxisTypes: AvailableAxis[] = currentAxisValues.map((v) => ({
    key: v.axisType,
    label: axisLabelByKey.get(v.axisType) ?? v.axisType,
    value: labelForAxisValue(v),
  }));

  const currentSong: CurrentSongPayload = {
    id: currentSongWithAxes.id,
    title: currentSongWithAxes.title,
    lyrics: currentSongWithAxes.lyrics,
    maleKey: currentSongWithAxes.maleKey,
    femaleKey: currentSongWithAxes.femaleKey,
  };

  if (result.mode === 'grouped') {
    return {
      currentSong,
      availableAxisTypes,
      activeAxisTypes: [...effectiveActive],
      mode: 'grouped',
      candidates: [],
      genreGroups: result.genreGroups
        .map((g) => ({
          genreId: g.genreId,
          genreName: genreNameById.get(g.genreId) ?? '?',
          songs: g.songs.map((s) => toSuggestion(s.id, s.title)),
        }))
        .sort((a, b) => a.genreName.localeCompare(b.genreName, 'el')),
      listTitle: '',
    };
  }

  const activeLabels = [...effectiveActive].map((key) => axisLabelByKey.get(key) ?? key);
  return {
    currentSong,
    availableAxisTypes,
    activeAxisTypes: [...effectiveActive],
    mode: 'filtered',
    candidates: result.candidates.map((s) => toSuggestion(s.id, s.title)),
    genreGroups: [],
    listTitle: `Άλλα τραγούδια με τα ίδια: ${activeLabels.join(', ')}`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/suggestions.test.ts`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Refactor the route to call it (behavior-preserving)**

Replace the body of `src/app/api/sessions/[id]/suggestions/route.ts` from the `if (session.currentSongId === null)` block onward:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSessionById, getPlayedSongIds } from '@/db/queries/sessions';
import { listSongs, getSongWithAxisValues } from '@/db/queries/songs';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listAxisTypes, listAllAxisValues } from '@/db/queries/axisValues';
import { listGenres } from '@/db/queries/genres';
import { buildSuggestionsResponse, type AxisValue, type SongWithAxes } from '@/lib/suggestions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  const session = await getSessionById(sessionId);
  if (!session) return NextResponse.json({ error: 'Δεν βρέθηκε session' }, { status: 404 });

  const showPlayed = request.nextUrl.searchParams.get('showPlayed') === 'true';
  const hasActiveParam = request.nextUrl.searchParams.has('activeAxisTypes');
  const requestedActive = hasActiveParam
    ? new Set((request.nextUrl.searchParams.get('activeAxisTypes') ?? '').split(',').filter(Boolean))
    : null;

  if (session.currentSongId === null) {
    return NextResponse.json(
      buildSuggestionsResponse({
        currentSongWithAxes: null,
        allSongs: [],
        playedSongIds: new Set(),
        showPlayed,
        requestedActive,
        lookups: { regions: [], rhythms: [], dromoi: [], composers: [], axisTypes: [], genres: [] },
      })
    );
  }

  const [allSongs, regions, rhythms, dromoi, composers, axisTypes, genres, playedSongIdList, currentSongWithAxes, allAxisValues] =
    await Promise.all([
      listSongs(),
      listRegions(),
      listRhythms(),
      listDromoi(),
      listComposers(),
      listAxisTypes(),
      listGenres(),
      getPlayedSongIds(sessionId),
      getSongWithAxisValues(session.currentSongId),
      listAllAxisValues(),
    ]);

  if (!currentSongWithAxes) return NextResponse.json({ error: 'Το τρέχον τραγούδι δεν βρέθηκε' }, { status: 500 });

  const axisValuesBySong = new Map<number, AxisValue[]>();
  for (const av of allAxisValues) {
    const list = axisValuesBySong.get(av.songId) ?? [];
    list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
    axisValuesBySong.set(av.songId, list);
  }
  const songsWithAxes: SongWithAxes[] = allSongs.map((song) => ({
    song,
    axisValues: axisValuesBySong.get(song.id) ?? [],
  }));
  const currentAxisValues: AxisValue[] = currentSongWithAxes.axisValues.map((v) => ({
    axisType: v.axisType,
    refId: v.refId,
    yearValue: v.yearValue,
  }));

  return NextResponse.json(
    buildSuggestionsResponse({
      currentSongWithAxes: {
        id: currentSongWithAxes.id,
        title: currentSongWithAxes.title,
        lyrics: currentSongWithAxes.lyrics,
        maleKey: currentSongWithAxes.maleKey,
        femaleKey: currentSongWithAxes.femaleKey,
        axisValues: currentAxisValues,
      },
      allSongs: songsWithAxes,
      playedSongIds: new Set(playedSongIdList),
      showPlayed,
      requestedActive,
      lookups: { regions, rhythms, dromoi, composers, axisTypes, genres },
    })
  );
}
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing tests still pass; the refactor is behavior-preserving).

- [ ] **Step 7: Manual sanity check against the real dev server**

Run: `npm run dev`, log in, start or resume a session, confirm the lyrics/suggestions screen renders exactly as before (axis toggle chips, candidate list, `listTitle` text unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/lib/suggestions.ts src/lib/suggestions.test.ts src/app/api/sessions/[id]/suggestions/route.ts
git commit -m "Extract buildSuggestionsResponse as shared pure logic"
```

---

### Task 3: Add the bulk reference-data endpoint

**Files:**
- Create: `src/app/api/reference-data/route.ts`
- Create: `src/lib/referenceData.ts`

**Interfaces:**
- Produces: `ReferenceData` type (consumed by Task 6, 8, 9, 10), and `GET /api/reference-data` returning that shape as JSON.
- Consumes: `listSongs`, `listAllAxisValues`, `listAxisTypes`, `listRegions`, `listRhythms`, `listDromoi`, `listComposers`, `listGenres` — all existing, unchanged.

- [ ] **Step 1: Define the shared `ReferenceData` type**

```ts
// src/lib/referenceData.ts
import type { SongRow, SongAxisValueRow, RegionRow, RhythmRow, DromosRow, ComposerRow, AxisTypeRow, GenreRow } from '@/db/schema';

export interface ReferenceData {
  songs: SongRow[];
  axisValues: SongAxisValueRow[];
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
}
```

- [ ] **Step 2: Add the route**

```ts
// src/app/api/reference-data/route.ts
import { NextResponse } from 'next/server';
import { listSongs } from '@/db/queries/songs';
import { listAllAxisValues, listAxisTypes } from '@/db/queries/axisValues';
import { listRegions } from '@/db/queries/regions';
import { listRhythms } from '@/db/queries/rhythms';
import { listDromoi } from '@/db/queries/dromoi';
import { listComposers } from '@/db/queries/composers';
import { listGenres } from '@/db/queries/genres';
import type { ReferenceData } from '@/lib/referenceData';

export async function GET() {
  const [songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres] = await Promise.all([
    listSongs(),
    listAllAxisValues(),
    listAxisTypes(),
    listRegions(),
    listRhythms(),
    listDromoi(),
    listComposers(),
    listGenres(),
  ]);
  const payload: ReferenceData = { songs, axisValues, axisTypes, regions, rhythms, dromoi, composers, genres };
  return NextResponse.json(payload);
}
```

- [ ] **Step 3: Manual verification against the dev server**

Run: `npm run dev`, log in (so the auth cookie is set), then in the same browser session visit `http://localhost:3000/api/reference-data`.
Expected: a JSON object with `songs`, `axisValues`, `axisTypes`, `regions`, `rhythms`, `dromoi`, `composers`, `genres` arrays reflecting the current database contents.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/reference-data/route.ts src/lib/referenceData.ts
git commit -m "Add bulk reference-data endpoint for offline sync"
```

---

### Task 4: Bearer-token auth and CORS for mobile

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/app/api/login/route.ts`
- Create: `src/proxy.test.ts`

**Interfaces:**
- Produces: `proxy.ts` now accepts `Authorization: Bearer <token>` in addition to the cookie, and adds CORS headers for the Capacitor app origins. `POST /api/login` response body now includes `token: string`.
- Consumes: existing `isAuthCookieValid`, `getAuthCookieName`, `getAuthCookieValue` from `src/lib/auth.ts` (unchanged).

- [ ] **Step 1: Write the failing tests**

```ts
// src/proxy.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { getAuthCookieValue } from './lib/auth';

describe('proxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APP_PASSWORD = 'secret123';
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows an /api/* request carrying a valid bearer token', () => {
    const token = getAuthCookieValue();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = proxy(req);
    expect(res.status).not.toBe(401);
  });

  it('rejects an /api/* request with an invalid bearer token', () => {
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: 'Bearer not-the-right-token' },
    });
    const res = proxy(req);
    expect(res.status).toBe(401);
  });

  it('adds CORS headers for a known Capacitor origin', () => {
    const token = getAuthCookieValue();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}`, origin: 'capacitor://localhost' },
    });
    const res = proxy(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });

  it('does not add CORS headers for an unknown origin', () => {
    const token = getAuthCookieValue();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example.com' },
    });
    const res = proxy(req);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers an OPTIONS preflight from a Capacitor origin without requiring auth', () => {
    const req = new NextRequest('https://example.com/api/reference-data', {
      method: 'OPTIONS',
      headers: { origin: 'capacitor://localhost' },
    });
    const res = proxy(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/proxy.test.ts`
Expected: FAIL (bearer/CORS behavior doesn't exist yet).

- [ ] **Step 3: Rewrite `src/proxy.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthCookieName, isAuthCookieValid } from '@/lib/auth';

const MOBILE_ORIGINS = new Set(['capacitor://localhost', 'http://localhost', 'https://localhost']);

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !MOBILE_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

function applyCors(response: NextResponse, cors: Record<string, string>): NextResponse {
  for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
  return response;
}

function getBearerToken(request: NextRequest): string | undefined {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cors = corsHeaders(request.headers.get('origin'));

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  if (pathname === '/login' || pathname === '/api/login') {
    return applyCors(NextResponse.next(), cors);
  }

  const cookie = request.cookies.get(getAuthCookieName())?.value;
  const bearer = getBearerToken(request);
  const isAuthed = isAuthCookieValid(cookie) || isAuthCookieValid(bearer);

  if (!isAuthed) {
    if (pathname.startsWith('/api/')) {
      return applyCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), cors);
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return applyCors(NextResponse.next(), cors);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/proxy.test.ts`
Expected: PASS.

- [ ] **Step 5: Return the token from the login route**

In `src/app/api/login/route.ts`, change:

```ts
  const response = NextResponse.json({ ok: true });
```

to:

```ts
  const response = NextResponse.json({ ok: true, token: getAuthCookieValue() });
```

(`getAuthCookieValue` is already imported in this file.)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Manual regression check on web**

Run: `npm run dev`. Confirm logging in still works, the cookie is still set (check dev tools → Application → Cookies), and visiting `/admin/songs` while logged out still redirects to `/login`.

- [ ] **Step 8: Commit**

```bash
git add src/proxy.ts src/proxy.test.ts src/app/api/login/route.ts
git commit -m "Accept bearer-token auth and CORS for mobile clients"
```

---

### Task 5: Install Capacitor packages and add platform detection

**Files:**
- Modify: `package.json`
- Create: `src/lib/platform.ts`

**Interfaces:**
- Produces: `isNativePlatform(): boolean`, used by Task 9, 10, 11.

- [ ] **Step 1: Install the Capacitor packages**

```bash
npm install @capacitor/core @capacitor/preferences
npm install --save-dev @capacitor/cli @capacitor/ios @capacitor/android
```

- [ ] **Step 2: Add the platform helper**

```ts
// src/lib/platform.ts
import { Capacitor } from '@capacitor/core';

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}
```

- [ ] **Step 3: Verify the web build and tests are unaffected**

Run: `npm test && npm run build`
Expected: both pass — `@capacitor/core` used only client-side, no server code touches it.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/platform.ts
git commit -m "Install Capacitor packages and add platform detection helper"
```

---

### Task 6: Local key-value storage (auth token, session state) and reference-data cache

**Files:**
- Create: `src/lib/preferencesStore.ts`
- Create: `src/lib/authToken.ts`
- Create: `src/lib/offlineCache.ts`

**Interfaces:**
- Produces: `KeyValueStore` interface + `preferencesStore: KeyValueStore` (consumed by Task 7's `LocalSessionStore`); `saveAuthToken`, `getAuthToken`, `clearAuthToken` (consumed by Task 11); `saveReferenceData`, `loadReferenceData` (consumed by Task 10, 11).

Small values (auth token, local session state) go through `@capacitor/preferences`, a simple native key-value store. The reference-data payload (every song's lyrics — potentially large) goes through IndexedDB instead, kept in its own dumb module since it isn't unit-testable in this project's Node-only test environment (no jsdom/IndexedDB shim installed) — the logic that matters is behind the injectable `KeyValueStore` interface, which is testable, and gets tested in Task 7.

- [ ] **Step 1: `KeyValueStore` interface and Preferences-backed implementation**

```ts
// src/lib/preferencesStore.ts
import { Preferences } from '@capacitor/preferences';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T | null): Promise<void>;
}

export const preferencesStore: KeyValueStore = {
  async get<T>(key: string): Promise<T | null> {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : null;
  },
  async set<T>(key: string, value: T | null): Promise<void> {
    if (value === null) {
      await Preferences.remove({ key });
      return;
    }
    await Preferences.set({ key, value: JSON.stringify(value) });
  },
};
```

- [ ] **Step 2: Auth token storage**

```ts
// src/lib/authToken.ts
import { preferencesStore } from './preferencesStore';

const TOKEN_KEY = 'glentify:auth-token';

export async function saveAuthToken(token: string): Promise<void> {
  await preferencesStore.set(TOKEN_KEY, token);
}

export async function getAuthToken(): Promise<string | null> {
  return preferencesStore.get<string>(TOKEN_KEY);
}

export async function clearAuthToken(): Promise<void> {
  await preferencesStore.set(TOKEN_KEY, null);
}
```

- [ ] **Step 3: IndexedDB-backed reference-data cache**

```ts
// src/lib/offlineCache.ts
import type { ReferenceData } from './referenceData';

const DB_NAME = 'glentify-offline';
const DB_VERSION = 1;
const STORE_NAME = 'reference-data';
const REFERENCE_DATA_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveReferenceData(data: ReferenceData): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, REFERENCE_DATA_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadReferenceData(): Promise<ReferenceData | null> {
  const db = await openDb();
  const result = await new Promise<ReferenceData | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(REFERENCE_DATA_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
```

- [ ] **Step 4: Verify the project still typechecks and tests pass**

Run: `npm test && npx tsc --noEmit`
Expected: both pass. (`offlineCache.ts` isn't exercised by any test yet — it's verified on-device in Task 13 — but it must still typecheck.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/preferencesStore.ts src/lib/authToken.ts src/lib/offlineCache.ts
git commit -m "Add local storage layer: Preferences KV store and IndexedDB reference-data cache"
```

---

### Task 7: `SessionStore` abstraction — `RemoteSessionStore` and `LocalSessionStore`

**Files:**
- Create: `src/lib/sessionStore.ts`
- Create: `src/lib/sessionStore.test.ts`

**Interfaces:**
- Produces: `SessionStore` interface (`load`, `pickSong`, `endSequence`, `endSession`), `RemoteSessionStore`, `LocalSessionStore` (with static `start`), `hasLocalSession` — consumed by Task 9 (`LiveSessionView`), Task 10 (`/session/local`, `/session/new`), Task 11 (`hasLocalSession`).
- Consumes: `buildSuggestionsResponse`, `SuggestionsResponsePayload`, `AxisValue`, `SongWithAxes` from `src/lib/suggestions.ts` (Task 2); `ReferenceData` from `src/lib/referenceData.ts` (Task 3); `KeyValueStore` from `src/lib/preferencesStore.ts` (Task 6).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/sessionStore.test.ts
import { describe, it, expect } from 'vitest';
import { LocalSessionStore, hasLocalSession } from './sessionStore';
import type { KeyValueStore } from './preferencesStore';
import type { ReferenceData } from './referenceData';
import type { SongRow, RegionRow, GenreRow } from '@/db/schema';

function makeSong(id: number, title: string, genreId = 1): SongRow {
  return { id, title, lyrics: null, genreId, notes: null, maleKey: null, femaleKey: null, createdAt: new Date(), updatedAt: new Date() } as SongRow;
}

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

function referenceData(): ReferenceData {
  const regions: RegionRow[] = [];
  const genres: GenreRow[] = [{ id: 1, name: 'Παραδοσιακό' }];
  return {
    songs: [makeSong(1, 'Τραγούδι Α'), makeSong(2, 'Τραγούδι Β')],
    axisValues: [],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres,
  };
}

describe('LocalSessionStore', () => {
  it('starts a session with the given starting song and no played songs', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    const data = await store.load(false, null);
    expect(data.currentSong?.id).toBe(1);
    expect(data.mode).toBe('grouped');
    expect(data.genreGroups[0].songs.map((s) => s.id)).toEqual([2]);
  });

  it('marks the current song played and advances on pickSong', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.pickSong(2);
    const data = await store.load(true, null);
    expect(data.currentSong?.id).toBe(2);
    const song1 = data.genreGroups.flatMap((g) => g.songs).find((s) => s.id === 1);
    expect(song1?.played).toBe(true);
  });

  it('clears the current song on endSequence, keeping played history', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSequence();
    const data = await store.load(true, null);
    expect(data.currentSong).toBeNull();
  });

  it('clears all local state on endSession', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();
    const data = await store.load(true, null);
    expect(data.currentSong).toBeNull();
    const song1 = data.genreGroups.flatMap((g) => g.songs).find((s) => s.id === 1);
    expect(song1?.played).toBeUndefined();
  });
});

describe('hasLocalSession', () => {
  it('is false before any session has started', async () => {
    expect(await hasLocalSession(inMemoryStore())).toBe(false);
  });

  it('is true after starting a session', async () => {
    const storage = inMemoryStore();
    await LocalSessionStore.start(1, referenceData(), storage);
    expect(await hasLocalSession(storage)).toBe(true);
  });

  it('is false again after endSession', async () => {
    const storage = inMemoryStore();
    const store = await LocalSessionStore.start(1, referenceData(), storage);
    await store.endSession();
    expect(await hasLocalSession(storage)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/sessionStore.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/sessionStore.ts`**

```ts
import { buildSuggestionsResponse, type AxisValue, type SongWithAxes, type SuggestionsResponsePayload } from './suggestions';
import type { ReferenceData } from './referenceData';
import type { KeyValueStore } from './preferencesStore';

export interface SessionStore {
  load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload>;
  pickSong(songId: number): Promise<void>;
  endSequence(): Promise<void>;
  endSession(): Promise<void>;
}

export class RemoteSessionStore implements SessionStore {
  constructor(private sessionId: string) {}

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const searchParams = new URLSearchParams({ showPlayed: String(showPlayed) });
    if (activeAxisTypes !== null) searchParams.set('activeAxisTypes', activeAxisTypes.join(','));
    const res = await fetch(`/api/sessions/${this.sessionId}/suggestions?${searchParams.toString()}`);
    return res.json();
  }

  async pickSong(songId: number): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextSongId: songId }),
    });
  }

  async endSequence(): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/end-sequence`, { method: 'POST' });
  }

  async endSession(): Promise<void> {
    await fetch(`/api/sessions/${this.sessionId}/end`, { method: 'POST' });
  }
}

interface LocalSessionState {
  currentSongId: number | null;
  playedSongIds: number[];
}

const SESSION_STATE_KEY = 'glentify:local-session';

export class LocalSessionStore implements SessionStore {
  constructor(private referenceData: ReferenceData, private storage: KeyValueStore) {}

  static async start(startingSongId: number, referenceData: ReferenceData, storage: KeyValueStore): Promise<LocalSessionStore> {
    const state: LocalSessionState = { currentSongId: startingSongId, playedSongIds: [] };
    await storage.set(SESSION_STATE_KEY, state);
    return new LocalSessionStore(referenceData, storage);
  }

  private async getState(): Promise<LocalSessionState> {
    return (await this.storage.get<LocalSessionState>(SESSION_STATE_KEY)) ?? { currentSongId: null, playedSongIds: [] };
  }

  private songsWithAxes(): SongWithAxes[] {
    const axisValuesBySong = new Map<number, AxisValue[]>();
    for (const av of this.referenceData.axisValues) {
      const list = axisValuesBySong.get(av.songId) ?? [];
      list.push({ axisType: av.axisType, refId: av.refId, yearValue: av.yearValue });
      axisValuesBySong.set(av.songId, list);
    }
    return this.referenceData.songs.map((song) => ({ song, axisValues: axisValuesBySong.get(song.id) ?? [] }));
  }

  private markCurrentPlayed(state: LocalSessionState): number[] {
    if (state.currentSongId !== null && !state.playedSongIds.includes(state.currentSongId)) {
      return [...state.playedSongIds, state.currentSongId];
    }
    return state.playedSongIds;
  }

  async load(showPlayed: boolean, activeAxisTypes: string[] | null): Promise<SuggestionsResponsePayload> {
    const state = await this.getState();
    const allSongs = this.songsWithAxes();
    const currentEntry = state.currentSongId !== null ? allSongs.find((s) => s.song.id === state.currentSongId) : undefined;

    return buildSuggestionsResponse({
      currentSongWithAxes: currentEntry
        ? {
            id: currentEntry.song.id,
            title: currentEntry.song.title,
            lyrics: currentEntry.song.lyrics,
            maleKey: currentEntry.song.maleKey,
            femaleKey: currentEntry.song.femaleKey,
            axisValues: currentEntry.axisValues,
          }
        : null,
      allSongs,
      playedSongIds: new Set(state.playedSongIds),
      showPlayed,
      requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null,
      lookups: {
        regions: this.referenceData.regions,
        rhythms: this.referenceData.rhythms,
        dromoi: this.referenceData.dromoi,
        composers: this.referenceData.composers,
        axisTypes: this.referenceData.axisTypes,
        genres: this.referenceData.genres,
      },
    });
  }

  async pickSong(songId: number): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, { currentSongId: songId, playedSongIds: this.markCurrentPlayed(state) });
  }

  async endSequence(): Promise<void> {
    const state = await this.getState();
    await this.storage.set(SESSION_STATE_KEY, { currentSongId: null, playedSongIds: this.markCurrentPlayed(state) });
  }

  async endSession(): Promise<void> {
    await this.storage.set<LocalSessionState>(SESSION_STATE_KEY, null);
  }
}

export async function hasLocalSession(storage: KeyValueStore): Promise<boolean> {
  const state = await storage.get<LocalSessionState>(SESSION_STATE_KEY);
  return state?.currentSongId != null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/sessionStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sessionStore.ts src/lib/sessionStore.test.ts
git commit -m "Add SessionStore abstraction: RemoteSessionStore and LocalSessionStore"
```

---

### Task 8: Offline data source for `SongPicker`

**Files:**
- Create: `src/lib/songPickerData.ts`
- Create: `src/lib/songPickerData.test.ts`
- Modify: `src/components/SongPicker.tsx`

**Interfaces:**
- Produces: `SongPickerDataSource` interface, `remoteSongPickerDataSource`, `createLocalSongPickerDataSource(data: ReferenceData)` — consumed by Task 9 (`LiveSessionView`), Task 10.
- Consumes: `getRegionDescendantIds` from `src/lib/suggestions.ts` (existing, unchanged); `ReferenceData` from Task 3.

This runs before Task 9 because `LiveSessionView.tsx` imports `SongPickerDataSource` from the module this task creates.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/songPickerData.test.ts
import { describe, it, expect } from 'vitest';
import { getUsedTopLevelRegionsLocal, filterSongsLocal } from './songPickerData';
import type { ReferenceData } from './referenceData';
import type { SongRow, RegionRow } from '@/db/schema';

function makeSong(id: number, title: string, genreId = 1): SongRow {
  return { id, title, lyrics: null, genreId, notes: null, maleKey: null, femaleKey: null, createdAt: new Date(), updatedAt: new Date() } as SongRow;
}

// Νησιά(1) -> Νησιά Αιγαίου(2) -> Κυκλάδες(3) -> Νάξος(4)
const regions: RegionRow[] = [
  { id: 1, name: 'Νησιά', parentId: null },
  { id: 2, name: 'Νησιά Αιγαίου', parentId: 1 },
  { id: 3, name: 'Κυκλάδες', parentId: 2 },
  { id: 4, name: 'Νάξος', parentId: 3 },
];

function referenceData(): ReferenceData {
  return {
    songs: [makeSong(1, 'Τραγούδι Νάξου', 1), makeSong(2, 'Τραγούδι Άλλου Είδους', 2)],
    axisValues: [{ id: 1, songId: 1, axisType: 'region', refId: 4, yearValue: null }],
    regions,
    rhythms: [],
    dromoi: [],
    composers: [],
    axisTypes: [],
    genres: [],
  };
}

describe('getUsedTopLevelRegionsLocal', () => {
  it('returns the top-level ancestor of every region used by songs of the genre', () => {
    const result = getUsedTopLevelRegionsLocal(1, referenceData());
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  it('returns an empty list for a genre with no songs', () => {
    const result = getUsedTopLevelRegionsLocal(99, referenceData());
    expect(result).toEqual([]);
  });
});

describe('filterSongsLocal', () => {
  it('filters by genreId', () => {
    const result = filterSongsLocal(referenceData(), { genreId: 2 });
    expect(result.map((s) => s.id)).toEqual([2]);
  });

  it('filters by case-insensitive title substring', () => {
    const result = filterSongsLocal(referenceData(), { search: 'ναξου' });
    expect(result.map((s) => s.id)).toEqual([1]);
  });

  it('filters by region, including descendants', () => {
    const result = filterSongsLocal(referenceData(), { regionId: 2 });
    expect(result.map((s) => s.id)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/songPickerData.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/songPickerData.ts`**

```ts
import type { RegionRow, SongRow } from '@/db/schema';
import { getRegionDescendantIds } from './suggestions';
import type { ReferenceData } from './referenceData';

export interface SongPickerGenre {
  id: number;
  name: string;
}

export interface SongPickerRegion {
  id: number;
  name: string;
}

export interface SongPickerSong {
  id: number;
  title: string;
}

export interface SongPickerFilters {
  genreId?: number;
  regionId?: number;
  search?: string;
}

export interface SongPickerDataSource {
  listGenres(): Promise<SongPickerGenre[]>;
  listRegionsForGenre(genreId: number): Promise<SongPickerRegion[]>;
  listSongs(filters: SongPickerFilters): Promise<SongPickerSong[]>;
}

export const remoteSongPickerDataSource: SongPickerDataSource = {
  async listGenres() {
    const res = await fetch('/api/genres');
    return res.json();
  },
  async listRegionsForGenre(genreId: number) {
    const res = await fetch(`/api/genres/${genreId}/regions`);
    return res.json();
  },
  async listSongs(filters: SongPickerFilters) {
    const params = new URLSearchParams();
    if (filters.genreId) params.set('genreId', String(filters.genreId));
    if (filters.regionId) params.set('regionId', String(filters.regionId));
    if (filters.search) params.set('search', filters.search);
    const res = await fetch(`/api/songs?${params.toString()}`);
    return res.json();
  },
};

function findTopLevelRegionId(regionId: number, byId: Map<number, RegionRow>): number {
  let current = byId.get(regionId);
  while (current && current.parentId !== null) {
    current = byId.get(current.parentId);
  }
  return current ? current.id : regionId;
}

export function getUsedTopLevelRegionsLocal(genreId: number, data: ReferenceData): RegionRow[] {
  const genreSongIds = new Set(data.songs.filter((s) => s.genreId === genreId).map((s) => s.id));
  if (genreSongIds.size === 0) return [];
  const byId = new Map(data.regions.map((r) => [r.id, r]));
  const topLevelIds = new Set<number>();
  for (const av of data.axisValues) {
    if (av.axisType === 'region' && genreSongIds.has(av.songId) && av.refId !== null) {
      topLevelIds.add(findTopLevelRegionId(av.refId, byId));
    }
  }
  return data.regions.filter((r) => topLevelIds.has(r.id));
}

export function filterSongsLocal(data: ReferenceData, filters: SongPickerFilters): SongRow[] {
  let results = data.songs;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    results = results.filter((s) => s.title.toLowerCase().includes(q));
  }
  if (filters.genreId) results = results.filter((s) => s.genreId === filters.genreId);
  if (!filters.regionId) return results;

  const allowedRegionIds = new Set([filters.regionId, ...getRegionDescendantIds(filters.regionId, data.regions)]);
  const songIds = new Set(results.map((s) => s.id));
  const matchingSongIds = new Set(
    data.axisValues
      .filter((av) => av.axisType === 'region' && songIds.has(av.songId) && av.refId !== null && allowedRegionIds.has(av.refId))
      .map((av) => av.songId)
  );
  return results.filter((s) => matchingSongIds.has(s.id));
}

export function createLocalSongPickerDataSource(data: ReferenceData): SongPickerDataSource {
  return {
    async listGenres() {
      return data.genres.map((g) => ({ id: g.id, name: g.name }));
    },
    async listRegionsForGenre(genreId: number) {
      return getUsedTopLevelRegionsLocal(genreId, data).map((r) => ({ id: r.id, name: r.name }));
    },
    async listSongs(filters: SongPickerFilters) {
      return filterSongsLocal(data, filters).map((s) => ({ id: s.id, title: s.title }));
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/songPickerData.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `SongPicker.tsx` to accept an injectable data source**

In `src/components/SongPicker.tsx`, change the imports and component signature, and replace the three `fetch` call sites:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { remoteSongPickerDataSource, type SongPickerDataSource } from '@/lib/songPickerData';

interface Genre {
  id: number;
  name: string;
}

interface Region {
  id: number;
  name: string;
}

interface Song {
  id: number;
  title: string;
}

type Step = 'genre' | 'region' | 'songs';

export default function SongPicker({
  onSelect,
  dataSource = remoteSongPickerDataSource,
}: {
  onSelect: (songId: number) => void;
  dataSource?: SongPickerDataSource;
}) {
  const [step, setStep] = useState<Step>('genre');
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [regionOptions, setRegionOptions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [search, setSearch] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);

  useEffect(() => {
    dataSource.listGenres().then(setGenres);
  }, [dataSource]);

  async function loadSongs(genreId: number, regionId: number | null, q: string) {
    const results = await dataSource.listSongs({ genreId, regionId: regionId ?? undefined, search: q || undefined });
    setSongs(results);
  }

  async function handlePickGenre(genre: Genre) {
    setSelectedGenre(genre);
    setSelectedRegion(null);
    setSearch('');
    const regionsForGenre = await dataSource.listRegionsForGenre(genre.id);
    if (regionsForGenre.length > 0) {
      setRegionOptions(regionsForGenre);
      setStep('region');
    } else {
      setRegionOptions([]);
      await loadSongs(genre.id, null, '');
      setStep('songs');
    }
  }
```

The rest of the file (`handlePickRegion`, `handleSearch`, `handleBack`, and the JSX render) is unchanged — only the data-fetching lines above change.

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: both pass.

- [ ] **Step 7: Manual regression check**

Run: `npm run dev`, go to "Ξεκίνα γλέντι" and confirm genre → region → song picking still works exactly as before (default `remoteSongPickerDataSource` preserves current behavior).

- [ ] **Step 8: Commit**

```bash
git add src/lib/songPickerData.ts src/lib/songPickerData.test.ts src/components/SongPicker.tsx
git commit -m "Add injectable offline data source for SongPicker"
```

---

### Task 9: Extract `LiveSessionView` and refactor `/session/[id]`

**Files:**
- Create: `src/components/LiveSessionView.tsx`
- Modify: `src/app/session/[id]/page.tsx`

**Interfaces:**
- Produces: `<LiveSessionView store={SessionStore} onEnded={() => void} songPickerDataSource?={SongPickerDataSource} />` — consumed by Task 10 (`/session/local`).
- Consumes: `SessionStore`, `SuggestionsResponsePayload` (Task 2, 7); `SongPickerDataSource` (Task 8).

- [ ] **Step 1: Create `src/components/LiveSessionView.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import SongPicker from '@/components/SongPicker';
import type { SessionStore } from '@/lib/sessionStore';
import type { SuggestionsResponsePayload, SuggestedSong } from '@/lib/suggestions';
import type { SongPickerDataSource } from '@/lib/songPickerData';

function SongButton({ song, onPick }: { song: SuggestedSong; onPick: (songId: number) => void }) {
  return (
    <button
      onClick={() => onPick(song.id)}
      className={`btn btn-ghost h-auto w-full justify-center py-3 text-center text-base font-normal ${
        song.played ? 'text-base-content/40 italic' : ''
      }`}
    >
      {song.title}
      {song.played ? ' · ειπωμένο' : ''}
    </button>
  );
}

function KeyBadges({ maleKey, femaleKey }: { maleKey: string | null; femaleKey: string | null }) {
  if (!maleKey && !femaleKey) return null;
  return (
    <div className="flex justify-center gap-2">
      {maleKey && <span className="badge badge-outline">♂ {maleKey}</span>}
      {femaleKey && <span className="badge badge-outline">♀ {femaleKey}</span>}
    </div>
  );
}

function LyricsCard({ lyrics, maleKey, femaleKey }: { lyrics: string | null; maleKey: string | null; femaleKey: string | null }) {
  return (
    <div className="card flex flex-col gap-3 bg-base-100 p-6 shadow sm:p-8">
      <KeyBadges maleKey={maleKey} femaleKey={femaleKey} />
      {lyrics ? (
        <pre className="whitespace-pre-wrap text-center font-sans text-xl sm:text-2xl leading-relaxed text-base-content">{lyrics}</pre>
      ) : (
        <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι για αυτό το τραγούδι.</p>
      )}
    </div>
  );
}

export default function LiveSessionView({
  store,
  onEnded,
  songPickerDataSource,
}: {
  store: SessionStore;
  onEnded: () => void;
  songPickerDataSource?: SongPickerDataSource;
}) {
  const [data, setData] = useState<SuggestionsResponsePayload | null>(null);
  const [showPlayed, setShowPlayed] = useState(false);
  const [manualActiveAxisTypes, setManualActiveAxisTypes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setData(await store.load(showPlayed, manualActiveAxisTypes));
  }, [store, showPlayed, manualActiveAxisTypes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function toggleAxis(key: string) {
    const current = manualActiveAxisTypes ?? data?.activeAxisTypes ?? [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    setManualActiveAxisTypes(next);
  }

  async function handlePick(songId: number) {
    await store.pickSong(songId);
    setManualActiveAxisTypes(null);
    await load();
  }

  async function handleEndSequence() {
    await store.endSequence();
    setManualActiveAxisTypes(null);
    await load();
  }

  async function handleEndSession() {
    await store.endSession();
    onEnded();
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!data.currentSong) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <h1 className="text-2xl font-bold">Διάλεξε τραγούδι για να συνεχίσεις</h1>
        <SongPicker onSelect={handlePick} dataSource={songPickerDataSource} />
      </main>
    );
  }

  const currentSong = data.currentSong;

  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <label className="label cursor-pointer gap-2">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={showPlayed}
              onChange={(e) => setShowPlayed(e.target.checked)}
            />
            <span className="label-text">Δείξε τα ειπωμένα</span>
          </label>
          {data.availableAxisTypes.map((axis) => {
            const isActive = data.activeAxisTypes.includes(axis.key);
            return (
              <button
                key={axis.key}
                onClick={() => toggleAxis(axis.key)}
                className={`btn btn-sm rounded-full ${isActive ? 'btn-primary' : 'btn-outline'}`}
              >
                {axis.label}: {axis.value}
              </button>
            );
          })}
          <button onClick={handleEndSequence} className="btn btn-sm btn-outline">
            Τέλος σειράς
          </button>
          <button onClick={handleEndSession} className="btn btn-sm btn-error">
            Λήξη session
          </button>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{currentSong.title}</h1>
      </header>

      <div className="flex-1 p-4 sm:p-6">
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <LyricsCard lyrics={currentSong.lyrics} maleKey={currentSong.maleKey} femaleKey={currentSong.femaleKey} />
          <div className="card overflow-hidden bg-base-100 shadow">
            <h2 className="border-b border-base-300 bg-base-200 px-4 py-2 text-sm font-semibold tracking-wide text-base-content/70 uppercase">
              {data.mode === 'filtered' ? data.listTitle : 'Όλα τα τραγούδια'}
            </h2>
            <div className="flex max-h-[36rem] flex-col gap-1 overflow-y-auto p-2">
              {data.mode === 'filtered' &&
                (data.candidates.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-base-content/50">Καμία πρόταση</p>
                ) : (
                  data.candidates.map((s) => <SongButton key={s.id} song={s} onPick={handlePick} />)
                ))}
              {data.mode === 'grouped' &&
                data.genreGroups.map((group) => (
                  <div key={group.genreId} className="flex flex-col gap-1">
                    <h3 className="px-3 pt-2 text-xs font-semibold text-base-content/50 uppercase">{group.genreName}</h3>
                    {group.songs.map((s) => (
                      <SongButton key={s.id} song={s} onPick={handlePick} />
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Replace `src/app/session/[id]/page.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import LiveSessionView from '@/components/LiveSessionView';
import { RemoteSessionStore } from '@/lib/sessionStore';

export default function LiveSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const store = useMemo(() => new RemoteSessionStore(params.id), [params.id]);

  return <LiveSessionView store={store} onEnded={() => router.push('/')} />;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — `src/lib/songPickerData.ts` already exists from Task 8, so the `SongPickerDataSource` import resolves cleanly.

- [ ] **Step 4: Manual regression check**

Run: `npm run dev`. Log in, resume or start a session, confirm lyrics/suggestions/axis toggles/"Τέλος σειράς"/"Λήξη session" all behave exactly as before the refactor.

- [ ] **Step 5: Commit**

```bash
git add src/components/LiveSessionView.tsx src/app/session/[id]/page.tsx
git commit -m "Extract LiveSessionView; RemoteSessionStore now backs the web live-session route"
```

---

### Task 10: Wire `/session/local` and platform-aware `/session/new`

**Files:**
- Modify: `src/app/session/local/page.tsx` (replaces Task 1's placeholder)
- Modify: `src/app/session/new/page.tsx`

**Interfaces:**
- Consumes: `LiveSessionView` (Task 9), `LocalSessionStore` (Task 7), `preferencesStore` (Task 6), `loadReferenceData` (Task 6), `createLocalSongPickerDataSource` (Task 8), `isNativePlatform` (Task 5).

- [ ] **Step 1: Implement the real `/session/local` page**

```tsx
// src/app/session/local/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LiveSessionView from '@/components/LiveSessionView';
import { LocalSessionStore } from '@/lib/sessionStore';
import { preferencesStore } from '@/lib/preferencesStore';
import { loadReferenceData } from '@/lib/offlineCache';
import { createLocalSongPickerDataSource } from '@/lib/songPickerData';
import type { ReferenceData } from '@/lib/referenceData';

export default function LocalSessionPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    loadReferenceData()
      .then(setReferenceData)
      .finally(() => setCheckedCache(true));
  }, []);

  if (!checkedCache) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (!referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }

  const store = new LocalSessionStore(referenceData, preferencesStore);

  return (
    <LiveSessionView
      store={store}
      onEnded={() => router.push('/')}
      songPickerDataSource={createLocalSongPickerDataSource(referenceData)}
    />
  );
}
```

- [ ] **Step 2: Make `/session/new` platform-aware**

Replace `src/app/session/new/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SongPicker from '@/components/SongPicker';
import { isNativePlatform } from '@/lib/platform';
import { LocalSessionStore } from '@/lib/sessionStore';
import { preferencesStore } from '@/lib/preferencesStore';
import { loadReferenceData } from '@/lib/offlineCache';
import { createLocalSongPickerDataSource } from '@/lib/songPickerData';
import type { ReferenceData } from '@/lib/referenceData';

export default function NewSessionPage() {
  const router = useRouter();
  const [native, setNative] = useState(false);
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [checkedCache, setCheckedCache] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNative(isNativePlatform());
  }, []);

  useEffect(() => {
    if (!native) return;
    loadReferenceData()
      .then(setReferenceData)
      .finally(() => setCheckedCache(true));
  }, [native]);

  async function handleSelect(songId: number) {
    if (native) {
      if (!referenceData) return;
      await LocalSessionStore.start(songId, referenceData, preferencesStore);
      router.push('/session/local');
      return;
    }
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startingSongId: songId }),
    });
    const session = await res.json();
    router.push(`/session/${session.id}`);
  }

  if (native && !checkedCache) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  if (native && !referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Ξεκίνα γλέντι — διάλεξε πρώτο τραγούδι</h1>
      <SongPicker onSelect={handleSelect} dataSource={native && referenceData ? createLocalSongPickerDataSource(referenceData) : undefined} />
    </main>
  );
}
```

- [ ] **Step 3: Verify both builds still succeed**

Run: `npm run build:mobile && npm run build`
Expected: both succeed — the mobile export now produces a real (non-placeholder) `/session/local` page.

- [ ] **Step 4: Manual regression check on web**

Run: `npm run dev`, confirm `/session/new` still behaves exactly as before (`isNativePlatform()` returns `false` in a browser, so the `native` branch never activates on web).

- [ ] **Step 5: Commit**

```bash
git add src/app/session/local/page.tsx src/app/session/new/page.tsx
git commit -m "Wire /session/local and platform-aware /session/new for offline sessions"
```

---

### Task 11: Login token storage and home-page sync/resume for mobile

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `saveAuthToken` (Task 6), `isNativePlatform` (Task 5), `saveReferenceData`, `loadReferenceData` (Task 6), `LocalSessionStore` internals are not touched here — only reading local session existence via `preferencesStore`.

- [ ] **Step 1: Store the token on native login**

In `src/app/login/page.tsx`, update `handleSubmit`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isNativePlatform } from '@/lib/platform';
import { saveAuthToken } from '@/lib/authToken';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? 'Κάτι πήγε στραβά');
      return;
    }
    if (isNativePlatform()) {
      const body = await res.json();
      await saveAuthToken(body.token);
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div className="card w-full max-w-sm bg-base-100 shadow-xl">
        <form onSubmit={handleSubmit} className="card-body gap-3">
          <h1 className="card-title text-2xl">Glentify</h1>
          {error && (
            <div role="alert" className="alert alert-error">
              <span>{error}</span>
            </div>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Κωδικός"
            className="input input-bordered input-lg w-full"
            autoFocus
            required
          />
          <button type="submit" className="btn btn-primary btn-lg">
            Είσοδος
          </button>
        </form>
      </div>
    </main>
  );
}
```

Note: `res.json()` can only be read once, so the success path reads it a second time only when needed — this duplicates a network response read on native but not on web; acceptable since the body is tiny (`{ ok, token }`) and this keeps the web code path completely unchanged in shape.

- [ ] **Step 2: Add mobile sync/resume to the home page**

Replace `src/app/page.tsx` (this preserves every existing link/string from the current file — `/session/new`, `/programs`, `/admin/songs`, and the "Έχεις ενεργό session" banner — and adds the native-only sync button and local-session banner alongside them):

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { isNativePlatform } from '@/lib/platform';
import { getAuthToken, clearAuthToken } from '@/lib/authToken';
import { saveReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { hasLocalSession as checkHasLocalSession } from '@/lib/sessionStore';

interface Session {
  id: number;
  label: string | null;
}

export default function HomePage() {
  const [native, setNative] = useState(false);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [hasLocalSession, setHasLocalSession] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error' | 'unauthorized'>('idle');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNative(isNativePlatform());
  }, []);

  useEffect(() => {
    if (native) {
      checkHasLocalSession(preferencesStore)
        .then(setHasLocalSession)
        .finally(() => setLoaded(true));
      return;
    }
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((session) => setActiveSession(session))
      .finally(() => setLoaded(true));
  }, [native]);

  async function handleSync() {
    setSyncStatus('syncing');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/reference-data', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (res.status === 401) {
        await clearAuthToken();
        setSyncStatus('unauthorized');
        return;
      }
      if (!res.ok) throw new Error('sync failed');
      await saveReferenceData(await res.json());
      setSyncStatus('done');
    } catch {
      setSyncStatus('error');
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <h1 className="text-4xl font-bold">Glentify</h1>

      {native && loaded && (
        <div className="flex flex-col items-center gap-2">
          <button onClick={handleSync} className="btn btn-outline btn-sm" disabled={syncStatus === 'syncing'}>
            {syncStatus === 'syncing' ? 'Συγχρονισμός...' : 'Συγχρονισμός τραγουδιών'}
          </button>
          {syncStatus === 'done' && <p className="text-sm text-success">Έτοιμο για offline χρήση</p>}
          {syncStatus === 'error' && <p className="text-sm text-error">Ο συγχρονισμός απέτυχε — χρειάζεται σύνδεση</p>}
          {syncStatus === 'unauthorized' && (
            <Link href="/login" className="text-sm text-error underline">
              Η σύνδεση έληξε — ξανασυνδέσου
            </Link>
          )}
        </div>
      )}

      {native && loaded && hasLocalSession && (
        <div className="card w-full max-w-sm bg-warning/20 shadow">
          <div className="card-body items-center gap-2 text-center">
            <p>Έχεις ενεργό τοπικό γλέντι.</p>
            <Link href="/session/local" className="btn btn-primary btn-lg">
              Συνέχεια
            </Link>
          </div>
        </div>
      )}

      {!native && loaded && activeSession && (
        <div className="card w-full max-w-sm bg-warning/20 shadow">
          <div className="card-body items-center gap-2 text-center">
            <p>Έχεις ενεργό session{activeSession.label ? `: ${activeSession.label}` : ''}.</p>
            <Link href={`/session/${activeSession.id}`} className="btn btn-primary btn-lg">
              Συνέχεια
            </Link>
          </div>
        </div>
      )}

      <Link href="/session/new" className="btn btn-success btn-lg text-xl">
        Ξεκίνα γλέντι
      </Link>

      <Link href="/programs" className="btn btn-outline btn-lg">
        Σταθερά προγράμματα
      </Link>

      <Link href="/admin/songs" className="link">Διαχείριση (admin)</Link>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: both pass.

- [ ] **Step 4: Manual regression check on web**

Run: `npm run dev`, confirm the home page still shows the active-session banner and links exactly as before when accessed from a browser.

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/app/page.tsx
git commit -m "Add mobile sync and local-session resume to login/home pages"
```

---

### Task 12: Capacitor native project scaffolding

**Files:**
- Create: `capacitor.config.ts`
- Create: `ios/`, `android/` (generated by Capacitor CLI)
- Modify: `scripts/build-mobile.sh`

**Interfaces:**
- Produces: a buildable native iOS/Android project pointing at `./out` as its web assets, kept in sync via `npx cap sync` after every `npm run build:mobile`.

- [ ] **Step 1: Create `capacitor.config.ts`**

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.glentify.app',
  appName: 'Glentify',
  webDir: 'out',
};

export default config;
```

- [ ] **Step 2: Add native platforms**

```bash
npx cap add ios
npx cap add android
```

Expected: creates `ios/` and `android/` directories with native Xcode/Gradle projects.

- [ ] **Step 3: Wire `cap sync` into the build script**

Append to the end of `scripts/build-mobile.sh` (after the `cp -R .mobile-build/out out` / echo line):

```bash
npx cap sync
```

- [ ] **Step 4: Run the full mobile build and sync**

Run: `npm run build:mobile`
Expected: static export succeeds, then `npx cap sync` reports the web assets copied into `ios/App/App/public` and `android/app/src/main/assets/public` without error.

- [ ] **Step 5: Commit**

```bash
git add capacitor.config.ts ios android scripts/build-mobile.sh
git commit -m "Add Capacitor native project scaffolding for iOS and Android"
```

(`node_modules`, build artifacts, and `.mobile-build/` inside `ios/`/`android/` are handled by Capacitor's own generated `.gitignore` files in those directories — verify with `git status` before committing that nothing unexpected — e.g. Xcode `DerivedData` or Android `build/` output — is staged.)

---

### Task 13: End-to-end manual verification

> **Depends on Task 14** (added after the final whole-branch review found the mobile app has no way to reach the deployed API — every native `fetch` was an origin-relative path, which resolves to the local Capacitor bundle on a device, not the server). Step 3 below cannot pass until Task 14 lands.

**Files:** none (verification only).

- [ ] **Step 1: Full automated suite**

Run: `npm test && npx tsc --noEmit && npm run build && npm run build:mobile`
Expected: all four succeed.

- [ ] **Step 2: Web regression pass**

With `npm run dev` running: log in, browse `/admin/songs` and one other admin screen, start a new session, advance through a few songs, toggle axis filters, end the sequence, end the session. Confirm every step matches pre-change behavior.

- [ ] **Step 3: Mobile cold-start offline pass**

Open the app in Xcode Simulator or Android Studio emulator (via `npx cap open ios` / `npx cap open android`), with the simulator's network enabled: log in, tap "Συγχρονισμός τραγουδιών", confirm it reports success.

Then disable the simulator/emulator's network (Simulator: toggle Network Link Conditioner or Airplane Mode in Settings; Android emulator: toggle airplane mode), **fully quit and relaunch the app**, and confirm:
- The app opens without hanging or blank-screening.
- "Ξεκίνα νέο γλέντι" → picking a song via genre/region/search all work from cached data.
- The live-session screen shows lyrics, keys, and suggestions correctly.
- Marking several songs as played, toggling axis filters, "Τέλος σειράς", and "Λήξη session" all work with zero network.

- [ ] **Step 4: Record results**

If any step in Step 3 fails, note exactly which one and the observed behavior — this determines whether a follow-up task is needed before considering the feature done. Do not mark this task complete until the full offline pass in Step 3 succeeds.

---

### Task 14: Wire mobile API base URL for login and sync

**Added after the final whole-branch review of Tasks 1-12.** Every task up to this point built the mobile auth chain (bearer tokens, CORS, token storage) and the sync flow, but nothing ever gave the native app a way to address the deployed API — `src/app/login/page.tsx` and `src/app/page.tsx` both call `fetch('/api/...')` with an origin-relative path. On web that resolves against the page's own origin, which is correct. On a Capacitor device, the page's own origin is the local static bundle (`capacitor://localhost` / `https://localhost`), not the deployed server — so both calls silently hit nothing useful. Login and sync are both non-functional on-device without this task. This gap wasn't visible to any single task's review because no earlier task's brief mentioned an API origin at all.

The app is deployed at `https://glentify-kohl.vercel.app`. Following the pattern already established for `NEXT_PUBLIC_MOBILE_BUILD` (Task 10's fix): the base URL must be baked into the mobile build **inline in the build script's subshell**, never added to `.env.local` — `.env.local` also holds `AUTH_SECRET`/`APP_PASSWORD`/the DB connection string, and `scripts/build-mobile.sh` currently loads all of `.env.local` into the mobile build via `dotenv -e .env.local`. Adding a new `NEXT_PUBLIC_*` var to `.env.local` would be the obvious-but-wrong move — it works today only because nothing currently in the mobile bundle happens to read those other vars, but it invites a future leak. This task also uses the opportunity to check whether the mobile build needs `.env.local` loaded at all (the mobile export excludes `api/`, `admin/`, and `programs/` — the only routes that would plausibly need DB/secret env vars — so it likely doesn't).

**Files:**
- Create: `src/lib/apiClient.ts`
- Create: `src/lib/apiClient.test.ts`
- Modify: `src/app/login/page.tsx`
- Modify: `src/app/page.tsx`
- Modify: `scripts/build-mobile.sh`

**Interfaces:**
- Produces: `apiUrl(path: string): string` — prefixes a path with the deployed API base URL when running as the mobile build, returns the path unchanged otherwise. Consumed by both `login/page.tsx` and `page.tsx`.
- Consumes: nothing new; reads `process.env.NEXT_PUBLIC_API_BASE_URL` directly (same mechanism as `NEXT_PUBLIC_MOBILE_BUILD` in `src/lib/platform.ts`).

- [ ] **Step 1: Write the failing test for `apiUrl`**

```ts
// src/lib/apiClient.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { apiUrl } from './apiClient';

describe('apiUrl', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalEnv;
  });

  it('returns the path unchanged when no base URL is configured (web build)', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(apiUrl('/api/login')).toBe('/api/login');
  });

  it('prefixes the path with the base URL when one is configured (mobile build)', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://glentify-kohl.vercel.app';
    expect(apiUrl('/api/login')).toBe('https://glentify-kohl.vercel.app/api/login');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/apiClient.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/apiClient.ts`**

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/apiClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `apiUrl` into the login page**

In `src/app/login/page.tsx`, import `apiUrl` from `@/lib/apiClient` and change the fetch call from `fetch('/api/login', {...})` to `fetch(apiUrl('/api/login'), {...})`. Nothing else in this file changes — `isNativePlatform()` inside `handleSubmit` stays as-is (it's an event-handler call, not a render-time one, so it has none of the hydration-flash concerns `isNativeApp()` exists for).

- [ ] **Step 6: Wire `apiUrl` into the home page's sync**

In `src/app/page.tsx`, import `apiUrl` from `@/lib/apiClient` and change `handleSync`'s fetch call from `fetch('/api/reference-data', {...})` to `fetch(apiUrl('/api/reference-data'), {...})`. The existing bearer-token logic (`Authorization: Bearer ${token}` when a token exists) is unchanged — `apiUrl` only affects which origin the request goes to, not its headers.

- [ ] **Step 7: Bake the base URL into the mobile build**

In `scripts/build-mobile.sh`, add `NEXT_PUBLIC_API_BASE_URL=https://glentify-kohl.vercel.app` inline in the same subshell invocation that already sets `NEXT_PUBLIC_MOBILE_BUILD=1`:

```bash
(cd .mobile-build && NEXT_PUBLIC_MOBILE_BUILD=1 NEXT_PUBLIC_API_BASE_URL=https://glentify-kohl.vercel.app npx dotenv -e .env.local -- npx next build)
```

Do not add `NEXT_PUBLIC_API_BASE_URL` to `.env.local`, `.env.example`, or `next.config.ts` — inline in this subshell is the only place it should exist, matching `NEXT_PUBLIC_MOBILE_BUILD`.

- [ ] **Step 8: Investigate whether `.env.local` is still needed for the mobile build**

The mobile export deletes `src/app/api`, `src/app/admin`, and `src/app/programs` before building — those are the only parts of the app that plausibly read secrets like `AUTH_SECRET`, `APP_PASSWORD`, or a DB connection string. Grep what's left in `.mobile-build/src` after staging (or reason from `src/app`'s remaining tree) for any reference to `process.env` outside `NEXT_PUBLIC_*` vars. If nothing remaining needs `.env.local`, drop `npx dotenv -e .env.local --` from the mobile build invocation (`(cd .mobile-build && NEXT_PUBLIC_MOBILE_BUILD=1 NEXT_PUBLIC_API_BASE_URL=https://glentify-kohl.vercel.app npx next build)`). If you find a real dependency, leave it and note what it is in your report — don't guess.

- [ ] **Step 9: Run the full test suite**

Run: `npm test && npx tsc --noEmit`
Expected: both pass.

- [ ] **Step 10: Verify both builds**

Run: `npm run build` (web — confirm `NEXT_PUBLIC_API_BASE_URL` is NOT set for this build, so `apiUrl` returns paths unchanged; grep `.next` output isn't necessary, but do confirm the env var is absent from your shell/`.env.local` before running this) then `npm run build:mobile`. Both must succeed. After `build:mobile`, grep the emitted `out/` directory for the literal string `glentify-kohl.vercel.app` to confirm the base URL was actually inlined into the client bundle (e.g. `grep -r "glentify-kohl.vercel.app" out/_next/static | head -1`). Clean up `.mobile-build/` and `out/` afterward (gitignored scratch).

- [ ] **Step 11: Manual regression check on web**

Run: `npm run dev`, confirm `/login` still POSTs to the same origin and works exactly as before (no visible change — `apiUrl('/api/login')` returns `/api/login` unchanged when `NEXT_PUBLIC_API_BASE_URL` is unset).

- [ ] **Step 12: Commit**

```bash
git add src/lib/apiClient.ts src/lib/apiClient.test.ts src/app/login/page.tsx src/app/page.tsx scripts/build-mobile.sh
git commit -m "Wire mobile API base URL into login and sync"
```

- [ ] **Step 13: Update Task 13's dependency note**

Once this task is committed, Task 13 Step 3 (mobile cold-start offline pass) is unblocked — a real device build can now reach `https://glentify-kohl.vercel.app` for login and sync. No plan-doc edit required here beyond what's already written above; this step is a reminder for whoever runs Task 13 next.
