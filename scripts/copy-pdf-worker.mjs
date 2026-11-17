// Copies the pdf.js worker into public/ so the browser (and the static native bundle) can load it
// from /pdf.worker.min.mjs. Runs before dev, build and build:mobile. The copy is generated, so it is git-ignored.
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs');
