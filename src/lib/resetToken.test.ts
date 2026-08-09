import { describe, it, expect } from 'vitest';
import { generateResetToken, hashResetToken } from './resetToken';

describe('resetToken', () => {
  it('generates a token whose hash matches hashResetToken(token)', () => {
    const { token, tokenHash } = generateResetToken();
    expect(hashResetToken(token)).toBe(tokenHash);
  });

  it('generates a different token each call', () => {
    const a = generateResetToken();
    const b = generateResetToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('produces a stable hash for the same token', () => {
    expect(hashResetToken('same-token')).toBe(hashResetToken('same-token'));
  });
});
