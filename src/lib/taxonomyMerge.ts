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

// The axis each taxonomy entity is referenced through in song axis values, and the message the
// server gives when a value is still used (src/db/queries/*.ts). Native checks this locally before
// queueing a delete, since the queued delete is hidden at once and its 409 would otherwise be silent.
const USAGE_AXIS: Partial<Record<DraftEntity, string>> = {
  regions: 'region',
  genres: 'genre',
  rhythms: 'rhythm',
  dromoi: 'dromos',
  dances: 'dance',
  composers: 'composer',
};

const IN_USE_MESSAGE: Partial<Record<DraftEntity, string>> = {
  regions: 'Η περιοχή χρησιμοποιείται από τραγούδι',
  genres: 'Το είδος χρησιμοποιείται από τραγούδι',
  rhythms: 'Ο ρυθμός χρησιμοποιείται από τραγούδι',
  dromoi: 'Ο δρόμος χρησιμοποιείται από τραγούδι',
  dances: 'Ο χορός χρησιμοποιείται από τραγούδι',
  composers: 'Ο συνθέτης χρησιμοποιείται από τραγούδι',
};

export interface UsageAxisValue {
  axisType: string;
  refId: number | null;
}

// Pure. Returns the in-use message when a song still references this taxonomy value, else null.
export function taxonomyInUseMessage(entity: DraftEntity, id: number, axisValues: UsageAxisValue[]): string | null {
  const axis = USAGE_AXIS[entity];
  const message = IN_USE_MESSAGE[entity];
  if (!axis || !message) return null;
  return axisValues.some((v) => v.axisType === axis && v.refId === id) ? message : null;
}
