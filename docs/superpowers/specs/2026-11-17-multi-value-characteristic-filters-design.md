# Multi-value characteristic filters for the suggestions list

Date: 2026-11-17
Status: draft, pending approval

## Intent and why

During a live gig the suggestions list answers "what can I play next that fits this song?" Today the filter controls don't match what the list does:

- Each characteristic (Περιοχή, Ρυθμός, Δρόμος, …) is a single chip that is either on or off, holding only the current song's value.
- Region matching is hierarchical (same region, parent, child, and, since commit `79d94bd`, siblings), but the chip still reads "Περιοχή: Νάξος". Songs from other regions appear with no visible reason.
- Turning a chip off doesn't remove songs. It only lowers their rank, and nothing on screen says so.
- The user cannot pick a different value (say, Ρυθμός 9/8) to filter by, and cannot keep several values on one characteristic.

The goal is that every shown filter is a real filter, the list is exactly the set of songs that match the shown filters, and the user can choose any value on any characteristic.

## Goals

1. A characteristic with at least one selected value is shown as a column: its selected values as chips, with a dropdown below listing that characteristic's options. Characteristics without a value are not shown as columns; they are reachable only through a single "add characteristic" dropdown (see Screen).
2. A column can hold several values. A song matches a column if it has at least one of the column's values.
3. A song must match every column that has at least one value.
4. Removing the last chip in a column turns that characteristic off: it no longer restricts the list.
5. A multi-level-area song (Απειρανθος < Νάξος < Αιγαίο) starts with all three region values selected.
6. Choosing a new current song resets every column to that song's values.
7. The region column matches exactly the values it holds. There is no implicit parent, child, or sibling matching.

## Non-goals

- Changing the song picker's region filter (`src/lib/songPickerData.ts`). It has its own rules and stays as it is.
- Changing how songs are classified or how the axis tables are seeded.
- Adding new characteristics.
- Changing the "Δείξε τα ειπωμένα" (show played) toggle.

## Anti-goals

- A chip whose label doesn't say exactly what it filters by.
- A list that includes songs for reasons the screen doesn't show.
- Any hierarchy-based match that the user can't see or switch off.

## Constraints

- The same filter logic has to run in two places: the server route `src/app/api/sessions/[id]/suggestions/route.ts` for web, and the in-memory/offline path in `src/lib/sessionStore.ts` for native. Both go through `buildSuggestionsResponse` in `src/lib/suggestions.ts`, so the logic must live there.
- The native app follows the new design too: the offline path in `sessionStore.ts`, the native screens, and the native sync/cache code use the same filter state and the same column UI as web. No compatibility with the old `activeAxisTypes` behaviour is kept.
- The sequence view (`src/app/programs/[id]/sequences/[seqId]/page.tsx`, `src/app/programs/local/sequence/page.tsx`, `SequenceSuggestionsCard`) shares this engine and this UI pattern, so it gets the same change.
- The region axis is seeded as `hierarchical: true` (`scripts/seed-axis-types.ts`), so the region dropdown lists every region in the catalogue, not only the song's chain.

## Approaches considered

**A. Keep single on/off chips, fix labels only.** Smallest change. It makes the chip text honest but leaves the user unable to choose another value, and it keeps the mismatch between "off" and "rank lower". Rejected.

**B. Region chain chips with implicit hierarchy matching.** One chip per ancestor level, plus the current hierarchical matching. Fixes the visibility of the chain, but still matches songs by rule and not by visible value, and does not let the user pick other values. Rejected.

**C. Multi-value columns with explicit values (chosen).** Every value on screen is a value the list is filtered by. Removing a chip removes that value. Adding from a dropdown adds a value. Works the same for region and for every other characteristic.

## Design

### Screen

Only characteristics with a selected value are shown as columns. Columns sit side by side; each stacks its chips vertically, with its value dropdown at the bottom.

```
Περιοχή          Ρυθμός         Δρόμος
[Απειρανθος ✕]   [7/8 ✕]        [Συρτός ✕]
[Νάξος ✕]
[Αιγαίο ✕]
[Περιοχή ▾]      [Ρυθμός ▾]    [Δρόμος ▾]

                                [+ Χαρακτηριστικό ▾]
```

- A chip shows the value's name and a ✕ to remove it.
- A column's value dropdown lists every option of that characteristic. Options already selected in that column are not listed again.
- Picking an option from a column's dropdown adds a chip to that column and narrows the list.
- A single "+ Χαρακτηριστικό ▾" dropdown lists the characteristics that are not yet columns. Choosing one adds its column, with its value dropdown enabled and listing that characteristic's options.
- Removing a column's last chip closes the column. It goes back to the "+ Χαρακτηριστικό" list, and its filter is cleared.
- Characteristics with no options in the catalogue are not listed.
- On narrow screens, columns wrap into a single stack in the same order, each keeping its chips above its dropdown.

### Filter state

A filter state is a map from characteristic key to a set of selected values:

- Non-year characteristics: a set of `refId` values.
- Year: a set of `yearValue` values.

Rules:

- An empty set means the characteristic does not filter the list.
- The default state for a current song is: for every characteristic the song has, the song's own value. For region, the song's region plus all of its ancestors (`getRegionAncestorIds`).
- Changing the current song replaces the state with its default. Previous selections are not kept.

### List

For the current song and filter state:

1. Exclude the current song.
2. Exclude played songs unless "Δείξε τα ειπωμένα" is on (unchanged).
3. For every column with at least one value, keep only songs that have at least one value in that column's set. A song with no value for that characteristic is excluded.
4. Order the remaining songs in two levels:
   a. by the first chip they match, in on-screen order (columns left to right, chips top to bottom within a column). For example, with chips Απειρανθος, then Νάξος: all Απειρανθος songs come first, then all Νάξος songs. A song that matches several chips goes under the earliest one in on-screen order.
   b. within each group, by title, using Greek locale collation (as now).
5. If no column has a value, show all songs alphabetically (the current "Όλα τα τραγούδια" mode).

### Matching region

Region matching compares `refId` directly. A candidate matches if its region is one of the column's values. Parent, child, and sibling relationships are not checked at match time. They only affect the default values through the prefill.

### Removing the sibling rule

Commit `79d94bd` added sibling matching to `regionMatchesFilter`, and it is already on `main` and `origin/main`. This design removes it, because matching is now exact and sibling songs are reachable through the region dropdown. The following are deleted if nothing else uses them after the change:

- `getRegionSiblingIds` and the sibling branch in `regionMatchesFilter` in `src/lib/suggestions.ts`.
- The sibling tests added in `src/lib/suggestions.test.ts`.

`getRegionDescendantIds` stays, because the song picker uses it. `getRegionAncestorIds` stays, because the prefill uses it.

### Data flow and API

- The suggestions route replaces `activeAxisTypes` with `filters`, a comma-separated list of `axisKey:value` pairs, for example `region:12,region:7,dromos:3,year:1998`.
- The old `activeAxisTypes` parameter is removed, not kept as a fallback.
- `sessionStore.ts` and `getSequenceSuggestions` take the same filter state and call the same `buildSuggestionsResponse`.
- `buildSuggestionsResponse` returns, for each characteristic: its label, its selected values (name and id), and its full option list for the dropdown. The client no longer derives chips from `activeAxisTypes`.

### Edge cases

- Current song has no region: no region column is prefilled; the region column has no values by default.
- Current song has a region but its ancestors are missing from the catalogue: prefill uses the ancestors that exist.
- A value that was selected from a dropdown and later deleted from the catalogue: dropped from the state with no error.
- All columns empty after the user removes every chip: the list shows every song alphabetically.
- Year dropdown: lists the years that appear on at least one song, ascending.
- Offline song picker and offline sync are unchanged. Filter state is not synced; it is per-screen and resets on navigation.

## Testing

- Unit tests in `src/lib/suggestions.test.ts` (pure logic, per project convention):
  - a song is kept only if it matches every filled column,
  - multiple values in one column act as OR,
  - removing the last chip disables that column's filter,
  - a song with no region matches as specified,
  - the sibling rule is gone (a sibling region song is excluded unless its region is in the column),
  - prefill for a multi-level-area song contains all chain values,
  - ordering: grouped by first matched chip in on-screen order, then by title within each group.
  - the "add characteristic" list contains only characteristics with no column, and choosing one adds its column.
- Manual checklist in `docs/manual-testing-checklist.md`, for the chip/dropdown UI on web and native: add and remove values, change song and check reset, narrow-width layout, sequence view, offline native path.

## Left to the builder

- Exact component structure, styling, and how the dropdown is built (native `<select>` or a daisyUI-compatible menu) given the existing chip styles in `LiveSessionView.tsx` and `SequenceSuggestionsCard.tsx`.
- Exact query-string encoding for `filters`.
- Whether to refactor `buildSuggestionsResponse`'s input shape, as long as both callers and the native path stay consistent.
