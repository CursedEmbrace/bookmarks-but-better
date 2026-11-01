// @vitest-environment jsdom
import * as React from "react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BookmarkItem } from "../bookmark-item"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useCustomIconStore } from "@/stores/custom-icon-store"
import { useUIStore } from "@/stores/ui-store"

// Keep the real bookmark controls and handlers; expose portal content for
// component assertions. Browser tests exercise actual hover/focus behavior.
vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: React.PropsWithChildren) => <>{children}</>,
  HoverCardTrigger: ({
    render: element,
    children,
  }: React.PropsWithChildren<{ render: React.ReactElement }>) =>
    React.cloneElement(element, {}, children),
  HoverCardContent: ({ children }: React.PropsWithChildren) => (
    <section aria-label="Bookmark preview">{children}</section>
  ),
}))
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  TooltipTrigger: ({
    render: element,
    children,
  }: React.PropsWithChildren<{ render: React.ReactElement }>) =>
    children ? React.cloneElement(element, {}, children) : element,
  TooltipContent: () => null,
}))
vi.mock("@/features/dnd", () => ({
  useSortableBookmark: () => ({
    ref: { current: null },
    isDragging: false,
    closestEdge: null,
  }),
  DropIndicator: () => null,
}))
vi.mock("../favicon", () => ({ Favicon: () => <span /> }))

const bookmark = { id: "one", title: "Example", url: "https://example.test" }
const initialUI = useUIStore.getState()
beforeEach(() => {
  useCustomIconStore.setState({ source: "browser" })
  useBookmarkStore.setState({ adapter: null })
  useUIStore.setState({
    openEditor: vi.fn(),
    openIconEditor: vi.fn(),
    openDeleteConfirm: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  useUIStore.setState(initialUI)
  useCustomIconStore.getState().activate(null)
  useBookmarkStore.setState({ adapter: null })
  vi.restoreAllMocks()
})

function mount(readOnly = false) {
  render(
    <BookmarkItem
      bookmark={{ ...bookmark, readOnly }}
      layout="grid"
      sortableIndex={0}
      folderId="folder"
    />
  )
  const preview = screen.getByRole("region", { name: "Bookmark preview" })
  return within(preview)
}

it("orders matching hit areas in a compact left group with Delete pushed right", async () => {
  const user = userEvent.setup()
  const preview = mount()
  const buttons = preview.getAllByRole("button")
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Edit",
    "Change icon for Example",
    "Copy Link",
    "Delete",
  ])
  const footer = buttons[0].parentElement!
  expect(footer.className).toContain("flex items-center gap-1")
  expect(buttons[3].className).toContain("ml-auto")
  expect(
    buttons.slice(0, 3).every((button) => !button.className.includes("ml-auto"))
  ).toBe(true)
  buttons[0].focus()
  for (const button of buttons.slice(1)) {
    await user.tab()
    expect(document.activeElement).toBe(button)
  }
})

it("keeps edit, icon, copy and delete handlers attached to their respective controls", async () => {
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
  const preview = mount()
  await user.click(preview.getByRole("button", { name: "Edit" }))
  expect(useUIStore.getState().openEditor).toHaveBeenCalledWith({
    ...bookmark,
    readOnly: false,
  })
  await user.click(
    preview.getByRole("button", { name: "Change icon for Example" })
  )
  expect(useUIStore.getState().openIconEditor).toHaveBeenCalledWith(
    { ...bookmark, readOnly: false },
    screen.getByRole("link")
  )
  await user.click(preview.getByRole("button", { name: "Copy Link" }))
  expect(copy).toHaveBeenCalledWith(bookmark.url)
  await user.click(preview.getByRole("button", { name: "Delete" }))
  expect(useUIStore.getState().openDeleteConfirm).toHaveBeenCalledWith({
    id: "one",
    title: "Example",
    type: "bookmark",
  })
})

it("preserves read-only guards and keeps the optional manager action before Delete", () => {
  const manager = vi.fn()
  useBookmarkStore.setState({
    adapter: {
      capabilities: { openInManager: true },
      bookmarks: { openInManager: manager },
    } as never,
  })
  const preview = mount(true)
  expect(preview.queryByRole("button", { name: /Change icon/ })).toBeNull()
  for (const name of ["Edit", "Delete"]) {
    const button = preview.getByRole("button", { name })
    expect(button.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(button)
  }
  expect(useUIStore.getState().openEditor).not.toHaveBeenCalled()
  expect(useUIStore.getState().openDeleteConfirm).not.toHaveBeenCalled()
  fireEvent.click(
    preview.getByRole("button", { name: "Show in bookmark manager" })
  )
  expect(manager).toHaveBeenCalledWith("one")
  expect(
    preview.getAllByRole("button").at(-1)?.getAttribute("aria-label")
  ).toBe("Delete")
})
