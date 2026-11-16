// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isFocusKept, keepFocusInView } from "../focus-keep"

const BOUNDS = { top: 0, bottom: 500 }
let frames: FrameRequestCallback[] = []
let top = 0
let resize: (() => void) | null = null

function runFrames() {
  while (frames.length) {
    const pending = frames
    frames = []
    for (const callback of pending) callback(performance.now())
  }
}

/** A reflow of the scrolling content, as a mounted batch of cards causes. */
function reflow(newTop: number) {
  top = newTop
  resize?.()
  runFrames()
}

function focusedLink() {
  const link = document.createElement("a")
  link.href = "https://example.test/"
  document.body.append(link)
  link.focus()
  link.getBoundingClientRect = () =>
    ({ top, bottom: top + 40 }) as unknown as DOMRect
  link.scrollIntoView = vi.fn(() => {
    top = 400
  })
  return link
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  frames = []
  top = 100
  resize = null
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {
        resize = null
      }
    }
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("keepFocusInView", () => {
  it("scrolls a focus that a reflow pushed out back into view", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    runFrames()
    reflow(600)
    expect(link.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(isFocusKept(link)).toBe(true)
  })

  it("still corrects a batch that commits late, as long as layout keeps changing", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    runFrames()
    vi.advanceTimersByTime(250)
    reflow(120)
    vi.advanceTimersByTime(250)
    reflow(700)
    expect(link.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("lets go once the layout has been quiet, without fighting a later scroll", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    runFrames()
    vi.advanceTimersByTime(300)
    expect(isFocusKept(link)).toBe(false)
    reflow(900)
    expect(link.scrollIntoView).not.toHaveBeenCalled()
  })

  it("restarts the quiet period when another batch mounts", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    vi.advanceTimersByTime(250)
    keepFocusInView(link, BOUNDS)
    vi.advanceTimersByTime(250)
    expect(isFocusKept(link)).toBe(true)
  })

  it("never holds the scroll longer than the hard cap", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    for (let elapsed = 0; elapsed < 2000; elapsed += 200) {
      vi.advanceTimersByTime(200)
      reflow(100)
    }
    expect(isFocusKept(link)).toBe(false)
  })

  it.each(["wheel", "pointerdown", "keydown", "touchmove"])(
    "lets go as soon as the user acts (%s)",
    (input) => {
      const link = focusedLink()
      keepFocusInView(link, BOUNDS)
      window.dispatchEvent(new Event(input))
      expect(isFocusKept(link)).toBe(false)
      reflow(600)
      expect(link.scrollIntoView).not.toHaveBeenCalled()
    }
  )

  it("lets go when something scrolls the focus far out of view", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    runFrames()
    top = 5000
    window.dispatchEvent(new Event("scroll"))
    expect(isFocusKept(link)).toBe(false)
  })

  it("keeps going when a reflow only nudges the focus past the edge", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    runFrames()
    top = 520
    window.dispatchEvent(new Event("scroll"))
    expect(isFocusKept(link)).toBe(true)
  })

  it("lets go when focus moves elsewhere", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    const other = document.createElement("button")
    document.body.append(other)
    other.focus()
    reflow(600)
    expect(isFocusKept(link)).toBe(false)
    expect(link.scrollIntoView).not.toHaveBeenCalled()
  })
})
