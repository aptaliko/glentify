export interface CachedSequenceSong {
  sequenceSongId: number;
  songId: number;
  title: string;
}

export interface CachedSequence {
  id: number;
  title: string;
  position: number;
  songs: CachedSequenceSong[];
}

export interface CachedProgramDetail {
  programId: number;
  title: string;
  role: 'creator' | 'collaborator';
  sequences: CachedSequence[];
  cachedAt: string;
}

// Dedicated database — same reasoning as collaboratorsCache.ts / songsListCache.ts:
// never share glentify-offline / glentify-sync-queue, to avoid cross-module IndexedDB
// version-upgrade risk.
const DB_NAME = 'glentify-program-detail-cache';
const DB_VERSION = 1;
const STORE_NAME = 'program-detail';

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

export async function saveProgramDetail(detail: CachedProgramDetail): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(detail);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadProgramDetail(programId: number): Promise<CachedProgramDetail | null> {
  const db = await openDb();
  const result = await new Promise<CachedProgramDetail | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(programId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result ?? null;
}

// Updates one sequence's songs in place (used when an expand fetches a sequence's songs
// online), leaving every other sequence untouched. No-op if the program isn't cached yet.
export async function saveSequenceSongs(
  programId: number,
  sequenceId: number,
  songs: CachedSequenceSong[]
): Promise<void> {
  const existing = await loadProgramDetail(programId);
  if (!existing) return;
  const sequences = existing.sequences.map((s) => (s.id === sequenceId ? { ...s, songs } : s));
  await saveProgramDetail({ ...existing, sequences, cachedAt: new Date().toISOString() });
}
