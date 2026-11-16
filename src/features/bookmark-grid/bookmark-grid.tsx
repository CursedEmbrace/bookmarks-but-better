import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { useCardDisplay } from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import { useSortableFolder, DropIndicator } from "@/features/dnd"
import { autoScrollDashboard } from "@/features/dnd/auto-scroll"
import type { BookmarkNode } from "@/browser"
import { cn } from "@/lib/utils"
import { DashboardLayout } from "./dashboard-layout"
import { DashboardLayoutContext } from "./dashboard-layout-context"
import {
  distributeToColumns,
  estimateCardHeight,
  useMeasuredCardHeights,
} from "./card-heights"
import { LazyCard } from "./lazy-card"
import { LazyCardsContext, shouldGateCards } from "./lazy-cards-gate"
import { BookmarkGridEmpty } from "./bookmark-grid-empty"
import { GridNavigationContext, useGridNavigation } from "./use-grid-navigation"

function SortableFolderCard({
  folder,
  sortableIndex,
}: {
  folder: BookmarkNode
  sortableIndex: number
}) {
  const { ref, handleRef, isDragging, closestEdge } = useSortableFolder({
    id: folder.id,
    index: sortableIndex,
  })

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={cn("relative", isDragging && "opacity-40")}
    >
      <BookmarkCard folder={folder} dragHandleRef={handleRef} />
      <DropIndicator edge={closestEdge} />
    </div>
  )
}

export function BookmarkGrid() {
  const layout = React.useContext(DashboardLayoutContext)
  // Keep the grid independently renderable (tests and embedded consumers).
  // In App the header and grid already share the surrounding layout owner.
  return layout ? (
    <BookmarkGridContent />
  ) : (
    <DashboardLayout>
      <BookmarkGridContent />
    </DashboardLayout>
  )
}

function BookmarkGridContent() {
  const layout = React.useContext(DashboardLayoutContext)!
  if (layout.collectionError) throw layout.collectionError
  const {
    folders,
    displayRoot,
    experimentalCardDrag,
    columnCount,
    columnWidth,
    gap,
  } = layout
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const mutationError = useBookmarkStore((s) => s.mutationError)
  const mutationDialogOpen = useUIStore((s) =>
    Boolean(
      s.creatingItem ||
      s.editingBookmark ||
      s.deletingItem ||
      s.bookmarkOrganizerOpen
    )
  )
  const display = useCardDisplay()

  const gateCards = React.useMemo(
    () => (displayRoot ? shouldGateCards(displayRoot) : false),
    [displayRoot]
  )

  const folderIndexMap = React.useMemo(() => {
    const map = new Map<string, number>()
    folders.forEach((f, i) => map.set(f.id, i))
    return map
  }, [folders])

  const { heights, measureRefs } = useMeasuredCardHeights(
    folders,
    columnCount,
    display,
    columnWidth
  )

  const columns = React.useMemo(
    () => distributeToColumns(folders, columnCount, display, heights, gap),
    [folders, columnCount, display, heights, gap]
  )

  // The grid is one composite widget: `columns` is the visual order the arrow
  // keys travel, so the keyboard model is derived from the same distribution
  // the layout is.
  const { navigation, containerProps } = useGridNavigation({
    columns,
    display,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        Loading bookmarks...
      </div>
    )
  }

  if (folders.length === 0) {
    return <BookmarkGridEmpty />
  }

  return (
    <div ref={autoScrollDashboard} className="w-full min-w-0">
      <GridNavigationContext value={navigation}>
        {mutationError && !mutationDialogOpen && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {mutationError}
          </p>
        )}
        <LazyCardsContext value={gateCards}>
          <div
            {...containerProps}
            className="grid w-full min-w-0 items-start gap-4"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
            }}
          >
            {columns.map((columnFolders, colIndex) => (
              <div key={colIndex} className="flex min-w-0 flex-col gap-4">
                {columnFolders.map((folder) => (
                  // The lazy wrapper is what the ResizeObserver watches: it is
                  // the only element that exists in both the draggable and
                  // plain variants, and it is only measured while the card is
                  // real rather than a placeholder.
                  <LazyCard
                    key={folder.id}
                    folder={folder}
                    display={display}
                    estimatedHeight={estimateCardHeight(folder, display)}
                    measureRef={measureRefs.get(folder.id)}
                  >
                    {experimentalCardDrag ? (
                      <SortableFolderCard
                        folder={folder}
                        sortableIndex={folderIndexMap.get(folder.id) ?? 0}
                      />
                    ) : (
                      <BookmarkCard folder={folder} />
                    )}
                  </LazyCard>
                ))}
              </div>
            ))}
          </div>
        </LazyCardsContext>
      </GridNavigationContext>
    </div>
  )
}
