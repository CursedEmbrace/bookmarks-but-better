import type { CSSProperties } from "react"
import type { BookmarkNode } from "@/browser"

/**
 * The longest direct icon run supplies the card's preferred minimum width.
 * Separators end a run inside this card only; subfolders have their own layout.
 * Six icons is enough intrinsic width before a large collection wraps.
 */
export function compactFolderStyle(
  folder: BookmarkNode,
  collapsed: boolean
): CSSProperties {
  let longest = 0
  let run = 0
  if (!collapsed) {
    for (const child of folder.children ?? []) {
      if (child.type === "separator") run = 0
      else if (child.url !== undefined) {
        run++
        longest = Math.max(longest, Math.min(run, 6))
        if (longest === 6) break
      }
    }
  }
  // Each tile: 40px favicon + p-2 + 2px border. Match gap-1 and p-4,
  // using the theme's spacing token so changing spacing still fits the icons.
  const iconWidth = `calc(${longest * 42}px + var(--spacing) * ${longest * 4 + Math.max(0, longest - 1) + 8})`
  return {
    width: "max-content",
    minWidth: `min(100%, max(10rem, ${iconWidth}))`,
    maxWidth: "min(100%, 26rem)",
  }
}
