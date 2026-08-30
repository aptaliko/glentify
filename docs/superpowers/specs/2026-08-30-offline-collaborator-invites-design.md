# Offline Collaborator Invites — Design Spec

## Problem

Sub-project #4 of the "complete all offline features" roadmap item (see `docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md` for the full 7-sub-project decomposition). Adding/removing a program collaborator by email only exists on the native admin tool's "edit program" page (`src/app/admin/local/programs/edit/page.tsx`), which was deliberately built as a pure thin client with **no caching at all** (see `docs/superpowers/specs/2026-08-10-android-admin-tool-design.md`) — every load goes straight to the live API, and a network failure today leaves `loadProgram`/`loadCollaborators` as unhandled promise rejections, silently leaving the page blank.

To make "offline collaborator invites" real — not just a queued write with nothing to look at — this sub-project introduces the minimum caching needed to view and act on the collaborator list while offline: the creator, the current collaborators, the caller's own role, and their own identity. Program title/sequence editing on the same page stays online-only exactly as today; that remains sub-project #6's territory.

## Goal

On `admin/local/programs/edit`:
- The Συνεργάτες (collaborators) card renders from a cache when the network read fails, with a "χωρίς σύνδεση" note, instead of breaking.
- Adding a collaborator by email and removing one both queue for later sync when the live call fails due to connectivity, using the existing generic sync-queue engine (`src/lib/syncQueue.ts`) from sub-projects #1/#2 — no changes to that engine's core logic.
- Pending adds/removes are visible in the list (not hidden until the next successful fetch), and items that permanently fail are visible via the existing app-wide needsAttention badge.
- Real validation errors (typo'd email, already-a-collaborator, not-the-creator, self-add) still show immediately when online — this is a strict addition to today's behavior, not a rework of the online path.

## Non-goals

- Program title/sequence editing on this page — stays online-only, out of scope (sub-project #6).
- Any change to `src/lib/syncQueue.ts`'s core engine logic (`enqueueTo`, `processQueueWith`, failure classification, `MAX_ATTEMPTS`) — this sub-project is a pure consumer, like session-save was. The only addition is one new read-only export, `getQueuedActions()`.
- Per-item queue-management UI (view/retry/cancel a specific stuck item) — v1 boundary already accepted in sub-projects #1/#2, carried forward here.
- Distinguishing "genuinely stuck" from "merely offline" in the queue's `blocked` state — pre-existing, unrelated gap.
- Real-time collaboration (two devices editing collaborators on the same program concurrently) — the idempotent-success handling below (409/404 → success) covers the practical case of stale offline state, not general conflict resolution.
- Any change to the web collaborators UI (`src/app/programs/[id]/page.tsx` and its API routes) — already online-only by definition, untouched.

## Architecture

### 1. Collaborators cache

New module `src/lib/collaboratorsCache.ts`, extending the existing `glentify-offline` IndexedDB database (`src/lib/offlineCache.ts`) with a second object store — same database as the reference-data cache, since this is the same kind of concern (a read cache written on successful load, read as a fallback on failure), not the sync-queue's dedicated database (that one is separated for its own critical read-modify-write isolation, per sub-project #1's design).

```ts
// src/lib/collaboratorsCache.ts
export interface CachedCollaborator {
  id: number;
  email: string;
}

export interface CachedCollaboratorsData {
  role: 'creator' | 'collaborator';
  creator: CachedCollaborator | null;
  collaborators: CachedCollaborator[];
  currentUser: CachedCollaborator;
  cachedAt: string;
}

export async function saveCollaboratorsCache(programId: number, data: CachedCollaboratorsData): Promise<void>;
export async function loadCollaboratorsCache(programId: number): Promise<CachedCollaboratorsData | null>;
```

`offlineCache.ts`'s `DB_VERSION` bumps from 1 to 2; `onupgradeneeded` creates the new `program-collaborators` object store (keyed by `programId`, a number, as the `keyPath`) only when upgrading from version 1, leaving the existing `reference-data` store untouched. Existing installs upgrade in place — IndexedDB's `onupgradeneeded` fires automatically on version bump, no migration script needed since the new store starts empty.

### 2. Page changes (`admin/local/programs/edit/page.tsx`)

**`loadCollaborators`** — on success (unchanged: sets `creator`/`collaborators` state), also calls `saveCollaboratorsCache(id, { role, creator, collaborators, currentUser, cachedAt: new Date().toISOString() })` (role/currentUser come from the two other loads — see below on load ordering). On a genuine network failure (the `nativeApiFetch` call itself throws — new: wrapped in `try/catch`, since today the fetch is unguarded), fall back to `loadCollaboratorsCache(id)`: if present, populate `role`/`creator`/`collaborators`/`currentUser` from it and set a new `offlineCollaborators` boolean state to show the "χωρίς σύνδεση" note; if absent (never successfully loaded this program before), leave the card in a distinct "άγνωστο χωρίς σύνδεση" state with add/remove controls hidden (nothing to safely act on blind). A resolved-but-`!res.ok` response keeps today's exact behavior (`setCollaboratorError`).

**`loadProgram`** — wrapped in `try/catch` for the same reason: a network failure today is an unhandled rejection that silently leaves title/sequences empty with no explanation. On catch, set a new `sequencesUnavailableOffline` boolean and render a short notice ("Η επεξεργασία σειρών δεν είναι διαθέσιμη χωρίς σύνδεση") in place of the sequences section — the sequences UI itself is untouched, this only decides whether to show it or the notice.

**`currentUser` load** (`/api/account`) — wrapped in `try/catch` too. On failure, it's covered by `loadCollaboratorsCache`'s cached `currentUser` field (see above) rather than a separate cache — one cache entry serves both needs, since `currentUser` is what `loadCollaborators` needs anyway to compute the cache write.

**Load ordering** — today `loadProgram(programId)` and `loadCollaborators(programId)` run as two independent, unawaited calls in the same effect; the currentUser load is a wholly separate effect. To let `loadCollaborators` write a complete cache entry (needing `role` from `loadProgram` and `currentUser` from the account load), the effect becomes:

```ts
useEffect(() => {
  if (programId === null) return;
  (async () => {
    // Both loadProgram and loadCurrentUser catch their own network failures internally
    // (to set sequencesUnavailableOffline / leave currentUser as whatever was last known) —
    // neither ever rejects, so Promise.all (not allSettled) is correct here.
    await Promise.all([loadProgram(programId), loadCurrentUser()]);
    // loadCollaborators reads the role/currentUser state set above (or left unset, on a
    // load failure) when it builds the cache entry on its own success path.
    await loadCollaborators(programId);
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [programId]);
```

`loadProgram` and `loadCurrentUser` (the account fetch, extracted from its own effect into a named function so it can be awaited here) run concurrently via `Promise.all` — order between them doesn't matter, only that both finish before `loadCollaborators` runs, since its cache write reads `role` and `currentUser` state.

**`handleAddCollaborator`** — the existing `nativeApiFetch` POST call is wrapped in `try/catch`. On catch (network failure): `await enqueue('program-add-collaborator', { programId, email: newCollaboratorEmail })`, clear the input, call `notifyQueueChanged()`, and show a brief transient note ("Θα προστεθεί μόλις υπάρξει σύνδεση") in the same slot `collaboratorError` uses today (reusing that state, not adding a new one). A resolved response (`res.ok` or not) keeps today's exact behavior.

**`handleRemoveCollaborator`** — same pattern: `try/catch` around the existing `DELETE` call; on catch, `enqueue('program-remove-collaborator', { programId, userId })`, `notifyQueueChanged()`, and — matching today's post-success behavior for self-removal — if `userId === currentUser?.id`, clear the selected program and navigate home immediately (the removal is now queued, not confirmed, but there's nothing useful left to show the user on this page for a program they just chose to leave; the existing v1 "no per-item retry UI" boundary already accepted covers the rare case where this queued removal later fails).

**Pending overlay** — a new pure function, `mergeCollaboratorsWithPending`, in a new file `src/lib/collaboratorsMerge.ts`:

```ts
// src/lib/collaboratorsMerge.ts
import type { QueuedAction } from './syncQueue';

export interface DisplayCollaborator {
  id: number | null; // null for a pending add — no server-assigned id yet
  email: string;
  status: 'active' | 'pending-add' | 'pending-remove' | 'needs-attention-add' | 'needs-attention-remove';
}

interface AddCollaboratorPayload {
  programId: number;
  email: string;
}

interface RemoveCollaboratorPayload {
  programId: number;
  userId: number;
}

// Pure — no I/O. Takes the last-known base list (from state or cache) and the full
// queue snapshot, filters to this program's add/remove actions, and produces the
// list to render: pending removes are dropped from the base list (optimistic hide);
// pending adds are appended; anything with needsAttention:true renders with a
// distinct status instead of being silently retried forever with no visible sign.
export function mergeCollaboratorsWithPending(
  base: { id: number; email: string }[],
  allQueuedActions: QueuedAction[],
  programId: number
): DisplayCollaborator[] {
  const removals = new Map<number, boolean>(); // userId -> needsAttention
  const adds: { email: string; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (action.type === 'program-remove-collaborator') {
      const payload = action.payload as RemoveCollaboratorPayload;
      if (payload.programId === programId) removals.set(payload.userId, action.needsAttention);
    } else if (action.type === 'program-add-collaborator') {
      const payload = action.payload as AddCollaboratorPayload;
      if (payload.programId === programId) adds.push({ email: payload.email, needsAttention: action.needsAttention });
    }
  }

  const result: DisplayCollaborator[] = base
    .filter((c) => !removals.has(c.id))
    .map((c) => ({ id: c.id, email: c.email, status: 'active' as const }));

  for (const [userId, needsAttention] of removals) {
    if (needsAttention) {
      const original = base.find((c) => c.id === userId);
      if (original) result.push({ id: original.id, email: original.email, status: 'needs-attention-remove' });
    }
    // else: pending, not yet flagged — stays optimistically hidden, no row shown
  }

  for (const add of adds) {
    result.push({ id: null, email: add.email, status: add.needsAttention ? 'needs-attention-add' : 'pending-add' });
  }

  return result;
}
```

A `needsAttention` remove re-appears in the list (rather than staying hidden forever) specifically so the user can see it didn't actually go through and re-attempt manually if they want to — matching the spirit of the existing global badge without adding new per-item UI (no retry button, just visibility).

The page reads this via a new read-only export in `syncQueue.ts`:

```ts
export async function getQueuedActions(): Promise<QueuedAction[]> {
  return indexedDbQueueStorage.get();
}
```

— a direct passthrough to the existing storage, no new engine logic. The page calls `getQueuedActions()` (filtering happens in `mergeCollaboratorsWithPending`) on mount and again whenever `pendingCount` from `useSyncQueue()` changes (an effect dependency), so the overlay refreshes whenever the queue's aggregate state changes without the page needing its own polling or a duplicate notification channel.

### 3. Sync handlers (`syncHandlers.ts`)

```ts
export interface AddCollaboratorPayload {
  programId: number;
  email: string;
}

export interface RemoveCollaboratorPayload {
  programId: number;
  userId: number;
}

async function handleAddCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, email } = payload as AddCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${programId}/collaborators`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 409) return 'success'; // already a collaborator — offline actor's intent already satisfied
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRemoveCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, userId } = payload as RemoveCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${programId}/collaborators/${userId}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 404) return 'success'; // already removed, or access already gone — nothing left to do either way
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

Registered in `initSyncHandlers()` alongside the existing `session-save` registration:

```ts
registerHandler('program-add-collaborator', handleAddCollaboratorSync);
registerHandler('program-remove-collaborator', handleRemoveCollaboratorSync);
```

The remove route's `404` covers two distinct server-side causes (no program access at all, or target not currently a collaborator) that the client can't tell apart from the response — both are treated as "success" here because in either case there is nothing left for this queued action to accomplish: if access is gone, the page wouldn't be reachable to retry from anyway; if the target's already removed, the desired end state is already true.

## Error handling

| Scenario | Behavior |
|---|---|
| Network failure loading collaborators, cache present | Show cached list + "χωρίς σύνδεση — τελευταία γνωστά δεδομένα" note |
| Network failure loading collaborators, no cache | Show "άγνωστο χωρίς σύνδεση", hide add form and remove buttons |
| Network failure loading program (title/sequences) | Show "Η επεξεργασία σειρών δεν είναι διαθέσιμη χωρίς σύνδεση" in place of the sequences section; Συνεργάτες card unaffected |
| Real HTTP error response (online) adding/removing | Unchanged — today's synchronous `collaboratorError` message |
| Network failure adding/removing | Enqueue, clear input, transient "θα προστεθεί/αφαιρεθεί μόλις υπάρξει σύνδεση" note |
| Queued add/remove permanently fails (item-error × 3) | `needsAttention: true` — surfaced via the existing app-wide badge; removes additionally re-appear in the list via `mergeCollaboratorsWithPending` |
| Queued add later finds target already a collaborator (409) | Treated as success, silently dropped from the queue |
| Queued remove later finds target already gone (404) | Treated as success, silently dropped from the queue |

## Testing

Following this project's established convention (pure logic in `src/lib/*` gets Vitest coverage; I/O-bound code doesn't):

- **`src/lib/collaboratorsMerge.ts`** (`mergeCollaboratorsWithPending`) — full unit coverage: base list alone; pending add appended; pending remove hidden; needsAttention add and needsAttention remove both rendered distinctly; multiple pending actions for the same program; actions belonging to a different `programId` correctly excluded.
- **No test** for `collaboratorsCache.ts` (IndexedDB read/write — matches `offlineCache.ts`, which has none), the two new sync handlers (matches `handleSessionSaveSync`, which has none), or the page itself (matches every other page in this codebase).
- Manual on-device verification (named gap, same treatment as every other mobile-only feature this session): open the edit page for a known program while online (populates the cache), enable airplane mode, reload the page and confirm the cached collaborator list renders with the offline note; add a collaborator by email while offline, confirm it appears tagged pending and is queued; disable airplane mode, confirm it syncs and the pending tag clears; repeat for remove; confirm a genuinely bad queued add (nonexistent email) eventually surfaces via the needsAttention badge.
