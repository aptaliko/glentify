# Dynamic Song Classification (Tags) — Design

## Background

The app currently classifies every song with four fixed, required fields: Region (hierarchical), Rhythm, Dromos, Genre. This works well for traditional (παραδοσιακά) songs, but breaks down for non-traditional repertoire the user also wants in the app:

- **Ρεμπέτικα/Λαϊκά**: classified mainly by Rhythm, Dromos, Composer, and Year. Region ("Σμυρνέικο/Πειραιώτικο school") does not map cleanly onto the geographic Region hierarchy and is not useful for suggestions.
- **Έντεχνα**: Rhythm and Dromos have no meaning at all. Only Composer (and optionally Year) matter.

A real live session (γλέντι) can move freely between traditional and non-traditional songs, so the suggestion engine must keep working sensibly across both — it cannot become two disconnected systems.

## Goal

Replace the fixed 4-column classification on `songs` with a flexible, per-song set of typed "axis values" (tags), so each song carries only the classification axes that are actually meaningful for it. Suggestions become driven by whichever axes the current song has, toggled on/off by the user in real time, rather than three hardcoded lists.

## Data Model

```
songs
  id, title, lyrics (nullable), genreId (FK -> genres, required), notes, createdAt, updatedAt
  -- regionId, rhythmId, dromosId columns removed

axis_types                          -- fixed, seeded in code (not admin-editable)
  id, key (unique: 'region' | 'rhythm' | 'dromos' | 'composer' | 'year'),
  label, lookupTable (nullable — null for 'year'), hierarchical (bool)

song_axis_values
  id, songId (FK -> songs), axisType (references axis_types.key),
  refId (nullable int — FK-ish pointer into the axis's lookup table),
  yearValue (nullable int — only set when axisType = 'year')
  UNIQUE (songId, axisType)         -- a song has at most one value per axis

regions, rhythms, dromoi, genres    -- unchanged
composers                           -- new: id, name
```

`genreId` stays a required, fixed column on `songs` — it is descriptive metadata ("what kind of song is this"), not a filterable suggestion axis, and it drives nothing else automatically (no per-genre default config; see below).

`transitionRules` table and its admin page (`/admin/transition-rules`) are removed entirely. Their previous role — hard-gating which rhythm can follow the current one — no longer applies: rhythm filtering is now something the user opts into per song, so the user is the one deciding what can follow, not the system.

Adding a genuinely new axis in the future (e.g. "instrument") requires only: a new lookup table + one new row in the `axis_types` seed. No change to `song_axis_values`'s schema, because `refId` is generic.

## Suggestion Engine Behavior

**Axis toggles, not fixed lists.** Opening a song in the live session loads whichever axes it has values for (from `song_axis_values`) as toggle buttons, defaulting to all **ON**. The user can turn any axis off/on with one tap.

**Single dynamic list.** Instead of three parallel lists, there is one candidate list, AND-filtered across all currently-active axes, with a dynamic title reflecting what's active (e.g. "Άλλα τραγούδια με ίδιο Ρυθμό, Περιοχή, Δρόμο" → shrinks to "...με ίδιο Ρυθμό, Περιοχή" when Δρόμος is toggled off). Within the filtered set, candidates that also match any inactive-but-shared axes sort first as a tie-breaker; otherwise alphabetical.

**Region matching is ancestor/descendant-inclusive.** A candidate passes an active Region filter if its region is the same as, an ancestor of (at any depth up the tree), or a descendant of (at any depth down the tree) the current song's region — not exact-match only. This lets a broadly-tagged song ("Θράκη") surface for a narrowly-tagged current song ("Μάρηδες", a village under Έβρος under Θράκη) and vice versa.

**No active axes → grouped fallback.** If the user has turned every axis off (or the current song has none), the candidate list groups by Genre (always present on every song) with an alphabetical header per group, so the list still has scannable structure instead of one flat unordered pile.

**Year** is a plain integer on `song_axis_values.yearValue`, not a lookup table — exact-match filtering, consistent with every other axis, unless real use surfaces a need for "nearby year" matching later (out of scope for now).

## Admin Changes

- New `/admin/composers` page — same CRUD pattern as `/admin/genres` / `/admin/rhythms`.
- `/admin/transition-rules` removed.
- Song create/edit form changes shape: Genre stays a fixed required dropdown; Region/Rhythm/Dromos dropdowns are replaced by a dynamic tag list — "+ Πρόσθεσε άξονα" lets the user pick an axis type, then its value (or a year number), add it to the song, or remove an existing tag.

## Migration of Existing Data

A script converts every existing song's `regionId`/`rhythmId`/`dromosId` into three `song_axis_values` rows (axisType = 'region'/'rhythm'/'dromos', refId = the old FK value). No data is lost, including the "Άγνωστος" Δρόμος placeholder already set on most songs — the user can later remove that placeholder tag from songs where the real δρόμος is genuinely unknown, rather than it showing as a false "Άγνωστος" tag forever.

## Out of Scope (for this design)

- Multi-value axes (a song having two composers, or two regions) — not requested; the unique constraint assumes one value per axis per song.
- "Nearby year" fuzzy matching — exact match only for now.
- Admin UI for editing `axis_types` itself — adding a new axis type remains a code-level change (new lookup table + seed row), not a runtime admin operation.
