import { preferencesStore } from './preferencesStore';

const TOKEN_KEY = 'glentify:auth-token';

export async function saveAuthToken(token: string): Promise<void> {
  await preferencesStore.set(TOKEN_KEY, token);
}

export async function getAuthToken(): Promise<string | null> {
  return preferencesStore.get<string>(TOKEN_KEY);
}

export async function clearAuthToken(): Promise<void> {
  await preferencesStore.set(TOKEN_KEY, null);
}
