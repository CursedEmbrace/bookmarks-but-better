import type { BookmarkNode } from "@/browser"

/** Icon changes follow the node's content permissions, not its folder's order permissions. */
export function canEditCustomIcon(bookmark: BookmarkNode): boolean {
  return (
    bookmark.url !== undefined &&
    bookmark.type !== "separator" &&
    !bookmark.readOnly
  )
}
