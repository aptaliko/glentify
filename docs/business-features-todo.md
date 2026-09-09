# Business Features — "Top of its Kind" Roadmap

Strategic feature ideas to make Glentify the definitive tool for live Greek γλέντι
performance. Ordered by defensibility, not effort. Checkboxes track intent, not
committed work — see per-feature specs in `docs/superpowers/specs/` once scoped.

## 1. Suggestion engine — the crown jewel (defensible IP)
- [ ] Learn from actual play: record picked vs. skipped suggestions, per performer / venue / crowd, feed back into ranking
- [ ] Energy-arc awareness: suggest the right *next move* for where the night is (build / peak / καθιστικά ↔ χορευτικά / cool-down), not just similar songs
- [ ] Request handling: instant lookup for a guest request + graceful re-entry paths back into the flow

## 2. Own the content — the data moat
**Decision (2026-09-08):** the shared baseline is **taxonomy only** (ρυθμοί / περιοχές /
δρόμοι / composers / genres — admin-curated, `ownerId NULL`). **No shared song catalog** —
songs stay fully user-owned, and each user classifies freely (a song using two δρόμοι can be
linked to one by user A and the other by user B, since they're separate song rows). No admin
song-review burden.

- [ ] Taxonomy baseline: definitive, admin-curated ρυθμοί / περιοχές / δρόμοι / composers / genres (**first focus**)
- [x] Auto-fill on create: when a user adds a song that matches a known one (admin's reference set), propose prefilling classification (and lyrics) — shares knowledge without shared ownership or review. **Shipped** — `src/app/admin/songs/new/page.tsx` + `/api/songs/suggestions` (source scoped to admin-owned songs, axis values filtered to the requester's visibility, source ids stripped from the payload)
- [ ] Lyrics per song, performance-formatted (large, scrollable, dark-stage-readable) — model is already "user-entered, we host". Current: single centered `<pre>` fixed at `text-xl sm:text-2xl` in `LyricsCard` (`src/components/LiveSessionView.tsx:51`). Proposed **performance reader**, tiered:
  - **Tier 1 (ship first, one pass):**
    - [x] Adjustable text size, persisted per device (localStorage)
    - [x] Keep-awake / screen wake lock via the Screen Wake Lock API — confirmed working on both web and the Android WebView (Pixel 6 on-device spike, 2026-09-09; no native plugin needed)
    - [x] Hands-free advance via **tap zones** (bottom = page down, top = page up)
  - **Tier 2 (readability polish):**
    - [ ] Left-align verses + respect blank-line stanza breaks (drop center-align for long text)
    - [ ] Dedicated high-contrast stage mode (max contrast, overrides for lyrics view only)
    - [ ] Pinch-zoom + pan for the παρτιτούρα image (currently `max-h-[70vh] object-contain`, unreadable for dense scores)
  - **Explicitly skipped:** karaoke line-highlight / timed beat-scroll — no per-song timing/structure metadata, authoring friction not worth it
- [ ] Chords / δρόμος annotations per song
- [ ] Lyrics compliance scaffolding (see `docs/legal-compliance-prep.md`): DMCA/takedown contact + mechanism, ToS "you have the rights" affirmation, UGC reporting — needed before public Play release, lawyer-reviewed

## 3. Multiplayer band (leverage existing collaborators)
- [ ] Live-synced stage view: bandleader drives, band sees current + upcoming on their own devices in real time
- [ ] Shared band library with role-based edits (one κομπανία repertoire)

## 4. Gig data musicians want back
- [ ] Post-gig recap: actual σειρά played, durations, request hits
- [ ] Reusable programs per venue / occasion (γάμος, πανηγύρι, βάφτιση) — templated starts

## 5. Distribution & business model
- [ ] Freemium split: free = play + baseline library; paid = learning engine, band sync, unlimited programs, full offline
- [ ] Greek-first, then diaspora (US / Australia / Germany) — same engine, larger market

---
**Priority call:** #1 (energy-arc + learning) and #2 (verified library) are what make it
top-of-kind. #1 is the defensible IP; #2 is the data moat. Invest there first.
