import type { KeyValueStore } from './preferencesStore';

const SELECTED_PROGRAM_KEY = 'glentify:selected-program-id';
const SELECTED_SEQUENCE_KEY = 'glentify:selected-sequence-id';

export async function setSelectedProgramId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_PROGRAM_KEY, id);
}

export async function getSelectedProgramId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_PROGRAM_KEY);
}

export async function setSelectedSequenceId(storage: KeyValueStore, id: number): Promise<void> {
  await storage.set(SELECTED_SEQUENCE_KEY, id);
}

export async function getSelectedSequenceId(storage: KeyValueStore): Promise<number | null> {
  return storage.get<number>(SELECTED_SEQUENCE_KEY);
}
