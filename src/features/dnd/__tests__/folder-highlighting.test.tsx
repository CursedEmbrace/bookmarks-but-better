// @vitest-environment jsdom

import type { ReactNode } from "react"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { useFolderDropTarget } from "../use-folder-drop-target"
import { useSortableBookmark } from "../use-sortable-bookmark"

type Target = Parameters<typeof dropTargetForElements>[0]
const targets = new Map<Element, Target>()
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: () => () => {},
  dropTargetForElements: (args: Target) => {
    targets.set(args.element, args)
    return () => {
      targets.delete(args.element)
    }
  },
}))

function Folder({
  id,
  disabled,
  children,
}: {
  id: string
  disabled?: boolean
  children?: ReactNode
}) {
  const { ref, isOver } = useFolderDropTarget({ folderId: id, disabled })
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-testid={id}
      data-active={isOver}
    >
      {children}
    </div>
  )
}

function Row({
  canMove = true,
  canReorder = true,
  destinationReadOnly = false,
}: {
  canMove?: boolean
  canReorder?: boolean
  destinationReadOnly?: boolean
}) {
  const { ref, closestEdge } = useSortableBookmark({
    id: "row",
    folderId: "child",
    index: 0,
    canMove,
    canReorder,
    destinationReadOnly,
  })
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-testid="row"
      data-edge={closestEdge}
    />
  )
}

function mount({ disabled = false, canMove = true, canReorder = true } = {}) {
  return render(
    <>
      <Folder id="parent">
        <Folder id="child" disabled={disabled}>
          <Row
            canMove={canMove}
            canReorder={canReorder}
            destinationReadOnly={disabled}
          />
        </Folder>
        <Folder id="sibling" />
      </Folder>
      <Folder id="unrelated" />
    </>
  )
}

let previous: Target[] = []
let sourceFolder = "outside"
let sourceType = "bookmark"

/** Deliver the adapter's inner-first hierarchy, including updates to ancestors
 * that never left. Source location and direction do not alter that hierarchy. */
function hover(id: string | null) {
  const source = {
    data: { type: sourceType, id: "dragged", folderId: sourceFolder, index: 1 },
    element: document.body,
    dragHandle: null,
  }
  const input = {
    clientX: 0,
    clientY: 0,
    pageX: 0,
    pageY: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    button: 0,
    buttons: 1,
  }
  const current: Target[] = []
  for (
    let element: HTMLElement | null = id ? screen.getByTestId(id) : null;
    element;
    element = element.parentElement
  ) {
    const target = targets.get(element)
    if (target && target.canDrop?.({ source, input, element }) !== false)
      current.push(target)
  }
  const dropTargets = current.map((target) => ({
    element: target.element,
    data: target.getData?.({ source, input, element: target.element }) ?? {},
    dropEffect: "move" as const,
    isActiveDueToStickiness: false,
  }))
  const payload = {
    source,
    location: {
      initial: { input, dropTargets: [] },
      previous: { dropTargets: [] },
      current: { input, dropTargets },
    },
  }
  act(() => {
    for (const target of new Set([...previous, ...current])) {
      const args = {
        ...payload,
        self: dropTargets.find((record) => record.element === target.element)!,
      }
      target.onDropTargetChange?.(args)
      if (!current.includes(target)) target.onDragLeave?.(args)
      else if (!previous.includes(target)) target.onDragEnter?.(args)
      else target.onDrag?.(args)
    }
  })
  previous = current
  return dropTargets
}

function expectActive(id: string | null) {
  for (const folder of ["parent", "child", "sibling", "unrelated"]) {
    expect(screen.getByTestId(folder).dataset.active).toBe(
      String(folder === id)
    )
  }
}

afterEach(() => {
  cleanup()
  targets.clear()
  previous = []
  sourceFolder = "outside"
  sourceType = "bookmark"
})

describe("folder destination highlighting", () => {
  it("moves the primary highlight from parent to child and back without re-entering the parent", () => {
    mount()
    hover("parent")
    expectActive("parent")
    hover("child")
    expectActive("child")
    hover("parent")
    expectActive("parent")
    hover("child")
    expectActive("child")
  })

  it("highlights a child for a bookmark dragged from its parent", () => {
    mount()
    sourceFolder = "parent"
    hover("parent")
    expectActive(null) // same-folder card drops do not move anything
    hover("child")
    expectActive("child")
  })

  it("highlights a parent for a bookmark dragged from its child", () => {
    mount()
    sourceFolder = "child"
    hover("child")
    expectActive(null)
    hover("parent")
    expectActive("parent")
  })

  it("moves between siblings without retaining parent or sibling highlights", () => {
    mount()
    hover("child")
    expectActive("child")
    hover("sibling")
    expectActive("sibling")
    hover("child")
    expectActive("child")
  })

  it("highlights the destination folder while its bookmark row is the innermost target", () => {
    mount()
    hover("row")
    expectActive("child")
    expect(screen.getByTestId("row").dataset.edge).toBe("top")
    hover("parent")
    expectActive("parent")
    expect(screen.getByTestId("row").dataset.edge).toBeUndefined()
  })

  it("clears highlights on invalid targets and does not fall through to the parent", () => {
    mount({ disabled: true })
    hover("parent")
    expectActive("parent")
    const records = hover("child")
    expect(records[0].data).toMatchObject({
      folderId: "child",
      isDropAllowed: false,
    })
    expectActive(null)
    expect(hover("row")[0].data.isDropAllowed).toBe(false)
    expectActive(null)
    expect(screen.getByTestId("row").dataset.edge).toBeUndefined()
  })

  it("hides folder and row indicators when the required move capability is absent", () => {
    mount({ canMove: false })
    const records = hover("row")
    expect(records[0].data.isDropAllowed).toBe(false)
    expectActive(null)
    expect(screen.getByTestId("row").dataset.edge).toBeUndefined()
  })

  it("uses reorder capability for same-folder rows, independently of move capability", () => {
    mount({ canMove: false })
    sourceFolder = "child"
    hover("row")
    expectActive("child")
  })

  it("does not highlight same-folder rows when ordering is unavailable", () => {
    mount({ canReorder: false })
    sourceFolder = "child"
    hover("row")
    expectActive(null)
    expect(screen.getByTestId("row").dataset.edge).toBeUndefined()
  })

  it("clears on leaving all targets, cancellation and completion", () => {
    mount()
    hover("child")
    hover(null)
    expectActive(null)
    hover("parent")
    act(() => {
      for (const target of targets.values())
        target.onDrop?.({} as Parameters<NonNullable<Target["onDrop"]>>[0])
    })
    expectActive(null)
  })

  it("does not highlight folders for folder-card or external drags", () => {
    mount()
    sourceType = "folder-card"
    expect(hover("child")).toHaveLength(0)
    expectActive(null)
    sourceType = "external"
    expect(hover("child")).toHaveLength(0)
    expectActive(null)
  })

  it("unregisters all targets on unmount", () => {
    const view = mount()
    hover("child")
    view.unmount()
    expect(targets.size).toBe(0)
  })
})
