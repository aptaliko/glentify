# Swipe Left/Right for Next/Previous Song (Android) Implementation Plan

> **Status: COMPLETE.** All 2 tasks landed as commits `7da25a2..ba89a5e` — this plan's own checkboxes below were already checked off at the time (`ba89a5e`); no correction needed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** On `/programs/local/sequence` (the only next/previous-song screen that ships in the Android build), swiping left advances to the next song and swiping right goes to the previous one, identically to the existing on-screen buttons.

**Architecture:** Add `react-swipeable`, call its `useSwipeable` hook once in the page's main-content branch, and spread the returned handlers onto the existing `<main>` element. The callbacks call the exact same `setIndex` updates the buttons already use, gated by the same `hasNext`/`hasPrevious` booleans, so a swipe past either end of the list is a no-op.

**Tech Stack:** Next.js 16 App Router, React, `react-swipeable` (new dependency, `^7.0.2`).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-swipe-navigation-design.md` — this plan implements it.
- Scope is exactly one file: `src/app/programs/local/sequence/page.tsx`. No other page changes.
- `delta: 50` (pixels) — the swipe-recognition threshold, per the spec.
- No wrap-around: swiping past the last/first song does nothing, matching what tapping an absent button would do.
- No visual drag-follow or animation — the index changes instantly on a completed swipe.
- No automated tests for this task — gesture interaction with no new pure logic, consistent with this codebase's convention (only `src/lib/*.ts` has Vitest coverage). Verification is `npx tsc --noEmit`, `npm run build`, and a deferred real-device swipe check.

---

## Task 1: Wire swipe handlers into the sequence playback page

**Files:**
- Modify: `package.json` (new dependency)
- Modify: `src/app/programs/local/sequence/page.tsx`

**Interfaces:** none new — this task only adds two callback wirings to existing state (`setIndex`, `hasNext`, `hasPrevious`) already defined in the file.

- [x] **Step 1: Install the dependency**

```bash
npm install react-swipeable@^7.0.2
```
Expected: `package.json`'s `dependencies` gains a `"react-swipeable": "^7.0.2"` entry (or whatever exact resolved version npm picks under that range), and `package-lock.json` updates accordingly.

- [x] **Step 2: Read the current file first**

Read `src/app/programs/local/sequence/page.tsx` in full — confirm it matches what this task assumes (a `hasPrevious`/`hasNext` pair computed just before the final `return`, and a `<main className="flex min-h-screen flex-col bg-base-200">` wrapping the main content branch). If the file has drifted from this shape, stop and report rather than guessing.

- [x] **Step 3: Add the import**

Change:
```tsx
import { useEffect, useState } from 'react';
import PageNav from '@/components/PageNav';
```
to:
```tsx
import { useEffect, useState } from 'react';
import { useSwipeable } from 'react-swipeable';
import PageNav from '@/components/PageNav';
```

- [x] **Step 4: Add the `useSwipeable` call and spread its handlers onto `<main>`**

Change:
```tsx
  const current = songs[Math.min(index, songs.length - 1)];
  const hasPrevious = index > 0;
  const hasNext = index < songs.length - 1;

  return (
    <main className="flex min-h-screen flex-col bg-base-200">
```
to:
```tsx
  const current = songs[Math.min(index, songs.length - 1)];
  const hasPrevious = index > 0;
  const hasNext = index < songs.length - 1;

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => hasNext && setIndex((i) => i + 1),
    onSwipedRight: () => hasPrevious && setIndex((i) => i - 1),
    delta: 50,
  });

  return (
    <main className="flex min-h-screen flex-col bg-base-200" {...swipeHandlers}>
```

- [x] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [x] **Step 6: Build**

```bash
npm run build 2>&1 | tail -30
```
Expected: completes with no errors, `/programs/local/sequence` still listed among the prerendered routes.

- [x] **Step 7: Commit**

```bash
git add package.json package-lock.json src/app/programs/local/sequence/page.tsx
git commit -m "Add swipe left/right navigation to the sequence playback page"
```

---

## Task 2: Manual verification

No further code changes expected.

- [x] **Step 1: Confirm the build and type-check are clean**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -30
```
Expected: both clean, matching Task 1's own verification (re-confirming nothing regressed).

- [x] **Step 2: Code-level sanity check**

Read the final `src/app/programs/local/sequence/page.tsx` and confirm: `onSwipedLeft` calls `setIndex((i) => i + 1)` only when `hasNext` is true; `onSwipedRight` calls `setIndex((i) => i - 1)` only when `hasPrevious` is true; `swipeHandlers` is spread onto the `<main>` element that wraps the whole main-content branch (not just a sub-element), so a swipe anywhere on the screen — including over the lyrics card — is recognized.

- [x] **Step 3: Real-device check (best effort)**

If an Android device or emulator is available in this environment, install the app (`npm run build:mobile`, then run/install via Android Studio or `./gradlew assembleDebug` as used earlier in this project) and manually verify on a real touchscreen: swiping left/right over the lyrics advances/goes back; a fast vertical scroll on long lyrics does not accidentally trigger a song change; swiping left on the last song and right on the first song both do nothing (no error, no visual glitch). If no device is available in this environment, note this as a deferred first-priority check for the next on-device session — do not skip Steps 1–2 because of it.

No commit for this task — it's a verification checkpoint.
