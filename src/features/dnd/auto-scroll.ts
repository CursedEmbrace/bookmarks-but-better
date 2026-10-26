import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import type { Input } from "@atlaskit/pragmatic-drag-and-drop/types"
import { DND_TYPE } from "./types"

type Pointer = Pick<
  Input,
  "clientX" | "clientY" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>

/** Pixels/second, with a quadratic ramp inside the visible edge band. */
function velocity(y: number, top: number, bottom: number): number {
  if (y < top || y > bottom || bottom <= top) return 0
  const band = Math.min(64, (bottom - top) / 2)
  const distance = Math.min(y - top, bottom - y)
  if (distance >= band) return 0
  return (y < (top + bottom) / 2 ? -1 : 1) * 600 * (1 - distance / band) ** 2
}

function scrollIntent(root: HTMLElement, pointer: Pointer) {
  const hit = document.elementFromPoint(pointer.clientX, pointer.clientY)
  if (!hit || !root.isConnected) return null

  // Start at the hit element, not the drag source or the current drop target:
  // empty space and independently scrolling descendants must work too.
  for (let node: Element | null = hit; node; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue
    const style = getComputedStyle(node)
    if (!/^(auto|scroll)$/.test(style.overflowY)) continue
    // An unrelated panel inside the dashboard must not scroll its background.
    if (!root.contains(node) && !node.contains(root)) return null
    if (node.scrollHeight <= node.clientHeight) continue

    const rect = node.getBoundingClientRect()
    let top = Math.max(0, rect.top + node.clientTop)
    let bottom = Math.min(
      window.innerHeight,
      top + node.clientHeight,
      rect.bottom
    )
    // Only visible edges count, including clipping by another scroll area.
    for (
      let parent = node.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        !/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)
      )
        continue
      const bounds = parent.getBoundingClientRect()
      top = Math.max(top, bounds.top + parent.clientTop)
      bottom = Math.min(
        bottom,
        bounds.top + parent.clientTop + parent.clientHeight
      )
    }
    const speed = velocity(pointer.clientY, top, bottom)
    const max = node.scrollHeight - node.clientHeight
    // Don't transfer scrolling to an outer container at an inner boundary.
    if (
      !speed ||
      (speed < 0 && node.scrollTop <= 0) ||
      (speed > 0 && node.scrollTop >= max)
    )
      return null
    return { element: node, speed, max }
  }
  return null
}

/** React ref cleanup ties all listeners and frames to this dashboard's lifetime. */
export function autoScrollDashboard(root: HTMLDivElement): () => void {
  let pointer: Pointer | null = null
  let frame: number | null = null
  let lastTime: number | null = null
  let unbind: (() => void) | null = null
  let refreshing = false
  let lastElement: HTMLElement | null = null
  let remainder = 0

  function pause() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    lastTime = null
    pointer = null
    lastElement = null
    remainder = 0
  }

  function finish() {
    pause()
    unbind?.()
    unbind = null
  }

  function tick(time: number) {
    frame = null
    if (!pointer) return
    const intent = scrollIntent(root, pointer)
    if (!intent) {
      lastTime = null
      return
    }
    const elapsed = lastTime === null ? 16 : Math.min(32, time - lastTime)
    lastTime = time
    const { element, speed, max } = intent
    if (lastElement !== element) remainder = 0
    lastElement = element
    const top = Math.max(
      0,
      Math.min(max, element.scrollTop + (speed * elapsed) / 1000 + remainder)
    )
    element.scrollTo({
      top,
      behavior: "instant",
    })
    // Some engines round scrollTop; retain subpixel movement at slow speeds.
    remainder = top - element.scrollTop

    // Native dragover can lag behind scrolling with a stationary pointer.
    // Re-hit-test through the existing adapter so canDrop, closest-edge data,
    // highlights and the eventual drop all use the same current geometry.
    const hit = document.elementFromPoint(pointer.clientX, pointer.clientY)
    if (hit) {
      refreshing = true
      try {
        hit.dispatchEvent(
          new DragEvent("dragover", {
            ...pointer,
            bubbles: true,
            cancelable: true,
          })
        )
      } finally {
        refreshing = false
      }
    }
    if (pointer && scrollIntent(root, pointer))
      frame = requestAnimationFrame(tick)
    else lastTime = null
  }

  function update(input: Pointer) {
    if (refreshing) return
    pointer = {
      clientX: input.clientX,
      clientY: input.clientY,
      altKey: input.altKey,
      ctrlKey: input.ctrlKey,
      metaKey: input.metaKey,
      shiftKey: input.shiftKey,
    }
    if (!scrollIntent(root, pointer)) {
      pause()
      return
    }
    if (frame === null) frame = requestAnimationFrame(tick)
  }

  const cleanupMonitor = monitorForElements({
    canMonitor: ({ source }) =>
      root.contains(source.element) &&
      (source.data.type === DND_TYPE.BOOKMARK ||
        source.data.type === DND_TYPE.FOLDER_CARD),
    onDragStart({ location }) {
      finish()
      const leave = (event: DragEvent) => {
        if (event.relatedTarget === null) pause()
      }
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") finish()
      }
      const visibility = () => {
        if (document.hidden) pause()
      }
      // dragover provides coordinates in Firefox; native `drag` does not.
      window.addEventListener("dragover", update)
      window.addEventListener("dragenter", update)
      window.addEventListener("dragleave", leave)
      window.addEventListener("dragend", finish)
      window.addEventListener("drop", finish)
      window.addEventListener("blur", pause)
      window.addEventListener("keydown", keydown)
      document.addEventListener("visibilitychange", visibility)
      unbind = () => {
        window.removeEventListener("dragover", update)
        window.removeEventListener("dragenter", update)
        window.removeEventListener("dragleave", leave)
        window.removeEventListener("dragend", finish)
        window.removeEventListener("drop", finish)
        window.removeEventListener("blur", pause)
        window.removeEventListener("keydown", keydown)
        document.removeEventListener("visibilitychange", visibility)
      }
      update(location.current.input)
    },
    onDrop: finish,
  })
  return () => {
    finish()
    cleanupMonitor()
  }
}
