# Manual On-Device Testing Checklist

Every item below is a real feature that's already implemented, reviewed, and (as of
2026-08-31) pushed to `origin/main` / live in production — but has never been exercised on
an actual Android device or emulator. Automated tests, typecheck, lint, and both builds all
pass; none of that proves the on-device behavior these checklists cover.

Work through the sections in order — later ones assume earlier ones are done, since several
features build on data the earlier steps create. Check items off as you go. If something
fails, note the exact behavior (screenshot if possible) rather than just "broken" — most of
these features have several intentional states (pending/synced/needs-attention) that look
similar but mean different things.

**Setup once, before starting:** build and install the current `main` on your device —

```bash
npm run build:mobile
```

— then open the resulting `android/` project in Android Studio and install to your device
or emulator. Log in with a real test account. Airplane mode is the mechanism every "offline"
step below uses — toggle it from the device's quick-settings, not a Wi-Fi-only switch (some
devices still route through mobile data if you only disable Wi-Fi).

---

## 1. Android Admin Tool — full walkthrough

The base thin-client admin tool has never had a full on-device pass. Do this section first;
several later sections (programs, collaborators) need programs/songs that only exist once
this section's data is created.

- [χ] **Home → Διαχείριση.** Tap it from the home screen. Confirm it lands on the songs list
      with the admin navbar visible (Τραγούδια, Προγράμματα, Περιοχές, Ρυθμοί, Δρόμοι,
      Συνθέτες, Είδη, Αρχική).
- [χ] **Taxonomy sections (×5).** For each of Περιοχές, Ρυθμοί, Δρόμοι, Συνθέτες, Είδη:
      create one entry, confirm it appears in the list, delete it, confirm it's gone.
- [χ] **Songs — create with image upload.** Create a new song with an image upload (the
      full flow — this exercises both the native file picker, the first this app has ever
      shipped to a device, and the cross-origin PUT to Vercel Blob storage, neither of
      which has ever actually run on a device). Add at least one axis value. Confirm the
      upload succeeds and the image shows.
- [χ] **Songs — edit and delete.** From the list, open the song you just created — confirm
      it lands on `admin/local/songs/edit` with data pre-filled. Change the title, save,
      confirm the list reflects it. Delete it, confirm it's gone.
- [χ] **Programs — create, sequences, songs.** Create a new program. Open it — confirm it
      lands on `admin/local/programs/edit`. Add a sequence, search for and add a song to
      it, reorder it, remove it. Rename the sequence, delete it. **Keep this program** — later
      sections (collaborators, offline program CRUD) reuse it.
- [χ] **Programs — collaborators ("Συνεργάτες").** Add a collaborator by email, confirm they
      appear in the list. If a second test account is available, log in as it and confirm
      the program is visible and editable there too. Remove the collaborator, confirm.
- [χ] **Expired-token handling.** Manually expire or clear the native session token (or wait
      out the 30-day expiry if that's ever practical) and confirm hitting any admin page
      redirects to `/login` instead of blank-screen-crashing.
- [χ] **Back button / Preferences persistence.** On `admin/local/songs/edit` and
      `admin/local/programs/edit`, use the Android back button and confirm it behaves
      sanely (doesn't strand you or lose the selected item). Background the app and return
      — confirm state survives as expected.
- [χ] **Confirm web is unaffected.** In a regular browser, visit `/admin/songs`,
      `/admin/programs`, and one taxonomy page. Confirm every create/edit/delete flow still
      works exactly as before — the dynamic routes (`admin/songs/[id]`,
      `admin/programs/[id]`) are untouched for web.

---

## 2. Save a live session as a program (web)

This is a **web** test — no device needed, just a browser and the real dev/prod database.

- [χ] Start a session (Ξεκίνα Live), play at least one song, press **Τέλος σειράς**, play at
      least one more song, press **Τέλος σειράς** again, then end the session.
- [χ] On the save screen, confirm there are **two separate σειρές** shown (one per
      Τέλος σειράς press), each with the correct songs.
- [χ] Save as a **new** program — confirm it's created with both sequences intact.
- [χ] Repeat the session flow, this time save into an **existing** program — confirm the new
      sequences are appended without disturbing the program's existing sequences.

---

## 3. Offline sync foundation + native session-save

- [χ] Put the device in **airplane mode**. Start a local (native) session, play at least two
      songs across two **Τέλος σειράς** presses, end the session.
- [χ] On the save screen, confirm it renders the correct σειρές entirely from cache (watch
      for any network-loading spinner — there should be none).
- [χ] Save it. Confirm the sync badge shows **"1 εκκρεμεί συγχρονισμός"**.
- [χ] Re-enable connectivity. Confirm the badge disappears automatically within moments (no
      manual action needed), and that the resulting program/sequences are correct via the
      admin UI (either web or the admin tool from Section 1).

---

## 4. PDF export

### 4a. Web export

- [χ] Web: export a program's PDF from a regular browser, confirm it downloads correctly
      with correct Greek text.

### 4b. Native export (correction, 2026-09-01: this is ONE code path, not two)

This section originally split "native online" from "native offline (airplane mode)" as if
they were different code paths — they aren't. The offline PDF export sub-project fully
*replaced* the old server-fetch approach; native export is identical regardless of
connectivity, always generated entirely on-device.

**First attempt (χ, 2026-09-01) failed** with "Η εξαγωγή απέτυχε" — root-caused live via
`adb logcat`: pdfkit's browser bundle doesn't auto-register standard fonts the way the web
export's Node build does, so `PDFDocument`'s constructor threw immediately trying to default
to "Helvetica". **Fixed in commit `e734015`** (`font: null` to skip pdfkit's eager default).
Verified via the same logcat method (clean run, successful share-sheet completion, no error)
but not yet visually confirmed on-screen — re-check the actual PDF content below.

- [ ] Open a program's local page. Tap **"Εξαγωγή PDF."** Confirm the share sheet opens with
      the correct file and **Greek glyphs render correctly** (font embedding via the bundled
      DejaVu Sans TTFs happening entirely on-device was the specific, now-fixed risk here).
- [ ] Repeat in **airplane mode** (on a program you've already viewed once online, so it's
      cached). Confirm **no network activity and no delay** waiting on a timed-out request —
      should behave identically to the online case above.

---

## 5. Offline collaborator invites

Use the program from Section 1 (or any program you own).

- [ ] Open the program's edit page **while online** — this populates the collaborator
      cache.
- [ ] Enable **airplane mode**, reload the page. Confirm the cached collaborator list still
      renders, with the offline note visible.
- [ ] While still offline, add a collaborator by email. Confirm it appears **tagged
      pending** and is queued (check the sync badge).
- [ ] Disable airplane mode. Confirm it syncs and the pending tag clears — then, **don't
      stop there**: confirm the added person now shows as a **normal active row**, not just
      that the pending tag vanished.
- [ ] Repeat for **remove**: queue a removal offline, go online, confirm it syncs — then
      explicitly confirm the removed person does **NOT reappear** in the list afterward
      (this was a real bug shape caught during review; the "tag cleared" signal alone isn't
      proof it actually removed them).
- [ ] Queue a deliberately-bad add offline (a nonexistent email) and confirm it eventually
      surfaces via the app-wide **needsAttention** badge once synced, rather than silently
      vanishing or silently succeeding.

---

## 6. Offline program-list CRUD (create/rename/delete a whole program)

This is the newest feature (shipped 2026-08-31) and the one place a real, user-visible bug
was caught and fixed during its final review — so this section matters most.

- [ ] **Native + online — the regression check.** With the device online, go to
      Διαχείριση → Προγράμματα. Create a new program. Confirm it appears in the list
      **immediately**, with a real id (tappable/navigable), not stuck as a greyed-out
      pending row.
- [ ] **Double-tap check.** Type a title and tap "Προσθήκη" **twice quickly**. Confirm this
      creates **exactly one** program, not two. (This is the exact bug the final review
      caught: online, the queue used to drain silently with no visible feedback, inviting a
      second tap that created a duplicate. Confirm the fix holds.)
- [ ] Still online: rename a program, confirm the new title appears immediately. Delete a
      program, confirm it disappears immediately. Neither should require a manual refresh.
- [ ] **Offline path.** Enable airplane mode. Create a program — confirm it shows as a
      **non-clickable, greyed-out pending row** with the "Θα είναι διαθέσιμο μόλις
      συγχρονιστεί" note. Go back online, confirm it becomes a normal, navigable row with a
      real id.
- [ ] **Offline rename/delete.** While offline, rename an existing program — confirm it
      shows the new title with a "will rename once synced" note. Delete a different existing
      program — confirm it disappears immediately (optimistic hide). Go online, confirm
      both applied correctly server-side (the renamed one keeps its new title; the deleted
      one stays gone).
- [ ] **Conflict case.** Delete the same program from two places (e.g. delete it via the web
      admin UI, then also queue a delete for it offline on the device) so the device's
      queued delete hits an already-deleted program once it syncs. Confirm this resolves
      cleanly (the program just disappears/stays gone) rather than getting stuck showing a
      "needs attention" error.

---

## 7. Related-song suggestions on fixed program playback

New (2026-08-31), not yet exercised on a device or in a real browser. Covers both platforms —
`programs/[id]/sequences/[seqId]` (web) and `programs/local/sequence` (native).

- [ ] **Sidebar renders.** Open any sequence with at least one song. Confirm a "Προτάσεις" card
      appears next to "Λίστα σειράς" (not replacing it), showing songs sharing characteristics
      with the currently-displayed song — with toggle chips for each characteristic
      (Περιοχή/Είδος/etc.), same as Ξεκίνα Live.
- [ ] **No overlap with the sequence's own list.** Confirm no song already in "Λίστα σειράς"
      ever appears in "Προτάσεις", even when toggling chips.
- [ ] **Sidebar updates on navigation.** Page through the sequence with ← Προηγούμενο /
      Επόμενο → (or tap a row in "Λίστα σειράς") and confirm "Προτάσεις" recomputes for the new
      current song each time, with axis toggles reset to their defaults.
- [ ] **Enter exploration mode.** Tap a suggestion. Confirm the page switches to a full
      Live-style view (lyrics + suggestions + axis toggles + Δείξε τα ειπωμένα + Τέλος σειράς)
      seeded at that song.
- [ ] **Drill through suggestions.** From exploration mode, tap another suggestion — confirm it
      moves deeper (new current song, previous one now dims as "ειπωμένο" if Δείξε τα ειπωμένα
      is on).
- [ ] **Τέλος σειράς inside exploration.** Tap it, confirm it opens the song picker (search
      across the whole library) rather than getting stuck — pick any song and confirm
      exploration continues from there.
- [ ] **Exit via the red button.** Tap "Πίσω στο πρόγραμμα" — confirm you land back on the
      standard program view, at the exact sequence position you left (same song, same index),
      with "Λίστα σειράς" unchanged.
- [ ] **Exit via the back arrow, including from the song-picker screen.** From exploration mode
      (both the normal view and the "Τέλος σειράς → pick a song" screen), tap the header's
      "← Πίσω" arrow. Confirm it also returns you to the standard program view — this was a
      real bug caught in review (a same-URL Link that did nothing, stranding you on the picker
      screen with no way out) and must actually work, not just look present.
- [ ] **Shared program edge case (if you have a second test account/collaborator).** Open a
      sequence from a program you're a *collaborator* on, not the owner, where the current song
      belongs to the other user. Confirm "Προτάσεις" shows "Καμία πρόταση"/"Κανένα τραγούδι"
      gracefully instead of erroring — you have no visibility into another user's song
      characteristics by design.

---

## Cross-cutting notes

- **Sync badge states** appear bottom-right whenever anything is queued: a plain count
  ("N εκκρεμεί συγχρονισμός"), a red "needs attention" count if something failed
  permanently (3 retries), or "Ο συγχρονισμός σταμάτησε προσωρινά" if a systemic error
  (like a 5xx) paused syncing. If you ever see "needs attention" during any test above that
  the checklist didn't expect, that's a real finding — note exactly what you did right
  before it appeared.
- **No per-item queue management UI exists yet** — you cannot view, retry, or cancel a
  stuck queued action from the app itself. If something gets stuck, the only recovery today
  is fixing the underlying condition (e.g. reconnecting, or the target existing again) and
  waiting for the next sync attempt.
- **Clean up test data** when you're done — delete any test songs/programs/taxonomy entries
  created during this pass, on whichever account(s) you used.
