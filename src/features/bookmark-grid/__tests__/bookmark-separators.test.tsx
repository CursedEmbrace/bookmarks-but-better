// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { BookmarkGrid } from "../bookmark-grid"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { toOrganizerItem } from "@/features/bookmark-organizer/bookmark-organizer-data"
import { buildRootFolderOptions } from "@/features/root-folder-select/root-folder-options"
import { planBookmarkReorder } from "../grid-navigation"

const folder: BookmarkNode = {
  id: "f",
  title: "Folder",
  children: [
    { id: "a", title: "First", url: "https://a.example" },
    {
      id: "nested",
      title: "Nested",
      children: [{ id: "ns", title: "", type: "separator" }],
    },
    { id: "s", title: "", type: "separator" },
    { id: "b", title: "Second", url: "https://b.example" },
  ],
}
const initial = useBookmarkStore.getState()
const initialPrefs = usePreferencesStore.getState()
const initialUI = useUIStore.getState()
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  useBookmarkStore.setState({
    ...initial,
    tree: [folder],
    rootFolder: folder,
    isLoading: false,
    createSeparator: vi.fn().mockResolvedValue(null),
    moveBookmark: vi.fn().mockResolvedValue(true),
    adapter: {
      capabilities: {
        separators: true,
        move: true,
        reorder: true,
        setChildOrder: false,
        openInManager: false,
      },
      bookmarks: { createSeparator: vi.fn() },
      favicon: { isAvailable: () => false, getUrl: () => "" },
    } as unknown as BrowserAdapter,
  })
  usePreferencesStore.setState({
    nestedFolders: true,
    maxColumns: 1,
    experimentalCardDrag: false,
    cardLayouts: {},
    collapsedFolders: {},
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useBookmarkStore.setState(initial)
  usePreferencesStore.setState(initialPrefs)
  useUIStore.setState(initialUI)
})

describe("dashboard separators", () => {
  it("reports inline mutation errors only when no dialog owns the error", () => {
    useBookmarkStore.setState({ mutationError: "Separator creation failed" })
    const view = render(<BookmarkGrid />)
    expect(screen.getByRole("alert").textContent).toBe(
      "Separator creation failed"
    )
    view.unmount()
    useUIStore.setState({ creatingItem: { type: "bookmark", parentId: "f" } })
    render(<BookmarkGrid />)
    expect(screen.queryByRole("alert")).toBeNull()
  })
  it.each(["list", "grid"] as const)(
    "renders %s dividers in root and nested folders without links",
    (layout) => {
      usePreferencesStore.setState({
        cardLayouts: { f: layout, nested: layout },
      })
      render(<BookmarkGrid />)
      expect(
        screen.getAllByRole("separator", { name: "Bookmark separator" })
      ).toHaveLength(2)
      const entries = screen.getAllByTestId("bookmark-separator")
      for (const entry of entries) {
        expect(entry.className).toContain("col-span-full")
        expect(within(entry).queryByRole("link")).toBeNull()
        expect(within(entry).queryByRole("img")).toBeNull()
      }
      expect(screen.getAllByRole("link")).toHaveLength(2)
    }
  )

  it("adds a separator from folder actions and omits creation for unsupported sources", async () => {
    const user = userEvent.setup()
    const view = render(<BookmarkGrid />)
    await user.click(
      screen.getAllByRole("button", { name: "Folder actions" })[0]
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "Add separator" })
    )
    expect(useBookmarkStore.getState().createSeparator).toHaveBeenCalledWith(
      "f"
    )
    view.unmount()
    useBookmarkStore.setState({
      adapter: {
        ...useBookmarkStore.getState().adapter!,
        capabilities: {
          ...useBookmarkStore.getState().adapter!.capabilities,
          separators: false,
        },
      },
    })
    render(<BookmarkGrid />)
    await user.click(
      screen.getAllByRole("button", { name: "Folder actions" })[0]
    )
    expect(screen.queryByRole("menuitem", { name: "Add separator" })).toBeNull()
  })

  it("participates in keyboard navigation and reorders against full sibling positions", () => {
    render(<BookmarkGrid />)
    const first = screen.getByRole("link", { name: /^First/ })
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowDown" })
    const separator = screen.getAllByRole("button", {
      name: "Separator actions",
    })[0]
    expect(document.activeElement).toBe(separator)
    fireEvent.keyDown(separator, { key: "ArrowDown", altKey: true })
    expect(separator.getAttribute("aria-expanded")).toBe("false")
    expect(useBookmarkStore.getState().moveBookmark).toHaveBeenCalledWith("s", {
      parentId: "f",
      index: 3,
    })
    expect(
      planBookmarkReorder({
        folder,
        bookmarkId: "b",
        delta: -1,
        capabilities: { reorder: true, setChildOrder: false },
      })
    ).toEqual({ kind: "move", id: "b", parentId: "f", index: 2 })
  })

  it("opens separator management and deletion by keyboard without an editor", async () => {
    const user = userEvent.setup()
    render(<BookmarkGrid />)
    const separator = screen.getAllByRole("button", {
      name: "Separator actions",
    })[0]
    separator.focus()
    await user.keyboard("{Enter}")
    await user.click(screen.getByRole("menuitem", { name: "Delete separator" }))
    expect(useUIStore.getState().deletingItem).toEqual({
      id: "s",
      title: "Separator",
      type: "separator",
    })
    expect(useUIStore.getState().editingBookmark).toBeNull()
  })

  it("opens actions only after a completed pointer click, not on press", async () => {
    const user = userEvent.setup()
    render(<BookmarkGrid />)
    const separator = screen.getAllByRole("button", {
      name: "Separator actions",
    })[0]
    await user.pointer({ target: separator, keys: "[MouseLeft>]" })
    expect(separator.getAttribute("aria-expanded")).toBe("false")
    expect(
      screen.queryByRole("menuitem", { name: "Organize separator" })
    ).toBeNull()
    await user.pointer({ target: separator, keys: "[/MouseLeft]" })
    expect(
      await screen.findByRole("menuitem", { name: "Organize separator" })
    ).toBeTruthy()
  })

  it.each(["{Enter}", " "])(
    "closes on pointer cancellation, ignores trailing clicks and keeps %s access",
    async (key) => {
      const user = userEvent.setup()
      render(<BookmarkGrid />)
      const separator = screen.getAllByRole("button", {
        name: "Separator actions",
      })[0]
      await user.click(separator)
      expect(separator.getAttribute("aria-expanded")).toBe("true")
      fireEvent.pointerCancel(separator)
      fireEvent.click(separator)
      expect(separator.getAttribute("aria-expanded")).toBe("false")
      separator.focus()
      await user.keyboard(key)
      expect(separator.getAttribute("aria-expanded")).toBe("true")
      await user.keyboard("{Escape}")
      await user.click(separator)
      expect(separator.getAttribute("aria-expanded")).toBe("true")
    }
  )

  it("recognizes an Organizer leaf and never offers it as a destination folder", () => {
    expect(toOrganizerItem(folder.children![2], 2)).toMatchObject({
      kind: "separator",
      title: "Separator",
      childCount: 0,
    })
    expect(buildRootFolderOptions([folder]).map((n) => n.id)).toEqual([
      "f",
      "nested",
    ])
  })
})
