import { apiUrl } from './apiClient';
import { getAuthToken } from './authToken';

/**
 * Drop-in replacement for `fetch()` in admin pages, so the same code works
 * identically on web (relative path, cookie auth) and native (absolute URL
 * against the deployed API, Bearer token — the cookie never reaches
 * `capacitor://localhost`). `getToken` is injectable for tests; every real
 * caller uses the default.
 */
export async function nativeApiFetch(
  path: string,
  init?: RequestInit,
  getToken: () => Promise<string | null> = getAuthToken
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers });
}
