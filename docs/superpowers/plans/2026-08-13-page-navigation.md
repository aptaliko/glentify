# Consistent Page Navigation (Back / Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page in the app shows a consistent, always-visible way to go back to its logical parent page and return home, replacing the scattered/missing/error-state-only ad-hoc links that exist today.

**Architecture:** One new shared component, `PageNav`, rendered at the top of every in-scope page (in every conditional render branch that page has — loading, empty, error, and main content — not just one of them). `backHref` is always an explicit string the page supplies; it is never derived from the current URL, since several native pages resolve their subject via client-side state rather than a path segment.

**Tech Stack:** Next.js 16 App Router, React client components, Tailwind v4 + daisyUI 5 (`btn btn-ghost btn-sm`, matching the existing `src/app/admin/layout.tsx` navbar style).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-page-navigation-design.md` — this plan implements it.
- `backHref` is always explicit, passed by the page — never computed from `usePathname()` or similar.
- `PageNav` renders unconditionally at the top of the page's content in every branch that page has (loading/empty/error/main) — never buried inside just one conditional branch.
- Every page listed in this plan currently has its own ad-hoc back/home link somewhere (in some branch, in some style). That old link is removed — this is a like-for-like replacement, not an addition. A page must not end up with two links pointing at the same place.
- Out of scope, untouched: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/` (home itself), and the seven top-level admin list pages (`/admin/songs`, `/admin/programs`, `/admin/regions`, `/admin/rhythms`, `/admin/dromoi`, `/admin/composers`, `/admin/genres`) — the admin navbar in `src/app/admin/layout.tsx` already covers Home for all of these and nothing in this plan changes that file.
- This is a UI/navigation-only change — no new business logic, no schema/API changes. Verification is `npx tsc --noEmit` (must stay clean) plus a manual click-through (no automated tests — this codebase's convention is pure logic in `src/lib/*.ts` gets Vitest tests; presentational components don't, and none of the three existing `src/components/*.tsx` files have a test file).

---

## Task 1: `PageNav` component

**Files:**
- Create: `src/components/PageNav.tsx`

**Interfaces:**
- Produces: `export default function PageNav({ backHref, showHome }: { backHref: string; showHome?: boolean })` — a React component. `showHome` defaults to `true`.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import Link from 'next/link';

export default function PageNav({ backHref, showHome = true }: { backHref: string; showHome?: boolean }) {
  return (
    <div className="flex gap-2 p-2">
      <Link href={backHref} className="btn btn-ghost btn-sm">← Πίσω</Link>
      {showHome && (
        <Link href="/" className="btn btn-ghost btn-sm">🏠 Αρχική</Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors (this file isn't imported anywhere yet, so this just confirms the new file itself is valid).

- [ ] **Step 3: Commit**

```bash
git add src/components/PageNav.tsx
git commit -m "Add PageNav component for consistent back/home navigation"
```

---

## Task 2: `LiveSessionView.tsx` — serves `/session/[id]` and `/session/local`

**Files:**
- Modify: `src/components/LiveSessionView.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1) — `<PageNav backHref="/" />`.

Both `/session/[id]/page.tsx` and `/session/local/page.tsx` are thin wrappers that just instantiate a store and render `<LiveSessionView>` — neither has its own top-level JSX beyond that, so adding `PageNav` once inside `LiveSessionView` covers both pages. `LiveSessionView` has three early-return branches (loading, no-current-song, main content) — `PageNav` goes at the top of all three, replacing nothing (neither page currently has any back/home link at all).

- [ ] **Step 1: Add the import**

In `src/components/LiveSessionView.tsx`, add:
```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: Add `PageNav` to the loading branch**

Change:
```tsx
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
to:
```tsx
  if (!data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
(`items-center justify-center` alone would center `PageNav` inside the flex row along with the spinner; changing to `flex-col` keeps `PageNav` as its own row above the centered spinner.)

- [ ] **Step 3: Add `PageNav` to the no-current-song branch**

Change:
```tsx
  if (!data.currentSong) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <h1 className="text-2xl font-bold">Διάλεξε τραγούδι για να συνεχίσεις</h1>
        <SongPicker onSelect={handlePick} dataSource={songPickerDataSource} />
      </main>
    );
  }
```
to:
```tsx
  if (!data.currentSong) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <PageNav backHref="/" />
        <h1 className="text-2xl font-bold">Διάλεξε τραγούδι για να συνεχίσεις</h1>
        <SongPicker onSelect={handlePick} dataSource={songPickerDataSource} />
      </main>
    );
  }
```

- [ ] **Step 4: Add `PageNav` to the main content branch**

Change:
```tsx
  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
```
to:
```tsx
  return (
    <main className="flex min-h-screen flex-col bg-base-200">
      <PageNav backHref="/" />
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/LiveSessionView.tsx
git commit -m "Add PageNav to LiveSessionView (covers /session/[id] and /session/local)"
```

---

## Task 3: `session/new/page.tsx`

**Files:**
- Modify: `src/app/session/new/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1).

This page has three branches: native-cache-loading, native-no-reference-data, and main content. The main content branch currently has its own ad-hoc `<Link href="/" className="link self-start">← Αρχική</Link>` — that gets replaced. The native-no-reference-data branch has a `<Link href="/">Πήγαινε στην αρχική για συγχρονισμό</Link>` — that's a different, more specific call-to-action link (not a generic nav link) and stays as-is; `PageNav` is added alongside it, not instead of it.

- [ ] **Step 1: Add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: Add `PageNav` to the native-cache-loading branch**

Change:
```tsx
  if (native && !checkedCache) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
to:
```tsx
  if (native && !checkedCache) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```

- [ ] **Step 3: Add `PageNav` to the native-no-reference-data branch**

Change:
```tsx
  if (native && !referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }
```
to:
```tsx
  if (native && !referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/" />
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }
```

- [ ] **Step 4: Replace the ad-hoc link in the main content branch**

Change:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <Link href="/" className="link self-start">← Αρχική</Link>
      <h1 className="text-2xl font-bold">Ξεκίνα γλέντι — διάλεξε πρώτο τραγούδι</h1>
```
to:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Ξεκίνα γλέντι — διάλεξε πρώτο τραγούδι</h1>
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/session/new/page.tsx
git commit -m "Replace ad-hoc home link with PageNav on session/new"
```

---

## Task 4: `account/page.tsx`, `programs/page.tsx`, `programs/[id]/page.tsx`

**Files:**
- Modify: `src/app/account/page.tsx`
- Modify: `src/app/programs/page.tsx`
- Modify: `src/app/programs/[id]/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1).

Three small, single-return pages, grouped because each is a one-line mechanical change.

- [ ] **Step 1: `account/page.tsx` — add `PageNav` (no existing link to remove, this page currently has none)**

Add the import:
```tsx
import PageNav from '@/components/PageNav';
```
Change:
```tsx
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-bold">Λογαριασμός</h1>
```
to:
```tsx
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <PageNav backHref="/" />
      <h1 className="text-xl font-bold">Λογαριασμός</h1>
```

- [ ] **Step 2: `programs/page.tsx` — replace the ad-hoc bottom link**

Add the import:
```tsx
import PageNav from '@/components/PageNav';
```
Change:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
```
to:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
```
Then remove the now-redundant line at the bottom of the same return block:
```tsx
      <Link href="/" className="link">Αρχική</Link>
```
(`Link` remains used elsewhere in this file for each program's own link, so the import doesn't become unused — verify this after editing.)

- [ ] **Step 3: `programs/[id]/page.tsx` — replace the ad-hoc bottom link**

Add the import:
```tsx
import PageNav from '@/components/PageNav';
```
Change:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">{program.title}</h1>
```
to:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/programs" />
      <h1 className="text-2xl font-bold">{program.title}</h1>
```
Then remove the now-redundant line at the bottom:
```tsx
      <Link href="/programs" className="link">← Όλα τα προγράμματα</Link>
```
This file's loading branch (`if (!program) { ... }`) also gets `PageNav`:
```tsx
  if (!program) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
becomes:
```tsx
  if (!program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/programs" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
(Check whether `Link` is still used elsewhere in this file after removing the bottom link — each sequence card uses `<Link href={\`/programs/${program.id}/sequences/${seq.id}\`}>`, so the import stays needed.)

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/account/page.tsx src/app/programs/page.tsx "src/app/programs/[id]/page.tsx"
git commit -m "Add PageNav to account, programs list, and program detail pages"
```

---

## Task 5: `programs/[id]/sequences/[seqId]/page.tsx`

**Files:**
- Modify: `src/app/programs/[id]/sequences/[seqId]/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1).

This page (the sequence song-playback view, with next/previous buttons — the same feature the follow-up swipe-gesture spec will touch) has three branches: loading, empty-sequence, and main content. The empty-sequence and main-content branches each already have their own ad-hoc back link (no home); both get replaced.

- [ ] **Step 1: Add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: Add `PageNav` to the loading branch**

Change:
```tsx
  if (!sequence) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
to:
```tsx
  if (!sequence) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref={`/programs/${params.id}`} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```

- [ ] **Step 3: Replace the ad-hoc link in the empty-sequence branch**

Change:
```tsx
  if (sequence.songs.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <h1 className="text-2xl font-bold">{sequence.title}</h1>
        <p className="text-base-content/60">Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά.</p>
        <Link href={`/programs/${params.id}`} className="btn btn-outline">← Πίσω στις σειρές</Link>
      </main>
    );
  }
```
to:
```tsx
  if (sequence.songs.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <PageNav backHref={`/programs/${params.id}`} />
        <h1 className="text-2xl font-bold">{sequence.title}</h1>
        <p className="text-base-content/60">Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά.</p>
      </main>
    );
  }
```

- [ ] **Step 4: Replace the ad-hoc link in the main content branch's header**

Change:
```tsx
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href={`/programs/${params.id}`} className="btn btn-sm btn-outline">
            ← Σειρές προγράμματος
          </Link>
          <span className="badge badge-neutral">{index + 1} / {sequence.songs.length}</span>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{current.song.title}</h1>
      </header>
```
to:
```tsx
      <PageNav backHref={`/programs/${params.id}`} />
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="badge badge-neutral">{index + 1} / {sequence.songs.length}</span>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{current.song.title}</h1>
      </header>
```
(`Link` is still used inside the sequence-list sidebar? Check: this file's sidebar uses plain `<button>`s, not `Link` — after this change, confirm whether `Link` is still imported/used anywhere else in the file; if not, remove the now-unused `import Link from 'next/link';` line, since an unused import would fail `tsc`/lint.)

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors. If it flags an unused `Link` import, remove that import line.

- [ ] **Step 6: Commit**

```bash
git add "src/app/programs/[id]/sequences/[seqId]/page.tsx"
git commit -m "Replace ad-hoc back links with PageNav on the sequence playback page"
```

---

## Task 6: `programs/local/page.tsx` and `programs/local/program/page.tsx`

**Files:**
- Modify: `src/app/programs/local/page.tsx`
- Modify: `src/app/programs/local/program/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1).

Both are native (offline) equivalents of the programs list / program detail pages, each with a loading branch, a "no reference data" branch, and a main-content branch. `programs/local/page.tsx`'s "no reference data" branch keeps its specific `Πήγαινε στην αρχική για συγχρονισμό` call-to-action link (same reasoning as Task 3) — `PageNav` is added alongside it there, not instead of it.

- [ ] **Step 1: `programs/local/page.tsx` — add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: `programs/local/page.tsx` — add `PageNav` to the loading branch**

Change:
```tsx
  if (!checkedCache) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
to:
```tsx
  if (!checkedCache) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```

- [ ] **Step 3: `programs/local/page.tsx` — add `PageNav` to the no-reference-data branch**

Change:
```tsx
  if (!referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }
```
to:
```tsx
  if (!referenceData) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/" />
        <p className="text-lg">Δεν υπάρχουν αποθηκευμένα τραγούδια στη συσκευή.</p>
        <Link href="/" className="btn btn-primary">
          Πήγαινε στην αρχική για συγχρονισμό
        </Link>
      </main>
    );
  }
```

- [ ] **Step 4: `programs/local/page.tsx` — replace the ad-hoc bottom link in the main content branch**

Change:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
```
to:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/" />
      <h1 className="text-2xl font-bold">Σταθερά προγράμματα</h1>
```
and remove the now-redundant bottom line:
```tsx
      <Link href="/" className="link">Αρχική</Link>
```

- [ ] **Step 5: `programs/local/program/page.tsx` — add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 6: `programs/local/program/page.tsx` — add `PageNav` to the loading branch**

Change:
```tsx
  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
to:
```tsx
  if (!checked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/programs/local" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```

- [ ] **Step 7: `programs/local/program/page.tsx` — replace the ad-hoc link in the not-found branch**

Change:
```tsx
  if (!referenceData || !program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Το πρόγραμμα δεν βρέθηκε.</p>
        <Link href="/programs/local" className="btn btn-primary">← Όλα τα προγράμματα</Link>
      </main>
    );
  }
```
to:
```tsx
  if (!referenceData || !program) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/programs/local" />
        <p className="text-lg">Το πρόγραμμα δεν βρέθηκε.</p>
      </main>
    );
  }
```

- [ ] **Step 8: `programs/local/program/page.tsx` — replace the ad-hoc bottom link in the main content branch**

Change:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <h1 className="text-2xl font-bold">{program.title}</h1>
```
to:
```tsx
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-base-200 p-4">
      <PageNav backHref="/programs/local" />
      <h1 className="text-2xl font-bold">{program.title}</h1>
```
and remove the now-redundant bottom line:
```tsx
      <Link href="/programs/local" className="link">← Όλα τα προγράμματα</Link>
```
(This file also has a `<button onClick={() => handleSelectSequence(seq)} ...>` per sequence card, unrelated to `Link` — confirm `Link` is still used somewhere in the file after these edits, since the "no reference data"/"program not found" reasoning above already keeps at least one `Link` import use intact in `programs/local/page.tsx` but check `programs/local/program/page.tsx` specifically since ALL its `Link` uses are the two just replaced. If no `Link` usage remains in `programs/local/program/page.tsx`, remove its now-unused `import Link from 'next/link';` line.)

- [ ] **Step 9: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors. Fix any unused-import error by removing that specific import line.

- [ ] **Step 10: Commit**

```bash
git add src/app/programs/local/page.tsx src/app/programs/local/program/page.tsx
git commit -m "Add PageNav to the native programs list and program detail pages"
```

---

## Task 7: `programs/local/sequence/page.tsx`

**Files:**
- Modify: `src/app/programs/local/sequence/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1).

The native equivalent of Task 5's page — same shape (next/previous song playback), with four branches here (loading, not-found, empty-songs, main content).

- [ ] **Step 1: Add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: Add `PageNav` to the loading branch**

Change:
```tsx
  if (!checked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-base-200">
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```
to:
```tsx
  if (!checked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-base-200">
        <PageNav backHref="/programs/local/program" />
        <span className="loading loading-spinner loading-lg text-primary" />
      </main>
    );
  }
```

- [ ] **Step 3: Replace the ad-hoc link in the not-found branch**

Change:
```tsx
  if (!referenceData || !program || !sequence) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <p className="text-lg">Η σειρά δεν βρέθηκε.</p>
        <Link href="/programs/local" className="btn btn-primary">← Όλα τα προγράμματα</Link>
      </main>
    );
  }
```
to:
```tsx
  if (!referenceData || !program || !sequence) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-200 p-4 text-center">
        <PageNav backHref="/programs/local/program" />
        <p className="text-lg">Η σειρά δεν βρέθηκε.</p>
      </main>
    );
  }
```

- [ ] **Step 4: Replace the ad-hoc link in the empty-songs branch**

Change:
```tsx
  if (songs.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <h1 className="text-2xl font-bold">{sequence.title}</h1>
        <p className="text-base-content/60">Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά.</p>
        <Link href="/programs/local/program" className="btn btn-outline">← Πίσω στις σειρές</Link>
      </main>
    );
  }
```
to:
```tsx
  if (songs.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-200 p-4">
        <PageNav backHref="/programs/local/program" />
        <h1 className="text-2xl font-bold">{sequence.title}</h1>
        <p className="text-base-content/60">Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά.</p>
      </main>
    );
  }
```

- [ ] **Step 5: Replace the ad-hoc link in the main content branch's header**

Change:
```tsx
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link href="/programs/local/program" className="btn btn-sm btn-outline">
            ← Σειρές προγράμματος
          </Link>
          <span className="badge badge-neutral">{index + 1} / {songs.length}</span>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{current.title}</h1>
      </header>
```
to:
```tsx
      <PageNav backHref="/programs/local/program" />
      <header className="sticky top-0 z-10 flex flex-col items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="badge badge-neutral">{index + 1} / {songs.length}</span>
        </div>
        <h1 className="text-center text-xl font-bold sm:text-2xl">{current.title}</h1>
      </header>
```
After this change, `Link` has no remaining usage anywhere in this file — remove the now-unused `import Link from 'next/link';` line.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/programs/local/sequence/page.tsx
git commit -m "Replace ad-hoc back links with PageNav on the native sequence playback page"
```

---

## Task 8: `admin/songs/new/page.tsx` and `admin/songs/[id]/page.tsx`

**Files:**
- Modify: `src/app/admin/songs/new/page.tsx`
- Modify: `src/app/admin/songs/[id]/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1) — with `showHome={false}`, since these pages already sit inside `src/app/admin/layout.tsx`'s persistent navbar, which already has an "Αρχική" link.

Neither page currently has any back link at all. Both share the identical outer structure (`<div className="flex flex-col gap-4"><h1>...</h1>`).

- [ ] **Step 1: `admin/songs/new/page.tsx` — add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: `admin/songs/new/page.tsx` — add `PageNav`**

Change:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Νέο τραγούδι</h1>
```
to:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
      <h1 className="text-xl font-bold">Νέο τραγούδι</h1>
```

- [ ] **Step 3: `admin/songs/[id]/page.tsx` — add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 4: `admin/songs/[id]/page.tsx` — add `PageNav`**

Change:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
```
to:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/songs/new/page.tsx "src/app/admin/songs/[id]/page.tsx"
git commit -m "Add PageNav (back only) to admin song create/edit pages"
```

---

## Task 9: `admin/programs/[id]/page.tsx`

**Files:**
- Modify: `src/app/admin/programs/[id]/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1) — `showHome={false}`.

- [ ] **Step 1: Add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: Add `PageNav`**

Change:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>
```
to:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/programs" showHome={false} />
      <h1 className="text-xl font-bold">{title}</h1>
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/admin/programs/[id]/page.tsx"
git commit -m "Add PageNav (back only) to admin program detail page"
```

---

## Task 10: `admin/local/songs/edit/page.tsx` and `admin/local/programs/edit/page.tsx`

**Files:**
- Modify: `src/app/admin/local/songs/edit/page.tsx`
- Modify: `src/app/admin/local/programs/edit/page.tsx`

**Interfaces:**
- Consumes: `PageNav` (Task 1) — `showHome={false}`.

Both pages have three branches (checking-selection loading state, no-selection empty state, main content). Today, the back link exists ONLY in the no-selection branch — the actual edit form (the common case, once a song/program is selected) has no way back at all. `PageNav` goes in all three branches; the existing no-selection-branch button is replaced (not duplicated).

- [ ] **Step 1: `admin/local/songs/edit/page.tsx` — add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 2: `admin/local/songs/edit/page.tsx` — add `PageNav` to the loading branch**

Change:
```tsx
  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
```
to:
```tsx
  if (!checked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
```

- [ ] **Step 3: `admin/local/songs/edit/page.tsx` — replace the ad-hoc button in the no-selection branch**

Change:
```tsx
  if (songId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <p className="text-lg">Δεν έχει επιλεγεί τραγούδι.</p>
        <button onClick={() => router.push('/admin/songs')} className="btn btn-primary">← Πίσω στα τραγούδια</button>
      </div>
    );
  }
```
to:
```tsx
  if (songId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/songs" showHome={false} />
        <p className="text-lg">Δεν έχει επιλεγεί τραγούδι.</p>
      </div>
    );
  }
```

- [ ] **Step 4: `admin/local/songs/edit/page.tsx` — add `PageNav` to the main content branch**

Change:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
```
to:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/songs" showHome={false} />
      <h1 className="text-xl font-bold">Επεξεργασία τραγουδιού</h1>
```

- [ ] **Step 5: `admin/local/programs/edit/page.tsx` — add the import**

```tsx
import PageNav from '@/components/PageNav';
```

- [ ] **Step 6: `admin/local/programs/edit/page.tsx` — add `PageNav` to the loading branch**

Change:
```tsx
  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
```
to:
```tsx
  if (!checked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <PageNav backHref="/admin/programs" showHome={false} />
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    );
  }
```

- [ ] **Step 7: `admin/local/programs/edit/page.tsx` — replace the ad-hoc button in the no-selection branch**

Change:
```tsx
  if (programId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <p className="text-lg">Δεν έχει επιλεγεί πρόγραμμα.</p>
        <button onClick={() => router.push('/admin/programs')} className="btn btn-primary">← Πίσω στα προγράμματα</button>
      </div>
    );
  }
```
to:
```tsx
  if (programId === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-4 text-center">
        <PageNav backHref="/admin/programs" showHome={false} />
        <p className="text-lg">Δεν έχει επιλεγεί πρόγραμμα.</p>
      </div>
    );
  }
```

- [ ] **Step 8: `admin/local/programs/edit/page.tsx` — add `PageNav` to the main content branch**

Change:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">{title}</h1>
```
to:
```tsx
  return (
    <div className="flex flex-col gap-4">
      <PageNav backHref="/admin/programs" showHome={false} />
      <h1 className="text-xl font-bold">{title}</h1>
```

- [ ] **Step 9: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/app/admin/local/songs/edit/page.tsx src/app/admin/local/programs/edit/page.tsx
git commit -m "Add PageNav (back only) to native admin song/program edit pages, all branches"
```

---

## Task 11: Full manual verification

No further code changes expected.

- [ ] **Step 1: Full type-check and build**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -60
```
Expected: `tsc` clean; `next build` completes without errors (this also statically prerenders every route, so a broken import or JSX error in any touched page surfaces here even without manually visiting it).

- [ ] **Step 2: `npm run dev` click-through**

Start `npm run dev` and, logged in as a real (or throwaway) account, visit every page from the spec's table and confirm:
- `/account`, `/session/new`, `/programs`, `/programs/[id]` (pick a real program id), `/programs/[id]/sequences/[seqId]` (pick a real sequence), `/admin/songs/new`, `/admin/songs/[id]` (pick a real song id), `/admin/programs/[id]` (pick a real program id) — each shows "← Πίσω" (and "🏠 Αρχική" except the two `admin/*` ones, which only show Back), and each button lands where the spec's table says.
- Start a live session (`/session/new` → pick a song → lands on `/session/[id]`) and confirm PageNav shows there too, in both the "no current song" and normal states.
- Confirm the four pre-auth pages (`/login`, `/register`, `/forgot-password`, `/reset-password`) are unchanged — no PageNav.
- Confirm the seven admin list pages still only show the existing admin navbar (no new PageNav row) — Task 8/9/10 only touched detail/edit pages, not these.

- [ ] **Step 3: Native pages (best effort)**

If a device/emulator is available, repeat the click-through for `/programs/local`, `/programs/local/program`, `/programs/local/sequence`, `/admin/local/songs/edit`, `/admin/local/programs/edit` on-device. If no device is available in this environment, note that as a deferred check consistent with this repo's established mobile-testing constraints (see prior plans' verification notes) — do not skip the rest of Step 2 because of it.

- [ ] **Step 4: Confirm no leftover ad-hoc links**

```bash
grep -rn "← Αρχική\|← Όλα τα προγράμματα\|← Πίσω στα τραγούδια\|← Πίσω στα προγράμματα\|← Πίσω στις σειρές\|← Σειρές προγράμματος" src/app --include="*.tsx"
```
Expected: no matches — every occurrence of this session's known ad-hoc link text should have been replaced by `<PageNav>` across Tasks 3–10.

No commit for this task — it's a verification checkpoint.
