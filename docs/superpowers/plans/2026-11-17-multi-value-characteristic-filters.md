# Multi-value characteristic filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the on/off axis chips in the suggestions list with multi-value filter columns: selected values as chips, a value dropdown per open column, and one "+ Χαρακτηριστικό" dropdown for the rest. The list shows songs matching every column, ordered by first matched chip then title.

**Architecture:** The filter model is pure logic in `src/lib/suggestions.ts` (matching, default values, ordering) and `src/lib/filterState.ts` (chip and column state helpers, URL param parsing). `buildSuggestionsResponse` returns the applied filters and every axis's options, so the server route and the offline store share one code path. A single `SuggestionFilters` component renders the columns for both the live session and the sequence views. Native uses the same pages and the offline store, so it follows the same design without a separate code path.

**Tech Stack:** TypeScript, React (Next.js App Router), Vitest, Drizzle (Postgres), daisyUI classes already used in the codebase.

**Spec:** `docs/superpowers/specs/2026-11-17-multi-value-characteristic-filters-design.md` (committed as `ab82a2e`). Read it alongside this plan.

## Global Constraints

- Filter matching is exact on the values a column holds. No parent, child, or sibling matching at match time. (Spec: Matching region.)
- Default values for a song: its own value on every axis; for region, the song's region followed by its ancestors, current region first. (Spec: Filter state.)
- Sibling-region matching from commit `79d94bd` is removed. (Spec: Removing the sibling rule.)
- Ordering: by the first matched filter in on-screen order (axis order, then insertion order within an axis), then by title with `localeCompare(..., 'el')`. (Spec: List, step 4.)
- Greek UI strings, copied verbatim: `Όλα τα τραγούδια` (ungrouped heading), `Καμία πρόταση` (filtered empty), `Κανένα τραγούδι` (ungrouped empty), `+ Χαρακτηριστικό` (add-column dropdown label), `Δείξε τα ειπωμένα` (show played, unchanged).
- The native app has no separate code path. Do not add `activeAxisTypes` back in any form. (Spec: Constraints.)
- Commit locally only. No attribution lines in commit messages. Do not push.

## Review Focus

1. **Song with no region value.** Candidate and current songs without a region must not crash the default-values code; the region column starts empty and the list still renders. Pinned by a test in Task 1.
2. **Region chain references a missing ancestor.** A region whose `parentId` points to a deleted row must stop the ancestor walk without throwing. Pinned by a test in Task 1.
3. **Malformed or stale filter parameter.** `filters=region:abc,,year:`, or a value id that no longer exists in the catalogue, must be ignored rather than returning 500 or an error. Pinned by tests in Task 1 and Task 3.
4. **Removing every chip.** The state with no filters must return the ungrouped alphabetical list, with no empty-column or empty-list crash. Pinned by a test in Task 1 and a test in Task 2.
5. **Stale open columns.** A column opened from the "+ Χαρακτηριστικό" dropdown that is closed or re-filtered must not leave a phantom chip or a column stuck open after the song changes. Pinned by tests in Task 2 (`filterState`).

## File Structure

- Modify: `src/lib/suggestions.ts`. Owns matching, default values, ordering, and the response shape. Sibling code is removed here.
- Create: `src/lib/filterState.ts`. Pure helpers for chip and column state, and URL param parsing, shared by the server and client.
- Modify: `src/lib/suggestions.test.ts`. Sibling tests are removed; new filter tests are added.
- Create: `src/lib/filterState.test.ts`.
- Modify: `src/app/api/sessions/[id]/suggestions/route.ts`. Reads the `filters` param.
- Modify: `src/lib/sessionStore.ts`. The three stores and `getSequenceSuggestions` take `filters`.
- Create: `src/components/SuggestionFilters.tsx`. The column UI, used by both live and sequence views.
- Modify: `src/components/LiveSessionView.tsx`. Replaces the chip row with `SuggestionFilters`; drops `toggleAxis`.
- Modify: `src/components/SequenceSuggestionsCard.tsx`. Uses `SuggestionFilters`.
- Modify: `src/app/programs/[id]/sequences/[seqId]/page.tsx`, `src/app/programs/local/sequence/page.tsx`. Replace `activeAxisTypes` state with filter state.
- Modify: `docs/manual-testing-checklist.md`. Adds the manual rows for the new UI.

---

### Task 1: Pure filter model in suggestions.ts

**Files:**
- Modify: `src/lib/suggestions.ts`
- Test: `src/lib/suggestions.test.ts`

**Interfaces:**
- Consumes: `AxisValue`, `SongWithAxes`, `RegionRow` (existing), `getRegionAncestorIds` (existing).
- Produces:
  - `interface FilterValue { axisType: string; refId: number | null; yearValue: number | null }`
  - `defaultFilters(current: AxisValue[], regions: RegionRow[]): FilterValue[]`. Region first, then ancestors; empty when the song has no region.
  - `filterKey(v: FilterValue): string`. Stable key `${axisType}:${refId ?? yearValue}`.
  - `orderFilters(filters: FilterValue[], axisOrder: string[]): FilterValue[]`. Stable sort by index in `axisOrder`; unknown axes last.
  - `matchesFilters(candidate: AxisValue[], filters: FilterValue[]): boolean`. For each axis present in `filters`, the candidate must hold one of that axis's values. Uses `refId` for non-year axes and `yearValue` for `year`.
  - `firstMatchIndex(candidate: AxisValue[], orderedFilters: FilterValue[]): number`. Index in `orderedFilters` of the first matching filter, or `Number.MAX_SAFE_INTEGER` when none matches.

- [ ] **Step 1: Remove sibling code and its tests**

Delete `getRegionSiblingIds`, the sibling branch in `regionMatchesFilter`, and the `getRegionSiblingIds` describe block and sibling `it` cases in `suggestions.test.ts`. `regionMatchesFilter` itself is no longer used by suggestions; delete it too, after checking with `grep -rn regionMatchesFilter src` that nothing else imports it.

- [ ] **Step 2: Write the failing tests**

Add to `src/lib/suggestions.test.ts` (region tree is the existing fixture):

```ts
describe('defaultFilters', () => {
  it('puts the current region first, then its ancestors', () => {
    const f = defaultFilters([av('region', 5), av('rhythm', 10)], regions);
    expect(f.map((x) => x.refId)).toEqual([5, 4, 3, 2, 1]);
  });
  it('is empty for a song without a region', () => {
    expect(defaultFilters([av('rhythm', 10)], regions)).toEqual([]);
  });
  it('stops at a missing ancestor without throwing', () => {
    const broken: RegionRow[] = [{ id: 7, name: 'x', parentId: 999, ownerId: null }];
    expect(defaultFilters([av('region', 7)], broken).map((x) => x.refId)).toEqual([7]);
  });
});

describe('matchesFilters', () => {
  it('requires every filtered axis to match', () => {
    const song = [av('region', 4), av('rhythm', 10)];
    expect(matchesFilters(song, [{ axisType: 'region', refId: 4, yearValue: null }, { axisType: 'rhythm', refId: 10, yearValue: null }])).toBe(true);
    expect(matchesFilters(song, [{ axisType: 'region', refId: 4, yearValue: null }, { axisType: 'rhythm', refId: 99, yearValue: null }])).toBe(false);
  });
  it('ORs multiple values on one axis', () => {
    const f = [{ axisType: 'region', refId: 4, yearValue: null }, { axisType: 'region', refId: 5, yearValue: null }];
    expect(matchesFilters([av('region', 5)], f)).toBe(true);
    expect(matchesFilters([av('region', 3)], f)).toBe(false);
  });
  it('matches region exactly, with no parent or child matching', () => {
    expect(matchesFilters([av('region', 1)], [{ axisType: 'region', refId: 5, yearValue: null }])).toBe(false);
  });
  it('excludes a song with no value on a filtered axis', () => {
    expect(matchesFilters([av('rhythm', 10)], [{ axisType: 'region', refId: 4, yearValue: null }])).toBe(false);
  });
  it('treats no filters as matching everything', () => {
    expect(matchesFilters([], [])).toBe(true);
  });
});

describe('firstMatchIndex and orderFilters', () => {
  it('orders filters by axis order, keeping insertion order within an axis', () => {
    const f = [{ axisType: 'rhythm', refId: 10, yearValue: null }, { axisType: 'region', refId: 5, yearValue: null }, { axisType: 'region', refId: 4, yearValue: null }];
    expect(orderFilters(f, ['region', 'rhythm']).map((x) => x.refId)).toEqual([5, 4, 10]);
  });
  it('returns the earliest matching filter in on-screen order', () => {
    const ordered = [{ axisType: 'region', refId: 5, yearValue: null }, { axisType: 'region', refId: 4, yearValue: null }];
    expect(firstMatchIndex([av('region', 4)], ordered)).toBe(1);
    expect(firstMatchIndex([av('region', 5), av('region', 4)], ordered)).toBe(0);
  });
});
```

Import `defaultFilters`, `matchesFilters`, `orderFilters`, `firstMatchIndex` in the test file. (Filter matching for year uses `yearValue`; add one year case if a year fixture is present.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/suggestions.test.ts`
Expected: FAIL with "defaultFilters is not defined" (or the equivalent for the other new exports).

- [ ] **Step 4: Implement the functions in `src/lib/suggestions.ts`**

Implement the signatures listed under Interfaces. `defaultFilters` builds region values from `[regionId, ...getRegionAncestorIds(regionId, regions)]` and skips it entirely when the song has no region. For non-region axes, one value per axis from the song. `matchesFilters` builds a `Map` of the candidate's values by axis type and checks each filtered axis.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/suggestions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/suggestions.ts src/lib/suggestions.test.ts
git commit -m "feat(suggestions): pure multi-value filter model, drop sibling rule"
```

---

### Task 2: Response shape and client filter state

**Files:**
- Modify: `src/lib/suggestions.ts` (`buildSuggestionsResponse`, `SuggestionsResponsePayload`, `BuildSuggestionsInput`)
- Create: `src/lib/filterState.ts`
- Test: `src/lib/suggestions.test.ts`, `src/lib/filterState.test.ts`

**Interfaces:**
- Consumes: Task 1 functions.
- Produces:
  - `interface FilterOption { refId: number | null; yearValue: number | null; name: string }`
  - `interface AxisOptions { axisType: string; label: string; options: FilterOption[] }`
  - `interface SuggestedSong { id: number; title: string; played: boolean }` (existing)
  - `interface SuggestionsResponsePayload { currentSong: CurrentSongPayload | null; appliedFilters: FilterValue[]; mode: 'filtered' | 'ungrouped'; axes: AxisOptions[]; candidates: SuggestedSong[] }`. The old fields `availableAxisTypes`, `activeAxisTypes`, `songs`, `listTitle` are removed.
  - `BuildSuggestionsInput` gains `filters: FilterValue[] | null` (null means defaults) and drops `requestedActive`.
  - `buildSuggestionsResponse(input): SuggestionsResponsePayload`. `axes` lists every axis type that has at least one lookup option, in the `lookups.axisTypes` order. `appliedFilters` is the input filters, or the defaults when input is null, and drops any value that is not in the lookups. `mode` is `'filtered'` when `appliedFilters` is non-empty.
  - `filterState.ts`:
    - `addFilter(filters: FilterValue[], value: FilterValue): FilterValue[]` (no duplicates; appends)
    - `removeFilter(filters: FilterValue[], value: FilterValue): FilterValue[]`
    - `valuesForAxis(filters: FilterValue[], axisType: string): FilterValue[]`
    - `visibleAxes(axes: AxisOptions[], filters: FilterValue[], openAxes: string[]): AxisOptions[]`. Axes that have a chip or are in `openAxes`, in `axes` order.
    - `addableAxes(axes: AxisOptions[], visible: AxisOptions[]): AxisOptions[]`
    - `closeAxisIfEmpty(openAxes: string[], filters: FilterValue[], axisType: string): string[]`. Removes `axisType` from `openAxes` when it has no chips left.
    - `parseFiltersParam(raw: string | null): FilterValue[] | null`. `null` (absent) returns `null`. Otherwise splits on `,`, parses `axis:value`, drops malformed pairs, and returns the list. Year values are read into `yearValue`, others into `refId`.
    - `serializeFilters(filters: FilterValue[]): string`. Inverse of `parseFiltersParam`.

- [ ] **Step 1: Write failing tests**

In `src/lib/suggestions.test.ts`, replace the old `buildSuggestionsResponse` tests with cases for: default filters when input is `null`; `appliedFilters` drops values missing from the lookups; `mode` is `'ungrouped'` with alphabetical `candidates` when `appliedFilters` is empty; `candidates` ordered by `firstMatchIndex` and then title; `axes` contains options for every axis that has values. Ordering case: filters `[region 5, region 4]`, songs in region 4 and region 5 sorted with region 5 songs first, each group alphabetical.

In `src/lib/filterState.test.ts`:

```ts
it('parseFiltersParam: null is absent, empty string is no filters', () => {
  expect(parseFiltersParam(null)).toBeNull();
  expect(parseFiltersParam('')).toEqual([]);
});
it('parseFiltersParam drops malformed pairs', () => {
  expect(parseFiltersParam('region:abc,,year:,rhythm:10')).toEqual([{ axisType: 'rhythm', refId: 10, yearValue: null }]);
});
it('serializeFilters round-trips', () => {
  const f = [{ axisType: 'region', refId: 5, yearValue: null }, { axisType: 'year', refId: null, yearValue: 1998 }];
  expect(parseFiltersParam(serializeFilters(f))).toEqual(f);
});
it('closeAxisIfEmpty removes the axis only when no chip is left', () => {
  const f = [{ axisType: 'rhythm', refId: 10, yearValue: null }];
  expect(closeAxisIfEmpty(['rhythm', 'dromos'], f, 'rhythm')).toEqual(['rhythm', 'dromos']);
  expect(closeAxisIfEmpty(['rhythm', 'dromos'], [], 'rhythm')).toEqual(['dromos']);
});
it('addableAxes lists only axes without a visible column', () => { /* fixture: 3 axes, 1 visible */ });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/suggestions.test.ts src/lib/filterState.test.ts`
Expected: FAIL (missing exports and changed response shape).

- [ ] **Step 3: Implement**

Rewrite `buildSuggestionsResponse` to use the Task 1 functions, and build `axes` from `lookups` (region from `regions`, year from the years present on songs, others from their lookup tables). Remove `labelForAxisValue`, `availableAxisTypes`, and `listTitle` with them. Implement `filterState.ts` as listed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/suggestions.test.ts src/lib/filterState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/suggestions.ts src/lib/suggestions.test.ts src/lib/filterState.ts src/lib/filterState.test.ts
git commit -m "feat(suggestions): response carries applied filters and axis options"
```

---

### Task 3: Server route reads the filters param

**Files:**
- Modify: `src/app/api/sessions/[id]/suggestions/route.ts`

**Interfaces:**
- Consumes: `parseFiltersParam` (Task 2), `buildSuggestionsResponse` (Task 2).
- Produces: `GET /api/sessions/[id]/suggestions?showPlayed=<bool>&filters=<axis:value,...>`. The `activeAxisTypes` parameter is removed.

- [ ] **Step 1: Replace the param handling**

Replace the `hasActiveParam` / `requestedActive` block with `const filters = parseFiltersParam(request.nextUrl.searchParams.get('filters'));` and pass `filters` into `buildSuggestionsResponse`. In the `session.currentSongId === null` branch, pass `filters: null`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors in this file. Other files may still error until Tasks 4 to 6.

Run: `npm run lint -- "src/app/api/sessions/[id]/suggestions/route.ts"`
Expected: no lint errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/sessions/[id]/suggestions/route.ts"
git commit -m "feat(api): suggestions route takes filters param"
```

---

### Task 4: Stores take filters

**Files:**
- Modify: `src/lib/sessionStore.ts`

**Interfaces:**
- Consumes: `FilterValue`, `serializeFilters` (Task 2), `buildSuggestionsResponse` (Task 2).
- Produces:
  - `SessionStore.load(showPlayed: boolean, filters: FilterValue[] | null): Promise<SuggestionsResponsePayload>`. The same signature is used by `RemoteSessionStore`, `ExplorationSessionStore`, and `LocalSessionStore`.
  - `getSequenceSuggestions(referenceData, currentSongId, excludeSongIds, filters: FilterValue[] | null): SuggestionsResponsePayload`.
- Behavior: `RemoteSessionStore.load` sends `filters=` only when `filters !== null`, using `serializeFilters`. The local stores pass `filters` straight through to `buildSuggestionsResponse`.

- [ ] **Step 1: Write a failing test for the remote URL**

Test `RemoteSessionStore.load` by stubbing `fetch` (vitest `vi.stubGlobal`). Assertions: with `filters = null`, the URL has no `filters` key; with `filters = [{axisType:'rhythm',refId:10,yearValue:null}]`, the URL contains `filters=rhythm%3A10`. Put the test in `src/lib/sessionStore.test.ts` (new file).

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/lib/sessionStore.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Rename the parameter in all three `load` implementations and in `getSequenceSuggestions`. Replace `requestedActive: activeAxisTypes !== null ? new Set(activeAxisTypes) : null` with `filters`. The remote store switches from `activeAxisTypes` to `filters` as described above.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/lib/sessionStore.test.ts && npx tsc --noEmit`
Expected: PASS for the test. Typecheck errors left only in the components and pages handled in Tasks 5 and 6.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessionStore.ts src/lib/sessionStore.test.ts
git commit -m "feat(sessions): stores pass filters to suggestions engine"
```

---

### Task 5: SuggestionFilters component

**Files:**
- Create: `src/components/SuggestionFilters.tsx`

**Interfaces:**
- Consumes: `AxisOptions`, `FilterValue`, `SuggestionsResponsePayload` from `src/lib/suggestions.ts`; `visibleAxes`, `addableAxes`, `addFilter`, `removeFilter`, `valuesForAxis`, `closeAxisIfEmpty` from `src/lib/filterState.ts`.
- Produces: `export default function SuggestionFilters(props: { axes: AxisOptions[]; appliedFilters: FilterValue[]; onChange: (filters: FilterValue[], openAxes: string[]) => void; openAxes: string[]; compact?: boolean }): JSX.Element`. The component is controlled: the parent owns `openAxes` and the filter state.
- Behavior:
  - Renders one column per visible axis, in `axes` order. Each column stacks its chips (each with a ✕ that calls `removeFilter` and `closeAxisIfEmpty`), then its value dropdown listing the axis's options except the already-selected ones. Choosing an option calls `addFilter`.
  - Renders one "+ Χαρακτηριστικό" dropdown listing `addableAxes`. Choosing one adds the axis to `openAxes` and calls `onChange`.
  - Columns wrap on narrow widths. Use flex-wrap with a column min-width. No horizontal page scroll at phone width.
  - Dropdowns are native `<select>` elements with a placeholder option.

- [ ] **Step 1: Implement the component**

Use the existing chip button classes from `LiveSessionView.tsx` (`btn btn-sm rounded-full btn-primary`). Keep the component free of data fetching.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` (no errors in this file)
Run: `npm run lint -- src/components/SuggestionFilters.tsx`
Expected: no errors. Rendering is checked manually in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/components/SuggestionFilters.tsx
git commit -m "feat(ui): SuggestionFilters columns component"
```

---

### Task 6: Wire live session and sequence views

**Files:**
- Modify: `src/components/LiveSessionView.tsx` (around lines 240–300 and 330–350)
- Modify: `src/components/SequenceSuggestionsCard.tsx`
- Modify: `src/app/programs/[id]/sequences/[seqId]/page.tsx` (around lines 40–130)
- Modify: `src/app/programs/local/sequence/page.tsx` (around lines 25–170)

**Interfaces:**
- Consumes: `SuggestionFilters` (Task 5), `SessionStore.load` (Task 4), `getSequenceSuggestions` (Task 4).
- Produces: nothing new. Each caller keeps two pieces of state: `filterOverride: FilterValue[] | null` and `openAxes: string[]`.

- [ ] **Step 1: Live session**

Replace `manualActiveAxisTypes` with `filterOverride` (null until the user changes a chip) and `openAxes` (empty by default). `load` calls `store.load(showPlayed, filterOverride)`. The shown filters are `filterOverride ?? data.appliedFilters`. `onChange` sets `filterOverride` to the new list and `openAxes` to the new open list. `handlePick` and `handleEndSequence` reset both to `null` and `[]`. Replace the chip row with `<SuggestionFilters axes={data.axes} appliedFilters={shown} openAxes={openAxes} onChange={...} />`. Use `data.candidates` for both modes. Heading: `data.mode === 'filtered' ? 'Προτάσεις' : 'Όλα τα τραγούδια'`. The empty messages are `Καμία πρόταση` (filtered) and `Κανένα τραγούδι` (ungrouped).

- [ ] **Step 2: Sequence card and both sequence pages**

`SequenceSuggestionsCard` renders `SuggestionFilters` instead of its own chip row, and lists `data.candidates` with the same heading and empty messages. Each sequence page follows the same override pattern as Step 1, and passes `filterOverride` to `getSequenceSuggestions` (the fixed-program page) or to `store.load` (the local page). Remove `setActiveAxisTypes` and the `toggleAxis` handlers.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests pass.

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/LiveSessionView.tsx src/components/SequenceSuggestionsCard.tsx "src/app/programs/[id]/sequences/[seqId]/page.tsx" src/app/programs/local/sequence/page.tsx
git commit -m "feat(ui): live and sequence views use multi-value filter columns"
```

---

### Task 7: Cleanup and manual checklist

**Files:**
- Modify: `docs/manual-testing-checklist.md`

**Interfaces:**
- Produces: nothing for code. Manual rows only.

- [ ] **Step 1: Confirm no stragglers**

Run: `grep -rn "activeAxisTypes\|availableAxisTypes\|listTitle\|requestedActive\|getRegionSiblingIds\|regionMatchesFilter" src docs --exclude-dir=node_modules`
Expected: no matches, except the old specs and plans under `docs/superpowers/` that describe history.

- [ ] **Step 2: Add manual rows**

Add rows to `docs/manual-testing-checklist.md` covering: a multi-level area song starts with all region chain values; removing a chip narrows or widens the list; removing the last chip closes the column; "+ Χαρακτηριστικό" opens a column with its value dropdown; list order is by first matched chip then title; a song change resets filters; the sequence view and the offline native path behave the same way; phone-width layout has no horizontal scroll.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run build`
Expected: all tests pass and the production build succeeds.

- [ ] **Step 4: Commit**

```bash
git add docs/manual-testing-checklist.md
git commit -m "docs: manual checks for multi-value filter columns"
```
