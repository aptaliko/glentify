import { describe, it, expect } from 'vitest';
import { parseIfMatch } from './ifMatch';

function req(value: string | null) {
  return { headers: { get: (name: string) => (name.toLowerCase() === 'if-match' ? value : null) } };
}

describe('parseIfMatch', () => {
  it('returns null when the header is absent', () => {
    expect(parseIfMatch(req(null))).toBeNull();
  });
  it('parses a plain integer', () => {
    expect(parseIfMatch(req('3'))).toBe(3);
  });
  it('treats an empty or whitespace-only value as absent, not 0', () => {
    expect(parseIfMatch(req(''))).toBeNull();
    expect(parseIfMatch(req('   '))).toBeNull();
  });
  it('treats a below-1 value (incl. the unknown-base sentinel 0) as absent', () => {
    expect(parseIfMatch(req('0'))).toBeNull();
    expect(parseIfMatch(req('-2'))).toBeNull();
  });
  it('unwraps a standards-shaped quoted or weak ETag', () => {
    expect(parseIfMatch(req('"3"'))).toBe(3);
    expect(parseIfMatch(req('W/"7"'))).toBe(7);
  });
  it('returns null for a non-numeric value', () => {
    expect(parseIfMatch(req('abc'))).toBeNull();
  });
});
