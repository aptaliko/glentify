# Performance Lyrics Reader (Tier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the on-stage lyrics view usable during a live γλέντι — readable from a distance, kept awake, and page-turnable without touching a scrollbar.

**Architecture:** All changes are inside the single shared `LyricsCard` / `LiveSessionView` component (rendered by all four session/sequence routes, web + native — no twin route needed). A new pure settings module persists a font scale via the existing `KeyValueStore`/`preferencesStore` abstraction. A new hook keeps the screen awake via the Screen Wake Lock API (feature-detected; native fallback plugin is contingent on an on-device spike). Tap-zone paging is two transparent overlay strips over a bounded, self-scrolling lyrics container.

**Tech Stack:** Next.js (App Router, this repo's forked version — read `node_modules/next/dist/docs/` before touching routing, though this plan touches none), React client components, Tailwind + daisyUI, `@capacitor/preferences`, Screen Wake Lock API, Vitest.

**Spec:** No formal spec — Brainstorm was skipped because the mechanisms were settled in conversation. This plan is the sole design artifact; the decisions it rests on are in the "Design Decisions" section below and in `docs/business-features-todo.md` §2 (performance-formatted lyrics, Tier 1).

## Global Constraints

- **Greek UI strings** — all user-facing copy is Greek (match existing strings in `LiveSessionView.tsx`).
- **Locked dark theme** — do not author new daisyUI theme colors; use existing `base-*`/`primary` tokens only (see memory: dark-theme-and-daisyUI-gotcha).
- **Web + native from one component** — `LiveSessionView` is built into both the Vercel web bundle and the Capacitor static export. Gate any runtime-platform-specific rendering with `isNativeApp()` (`src/lib/platform.ts`), never `isNativePlatform()` directly.
- **Persistence via `KeyValueStore`** — use `preferencesStore` (`src/lib/preferencesStore.ts`) with a `glentify:`-prefixed key, mirroring `src/lib/adminEditStore.ts`. Never call `localStorage` directly.
- **Testing convention** — Vitest covers pure logic only. The settings module is unit-tested with a fake `KeyValueStore` (mirror `src/lib/syncQueue.test.ts`). DOM behaviour, tap scrolling, and wake lock are **not** unit-tested — they are manual-checklist entries in `docs/manual-testing-checklist.md`.
- **No new web dependencies.** The only candidate new dependency is a native wake-lock plugin, and only if Task 6's on-device spike proves the Web API does not work in the Android WebView.

## Design Decisions (carried across the compaction boundary)

- **Tap zones chosen** over timed auto-scroll and a Bluetooth pedal (decided 2026-09-08). A pedal is deferred and would reuse the same page-down handler; auto-scroll rejected because pace never matches a live performance.
- **Karaoke line-highlight / timed beat-scroll explicitly rejected** — there is no per-song timing or structure metadata, and asking performers to author it is friction they won't pay.
- **Tier 2 deferred** (not in this plan): left-align + stanza splitting, a dedicated high-contrast stage mode, and pinch-zoom/pan for the παρτιτούρα image. Note the coupling: `text-center` on the lyrics `<pre>` makes page boundaries slightly harder to track; it is left as-is here and revisited in Tier 2.
- **Reader controls render only in the lyrics branch** of `LyricsCard`. The image branch and the empty branch are untouched — no size controls or tap strips over an `<img>` or an empty state (the image branch gets its own zoom/pan in Tier 2).
- **Two task groups, sequenced by dependency risk.** Group A (Tasks 1–3) is pure web-layer: no new deps, ships identically on both builds, fully verifiable in `npm run dev`. Group B (Tasks 4–6) is wake lock, the only part that might need a Capacitor plugin + `cap sync` + a fresh APK. Do not interleave — Group A must be commit-and-verifiable without touching `android/`.

## File Structure

- **Create** `src/lib/lyricsReaderSettings.ts` — pure font-scale logic (constants, clamp, step) + async load/save over an injected `KeyValueStore`. One responsibility: the persisted reader preference.
- **Create** `src/lib/lyricsReaderSettings.test.ts` — Vitest unit tests with a fake `KeyValueStore`.
- **Create** `src/lib/useKeepScreenAwake.ts` — a React hook that holds a screen wake lock for the component's lifetime, re-acquiring on `visibilitychange`.
- **Modify** `src/components/LiveSessionView.tsx` — rework `LyricsCard` (bounded scroll container, font-scale state + controls, tap strips) and call `useKeepScreenAwake()` from the top-level component.
- **Modify** `docs/manual-testing-checklist.md` — add the native-surface manual checks.
- **Modify** `docs/business-features-todo.md` — tick the shipped Tier 1 sub-items.

---

### Task 1: Font-scale settings module

**Files:**
- Create: `src/lib/lyricsReaderSettings.ts`
- Test: `src/lib/lyricsReaderSettings.test.ts`

**Interfaces:**
- Consumes: `KeyValueStore` from `src/lib/preferencesStore.ts` (`get<T>(key): Promise<T|null>`, `set<T>(key, value|null): Promise<void>`).
- Produces:
  - `FONT_SCALE_MIN = 0.75`, `FONT_SCALE_MAX = 2.5`, `FONT_SCALE_STEP = 0.125`, `FONT_SCALE_DEFAULT = 1` (numbers)
  - `clampFontScale(scale: number): number` — clamps to [MIN, MAX]; a `NaN` returns `FONT_SCALE_DEFAULT`
  - `stepFontScale(current: number, direction: 1 | -1): number` — `clampFontScale(current + direction * STEP)`
  - `loadFontScale(storage: KeyValueStore): Promise<number>` — reads key, returns `FONT_SCALE_DEFAULT` when absent, else `clampFontScale` of the stored value
  - `saveFontScale(storage: KeyValueStore, scale: number): Promise<void>` — writes `clampFontScale(scale)` under the key

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import type { KeyValueStore } from './preferencesStore';
import {
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_DEFAULT,
  clampFontScale,
  stepFontScale,
  loadFontScale,
  saveFontScale,
} from './lyricsReaderSettings';

function fakeStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    async get<T>(key: string) {
      return (data.has(key) ? (data.get(key) as T) : null);
    },
    async set<T>(key: string, value: T | null) {
      if (value === null) data.delete(key);
      else data.set(key, value);
    },
  };
}

describe('clampFontScale', () => {
  it('clamps below the minimum', () => {
    expect(clampFontScale(0.1)).toBe(FONT_SCALE_MIN);
  });
  it('clamps above the maximum', () => {
    expect(clampFontScale(99)).toBe(FONT_SCALE_MAX);
  });
  it('passes through an in-range value', () => {
    expect(clampFontScale(1.5)).toBe(1.5);
  });
  it('falls back to default on NaN', () => {
    expect(clampFontScale(Number.NaN)).toBe(FONT_SCALE_DEFAULT);
  });
});

describe('stepFontScale', () => {
  it('steps up by one step', () => {
    expect(stepFontScale(1, 1)).toBeCloseTo(1.125);
  });
  it('steps down by one step', () => {
    expect(stepFontScale(1, -1)).toBeCloseTo(0.875);
  });
  it('does not step below the minimum', () => {
    expect(stepFontScale(FONT_SCALE_MIN, -1)).toBe(FONT_SCALE_MIN);
  });
  it('does not step above the maximum', () => {
    expect(stepFontScale(FONT_SCALE_MAX, 1)).toBe(FONT_SCALE_MAX);
  });
});

describe('loadFontScale', () => {
  it('returns the default when nothing is stored', async () => {
    expect(await loadFontScale(fakeStore())).toBe(FONT_SCALE_DEFAULT);
  });
  it('returns the clamped stored value', async () => {
    expect(await loadFontScale(fakeStore({ 'glentify:lyrics-font-scale': 99 }))).toBe(FONT_SCALE_MAX);
  });
  it('round-trips a saved value', async () => {
    const store = fakeStore();
    await saveFontScale(store, 1.5);
    expect(await loadFontScale(store)).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/lyricsReaderSettings.test.ts`
Expected: FAIL — module `./lyricsReaderSettings` not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { KeyValueStore } from './preferencesStore';

export const FONT_SCALE_MIN = 0.75;
export const FONT_SCALE_MAX = 2.5;
export const FONT_SCALE_STEP = 0.125;
export const FONT_SCALE_DEFAULT = 1;

const KEY = 'glentify:lyrics-font-scale';

export function clampFontScale(scale: number): number {
  if (Number.isNaN(scale)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
}

export function stepFontScale(current: number, direction: 1 | -1): number {
  return clampFontScale(current + direction * FONT_SCALE_STEP);
}

export async function loadFontScale(storage: KeyValueStore): Promise<number> {
  const stored = await storage.get<number>(KEY);
  return stored == null ? FONT_SCALE_DEFAULT : clampFontScale(stored);
}

export async function saveFontScale(storage: KeyValueStore, scale: number): Promise<void> {
  await storage.set(KEY, clampFontScale(scale));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/lyricsReaderSettings.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lyricsReaderSettings.ts src/lib/lyricsReaderSettings.test.ts
git commit -m "feat(lyrics): persisted font-scale settings module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kf31sZQPNVZdjCFLCbNNqv"
```

---

### Task 2: Bounded scroll container + adjustable font size

**Files:**
- Modify: `src/components/LiveSessionView.tsx` (the `LyricsCard` function, currently lines 34–57)

**Interfaces:**
- Consumes: `loadFontScale`, `saveFontScale`, `stepFontScale`, `FONT_SCALE_MIN`, `FONT_SCALE_MAX` from Task 1; `preferencesStore` from `src/lib/preferencesStore.ts`.
- Produces: a reworked `LyricsCard` whose lyrics branch renders inside `<div ref={scrollRef}>` — Task 3 relies on this `scrollRef` existing and on the container being the single `overflow-y-auto` element for the lyrics.

**No unit test** — this is DOM/visual behaviour, verified in `npm run dev` (per the testing convention). Steps below are the implementation; verification is manual.

- [ ] **Step 1: Add imports at the top of `LiveSessionView.tsx`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { preferencesStore } from '@/lib/preferencesStore';
import {
  loadFontScale,
  saveFontScale,
  stepFontScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
} from '@/lib/lyricsReaderSettings';
```

(The `useRef` addition is new; `useCallback`/`useEffect`/`useState` already imported.)

- [ ] **Step 2: Rework `LyricsCard` — font-scale state, controls, bounded scroll container**

Replace the whole `LyricsCard` function with:

```tsx
function LyricsCard({
  lyrics,
  imageUrl,
  maleKey,
  femaleKey,
  scrollRef,
}: {
  lyrics: string | null;
  imageUrl: string | null;
  maleKey: string | null;
  femaleKey: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // null until the persisted scale resolves — avoids a first-paint size jump on stage
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    loadFontScale(preferencesStore).then((s) => {
      if (alive) setScale(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  function adjust(direction: 1 | -1) {
    setScale((current) => {
      const next = stepFontScale(current ?? 1, direction);
      void saveFontScale(preferencesStore, next);
      return next;
    });
  }

  return (
    <div className="card relative flex flex-col gap-3 bg-base-100 p-6 shadow sm:p-8">
      <KeyBadges maleKey={maleKey} femaleKey={femaleKey} />
      {imageUrl ? (
        <img src={imageUrl} alt="Παρτιτούρα" className="mx-auto max-h-[70vh] w-auto object-contain" />
      ) : lyrics ? (
        <>
          <div className="absolute right-2 top-2 z-10 flex gap-1">
            <button
              type="button"
              aria-label="Μικρότερα γράμματα"
              onClick={() => adjust(-1)}
              disabled={scale !== null && scale <= FONT_SCALE_MIN}
              className="btn btn-circle btn-sm btn-outline"
            >
              A−
            </button>
            <button
              type="button"
              aria-label="Μεγαλύτερα γράμματα"
              onClick={() => adjust(1)}
              disabled={scale !== null && scale >= FONT_SCALE_MAX}
              className="btn btn-circle btn-sm btn-outline"
            >
              A+
            </button>
          </div>
          <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
            {scale === null ? (
              <div className="min-h-[8rem]" aria-hidden />
            ) : (
              <pre
                className="whitespace-pre-wrap text-center font-sans leading-relaxed text-base-content"
                style={{ fontSize: `${scale * 1.5}rem` }}
              >
                {lyrics}
              </pre>
            )}
          </div>
        </>
      ) : (
        <p className="text-lg italic text-base-content/50">Δεν έχουν προστεθεί ακόμη στίχοι ή παρτιτούρα για αυτό το τραγούδι.</p>
      )}
    </div>
  );
}
```

Notes for the implementer:
- The `<pre>` lost its `text-xl sm:text-2xl` classes on purpose — size is now the inline `fontSize` (`scale * 1.5rem`; at the default scale of 1 that is `1.5rem`, matching the old `text-2xl`).
- `scale === null` renders a blank min-height box, not the `<pre>`, so a saved non-default size never flashes the default first.
- The `card` gained `relative` so the absolutely-positioned controls (and Task 3's strips) anchor to it.

- [ ] **Step 3: Create the scrollRef in `LiveSessionView` and pass it down**

In the `LiveSessionView` component body (near the other hooks, ~line 80), add:

```tsx
const lyricsScrollRef = useRef<HTMLDivElement>(null);
```

Update the `<LyricsCard ... />` call (~line 175) to pass it:

```tsx
<LyricsCard
  lyrics={currentSong.lyrics}
  imageUrl={currentSong.imageUrl}
  maleKey={currentSong.maleKey}
  femaleKey={currentSong.femaleKey}
  scrollRef={lyricsScrollRef}
/>
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev`, open a live session with a song that has long lyrics.
Expected:
- `A−`/`A+` in the lyrics card's top-right resize the text; the size survives a page reload and switching songs.
- A song with short lyrics shows no scrollbar; a long one scrolls inside the card, and the rest of the page still scrolls to reach the suggestions panel below (mobile width).
- The image branch (a song with a παρτιτούρα image) shows no A−/A+ controls.

- [ ] **Step 5: Run the full suite + lint (no regressions)**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/LiveSessionView.tsx
git commit -m "feat(lyrics): adjustable, persisted font size in a bounded scroll container

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kf31sZQPNVZdjCFLCbNNqv"
```

---

### Task 3: Tap-zone paging

**Files:**
- Modify: `src/components/LiveSessionView.tsx` (the `LyricsCard` lyrics branch from Task 2)

**Interfaces:**
- Consumes: the `scrollRef` bound to the bounded lyrics container (Task 2).
- Produces: nothing consumed downstream.

**No unit test** — scroll/tap behaviour, verified manually.

- [ ] **Step 1: Add page handlers inside `LyricsCard`**

Inside `LyricsCard` (after `adjust`), add:

```tsx
function page(direction: 1 | -1) {
  const el = scrollRef.current;
  if (!el) return;
  // 0.85 of the visible height overlaps pages by ~15% so no line is bisected across a turn
  el.scrollBy({ top: direction * el.clientHeight * 0.85, behavior: 'smooth' });
}
```

- [ ] **Step 2: Add the two overlay strips to the lyrics branch**

Inside the lyrics-branch `<>...</>`, immediately after the closing `</div>` of the `scrollRef` container, add two transparent strips. They must be siblings of the scroll container inside the `relative` card, sitting above it in z-order, and cover only the top and bottom bands so the middle stays free for manual drag-scroll:

```tsx
<button
  type="button"
  aria-label="Προηγούμενη σελίδα στίχων"
  onClick={() => page(-1)}
  className="absolute inset-x-0 top-0 h-[20%] cursor-pointer bg-transparent"
/>
<button
  type="button"
  aria-label="Επόμενη σελίδα στίχων"
  onClick={() => page(1)}
  className="absolute inset-x-0 bottom-0 h-[20%] cursor-pointer bg-transparent"
/>
```

Notes for the implementer:
- Do **not** make a full-cover overlay — it would kill drag-scrolling on the region it covers. Two 20% strips leave the middle 60% free to drag.
- The A−/A+ controls (`z-10`) sit inside the top strip's area; because they are `z-10` and the strips have no explicit z-index, the controls stay clickable. Do not raise the strips' z-index above `z-10`.
- The strips overlay only the card's own height (the `max-h-[70vh]` container caps it), so they never extend over the suggestions panel.

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open a song with long lyrics.
Expected:
- Tapping the bottom ~20% pages down (smooth), the top ~20% pages up; each turn keeps ~15% overlap so no line is cut off between pages.
- Dragging the middle of the lyrics still scrolls freely.
- `A−`/`A+` still work (not swallowed by the top strip).
- On a short-lyrics song, tapping the strips is a harmless no-op.

- [ ] **Step 4: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LiveSessionView.tsx
git commit -m "feat(lyrics): tap-zone paging over the lyrics reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kf31sZQPNVZdjCFLCbNNqv"
```

---

### Task 4: Keep-screen-awake hook (Web Wake Lock API)

**Files:**
- Create: `src/lib/useKeepScreenAwake.ts`
- Modify: `src/components/LiveSessionView.tsx` (call the hook once, top level)

**Interfaces:**
- Produces: `useKeepScreenAwake(): void` — a React hook. While mounted it holds a screen wake lock and re-acquires it when the tab becomes visible again; on unmount it releases. Feature-detected, so a no-op where `navigator.wakeLock` is absent.

**No unit test** — depends on `navigator.wakeLock` / real visibility events; verified manually (web now, native in Task 6).

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from 'react';

/**
 * Holds a screen wake lock for the lifetime of the calling component so the
 * device screen does not sleep mid-song during a live session. Re-acquires on
 * `visibilitychange` because the browser auto-releases the lock whenever the
 * tab is hidden (switching apps, locking, notification shade). A no-op where
 * the Screen Wake Lock API is unavailable.
 */
export function useKeepScreenAwake(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    async function acquire() {
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // request rejects if not visible / not allowed — retried on next visibilitychange
        sentinel = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !released && !sentinel) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release();
      sentinel = null;
    };
  }, []);
}
```

- [ ] **Step 2: Call the hook from `LiveSessionView`**

Add the import:

```ts
import { useKeepScreenAwake } from '@/lib/useKeepScreenAwake';
```

At the very top of the `LiveSessionView` component body (before the `useState` calls, so it runs on every render path — the loading and no-current-song returns included), call:

```tsx
useKeepScreenAwake();
```

- [ ] **Step 3: Verify manually (web)**

Run: `npm run dev`, open a live session, leave the tab focused and idle.
Expected: the screen does not dim/sleep on the OS's normal timeout while the session view is open; switching to another tab and back re-acquires without error (check console — no unhandled rejections).

- [ ] **Step 4: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/useKeepScreenAwake.ts src/components/LiveSessionView.tsx
git commit -m "feat(lyrics): keep screen awake during a live session (Web Wake Lock API)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kf31sZQPNVZdjCFLCbNNqv"
```

---

### Task 5: Documentation — manual checklist + backlog tick

**Files:**
- Modify: `docs/manual-testing-checklist.md`
- Modify: `docs/business-features-todo.md`

- [ ] **Step 1: Add native-surface manual checks to `docs/manual-testing-checklist.md`**

Append a section (match the file's existing heading/checkbox style — read it first):

```markdown
## Performance lyrics reader (native)

- [ ] A−/A+ resize the lyrics text; the size persists across app restarts and across songs
- [ ] Tapping the bottom of the lyrics pages down, the top pages up (~15% overlap, no cut lines)
- [ ] Dragging the middle of the lyrics still scrolls freely
- [ ] Screen stays awake for the whole song while the session view is open (device auto-lock does not fire)
- [ ] After locking and unlocking the device, the screen-awake behaviour resumes
- [ ] Songs with a παρτιτούρα image show no reader controls (unchanged image view)
```

- [ ] **Step 2: Tick the shipped sub-items in `docs/business-features-todo.md`**

Under §2's Tier 1, mark the three sub-items done (`- [x]`), and add an inline note that native keep-awake is pending the Task 6 on-device spike:

```markdown
    - [x] Adjustable text size, persisted per device (localStorage)
    - [x] Keep-awake / screen wake lock — web via Screen Wake Lock API; **native pending on-device spike** (see plan Task 6)
    - [x] Hands-free advance via **tap zones** (bottom = page down, top = page up)
```

- [ ] **Step 3: Commit**

```bash
git add docs/manual-testing-checklist.md docs/business-features-todo.md
git commit -m "docs(lyrics): manual checklist + backlog for the performance reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kf31sZQPNVZdjCFLCbNNqv"
```

---

### Task 6: On-device native wake-lock spike (+ contingent plugin)

**This is a manual on-device task, not a code-first task.** It resolves the one open assumption: whether the Web Wake Lock API from Task 4 actually works inside the Android Capacitor WebView at `capacitor://localhost`. Only if it does **not** does a native plugin enter the tree.

- [ ] **Step 1: Build and install the debug APK**

Run: `npm run build:mobile` (ends by producing `android/app/build/outputs/apk/debug/app-debug.apk`; needs a JDK 21 — see CLAUDE.md). Install via `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 2: Verify keep-awake on the device**

Open a live session in the installed app, leave it idle past the device's screen-timeout.
Expected (pass): the screen stays on. Record the result (device model, Android/WebView version) in `docs/manual-testing-checklist.md`.

- [ ] **Step 3: If the screen sleeps (spike fails), add the native plugin**

Only if Step 2 failed:

```bash
npm install @capacitor-community/keep-awake
```

Extend `src/lib/useKeepScreenAwake.ts` so the native branch uses the plugin instead of the (absent-in-WebView) Web API, gated by `isNativeApp()`:

```ts
import { useEffect } from 'react';
import { isNativeApp } from '@/lib/platform';
import { KeepAwake } from '@capacitor-community/keep-awake';

export function useKeepScreenAwake(): void {
  useEffect(() => {
    if (isNativeApp()) {
      void KeepAwake.keepAwake();
      return () => {
        void KeepAwake.allowSleep();
      };
    }
    // ...existing Web Wake Lock API path from Task 4 unchanged...
  }, []);
}
```

Then run `npx cap sync android`, rebuild the APK (`npm run build:mobile`), reinstall, and re-verify Step 2.

- [ ] **Step 4: Commit (only if Step 3 ran)**

```bash
git add package.json package-lock.json src/lib/useKeepScreenAwake.ts
git commit -m "feat(lyrics): native keep-awake via @capacitor-community/keep-awake

Web Wake Lock API does not hold in the Android WebView; use the plugin on native.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Kf31sZQPNVZdjCFLCbNNqv"
```

- [ ] **Step 5: Record the spike outcome**

Note in `docs/manual-testing-checklist.md` which path shipped (Web API held in the WebView, or the plugin was needed), so the decision is not re-litigated later. Commit that doc change.

---

## Self-Review

**Spec coverage** (against `docs/business-features-todo.md` §2 Tier 1):
- Adjustable text size, persisted per device → Tasks 1 + 2. ✓
- Keep-awake / screen wake lock (web + native) → Task 4 (web) + Task 6 (native spike/plugin). ✓
- Hands-free advance via tap zones → Task 3. ✓
- Explicitly-skipped items (auto-scroll, pedal, Tier 2, karaoke) → recorded in Design Decisions, no task. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Task 6's contingency is a genuine conditional (on-device evidence), with the exact commands and code for both outcomes, not a placeholder.

**Type consistency:** `clampFontScale`/`stepFontScale`/`loadFontScale`/`saveFontScale` and the `FONT_SCALE_*` constants are used with the same names/signatures across Tasks 1–2. `scrollRef: React.RefObject<HTMLDivElement | null>` is produced in Task 2 and consumed in Task 3. `useKeepScreenAwake(): void` is defined and called consistently in Tasks 4/6.
