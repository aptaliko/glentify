// src/lib/songsListCache.ts

export interface CachedSong {
  id: number;
  title: string;
  lyrics: string | null;
  imageUrl: string | null;
  notes: string | null;
  maleKey: string | null;
  femaleKey: string | null;
}

// A dedicated database, deliberately NOT sharing offlineCache.ts's `glentify-offline`
// database, `glentify-sync-queue`, sub-project #4's `glentify-collaborators-cache`, or
// sub-project #6's `glentify-programs-list-cache` — same reasoning established in those
// modules: two independent modules coordinating IndexedDB version upgrades on one shared
// database is a real risk to whatever that database already holds. A second, small,
// single-purpose database avoids that risk entirely.
const DB_NAME = 'glentify-songs-list-cache';
const DB_VERSION = 1;
const STORE_NAME = 'songs-list';
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

export async function saveSongsListCache(songs: CachedSong[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(songs, LIST_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadSongsListCache(): Promise<CachedSong[] | null> {
  const db = await openDb();
  const result = await new Promise<CachedSong[] | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(LIST_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}
