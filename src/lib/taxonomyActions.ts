// Create/delete for the taxonomy admin pages (rhythms, regions, genres, dromoi, dances, composers).
//
// Native: enqueued in the offline sync queue (the queue is drained by SyncQueueProvider).
// Web: the queue is never drained in a browser (processQueue runs only in the native app),
// so a queued write would sit as "(εκκρεμεί)" forever. Web therefore writes straight to the
// API and surfaces the server's error message on failure.

import { enqueue, processQueueSubset, type SyncHandler } from './syncQueue';
import { mintDraftId, type DraftEntity } from './draftIds';
import { nativeApiFetch } from './nativeApiFetch';
import { isNativeApp } from './platform';
import { makeTaxonomyCreateHandler, makeTaxonomyDeleteHandler } from './syncHandlers';

export type TaxonomyEntity = Extract<DraftEntity, 'regions' | 'genres' | 'rhythms' | 'dromoi' | 'dances' | 'composers'>;

const GENERIC_FAILURE = 'Αποτυχία αποθήκευσης. Δοκίμασε ξανά.';

async function failureMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : GENERIC_FAILURE;
}

export async function addTaxonomyValue(entity: TaxonomyEntity, name: string, parentId: number | null = null): Promise<void> {
  if (isNativeApp()) {
    try {
      await enqueue(`${entity}-create`, { draftId: mintDraftId(), name, parentId });
    } catch {
      throw new Error(GENERIC_FAILURE);
    }
    return;
  }
  const body = entity === 'regions' ? { name, parentId } : { name };
  const res = await nativeApiFetch(`/api/${entity}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await failureMessage(res));
}

export async function removeTaxonomyValue(entity: TaxonomyEntity, id: number): Promise<void> {
  if (isNativeApp()) {
    try {
      await enqueue(`${entity}-delete`, { id });
    } catch {
      throw new Error(GENERIC_FAILURE);
    }
    return;
  }
  const res = await nativeApiFetch(`/api/${entity}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await failureMessage(res));
}

// Web only: flush taxonomy writes queued before web wrote directly. Restricted to the
// taxonomy handlers so queued song/program/session items are left alone.
export async function drainWebTaxonomyQueue(): Promise<void> {
  if (isNativeApp()) return;
  const entities: TaxonomyEntity[] = ['regions', 'genres', 'rhythms', 'dromoi', 'dances', 'composers'];
  const handlers = new Map<string, SyncHandler>();
  for (const entity of entities) {
    handlers.set(`${entity}-create`, makeTaxonomyCreateHandler(entity));
    handlers.set(`${entity}-delete`, makeTaxonomyDeleteHandler(entity));
  }
  await processQueueSubset(handlers);
}
