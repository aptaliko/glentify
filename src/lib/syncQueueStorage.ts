import type { QueuedAction, QueueStorage } from './syncQueue';

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database — two independent modules coordinating IndexedDB version upgrades on one
// shared database is a real risk to the reference-data cache that database already
// critically holds; a second, small, single-purpose database avoids that risk entirely.
const DB_NAME = 'glentify-sync-queue';
const DB_VERSION = 1;
const STORE_NAME = 'queue';
const QUEUE_KEY = 'current';

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

export const indexedDbQueueStorage: QueueStorage = {
  async get(): Promise<QueuedAction[]> {
    const db = await openDb();
    const result = await new Promise<QueuedAction[] | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(QUEUE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result ?? [];
  },

  async set(actions: QueuedAction[]): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(actions, QUEUE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};
