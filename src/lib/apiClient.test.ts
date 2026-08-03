import { describe, it, expect, afterEach } from 'vitest';
import { apiUrl } from './apiClient';

describe('apiUrl', () => {
  const originalEnv = process.env.NEXT_PUBLIC_API_BASE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalEnv;
  });

  it('returns the path unchanged when no base URL is configured (web build)', () => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    expect(apiUrl('/api/login')).toBe('/api/login');
  });

  it('prefixes the path with the base URL when one is configured (mobile build)', () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'https://glentify-kohl.vercel.app';
    expect(apiUrl('/api/login')).toBe('https://glentify-kohl.vercel.app/api/login');
  });
});
