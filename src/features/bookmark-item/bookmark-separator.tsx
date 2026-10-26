import * as React from "react"
import type { BookmarkNode } from "@/browser"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSortableBookmark, DropIndicator } from "@/features/dnd"
import { useGridItem } from "@/features/bookmark-grid/use-grid-navigation"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { cn } from "@/lib/utils"

/** A full-width entry in its own folder, never a link or favicon request. */
export const BookmarkSeparator = React.memo(function BookmarkSeparator({
  bookmark,
  folderId,
  sortableIndex,
  folderReadOnly,
  orderReadOnly,
}: {
  bookmark: BookmarkNode
  folderId: string
  sortableIndex: number
  folderReadOnly?: boolean
  orderReadOnly?: boolean
}) {
  const adapter = useBookmarkStore((s) => s.adapter)
  const gridItem = useGridItem(bookmark.id)
  const [menuOpen, setMenuOpen] = React.useState(false)
  // Keep this latched through dragend (including Escape cancellation). Only
  // a fresh pointer press or keyboard activation may open the menu again.
  const suppressClick = React.useRef(false)
  const cancelMenuGesture = () => {
    suppressClick.current = true
    setMenuOpen(false)
  }
  const canMove = adapter?.capabilities.move ?? false
  const canReorder = !orderReadOnly && (adapter?.capabilities.reorder ?? false)
  const { ref, isDragging, closestEdge } = useSortableBookmark({
    id: bookmark.id,
    index: sortableIndex,
    folderId,
    // Even in a grid, a full-width divider has a before and after edge.
    layout: "list",
    canMove,
    canReorder,
    destinationReadOnly: folderReadOnly,
    disabled: bookmark.readOnly || (!canMove && !canReorder),
  })
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-testid="bookmark-separator"
      onDragStartCapture={cancelMenuGesture}
      onPointerCancel={cancelMenuGesture}
      className={cn(
        "relative col-span-full min-w-0",
        isDragging && "opacity-40"
      )}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open, details) => {
          if (open && suppressClick.current) {
            details.cancel()
            return
          }
          setMenuOpen(open)
        }}
      >
        <DropdownMenuTrigger
          {...gridItem}
          onPointerDown={(event) => {
            suppressClick.current = false
            // Base UI normally opens on mousedown and then skips the click
            // following pointerdown. Defer both to the completed click so
            // pressing this drag handle never opens a popup over drop targets.
            event.preventBaseUIHandler()
          }}
          onMouseDown={(event) => event.preventBaseUIHandler()}
          onClick={(event) => {
            if (suppressClick.current) {
              event.preventBaseUIHandler()
              event.preventDefault()
              event.stopPropagation()
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              suppressClick.current = false
            }
            gridItem.onKeyDown(event)
            // Base UI also uses arrows to open menus. These belong to the
            // dashboard's navigation/reordering; Enter and Space open actions.
            if (
              event.key.startsWith("Arrow") ||
              event.key === "Home" ||
              event.key === "End"
            )
              event.preventBaseUIHandler()
          }}
          render={
            <button
              type="button"
              aria-label="Separator actions"
              className="flex h-5 w-full cursor-grab items-center rounded px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        >
          <span
            role="separator"
            aria-label="Bookmark separator"
            className="h-px w-full bg-border"
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          finalFocus={() =>
            !suppressClick.current &&
            !useUIStore.getState().bookmarkOrganizerOpen &&
            !useUIStore.getState().deletingItem
          }
        >
          <DropdownMenuItem
            onClick={() =>
              useUIStore.getState().revealInBookmarkOrganizer(bookmark.id)
            }
          >
            Organize separator
          </DropdownMenuItem>
          {!bookmark.readOnly && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                useUIStore.getState().openDeleteConfirm({
                  id: bookmark.id,
                  title: "Separator",
                  type: "separator",
                })
              }
            >
              Delete separator
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropIndicator edge={closestEdge} />
    </div>
  )
})
