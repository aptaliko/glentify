# Consistent Page Navigation (Back / Home) — Design Spec

## Problem

Navigation across the app is inconsistent and, in several places, effectively missing:

- `src/app/session/[id]/page.tsx` and `src/app/account/page.tsx` have no back or home link at all.
- `src/app/admin/local/songs/edit/page.tsx` only shows a "← Πίσω στα τραγούδια" button in its `songId === null` empty state — the actual edit form (the common case) has nothing.
- `src/app/session/new/page.tsx`, `src/app/session/local/page.tsx`, `src/app/programs/local/page.tsx` only show a home link inside an error/empty-state branch, not on the page's main content.
- `src/app/programs/page.tsx`, `src/app/programs/local/program/page.tsx` have a home/back link, but as a small plain `link`-styled anchor at the very bottom of the page — easy to miss, inconsistent with everything else.
- Styling is inconsistent throughout: `btn btn-primary`, plain `link`, `btn btn-outline`, all used interchangeably for what is conceptually the same "go back" action.

Admin pages (everything under `src/app/admin/`) already get a permanent "Αρχική" link via the shared `src/app/admin/layout.tsx` navbar — that part already works and is not being replaced.

## Goal

Every page in the app (except the four pre-auth pages) shows a consistent, always-visible way to go back to its logical parent page, and a way to return to the app's home page — placed at the top of the page, not buried in a conditional branch or the page footer.

## Architecture

One new shared component, `src/components/PageNav.tsx`:

```tsx
export default function PageNav({
  backHref,
  showHome = true,
}: {
  backHref: string;
  showHome?: boolean;
}) {
  return (
    <div className="flex gap-2 p-2">
      <Link href={backHref} className="btn btn-ghost btn-sm">← Πίσω</Link>
      {showHome && <Link href="/" className="btn btn-ghost btn-sm">🏠 Αρχική</Link>}
    </div>
  );
}
```

(Exact class names/markup may be adjusted during implementation to fit each page's existing layout container — the binding requirement is: both links present, `btn btn-ghost btn-sm` styling matching the existing `admin/layout.tsx` navbar convention, rendered unconditionally at the top of the page's main content, not inside a loading/error/empty-state branch.)

`backHref` is always an explicit string passed by the page — never derived by chopping the current URL. Several native pages (`programs/local/program`, `programs/local/sequence`, `admin/local/songs/edit`, `admin/local/programs/edit`) resolve their subject via client-side state/query params rather than a path segment, so pathname-based derivation would not reliably produce the right target. Each page states its own logical parent explicitly.

## Scope

**Gets `<PageNav>`:**

| Page | `backHref` | `showHome` |
|---|---|---|
| `/account` | `/` | true |
| `/session/new` | `/` | true |
| `/session/[id]` | `/` | true |
| `/session/local` | `/` | true |
| `/programs` | `/` | true |
| `/programs/[id]` | `/programs` | true |
| `/programs/[id]/sequences/[seqId]` | `/programs/${params.id}` | true |
| `/programs/local` | `/` | true |
| `/programs/local/program` | `/programs/local` | true |
| `/programs/local/sequence` | `/programs/local/program` | true |
| `/admin/songs/new` | `/admin/songs` | **false** (admin navbar already shows Home) |
| `/admin/songs/[id]` | `/admin/songs` | **false** |
| `/admin/programs/[id]` | `/admin/programs` | **false** |
| `/admin/local/songs/edit` | `/admin/songs` | **false** |
| `/admin/local/programs/edit` | `/admin/programs` | **false** |

**In scope, no `<PageNav>` needed (already covered another way):**
- `/` — it IS home.
- Top-level admin list pages (`/admin/songs`, `/admin/programs`, `/admin/regions`, `/admin/rhythms`, `/admin/dromoi`, `/admin/composers`, `/admin/genres`) — the admin navbar already provides Home, and there is no sensible "back" target one level above them within the admin section (tab-switching serves that role).

**Out of scope (no navigation added):**
- `/login`, `/register`, `/forgot-password`, `/reset-password` — pre-authentication, there is no logical "home" to return to (it would just redirect back to `/login`), and no parent page to go back to.

## Removing the old ad-hoc links

Every page listed in the "in scope" table that currently has its own inline back/home link (in whatever conditional branch or footer position it's in today) has that link removed and replaced by `<PageNav>` at the top. This is a like-for-like replacement, not an addition — pages should not end up with two different back-to-the-same-place links.

## Testing

This is a UI/navigation change with no new business logic — no new pure functions to unit test. Verification is: `npx tsc --noEmit` clean, and a manual click-through confirming each in-scope page shows both buttons (or just Back, for the five `showHome={false}` admin pages) and that each button lands on the stated target.

## Out of scope for this spec

Swipe-gesture navigation for next/previous song on Android is a separate, already-agreed-to-be-separate piece of work with its own spec, not covered here.
