
export type DraftEntity =
  | 'regions' | 'genres' | 'rhythms' | 'dromoi' | 'composers'
  | 'song' | 'sequence' | 'sequence-song';

export type DraftMap = Record<string, number>;

let counter = 0;

// Device-unique, monotonic, always negative. Date.now() guards across app restarts;
// the per-session counter guards rapid same-millisecond taps.
export function mintDraftId(): number {
  return -(Date.now() * 1000 + (counter++ % 1000));
}

export function isDraftId(id: number): boolean {
  return id < 0;
}

function keyFor(entity: DraftEntity, draftId: number): string {
  return `${entity}:${draftId}`;
}

// Pure. Real ids (>= 0) pass through; a resolved draft maps to its real id; an
// unresolved draft returns null so the caller can defer (item-error).
export function resolveOne(map: DraftMap, entity: DraftEntity, id: number): number | null {
  if (id >= 0) return id;
  const real = map[keyFor(entity, id)];
  return real === undefined ? null : real;
}

export function resolveMany(
  map: DraftMap,
  entity: DraftEntity,
  ids: number[]
): { ids: number[]; allResolved: boolean } {
  const resolved: number[] = [];
  let allResolved = true;
  for (const id of ids) {
    const r = resolveOne(map, entity, id);
    if (r === null) allResolved = false;
    else resolved.push(r);
  }
  return { ids: resolved, allResolved };
}

// --- IndexedDB-backed default store (not unit-tested, per repo convention) ---

const DB_NAME = 'glentify-draft-resolutions';
const DB_VERSION = 1;
const STORE_NAME = 'resolutions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recordResolution(entity: DraftEntity, draftId: number, realId: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(realId, keyFor(entity, draftId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDraftMap(): Promise<DraftMap> {
  const db = await openDb();
  const map = await new Promise<DraftMap>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as number[];
      const out: DraftMap = {};
      keys.forEach((k, i) => { out[k] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return map;
}
