import PDFDocument from 'pdfkit';

// pdfkit's built-in standard-14 PDF fonts (Helvetica, Times, etc.) only support
// WinAnsi/Latin-1 encoding and cannot render Greek characters — every string this module
// renders is Greek, so a Unicode-capable TrueType font must be embedded explicitly.
// dejavu-fonts-ttf ships the actual .ttf files; require.resolve gives an absolute path that
// works regardless of the server's working directory (needed for Vercel Functions).
const FONT_REGULAR = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
const FONT_BOLD = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');

export interface ProgramPdfSequence {
  title: string;
  songs: string[];
}

export function generateProgramPdf(programTitle: string, sequences: ProgramPdfSequence[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font(FONT_BOLD).fontSize(20).text(programTitle, { align: 'center' });
    doc.moveDown();

    for (const sequence of sequences) {
      doc.font(FONT_BOLD).fontSize(14).text(sequence.title);
      doc.moveDown(0.5);
      doc.font(FONT_REGULAR).fontSize(11);
      sequence.songs.forEach((title, i) => {
        doc.text(`${i + 1}. ${title}`);
      });
      doc.moveDown();
    }

    doc.end();
  });
}
