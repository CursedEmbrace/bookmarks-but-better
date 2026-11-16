# Responsive dashboard layout

The dashboard keeps whole-folder masonry and the saved **Max columns** ceiling.
Its columns fit the measured usable area rather than window breakpoints. The
header and occupied cards share one centered region.

## Policy

- Preferred root-column minimum: **17rem**.
- Root-card maximum: **34rem**.
- Existing `gap-4` spacing between columns and stacked cards.
- Actual count is bounded by available width, Max columns and the visible root
  collection. Empty folders are real cards; unused tracks are not reserved.
- One column may be narrower than 17rem when the available area requires it.
- Root widths are equal within a layout, independent of bookmark counts.
- Contained limits the available region to 1440px. Fluid uses the padded page
  width. Sparse groups may be identical because the root-card cap binds first.
- Compact descendants retain their independent 26rem cap and wrapping policy.

For usable width `W`, actual gap `G`, preferred minimum `M`, maximum `K`, saved
maximum `L`, and visible root count `R`:

```text
fit = max(1, floor((W + G + 0.01px) / (M + G)))
columns = max(1, min(fit, L, R))
occupied width = min(W, columns × K + (columns - 1) × G)
```

An empty collection uses the available region for its header and empty state.
The 0.01px fit tolerance absorbs fractional layout rounding, without adding a
viewport breakpoint or a second stored preference.

At a 16px root font, two sparse roots at 1920px occupy 1104px: two 544px cards
and a 16px gap. At 768px, populated dashboards use two 360px columns; at a 32px
root font they use one 704px column. Enough roots at 1920px / Max six yield five
columns in Contained and six in Fluid.

## Ownership and lifecycle

`DashboardLayout` derives the visible folder collection once using the existing
collection/order rules. Both the header and `BookmarkGrid` consume its bounds.
The grid still uses the same greedy shortest-column distributor, keyboard model,
drag handling and lazy-card gate. No folder-card internals, adapters, stored
preferences or migrations change.

The width observer watches the available container **before** the occupied group
is capped. A clipped, inaccessible-to-focus sizing probe measures 17rem and the
spacing token; its size responds to text enlargement without assuming a 16px
root font. The probe cannot introduce horizontal overflow on narrow pages.
Measurements occur in a layout effect before paint, discard zero-size hidden
states, and do not update state when all inputs are unchanged within 0.01px.
Observer/listener cleanup also works through React StrictMode remounts. Window
resize is a fallback when ResizeObserver is unavailable.

Column width participates in the existing height-measurement generation, so
widening within a count band can accept shorter measured cards. The existing
growth threshold and collapse hold still prevent self-induced redistribution.
Measured spacing is also passed to the distributor. Offscreen lazy estimates
remain estimates until mounted; total heights can depend on scroll history.

Collection errors are rethrown inside the existing grid error boundary, keeping
the header and recovery controls available. Safe mode avoids collection work.

## Verification and replay

`tests/ui/responsive-dashboard.spec.ts` covers sparse centering, both modes,
seven viewport widths, calculated thresholds, independent content constraints,
narrow fallback, live preferences, folder creation/deletion, persistence,
collapse, focus through resizing, drag cancellation and depth-20 menu access at
768px with doubled root-font size. Geometry checks include real control hit
testing and pointer activation; the text tests use keyboard navigation for the
focus-visible check. Existing compact, noncompact, separator, icon and lazy
regressions remain applicable.

Run through the normal UI configuration, selecting a browser installed locally:

```text
bun run test:ui responsive-dashboard deep-compact-folders deep-noncompact-folders
bun run test
bun run lint
bun run typecheck
bun run build:firefox
```

The first UI run on a machine needs Playwright's browser:
`bunx playwright install chromium`.

## Keyboard focus in large trees

A single root card is now up to 34rem wide instead of one breakpoint column,
which changes how compact rows wrap. That exposed a race in the lazy-card
focus keeping: after a keyboard jump (End, say), cards mounting around the
focus could reflow it out of view over a second batch that the old
one-batch check did not cover (`compact-nested-folders` "large trees" failed
about one run in three). `focus-keep.ts` now holds a keyboard-moved focus in
view every frame until it has stayed visible for four frames, the user
scrolls, points, types or moves focus, or two seconds pass. Keyboard
navigation starts the keep directly; `LazyCard` batches extend it.
