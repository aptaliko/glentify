// src/lib/programsListCache.ts

export interface CachedProgram {
  id: number;
  title: string;
  role: 'creator' | 'collaborator';
  sharedWithEmails: string[];
}

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database, `glentify-sync-queue`, or sub-project #4's `glentify-collaborators-cache` —
// same reasoning established in those modules: two independent modules coordinating
// IndexedDB version upgrades on one shared database is a real risk to whatever that
// database already holds. A second, small, single-purpose database avoids that risk
// entirely.
const DB_NAME = 'glentify-programs-list-cache';
const DB_VERSION = 1;
const STORE_NAME = 'programs-list';
const LIST_KEY = 'current';

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

export async function saveProgramsListCache(programs: CachedProgram[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(programs, LIST_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProgramsListCache(): Promise<CachedProgram[] | null> {
  const db = await openDb();
  const result = await new Promise<CachedProgram[] | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(LIST_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}
