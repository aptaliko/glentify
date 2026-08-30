// src/lib/collaboratorsMerge.ts
import type { QueuedAction } from './syncQueue';

export interface AddCollaboratorPayload {
  programId: number;
  email: string;
}

export interface RemoveCollaboratorPayload {
  programId: number;
  userId: number;
}

export interface DisplayCollaborator {
  id: number | null; // null for a pending add — no server-assigned id yet
  email: string;
  status: 'active' | 'pending-add' | 'needs-attention-add' | 'needs-attention-remove';
}

// Shared predicate so the merge loop below and any external consumer that needs to know
// "does this queued action belong to this program's collaborator list" (e.g. the edit
// page's pending-actions effect, which needs to detect when this program's own pending
// add/remove actions have all cleared) filter identically and can't silently drift apart.
// Also doubles as the runtime guard for the payload casts below: a malformed payload
// (e.g. null, restored from IndexedDB) is skipped rather than thrown on, since this
// function runs during render.
export function isCollaboratorQueueActionForProgram(action: QueuedAction, programId: number): boolean {
  if (action.type !== 'program-add-collaborator' && action.type !== 'program-remove-collaborator') return false;
  if (typeof action.payload !== 'object' || action.payload === null) return false;
  return (action.payload as { programId?: unknown }).programId === programId;
}

// Pure — no I/O. Takes the last-known base list (from state or cache) and the full
// sync-queue snapshot, filters to this program's add/remove actions, and produces the
// list to render: pending removes are dropped from the base list (optimistic hide, no
// row shown at all while merely pending); pending adds are appended; anything with
// needsAttention:true renders with a distinct status instead of being silently retried
// forever with no visible sign — a failed remove specifically re-appears (using its
// original base entry) so the user can see it didn't actually go through.
export function mergeCollaboratorsWithPending(
  base: { id: number; email: string }[],
  allQueuedActions: QueuedAction[],
  programId: number
): DisplayCollaborator[] {
  const removals = new Map<number, boolean>(); // userId -> needsAttention
  const adds: { email: string; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (!isCollaboratorQueueActionForProgram(action, programId)) continue;
    if (action.type === 'program-remove-collaborator') {
      const payload = action.payload as RemoveCollaboratorPayload;
      removals.set(payload.userId, action.needsAttention);
    } else {
      const payload = action.payload as AddCollaboratorPayload;
      adds.push({ email: payload.email, needsAttention: action.needsAttention });
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
