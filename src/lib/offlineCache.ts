import { normalizeReferenceData, type ReferenceData, type CachedReferenceData } from './referenceData';
import { apiUrl } from './apiClient';
import { getAuthToken, clearAuthToken } from './authToken';

const DB_NAME = 'glentify-offline';
const DB_VERSION = 1;
const STORE_NAME = 'reference-data';
const REFERENCE_DATA_KEY = 'current';

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

export async function saveReferenceData(data: ReferenceData): Promise<void> {
  const envelope: CachedReferenceData = { ...data, primedAt: new Date().toISOString() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(envelope, REFERENCE_DATA_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadReferenceData(): Promise<CachedReferenceData | null> {
  const db = await openDb();
  const result = await new Promise<CachedReferenceData | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(REFERENCE_DATA_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!result) return null;
  return { ...normalizeReferenceData(result), primedAt: result.primedAt ?? null };
}

// Databases owned by the retired satellite cache modules (Task 9). Cleaned up best-effort
// on every prime so a device that primed under the old design doesn't leave dead stores
// behind. A failure here must never fail the prime.
const ORPHAN_DB_NAMES = [
  'glentify-songs-list-cache',
  'glentify-programs-list-cache',
  'glentify-program-detail-cache',
  'glentify-collaborators-cache',
];

function deleteOrphanDatabases(): void {
  for (const name of ORPHAN_DB_NAMES) {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      // best-effort — a blocked/failed delete must not affect the prime result
    }
  }
}

// The single writer of the offline blob. Pulls one consistent server snapshot and stamps
// primedAt. Mirrors the auth/401 handling the Home button used to do inline.
export async function primeOfflineData(): Promise<{ status: 'ok' | 'error' | 'unauthorized' }> {
  try {
    const token = await getAuthToken();
    const res = await fetch(apiUrl('/api/reference-data'), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.status === 401) {
      await clearAuthToken();
      return { status: 'unauthorized' };
    }
    if (!res.ok) return { status: 'error' };
    await saveReferenceData(await res.json());
    deleteOrphanDatabases();
    return { status: 'ok' };
  } catch {
    return { status: 'error' };
  }
}
