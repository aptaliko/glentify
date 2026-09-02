import type { QueuedAction } from './syncQueue';
import type { DraftEntity } from './draftIds';

export interface TaxonomyBaseValue {
  id: number;
  name: string;
  parentId?: number | null;
}

export interface DisplayTaxonomyValue {
  id: number;
  name: string;
  parentId: number | null;
  status: 'active' | 'pending-create' | 'needs-attention-create';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isTaxonomyQueueAction(action: QueuedAction, entity: DraftEntity): boolean {
  return action.type === `${entity}-create` || action.type === `${entity}-delete`;
}

// Pure — no I/O. Overlays this entity's pending create/delete actions onto the cached
// list, same rule-shape as mergeSongsWithPending.
export function mergeTaxonomyWithPending(
  base: TaxonomyBaseValue[],
  actions: QueuedAction[],
  entity: DraftEntity
): DisplayTaxonomyValue[] {
  const deletes = new Map<number, boolean>(); // id -> needsAttention
  const creates: { draftId: number; name: string; parentId: number | null; needsAttention: boolean }[] = [];

  for (const a of actions) {
    if (!isRecord(a.payload)) continue;
    if (a.type === `${entity}-delete`) {
      const { id } = a.payload;
      if (typeof id === 'number') deletes.set(id, a.needsAttention);
    } else if (a.type === `${entity}-create`) {
      const { draftId, name, parentId } = a.payload;
      if (typeof draftId === 'number' && typeof name === 'string') {
        creates.push({
          draftId,
          name,
          parentId: typeof parentId === 'number' ? parentId : null,
          needsAttention: a.needsAttention,
        });
      }
    }
  }

  const result: DisplayTaxonomyValue[] = [];
  for (const v of base) {
    const del = deletes.get(v.id);
    if (del === false) continue; // optimistically hidden
    result.push({ id: v.id, name: v.name, parentId: v.parentId ?? null, status: 'active' });
  }
  for (const c of creates) {
    if (deletes.get(c.draftId) !== undefined) continue; // created then deleted -> absent
    result.push({
      id: c.draftId,
      name: c.name,
      parentId: c.parentId,
      status: c.needsAttention ? 'needs-attention-create' : 'pending-create',
    });
  }
  return result;
}
