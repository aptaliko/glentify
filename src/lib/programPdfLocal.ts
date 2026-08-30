import PDFDocument from 'pdfkit';
import { toBlob } from 'pdfkit/output';
import { drawProgramPdf } from './programPdfCore';
import type { ProgramPdfSequence } from './programPdfCore';

export type { ProgramPdfSequence };

async function loadFontBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) {
    // Should never happen — the font ships in the same bundle as the JS that fetches it — but
    // if it ever does, fail with a message that names the missing asset instead of letting the
    // opaque bytes reach fontkit, which would otherwise throw a generic
    // "Not a supported font format" error with no indication of which file or why.
    throw new Error(`font fetch failed: ${path} (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Client-side (native/offline) counterpart to src/lib/programPdf.ts's generateProgramPdf —
// same drawing logic (drawProgramPdf), but fonts come from a local static asset via fetch()
// instead of the filesystem, and output is a Blob (via pdfkit's own pdfkit/output helper)
// instead of a Node Buffer, matching what the native Filesystem/Share flow already expects.
// The two DejaVu Sans font files are copied into the mobile build's public/fonts/ by
// scripts/build-mobile.sh (see that script for why they aren't committed as static files).
export async function generateProgramPdfLocal(programTitle: string, sequences: ProgramPdfSequence[]): Promise<Blob> {
  const [regular, bold] = await Promise.all([
    loadFontBytes('/fonts/DejaVuSans.ttf'),
    loadFontBytes('/fonts/DejaVuSans-Bold.ttf'),
  ]);
  const doc = new PDFDocument({ margin: 50 });
  drawProgramPdf(doc, programTitle, sequences, { regular, bold });
  // toBlob() attaches its data/end/error listeners immediately when called — call it (and
  // capture the pending Promise) BEFORE doc.end(), matching the exact listeners-then-end
  // order the server generator already uses. Calling doc.end() first risks the stream
  // flowing before anything is listening.
  const blobPromise = toBlob(doc);
  doc.end();
  return blobPromise;
}
