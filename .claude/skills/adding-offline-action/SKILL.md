---
name: adding-offline-action
description: Use when adding a new offline-writable action to Glentify's native sync
  queue — any create/update/delete/reorder a user can perform on-device without
  connectivity that must reconcile on reconnect. Covers syncHandlers.ts registration,
  the *Merge.ts optimistic view, draft-id resolution, SyncOutcome status mapping, and
  the manual-testing-checklist row. Symptoms: "offline", "sync queue", "registerHandler",
  "needsAttention", "draft id", "enqueue", "mergeXWithPending".
---

# Adding an Offline Action (Glentify native sync)

## Overview

A new offline action must work on-device with no connectivity and reconcile once the
device reconnects. It touches **several files that a passing `vitest` run will not
connect for you** — miss one and the app compiles clean, tests pass, and it breaks on
the physical device. This skill is the checklist that keeps the pieces in sync.

Background (read if the mechanics are unfamiliar): the offline-sync section of `CLAUDE.md`
and `docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md`.

## When to use

- Adding any user write that must survive being performed offline (a new taxonomy list,
  a new program/sequence operation, a new bulk action).
- **Not** for a read-only feature (those go through the `*ListCache.ts`/`*DetailCache.ts`
  read-through caches, no queue action).
- **Not** for a web-only feature — the queue is a no-op on web (`isNativeApp()` is false).

## The five pieces (create a todo per item)

1. **Register the handler** — add `registerHandler('<type>', handleXSync)` inside
   `initSyncHandlers()` in `src/lib/syncHandlers.ts`. This is the single registration
   site; nowhere else calls `registerHandler`. The handler calls `nativeApiFetch(...)`
   **always with `{ redirectOn401: false }`** (a sync pass must never trigger a page
   redirect) and returns a `SyncOutcome`.

2. **Map every response to a `SyncOutcome`** — this is the judgment part, see the table
   below. Getting a code wrong is the most common defect: e.g. treating a real conflict
   as `item-error` (silently retries then hides) instead of `conflict`.

3. **Resolve draft ids** — if the payload references an entity that could have been
   created offline in the same session (a parent id, a program id, a sequence id, a
   song id), resolve it through `loadDraftMap()` + `resolveOne`/`resolveMany` BEFORE the
   fetch. An unresolved reference returns `'item-error'` so the dependent action waits
   its turn behind the create ahead of it. If your action itself creates an entity, call
   `recordResolution(entity, draftId, created.id)` on success.

4. **Write the optimistic merge** — add (or extend) a pure `mergeXWithPending(base,
   actions)` in a `src/lib/xMerge.ts` file: takes the cached base list + the full queue
   snapshot, returns what to render. No network/IO — that's what makes it unit-testable.
   Follow the status shape of `mergeTaxonomyWithPending`: pending create shows with its
   draft id, pending delete optimistically disappears, a `needsAttention` item reverts to
   its last-known real state instead of hiding the failure.

5. **Unit-test the merge + add a manual-checklist row** — vitest covers the pure merge
   only (see template below). Then add a row to `docs/manual-testing-checklist.md` for the
   on-device behavior, because nothing that touches IndexedDB, Capacitor, or a real API
   route has automated coverage here — by convention, not oversight.

## SyncOutcome mapping (the judgment table)

`type SyncOutcome = 'success' | 'item-error' | 'systemic-error' | 'conflict'`

| Server response | Outcome | Why |
|---|---|---|
| `2xx` ok | `success` | Removed from queue. Record ids/versions from the body first. |
| `404` when the desired end state is *already true* (delete of a gone thing; add/remove-collaborator when access is gone) | `success` | Nothing left to accomplish. This is the established 404-as-success precedent. |
| `409`/`404` on a **guarded** write (If-Match) | `conflict` | Flags `needsAttention` with reason `'conflict'`, distinct from a capped failure. |
| `409` permanent (referenced/still-in-use, e.g. song already played) | `item-error` | Retries to cap (3), then `needsAttention` reason `'failed'`. |
| `401` or `>= 500` | `systemic-error` | **Not this item's fault.** Stops the whole pass immediately, queue untouched, no attempt consumed. |
| Bad data / genuinely not found | `item-error` | Requeues to the back up to 3 attempts, then `needsAttention`. |
| Unresolved draft id / missing local bytes | `item-error` | Waits for the create ahead of it in the queue. |

**Never** return `item-error` for a network/`401` failure — that burns a retry attempt on
something the item didn't cause. That's what `systemic-error` is for.

## Merge test template

```ts
import { describe, it, expect } from 'vitest';
import { mergeXWithPending, type XBaseValue } from './xMerge';
import type { QueuedAction } from './syncQueue';

function action(overrides: Partial<QueuedAction>): QueuedAction {
  return { id: 'x', type: 'x-create', payload: {}, attempts: 0,
           needsAttention: false, createdAt: '2026-01-01T00:00:00.000Z', ...overrides };
}
const base: XBaseValue[] = [{ id: 1, name: 'Existing' }];

describe('mergeXWithPending', () => {
  it('appends a pending create with its draft id', () => {
    const out = mergeXWithPending(base, [action({ type: 'x-create', payload: { draftId: -5, name: 'New' } })]);
    expect(out.at(-1)).toMatchObject({ id: -5, status: 'pending-create' });
  });
  it('optimistically hides a pending delete', () => {
    const out = mergeXWithPending(base, [action({ type: 'x-delete', payload: { id: 1 } })]);
    expect(out.map(v => v.id)).toEqual([]);
  });
  it('keeps a needs-attention delete visible as active', () => {
    const out = mergeXWithPending(base, [action({ type: 'x-delete', payload: { id: 1 }, needsAttention: true })]);
    expect(out.find(v => v.id === 1)?.status).toBe('active');
  });
  it('nets a created-then-deleted draft to absent', () => {
    const out = mergeXWithPending(base, [
      action({ id: 'a', type: 'x-create', payload: { draftId: -5, name: 'New' } }),
      action({ id: 'b', type: 'x-delete', payload: { id: -5 } }),
    ]);
    expect(out.map(v => v.id)).toEqual([1]);
  });
});
```

## Common mistakes

- **Forgetting the manual-checklist row.** vitest is green and you think you're done — but
  the IndexedDB/Capacitor/route path has zero automated coverage. Undocumented = untested.
- **`item-error` for a `401`/`5xx`.** Use `systemic-error` so the pass stops without
  consuming a retry.
- **Skipping draft-id resolution** for a referenced id that could be draft-created in the
  same session. Symptom: works when online, `item-error`-loops when the referenced entity
  was made offline.
- **IO inside the merge function.** Keep `xMerge.ts` pure; it's shared between the page
  effect and the drain-detection count, and its purity is the whole reason it's testable.
- **Recording ids/versions after returning.** Read `res.json()` and call
  `recordResolution` / `recordSyncedVersion` **before** `return 'success'`.

## Reference: existing handlers to copy from

- Simple create/delete with draft ids: `makeTaxonomyCreateHandler` / `makeTaxonomyDeleteHandler`.
- Guarded (If-Match, versioned) write: `handleSequenceRenameSync` + `guardedHeaders`.
- Multi-id resolution: `handleSequenceReorderSync` (`resolveMany`).
- Content-preserving 404 fallback: `handleSessionSaveSync`.
