import { describe, it, expect } from 'vitest';
import { resolveVersion } from './syncedVersions';

describe('resolveVersion', () => {
  it('returns baseVersion when nothing recorded', () => {
    expect(resolveVersion({}, 'sequence', 5, 3)).toBe(3);
  });
  it('returns the recorded version when it is newer', () => {
    expect(resolveVersion({ 'sequence:5': 7 }, 'sequence', 5, 3)).toBe(7);
  });
  it('keeps baseVersion when the recorded version is older or equal', () => {
    expect(resolveVersion({ 'sequence:5': 3 }, 'sequence', 5, 4)).toBe(4);
  });
  it('scopes by resource type and id', () => {
    const map = { 'sequence:5': 9 };
    expect(resolveVersion(map, 'program', 5, 2)).toBe(2);
    expect(resolveVersion(map, 'sequence', 6, 2)).toBe(2);
  });
});
