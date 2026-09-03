// Dedicated database — deliberately NOT sharing offlineCache.ts's `glentify-offline` or the
// sync queue's `glentify-sync-queue`, matching syncQueueStorage.ts's stated reasoning that
// independent modules coordinating version upgrades on one database is a real risk to the
// caches those databases hold. Two object stores:
//   `images`      keyed by draftBlobId -> LocalImage (the picked Blob + metadata)
//   `resolutions` keyed by draftBlobId -> uploaded public URL (string)
// The resolution map gives the sync handler idempotency: /api/songs/image-upload sets
// addRandomSuffix, so a retried upload() would mint a new orphan blob without it.
const DB_NAME = 'glentify-local-images';
const DB_VERSION = 1;
const IMAGES_STORE = 'images';
const RESOLUTIONS_STORE = 'resolutions';

export interface LocalImage {
  blob: Blob;
  contentType: string;
  filename: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGES_STORE)) db.createObjectStore(IMAGES_STORE);
      if (!db.objectStoreNames.contains(RESOLUTIONS_STORE)) db.createObjectStore(RESOLUTIONS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putValue(store: string, key: number, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getValue<T>(store: string, key: number): Promise<T | null> {
  const db = await openDb();
  const result = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

export async function putLocalImage(draftBlobId: number, image: LocalImage): Promise<void> {
  await putValue(IMAGES_STORE, draftBlobId, image);
}

export async function getLocalImage(draftBlobId: number): Promise<LocalImage | null> {
  return getValue<LocalImage>(IMAGES_STORE, draftBlobId);
}

export async function deleteLocalImage(draftBlobId: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).delete(draftBlobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function recordImageResolution(draftBlobId: number, url: string): Promise<void> {
  await putValue(RESOLUTIONS_STORE, draftBlobId, url);
}

export async function loadImageResolution(draftBlobId: number): Promise<string | null> {
  return getValue<string>(RESOLUTIONS_STORE, draftBlobId);
}
