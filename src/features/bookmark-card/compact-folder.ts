import { isSeparator } from "@/lib/bookmark-utils"
import type { CSSProperties } from "react"
import type { BookmarkNode } from "@/browser"

/**
 * Compact nested-folder layout policy, in one place (the root policy lives in
 * `bookmark-grid/dashboard-sizing.ts`). Provisional values, tuned by eye
 * against the compact-nested-folders UI tests.
 */
/** Icons in the longest run that still widen a card before it wraps. */
export const COMPACT_MAX_RUN_ICONS = 6
/** One grid tile's fixed width: 40px favicon + 2px border (p-2 is spacing). */
export const COMPACT_TILE_PX = 42
/** Narrowest a compact card gets, so short titles still read. */
export const COMPACT_MIN_REM = 10
/** Widest a compact card gets, independent of the root card width. */
export const COMPACT_MAX_REM = 26

/**
 * The longest direct icon run supplies the card's preferred minimum width.
 * Separators end a run inside this card only; subfolders have their own layout.
 */
export function compactFolderStyle(
  folder: BookmarkNode,
  collapsed: boolean
): CSSProperties {
  let longest = 0
  let run = 0
  if (!collapsed) {
    for (const child of folder.children ?? []) {
      if (isSeparator(child)) run = 0
      else if (child.url !== undefined) {
        run++
        longest = Math.max(longest, Math.min(run, COMPACT_MAX_RUN_ICONS))
        if (longest === COMPACT_MAX_RUN_ICONS) break
      }
    }
  }
  // Each tile adds p-2 (4 spacing units); tiles are gap-1 apart and the card
  // has p-4 on both sides (8 units). Using the theme's spacing token keeps
  // the icons fitting if spacing changes.
  const iconWidth = `calc(${longest * COMPACT_TILE_PX}px + var(--spacing) * ${longest * 4 + Math.max(0, longest - 1) + 8})`
  return {
    width: "max-content",
    minWidth: `min(100%, max(${COMPACT_MIN_REM}rem, ${iconWidth}))`,
    maxWidth: `min(100%, ${COMPACT_MAX_REM}rem)`,
  }
}
