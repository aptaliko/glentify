// src/lib/collaboratorsCache.ts

export interface CachedCollaborator {
  id: number;
  email: string;
}

export interface CachedCollaboratorsData {
  programId: number;
  role: 'creator' | 'collaborator';
  creator: CachedCollaborator | null;
  collaborators: CachedCollaborator[];
  currentUser: CachedCollaborator;
  cachedAt: string;
}

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database — same reasoning src/lib/syncQueueStorage.ts already established for its own
// database: two independent modules coordinating IndexedDB version upgrades on one shared
// database is a real risk to whatever that database already holds. A second, small,
// single-purpose database avoids that risk entirely.
const DB_NAME = 'glentify-collaborators-cache';
const DB_VERSION = 1;
const STORE_NAME = 'program-collaborators';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'programId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCollaboratorsCache(data: CachedCollaboratorsData): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadCollaboratorsCache(programId: number): Promise<CachedCollaboratorsData | null> {
  const db = await openDb();
  const result = await new Promise<CachedCollaboratorsData | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(programId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}
