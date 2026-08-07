import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';
import { createSessionToken, getAuthCookieName } from './lib/auth';

describe('proxy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows an /api/* request carrying a valid bearer token', () => {
    const token = createSessionToken(42);
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
    const token = createSessionToken(42);
    const req = new NextRequest('https://example.com/api/reference-data', {
      headers: { authorization: `Bearer ${token}`, origin: 'capacitor://localhost' },
    });
    const res = proxy(req);
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
  });

  it('does not add CORS headers for an unknown origin', () => {
    const token = createSessionToken(42);
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
    const cookieValue = createSessionToken(42);
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

  it('does not require auth for /register (public path)', () => {
    const req = new NextRequest('https://example.com/register');
    const res = proxy(req);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(307);
  });

  it('does not require auth for /api/register (public path)', () => {
    const req = new NextRequest('https://example.com/api/register', { method: 'POST' });
    const res = proxy(req);
    expect(res.status).not.toBe(401);
  });
});
