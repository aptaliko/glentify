export type VersionResource = 'sequence' | 'program';
export type VersionMap = Record<string, number>;

function keyFor(resource: VersionResource, id: number): string {
  return `${resource}:${id}`;
}

// Pure. The last version this device saw the server accept for a resource, used to
// forward a stale captured baseVersion so a user's own consecutive offline edits don't
// false-conflict. Returns baseVersion when nothing newer is recorded.
export function resolveVersion(map: VersionMap, resource: VersionResource, id: number, baseVersion: number): number {
  const recorded = map[keyFor(resource, id)];
  return recorded !== undefined && recorded > baseVersion ? recorded : baseVersion;
}

// --- IndexedDB-backed store (not unit-tested, per repo convention) ---

const DB_NAME = 'glentify-synced-versions';
const DB_VERSION = 1;
const STORE_NAME = 'versions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recordSyncedVersion(resource: VersionResource, id: number, version: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(version, keyFor(resource, id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSyncedVersionMap(): Promise<VersionMap> {
  const db = await openDb();
  const map = await new Promise<VersionMap>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as number[];
      const out: VersionMap = {};
      keys.forEach((k, i) => { out[k] = vals[i]; });
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return map;
}
