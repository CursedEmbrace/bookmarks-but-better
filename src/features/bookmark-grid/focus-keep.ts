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
 * Consecutive frames the focus must stay in view, with no new batch of cards
 * mounting, before the keep is let go. Short enough that a later scroll the
 * user did not make with an input (a script, a link to an anchor) is not
 * fought; long enough to cover React committing a batch a frame late.
 */
const SETTLED_FRAMES = 4
/** A hard cap, so a page that never settles cannot hold the scroll forever. */
const MAX_KEEP_MS = 2000

interface Keep {
  element: HTMLElement
  bounds: { top: number; bottom: number }
  steadyFrames: number
  deadline: number
  release: () => void
}

/** The focused element reflows must not push out of view, while settling. */
let keptFocus: Keep | null = null

export function isFocusKept(element: Element): boolean {
  return keptFocus?.element === element
}

/** The visible band of the element's scroll root (or the window). */
function visibleBounds(element: Element) {
  const root = findScrollRoot(element)
  return root?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
}

/**
 * Keep a keyboard-moved focus in view while lazy cards mount around it.
 * Mounting one wave of neighbours can reflow the rows above the focus and
 * bring the next wave near, so a single jump may settle over several
 * batches. The keep is checked every frame and ends once the focus has
 * stayed in view for a few frames, or as soon as the user scrolls, points,
 * types or moves focus.
 */
export function keepFocusInView(
  element: HTMLElement,
  bounds: { top: number; bottom: number } = visibleBounds(element)
) {
  if (keptFocus?.element === element) {
    // Another batch is mounting: the layout is not settled yet.
    keptFocus.bounds = bounds
    keptFocus.steadyFrames = 0
    keptFocus.deadline = performance.now() + MAX_KEEP_MS
    return
  }
  keptFocus?.release()
  const keep: Keep = {
    element,
    bounds,
    steadyFrames: 0,
    deadline: performance.now() + MAX_KEEP_MS,
    release: () => {
      for (const input of KEEP_INTERRUPTS)
        window.removeEventListener(input, keep.release, true)
      if (keptFocus === keep) keptFocus = null
    },
  }
  for (const input of KEEP_INTERRUPTS)
    window.addEventListener(input, keep.release, {
      capture: true,
      passive: true,
    })
  keptFocus = keep
  const frame = () => {
    if (keptFocus !== keep) return
    if (
      document.activeElement !== element ||
      !element.isConnected ||
      performance.now() > keep.deadline
    ) {
      keep.release()
      return
    }
    const next = element.getBoundingClientRect()
    if (next.top < keep.bounds.top || next.bottom > keep.bounds.bottom) {
      element.scrollIntoView({ block: "nearest", inline: "nearest" })
      keep.steadyFrames = 0
    } else if (++keep.steadyFrames >= SETTLED_FRAMES) {
      keep.release()
      return
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
