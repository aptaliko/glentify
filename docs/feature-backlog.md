# Feature Backlog

Ideas and known gaps for **work not yet built** — no code exists for any item here. This is
distinct from `docs/manual-testing-checklist.md`, which tracks manual verification of work
that's already shipped. If an item here gets picked up, it goes through this project's normal
cycle (`docs/superpowers/specs/` design spec → `docs/superpowers/plans/` implementation plan)
and moves out of this file once shipped.

---

## Offline image upload for songs (#5 Phase 2 remainder)

Attaching a newly-picked image to a song while native and offline. Explicitly deferred at
spec time (`docs/superpowers/specs/2026-09-01-offline-song-crud-phase1-design.md` §Non-goals):
today the file-picker input is disabled whenever running natively (online or offline) — an
existing image still displays read-only. Needs a draftId→realId coordination mechanism for
the uploaded blob, similar in shape to the one `src/lib/draftIds.ts` already provides for
offline-created taxonomy values/songs/sequences. Originally bundled with offline "+ Νέα τιμή"
taxonomy-value creation as one "Phase 2" — that half already shipped separately
(`bb4eb5b`, 2026-09-02), so this is now the only piece left. Not yet brainstormed/spec'd.

## Collaborator write-conflict resolution

The offline write model is last-write-wins with no conflict detection: song and shared
program/sequence writes apply unconditionally (scoped by ownership/access); `updatedAt` is
stored but never used as a version guard, and there is no `If-Match` / 409-on-stale. If a user
and a collaborator both edit the same shared program sequence offline, whichever queue drains
last silently wins. This is a pre-existing property of the offline write model, called out as a
Non-goal of the offline-cache priming unification
(`docs/superpowers/specs/2026-09-02-unify-offline-cache-priming-design.md`). Real resolution
needs version columns + `If-Match` on the shared program/sequence endpoints + a merge/warn UX.
Only programs and their sequences are a shared-edit surface (songs/taxonomy are owner-scoped).
Not yet brainstormed/spec'd.

## Multi-value axis metadata per song

From the original MVP spec's explicit "future phase" list
(`docs/superpowers/specs/2026-07-26-panigyri-setlist-app-design.md`, Εκτός εμβέλειας:
"Multi-value μεταδεδομένα ανά τραγούδι, π.χ. πάνω από μία περιοχή"). Still genuinely open —
confirmed against current code: `song_axis_values` has `UNIQUE(songId, axisType)`
(`src/db/schema.ts`), so a song can carry at most one value per axis today (e.g. exactly one
Region). Everything else on that same original list has since shipped: offline-first,
multi-user, σειρές as a modeled entity, and Σταθερά Προγράμματα. Not yet brainstormed/spec'd,
and no evidence this has come up as a real want since the original spec — worth confirming
it's still wanted before investing in it.

## iOS build

Parked — blocked on an Xcode install (`android/` scaffolding exists and ships today;
`ios/` was explicitly deferred at Capacitor-scaffolding time,
`docs/superpowers/plans/2026-08-01-mobile-offline-capacitor.md`, "iOS deferred — toolchain not
available on this machine"). Not a design gap, purely an environment blocker — revisit once
Xcode is available on a build machine.

---

## Related but out of scope for this file

- **`docs/legal-compliance-prep.md`** — Play Store legal/compliance prep (Privacy Policy,
  ToS, content-reporting mechanism). Real open work, but policy/legal documents, not app
  features — kept as its own separate list rather than folded in here.
