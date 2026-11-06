# Compact nested folders

This is an optional presentation setting on `feature/compact-nested-folders`.
Enable **Settings → Appearance → Layout → Compact nested folders**. It is off
by default, preserving the existing full-width presentation. Nested folders must
already be shown, and each folder to compact must use **Grid view** in its folder
actions menu. The setting is profile-wide; individual Grid/List choices remain
source-scoped.

## Layout

- Nested grid cards size to their direct icon rows and their headings. Their
  siblings share a wrapping flex container with the existing `gap-3` spacing,
  no growth to fill unused space, and no prescribed pairings.
- The longest icon run between separators supplies a preferred minimum width,
  up to six icons. The calculation includes favicon size, tile borders, theme
  spacing, inter-icon gaps and card padding. A usable 10rem minimum and 26rem
  maximum are both constrained by the available parent width. Headings and
  deeper descendants can also contribute to the card's intrinsic width.
- Long titles wrap, including unbroken names. Existing menu and collapse
  buttons retain their hit areas. Large collections wrap their icons internally.
- Separators remain full-row elements of their own folder's icon grid. They
  never become elements of the sibling-card flex container.
- List cards retain their full width. Disabling compact layout restores the
  original stacked presentation. Disabling nested folders retains the existing
  flat dashboard behaviour.
- In either presentation, narrow nested groups progressively reclaim their
  parent's horizontal padding once the body is narrower than 12rem. They
  reclaim at most that padding, so further nesting stops consuming width without
  escaping the owning card. Headers retain their normal padding. The collapsible
  panel reserves the same horizontal gutter inside its animation clip. This
  also protects mixed Grid/List descendants. Noncompact children remain stacked
  at full width; only compact Grid children use intrinsic sizing and wrapping.
- Contained/Fluid width, column counts, breakpoints and distribution rules are
  unchanged. The existing height measurement cache accepts new measurements
  when the compact preference changes.
- Lazy placeholders preserve a measured compact card's width as well as its
  height. Content and display changes invalidate the remembered width. When
  mounting neighbours changes wrapped row heights, a previously visible
  keyboard focus is kept in view. New scrolling, dragging or keyboard input
  cancels that adjustment.

No bookmark hierarchy, source isolation, custom-icon persistence, icon
processing, backup format or permission changes are involved. Keyboard commands
remain the existing dashboard commands: Up/Down traverse the column's folder
contents in order, Left/Right move between dashboard columns, Enter toggles a
folder or opens a bookmark, and Alt+Up/Down reorder within a folder.

## Files

| File                                                                      | Purpose                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/bookmark-card/bookmark-card.tsx`                            | Wrapping nested cards, compact grids and wrapping headings.                                                                     |
| `src/features/bookmark-card/compact-folder.ts`                            | Content-derived width constraints, including separator runs.                                                                    |
| `src/features/bookmark-grid/lazy-card.tsx`                                | Width-preserving placeholders and keyboard focus during reflow.                                                                 |
| `src/features/bookmark-grid/card-heights.ts`                              | Invalidate height measurements on layout preference changes.                                                                    |
| `src/stores/preferences-store.ts`                                         | Opt-in profile preference and display subscription.                                                                             |
| `src/features/settings/panels/appearance-panel.tsx`                       | Accessible compact-layout switch.                                                                                               |
| `src/features/settings/settings-categories.ts`                            | Appearance category assignment.                                                                                                 |
| `src/stores/__tests__/compact-folder-preference.test.ts`                  | Default, persistence and source-switch coverage.                                                                                |
| `src/features/bookmark-grid/__tests__/lazy-card.test.tsx`                 | Placeholder widths, invalidation and focus/input safeguards.                                                                    |
| `src/features/bookmark-grid/__tests__/bookmark-grid-measurement.test.tsx` | Accept shorter cards after enabling compact layout.                                                                             |
| `src/features/settings/settings-categories.test.ts`                       | Preference category coverage.                                                                                                   |
| `tests/ui/compact-nested-folders.spec.ts`                                 | Actual browser measurements and interactions; before/after and theme screenshots.                                               |
| `tests/ui/deep-compact-folders.spec.ts`                                   | Depths 6/8/10/11/12/20 at 1440/700/390px; header bounds, pointer hit tests, actual menu clicks, collapse and focus restoration. |

The deep-nesting regression previously reduced the twelfth nested compact card
to 64px at a 1440px viewport. The bounded indentation keeps it at 160px with the
default theme, while the same noncompact card remains 312px in that two-column
fixture.

## Noncompact deep-nesting safeguard

Noncompact nesting now shares the bounded indentation and full panel gutter.
Previously, each level lost another 32px to padding even after its heading and
actions no longer fit. In a 768px viewport with Max columns six, a depth-12 card
could shrink to 32px and its menu was clipped by ancestor panels.

The nested group can reclaim at most its parent's padding, without imposing a
minimum width or escaping that parent. At the default font size, sufficiently
wide noncompact cards stop shrinking at 192px; narrower parents remain the limit.
Shallow cards with enough space keep their normal insets. Headers keep their
padding, titles still truncate, and noncompact siblings still stack. Compact
intrinsic sizing, the 26rem cap, wrapping, and the opt-in preference are unchanged.

`tests/ui/deep-noncompact-folders.spec.ts` checks depths 1/2/6/8/10/12/20,
including the 768 × 900 / Max columns six reproduction. It measures clipping
intersections and title/action bounds, uses direct pointer coordinates, opens
menus by pointer and keyboard, checks Escape focus restoration and collapse,
and covers Grid/List, themes, text scaling, deep mutations, separators, icons,
drag cancellation and lazy content. The shared fixture and geometry helpers live
in `tests/ui/deep-folder-helpers.ts`.

## Validation and manual Firefox review

Validation on 1 November 2026:

| Check                                                            | Result                             |
| ---------------------------------------------------------------- | ---------------------------------- |
| `bun run test`                                                   | 109 files, 1,037 tests passed.     |
| `bun run test:ui --browser=firefox --workers=2`                  | 83 passed.                         |
| `bun run test:ui --browser=chromium --workers=2`                 | 83 passed.                         |
| `bun run lint`                                                   | Passed with no warnings.           |
| `bun run typecheck`                                              | Passed.                            |
| Prettier check of every changed/new TypeScript and Markdown file | Passed.                            |
| `git diff --check`                                               | Passed.                            |
| `bun run build:firefox`                                          | Passed; output in `dist-firefox/`. |

This adds seven unit cases and twelve browser cases. An initial large-tree
keyboard test exposed the focus/reflow interaction described above; its
regression now passes in both browsers. No known blocking implementation issues
remain. Native extension/profile review is still manual; the automated browser
tests run the application in the Workbench. Rust, website and daemon protocol
code were not changed, so their separate build/integration suites were not run.

The focused browser tests cover empty, one-, two- and four-icon cards, many-row
folders, mixed contents, long titles, three levels of nesting, native separator
semantics, viewport and dashboard-width changes, additions/removals/moves,
renaming, collapse, keyboard traversal/reordering, folder creation, custom-icon
editing/reset, link navigation, drop highlighting, auto-scroll, theme/focus
styling, preference persistence and viewport virtualization above 500 bookmarks.
They use the Dev Workbench's simulated source; they do not load an extension
into a real Firefox bookmark profile. The drag checks use synthetic drag events;
the existing broader browser suite also exercises native mouse dragging.

Before/after screenshots are generated by the browser test under `test-results/`
with the same arrangement, viewport and theme. They show the original setting
and the opt-in compact setting respectively; they are not screenshot snapshots
used as the sole test oracle.

For manual review of `dist-firefox/manifest.json`:

1. Enable nested folders, select Grid view for several sibling folders, and
   enable Compact nested folders in Appearance. Compare folders with 0/1/2/4
   icons and a larger collection. Use two dashboard columns and a wide window
   to see side-by-side cards, then narrow the window and change column counts.
2. Rename a folder to a long name, add/remove/move bookmarks, and expand/collapse
   folders at several nesting levels. Check complete headings, accessible menus,
   boundaries and absence of horizontal scrolling in light and dark themes.
3. Add native separators before, between and after bookmarks. Verify hard row
   breaks only inside that folder, then reorder across a separator and reload.
4. Drag between compact cards, empty folders and parents; check the single
   highlighted destination, edge auto-scroll, cancellation and resulting native
   bookmark hierarchy. Create a subfolder through its parent's menu.
5. Use the existing arrow-key navigation, Enter, Alt+Up/Down and Alt+I. Change and
   reset a custom icon. In a large collection, use End/Home to reach lazy cards
   and verify focus stays visible.
6. Turn compact layout off, switch individual folders to List view, and switch
   nested display off/on. Reload and switch sources to confirm the preference
   persists while bookmarks and per-folder layouts remain source-specific.
