import PDFDocument from 'pdfkit';
import path from 'path';
import { readFileSync } from 'fs';
import { drawProgramPdf } from './programPdfCore';
import type { ProgramPdfSequence, ProgramPdfFonts } from './programPdfCore';

export type { ProgramPdfSequence };

// pdfkit's built-in standard-14 PDF fonts (Helvetica, Times, etc.) only support
// WinAnsi/Latin-1 encoding and cannot render Greek characters — every string this module
// renders is Greek, so a Unicode-capable TrueType font must be embedded explicitly.
// dejavu-fonts-ttf ships the actual .ttf files. Deliberately NOT using require.resolve()
// here: Turbopack statically intercepts require.resolve() calls and tries to bundle the
// target as a module, which breaks the build for a .ttf file ("Unknown module type") and,
// even when routed through a resolvable .json file first, still substitutes the call with
// an internal bundler reference that crashes at request time. Building the path via plain
// runtime string concatenation is invisible to Turbopack's static analysis and works
// correctly both at build time and at request time. process.cwd() is the deployment root
// for a Vercel Function (same guarantee require.resolve was meant to provide here).
const FONT_PACKAGE_ROOT = path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf');
const FONT_REGULAR = path.join(FONT_PACKAGE_ROOT, 'ttf', 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_PACKAGE_ROOT, 'ttf', 'DejaVuSans-Bold.ttf');

export function generateProgramPdf(programTitle: string, sequences: ProgramPdfSequence[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fonts: ProgramPdfFonts = {
      regular: readFileSync(FONT_REGULAR),
      bold: readFileSync(FONT_BOLD),
    };
    drawProgramPdf(doc, programTitle, sequences, fonts);

    doc.end();
  });
}
