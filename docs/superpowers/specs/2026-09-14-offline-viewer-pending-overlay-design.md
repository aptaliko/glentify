# Offline Viewer Pending-Edit Overlay — Design Spec

**Date:** 2026-09-14
**Roadmap item:** Bugfix follow-up — the read-only "Σταθερά προγράμματα" viewer does not reflect offline edits made in Διαχείριση until they sync.
**Status:** Approved approach; ready for implementation planning.

## 1. Goal & scope

When a user edits a fixed program offline through **Διαχείριση**
(`src/app/admin/local/programs/edit/page.tsx`) — adds/removes a song, reorders a
σειρά, renames or adds a σειρά — those edits are stored only in the sync queue,
not written back into the offline cache blob. The Διαχείριση **editor** overlays
the queue on top of the blob (`toProgramDetail` → `mergeSequencesWithPending`), so
the changes show there. But the read-only **viewer** surfaces —
`src/app/programs/local/program/page.tsx` (program overview) and
`src/app/programs/local/sequence/page.tsx` (lyrics/live sequence) — render straight
from the blob with **no** queue overlay, so offline edits are invisible there until
the queue syncs and re-primes the cache.

**Goal:** make both viewer pages apply the same pending-queue overlay the editor
already uses, so offline edits appear immediately in the viewer.

### In scope
- Overlay pending sequence-queue actions (`sequence-create`, `-rename`, `-delete`,
  `-add-song`, `-remove-song`, `-reorder`) onto the program viewer and the sequence
  viewer, reusing `toProgramDetail` + `mergeSequencesWithPending` unchanged in spirit.
- A minimal extension to the shared merge output type so the richer sequence viewer
  can resolve full song data (see §3).
- Show pending-create σειρές in the program viewer, marked pending and **non-navigable**.
- Reflect the overlay in the program viewer's PDF export (including any pending-create
  σειρά, as an empty section — matches what is on screen).

### Out of scope (non-goals)
- **Live re-overlay while viewing.** The overlay is computed **once on mount**
  (mount-only). Offline — the primary case — the queue is static while viewing, so
  this is always correct and stable. If a sync completes while the user sits on the
  page, they reopen to see the reconciled state. This deliberately avoids the
  reconnect timing race between the queue draining and the blob re-priming
  (`SyncQueueProvider` runs `processQueue()` *then* `primeOfflineData()`), which a
  live overlay would have to special-case.
- **Songs *created* offline appearing with full lyrics in the sequence viewer.** A
  song added to a σειρά offline that is itself a brand-new offline draft has no cached
  `SongRow`, so it cannot render lyrics/keys/suggestions and is skipped. The dominant
  case — adding an *existing* (cached) song to a σειρά — is fully supported.
- **A needsAttention recovery/retry UI.** As in every prior offline sub-project. A
  `needsAttention` rename/reorder already reverts to last-known state inside
  `mergeSequencesWithPending`; that behavior is inherited for free.
- **Web.** `programs/local/*` are native-only pages.
- **iOS.** Parked, as elsewhere.

## 2. Architecture at a glance

Reuse the existing primitives unchanged:

- **`src/lib/offlineCache.ts` `loadReferenceData()`** — the blob read both viewers
  already do.
- **`src/lib/syncQueue.ts` `getQueuedActions()`** — read-only queue snapshot (no
  serialization needed; already used by the editor).
- **`src/lib/offlineProgramView.ts` `toProgramDetail()` + `buildSongTitleMap()`** —
  reshape one blob program (`OfflineProgram`) into the `CachedProgramDetail` that the
  merge consumes. Already exists; used by the editor's offline branch.
- **`src/lib/sequencesMerge.ts` `mergeSequencesWithPending()`** — pure overlay of
  pending sequence actions onto a `CachedProgramDetail`, producing `DisplaySequence[]`.
  Already exists; the **one** change this spec makes to it is additive (§3).

**Data flow (both viewer pages), computed once on mount:**

```
loadReferenceData()  ──┐
                       ├─→ toProgramDetail(program, titles)
getQueuedActions()  ───┤        │
buildSongTitleMap()  ──┘        ▼
                        mergeSequencesWithPending(detail, actions, titles)
                                ▼
                        DisplaySequence[]  ──→  render
```

No new modules, no queue-engine changes, no new IndexedDB stores.

## 3. The one shared change: carry `songId` through the merge output

`DisplaySequenceSong` (in `src/lib/sequencesMerge.ts`) is currently:

```ts
export interface DisplaySequenceSong {
  sequenceSongId: number;
  title: string;
}
```

The program viewer only needs `title`, but the **sequence viewer** needs the song's
`songId` to resolve the full `SongRow` (lyrics, male/female key, and to feed
`getSequenceSuggestions`). Extend the type:

```ts
export interface DisplaySequenceSong {
  sequenceSongId: number;
  songId: number;
  title: string;
}
```

The value is already available at every construction site inside
`mergeSequencesWithPending`:
- **Base songs** come from `CachedProgramDetail.sequences[].songs`, i.e.
  `CachedSequenceSong` which already has `songId`.
- The **`sequence-add-song`** case already destructures `p.songId` from the payload
  (it currently uses it only to look up the title) — include it in the pushed entry.
- `sequence-reorder` / `sequence-remove-song` only re-order/filter existing entries,
  so `songId` is preserved automatically.

The admin editor (`admin/local/programs/edit/page.tsx`) reads only `sequenceSongId`
and `title` off `DisplaySequenceSong`, so the added field is inert there — **no editor
change required**.

## 4. Program viewer — `src/app/programs/local/program/page.tsx`

Currently: loads `[referenceData, selectedProgramId]`, finds the blob program, and
renders `program.sequences` / `seq.songIds` directly.

Change:
1. Mount effect additionally calls `getQueuedActions()`.
2. Compute once: `titles = buildSongTitleMap(referenceData.songs, referenceData.sharedSongs)`;
   `detail = toProgramDetail(program, titles)`;
   `displaySequences = mergeSequencesWithPending(detail, actions, titles)`.
3. Render from `displaySequences` (a `DisplaySequence[]`) instead of the raw blob
   sequences:
   - **Active** σειρά (`status: 'active'`): rendered and navigable as today — tap sets
     the selected sequence id and pushes to `/programs/local/sequence`.
   - **Pending-create** σειρά (`status: 'pending-create'`, negative draft id): rendered
     with an "(εκκρεμεί)" marker and **not** navigable (no tap handler), mirroring how
     the Διαχείριση editor renders pending-create σειρές. These are empty drafts, so
     there is nothing to open.
   - Song preview list uses `displaySequence.songs` (`title`).
4. **PDF export** (`handleExportPdf` / `pdfSequences`): build from `displaySequences`
   uniformly. A pending-create σειρά contributes an empty section — included for
   screen/PDF consistency (approved).

State/props: `displaySequences` replaces the direct `program.sequences` reads for
rendering. `program` is still needed for `title` and `id`. Guard rendering until
`referenceData` + `programId` resolve (existing `checked` flow unchanged).

## 5. Sequence viewer — `src/app/programs/local/sequence/page.tsx`

Currently: loads `[referenceData, selectedProgramId, selectedSequenceId]`; derives
`sequence = program.sequences.find(id)`, then
`songs = sequence.songIds.map(id => songsById.get(id))`; uses `sequence.songIds` for
the suggestions "already played" set.

Change:
1. Mount effect additionally calls `getQueuedActions()`.
2. Build the overlaid detail the same way (`toProgramDetail` →
   `mergeSequencesWithPending`) and select the target sequence from the resulting
   `DisplaySequence[]` by `selectedSequenceId`.
3. Derive the ordered song list from the overlaid sequence:
   `songs = displaySequence.songs.map(s => songsById.get(s.songId)).filter(Boolean)`.
   `songsById` is the existing `mergeReferencedSongs(...)` map of `SongRow` by id. A
   song with no cached `SongRow` (offline-created draft song — out of scope) is
   filtered out, exactly as the current `.filter((s) => s !== undefined)` already does
   for any missing id.
4. Suggestions "already played" set becomes `new Set(displaySequence.songs.map(s => s.songId))`
   instead of `new Set(sequence.songIds)`.
5. Everything else — swipe navigation, `index`/`goToIndex`, `LiveSessionView`
   exploration, `SequenceSuggestionsCard` — operates on this overlaid `songs` list
   unchanged.

**Fallback safety:** the program viewer makes pending-create σειρές non-navigable, so
the sequence viewer should only ever be entered for a real sequence id. If it is
somehow entered for a draft/empty sequence, it resolves to an empty `songs` list and
hits the existing *"Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά."* screen — a safe
no-op, no crash.

## 6. Testing

Per the repo convention: pure logic is unit-tested with vitest; pages that touch
IndexedDB / Capacitor / navigation are verified manually and tracked in
`docs/manual-testing-checklist.md`.

**Unit (vitest) — `src/lib/sequencesMerge.test.ts`:**
- `songId` is carried onto base songs from `CachedSequenceSong`.
- `songId` is carried onto a `sequence-add-song` entry from its payload.
- `songId` survives a `sequence-reorder` (entries reordered, `songId` intact).
- Existing assertions (title/sequenceSongId/status, needsAttention revert) still pass
  unchanged.

**Manual checklist additions (`docs/manual-testing-checklist.md`):** offline, via
Διαχείριση, then open the Σταθερά προγράμματα viewer:
- Add an existing song to a σειρά → appears in the program preview **and** in the
  sequence viewer (correct position, lyrics load).
- Reorder songs → new order shown in both the preview and the sequence viewer.
- Remove a song → gone from both.
- Rename a σειρά → new title shown in the viewer.
- Add a new σειρά → appears in the program viewer marked "(εκκρεμεί)" and is **not**
  tappable.
- A `needsAttention` reorder (forced conflict) → viewer shows last-known order (no
  phantom change), consistent with the editor.
- PDF export reflects the overlaid songs/σειρές.
- Reconnect and let the queue drain → reopen the viewer → state matches the server
  (overlay now a no-op on a re-primed blob).

## 7. Risks & considerations

- **Suggestions correctness.** `getSequenceSuggestions(referenceData, current.id, played, …)`
  takes a real `songId` and a played-set of real `songId`s; with the overlay these are
  the post-edit `songId`s, which is exactly what a live gig would want.
- **Draft-song edge.** Adding an offline-*created* song to a σειρά offline would show
  it in the program preview (title resolves via `songTitleById`, which the editor
  already populates) but skip it in the sequence viewer (no `SongRow`). Declared out of
  scope; not a regression (the viewer already filters unknown ids).
- **Mount-only staleness.** If the queue drains while the page is open, the page keeps
  showing the mount-time overlay until reopened. Accepted per the liveness decision;
  the offline primary case is unaffected because the queue is static offline.
