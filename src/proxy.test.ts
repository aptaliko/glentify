import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { getAuthCookieValue, getAuthCookieName } from './lib/auth';

describe('proxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APP_PASSWORD = 'secret123';
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows an /api/* request carrying a valid bearer token', () => {
    const token = getAuthCookieValue();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}` },
    });
    const res = proxy(req);
    expect(res.status).not.toBe(401);
  });

  it('rejects an /api/* request with an invalid bearer token', () => {
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: 'Bearer not-the-right-token' },
    });
    const res = proxy(req);
    expect(res.status).toBe(401);
  });

  it('adds CORS headers for a known Capacitor origin', () => {
    const token = getAuthCookieValue();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}`, origin: 'capacitor://localhost' },
    });
    const res = proxy(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });

  it('does not add CORS headers for an unknown origin', () => {
    const token = getAuthCookieValue();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example.com' },
    });
    const res = proxy(req);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers an OPTIONS preflight from a Capacitor origin without requiring auth', () => {
    const req = new NextRequest('https://example.com/api/reference-data', {
      method: 'OPTIONS',
      headers: { origin: 'capacitor://localhost' },
    });
    const res = proxy(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });

  it('allows an /api/* request carrying only a valid cookie (no bearer token)', () => {
    const cookieValue = getAuthCookieValue();
    const cookieName = getAuthCookieName();
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { cookie: `${cookieName}=${cookieValue}` },
    });
    const res = proxy(req);
    expect(res.status).not.toBe(401);
  });

  it('redirects an unauthenticated non-/api/* request to /login', () => {
    const req = new NextRequest('https://example.com/admin/songs');
    const res = proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});
