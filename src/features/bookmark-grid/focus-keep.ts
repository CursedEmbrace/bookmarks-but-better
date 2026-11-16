/**
 * Scroll-root lookup and keyboard-focus keeping shared by `LazyCard` and the
 * grid's keyboard navigation (kept apart so neither imports the other).
 */

/**
 * Each element's answer from `findScrollRoot`, so the cards of one column —
 * which share every ancestor — ask `getComputedStyle` once between them
 * instead of once per card per ancestor. With 300 cards that walk was the
 * grid's largest cost of its own on mount (issue #85). Weak, so a torn-down
 * grid takes its entries with it; the grid never re-parents its DOM, so an
 * element's scroll root does not change while it lives.
 */
const scrollRoots = new WeakMap<Element, Element | null>()

/**
 * The element whose scroll position decides what is near: the dashboard's own
 * scroll area, found generically rather than by name. With the viewport as the
 * root an ancestor scroll container would clip a card away before the margin
 * could count it as near.
 */
export function findScrollRoot(element: Element): Element | null {
  const visited: Element[] = []
  let root: Element | null = null
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const cached = scrollRoots.get(node)
    if (cached !== undefined) {
      root = cached
      break
    }
    const { overflowY } = getComputedStyle(node)
    if (overflowY === "auto" || overflowY === "scroll") {
      root = node
      break
    }
    visited.push(node)
  }
  for (const node of visited) scrollRoots.set(node, root)
  return root
}

/**
 * User input that ends a keep. A changed scrollTop alone cannot distinguish
 * user input from the browser's own scroll anchoring during the reflow.
 */
const KEEP_INTERRUPTS = [
  "wheel",
  "touchmove",
  "pointerdown",
  "keydown",
  "dragover",
  "focusin",
] as const

/**
 * How long the layout must go without changing size before the keep lets
 * go. Corrections are driven by layout changes (a ResizeObserver on the
 * scrolling content), not by counting frames, so a batch React commits late
 * is still caught; this only decides when "late" has become "settled".
 * Provisional, tuned with the large-tree UI tests.
 */
const SETTLE_MS = 300
/** A hard cap, so a page that never settles cannot hold the scroll forever. */
const MAX_KEEP_MS = 2000

type Bounds = { top: number; bottom: number }

interface Keep {
  element: HTMLElement
  bounds: Bounds
  /** Extends the keep after another batch of cards starts mounting. */
  touch: (bounds: Bounds) => void
  release: () => void
}

/** The focused element reflows must not push out of view, while settling. */
let keptFocus: Keep | null = null

export function isFocusKept(element: Element): boolean {
  return keptFocus?.element === element
}

/** The visible band of the element's scroll root (or the window). */
function visibleBounds(element: Element): Bounds {
  const root = findScrollRoot(element)
  return root?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
}

/**
 * Keep a keyboard-moved focus in view while lazy cards mount around it.
 *
 * Lazy cards are placeholders of estimated height until mounted, so mounting
 * one wave of neighbours reflows the rows above the focus and can bring the
 * next wave near: one jump may settle over several batches. Each time the
 * scrolling content changes size, the focus is scrolled back into view if
 * the reflow pushed it out.
 *
 * The keep ends when the layout has been quiet for `SETTLE_MS`, after
 * `MAX_KEEP_MS`, when the user scrolls, points, types or moves focus, or
 * when something else scrolls the focus far out of view (a script or an
 * anchor link): a reflow nudges the focus past the edge, while a deliberate
 * jump moves it more than a whole view away.
 */
export function keepFocusInView(
  element: HTMLElement,
  bounds: Bounds = visibleBounds(element)
) {
  if (keptFocus?.element === element) {
    keptFocus.touch(bounds)
    return
  }
  keptFocus?.release()

  const root = findScrollRoot(element)
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let correcting = false
  const deadline = setTimeout(() => keep.release(), MAX_KEEP_MS)

  const correct = () => {
    if (keptFocus !== keep) return
    if (document.activeElement !== element || !element.isConnected) {
      keep.release()
      return
    }
    const next = element.getBoundingClientRect()
    if (next.top < keep.bounds.top || next.bottom > keep.bounds.bottom) {
      correcting = true
      element.scrollIntoView({ block: "nearest", inline: "nearest" })
      // The scroll event this causes arrives asynchronously.
      requestAnimationFrame(() => {
        correcting = false
      })
    }
  }
  const settleLater = () => {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => keep.release(), SETTLE_MS)
  }
  const onScroll = () => {
    if (correcting || keptFocus !== keep) return
    const next = element.getBoundingClientRect()
    const view = keep.bounds.bottom - keep.bounds.top
    if (
      next.bottom < keep.bounds.top - view ||
      next.top > keep.bounds.bottom + view
    )
      keep.release()
  }
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          correct()
          settleLater()
        })
  observer?.observe(root?.firstElementChild ?? document.body)
  observer?.observe(element)
  const scrollTarget: EventTarget = root ?? window

  const keep: Keep = {
    element,
    bounds,
    touch(next) {
      keep.bounds = next
      settleLater()
      requestAnimationFrame(correct)
    },
    release() {
      if (keptFocus === keep) keptFocus = null
      clearTimeout(settleTimer)
      clearTimeout(deadline)
      observer?.disconnect()
      scrollTarget.removeEventListener("scroll", onScroll)
      for (const input of KEEP_INTERRUPTS)
        window.removeEventListener(input, keep.release, true)
    },
  }
  for (const input of KEEP_INTERRUPTS)
    window.addEventListener(input, keep.release, {
      capture: true,
      passive: true,
    })
  scrollTarget.addEventListener("scroll", onScroll, { passive: true })
  keptFocus = keep
  settleLater()
  requestAnimationFrame(correct)
}
