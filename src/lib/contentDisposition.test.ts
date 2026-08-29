import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { contentDispositionValue } from './contentDisposition';

describe('contentDispositionValue', () => {
  it('produces a pure-ASCII header value for a Greek filename', () => {
    const value = contentDispositionValue('Καλοκαιρινό Πρόγραμμα.pdf');
    expect(/^[\x00-\xFF]*$/.test(value)).toBe(true);
  });

  it('includes an ASCII fallback filename for clients that only read filename=', () => {
    expect(contentDispositionValue('Καλοκαιρινό Πρόγραμμα.pdf')).toContain('filename="programma.pdf"');
  });

  it('includes the real filename URI-encoded via the filename* parameter (RFC 5987/6266)', () => {
    const value = contentDispositionValue('Καλοκαιρινό Πρόγραμμα.pdf');
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent('Καλοκαιρινό Πρόγραμμα.pdf')}`);
  });

  it('works for a plain ASCII filename too', () => {
    const value = contentDispositionValue('Summer Program.pdf');
    expect(value).toBe(`attachment; filename="programma.pdf"; filename*=UTF-8''${encodeURIComponent('Summer Program.pdf')}`);
  });

  it('never throws when actually used as an HTTP header value', () => {
    expect(() => {
      new NextResponse(new Uint8Array([1]), {
        headers: { 'Content-Disposition': contentDispositionValue('Καλοκαιρινό Πρόγραμμα: Ζωντανά! 2026.pdf') },
      });
    }).not.toThrow();
  });
});
