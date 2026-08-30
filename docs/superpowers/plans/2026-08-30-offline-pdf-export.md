# Offline PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Native "Εξαγωγή PDF" generates the PDF entirely on-device (no network call, ever), fully replacing today's server-fetch approach — web PDF export is untouched.

**Architecture:** The PDF-drawing logic already in `src/lib/programPdf.ts` is extracted into a new, platform-agnostic `src/lib/programPdfCore.ts` (pure `pdfkit` drawing calls, no `fs`/`path`/`fetch`). Two thin platform-specific wrappers use it: `src/lib/programPdf.ts` (server, reads DejaVu Sans from the filesystem, unchanged public API) and a new `src/lib/programPdfLocal.ts` (native client, fetches the same font files from a local static asset and outputs a `Blob` via `pdfkit`'s own `pdfkit/output` helper). `scripts/build-mobile.sh` copies the two font files into the mobile build's `public/fonts/` so they ship with the app bundle. The native program page swaps its `nativeApiFetch` PDF request for a direct call to the new local generator.

**Tech Stack:** Next.js 16 App Router, `pdfkit` (already a dependency — this plan uses its browser build, resolved automatically by the client bundler via `pdfkit`'s own `package.json` `exports` conditions, no new dependency needed), TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-29-offline-pdf-export-design.md`

## Global Constraints

- The core drawing logic (`drawProgramPdf`) must live in its own file with zero Node-specific imports (`fs`, `path`) — **this plan splits it into three files (`programPdfCore.ts`, `programPdf.ts`, `programPdfLocal.ts`) rather than the spec's two-function-one-file sketch**, because a single shared file would pull `path`/`process.cwd()` top-level code into the native client bundle the moment anything in that file is imported client-side (ES module top-level statements execute on import regardless of which export is actually used — tree-shaking does not reliably remove them). This is a plan-level refinement for a concrete build-safety reason, not a spec deviation in intent.
- `pdfkit`'s font-loading (`doc.font(...)`) accepts `string | Buffer | Uint8Array | ArrayBuffer` on both platforms (confirmed against `@types/pdfkit`'s `PDFFontSource` type and the actual browser-build source during the spike) — the shared `drawProgramPdf` takes pre-loaded bytes (`Buffer` server-side, `Uint8Array` client-side), never a path, so both platforms call it identically.
- **Event-listener ordering for `pdfkit/output`'s `toBlob(doc)`:** it internally attaches `data`/`end`/`error` listeners (same as the server generator's existing manual listeners) and returns a pending Promise — call `toBlob(doc)` (or otherwise ensure its listeners are attached) **before** calling `doc.end()`, matching the exact order the already-working server code uses (listeners attached, then `.end()`). Calling `.end()` first risks the stream flowing before anything is listening.
- Native PDF export removes its `nativeApiFetch` call entirely — this is a full replacement, not a fallback (per George's explicit choice), so `handleExportPdf` no longer touches the network at all.
- Font files ship via `scripts/build-mobile.sh` copying them from `node_modules/dejavu-fonts-ttf/ttf/` into `.mobile-build/public/fonts/` at build time — not committed as static files, and not shipped in the web bundle (the web route keeps reading directly from `node_modules` server-side, unaffected).
- This codebase's testing convention: Vitest coverage only for pure logic with no I/O; zero coverage for `pdfkit`-calling code (matches the already-shipped, untested `generateProgramPdf`). No test for any file this plan touches — verification is typecheck + a functional Node-side check (server path only, since the client path needs `fetch`/`Blob`, unavailable in this codebase's Vitest node environment) + `npm run build` + `npm run build:mobile`.

---

### Task 1: Extract shared drawing logic, refactor the server generator

**Files:**
- Create: `src/lib/programPdfCore.ts`
- Modify: `src/lib/programPdf.ts` (full replacement)

**Interfaces:**
- Produces: `ProgramPdfSequence` (`{ title: string; songs: string[] }`), `ProgramPdfFonts` (`{ regular: Buffer | Uint8Array; bold: Buffer | Uint8Array }`), `drawProgramPdf(doc: PDFKit.PDFDocument, programTitle: string, sequences: ProgramPdfSequence[], fonts: ProgramPdfFonts): void` — all from `programPdfCore.ts`, used by Task 1's own `programPdf.ts` and Task 2's `programPdfLocal.ts`.
- `generateProgramPdf(programTitle: string, sequences: ProgramPdfSequence[]): Promise<Buffer>` — public signature unchanged from before this plan; still the only export the API route (`src/app/api/programs/[id]/pdf/route.ts`, untouched by this plan) imports.

No test for this task — matches the existing, already-shipped convention (`generateProgramPdf` has never had a test; `pdfkit`'s rendered byte output isn't meaningfully assertable). Verification is a functional Node-side check instead (Step 4 below), since this task changes previously-shipped, previously-reviewed code and needs a real regression check, not just a typecheck.

- [ ] **Step 1: Write the shared core**

```ts
// src/lib/programPdfCore.ts

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
```

- [ ] **Step 2: Replace the full contents of `src/lib/programPdf.ts`**

```ts
// src/lib/programPdf.ts
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
```

Note what changed from before this task: the font constants (`FONT_REGULAR`/`FONT_BOLD`) are unchanged (still string paths, still built the same Turbopack-safe way), but instead of passing those path strings straight to `doc.font(...)` (letting pdfkit's Node build read the file internally), this now explicitly reads them into `Buffer`s via `readFileSync` and passes those bytes to the shared `drawProgramPdf` — same bytes end up loaded, just made explicit so the drawing function works identically on both platforms.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Functional regression check**

Run:
```bash
npx tsx -e "
import { generateProgramPdf } from './src/lib/programPdf';
generateProgramPdf('Δοκιμαστικό Πρόγραμμα', [{ title: 'Σειρά 1', songs: ['Τραγούδι Ένα', 'Τραγούδι Δύο'] }])
  .then((buf) => { console.log('OK, bytes:', buf.length); console.log('starts with %PDF:', buf.slice(0,4).toString()); })
  .catch((e) => { console.error('FAIL', e); process.exit(1); });
"
```
Expected: prints `OK, bytes: <some number>` and `starts with %PDF: %PDF` — confirms the refactored server path still produces a valid PDF (this exact command was used to verify the original, pre-refactor `generateProgramPdf` when it first shipped — same check, same expected shape, proving no regression).

- [ ] **Step 5: Commit**

```bash
git add src/lib/programPdfCore.ts src/lib/programPdf.ts
git commit -m "Extract shared PDF-drawing core, refactor server generator to use it

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 2: Client-side PDF generator

**Files:**
- Create: `src/types/pdfkit-output.d.ts`
- Create: `src/lib/programPdfLocal.ts`

**Interfaces:**
- Consumes: `drawProgramPdf`, `ProgramPdfSequence` (Task 1's `programPdfCore.ts`).
- Produces: `generateProgramPdfLocal(programTitle: string, sequences: ProgramPdfSequence[]): Promise<Blob>` — used by Task 3 (native page).

No test for this task — same rationale as Task 1 (pdfkit byte output isn't meaningfully assertable), and additionally this file uses `fetch`/`Blob`, unavailable in this codebase's Vitest `node` test environment without extensive polyfilling that isn't worth adding for an unassertable output. Verification is typecheck + Task 4's `npm run build:mobile`.

- [ ] **Step 1: Add the ambient type declaration for `pdfkit/output`**

`@types/pdfkit` doesn't yet cover `pdfkit`'s newer `pdfkit/output` subpath export (confirmed during the spike — `tsc` reports "Could not find a declaration file for module 'pdfkit/output'" without this).

```ts
// src/types/pdfkit-output.d.ts

// @types/pdfkit doesn't yet publish declarations for pdfkit's pdfkit/output subpath export
// (confirmed against the installed @types/pdfkit — this subpath ships in pdfkit itself but
// isn't in DefinitelyTyped yet). Minimal ambient declaration for the one function this
// codebase uses from it.
declare module 'pdfkit/output' {
  function toBlob(document: PDFKit.PDFDocument): Promise<Blob>;
  export { toBlob };
}
```

- [ ] **Step 2: Write the client generator**

```ts
// src/lib/programPdfLocal.ts
import PDFDocument from 'pdfkit';
import { toBlob } from 'pdfkit/output';
import { drawProgramPdf } from './programPdfCore';
import type { ProgramPdfSequence } from './programPdfCore';

export type { ProgramPdfSequence };

async function loadFontBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (confirms the ambient declaration from Step 1 resolves the `pdfkit/output` import).

- [ ] **Step 4: Commit**

```bash
git add src/types/pdfkit-output.d.ts src/lib/programPdfLocal.ts
git commit -m "Add client-side (offline) PDF generator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 3: Font delivery + native page wiring

**Files:**
- Modify: `scripts/build-mobile.sh`
- Modify: `src/app/programs/local/program/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `generateProgramPdfLocal`, `ProgramPdfSequence` (Task 2).
- No new exports — this is the last functional piece.

No test for this task — page-level UI and shell scripts have zero automated coverage anywhere in this codebase. Verification is `npm run build:mobile` (Task 4) confirming both the font files land in the output and the page compiles.

- [ ] **Step 1: Copy the font files in `scripts/build-mobile.sh`**

In `scripts/build-mobile.sh`, find this block:

```bash
if [ -d ".mobile-build/src/app/admin/songs/[id]" ] || [ -d ".mobile-build/src/app/admin/programs/[id]" ]; then
  echo "build-mobile: a dynamic admin route survived staging, aborting" >&2
  exit 1
fi

cat > .mobile-build/next.config.ts <<'CONFIG'
```

Insert the font-copy step between those two, so the file reads:

```bash
if [ -d ".mobile-build/src/app/admin/songs/[id]" ] || [ -d ".mobile-build/src/app/admin/programs/[id]" ]; then
  echo "build-mobile: a dynamic admin route survived staging, aborting" >&2
  exit 1
fi

# Offline PDF export (src/lib/programPdfLocal.ts) fetches these at runtime from the app's own
# local static-asset origin — not committed as static files so they don't also bloat the web
# bundle (the web PDF route reads the same font package directly from node_modules instead).
mkdir -p .mobile-build/public/fonts
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf .mobile-build/public/fonts/
cp node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf .mobile-build/public/fonts/

cat > .mobile-build/next.config.ts <<'CONFIG'
```

- [ ] **Step 2: Replace the full contents of `src/app/programs/local/program/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import PageNav from '@/components/PageNav';
import { loadReferenceData } from '@/lib/offlineCache';
import { preferencesStore } from '@/lib/preferencesStore';
import { getSelectedProgramId, setSelectedSequenceId } from '@/lib/localProgramsStore';
import { mergeReferencedSongs } from '@/lib/referenceData';
import { sanitizeFilename } from '@/lib/pdfFilename';
import { generateProgramPdfLocal } from '@/lib/programPdfLocal';
import type { ReferenceData, OfflineSequence } from '@/lib/referenceData';
import type { SongRow } from '@/db/schema';

const PREVIEW_COUNT = 7;

// Filesystem.writeFile takes base64 data, not a raw Blob — this is the standard
// browser-side conversion.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string; // "data:application/pdf;base64,XXXX"
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function LocalProgramPage() {
  const router = useRouter();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [programId, setProgramId] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadReferenceData(), getSelectedProgramId(preferencesStore)])
      .then(([data, id]) => {
        setReferenceData(data);
        setProgramId(id);
      })
      .finally(() => setChecked(true));
  }, []);

  async function handleSelectSequence(sequence: OfflineSequence) {
    await setSelectedSequenceId(preferencesStore, sequence.id);
    router.push('/programs/local/sequence');
  }

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

  if (!checked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/programs/local" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }

  const program = referenceData?.programs.find((p) => p.id === programId) ?? null;

  if (!referenceData || !program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/programs/local" />
        <p className="text-lg">Το πρόγραμμα δεν βρέθηκε.</p>
      </main>
    );
  }

  const songsById = new Map<number, SongRow>(
    mergeReferencedSongs(referenceData.songs, referenceData.sharedSongs).map((s) => [s.id, s])
  );

  const pdfSequences = program.sequences.map((seq) => ({
    title: seq.title,
    songs: seq.songIds
      .map((id) => songsById.get(id))
      .filter((s): s is SongRow => s !== undefined)
      .map((s) => s.title),
  }));

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/programs/local" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold">{program.title}</h1>
        <button
          onClick={() => handleExportPdf(program.title, pdfSequences)}
          disabled={exporting}
          className="btn btn-outline btn-sm"
        >
          {exporting ? 'Εξαγωγή...' : 'Εξαγωγή PDF'}
        </button>
        {exportError && <p className="text-sm text-error">{exportError}</p>}
      </div>
      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
        {program.sequences.map((seq) => {
          const songs = seq.songIds.map((id) => songsById.get(id)).filter((s): s is SongRow => s !== undefined);
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                <button onClick={() => handleSelectSequence(seq)} className="btn btn-outline btn-sm w-full shrink-0">
                  {seq.title}
                </button>
                <div className="flex-1 overflow-y-auto">
                  <ul className="flex flex-col gap-1 text-sm text-base-content/60">
                    {songs.slice(0, PREVIEW_COUNT).map((s, i) => (
                      <li key={s.id}>{i + 1}. {s.title}</li>
                    ))}
                  </ul>
                  {remaining > 0 && (
                    <p className="pt-1 text-xs italic text-base-content/40">+{remaining} ακόμα…</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {program.sequences.length === 0 && (
          <p className="col-span-full p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</p>
        )}
      </div>
    </main>
  );
}
```

The only substantive changes from before this task: the `nativeApiFetch` import is removed (no longer used anywhere in this file — `handleExportPdf` no longer makes any network call), `generateProgramPdfLocal` is imported instead, `handleExportPdf`'s signature changes from `(title, id)` to `(title, sequences)` and its body no longer fetches, a new `pdfSequences` array is computed (reusing the same `songsById` map the on-screen preview already builds) and passed to the button's click handler in place of `program.id`. The sequence-preview grid below is otherwise byte-identical.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-mobile.sh "src/app/programs/local/program/page.tsx"
git commit -m "Ship offline PDF export: bundle fonts in the mobile build, generate locally

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Q1HBPKZsQy1fRKy1vvKuS8"
```

---

### Task 4: Full verification

**Files:** None — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all existing tests pass, unchanged (this plan adds no new tests, per the Global Constraints rationale).

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npx eslint 'src/**/*.{ts,tsx}'`
Expected: no errors in any file this plan touched (ignore any pre-existing, unrelated noise from a stale local `.mobile-build/` artifact directory if one happens to exist on disk — not part of this codebase's real source).

- [ ] **Step 4: Web build**

Run: `npm run build`
Expected: succeeds, unchanged behavior (`GET /api/programs/[id]/pdf` still present, still server-generated).

- [ ] **Step 5: Mobile build**

Run: `npm run build:mobile`
Expected: succeeds. Confirm the font files actually landed in the static export:

```bash
ls -la out/fonts/
```
Expected: `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` both present.

- [ ] **Step 6: Manual on-device verification (named gap, not blocking)**

No browser or Android device/emulator is assumed available during implementation. Per the spec's Testing section: with the device in airplane mode, open a cached program's local page, tap "Εξαγωγή PDF," confirm the share sheet opens with no network activity and no delay waiting on a timed-out request, and confirm the resulting PDF is valid with correctly-rendered Greek text.
