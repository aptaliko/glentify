// Pure PDF-drawing logic shared between the server (src/lib/programPdf.ts, the web PDF
// export route) and the native client (src/lib/programPdfLocal.ts, offline PDF export) — no
// I/O, no platform-specific API, just pdfkit drawing calls against an already-constructed
// PDFDocument and already-loaded font bytes. Kept in its own file, deliberately with zero
// Node-only imports (no 'fs', no 'path'), so importing it never pulls Node-only modules into
// the native client bundle.
export interface ProgramPdfSequence {
  title: string;
  songs: string[];
}

export interface ProgramPdfFonts {
  regular: Buffer | Uint8Array;
  bold: Buffer | Uint8Array;
}

export function drawProgramPdf(
  doc: PDFKit.PDFDocument,
  programTitle: string,
  sequences: ProgramPdfSequence[],
  fonts: ProgramPdfFonts
): void {
  doc.font(fonts.bold).fontSize(20).text(programTitle, { align: 'center' });
  doc.moveDown();

  for (const sequence of sequences) {
    doc.font(fonts.bold).fontSize(14).text(sequence.title);
    doc.moveDown(0.5);
    doc.font(fonts.regular).fontSize(11);
    sequence.songs.forEach((title, i) => {
      doc.text(`${i + 1}. ${title}`);
    });
    doc.moveDown();
  }
}
