// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { BookmarkOrganizerSheet } from "@/features/bookmark-organizer/bookmark-organizer-sheet"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { BookmarkGrid } from "../bookmark-grid"

function setup(nestedFolders = true) {
  let tree: BookmarkNode[] = [
    {
      id: "root",
      title: "Root",
      children: [
        {
          id: "parent",
          title: "Parent",
          children: [
            {
              id: "selected",
              title: "Selected",
              parentId: "parent",
              children: [],
            },
          ],
        },
        { id: "sibling", title: "Sibling", children: [] },
      ],
    },
  ]
  const create = vi.fn(
    async ({
      parentId,
      title,
    }: {
      parentId: string
      title: string
    }): Promise<BookmarkNode> => {
      const created = { id: "created", parentId, title, children: [] }
      // No change events: creation itself must refresh the dashboard.
      tree = structuredClone(tree)
      tree[0].children![0].children![0].children!.push(created)
      return created
    }
  )
  const adapter = {
    bookmarks: { create, getTree: vi.fn(async () => tree) },
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    favicon: { getUrl: () => "", isAvailable: () => false },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: true,
      setChildOrder: false,
    },
  } as unknown as BrowserAdapter
  useBookmarkStore.setState({
    adapter,
    tree,
    rootFolderId: "root",
    rootFolder: tree[0],
    isLoading: false,
    status: "ready",
    mutationError: null,
  })
  usePreferencesStore.setState({
    nestedFolders,
    folderOrder: [],
    cardLayouts: {},
    collapsedFolders: {},
    experimentalCardDrag: true,
  })
  render(
    <>
      <BookmarkGrid />
      <BookmarkOrganizerSheet />
    </>
  )
  return { create, adapter }
}

function selectedMenu() {
  const card = screen
    .getByRole("heading", { name: "Selected" })
    .closest('[data-testid="bookmark-card"]') as HTMLElement
  return within(card).getAllByRole("button", { name: "Folder actions" })[0]
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(selectedMenu())
  await user.click(
    await screen.findByRole("menuitem", { name: "New subfolder" })
  )
  return screen.findByLabelText("Title")
}

beforeEach(() => {
  useUIStore.setState(useUIStore.getInitialState(), true)
  useBookmarkStore.setState(useBookmarkStore.getInitialState(), true)
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true)
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("dashboard New subfolder", () => {
  it.each([true, false])(
    "creates under the selected nested folder and updates the dashboard (nested=%s)",
    async (nested) => {
      const user = userEvent.setup()
      const { create, adapter } = setup(nested)
      const title = await openCreate(user)
      expect(useUIStore.getState().bookmarkOrganizerOpen).toBe(false)
      await user.type(title, "  Child  {Enter}")
      await screen.findByRole("heading", { name: "Child" })
      expect(create).toHaveBeenCalledExactlyOnceWith({
        parentId: "selected",
        title: "Child",
      })
      expect(adapter.bookmarks.getTree).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole("dialog")).toBeNull()
      const root = useBookmarkStore.getState().rootFolder!
      expect(root.children!.map((node) => node.id)).toEqual([
        "parent",
        "sibling",
      ])
      expect(root.children![0].children![0].children![0].parentId).toBe(
        "selected"
      )
      expect(
        screen.getAllByRole("button", { name: "Drag to reorder folder" }).length
      ).toBeGreaterThan(0)
    }
  )

  it("opens with the keyboard and cancels without creating anything", async () => {
    const user = userEvent.setup()
    const { create } = setup()
    act(() => selectedMenu().focus())
    await user.keyboard("{Enter}")
    await screen.findByRole("menuitem", { name: "New subfolder" })
    await user.keyboard("{Home}{ArrowDown}{Enter}")
    const title = await screen.findByLabelText("Title")
    await waitFor(() => expect(document.activeElement).toBe(title))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(selectedMenu()))
    expect(create).not.toHaveBeenCalled()
    expect(useUIStore.getState().bookmarkOrganizerOpen).toBe(false)
  })

  it("rejects whitespace and explains the empty name", async () => {
    const user = userEvent.setup()
    const { create } = setup()
    const title = await openCreate(user)
    await user.type(title, "   ")
    await user.tab()
    expect(screen.getByText("A title is required.")).toBeTruthy()
    expect(title.getAttribute("aria-invalid")).toBe("true")
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
        .disabled
    ).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it("keeps an invalid name and source feedback visible so it can be corrected", async () => {
    const user = userEvent.setup()
    const { create } = setup()
    create.mockRejectedValueOnce(new Error("This folder name is invalid."))
    const title = await openCreate(user)
    await user.type(title, "Invalid{Enter}")
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "This folder name is invalid."
    )
    expect(title).toHaveProperty("value", "Invalid")
    await user.clear(title)
    await user.type(title, "Valid{Enter}")
    await screen.findByRole("heading", { name: "Valid" })
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("prevents repeated submission while creation is pending", async () => {
    const user = userEvent.setup()
    const { create } = setup()
    let finish!: (node: BookmarkNode) => void
    create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const title = await openCreate(user)
    await user.type(title, "Child{Enter}{Enter}")
    expect(
      (
        (await screen.findByRole("button", {
          name: "Creating…",
        })) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    await act(async () =>
      finish({ id: "created", title: "Child", children: [] })
    )
  })
})
