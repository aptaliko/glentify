# Save a Live Session as a Program — Design Spec

## Problem

Ending a live session (`Λήξη session`, `src/components/LiveSessionView.tsx`) throws away the setlist. `sessionPlayedSongs` rows persist in the database, but nothing ever reads them back — there's no way to turn a γλέντι that just happened into a reusable `Σταθερό Πρόγραμμα`. Every setlist a musician improvises on stage is lost the moment the session ends, even though the closest analogous structure (`programs` → `programSequences` → `sequenceSongs`) already exists and is fully built out (creation, editing, collaborators).

Separately, "Ξεκίνα γλέντι" (the button that starts this flow) reads oddly once ending a session leads somewhere new — George asked to rename it to "Ξεκίνα Live" while this area is being touched.

## Goal

When George ends a **remote (web)** session, he's offered the chance to save what was just played as a program, preserving the internal structure of the night: each `Τέλος σειράς` press during the session becomes its own σειρά (sequence) in the saved program, not one flat list. He can save it as a brand-new Σταθερό Πρόγραμμα, append it as new sequences onto an existing one (his own or one he collaborates on), or skip saving entirely.

**Native (local, on-device) sessions are explicitly out of scope for this feature.** They have no server-side session row — saving would need connectivity at the moment of saving anyway (creating a program is a database write), and George plays live from a tablet where connectivity on stage is exactly when it can't be relied on. This is deferred to the still-unbuilt offline-write-with-sync-back roadmap item; native's "Λήξη session" keeps its current behavior unchanged (straight back to `/`, no prompt).

## Non-goals

- Anything involving native/local sessions (`LocalSessionStore`, `src/app/session/local/page.tsx`).
- Any offline queueing or sync-back for this save action.
- Changing what "Λήξη session" itself does to the session's lifecycle (it still ends the session, marks the current song played, sets `endedAt`) — the save step is purely additive, downstream of that.
- A general-purpose "convert any arbitrary song list to a program" tool — this is specifically about the session that was just played.

## Data model

Two new non-nullable integer columns, both defaulting to `0` so existing rows need no backfill:

- `sessions.current_sequence_index` — how many times `Τέλος σειράς` has been pressed so far in this session. Starts at 0, increments by 1 each time `endSequence` runs.
- `session_played_songs.sequence_index` — copied from the owning session's `current_sequence_index` at the moment a play is recorded. Groups played songs into the σειρές they logically belonged to on stage.

This only touches `queries/sessions.ts`, the three functions that already call `markCurrentAsPlayedIfAny`:

- `advanceToSong` and `endSession` — pass the session's *current* `currentSequenceIndex` through to the insert, unchanged otherwise.
- `endSequence` — same, but **after** marking the current song played, increments `sessions.currentSequenceIndex` by 1 so the next song picked starts a new group.

No changes to `sessionPlayedSongs`' existing columns, to `programs`/`programSequences`/`sequenceSongs`, or to the native session store.

## API

### `GET /api/sessions/[id]/played-grouped`

Returns the session's played songs grouped by `sequence_index`, ordered by group then by `playedAt` within a group, with empty groups (e.g. two `Τέλος σειράς` presses back to back with no song picked in between) filtered out:

```ts
{ sequences: Array<{ songIds: number[] }> }
```

Owner-scoped the same way every other `/api/sessions/[id]/*` route is (via `getSessionById(ownerId, id)`). Used to populate the save screen — song titles/details for rendering come from the client's already-loaded song list, same as everywhere else in this app; the endpoint only needs to return IDs.

### `POST /api/sessions/[id]/save-as-program`

Body:

```ts
{ destination: 'new'; title: string; sequenceTitles: string[] }
| { destination: 'existing'; programId: number; sequenceTitles: string[] }
```

`sequenceTitles` must have the same length as the grouped sequences the server independently derives from `session_played_songs` (source of truth — the client never sends song IDs here, only the titles it let the user edit). Behavior:

1. Re-derive the grouped, non-empty sequences server-side (same query the GET endpoint uses).
2. 400 if there are zero non-empty sequences, or if `sequenceTitles.length` doesn't match.
3. `destination: 'new'` → `createProgram(ownerId, title)`, then for each group `createSequence(programId, sequenceTitles[i])` + `addSongToSequence` for each song in order.
4. `destination: 'existing'` → verify access via `getProgramAccess(userId, programId)` is `'creator'` or `'collaborator'` (403 otherwise — same rule `listAccessiblePrograms` already encodes), then same sequence/song creation appended after the program's existing sequences (next `position` values continue from `listSequencesForProgram`'s current max).
5. Returns the new/updated `programId` so the client can offer a "δες το πρόγραμμα" link, though navigating there isn't required — landing back on `/` after saving is enough for v1.

No change to `POST /api/sessions/[id]/end` — it keeps doing exactly what it does today.

## UI flow

`LiveSessionView`'s `handleEndSession` currently does `await store.endSession(); onEnded();`. This splits by store type:

- **`LocalSessionStore` (native):** unchanged — `store.endSession()` then `onEnded()` straight to `/`.
- **`RemoteSessionStore` (web):** `store.endSession()` still runs immediately (ending the session is not gated on the save decision), but instead of calling `onEnded()` next, the view navigates to a new screen/route, `session/[id]/save`, passing the session id.

`LiveSessionView` needs a way to know which store type it has (e.g. `SessionStore` gains a `readonly kind: 'remote' | 'local'` field, or the check happens one level up in the two page components rather than inside `LiveSessionView` itself — the exact placement is an implementation-plan-level decision, not a design one; either way, no behavior changes for native).

### `src/app/session/[id]/save/page.tsx` (new, web-only — not part of the mobile build, same treatment as `programs/[id]`)

On load: `GET /api/sessions/[id]/played-grouped`, cross-referenced against the already-available song list to render each sequence with its songs' titles. If the response has zero sequences (edge case: session ended with nothing ever played), skip this screen entirely and redirect straight to `/` — same as if the user had chosen "Παράλειψη".

Otherwise, shows:

- One text input per sequence, prefilled:
  - Destination "new": `Σειρά 1`, `Σειρά 2`, …
  - Destination "existing": `{ημερομηνία} — Σειρά 1`, … (date = today, `dd/MM/yyyy` to match existing date formatting conventions in the app) — distinguishes sequences once mixed into a program that accumulates sequences across many nights.
- Three top-level actions:
  - **Νέο Σταθερό Πρόγραμμα** — reveals a title input, prefilled `Γλέντι {ημερομηνία}`, editable. Confirm → `POST .../save-as-program` with `destination: 'new'`.
  - **Πρόσθεση σε υπάρχον πρόγραμμα** — reveals a `<select>` populated from `GET /api/programs` (already returns everything `listAccessiblePrograms` includes — own + collaborated). Confirm → `POST .../save-as-program` with `destination: 'existing'`.
  - **Παράλειψη** — no request, straight to `/`.
- On success (either save path): navigate to `/`.
- On request failure: show an inline error, let the user retry or still choose Παράλειψη — the session itself is already ended regardless, so there's no data-loss risk in leaving this screen without saving (the played rows stay in `session_played_songs` even if the user never returns to try saving).

## Rename

"Ξεκίνα γλέντι" → "Ξεκίνα Live" in the two places it appears as visible text:

- `src/app/page.tsx:121` (home page button)
- `src/app/session/new/page.tsx:70` (heading on the first-song picker)

Visible copy only — no route, component, table, or variable named `glenti`/`session` changes. "Λήξη session" is untouched (not part of what George asked to rename). The "Έχεις ενεργό τοπικό γλέντι." status line on the home page also stays as-is — it describes a native/local session, which this feature doesn't touch.

## Out of scope

- Native/local sessions, as covered above.
- Editing a saved program's sequences from the save screen itself beyond the title fields (once saved, use the existing admin/program-edit UI for anything further).
- Any change to how "Λήξη session" behaves for sessions that get implicitly ended by starting a new one (`endAllActiveSessionsForOwner` in `createSession`) — those still end with no save opportunity, matching today's behavior. Only the explicit "Λήξη session" button triggers the new flow.
- Deleting/archiving old sessions after they're saved — `sessions` and `sessionPlayedSongs` rows are left alone either way, saved or not.

## Testing

Following this project's convention (Vitest coverage for `src/lib/*` and `src/db/queries/*`, TDD for new logic):

- `queries/sessions.ts`: unit tests that `advanceToSong`/`endSequence`/`endSession` write the correct `sequence_index`, and that multiple `endSequence` calls produce correctly incrementing groups. Extend the existing `endSession` clears-state coverage to confirm sequence data survives (it's not part of what gets cleared — only the native `sessionStore.test.ts` suite tests clearing, and that's untouched here since it covers `LocalSessionStore`).
- New `queries/sessions.ts` grouping function: unit tests for the empty-group-filtering behavior specifically (the two-`endSequence`-in-a-row case).
- `POST /api/sessions/[id]/save-as-program`: route tests for both destinations, the 403-on-no-access case for `existing`, and the length-mismatch/zero-sequences 400 cases.
- No test for the rename (copy-only change, covered by `npx tsc --noEmit` + a visual check).
- UI flow itself (`session/[id]/save/page.tsx`) verified manually per this project's usual pattern for page-level work — no browser tool is assumed available; if none is, this is flagged the same way past mobile-only verification gaps have been (an explicit, named manual-check step in the implementation plan).
