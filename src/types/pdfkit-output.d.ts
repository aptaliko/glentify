// @types/pdfkit doesn't yet publish declarations for pdfkit's pdfkit/output subpath export
// (confirmed against the installed @types/pdfkit — this subpath ships in pdfkit itself but
// isn't in DefinitelyTyped yet). Minimal ambient declaration for the one function this
// codebase uses from it.
declare module 'pdfkit/output' {
  function toBlob(document: PDFKit.PDFDocument): Promise<Blob>;
  export { toBlob };
}
