import { describe, it, expect, afterEach, vi } from 'vitest';
import { nativeApiFetch } from './nativeApiFetch';

vi.mock('./authToken', () => ({
  getAuthToken: vi.fn(async () => null),
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

  it('defaults to the real getAuthToken when no override is passed', async () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}'));
    global.fetch = mockFetch;

    // No stored token in this test environment, so getAuthToken() resolves null —
    // confirms the default parameter wires up without throwing.
    await nativeApiFetch('/api/regions');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
