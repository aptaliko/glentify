// Builds a Content-Disposition header value that's guaranteed safe as an HTTP header
// (ByteString-only — Latin-1, code points 0-255) while still communicating the real
// filename (which may contain Greek or other non-Latin-1 characters) to browsers that
// support the filename* parameter (RFC 5987/6266, supported by every modern browser).
// The plain filename= parameter is a fixed ASCII placeholder for older clients that only
// read that one — the real name always arrives via filename*.
//
// encodeURIComponent leaves `'()*` unescaped, which are not valid in this header's
// token/quoted-string grammar unquoted — this is only RFC-safe because the filenames this
// app ever passes in are already run through sanitizeFilename (src/lib/pdfFilename.ts),
// which strips exactly those characters. Do not call this with an unsanitized filename.
export function contentDispositionValue(filename: string): string {
  return `attachment; filename="programma.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
