// src/lib/pdfValidation.test.ts
import { describe, it, expect } from 'vitest';
import { validatePdfFile, MAX_PDF_BYTES } from './pdfValidation';

describe('validatePdfFile', () => {
  it('accepts a PDF under the limit', () => {
    expect(validatePdfFile({ type: 'application/pdf', size: 1024 })).toEqual({ ok: true });
  });
  it('rejects a non-PDF type with the Greek message', () => {
    expect(validatePdfFile({ type: 'image/png', size: 1 })).toEqual({
      ok: false,
      reason: 'Μη υποστηριζόμενος τύπος αρχείου. Επιτρέπεται μόνο PDF.',
    });
  });
  it('rejects a PDF over 10 MB', () => {
    expect(validatePdfFile({ type: 'application/pdf', size: MAX_PDF_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'Το PDF ξεπερνά το όριο των 10MB.',
    });
  });
  it('accepts exactly the limit', () => {
    expect(validatePdfFile({ type: 'application/pdf', size: MAX_PDF_BYTES })).toEqual({ ok: true });
  });
});
