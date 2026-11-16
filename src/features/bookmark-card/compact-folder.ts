import { isFolderNode, isSeparator } from "@/lib/bookmark-utils"
import type { CSSProperties } from "react"
import type { BookmarkNode } from "@/browser"
import type { CardDisplay } from "@/stores/preferences-store"
import { cardSpacing } from "./card-spacing"

/**
 * Compact nested-folder layout policy, in one place (the root policy lives in
 * `bookmark-grid/dashboard-sizing.ts`, spacing by depth in `card-spacing.ts`).
 * Provisional values, tuned by eye against Jaime's own nested folders.
 */
/** Icons in the longest run that still widen a card before it wraps. */
export const COMPACT_MAX_RUN_ICONS = 6
/** One grid tile's fixed width: 40px favicon + 2px border (p-2 is spacing). */
export const COMPACT_TILE_PX = 42
/** Spacing units per tile beyond its fixed width: p-2 on both sides. */
const TILE_SPACING_UNITS = 4
/**
 * Narrowest a compact card gets: room for the header's collapse and menu
 * buttons (about 4.5rem with their gaps) plus a few letters of title, even
 * at depth on a narrow screen. Cards with longer titles hug those instead.
 */
export const COMPACT_MIN_REM = 8
/**
 * Used only to decide which of several minimum widths is largest before
 * emitting it as CSS; the emitted width still follows the real theme token
 * and root font size.
 */
const ASSUMED_SPACING_PX = 4
/**
 * Subfolders give up their parent's side padding only when the parent's body
 * is narrower than this (Cody's deep-nesting rule), so headers stay readable
 * at depth and large text. A card holding compact subfolders is sized to keep
 * at least this much body, so a card that merely hugs small content never
 * triggers it; only a genuinely narrow screen does.
 */
export const RECLAIM_BELOW_REM = 12
const ASSUMED_REM_PX = 16

/** A minimum width as CSS, with a pixel estimate for picking the widest. */
interface Width {
  css: string
  estimate: number
}

type CompactDisplay = Pick<
  CardDisplay,
  "nestedFolders" | "cardLayouts" | "collapsedFolders"
>

const FLOOR: Width = {
  css: `${COMPACT_MIN_REM}rem`,
  estimate: COMPACT_MIN_REM * ASSUMED_REM_PX,
}

function plusSpacing(width: Width, units: number): Width {
  return {
    css: `calc(${width.css} + var(--spacing) * ${units})`,
    estimate: width.estimate + units * ASSUMED_SPACING_PX,
  }
}

function widest(widths: Width[]): Width {
  return widths.reduce((a, b) => (b.estimate > a.estimate ? b : a))
}

/**
 * The narrowest a compact card can be without squeezing what it holds: the
 * readable floor, its longest icon run, and every compact subfolder it shows
 * (at that subfolder's own minimum), each plus this card's padding on both
 * sides. Counting subfolders is what keeps a one-icon folder that holds a
 * wider subfolder from collapsing its padding. Only the widest candidate is
 * emitted, so the CSS grows with depth, not with the size of the tree.
 */
function minimumWidth(
  folder: BookmarkNode,
  display: CompactDisplay,
  depth: number
): Width {
  const padding = cardSpacing(depth).padding * 2
  if (display.collapsedFolders[folder.id]) return FLOOR

  let longest = 0
  let run = 0
  let holdsSubfolders = false
  const candidates: Width[] = [FLOOR]
  for (const child of folder.children ?? []) {
    if (isSeparator(child)) run = 0
    else if (child.url !== undefined) {
      run++
      longest = Math.max(longest, Math.min(run, COMPACT_MAX_RUN_ICONS))
    } else if (
      display.nestedFolders &&
      isFolderNode(child) &&
      display.cardLayouts[child.id] === "grid"
    ) {
      holdsSubfolders = true
      candidates.push(
        plusSpacing(minimumWidth(child, display, depth + 1), padding)
      )
    }
  }
  if (holdsSubfolders) {
    candidates.push(
      plusSpacing(
        {
          css: `${RECLAIM_BELOW_REM}rem`,
          estimate: RECLAIM_BELOW_REM * ASSUMED_REM_PX,
        },
        padding
      )
    )
  }
  if (longest > 0) {
    // Tiles sit gap-1 (one unit) apart.
    candidates.push(
      plusSpacing(
        {
          css: `${longest * COMPACT_TILE_PX}px`,
          estimate: longest * COMPACT_TILE_PX,
        },
        longest * TILE_SPACING_UNITS + (longest - 1) + padding
      )
    )
  }
  return widest(candidates)
}

/** That narrowest width as CSS. */
export function compactMinimumWidthCss(
  folder: BookmarkNode,
  display: CompactDisplay,
  depth: number
): string {
  return minimumWidth(folder, display, depth).css
}

/**
 * Sizing for one compact subfolder card inside a wrapping row.
 *
 * Its natural width hugs its content (`max-content`), never below what it
 * holds. Rows are justified like text: a card that shares a row with others
 * grows to fill the row's leftover space, so right edges line up. The row
 * container's trailing filler keeps the last row at natural width.
 */
export function compactFolderStyle(
  folder: BookmarkNode,
  display: CompactDisplay,
  depth: number
): CSSProperties {
  return {
    width: "max-content",
    minWidth: `min(100%, ${compactMinimumWidthCss(folder, display, depth)})`,
    maxWidth: "100%",
    flexGrow: 1,
  }
}
