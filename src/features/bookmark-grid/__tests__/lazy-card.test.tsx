// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import type { BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "../bookmark-grid"
import { LAZY_CARDS_ABOVE } from "../lazy-cards-gate"
import { LazyCardsContext } from "../lazy-cards-gate"
import { LazyCard } from "../lazy-card"

/**
 * The grid mounts a folder card only near the viewport (issue #75). These
 * cases pin the contract: a far card is a placeholder of its estimated —
 * later its last real — height, the viewport brings it in and takes it
 * out again, and the keyboard's tab stop pins its card open regardless.
 */

class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = []

  targets = new Set<Element>()
  callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    StubIntersectionObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }

  report(
    near: Map<
      Element,
      { isIntersecting: boolean; height: number; width?: number }
    >
  ) {
    const entries = Array.from(this.targets)
      .filter((target) => near.has(target))
      .map(
        (target) =>
          ({
            target,
            isIntersecting: near.get(target)!.isIntersecting,
            boundingClientRect: {
              height: near.get(target)!.height,
              width: near.get(target)!.width,
            },
          }) as unknown as IntersectionObserverEntry
      )
    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver)
    }
  }
}

/**
 * Large enough to be gated: the sub-folders together carry the collection
 * over the threshold, and they stay placeholders in every case but the one
 * that scrolls to one, so the size costs the tests nothing.
 */
const SUB_SIZE = LAZY_CARDS_ABOVE

function tree(subSize: number): BookmarkNode[] {
  return [
    {
      id: "root",
      title: "Root",
      children: ["one", "two"].map((id) => ({
        id,
        title: id,
        children: [
          { id: `${id}-b`, title: `${id} bookmark`, url: "https://e.example" },
          {
            id: `${id}-sub`,
            title: `${id} sub`,
            children: Array.from({ length: subSize }, (_, i) => ({
              id: `${id}-sub-${i}`,
              title: `${id} sub bookmark ${i}`,
              url: `https://sub.example/${i}`,
            })),
          },
        ],
      })),
    },
  ]
}

function mount(subSize = SUB_SIZE) {
  const TREE = tree(subSize)
  useBookmarkStore.setState({
    adapter: {
      bookmarks: {} as never,
      storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      favicon: { getUrl: () => "", isAvailable: () => false },
      capabilities: {
        openInManager: false,
        move: true,
        reorder: true,
        setChildOrder: false,
      },
    },
    tree: TREE,
    rootFolder: TREE[0],
    isLoading: false,
  })
  usePreferencesStore.setState({
    experimentalCardDrag: false,
    nestedFolders: true,
    folderOrder: [],
    cardLayouts: {},
    maxColumns: 1,
    containerMode: "fluid",
  })
  return render(<BookmarkGrid />)
}

/** The lazy wrappers the grid asked the observer to watch, by folder title. */
function wrappersByTitle(): Map<string, Element> {
  const wrappers = new Map<string, Element>()
  for (const instance of StubIntersectionObserver.instances) {
    for (const target of instance.targets) {
      const heading = target.querySelector("h3")
      if (heading) wrappers.set(heading.textContent ?? "", target)
    }
  }
  return wrappers
}

function report(
  near: Record<string, { isIntersecting: boolean; height: number }>
) {
  const wrappers = wrappersByTitle()
  const byElement = new Map<
    Element,
    { isIntersecting: boolean; height: number }
  >()
  for (const [title, entry] of Object.entries(near)) {
    const element = wrappers.get(title)
    if (element) byElement.set(element, entry)
  }
  act(() => {
    for (const instance of StubIntersectionObserver.instances) {
      instance.report(byElement)
    }
  })
}

function mountedTitles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="bookmark-card"] > div > h3')
  ).map((h) => h.textContent ?? "")
}

function placeholderTitles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="bookmark-card-placeholder"] h3')
  ).map((h) => h.textContent ?? "")
}

describe("LazyCard", () => {
  beforeEach(() => {
    StubIntersectionObserver.instances = []
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver)
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("preserves a compact card's measured width and invalidates it when content or preferences change", () => {
    const folder: BookmarkNode = {
      id: "compact",
      title: "Compact",
      children: [],
    }
    const display = { nestedFolders: true, collapsedFolders: {} }
    const style = { width: "max-content", minWidth: "160px", maxWidth: "100%" }
    const renderCard = (node = folder, preferences = display) => (
      <LazyCardsContext value={true}>
        <LazyCard
          folder={node}
          display={preferences}
          estimatedHeight={96}
          style={style}
          className="w-full"
        >
          <h3>{node.title}</h3>
        </LazyCard>
      </LazyCardsContext>
    )
    const view = render(renderCard())
    const wrapper = view.container.firstElementChild as HTMLElement
    const measure = (isIntersecting: boolean, width: number) =>
      act(() => {
        for (const observer of StubIntersectionObserver.instances)
          observer.report(
            new Map([[wrapper, { isIntersecting, width, height: 140 }]])
          )
      })
    measure(true, 240)
    measure(false, 240)
    expect(wrapper.style.width).toBe("240px")
    expect(wrapper.style.maxWidth).toBe("100%")
    expect(view.getByTestId("bookmark-card-placeholder").style.minHeight).toBe(
      "140px"
    )

    view.rerender(renderCard({ ...folder, title: "Renamed" }))
    expect(wrapper.style.width).toBe("max-content")
    // A placeholder notification must not relabel an old measurement as new.
    measure(false, 180)
    expect(wrapper.style.width).toBe("max-content")
    measure(true, 220)
    measure(false, 220)
    expect(wrapper.style.width).toBe("220px")
    view.rerender(renderCard(folder, { ...display }))
    expect(wrapper.style.width).toBe("max-content")
    view.unmount()
    expect(
      StubIntersectionObserver.instances.every(
        (instance) => instance.targets.size === 0
      )
    ).toBe(true)
  })

  it("starts a card as a placeholder of its estimated height, except the one holding the initial tab stop", () => {
    const { container } = mount()

    expect(mountedTitles(container)).toEqual(["one"])
    expect(placeholderTitles(container)).toEqual(["one sub", "two"])
    const placeholder = container.querySelectorAll<HTMLElement>(
      '[data-testid="bookmark-card-placeholder"]'
    )[1]
    // One list row on top of the card chrome; see `estimateCardHeight`.
    expect(placeholder?.style.minHeight).toBe("96px")
  })

  it.each([null, "wheel", "dragover", "keydown"])(
    "keeps keyboard focus visible after wrapped rows reflow, unless interrupted by %s",
    (interrupt) => {
      let frame: FrameRequestCallback | undefined
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          frame = callback
          return 1
        }
      )
      const folder: BookmarkNode = { id: "focus", title: "Focus", children: [] }
      const view = render(
        <LazyCardsContext value={true}>
          <LazyCard
            folder={folder}
            display={{ nestedFolders: true, collapsedFolders: {} }}
            estimatedHeight={100}
          >
            <div data-compact="true">
              <button>Focused bookmark</button>
            </div>
          </LazyCard>
        </LazyCardsContext>
      )
      const wrapper = view.container.firstElementChild!
      const observer = StubIntersectionObserver.instances[0]
      const reportNear = () =>
        act(() =>
          observer.report(
            new Map([[wrapper, { isIntersecting: true, height: 100 }]])
          )
        )
      reportNear()
      const button = view.getByRole("button")
      button.focus()
      vi.spyOn(button, "matches").mockImplementation(
        (selector) => selector === ":focus-visible"
      )
      const rect = vi.spyOn(button, "getBoundingClientRect")
      rect.mockReturnValue({ top: 100, bottom: 130 } as DOMRect)
      const scroll = vi.fn()
      button.scrollIntoView = scroll
      reportNear()
      expect(frame).toBeDefined()
      // A sibling mounts and makes the row taller after the observer batch.
      rect.mockReturnValue({ top: -100, bottom: -70 } as DOMRect)
      if (interrupt) window.dispatchEvent(new Event(interrupt))
      act(() => frame!(0))
      expect(scroll).toHaveBeenCalledTimes(interrupt ? 0 : 1)
    }
  )

  it("mounts a card the viewport approaches and tears it down when it leaves, keeping its last height", () => {
    const { container } = mount()

    report({ two: { isIntersecting: true, height: 96 } })
    expect(mountedTitles(container)).toEqual(["one", "two"])
    expect(placeholderTitles(container)).toEqual(["one sub", "two sub"])

    report({ two: { isIntersecting: false, height: 240 } })
    expect(mountedTitles(container)).toEqual(["one"])
    expect(placeholderTitles(container)).toEqual(["one sub", "two"])
    const placeholder = container.querySelectorAll<HTMLElement>(
      '[data-testid="bookmark-card-placeholder"]'
    )[1]
    expect(placeholder?.style.minHeight).toBe("240px")
  })

  it("wraps each nested sub-folder card the same way, so a deep tree is not one enormous card", () => {
    const { container } = mount()

    // The first card is mounted (it holds the tab stop); its sub-folder is
    // still a placeholder until the viewport reaches it.
    expect(mountedTitles(container)).toEqual(["one"])
    expect(placeholderTitles(container)).toEqual(["one sub", "two"])
    expect(container.querySelector('a[href^="https://sub.example"]')).toBeNull()

    report({ "one sub": { isIntersecting: true, height: 96 } })
    expect(mountedTitles(container)).toEqual(["one", "one sub"])
    expect(
      container.querySelectorAll('a[href^="https://sub.example"]')
    ).toHaveLength(SUB_SIZE)
  })

  it("gates nothing in a collection below the threshold: the grid it always was", () => {
    const { container } = mount(1)

    expect(mountedTitles(container)).toEqual([
      "one",
      "one sub",
      "two",
      "two sub",
    ])
    expect(placeholderTitles(container)).toEqual([])
    expect(StubIntersectionObserver.instances).toEqual([])
  })

  it("keeps the card holding the grid's tab stop mounted wherever the viewport is", () => {
    const { container } = mount()

    report({
      one: { isIntersecting: true, height: 96 },
      two: { isIntersecting: true, height: 96 },
    })
    const bookmark = container.querySelector<HTMLElement>(
      'a[href="https://e.example"]'
    )!
    act(() => bookmark.focus())
    expect(bookmark.tabIndex).toBe(0)

    report({
      one: { isIntersecting: false, height: 96 },
      two: { isIntersecting: false, height: 96 },
    })
    expect(mountedTitles(container)).toEqual(["one"])
    expect(placeholderTitles(container)).toEqual(["one sub", "two"])
  })
})
