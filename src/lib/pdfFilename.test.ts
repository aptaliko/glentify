import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './pdfFilename';

describe('sanitizeFilename', () => {
  it('appends .pdf to a clean Greek title, preserving spaces', () => {
    expect(sanitizeFilename('Καλοκαιρινό Πρόγραμμα')).toBe('Καλοκαιρινό Πρόγραμμα.pdf');
  });

  it('strips punctuation not safe for a filename', () => {
    expect(sanitizeFilename('Πρόγραμμα: Καλοκαίρι/2026!')).toBe('Πρόγραμμα Καλοκαίρι2026.pdf');
  });

  it('collapses multiple internal spaces into one', () => {
    expect(sanitizeFilename('Multiple   Spaces   Here')).toBe('Multiple Spaces Here.pdf');
  });

  it('falls back to programma.pdf for a whitespace-only title', () => {
    expect(sanitizeFilename('   ')).toBe('programma.pdf');
  });

  it('falls back to programma.pdf when every character is stripped', () => {
    expect(sanitizeFilename('!!!///')).toBe('programma.pdf');
  });
});
