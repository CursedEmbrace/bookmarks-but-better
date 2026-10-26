import { useEffect, useRef, useState } from "react"
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { DND_TYPE, type BookmarkDragData } from "./types"
import type {
  ElementDragType,
  BaseEventPayload,
} from "@atlaskit/pragmatic-drag-and-drop/types"

interface UseFolderDropTargetInput {
  folderId: string
  disabled?: boolean
}

/**
 * Makes a folder card a drop target for bookmark items.
 * Used to enable dropping bookmarks into a folder (especially empty ones).
 */
export function useFolderDropTarget({
  folderId,
  disabled = false,
}: UseFolderDropTargetInput) {
  const ref = useRef<HTMLElement | null>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function update({ location }: BaseEventPayload<ElementDragType>) {
      const target = location.current.dropTargets[0]?.data
      // The innermost target is also the one DndMonitor will actually use.
      // Ancestors remain in the hierarchy when entering/leaving a child, so
      // enter/leave alone cannot describe which folder is the destination.
      setIsOver(
        target?.isDropAllowed !== false &&
          (target?.type === "folder-drop-target" ||
            target?.type === DND_TYPE.BOOKMARK) &&
          target.folderId === folderId
      )
    }

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const data = source.data as unknown as BookmarkDragData
        return data.type === DND_TYPE.BOOKMARK
      },
      // Keep a non-actionable inner target in the hierarchy: rejecting it via
      // canDrop would silently turn its ancestor into the destination.
      getData: ({ source }) => ({
        type: "folder-drop-target",
        folderId,
        isDropAllowed: !disabled && source.data.folderId !== folderId,
      }),
      onDragStart: update,
      onDragEnter: update,
      onDropTargetChange: update,
      onDrag: update,
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [folderId, disabled])

  return { ref, isOver }
}
