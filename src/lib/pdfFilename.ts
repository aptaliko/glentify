// Produces a filename safe to use in a Content-Disposition header (web) or as a local
// filesystem path (native): keeps only Unicode letters (Greek included), digits, spaces,
// hyphens, and underscores, collapses runs of whitespace into a single space, and trims.
// A title that sanitizes to nothing (blank, or entirely punctuation/symbols) falls back to
// "programma" so a filename is always produced.
export function sanitizeFilename(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${cleaned || 'programma'}.pdf`;
}
