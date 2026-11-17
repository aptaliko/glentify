// Mirrors src/lib/imageValidation.ts: the ceilings here match the PDF upload route
// (src/app/api/songs/pdf-upload/route.ts), so a client-side pass means the server accepts it.
export const ALLOWED_PDF_TYPE = 'application/pdf' as const;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export type PdfValidationResult = { ok: true } | { ok: false; reason: string };

export function validatePdfFile(file: { type: string; size: number }): PdfValidationResult {
  if (file.type !== ALLOWED_PDF_TYPE) {
    return { ok: false, reason: 'Μη υποστηριζόμενος τύπος αρχείου. Επιτρέπεται μόνο PDF.' };
  }
  if (file.size > MAX_PDF_BYTES) {
    return { ok: false, reason: 'Το PDF ξεπερνά το όριο των 10MB.' };
  }
  return { ok: true };
}
