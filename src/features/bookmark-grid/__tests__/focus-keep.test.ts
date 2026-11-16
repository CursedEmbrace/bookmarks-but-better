// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isFocusKept, keepFocusInView } from "../focus-keep"

const BOUNDS = { top: 0, bottom: 500 }
let frames: FrameRequestCallback[] = []
let top = 0

function runFrame() {
  const pending = frames
  frames = []
  for (const callback of pending) callback(performance.now())
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
  frames = []
  top = 100
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

describe("keepFocusInView", () => {
  it("scrolls a focus that a reflow pushed out back into view", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    top = 600
    runFrame()
    expect(link.scrollIntoView).toHaveBeenCalledTimes(1)
    expect(isFocusKept(link)).toBe(true)
  })

  it("lets go once the focus has stayed in view for a few frames", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    for (let i = 0; i < 3; i++) runFrame()
    expect(isFocusKept(link)).toBe(true)
    runFrame()
    expect(isFocusKept(link)).toBe(false)
    // A later scroll nobody made with an input is not fought.
    top = 900
    runFrame()
    expect(link.scrollIntoView).not.toHaveBeenCalled()
  })

  it("restarts the settling count when another batch mounts", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    for (let i = 0; i < 3; i++) runFrame()
    keepFocusInView(link, BOUNDS)
    for (let i = 0; i < 3; i++) runFrame()
    expect(isFocusKept(link)).toBe(true)
  })

  it.each(["wheel", "pointerdown", "keydown", "touchmove"])(
    "lets go as soon as the user acts (%s)",
    (input) => {
      const link = focusedLink()
      keepFocusInView(link, BOUNDS)
      window.dispatchEvent(new Event(input))
      expect(isFocusKept(link)).toBe(false)
      top = 600
      runFrame()
      expect(link.scrollIntoView).not.toHaveBeenCalled()
    }
  )

  it("lets go when focus moves elsewhere", () => {
    const link = focusedLink()
    keepFocusInView(link, BOUNDS)
    const other = document.createElement("button")
    document.body.append(other)
    other.focus()
    top = 600
    runFrame()
    expect(isFocusKept(link)).toBe(false)
    expect(link.scrollIntoView).not.toHaveBeenCalled()
  })
})
