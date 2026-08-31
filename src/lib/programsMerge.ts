// src/lib/programsMerge.ts
import type { QueuedAction } from './syncQueue';

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
  status: 'active' | 'pending-create' | 'renamed' | 'needs-attention-create' | 'needs-attention-rename';
}

const PROGRAM_ACTION_TYPES = new Set(['program-create', 'program-rename', 'program-delete']);

// Reused by the page's pending-actions effect to count how many of this feature's own
// actions are currently queued, so it can detect the >0 -> 0 transition (this list's
// queue just drained) and refresh the base list from the server — the same predicate
// this function uses internally, so the two never disagree about what counts.
export function isProgramQueueAction(action: QueuedAction): boolean {
  return PROGRAM_ACTION_TYPES.has(action.type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Pure — no I/O. Takes the last-known base list (from state or cache) and the full
// sync-queue snapshot, filters to this feature's three action types, and produces the
// list to render:
// - a pending delete hides its row (optimistic hide); a needsAttention delete instead
//   reappears as a normal active row, since a failed delete means the program is still
//   really there — hiding it forever would misrepresent server state
// - a pending rename overlays its new title onto the existing row (status 'renamed'); a
//   needsAttention rename reverts to the last-known real title with a distinct status
//   instead of silently keeping an unconfirmed title forever
// - a pending create appends a row with id: null and role/sharedWithEmails hardcoded
//   ('creator' / [] — true for anything you just created, since CreateProgramPayload
//   carries only a title), not clickable in the UI layer (this function only marks
//   status; the page enforces non-navigability)
// A malformed payload (wrong shape, restored from IndexedDB) is skipped rather than
// thrown on, since this function runs on the render path.
export function mergeProgramsWithPending(
  base: { id: number; title: string; role: 'creator' | 'collaborator'; sharedWithEmails: string[] }[],
  allQueuedActions: QueuedAction[]
): DisplayProgram[] {
  const renames = new Map<number, { title: string; needsAttention: boolean }>();
  const deletes = new Map<number, boolean>(); // programId -> needsAttention
  const creates: { title: string; needsAttention: boolean }[] = [];

  for (const action of allQueuedActions) {
    if (!isRecord(action.payload)) continue;
    const payload = action.payload;
    if (action.type === 'program-rename') {
      const { programId, title } = payload;
      if (typeof programId === 'number' && typeof title === 'string') {
        renames.set(programId, { title, needsAttention: action.needsAttention });
      }
    } else if (action.type === 'program-delete') {
      const { programId } = payload;
      if (typeof programId === 'number') {
        deletes.set(programId, action.needsAttention);
      }
    } else if (action.type === 'program-create') {
      const { title } = payload;
      if (typeof title === 'string') {
        creates.push({ title, needsAttention: action.needsAttention });
      }
    }
  }

  const result: DisplayProgram[] = [];

  for (const program of base) {
    const del = deletes.get(program.id);
    if (del === false) continue; // pending, not yet flagged — optimistically hidden
    if (del === true) {
      result.push({ ...program, status: 'active' });
      continue;
    }
    const rename = renames.get(program.id);
    if (rename) {
      result.push({
        ...program,
        title: rename.needsAttention ? program.title : rename.title,
        status: rename.needsAttention ? 'needs-attention-rename' : 'renamed',
      });
      continue;
    }
    result.push({ ...program, status: 'active' });
  }

  for (const create of creates) {
    result.push({
      id: null,
      title: create.title,
      role: 'creator',
      sharedWithEmails: [],
      status: create.needsAttention ? 'needs-attention-create' : 'pending-create',
    });
  }

  return result;
}
