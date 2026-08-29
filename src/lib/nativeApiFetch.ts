import { apiUrl } from './apiClient';
import { getAuthToken, clearAuthToken } from './authToken';
import { isNativeApp } from './platform';

/**
 * Drop-in replacement for `fetch()` in admin pages, so the same code works
 * identically on web (relative path, cookie auth) and native (absolute URL
 * against the deployed API, Bearer token — the cookie never reaches
 * `capacitor://localhost`). `getToken` is injectable for tests; every real
 * caller uses the default.
 *
 * On native, a 401 response means the stored token expired (session tokens
 * last 30 days with no refresh path) — web recovers from this via proxy.ts's
 * page-level redirect before the page ever renders, but proxy.ts is stripped
 * from the mobile bundle entirely, so every ported admin page always renders
 * and would otherwise crash trying to read a `{"error":"Unauthorized"}` body
 * as real data. Clearing the token and sending the user back to /login here,
 * once, in the one wrapper every admin call already goes through, covers
 * every caller instead of needing a check at each of the nine call sites.
 *
 * A background caller that must not trigger an unannounced navigation (e.g. a
 * silent sync-queue retry) passes `{ redirectOn401: false }`; the default
 * (`true`) preserves today's behavior for every existing caller, none of
 * which pass this option.
 */
export async function nativeApiFetch(
  path: string,
  init?: RequestInit,
  getToken: () => Promise<string | null> = getAuthToken,
  options?: { redirectOn401?: boolean }
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(apiUrl(path), { ...init, headers });
  const redirectOn401 = options?.redirectOn401 ?? true;
  if (response.status === 401 && isNativeApp() && redirectOn401) {
    await clearAuthToken();
    window.location.href = '/login';
  }
  return response;
}
