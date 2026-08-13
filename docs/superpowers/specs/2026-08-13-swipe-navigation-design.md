# Swipe Left/Right for Next/Previous Song (Android) — Design Spec

## Problem

`src/app/programs/local/sequence/page.tsx` — the fixed-program sequence playback screen, and the only screen with next/previous song navigation that actually ships in the Android build (`src/app/programs/[id]/sequences/[seqId]/page.tsx` is the web equivalent, but `scripts/build-mobile.sh` strips `src/app/programs/[id]` from the native bundle entirely) — only supports advancing via the on-screen "← Προηγούμενο" / "Επόμενο →" buttons. On a tablet held with both hands mid-performance, a swipe gesture is faster and doesn't require reaching for a small button.

## Goal

Swiping left on this screen does the same thing as tapping "Επόμενο →"; swiping right does the same as tapping "← Προηγούμενο". No other page changes — this is not a general gesture-navigation system, just this one screen.

## Architecture

Add `react-swipeable` (`^7.0.2`, zero runtime dependencies) as a new dependency. In `LocalSequencePage`'s main content branch, call its `useSwipeable` hook and spread the returned handlers onto the existing outer `<main>` element:

```tsx
const swipeHandlers = useSwipeable({
  onSwipedLeft: () => hasNext && setIndex((i) => i + 1),
  onSwipedRight: () => hasPrevious && setIndex((i) => i - 1),
  delta: 50,
});

return (
  <main className="flex min-h-screen flex-col bg-base-200" {...swipeHandlers}>
    ...
```

`delta: 50` (pixels) sets how far a touch must travel before it's recognized as a swipe at all — high enough that an incidental touch or the start of a vertical scroll on the lyrics text doesn't fire it, low enough that a deliberate swipe registers immediately. The library's own direction detection (not this spec's code) is what distinguishes "mostly horizontal" from "mostly vertical" — a `delta`-crossing vertical scroll gesture is classified as `onSwipedUp`/`onSwipedDown`, which this code doesn't handle, so it's a no-op for our purposes. `preventScrollOnSwipe` is left at its default (`false`) so the lyrics area keeps scrolling normally; only gestures the library classifies as a *horizontal* swipe reach `onSwipedLeft`/`onSwipedRight`.

`hasNext`/`hasPrevious` are the same booleans the existing buttons already use (`index < songs.length - 1` / `index > 0`) — swiping past either end of the list is a no-op, exactly matching what tapping a hidden/absent button would do. No wrap-around.

No visual drag-follow, no animation — the index changes instantly on a completed swipe, identically to a button tap.

## Out of scope

- The web equivalent page (`programs/[id]/sequences/[seqId]/page.tsx`) — not part of the Android build, not touched.
- Any other page with forward/back-style navigation (there isn't one — confirmed via `grep -rln "Επόμενο\|Προηγούμενο" src/app`, which returns only these two sequence-playback pages).
- Visual/haptic feedback beyond what the existing button tap already gives (a re-render showing the new song).

## Testing

No automated tests — this is a gesture-interaction change with no new pure logic (`hasNext`/`hasPrevious`/`setIndex` all already exist and are unchanged; only two new callback wirings are added), consistent with this codebase's convention that only `src/lib/*.ts` gets Vitest coverage. Verification is `npx tsc --noEmit`, `npm run build`, and — since gesture behavior can only be meaningfully checked on a real touchscreen — a real-device swipe test, noted as a deferred/first-priority on-device check the same way this session's earlier mobile-only work has been handled when no device was available mid-implementation.
