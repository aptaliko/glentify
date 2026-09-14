import { describe, it, expect } from 'vitest';
import { isTokenLocallyValid } from './tokenClient';

// A well-formed token is `${userId}.${expiresAtSeconds}.${hmacSignature}`. The client
// can't verify the HMAC (no AUTH_SECRET), so isTokenLocallyValid only checks shape +
// expiry — enough to redirect an expired/missing session to /login at native startup
// without a network round-trip. Full validity stays enforced server-side.
function tokenExpiringInSeconds(deltaSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + deltaSeconds;
  return `42.${exp}.deadbeefsignature`;
}

describe('isTokenLocallyValid', () => {
  it('returns false for a null token (no session)', () => {
    expect(isTokenLocallyValid(null)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isTokenLocallyValid('')).toBe(false);
  });

  it('returns false for a malformed token (wrong number of parts)', () => {
    expect(isTokenLocallyValid('42.only-two')).toBe(false);
    expect(isTokenLocallyValid('a.b.c.d')).toBe(false);
  });

  it('returns false when the expiry segment is not a number', () => {
    expect(isTokenLocallyValid('42.notanumber.sig')).toBe(false);
  });

  it('returns false for an expired token', () => {
    expect(isTokenLocallyValid(tokenExpiringInSeconds(-60))).toBe(false);
  });

  it('returns true for an unexpired, well-formed token', () => {
    expect(isTokenLocallyValid(tokenExpiringInSeconds(60 * 60 * 24))).toBe(true);
  });
});
