# Dark Theme Redesign Implementation Plan

> **Status: COMPLETE.** All 2 tasks landed as commits `7ac21ca..3714e7f` — this plan's own checkboxes below were already checked off at the time (`3714e7f`), unlike most plans in this directory; no correction needed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Glentify's locked light daisyUI theme (`corporate`) with a new locked dark theme (`glentify-dark`, teal accent), applied globally across native, web, and admin — no toggle, no markup changes.

**Architecture:** A single custom daisyUI 5 theme is defined via CSS custom-property tokens in `src/app/globals.css` and set as the (only) default theme. Every page in the app already renders through daisyUI's semantic classes (`btn`, `card`, `bg-base-200`, `alert`, etc.) with zero hardcoded colors anywhere in `src/app` or `src/components`, so the new theme propagates everywhere automatically — no other file needs to change.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS v4, daisyUI 5.7.9 (`@plugin "daisyui"` theme token syntax).

## Global Constraints

- Exactly one theme is active at all times — no light/dark toggle, no `data-theme` switcher UI, no `prefers-color-scheme` media query. This was an explicit design decision (see spec's "Εκτός εμβέλειας").
- The new theme applies globally: native (Android/Capacitor build), web, and admin pages alike — no route or page is excluded.
- No changes to fonts, icons, imagery, or any page's layout/markup. The only file this plan touches is `src/app/globals.css`.
- If the manual visual pass (Task 2) finds a readability/contrast problem anywhere, fix it by adjusting the theme's token values in `src/app/globals.css` — never by adding a page-level color override, which would reintroduce the hardcoded-color problem this design avoids.
- Exact color values below are from the approved design spec (`docs/superpowers/specs/2026-08-10-dark-theme-redesign-design.md`) and may be fine-tuned in Task 2 for contrast — see that task's Step 3.

---

### Task 1: Define and apply the `glentify-dark` theme

**Files:**
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: a daisyUI theme named `glentify-dark`, set as the sole default theme (`--default`), consumed automatically by every existing page/component via daisyUI's semantic classes. No new exported symbols, functions, or types — this is a CSS-only change.

- [x] **Step 1: Read the current file**

`src/app/globals.css` currently contains:

```css
@import "tailwindcss";
@plugin "daisyui" {
  themes: corporate --default;
}

:root {
  color-scheme: light;
}

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

/* Locked to a single (light) daisyUI theme regardless of the OS/browser color
   scheme -- this is a tablet UI meant to be glanceable on stage, not a themed app. */
body {
  font-family: var(--font-sans), Arial, Helvetica, sans-serif;
}
```

- [x] **Step 2: Replace the theme block and `:root` color-scheme**

Replace:

```css
@plugin "daisyui" {
  themes: corporate --default;
}

:root {
  color-scheme: light;
}
```

with:

```css
@plugin "daisyui" {
  themes: false;
}

@plugin "daisyui/theme" {
  name: "glentify-dark";
  default: true;
  prefersdark: false;
  color-scheme: dark;
  --color-base-100: #14141c;
  --color-base-200: #1c1f26;
  --color-base-300: #262a33;
  --color-base-content: #e5e7eb;
  --color-primary: #0d9488;
  --color-primary-content: #ffffff;
  --color-secondary: #262a33;
  --color-secondary-content: #e5e7eb;
  --color-accent: #0d9488;
  --color-accent-content: #ffffff;
  --color-neutral: #1c1f26;
  --color-neutral-content: #e5e7eb;
  --color-info: #38bdf8;
  --color-info-content: #06202e;
  --color-success: #34d399;
  --color-success-content: #052e21;
  --color-warning: #fbbf24;
  --color-warning-content: #2e1e02;
  --color-error: #f87171;
  --color-error-content: #2e0a0a;
  --radius-selector: 1rem;
  --radius-field: 0.75rem;
  --radius-box: 1.25rem;
  --border: 1px;
  --depth: 0;
  --noise: 0;
}
```

This is daisyUI 5's actual custom-theme authoring mechanism (`@plugin "daisyui/theme"`, distinct from the main `@plugin "daisyui"` block) — passing `default: true` makes the plugin itself prepend an unconditional `:where(:root),` to the generated selector, which is what makes the tokens apply everywhere without needing any `data-theme` attribute or theme-switcher UI (confirmed by reading `node_modules/daisyui/theme/index.js`).

- [x] **Step 3: Update the explanatory comment**

Replace:

```css
/* Locked to a single (light) daisyUI theme regardless of the OS/browser color
   scheme -- this is a tablet UI meant to be glanceable on stage, not a themed app. */
```

with:

```css
/* Locked to a single (dark) daisyUI theme regardless of the OS/browser color
   scheme -- this is a tablet UI meant to be glanceable on stage, not a themed
   app. Dark was chosen over the previous light theme because it reduces glare
   in dim venues/stages while keeping the same "always this one look" design. */
```

- [x] **Step 4: Run the build**

Run: `npm run build`
Expected: succeeds with no errors (this is the only available check for a pure-CSS change — there is no unit-testable logic here).

- [x] **Step 5: Run the existing test suite as a regression sanity check**

Run: `npm test`
Expected: all existing tests still pass unchanged (this change touches no `.ts`/`.tsx` logic, so the count/result should be identical to before this task).

- [x] **Step 6: Commit**

```bash
git add src/app/globals.css
git commit -m "Replace locked light theme with locked dark glentify-dark theme"
```

---

### Task 2: Manual visual verification across native, web, and admin

**Files:** none (manual checklist only; may loop back into `src/app/globals.css` if Step 3 finds a contrast problem — same file Task 1 touched, no new files).

**Interfaces:**
- Consumes: the `glentify-dark` theme tokens from Task 1.

- [x] **Step 1: Verify the web app**

Run: `npm run dev`, open `http://localhost:3000` in a browser.

Check: home page, login/register, `/session/new` (song picker), an active session page, `/programs` and a program's detail/sequence pages, `/account`. Confirm: dark background renders (no leftover white flash on load), all text is legible, primary buttons show the teal accent with readable white text, links are distinguishable from body text.

- [x] **Step 2: Verify the admin pages**

In the same running dev server, check: `/admin/songs` (list), `/admin/songs/new` and an existing song's edit page (dense form with many fields — this is the page most likely to expose a contrast problem), and the admin pages for programs/rhythms/regions/composers if present under `/admin`.

Confirm: form inputs have a visible border/background distinct from the page background, placeholder text is legible but visibly lighter than entered text, validation/error messages (`alert alert-error` style) are readable on the dark background, disabled/read-only states are still distinguishable from normal fields.

- [x] **Step 3: Fix any contrast problem found, in `src/app/globals.css` only**

If Steps 1-2 find any element that's hard to read: adjust the specific token(s) in the `glentify-dark` block from Task 1 (e.g. lighten `--color-base-300` if borders are too faint, or adjust `--color-*-content` if text-on-color contrast is weak). Re-run the affected page's check after each adjustment. Do not add any color override outside this one theme block — see this plan's Global Constraints.

- [x] **Step 4: Verify the native (Android) build**

Run: `npm run build:mobile`, then in Android Studio press **Run** with the device selected (same flow as the existing mobile testing process).

Check on-device: home screen, "Ξεκίνα γλέντι" song picker, an active local session, "Σταθερά προγράμματα" list → program → sequence playback. Confirm the same dark background/teal-accent look as the web check, no light-theme flash on launch, and that text remains legible in bright ambient light (hold the phone under a bright lamp or near a window — this is the practical equivalent of the original "glanceable on stage" requirement) as well as in a dim room.

- [x] **Step 5: Final regression check**

Run, in order: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
Expected: all clean (identical results to before this plan — this task makes no source code changes beyond the possible token tuning in Step 3).

- [x] **Step 6: Commit any Step 3 tuning**

If Step 3 changed any token values:

```bash
git add src/app/globals.css
git commit -m "Tune glentify-dark theme contrast after manual visual pass"
```

If Step 3 required no changes, skip this step — there is nothing to commit.
