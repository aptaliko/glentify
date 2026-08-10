import type { KeyValueStore } from './preferencesStore';

const SELECTED_EDIT_SONG_KEY = 'glentify:admin-edit-song-id';
const SELECTED_EDIT_PROGRAM_KEY = 'glentify:admin-edit-program-id';

export async function setSelectedEditSongId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_EDIT_SONG_KEY, id);
}

export async function getSelectedEditSongId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_EDIT_SONG_KEY);
}

export async function setSelectedEditProgramId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_EDIT_PROGRAM_KEY, id);
}

export async function getSelectedEditProgramId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_EDIT_PROGRAM_KEY);
}
