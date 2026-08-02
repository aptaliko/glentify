import type { ReferenceData } from './referenceData';

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
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, REFERENCE_DATA_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadReferenceData(): Promise<ReferenceData | null> {
  const db = await openDb();
  const result = await new Promise<ReferenceData | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(REFERENCE_DATA_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}
