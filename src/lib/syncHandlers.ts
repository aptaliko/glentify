// src/lib/syncHandlers.ts
import { nativeApiFetch } from './nativeApiFetch';
import { registerHandler } from './syncQueue';
import type { SyncOutcome } from './syncQueue';
import type { AddCollaboratorPayload, RemoveCollaboratorPayload } from './collaboratorsMerge';

export type SessionSavePayload =
  | { destination: 'new'; title: string; sequences: { title: string; songIds: number[] }[] }
  | { destination: 'existing'; programId: number; sequences: { title: string; songIds: number[] }[] };

async function handleSessionSaveSync(payload: unknown): Promise<SyncOutcome> {
  const res = await nativeApiFetch(
    '/api/programs/save-sequences',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleAddCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, email } = payload as AddCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}/collaborators`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // Already a collaborator by the time this synced (added by someone else, or by the
  // same offline actor twice) — the intent was already satisfied, nothing to retry.
  if (res.status === 409) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

async function handleRemoveCollaboratorSync(payload: unknown): Promise<SyncOutcome> {
  const { programId, userId } = payload as RemoveCollaboratorPayload;
  const res = await nativeApiFetch(
    `/api/programs/${encodeURIComponent(programId)}/collaborators/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
    undefined,
    { redirectOn401: false }
  );
  if (res.ok) return 'success';
  // 404 covers two server-side causes (no program access at all, or the target isn't
  // currently a collaborator) that the client can't tell apart from the response —
  // both mean there's nothing left for this queued removal to accomplish.
  if (res.status === 404) return 'success';
  if (res.status === 401 || res.status >= 500) return 'systemic-error';
  return 'item-error';
}

// The single place every sync-queue action type gets registered. Called once per app
// load by SyncQueueProvider; the `initialized` guard makes a second call (e.g. from a
// React effect re-running) a harmless no-op instead of double-registering.
let initialized = false;

export function initSyncHandlers(): void {
  if (initialized) return;
  initialized = true;
  registerHandler('session-save', handleSessionSaveSync);
  registerHandler('program-add-collaborator', handleAddCollaboratorSync);
  registerHandler('program-remove-collaborator', handleRemoveCollaboratorSync);
}
