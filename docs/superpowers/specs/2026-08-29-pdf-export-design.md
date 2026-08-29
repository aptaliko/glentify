# PDF Export of a Σταθερό Πρόγραμμα — Design Spec

## Problem

A Σταθερό Πρόγραμμα (fixed program) — a set of ordered σειρές (sequences), each a numbered list of songs — only exists inside the app today. There's no way to hand a printable or shareable setlist to a band member who doesn't have a tablet or the app installed. George asked for this alongside the session-save feature; it's an independent subsystem (unrelated data flow — rendering a document, not writing new data) and is being built second, as agreed.

## Goal

A single "Export PDF" button on a program's detail page (both web and native/Android) produces a PDF containing that program's title and, for each sequence, its title followed by a numbered list of song titles — nothing else (no lyrics, no sheet-music images, no keys). On web this downloads directly. On Android, since the app has never produced an outgoing file before (every prior file interaction, including the admin tool's image upload, was an *input*), it opens the native share sheet so the user can save it or send it directly (WhatsApp, email, etc.).

## Non-goals

- Any content beyond a plain numbered title list (no lyrics, no `imageUrl` sheet-music images, no `maleKey`/`femaleKey`).
- Per-sequence export — only whole-program export, triggered from the program detail page.
- Offline PDF generation — this always requires connectivity, matching the "thin native client talks to the deployed API" pattern already used everywhere else (`nativeApiFetch`, the Android admin tool). Native's PDF button is simply unusable offline, same as every other native mutation/fetch in this app.
- Any change to how programs, sequences, or songs are created/edited — this is a pure read-and-render feature.

## Architecture

### Server-side generation

A new endpoint, `GET /api/programs/[id]/pdf`, is the single source of the PDF for both platforms — matching this codebase's established pattern of native being a thin client against the same deployed API rather than duplicating logic per platform.

Access control matches the existing `GET /api/programs/[id]` route exactly: `getProgramAccess(userId, programId)` must return `'creator'` or `'collaborator'`; `null` → `404 Δεν βρέθηκε` (same convention as every other program route — not a 403, since that would leak a program's existence to a non-member).

The route assembles the document from the same query functions the rest of the app already uses — `getProgramById`, `listSequencesForProgram`, and `listSongsForSequence` per sequence — no new query-layer functions are needed; this route is purely a new consumer of existing reads.

PDF rendering uses a new dependency, **`pdfkit`** (pure Node, no headless-browser dependency, runs on a standard Vercel Function with no special runtime configuration). Layout: program title as a heading, then for each sequence in order — sequence title as a subheading, then its songs as a numbered list (`1. `, `2. `, …), matching the numbering style already used in `programs/[id]/page.tsx`'s and `programs/local/program/page.tsx`'s song-list previews.

**Font (discovered during planning, not optional):** pdfkit's built-in standard-14 PDF fonts (Helvetica, Times, etc.) only support WinAnsi/Latin-1 encoding — they cannot render Greek characters, and every string this feature renders (program titles, sequence titles, song titles) is Greek. A second new dependency, **`dejavu-fonts-ttf`**, ships the actual DejaVu Sans TrueType font files (confirmed: `node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`) — DejaVu Sans has full Greek Unicode coverage and is a standard choice for this exact problem. The PDF generator calls `doc.font(<path to DejaVuSans.ttf>)` before rendering any text, resolving the path at runtime via `path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf', 'DejaVuSans.ttf')` rather than `require.resolve()`, since Turbopack statically intercepts `require.resolve()` calls and breaks the build for a non-JS file like a `.ttf`.

Response headers: `Content-Type: application/pdf`, `Content-Disposition` carrying the sanitized filename. The filename is derived from the program's title, with characters unsafe for a filename (anything outside letters — including Greek — digits, spaces, hyphens, and underscores) stripped, and whitespace collapsed; an empty result after sanitizing falls back to `programma.pdf`. Because `Content-Disposition` header values must be ASCII/ByteString-safe, the (frequently Greek) filename `sanitizeFilename` produces is carried via the `filename*` (RFC 5987/6266) parameter rather than the plain `filename=` parameter, which cannot hold it.

### Web: no client logic needed

The button on `src/app/programs/[id]/page.tsx` is a plain anchor:

```tsx
<a href={`/api/programs/${program.id}/pdf`} download className="btn btn-outline btn-sm">
  Εξαγωγή PDF
</a>
```

The browser's native download handling does everything else — no fetch, no blob handling, no new client code beyond this one element.

### Android: new capability — the app has never produced an outgoing file before

Two new Capacitor plugins are added: `@capacitor/filesystem` and `@capacitor/share` (versions matching the existing `@capacitor/*` family, currently `^8.5.0`).

On `src/app/programs/local/program/page.tsx`, the button instead runs a handler:

1. `nativeApiFetch(\`/api/programs/${programId}/pdf\`)` — same Bearer-auth pattern the Android admin tool already established for mutating/fetching calls against the deployed API.
2. Read the response as a blob, convert to a base64 string (`FileReader` or an equivalent conversion — needed because `Filesystem.writeFile` takes base64 data, not a raw blob).
3. `Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache })` — writes into the app's cache directory (not `Directory.Documents`, since this is a transient export the user is about to hand off via the share sheet, not something the app itself needs to keep track of afterward).
4. `Filesystem.getUri({ path: filename, directory: Directory.Cache })` to get a `file://`-style URI, then `Share.share({ url: fileUri, title: program.title })` — opens Android's native share sheet, letting the user pick "Save to Drive," "Save to Files," WhatsApp, email, etc.

If the fetch fails (offline, 404, 401 — the last already handled generically by `nativeApiFetch`'s existing 401→login redirect), show an inline error near the button rather than a native crash; no retry logic beyond letting the user tap the button again.

### Data flow diagram

```
Web:  <a download> → browser → GET /api/programs/[id]/pdf → pdfkit stream → saved to Downloads

Native: tap button → nativeApiFetch (Bearer) → GET /api/programs/[id]/pdf → pdfkit stream
        → blob → base64 → Filesystem.writeFile (cache) → Share.share() → Android share sheet
```

## Error handling

- No access to the program (not creator, not collaborator) → 404, same as every other program route. The web button simply wouldn't render for a program the user can't see (it lives on a page already gated by program access), and the native path surfaces the 404 as an inline error.
- Program has zero sequences, or a sequence has zero songs → not an error; the PDF still generates, with an empty sequence rendered as its title and no list beneath it. (Unlike the session-save feature, there's no reason to skip empty sequences here — a program's structure, however sparse, is exactly what's being exported.)
- `pdfkit` generation failure (should be rare — it's rendering plain text) → let it surface as a 500; no special handling needed given the content is always simple, uniform text.

## Testing

Following this project's established convention (Vitest coverage only for pure logic in `src/lib/*`; zero coverage anywhere under `src/db/queries/*` or `src/app/api/*`):

- The filename-sanitizing logic is extracted into a small pure function in `src/lib/` (e.g. `src/lib/pdfFilename.ts`, exporting `sanitizeFilename(title: string): string`) specifically so it can be unit-tested — this is the one piece of this feature with real branching logic worth isolating.
- No test for the route itself, the `pdfkit` rendering, or the native Filesystem/Share flow — matches convention.
- Manual verification (named gap, same treatment as prior mobile-only work in this project): open a program's detail page on web, click Εξαγωγή PDF, confirm a correctly-formatted PDF downloads. Then the Android side — the first-ever on-device test of this app producing and sharing a file — confirm the share sheet opens and the PDF is both viewable and correctly formatted after being saved/shared through it.
