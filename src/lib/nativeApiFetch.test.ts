import { describe, it, expect, afterEach, vi } from 'vitest';
import { nativeApiFetch } from './nativeApiFetch';

vi.mock('./authToken', () => ({
  getAuthToken: vi.fn(async () => null),
  clearAuthToken: vi.fn(async () => undefined),
}));

vi.mock('./platform', () => ({
  isNativeApp: vi.fn(() => false),
}));

describe('nativeApiFetch', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalEnv;
    global.fetch = originalFetch;
  });

  it('calls the given path unchanged with no Authorization header when there is no token (web)', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    await nativeApiFetch('/api/regions', undefined, async () => null);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/regions');
    expect((init.headers as Headers).has('Authorization')).toBe(false);
  });

  it('prefixes the base URL and attaches a Bearer token when one is available (native)', async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://glentify-kohl.vercel.app';
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    await nativeApiFetch('/api/regions', undefined, async () => 'the-token');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://glentify-kohl.vercel.app/api/regions');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer the-token');
  });

  it('preserves method, body, and existing headers from the caller', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    await nativeApiFetch(
      '/api/regions',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' },
      async () => 'tok'
    );

    const [, init] = mockFetch.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"x"}');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok');
  });

  it('wires the default getToken parameter without throwing', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    // No override passed, so the default `getToken = getAuthToken` parameter is
    // exercised — the mocked ./authToken module stands in for the real one here
    // (the real getAuthToken depends on @capacitor/preferences, which isn't
    // available in this Node test environment), so this just confirms the
    // default parameter wires up without throwing, not the real token storage.
    await nativeApiFetch('/api/regions');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clears the token and redirects to /login on a 401 when running natively', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"error":"Unauthorized"}', { status: 401 }));
    global.fetch = mockFetch;
    const clearToken = vi.fn().mockResolvedValue(undefined);
    // The test environment is 'node' (vitest.config.ts), so there is no real `window` —
    // stub one in rather than touching a real `window.location` (unforgeable in jsdom
    // anyway), and read the stub back to assert on it.
    const location = { href: '' };
    vi.stubGlobal('window', { location });

    vi.doMock('./authToken', () => ({ getAuthToken: async () => 'stale-token', clearAuthToken: clearToken }));
    vi.doMock('./platform', () => ({ isNativeApp: () => true }));
    vi.resetModules();
    const { nativeApiFetch: freshNativeApiFetch } = await import('./nativeApiFetch');

    await freshNativeApiFetch('/api/regions');

    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('/login');

    vi.unstubAllGlobals();
    vi.doUnmock('./authToken');
    vi.doUnmock('./platform');
    vi.resetModules();
  });

  it('does not redirect on a 401 when running on web', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"error":"Unauthorized"}', { status: 401 }));
    global.fetch = mockFetch;
    const clearToken = vi.fn().mockResolvedValue(undefined);

    vi.doMock('./authToken', () => ({ getAuthToken: async () => null, clearAuthToken: clearToken }));
    vi.doMock('./platform', () => ({ isNativeApp: () => false }));
    vi.resetModules();
    const { nativeApiFetch: freshNativeApiFetch } = await import('./nativeApiFetch');

    const res = await freshNativeApiFetch('/api/regions');

    expect(res.status).toBe(401);
    expect(clearToken).not.toHaveBeenCalled();

    vi.doUnmock('./authToken');
    vi.doUnmock('./platform');
    vi.resetModules();
  });

  it('does not clear the token or redirect on a 401 when redirectOn401 is false, even natively', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{"error":"Unauthorized"}', { status: 401 }));
    global.fetch = mockFetch;
    const clearToken = vi.fn().mockResolvedValue(undefined);
    const location = { href: '' };
    vi.stubGlobal('window', { location });

    vi.doMock('./authToken', () => ({ getAuthToken: async () => 'stale-token', clearAuthToken: clearToken }));
    vi.doMock('./platform', () => ({ isNativeApp: () => true }));
    vi.resetModules();
    const { nativeApiFetch: freshNativeApiFetch } = await import('./nativeApiFetch');

    const res = await freshNativeApiFetch('/api/regions', undefined, undefined, { redirectOn401: false });

    expect(res.status).toBe(401);
    expect(clearToken).not.toHaveBeenCalled();
    expect(location.href).toBe('');

    vi.unstubAllGlobals();
    vi.doUnmock('./authToken');
    vi.doUnmock('./platform');
    vi.resetModules();
  });
});
