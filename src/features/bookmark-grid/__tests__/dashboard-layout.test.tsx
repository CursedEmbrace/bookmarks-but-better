// @vitest-environment jsdom
import * as React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { DashboardLayout } from "../dashboard-layout"
import { DashboardLayoutContext } from "../dashboard-layout-context"
import { BookmarkGrid } from "../bookmark-grid"
import { GridErrorBoundary } from "@/features/safety-net/grid-error-boundary"

let available = 1440
let rem = 16
let gap = 16
class Observer {
  static live = new Set<Observer>()
  targets = new Set<Element>()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    Observer.live.add(this)
  }
  observe(el: Element) {
    this.targets.add(el)
  }
  disconnect() {
    this.targets.clear()
    Observer.live.delete(this)
  }
}
const paints = vi.fn()
function ReadLayout() {
  const layout = React.useContext(DashboardLayoutContext)!
  paints()
  return (
    <output>
      {JSON.stringify({ count: layout.columnCount, width: layout.groupWidth })}
    </output>
  )
}
const result = () => JSON.parse(screen.getByRole("status").textContent!)
const notify = () =>
  act(() => {
    for (const observer of Observer.live)
      observer.callback([], observer as unknown as ResizeObserver)
  })

beforeEach(() => {
  available = 1440
  rem = 16
  gap = 16
  vi.stubGlobal("ResizeObserver", Observer)
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        width: this.hasAttribute("data-dashboard-available")
          ? available
          : this.style.width === "17rem"
            ? 17 * rem
            : 0,
        height: this.style.width === "17rem" ? gap : 0,
      } as DOMRect
    }
  )
  const root = {
    id: "root",
    title: "Root",
    children: Array.from({ length: 8 }, (_, i) => ({
      id: `folder${i}`,
      title: `Folder ${i}`,
      children: [],
    })),
  }
  useBookmarkStore.setState({ tree: [root], rootFolder: root })
  usePreferencesStore.setState({
    safeMode: false,
    nestedFolders: true,
    experimentalCardDrag: false,
    folderOrder: [],
    maxColumns: 6,
    containerMode: "contained",
  })
  paints.mockClear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  expect(Observer.live.size).toBe(0)
})

it("measures before paint, ignores unchanged callbacks and disconnects in StrictMode", () => {
  const view = render(
    <React.StrictMode>
      <DashboardLayout>
        <ReadLayout />
      </DashboardLayout>
    </React.StrictMode>
  )
  expect(result()).toEqual({ count: 5, width: 1440 })
  expect(Observer.live.size).toBe(1)
  expect([...Observer.live][0].targets.size).toBe(2)
  const previous = paints.mock.calls.length
  notify()
  notify()
  expect(paints).toHaveBeenCalledTimes(previous)
  view.unmount()
  expect(Observer.live.size).toBe(0)
})

it("responds to text scale and usable width without a window breakpoint", () => {
  render(
    <DashboardLayout>
      <ReadLayout />
    </DashboardLayout>
  )
  available = 704
  rem = 32
  gap = 32
  notify()
  expect(result()).toEqual({ count: 1, width: 704 })
  available = 1100
  notify()
  expect(result()).toEqual({ count: 1, width: 1088 })
  available = 1120
  notify()
  expect(result()).toEqual({ count: 2, width: 1120 })
})

it("handles hidden/remounted bounds, empty collections and live preferences", () => {
  const view = render(
    <DashboardLayout>
      <ReadLayout />
    </DashboardLayout>
  )
  available = 0
  notify()
  expect(result().count).toBe(5)
  available = 600
  notify()
  expect(result()).toEqual({ count: 2, width: 600 })
  act(() =>
    usePreferencesStore.setState({ maxColumns: 1, containerMode: "fluid" })
  )
  expect(result()).toEqual({ count: 1, width: 544 })
  expect(Observer.live.size).toBe(1)
  act(() => useBookmarkStore.setState({ tree: [], rootFolder: null }))
  expect(result()).toEqual({ count: 1, width: 600 })
  view.unmount()
  available = 230
  render(
    <DashboardLayout>
      <ReadLayout />
    </DashboardLayout>
  )
  expect(result()).toEqual({ count: 1, width: 230 })
})

it("keeps collection failures inside the grid safety net and avoids collection in safe mode", () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const readChildren = vi.fn(() => {
    throw new Error("fixture collection failure")
  })
  const root = {
    id: "broken",
    title: "Broken",
    get children(): [] {
      return readChildren()
    },
  }
  useBookmarkStore.setState({ tree: [root], rootFolder: root })
  const view = render(
    <DashboardLayout>
      <header>Available header</header>
      <GridErrorBoundary>
        <BookmarkGrid />
      </GridErrorBoundary>
    </DashboardLayout>
  )
  expect(screen.getByRole("banner").textContent).toBe("Available header")
  expect(screen.getByRole("alert").textContent).toContain(
    "fixture collection failure"
  )
  expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy()
  view.unmount()
  readChildren.mockClear()
  usePreferencesStore.setState({ safeMode: true })
  render(
    <DashboardLayout>
      <ReadLayout />
    </DashboardLayout>
  )
  expect(readChildren).not.toHaveBeenCalled()
  expect(result().width).toBe(1440)
})
