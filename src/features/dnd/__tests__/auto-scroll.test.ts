// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { autoScrollDashboard } from "../auto-scroll"

type Monitor = Parameters<typeof monitorForElements>[0]
let monitor: Monitor
const unregister = vi.fn()
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  monitorForElements: (args: Monitor) => {
    monitor = args
    return unregister
  },
}))

let root: HTMLDivElement
let outer: HTMLDivElement
let hit: Element | null
let cleanup: () => void
let time: number
let nextId: number
let frames: Map<number, FrameRequestCallback>

function scrollBox(top = 0, height = 400, contentHeight = 1000) {
  const element = document.createElement("div")
  element.style.overflowY = "auto"
  Object.defineProperties(element, {
    clientHeight: { value: height },
    scrollHeight: { value: contentHeight },
  })
  element.getBoundingClientRect = () => ({
    top,
    bottom: top + height,
    left: 0,
    right: 500,
    width: 500,
    height,
    x: 0,
    y: top,
    toJSON() {},
  })
  element.scrollTo = vi.fn((options: ScrollToOptions | number) => {
    if (typeof options !== "number") element.scrollTop = options.top ?? 0
  }) as typeof element.scrollTo
  return element
}

function advance() {
  time += 16
  const callbacks = [...frames.values()]
  frames.clear()
  for (const callback of callbacks) callback(time)
}

function move(y: number) {
  hit?.dispatchEvent(
    new DragEvent("dragover", { clientX: 200, clientY: y, bubbles: true })
  )
}

function start(y = 390) {
  monitor.onDragStart?.({
    location: { current: { input: { clientX: 200, clientY: y } } },
  } as Parameters<NonNullable<Monitor["onDragStart"]>>[0])
}

beforeEach(() => {
  frames = new Map()
  time = 0
  nextId = 0
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++nextId, cb)
    return nextId
  })
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id))
  vi.stubGlobal("DragEvent", MouseEvent)
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => hit),
  })
  outer = scrollBox()
  root = document.createElement("div")
  outer.append(root)
  document.body.append(outer)
  hit = root
  cleanup = autoScrollDashboard(root)
})

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("dashboard drag auto-scroll", () => {
  it("scrolls down and smoothly increases speed towards the bottom edge", () => {
    start(350)
    advance()
    const slow = outer.scrollTop
    expect(slow).toBeGreaterThan(0)
    move(390)
    advance()
    const fast = outer.scrollTop - slow
    expect(fast).toBeGreaterThan(slow)
    expect(outer.scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "instant" })
    )
  })

  it("scrolls upwards at the upper edge", () => {
    outer.scrollTop = 300
    start(10)
    advance()
    expect(outer.scrollTop).toBeLessThan(300)
  })

  it("stops immediately outside the edge band and resumes on return", () => {
    start()
    advance()
    move(200)
    const stopped = outer.scrollTop
    expect(frames.size).toBe(0)
    advance()
    expect(outer.scrollTop).toBe(stopped)
    move(390)
    advance()
    expect(outer.scrollTop).toBeGreaterThan(stopped)
  })

  it.each(["drop", "dragend", "Escape", "monitor", "unmount"])(
    "cleans up frames and listeners on %s",
    (end) => {
      start()
      advance()
      if (end === "unmount") cleanup()
      else if (end === "monitor")
        monitor.onDrop?.({} as Parameters<NonNullable<Monitor["onDrop"]>>[0])
      else if (end === "Escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
      else window.dispatchEvent(new Event(end))
      const stopped = outer.scrollTop
      expect(frames.size).toBe(0)
      move(390)
      advance()
      expect(outer.scrollTop).toBe(stopped)
      expect(frames.size).toBe(0)
      if (end === "unmount") expect(unregister).toHaveBeenCalled()
    }
  )

  it("pauses on leaving the window and resumes on re-entry", () => {
    start()
    window.dispatchEvent(new DragEvent("dragleave", { relatedTarget: null }))
    expect(frames.size).toBe(0)
    move(390)
    advance()
    expect(outer.scrollTop).toBeGreaterThan(0)
  })

  it("pauses on blur but can resume if the same drag returns", () => {
    start()
    advance()
    window.dispatchEvent(new Event("blur"))
    const stopped = outer.scrollTop
    expect(frames.size).toBe(0)
    advance()
    expect(outer.scrollTop).toBe(stopped)
    move(390)
    advance()
    expect(outer.scrollTop).toBeGreaterThan(stopped)
  })

  it.each([0, 600])(
    "does not schedule a loop at scroll boundary %s",
    (boundary) => {
      outer.scrollTop = boundary
      start(boundary === 0 ? 10 : 390)
      expect(frames.size).toBe(0)
      expect(outer.scrollTo).not.toHaveBeenCalled()
    }
  )

  it.each([1, 599])(
    "stops its loop on reaching the boundary from %s",
    (initial) => {
      outer.scrollTop = initial
      start(initial === 1 ? 10 : 390)
      advance()
      expect(outer.scrollTop).toBe(initial === 1 ? 0 : 600)
      expect(frames.size).toBe(0)
    }
  )

  it("prefers the nested scroll container and does not chain at its boundary", () => {
    const inner = scrollBox(200, 200, 500)
    root.append(inner)
    hit = inner
    start()
    advance()
    expect(inner.scrollTop).toBeGreaterThan(0)
    expect(outer.scrollTop).toBe(0)
    inner.scrollTop = 300
    advance()
    expect(frames.size).toBe(0)
    expect(outer.scrollTop).toBe(0)
    hit = root
    move(390)
    advance()
    expect(outer.scrollTop).toBeGreaterThan(0)
  })

  it("uses the visible edge when a nested container is clipped", () => {
    const inner = scrollBox(200, 400, 1000)
    root.append(inner)
    hit = inner
    start(390)
    advance()
    expect(inner.scrollTop).toBeGreaterThan(0)
    expect(outer.scrollTop).toBe(0)
  })

  it("ignores non-scrollable and overflow-hidden descendants", () => {
    const inner = scrollBox(200, 200, 500)
    inner.style.overflowY = "hidden"
    root.append(inner)
    hit = inner
    start()
    advance()
    expect(inner.scrollTop).toBe(0)
    expect(outer.scrollTop).toBeGreaterThan(0)
  })

  it("does not scroll unrelated panels or after the grid is removed", () => {
    const unrelated = scrollBox()
    outer.append(unrelated)
    hit = unrelated
    start()
    expect(frames.size).toBe(0)
    hit = root
    move(390)
    root.remove()
    advance()
    expect(outer.scrollTop).toBe(0)
    expect(frames.size).toBe(0)
  })

  it("refreshes the adapter at the newly hit element without pointer movement", () => {
    const newTarget = document.createElement("div")
    root.append(newTarget)
    const dragover = vi.fn()
    newTarget.addEventListener("dragover", dragover)
    start()
    hit = newTarget
    advance()
    expect(dragover).toHaveBeenCalledOnce()
    expect(dragover.mock.calls[0][0]).toMatchObject({
      clientX: 200,
      clientY: 390,
    })
    expect(frames.size).toBe(1)
  })

  it("only monitors dashboard bookmark and folder-card drags", () => {
    const accepts = (element: HTMLElement, type: string) =>
      monitor.canMonitor?.({
        source: { element, dragHandle: null, data: { type } },
        initial: {
          dropTargets: [],
          input: {
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
          },
        },
      })
    expect(accepts(root, "bookmark")).toBe(true)
    expect(accepts(root, "folder-card")).toBe(true)
    expect(accepts(root, "external")).toBe(false)
    expect(accepts(document.body, "bookmark")).toBe(false)
    expect(frames.size).toBe(0)
  })
})
