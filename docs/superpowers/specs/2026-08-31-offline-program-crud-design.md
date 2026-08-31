# Offline Program CRUD — Design Spec

## Problem

Sub-project #6 of the "complete all offline features" roadmap (see `docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md` for the full 7-sub-project decomposition) was originally framed as "offline CRUD — programs/sequences." Tracing the actual codebase surfaced two independent pieces of meaningfully different size and shape:

1. **Program-level CRUD** — create/rename/delete a whole Σταθερό Πρόγραμμα (by title only), on the native admin tool's programs list page (`src/app/admin/programs/page.tsx`). No temp-ID problem: a freshly-created program has nothing else referencing it yet.
2. **Sequence/song CRUD** — create/rename/delete sequences and add/remove/reorder songs within them, on the edit page (`src/app/admin/local/programs/edit/page.tsx`, already touched by sub-project #4 for its Συνεργάτες card). This has a real architectural fork around creating brand-new sequences offline (no server ID exists until sync) and needs a much richer nested cache (program → sequences → songs).

Per George's explicit decision, these are split into two independent cycles. **This spec covers only piece #1 (program-level CRUD).** Piece #2 (sequence/song CRUD) gets its own spec and plan afterward.

Today, `src/app/admin/programs/page.tsx` is a pure thin client with zero caching — a network failure leaves `load()`'s fetch silently unresolved and the page blank, and create/rename/delete all require connectivity at the moment of the call.

## Goal

On `admin/programs`:
- The programs list renders from a cache when the live fetch fails, with a "χωρίς σύνδεση" note.
- Create, rename, and delete all queue immediately (online or offline, per the decision below) via the existing generic sync-queue engine (`src/lib/syncQueue.ts`, built in sub-project #1/#2) — no changes to that engine's core logic.
- The list optimistically reflects pending creates (as non-navigable rows), pending renames (new title shown immediately), and pending deletes (hidden), with anything that permanently fails visible via the existing app-wide needsAttention badge.

## Non-goals

- Sequence/song CRUD on the edit page — a separate spec (sub-project #6b).
- Any change to `src/lib/syncQueue.ts`'s core engine logic — this is a pure consumer, like sub-projects #2 and #4 before it. The only addition, if needed, would be read-only helpers already established (`getQueuedActions()` already exists from #4 — no new engine export needed here).
- Navigating into a freshly offline-created (not-yet-synced) program's edit page — deliberately disallowed, since it has no real ID yet and nothing in this sub-project supports temp-ID reconciliation. Once it syncs, it becomes a normal navigable row.
- Real conflict resolution (two devices renaming/deleting the same program concurrently) — the idempotent-delete handling below covers the practical "already gone" case, not general conflict resolution.
- Live-attempt-first branching (trying the network call before falling back to the queue) — deliberately not used here, unlike sub-project #4's collaborator invites. See Architecture.

## Architecture

### 1. Why "always enqueue" here, unlike #4

Sub-project #4 (collaborator invites) tried the live call first and only queued on a genuine connectivity failure, specifically to preserve today's meaningful synchronous validation errors (email not found, already a collaborator, not the creator). Program create/rename/delete has no comparable server-side validation surface: `POST /api/programs` and `PATCH /api/programs/[id]` only enforce `title.min(1)` (already enforced client-side via the input's `required` attribute), and `DELETE` only enforces creator-only access (already gated by only rendering the delete button when `role === 'creator'`). With nothing meaningful left to show synchronously, this sub-project uses the simpler pattern already established by session-save: `enqueue(...)` unconditionally, online or offline, then optimistically update the UI and move on.

### 2. Programs list cache

New module `src/lib/programsListCache.ts`, following #4's `collaboratorsCache.ts` pattern exactly: a dedicated IndexedDB database (`glentify-programs-list-cache`, its own DB — not shared with `offlineCache.ts`, `glentify-sync-queue`, or #4's `glentify-collaborators-cache`, for the same version-upgrade-isolation reason established in #4's Global Constraints), storing the single last-successfully-loaded list.

```ts
export interface CachedProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

export async function saveProgramsListCache(programs: CachedProgram[]): Promise<void>;
export async function loadProgramsListCache(): Promise<CachedProgram[] | null>;
```

Unlike #4's cache (keyed per-program, since collaborators are scoped to one program's edit page), this is a single cached blob (the whole list), matching `offlineCache.ts`'s single-key pattern — there is exactly one list per user, not one per program.

`load()` in `page.tsx` tries the live `GET /api/programs` first (guarded by try/catch, unlike today's unguarded fetch). On success, write through to the cache and clear any "offline" flag. On a network failure, fall back to `loadProgramsListCache()`; if present, show it with an offline note; if absent, show an "άγνωστο χωρίς σύνδεση" state with create/rename/delete controls hidden (nothing safe to act on blind — same pattern as #4's `collaboratorsUnavailable` state).

### 3. Pending-overlay merge function

New module `src/lib/programsMerge.ts`, mirroring #4's `collaboratorsMerge.ts` structure:

```ts
export interface CreateProgramPayload {
  title: string;
}

export interface RenameProgramPayload {
  programId: number;
  title: string;
}

export interface DeleteProgramPayload {
  programId: number;
}

export interface DisplayProgram {
  id: number | null; // null for a pending create — no server-assigned id yet
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
  status: 'active' | 'pending-create' | 'renamed' | 'needs-attention-create' | 'needs-attention-rename' | 'needs-attention-delete';
}

// Pure — no I/O. Takes the last-known base list (from state or cache) and the full
// sync-queue snapshot, filters to this feature's three action types, and produces the
// list to render:
// - a pending delete hides its row (optimistic hide), UNLESS it needsAttention, in which
//   case the row reappears as a normal active row (a failed delete means the program is
//   still there — hiding it forever would misrepresent server state, the same lesson
//   sub-project #4's final review taught for a failed collaborator removal)
// - a pending rename overlays its new title onto the existing row immediately (status
//   'renamed') — there's no ambiguity to hide behind, unlike a collaborator add that might
//   not resolve to a real user; a needsAttention rename reverts to the last-known real
//   title with a distinct failed-tag instead of silently keeping the unconfirmed title
// - a pending create appends a new row with id: null, not clickable in the UI layer
//   (this function only marks status; the page enforces non-navigability). Its role is
//   always 'creator' (you created it) and sharedWithEmails is always [] (brand new, no
//   collaborators yet) — both hardcoded by this function, not read from the payload,
//   since CreateProgramPayload carries only a title.
export function mergeProgramsWithPending(
  base: CachedProgram[],
  allQueuedActions: QueuedAction[]
): DisplayProgram[];
```

### 4. Sync handlers

Three new handlers registered in `src/lib/syncHandlers.ts` alongside the existing four (session-save, add/remove-collaborator):

```ts
async function handleCreateProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { title } = payload as CreateProgramPayload;
  const res = await nativeApiFetch(
    '/api/programs',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRenameProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, title } = payload as RenameProgramPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleDeleteProgramSync(payload: unknown): Promise<SyncOutcome> {
  const { programId } = payload as DeleteProgramPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already gone (someone else deleted it, or access is already gone) — the desired end
  // state is already true, matching #4's remove-collaborator 404-as-success precedent.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}
```

`encodeURIComponent` is applied proactively here (a lesson from #4's final review, applied from the start rather than as a follow-up fix).

### 5. Page changes (`admin/programs/page.tsx`)

- `load()` wrapped in try/catch, falling back to the cache on failure (see §2).
- `handleCreate`: `await enqueue('program-create', { title })`, clear the input, `notifyQueueChanged()`, no live attempt.
- `handleRename`: `await enqueue('program-rename', { programId: id, title: editingTitle })`, clear editing state, `notifyQueueChanged()`.
- `handleDelete`: `await enqueue('program-delete', { programId: id })`, `notifyQueueChanged()`.
- Each `enqueue(...)` call wrapped in its own try/catch (a lesson from #4's final review, applied from the start): on failure, show an error rather than silently losing the action.
- A pending-actions effect (mirroring #4's, reading `getQueuedActions()` keyed on `pendingCount` from `useSyncQueue()`) feeds `mergeProgramsWithPending`, refreshing the base list from the server when this feature's queued actions transition from present to none for this list (the same "refresh on drain" lesson #4's final review taught, applied from the start rather than as a follow-up fix).
- The rendered list uses `mergeProgramsWithPending(cachedOrLiveList, pendingActions)`; a `status === 'pending-create'` row renders disabled (no `onClick`/no `<Link>`) with a "θα είναι διαθέσιμο μόλις συγχρονιστεί" note instead of a clickable title.

## Error handling

See the table already presented and approved in chat:

| Scenario | Behavior |
|---|---|
| Network failure loading the list, cache present | Show cached list + "χωρίς σύνδεση — τελευταία γνωστά δεδομένα" note |
| Network failure loading the list, no cache | Show "άγνωστο χωρίς σύνδεση", hide create/rename/delete controls |
| Create/rename/delete while offline or online | Always enqueues immediately, no synchronous error path — the list optimistically updates and the user moves on |
| Queued create permanently fails (item-error × 3) | `needsAttention` — the pending row stays visible tagged as failed rather than silently vanishing |
| Queued rename permanently fails | `needsAttention` — the row reverts to its last-known real title with a failed-rename tag |
| Queued delete later finds the program already gone (404) | Treated as success, silently dropped |
| Queued delete permanently fails for another reason | `needsAttention` — the row reappears as a normal active row (per the lesson above, don't leave an optimistically-hidden row hidden forever if the removal never actually happened) |

## Testing

Following this project's established convention:

- `src/lib/programsMerge.ts`'s `mergeProgramsWithPending` is the one pure module and gets full Vitest coverage: no actions (base unchanged); pending create appended, non-navigable; pending rename overlays the new title; pending delete hides the row; needs-attention variants for all three (including the create/delete-revert cases above); queued actions of unrelated types (e.g. `session-save`, `program-add-collaborator`) correctly ignored.
- No test for `programsListCache.ts` (IndexedDB), the three sync handlers (fetch-calling I/O), or the page — matches `offlineCache.ts`, `collaboratorsCache.ts`, `handleSessionSaveSync`, and every page in this codebase.
- Manual on-device verification (named, non-blocking gap, same treatment as every other mobile-only feature this session): create a program offline, confirm it shows pending and non-clickable; go online, confirm it becomes a normal navigable row; rename and delete an existing program offline, confirm both queue and later apply correctly (confirm the renamed program shows its real new title post-sync, and the deleted one stays gone); confirm a deliberately-conflicting case (delete a program that someone else already deleted) resolves via the idempotent-success path without getting stuck in needsAttention.
