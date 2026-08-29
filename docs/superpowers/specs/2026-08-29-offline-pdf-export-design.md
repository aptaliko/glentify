# Offline PDF Export — Design Spec

## Problem

PDF export (shipped 2026-08-29, web + native) is deliberately online-only today: the server generates the PDF via `pdfkit` and the native side fetches the finished bytes. This is sub-project #3 of the "complete all offline features" roadmap item (see `docs/superpowers/specs/2026-08-29-offline-sync-foundation-design.md` for the full 6-sub-project decomposition) — its job is to remove that connectivity requirement, since the data a PDF needs (program title, sequence titles, song titles) is already fully cached on-device for the existing offline view/play flow.

**Architecturally, this is a different kind of problem than sub-projects #1/#2 (the write-queue) and #4-#7 (offline CRUD, all built on that queue).** PDF export is a pure read/render operation with no server write involved — nothing to queue, sync back, or resolve conflicts on. The technical unknown here is different: whether `pdfkit` (already proven server-side, including its Greek-font workaround) can generate a PDF *inside* a Capacitor WebView, client-side, entirely offline.

## Spike findings (already validated, not re-litigated in this spec)

A spike confirmed this is not just feasible but low-risk:
- `pdfkit@0.20.1` ships a genuine, modern browser build (`pdfkit.browser.mjs`, resolved automatically by bundlers via package.json's `exports` conditions) with **zero Node core module dependencies** — no polyfills needed, unlike older pdfkit versions.
- Its font-loading API (`doc.font(...)` → `PDFFontFactory.open`) accepts a `Uint8Array`/`ArrayBuffer` directly — the exact shape a browser `fetch(...).arrayBuffer()` produces, no filesystem access needed.
- It ships a built-in `pdfkit/output` module with `toBlob(document): Promise<Blob>` — output as a `Blob`, which is exactly what the existing native Filesystem/Share flow already consumes.
- Turbopack (`npm run build`) bundles a throwaway client component importing `pdfkit` cleanly, with no Node-module resolution errors — confirming this isn't blocked by the same class of build issue the server-side feature hit (that issue was specific to `require.resolve()` on a `.ttf` path, which this client-side approach never uses).

## Goal

Native "Εξαγωγή PDF" (on `src/app/programs/local/program/page.tsx`) generates the PDF entirely on-device, with no network call, ever. This fully replaces the existing online fetch — not a fallback, since the same page is only ever reachable with the program's data already cached (the page already redirects to "δεν βρέθηκε" when reference data or the program isn't available), so client-side generation is always possible whenever the button is visible.

Web PDF export is untouched — it already has connectivity by definition, so there's no reason to duplicate the work there.

## Non-goals

- Any change to the web PDF export flow (`GET /api/programs/[id]/pdf`, the web button on `programs/[id]/page.tsx`) — stays exactly as shipped.
- Any change to what the PDF contains — same title + numbered per-sequence song list as today, no new content.
- A write-queue consumer — this sub-project produces no server writes, so it does not touch `src/lib/syncQueue.ts` at all.

## Architecture

### 1. Shared, platform-agnostic rendering logic

`src/lib/programPdf.ts` is split so the actual document-drawing logic (title, sequence headings, numbered song lists) is written once and used by both platforms — only how each platform obtains font bytes and collects output differs.

```ts
export interface ProgramPdfSequence {
  title: string;
  songs: string[];
}

export interface ProgramPdfFonts {
  regular: Uint8Array | Buffer;
  bold: Uint8Array | Buffer;
}

// Pure drawing logic — no I/O, no platform-specific API. Takes an already-constructed
// PDFDocument and already-loaded font bytes; both server and client callers own their own
// I/O (reading the font, collecting output) and then hand off to this shared function.
export function drawProgramPdf(doc: PDFKit.PDFDocument, programTitle: string, sequences: ProgramPdfSequence[], fonts: ProgramPdfFonts): void {
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
```

`pdfkit`'s `doc.font(...)` already accepts a `Buffer` (Node) or `Uint8Array` (browser) directly — this is why the shared function can take pre-loaded font bytes rather than a path, unifying both platforms on the same call shape (a small simplification over today's server-only code, which resolves a filesystem path internally).

**Server** (`generateProgramPdf`, existing export, kept for the web route): reads the two DejaVu TTFs from `node_modules/dejavu-fonts-ttf` (same `process.cwd()`-based path as today — unchanged, still needed to dodge Turbopack's `require.resolve()` interception), wraps document creation and the existing `data`/`end` listener Buffer-collection around a call to `drawProgramPdf`.

**Client** (`generateProgramPdfLocal`, new export, native-only): fetches the two TTFs as `ArrayBuffer` from static assets (see below), wraps document creation and `pdfkit/output`'s `toBlob(doc)` around the same call to `drawProgramPdf`.

Both platforms end up calling `import PDFDocument from 'pdfkit'` with the identical import statement — the bundler resolves it to the Node build or the browser build automatically based on which bundle (server route vs. client component) is compiling it, per `pdfkit`'s own `package.json` `exports` conditions. No conditional import logic needed in this codebase.

### 2. Font delivery for the client build

The two DejaVu Sans `.ttf` files need to ship as static assets reachable via `fetch()` from the native app's local Capacitor origin — not a network URL.

`scripts/build-mobile.sh` gains one step: after the existing `rsync` stages `.mobile-build/` but before `next build` runs, copy the two font files from `node_modules/dejavu-fonts-ttf/ttf/` into `.mobile-build/public/fonts/`:

```bash
mkdir -p .mobile-build/public/fonts
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf .mobile-build/public/fonts/
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf .mobile-build/public/fonts/
```

This is deliberately build-script automation, not committed static files — avoids maintaining a manually-synced duplicate of a file that already lives in `node_modules`, and keeps the ~1.4MB of font data out of the web bundle entirely (only the mobile build copies it in). The web route (`src/lib/programPdf.ts`'s `generateProgramPdf`) continues reading directly from `node_modules` server-side, unaffected by this.

### 3. Native page change

`src/app/programs/local/program/page.tsx`'s `handleExportPdf` is rewritten to generate locally instead of fetching:

```ts
async function handleExportPdf(title: string, sequences: { title: string; songs: string[] }[]) {
  setExporting(true);
  setExportError(null);
  try {
    const blob = await generateProgramPdfLocal(title, sequences);
    const base64 = await blobToBase64(blob);
    const filename = sanitizeFilename(title);
    await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ url: uri, title });
  } catch {
    setExportError('Η εξαγωγή απέτυχε.');
  } finally {
    setExporting(false);
  }
}
```

`nativeApiFetch` is no longer called by this handler at all — the `Filesystem`/`Share`/`blobToBase64`/`sanitizeFilename` machinery is unchanged and reused exactly as before, only the source of the `Blob` changes. The caller passes the program's title and its already-resolved sequences (the page already builds `songsById` and resolves each sequence's song titles for the on-screen preview — the same resolved data feeds the PDF generator, no new data-fetching needed).

### 4. Font fetch inside `generateProgramPdfLocal`

```ts
async function loadFontBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  return new Uint8Array(await res.arrayBuffer());
}

export async function generateProgramPdfLocal(programTitle: string, sequences: ProgramPdfSequence[]): Promise<Blob> {
  const [regular, bold] = await Promise.all([
    loadFontBytes('/fonts/DejaVuSans.ttf'),
    loadFontBytes('/fonts/DejaVuSans-Bold.ttf'),
  ]);
  const doc = new PDFDocument({ margin: 50 });
  drawProgramPdf(doc, programTitle, sequences, { regular, bold });
  doc.end();
  return toBlob(doc);
}
```

The `fetch('/fonts/...')` call resolves against the app's own local static-asset origin (`capacitor://localhost` on Android, serving the bundle `build-mobile.sh` already produces) — genuinely no network round-trip, same as every other asset (JS, CSS) the native shell already loads this way.

## Error handling

- Font fetch failure (should not happen in practice — the font ships in the same bundle as the JS that fetches it, so if the JS loaded, the font is present too) is caught by the existing `try/catch` in `handleExportPdf`, surfacing the same `Η εξαγωγή απέτυχε.` message already shown for any export failure today.
- No new error states beyond what already exists — this change removes the `nativeApiFetch` 401/network-failure paths from this specific flow entirely (there is no fetch to fail anymore), which is a strict simplification of the existing error surface, not an addition to it.

## Testing

Following this project's established convention (Vitest coverage only for pure logic in `src/lib/*`; zero coverage for `pdfkit`-calling code, matching the already-shipped server-side `generateProgramPdf`, which has no test):

- No test for `drawProgramPdf`, `generateProgramPdf`, or `generateProgramPdfLocal` — same rationale as the original PDF export feature (pdfkit's rendered byte output isn't meaningfully assertable without a PDF parser).
- No test for the `build-mobile.sh` font-copy step (shell script, no existing test coverage for any part of that script).
- Manual verification (named gap, same treatment as prior mobile-only work in this project): on a real device or emulator, disable connectivity entirely (airplane mode), open a cached program's local page, tap "Εξαγωγή PDF," confirm the share sheet opens with no network activity and no delay waiting on a timed-out request, and confirm the resulting PDF is valid and renders Greek text correctly (the same DejaVu Sans font, now loaded via `fetch()` instead of `fs`, needs on-device confirmation it embeds correctly either way).
