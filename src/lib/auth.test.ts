import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { getAuthCookieName, createSessionToken, verifySessionToken } from './auth';

describe('auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('has a stable cookie name', () => {
    expect(getAuthCookieName()).toBe('glentify_auth');
  });

  it('verifies a token it just created, returning the same userId', () => {
    const token = createSessionToken(42);
    expect(verifySessionToken(token)).toBe(42);
  });

  it('rejects an undefined token', () => {
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it('rejects a tampered token', () => {
    const token = createSessionToken(42);
    const tampered = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0');
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken(42);
    process.env.AUTH_SECRET = 'a-different-secret';
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = createSessionToken(42);
    const [userIdStr] = token.split('.');
    // Re-sign an already-expired payload using the same secret so only expiry fails.
    const expiredPayload = `${userIdStr}.${Math.floor(Date.now() / 1000) - 10}`;
    const expiredToken = `${expiredPayload}.${createHmac('sha256', 'test-secret').update(expiredPayload).digest('hex')}`;
    expect(verifySessionToken(expiredToken)).toBeNull();
  });
});
