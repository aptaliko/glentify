// src/lib/stackBlocks.test.ts
import { describe, it, expect } from 'vitest';
import { selectStackBlocks, MAX_PDF_PAGES } from './stackBlocks';

describe('selectStackBlocks', () => {
  it('returns nothing when no content exists', () => {
    expect(selectStackBlocks({ imageUrl: null, pdfUrl: null, lyrics: null })).toEqual([]);
  });
  it('returns one block alone (fills the view)', () => {
    expect(selectStackBlocks({ imageUrl: 'a.png', pdfUrl: null, lyrics: null })).toEqual(['image']);
    expect(selectStackBlocks({ imageUrl: null, pdfUrl: 'a.pdf', lyrics: null })).toEqual(['pdf']);
    expect(selectStackBlocks({ imageUrl: null, pdfUrl: null, lyrics: 'λόγια' })).toEqual(['lyrics']);
  });
  it('stacks two or three blocks in image, pdf, lyrics order', () => {
    expect(selectStackBlocks({ imageUrl: 'a.png', pdfUrl: 'a.pdf', lyrics: 'λόγια' })).toEqual(['image', 'pdf', 'lyrics']);
    expect(selectStackBlocks({ imageUrl: null, pdfUrl: 'a.pdf', lyrics: 'λόγια' })).toEqual(['pdf', 'lyrics']);
    expect(selectStackBlocks({ imageUrl: 'a.png', pdfUrl: null, lyrics: 'λόγια' })).toEqual(['image', 'lyrics']);
  });
  it('treats empty and whitespace-only values as absent', () => {
    expect(selectStackBlocks({ imageUrl: '', pdfUrl: '   ', lyrics: '  ' })).toEqual([]);
  });
  it('exposes the 50-page render cap', () => {
    expect(MAX_PDF_PAGES).toBe(50);
  });
});
