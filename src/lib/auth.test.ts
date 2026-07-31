import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isValidPassword, getAuthCookieValue, isAuthCookieValid } from './auth';

describe('auth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APP_PASSWORD = 'secret123';
    process.env.AUTH_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts the correct password', () => {
    expect(isValidPassword('secret123')).toBe(true);
  });

  it('rejects an incorrect password', () => {
    expect(isValidPassword('wrong')).toBe(false);
  });

  it('validates a cookie value produced by getAuthCookieValue', () => {
    const value = getAuthCookieValue();
    expect(isAuthCookieValid(value)).toBe(true);
  });

  it('rejects an arbitrary cookie value', () => {
    expect(isAuthCookieValid('not-the-right-value')).toBe(false);
  });

  it('rejects an undefined cookie value', () => {
    expect(isAuthCookieValid(undefined)).toBe(false);
  });
});
