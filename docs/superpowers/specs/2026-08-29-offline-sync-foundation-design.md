# Offline Sync Foundation + Offline Session Save — Design Spec

## Problem

"Complete all offline features" (George's framing: *"what is feasible with internet access should be feasible without internet and be synced as soon as internet is available"*) is the last major item on the mobile roadmap — previously "feature #1: offline creation/sync-back," repeatedly flagged as the most technically involved remaining piece and deferred every time a newer feature (program-sharing, admin-on-mobile, session-save-as-program, PDF export) needed an online-only escape hatch instead. It decomposes into six independent sub-projects (see the brainstorming conversation for the full breakdown); this spec covers the **first two**, built together because the second is the natural proving ground for the first:

1. **A generic offline write-queue** — the shared foundation every other offline-write sub-project (collaborator invites, offline CRUD for songs/programs/taxonomy) will register against. Nothing like this exists in the codebase today: every native write either never syncs at all (local session state) or requires connectivity at the moment of the write (`nativeApiFetch`, no queue).
2. **Offline session-save** — ending a live γλέντι on native currently just goes home with no save option at all (explicitly deferred when session-save-as-program shipped web-only). This becomes the queue's first real consumer.

The remaining four sub-projects (offline collaborator invites; offline CRUD for songs, programs, taxonomy) are out of scope here and get their own spec/plan cycles later, built on top of what this spec establishes.

## Goal

A native user can end a γλέντι, choose to save it as a new or existing program, and walk away — offline the entire time. The choice is queued locally; the moment the device reconnects, it's sent to the server automatically, with the exact same σειρά-preserving quality as the already-shipped web flow. The queue itself is generic enough that later sub-projects register their own action types against it without touching this code.

## Non-goals

- The other four offline sub-projects (collaborator invites, CRUD for songs/programs/taxonomy) — separate specs.
- Real conflict resolution for concurrent edits (two devices editing the same thing) — not relevant to this spec's single consumer (creating/appending is additive, not an edit-in-place), but the failure-classification design below is shaped to extend to that case later.
- A full queue-management UI (viewing/reordering/canceling individual items) — v1 is a minimal status badge only.
- Changing anything about the *web* session-save flow's behavior, except updating it to call the new generalized save endpoint (see below) instead of the session-tied one.

## Architecture

### 1. The queue engine (`src/lib/syncQueue.ts`)

**Storage:** one IndexedDB record — a single JSON array of `QueuedAction` — in a new object store (`sync-queue`) inside the existing `glentify-offline` database (same DB `offlineCache.ts` already uses, same "one record holds the whole thing" idiom as its `saveReferenceData`/`loadReferenceData`). No per-item rows, no cursors — at this app's scale (one user, occasional offline stretches, dozens of items at most) a read-modify-write of one array is simpler and sufficient.

For testability, the engine's core logic (enqueue, and the processing/reordering decisions) is written against an injectable storage interface, mirroring this codebase's existing `KeyValueStore` pattern (`src/lib/preferencesStore.ts`, already used this way by `sessionStore.test.ts`):

```ts
export interface QueueStorage {
  get(): Promise<QueuedAction[]>;
  set(actions: QueuedAction[]): Promise<void>;
}
```

The real IndexedDB-backed implementation is the default; tests substitute an in-memory array-backed fake.

**Types:**

```ts
export interface QueuedAction<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  attempts: number;
  needsAttention: boolean;
  createdAt: string; // ISO
  lastError?: string;
}

export type SyncOutcome = 'success' | 'item-error' | 'systemic-error';
export type SyncHandler = (payload: unknown) => Promise<SyncOutcome>;
```

`enqueue(type, payload)` appends a new `QueuedAction` (`attempts: 0`, `needsAttention: false`, a generated `id`) to the array and persists it.

`registerHandler(type, handler)` adds to an in-memory `Map<string, SyncHandler>` — **not persisted**; handlers re-register on every app load (see Bootstrap below). This is how later sub-projects plug in without this file ever changing: a new feature calls `registerHandler('song-create', handleSongCreateSync)` from its own module, and the generic engine never needs to know `'song-create'` exists.

**Processing loop — `processQueue()`:**

1. Read the queue array.
2. Walk it front to back. Skip (don't invoke) any item where `needsAttention === true` — it's already been flagged and isn't auto-retried.
3. For the next eligible item, look up its handler by `type` and call it with `payload`.
4. **`'success'`** → remove the item, persist, continue to the next eligible item.
5. **`'item-error'`** (the server rejected this specific request — bad/stale data, not found, no access) → increment `attempts`. If `attempts >= 3`, set `needsAttention: true` and leave it in place (it's now permanently skipped by step 2 until the user acts on it — no such action exists in v1 beyond the badge saying so; a future queue-management UI would add manual retry/discard). If `attempts < 3`, move it to the back of the array so other pending items get a turn, and continue.
6. **`'systemic-error'`** (no response at all — network failure — or a `401`, meaning the whole connection/session is the problem, not this item) → stop processing immediately. Don't touch the queue, don't increment anything — this genuinely wasn't the item's fault. Return a "blocked" result so the caller (the provider, below) can reflect that in the badge rather than silently doing nothing.

Return value: `{ processed: number; remaining: number; needsAttention: number; blocked: boolean }` — everything the UI badge needs, computed from one pass, no separate re-read required.

Handlers themselves are responsible for translating whatever `nativeApiFetch` gives them into a `SyncOutcome` — this is a deliberate boundary: the generic engine has zero HTTP/status-code knowledge, only its callers do (see the session-save handler below for the concrete mapping).

### 2. Network detection and trigger (`@capacitor/network`, new dependency)

`@capacitor/network` (version matching the existing `@capacitor/*` family) replaces relying on `navigator.onLine`, which is unreliable inside a Capacitor WebView. Two triggers call `processQueue()`:

- On app load (native only): check current status via `Network.getStatus()`; if connected, process immediately (covers "reconnected while the app was closed").
- `Network.addListener('networkStatusChange', (status) => { if (status.connected) processQueue(); })` — covers reconnecting while the app is open.

No polling, no periodic timer — both of these are asked-for, event-driven triggers only, matching George's answer.

### 3. Bootstrap and UI (`src/components/SyncQueueProvider.tsx`, mounted from the root layout)

`src/app/layout.tsx` is currently a Server Component with no native-specific behavior. It gains one child client component, `SyncQueueProvider`, wrapping `{children}` — since Next.js App Router layouts persist across client-side navigation, this is the one place a listener can live for the whole app session without being torn down every time the user changes pages (a page-level `useEffect` would not survive navigating away from that page). On web, `isNativeApp()` gates everything inside it to a no-op.

On mount (native only), the provider:
1. Calls `initSyncHandlers()` (new file, `src/lib/syncHandlers.ts`) — the single place that calls `registerHandler(...)` for every action type that exists. Today that's one line, `registerHandler('session-save', handleSessionSaveSync)`; each later sub-project adds its own line here. This file is the map of "what can be synced," always imported exactly once per app load.
2. Checks initial network status and processes if connected.
3. Subscribes to `networkStatusChange`.
4. Keeps `{ pendingCount, needsAttentionCount }` in React state, refreshed after every `processQueue()` call, exposed via a small context (`useSyncQueue()`) so pages can also call a `notifyQueueChanged()` after enqueueing something themselves, to update the badge immediately rather than waiting for the next network event.

**Badge:** rendered by the provider itself (not a specific page), so it's visible regardless of which native screen is open — a small fixed-position indicator, silent when the queue is empty, showing the pending count when non-empty, and a distinct visual state (different color/icon) when `needsAttentionCount > 0`. No tap-to-expand list in v1 — YAGNI until a second consumer makes "which item" a real question worth answering in the UI.

### 4. First consumer: offline session-save

**`LocalSessionStore` gains sequence tracking** (`src/lib/sessionStore.ts`), mirroring the `sequenceIndex` column added to the server schema for the web version of this feature:

- `LocalSessionState.playedSongIds: number[]` is replaced by `playedEntries: { songId: number; sequenceIndex: number }[]` — the one existing internal consumer of the flat list (`load()`'s `new Set(state.playedSongIds)`, used to exclude already-played songs from suggestions) becomes `new Set(state.playedEntries.map(e => e.songId))`.
- `LocalSessionState` gains `currentSequenceIndex: number`, starting at `0`.
- `markCurrentPlayed()` stamps each new entry with the state's current `currentSequenceIndex`.
- `endSequence()` increments `currentSequenceIndex` after marking the current song played — same mark-then-increment order as the server's `endSequence`.
- **`endSession()` changes behavior.** Today it immediately nulls `SESSION_STATE_KEY`, discarding everything — including, notably, never marking the *last* played song at all (a pre-existing small inconsistency with the server's `endSession`, corrected here since it directly affects what the save flow would omit). The new sequence is: mark the current song played (same as `endSequence`, but without incrementing — the session is over, mirroring the server's `endSession`), group the resulting `playedEntries` by `sequenceIndex` (reusing `groupBySequenceIndex` from `src/lib/sessionGrouping.ts` — the exact same pure helper the server-side grouping already uses, since the grouping *logic* is identical between the two stores, only the storage differs), write `{ sequences: { songIds: number[] }[] }` to a **new** preferences key, `glentify:local-session-last-ended`, then null out `SESSION_STATE_KEY` as before (so `hasLocalSession()` still correctly flips to `false` immediately — the home page's "you have an active session" banner must not linger).
- Two new exported functions operating on that new key: `getLastEndedSession(storage): Promise<{ sequences: { songIds: number[] }[] } | null>` (non-destructive read) and `clearLastEndedSession(storage): Promise<void>`. Deliberately **not** read-and-clear-in-one-call: the save page reads it to render the preview, and only clears it once the user's decision (save or skip) has actually been enqueued/applied — so an app kill mid-decision doesn't silently lose the just-played setlist.

**New native route: `src/app/session/local/save/page.tsx`** — the native twin of `src/app/session/[id]/save/page.tsx` (which `scripts/build-mobile.sh` already excludes from the native bundle, since `session/[id]` in its entirety is stripped), same UI shape (per-sequence title inputs, new-vs-existing-program toggle, save/skip), but every data source is local instead of a fetch:

- Song titles: `getLastEndedSession(preferencesStore)` for the grouped IDs, resolved against `loadReferenceData()`'s already-cached songs (same `songsById` map pattern `programs/local/program/page.tsx` already uses) — no network call.
- The "append to existing program" picker: populated directly from `loadReferenceData()`'s `programs: OfflineProgram[]` (already cached for the `programs/local/*` view/play flow — no separate fetch needed).
- Empty-session case (nothing played, or `getLastEndedSession()` returns `null`): redirect straight home, same as the web version.
- On **save**: `enqueue('session-save', { destination, title?, programId?, sequences: { title, songIds }[] })`, `clearLastEndedSession()`, `notifyQueueChanged()`, navigate home. This is the whole "offline write" — no network attempt happens here at all, ever; syncing is entirely the queue's job.
- On **skip**: `clearLastEndedSession()`, navigate home.

**`src/app/session/local/page.tsx`** changes one line: `onEnded={() => router.push('/')}` becomes `onEnded={() => router.push('/session/local/save')}` — the exact same shape of change already made to the web equivalent when session-save-as-program shipped.

### 5. The sync handler and a generalized save endpoint

The existing `POST /api/sessions/[id]/save-as-program` can't serve a queued offline payload: it's keyed by `sessionId` and deliberately re-derives the played songs from `session_played_songs` server-side rather than trusting client-submitted song IDs (a real security property, confirmed in that feature's final review — the client never supplies song IDs, so there's no path to inject another user's songs into a program). An offline-created local session has no server-side session row at all — there is no `sessionId` to re-derive from.

**New endpoint: `POST /api/programs/save-sequences`**, not tied to any session:

```ts
{ destination: 'new'; title: string; sequences: { title: string; songIds: number[] }[] }
| { destination: 'existing'; programId: number; sequences: { title: string; songIds: number[] }[] }
```

Since this endpoint *must* trust client-submitted song IDs (there's no session row to re-derive them from), it validates every one: for each `songId` across all `sequences`, confirm it via `getSongById(ownerId, songId)` (the same ownership check `/api/sessions/route.ts` and `/api/sessions/[id]/advance/route.ts` already use for a single song) — reject the whole request with `400` if any song doesn't belong to the caller. Everything else matches `save-as-program`'s existing behavior exactly: `destination: 'existing'` still gates on `getProgramAccess` → `404` on no access (never `403`); `createProgramFromGroups`/`appendSequencesToProgram` (already exist, unchanged) do the actual writing.

`POST /api/sessions/[id]/save-as-program` is **replaced** by this endpoint rather than kept alongside it — the web save page (`session/[id]/save/page.tsx`) already has the song IDs client-side after loading its `played-grouped` preview (it just wasn't sending them back before); it switches to calling `save-sequences` with the IDs it already has. This keeps exactly one save code path instead of two nearly-identical ones, and the per-song ownership check the new endpoint adds is a strict improvement over trusting a bare `sessionId`, not a weakening.

**`handleSessionSaveSync`** (`src/lib/syncHandlers.ts` or a small co-located file), the registered handler for `type: 'session-save'`:

```ts
async function handleSessionSaveSync(payload: SessionSavePayload): Promise<SyncOutcome> {
  const res = await nativeApiFetch('/api/programs/save-sequences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) return 'success';
  if (res.status === 401) return 'systemic-error'; // handled generically by nativeApiFetch already? see Error handling
  if (res.status >= 500) return 'systemic-error'; // server's fault, not this item's
  return 'item-error'; // 400/403/404 — the request itself was rejected
}
```

## Error handling

- **`nativeApiFetch`'s existing 401 behavior** (clear token, hard-redirect to `/login`) is a problem for silent background sync: firing an unannounced navigation while the user is, say, mid-scroll on an unrelated page would be jarring. `handleSessionSaveSync` (and every future sync handler) must call the API **without** triggering that redirect — either a new `nativeApiFetch` variant/option that skips the auto-redirect for background callers, or the handler catches the 401 before `nativeApiFetch`'s check fires. The queue's own `systemic-error` handling (stop processing, surface via the badge) is the correct UX for an expired session during a background sync — not an unannounced screen change. Exact mechanism (new fetch option vs. duplicate 401-check) is a plan-level decision, not a design one — the *outcome* (no surprise navigation from a background sync) is what this spec requires.
- Network failure (fetch rejects entirely, no response) → `systemic-error`, same as 401.
- `400`/`403`/`404` from `save-sequences` → `item-error` (bad payload, no access, or a since-deleted target program) — warned, requeued to the back, retried up to 3 times before `needsAttention`.
- `5xx` → `systemic-error` — treated as "not the item's fault," matching George's "general problem" framing rather than the item's.

## Testing

Following this project's established convention (Vitest coverage for pure logic, none for routes/DB-composition):

- `src/lib/syncQueue.ts`: full coverage via the injectable `QueueStorage` fake — enqueue, success-removes-item, item-error-under-3-attempts-moves-to-back, item-error-at-3-attempts-sets-needsAttention-and-stops-retrying-it, systemic-error-stops-processing-leaves-queue-untouched, needsAttention items are skipped on subsequent runs.
- `src/lib/sessionStore.ts`: extend the existing `sessionStore.test.ts` suite for `LocalSessionStore` — sequence-index stamping, `endSequence` incrementing, `endSession` correctly marking the final song and grouping by sequence (mirroring the equivalent server-side tests from the session-save-as-program feature), and `getLastEndedSession`/`clearLastEndedSession`'s non-destructive-read-then-explicit-clear contract.
- No test for `POST /api/programs/save-sequences` (no route in this codebase has coverage), `SyncQueueProvider` (page-level UI, zero coverage anywhere), or the Network-plugin wiring itself (native-only, unexercisable outside a device).
- Manual verification (named gap, same treatment as prior mobile-only work): end a γλέντι offline (airplane mode) with at least two `Τέλος σειράς` presses, confirm the save screen renders correctly from cache alone, save it, confirm the badge shows one pending item, re-enable connectivity, confirm it syncs automatically and the badge clears, then confirm the resulting program/sequences are correct via the admin UI.
