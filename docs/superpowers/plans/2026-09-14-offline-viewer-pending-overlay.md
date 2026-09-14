# Offline Viewer Pending-Edit Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the read-only native "Σταθερά προγράμματα" viewer reflect offline edits made in Διαχείριση immediately (by overlaying the sync queue), and auto-refresh the program overview after a sync completes so the user never has to run "Προετοιμασία για offline" by hand.

**Architecture:** Reuse the editor's existing offline overlay pipeline unchanged in spirit — `loadReferenceData()` (blob) + `getQueuedActions()` (queue snapshot) → `toProgramDetail()` → `mergeSequencesWithPending()` → `DisplaySequence[]` — and render both viewer pages from that instead of the raw blob. One additive type change (`songId` on `DisplaySequenceSong`) lets the richer sequence viewer resolve full `SongRow` data. A `visibilitychange` listener on the program overview re-reads on foreground to close the post-sync staleness gap the spec's mount-only stance leaves open.

**Tech Stack:** Next.js (App Router, static-export native bundle), React client components, Capacitor (Android), TypeScript, Vitest (pure logic only).

**Spec:** `docs/superpowers/specs/2026-09-14-offline-viewer-pending-overlay-design.md`

## Global Constraints

- **Native-only.** `programs/local/program` and `programs/local/sequence` are native-only pages; no web path is touched. No `isNativeApp()` gate is needed inside them (they only exist in the mobile bundle).
- **Reuse, don't reinvent.** Use `toProgramDetail` + `buildSongTitleMap` (`src/lib/offlineProgramView.ts`) and `mergeSequencesWithPending` (`src/lib/sequencesMerge.ts`) exactly as the editor does. No queue-engine changes, no new IndexedDB stores, no new modules.
- **The one shared merge change is additive:** add `songId: number` to `DisplaySequenceSong`. The admin editor reads only `sequenceSongId` and `title` off it, so the field is inert there — **no editor change.**
- **Overlay is mount-time** for the sequence viewer (spec §1/§7 non-goal: no live re-overlay while viewing — avoids the reconnect drain/prime race and disrupting a live gig's index/exploration state). The program overview additionally refreshes on `visibilitychange` (Task 4) because it has no fragile in-view state to disturb.
- **Pending-create σειρές** appear in the program overview marked `(εκκρεμεί)` and are **non-navigable** (no tap handler) — they are empty drafts.
- **Out of scope:** a song *created* offline (draft `SongRow` absent) is skipped in the sequence viewer, exactly as the existing `.filter((s) => s !== undefined)` already drops any unknown id. No needsAttention recovery UI (inherited revert behavior only). No web, no iOS.

---

### Task 1: Carry `songId` through the merge output

**Files:**
- Modify: `src/lib/sequencesMerge.ts:4-7` (the `DisplaySequenceSong` interface), `:83` (base-song mapping), `:110-118` (`sequence-add-song` case)
- Test: `src/lib/sequencesMerge.test.ts`

**Interfaces:**
- Consumes: `CachedProgramDetail` (whose `sequences[].songs` are `CachedSequenceSong { sequenceSongId, songId, title }`), `QueuedAction`.
- Produces: `DisplaySequenceSong { sequenceSongId: number; songId: number; title: string }` and `mergeSequencesWithPending(detail, actions, songTitleById): DisplaySequence[]` — same signature, richer song entries. Tasks 2 and 3 consume `DisplaySequence.songs[].songId`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/sequencesMerge.test.ts` inside the existing `describe('mergeSequencesWithPending', …)` block (the shared `detail`/`titles` fixtures at the top of the file already give base songs `{sequenceSongId:100,songId:10}` and `{sequenceSongId:101,songId:11}`):

```ts
it('carries songId onto base songs from the cached detail', () => {
  const out = mergeSequencesWithPending(detail, [], titles);
  expect(out[0].songs.map((s) => ({ ssid: s.sequenceSongId, sid: s.songId }))).toEqual([
    { ssid: 100, sid: 10 },
    { ssid: 101, sid: 11 },
  ]);
});

it('carries songId onto a pending sequence-add-song entry from its payload', () => {
  const out = mergeSequencesWithPending(
    detail,
    [action({ type: 'sequence-add-song', payload: { draftId: -9, sequenceId: 5, songId: 12 } })],
    titles,
  );
  const added = out[0].songs.find((s) => s.sequenceSongId === -9);
  expect(added).toMatchObject({ songId: 12, title: 'Γ' });
});

it('preserves songId across a reorder', () => {
  const out = mergeSequencesWithPending(
    detail,
    [action({ type: 'sequence-reorder', payload: { sequenceId: 5, orderedIds: [101, 100] } })],
    titles,
  );
  expect(out[0].songs.map((s) => s.songId)).toEqual([11, 10]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/sequencesMerge.test.ts`
Expected: FAIL — the three new tests error because `DisplaySequenceSong` has no `songId` property (TypeScript compile error in the test, and/or `undefined` values).

- [ ] **Step 3: Add `songId` to the interface**

In `src/lib/sequencesMerge.ts`, change the interface:

```ts
export interface DisplaySequenceSong {
  sequenceSongId: number;
  songId: number;
  title: string;
}
```

- [ ] **Step 4: Carry `songId` on base songs**

In `mergeSequencesWithPending`, the base mapping (currently line ~83):

```ts
    songs: s.songs.map((e) => ({ sequenceSongId: e.sequenceSongId, songId: e.songId, title: e.title })),
```

(`s.songs` are `CachedSequenceSong`, which already has `songId`.)

- [ ] **Step 5: Carry `songId` on the add-song overlay**

In the `case 'sequence-add-song':` block, include `songId` in the pushed entry (the payload already destructures `p.songId` for the title lookup):

```ts
      case 'sequence-add-song': {
        if (typeof p.sequenceId === 'number' && typeof p.draftId === 'number' && typeof p.songId === 'number') {
          const title = songTitleById.get(p.songId) ?? '—';
          sequences = sequences.map((s) =>
            s.id === p.sequenceId
              ? { ...s, songs: [...s.songs, { sequenceSongId: p.draftId as number, songId: p.songId as number, title }] }
              : s,
          );
        }
        break;
      }
```

(`sequence-reorder` and `sequence-remove-song` only reorder/filter existing entries, so `songId` is preserved automatically — no change.)

- [ ] **Step 6: Run the full suite to verify pass + no regressions**

Run: `npx vitest run src/lib/sequencesMerge.test.ts` → all pass, including the pre-existing title/status/needsAttention-revert assertions.
Then `npx tsc --noEmit` → clean (proves no other consumer broke on the new required field).

- [ ] **Step 7: Commit**

```bash
git add src/lib/sequencesMerge.ts src/lib/sequencesMerge.test.ts
git commit -m "feat(offline): carry songId through mergeSequencesWithPending output"
```

---

### Task 2: Overlay pending edits on the program overview viewer

**Files:**
- Modify: `src/app/programs/local/program/page.tsx`
- Docs: `docs/manual-testing-checklist.md`

**Interfaces:**
- Consumes: `loadReferenceData()` → `ReferenceData`; `getQueuedActions()` from `@/lib/syncQueue` → `QueuedAction[]`; `buildSongTitleMap(songs, sharedSongs)` + `toProgramDetail(program, titles)` from `@/lib/offlineProgramView`; `mergeSequencesWithPending(detail, actions, titles)` from `@/lib/sequencesMerge` → `DisplaySequence[]` (each `{ id, title, status: 'active' | 'pending-create', songs: { sequenceSongId, songId, title }[] }`).
- Produces: nothing consumed by later tasks except the shared page shape Task 4 refreshes.

- [ ] **Step 1: Add the queue-snapshot state and imports**

At the top of `src/app/programs/local/program/page.tsx`, add imports:

```ts
import { getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { buildSongTitleMap, toProgramDetail } from '@/lib/offlineProgramView';
import { mergeSequencesWithPending } from '@/lib/sequencesMerge';
import type { DisplaySequence } from '@/lib/sequencesMerge';
```

Add a state field alongside the existing ones (near line 35-39):

```ts
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
```

- [ ] **Step 2: Load the queue snapshot in the mount effect**

Replace the mount effect (currently lines 41-48) so it also fetches the queue:

```ts
  useEffect(() => {
    Promise.all([loadReferenceData(), getSelectedProgramId(preferencesStore), getQueuedActions()])
      .then(([data, id, actions]) => {
        setReferenceData(data);
        setProgramId(id);
        setPendingActions(actions);
      })
      .finally(() => setChecked(true));
  }, []);
```

- [ ] **Step 3: Compute the overlaid sequences and render from them**

After the existing `program` lookup and null-guard (after line 95, before the `songsById` map), compute the overlay:

```ts
  const songTitles = buildSongTitleMap(referenceData.songs, referenceData.sharedSongs);
  const displaySequences: DisplaySequence[] = mergeSequencesWithPending(
    toProgramDetail(program, songTitles),
    pendingActions,
    songTitles,
  );
```

Then change the `pdfSequences` builder (currently lines 101-107) and the card grid (currently lines 123-149) to iterate `displaySequences` instead of `program.sequences` / `seq.songIds`:

```ts
  const pdfSequences = displaySequences.map((seq) => ({
    title: seq.title,
    songs: seq.songs.map((s) => s.title),
  }));
```

```tsx
        {displaySequences.map((seq) => {
          const isPending = seq.status === 'pending-create';
          const songs = seq.songs;
          const remaining = songs.length - PREVIEW_COUNT;
          return (
            <div key={seq.id} className="card flex h-72 flex-col bg-base-100 shadow">
              <div className="card-body flex flex-1 flex-col gap-2 overflow-hidden p-4">
                {isPending ? (
                  <span className="btn btn-outline btn-sm w-full shrink-0 no-animation pointer-events-none opacity-70">
                    {seq.title} (εκκρεμεί)
                  </span>
                ) : (
                  <button onClick={() => handleSelectSequence(seq)} className="btn btn-outline btn-sm w-full shrink-0">
                    {seq.title}
                  </button>
                )}
                <div className="flex-1 overflow-y-auto">
                  <ul className="flex flex-col gap-1 text-sm text-base-content/60">
                    {songs.slice(0, PREVIEW_COUNT).map((s) => (
                      <li key={s.sequenceSongId}>{s.title}</li>
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
        {displaySequences.length === 0 && (
          <p className="col-span-full p-3 text-center text-sm text-base-content/50">Καμία σειρά ακόμη</p>
        )}
```

Update `handleSelectSequence`'s parameter type (currently `OfflineSequence`) to `DisplaySequence` — it only reads `.id`:

```ts
  async function handleSelectSequence(sequence: DisplaySequence) {
    await setSelectedSequenceId(preferencesStore, sequence.id);
    router.push('/programs/local/sequence');
  }
```

Remove the now-unused `OfflineSequence` import and the `songsById`/`mergeReferencedSongs` block if nothing else uses them (the preview now reads titles straight off `displaySequences`). Keep the `SongRow`/`mergeReferencedSongs` imports only if still referenced.

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit` → clean.
Run: `npx eslint src/app/programs/local/program/page.tsx` → 0 errors.

- [ ] **Step 5: Add manual-testing rows**

Append to `docs/manual-testing-checklist.md` under a new heading:

```markdown
### Offline viewer pending-edit overlay — program view (added 2026-09-14)

- [ ] Offline (airplane mode), via Διαχείριση add an existing (cached) song to a σειρά, then open Σταθερά προγράμματα → that program: the new song shows in the σειρά preview immediately (before any sync)
- [ ] Offline reorder a σειρά's songs in Διαχείριση → the program preview shows the new order
- [ ] Offline remove a song → gone from the preview
- [ ] Offline rename a σειρά → new title shown in the program view
- [ ] Offline add a NEW σειρά → it appears in the program view marked "(εκκρεμεί)" and is NOT tappable
- [ ] A forced needsAttention reorder (version conflict) → the program view shows the last-known order, not the phantom change
- [ ] Εξαγωγή PDF from the overlaid program view includes the overlaid songs/σειρές (a pending-create σειρά appears as an empty section)
```

- [ ] **Step 6: Commit**

```bash
git add src/app/programs/local/program/page.tsx docs/manual-testing-checklist.md
git commit -m "feat(offline): overlay pending queue edits on the program viewer"
```

---

### Task 3: Overlay pending edits on the sequence viewer

**Files:**
- Modify: `src/app/programs/local/sequence/page.tsx`
- Docs: `docs/manual-testing-checklist.md`

**Interfaces:**
- Consumes: same overlay pipeline as Task 2, plus the existing `mergeReferencedSongs(...)` → `Map<number, SongRow>` (`songsById`) and `getSequenceSuggestions(referenceData, currentSongId, playedSet, activeAxisTypes)`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Add imports and queue state**

Add to `src/app/programs/local/sequence/page.tsx`:

```ts
import { getQueuedActions } from '@/lib/syncQueue';
import type { QueuedAction } from '@/lib/syncQueue';
import { buildSongTitleMap, toProgramDetail } from '@/lib/offlineProgramView';
import { mergeSequencesWithPending } from '@/lib/sequencesMerge';
```

Add state alongside the existing (near line 17-24):

```ts
  const [pendingActions, setPendingActions] = useState<QueuedAction[]>([]);
```

- [ ] **Step 2: Load the queue snapshot in the mount effect**

Extend the mount effect's `Promise.all` (lines 26-38) to include the queue:

```ts
  useEffect(() => {
    Promise.all([
      loadReferenceData(),
      getSelectedProgramId(preferencesStore),
      getSelectedSequenceId(preferencesStore),
      getQueuedActions(),
    ])
      .then(([data, pId, sId, actions]) => {
        setReferenceData(data);
        setProgramId(pId);
        setSequenceId(sId);
        setPendingActions(actions);
      })
      .finally(() => setChecked(true));
  }, []);
```

- [ ] **Step 3: Derive the sequence + songs from the overlay**

Replace the raw derivations (currently lines 40-47). `program` is still found from the blob (for title map inputs and suggestions `referenceData`); the sequence and its songs now come from the overlaid `DisplaySequence`:

```ts
  const program = referenceData?.programs.find((p) => p.id === programId) ?? null;
  const songTitles = program && referenceData
    ? buildSongTitleMap(referenceData.songs, referenceData.sharedSongs)
    : new Map<number, string>();
  const displaySequences = program && referenceData
    ? mergeSequencesWithPending(toProgramDetail(program, songTitles), pendingActions, songTitles)
    : [];
  const displaySequence = displaySequences.find((s) => s.id === sequenceId) ?? null;
  const songsById = new Map<number, SongRow>(
    mergeReferencedSongs(referenceData?.songs ?? [], referenceData?.sharedSongs ?? []).map((s) => [s.id, s]),
  );
  const songs = displaySequence
    ? displaySequence.songs.map((s) => songsById.get(s.songId)).filter((s): s is SongRow => s !== undefined)
    : [];
```

- [ ] **Step 4: Point the "sequence not found" guard and header at `displaySequence`**

The not-found guard (line 95) and the empty-songs header (line 108) currently reference `sequence`. Replace `sequence` with `displaySequence` throughout the render (the guard `!sequence` → `!displaySequence`; `sequence.title` → `displaySequence.title`).

- [ ] **Step 5: Feed the suggestions played-set from overlaid songIds**

The suggestions call (line 115) currently uses `new Set(sequence.songIds)`. Change it to derive from the overlaid songs:

```ts
  const suggestions = getSequenceSuggestions(
    referenceData,
    current.id,
    new Set(displaySequence.songs.map((s) => s.songId)),
    activeAxisTypes,
  );
```

(`displaySequence` is non-null here — this line runs only after the `songs.length === 0` early return, which already implies a resolved sequence with songs.)

- [ ] **Step 6: Verify types and lint**

Run: `npx tsc --noEmit` → clean.
Run: `npx eslint src/app/programs/local/sequence/page.tsx` → 0 errors.

- [ ] **Step 7: Add manual-testing rows**

Append to `docs/manual-testing-checklist.md`:

```markdown
### Offline viewer pending-edit overlay — sequence (lyrics) view (added 2026-09-14)

- [ ] Offline, add an existing song to a σειρά via Διαχείριση → open that σειρά in the viewer: the added song appears at the correct position and its lyrics/keys load
- [ ] Offline reorder → the lyrics viewer's song order and "Λίστα σειράς" match the new order
- [ ] Offline remove a song → it's gone from the lyrics viewer and its list
- [ ] Suggestions ("επόμενο τραγούδι") treat the overlaid songs as already-played (no already-in-σειρά song suggested)
- [ ] A σειρά whose only added song was itself created offline (draft song, no cached lyrics) → that song is skipped in the lyrics viewer (documented out-of-scope), no crash
```

- [ ] **Step 8: Commit**

```bash
git add src/app/programs/local/sequence/page.tsx docs/manual-testing-checklist.md
git commit -m "feat(offline): overlay pending queue edits on the sequence viewer"
```

---

### Task 4: Focus-refresh the program overview after a sync (post-sync staleness fix)

**Why (beyond the spec):** The spec is mount-only. That leaves the exact case the user hit — an offline edit *syncs* while they are looking at the program view, and the view keeps showing the pre-sync snapshot until they manually run "Προετοιμασία για offline." A `visibilitychange` re-read on foreground closes this. Scope it to the **program overview only**: it has no fragile in-view state, whereas the sequence viewer holds live `index`/exploration state a refresh would disrupt (the very disruption the spec's mount-only decision avoids). The sequence viewer stays mount-only.

**Files:**
- Modify: `src/app/programs/local/program/page.tsx`
- Docs: `docs/manual-testing-checklist.md`

**Interfaces:**
- Consumes: the Task 2 load logic.
- Produces: nothing.

- [ ] **Step 1: Extract the load into a reusable callback that does not flash the spinner**

In `src/app/programs/local/program/page.tsx`, add `useCallback` to the React import, and replace the Task 2 mount effect with a callback + effect. The callback updates data in place and never sets `checked` back to `false`, so a foreground refresh does not blank the page to a spinner:

```ts
  const load = useCallback(async () => {
    const [data, id, actions] = await Promise.all([
      loadReferenceData(),
      getSelectedProgramId(preferencesStore),
      getQueuedActions(),
    ]);
    setReferenceData(data);
    setProgramId(id);
    setPendingActions(actions);
    setChecked(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Post-sync freshness: the overlay is computed at read time, but if the queue drains and
    // the blob re-primes (SyncQueueProvider, on reconnect) while this page is open, the page
    // keeps showing the read-time snapshot. Re-read whenever the app returns to the foreground
    // so a just-synced change appears without a manual "Προετοιμασία για offline". Scoped to
    // this overview only — the sequence viewer holds live index/exploration state a refresh
    // would reset, so it stays mount-only per the spec.
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);
```

- [ ] **Step 2: Verify types and lint**

Run: `npx tsc --noEmit` → clean.
Run: `npx eslint src/app/programs/local/program/page.tsx` → 0 errors (the `set-state-in-effect` disable comment mirrors the existing pattern in `admin/programs/page.tsx` and `SyncQueueProvider.tsx`).

- [ ] **Step 3: Add manual-testing rows**

Append to `docs/manual-testing-checklist.md`:

```markdown
### Offline viewer — post-sync auto-refresh (added 2026-09-14)

- [ ] Make an offline edit via Διαχείριση, open the program view (shows it overlaid), then reconnect and background the app briefly; returning to the foreground on the program view shows the SERVER-reconciled state with NO manual "Προετοιμασία για offline"
- [ ] Backgrounding and foregrounding the program view does NOT flash a loading spinner (data updates in place)
- [ ] The sequence (lyrics) viewer is unaffected by foreground/background — your current song position is preserved (it stays mount-only by design)
```

- [ ] **Step 4: Build the native bundle to confirm it stages/exports cleanly**

Run: `npm run build:mobile`
Expected: `BUILD SUCCESSFUL`, `out/` regenerated, no stripped-path failure. (This is the only step that exercises the static export of the two changed native pages.)

- [ ] **Step 5: Commit**

```bash
git add src/app/programs/local/program/page.tsx docs/manual-testing-checklist.md
git commit -m "feat(offline): refresh the program viewer on foreground to show synced edits"
```

---

## Self-Review

**1. Spec coverage:**
- §3 (carry `songId`) → Task 1. ✓
- §4 (program viewer overlay, pending-create non-navigable, PDF from overlay) → Task 2. ✓
- §5 (sequence viewer overlay, songs from `songId`, suggestions played-set) → Task 3. ✓
- §6 unit tests (songId on base / add-song / survives reorder) → Task 1 Step 1. ✓
- §6 manual rows → Tasks 2, 3, 4 Step "Add manual-testing rows". ✓
- §5 fallback safety (draft/empty sequence → existing empty screen) → inherited by Task 3 Step 4 (`!displaySequence` guard) + the `songs.length === 0` screen; covered by a Task 3 manual row. ✓
- Focus-refresh (added scope beyond spec, user-requested) → Task 4, explicitly flagged. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows the actual edit. ✓

**3. Type consistency:** `DisplaySequenceSong` gains `songId: number` in Task 1 and is read as `s.songId` in Tasks 2/3; `handleSelectSequence(sequence: DisplaySequence)` reads `.id`; `mergeSequencesWithPending(detail, actions, titles)` signature unchanged across all tasks; `buildSongTitleMap`/`toProgramDetail` names match `src/lib/offlineProgramView.ts`. ✓

---

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in-session with checkpoints via executing-plans.
