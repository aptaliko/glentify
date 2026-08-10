import { describe, it, expect } from 'vitest';
import { sharedBadgeText } from './programBadge';

describe('sharedBadgeText', () => {
  it('returns an empty string when nobody else has access', () => {
    expect(sharedBadgeText([])).toBe('');
  });

  it('names the one other person for a single collaborator', () => {
    expect(sharedBadgeText(['friend@example.com'])).toBe('μοιράζεται με friend@example.com');
  });

  it('names the first person and counts the rest for multiple collaborators', () => {
    expect(sharedBadgeText(['a@example.com', 'b@example.com', 'c@example.com'])).toBe(
      'μοιράζεται με a@example.com +2 ακόμα'
    );
  });
});
