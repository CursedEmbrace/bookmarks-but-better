// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "../bookmark-store"
import { FirefoxBookmarkAdapter } from "@/browser/firefox/bookmarks"

let tree: BookmarkNode[]
let adapter: BrowserAdapter
const noopEvent = { addListener: vi.fn(), removeListener: vi.fn() }
const initial = useBookmarkStore.getState()
function find(id: string, nodes = tree): BookmarkNode {
  for (const node of nodes) {
    if (node.id === id) return node
    try {
      return find(id, node.children ?? [])
    } catch {
      /* next subtree */
    }
  }
  throw new Error("Missing node")
}

beforeEach(() => {
  let id = 0
  tree = [
    {
      id: "root",
      title: "Root",
      children: [
        {
          id: "bar",
          title: "Bar",
          children: [
            { id: "a", title: "A", url: "https://a.example" },
            { id: "nested", title: "Nested", children: [] },
            { id: "b", title: "B", url: "https://b.example" },
          ],
        },
      ],
    },
  ]
  vi.stubGlobal("chrome", {
    bookmarks: {
      getTree: async () => structuredClone(tree),
      getSubTree: async (id: string) => [structuredClone(find(id))],
      create: vi.fn(
        async (input: {
          parentId: string
          type: "separator"
          index?: number
        }) => {
          const node: BookmarkNode = {
            id: `s${++id}`,
            title: "",
            type: input.type,
            parentId: input.parentId,
          }
          const children = find(input.parentId).children!
          children.splice(input.index ?? children.length, 0, node)
          return node
        }
      ),
      remove: vi.fn(async (id: string) => {
        const node = find(id)
        const children = find(node.parentId!).children!
        children.splice(
          children.findIndex((n) => n.id === id),
          1
        )
      }),
      move: vi.fn(
        async (
          id: string,
          destination: { parentId: string; index: number }
        ) => {
          const node = find(id)
          const children = find(node.parentId!).children!
          children.splice(
            children.findIndex((n) => n.id === id),
            1
          )
          find(destination.parentId).children!.splice(
            destination.index,
            0,
            node
          )
          node.parentId = destination.parentId
        }
      ),
      onChanged: noopEvent,
      onCreated: noopEvent,
      onMoved: noopEvent,
      onRemoved: noopEvent,
    },
  })
  adapter = {
    bookmarks: new FirefoxBookmarkAdapter(),
    capabilities: {
      separators: true,
      move: true,
      reorder: true,
      setChildOrder: false,
      openInManager: false,
    },
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    favicon: { getUrl: () => "", isAvailable: () => false },
  }
  useBookmarkStore.setState({ ...initial, adapter, tree })
})
afterEach(() => {
  useBookmarkStore.setState(initial)
  vi.unstubAllGlobals()
})

describe("separator mutations in the Active Source", () => {
  it("appends in real root-level and nested folders and survives a new session", async () => {
    const store = useBookmarkStore.getState()
    await store.createSeparator("bar")
    await store.createSeparator("nested")
    store.reset()
    const cleanup = await store.init(adapter)
    expect(
      find("bar", useBookmarkStore.getState().tree).children?.map((n) => n.id)
    ).toEqual(["a", "nested", "b", "s1"])
    expect(
      find("nested", useBookmarkStore.getState().tree).children?.[0].type
    ).toBe("separator")
    cleanup?.()
  })
  it("inserts after the selected child using full native positions", async () => {
    const store = useBookmarkStore.getState()
    await store.createSeparator("bar", "a")
    await store.createSeparator("bar", "b")
    expect(find("bar").children?.map((n) => n.id)).toEqual([
      "a",
      "s1",
      "nested",
      "b",
      "s2",
    ])
    await store.moveBookmark("s2", { parentId: "bar", index: 0 })
    expect(find("bar").children?.map((n) => n.id)).toEqual([
      "s2",
      "a",
      "s1",
      "nested",
      "b",
    ])
    await store.deleteBookmark("s1")
    await store.refresh()
    expect(
      find("bar", useBookmarkStore.getState().tree).children?.map((n) => n.id)
    ).toEqual(["s2", "a", "nested", "b"])
  })
  it("refuses unsupported sources, stale selections and fixed folders without creating folders", async () => {
    adapter.capabilities.separators = false
    await useBookmarkStore.getState().createSeparator("bar")
    expect(chrome.bookmarks.create).not.toHaveBeenCalled()
    expect(useBookmarkStore.getState().mutationError).toMatch(
      /does not support/
    )
    adapter.capabilities.separators = true
    await useBookmarkStore.getState().createSeparator("bar", "gone")
    find("bar").orderReadOnly = true
    vi.spyOn(adapter.bookmarks, "getSubTree").mockResolvedValueOnce([
      find("bar"),
    ])
    await useBookmarkStore.getState().createSeparator("bar")
    expect(chrome.bookmarks.create).not.toHaveBeenCalled()
  })
  it("does not create or report an error in a new source after a session switch", async () => {
    let finish!: (nodes: BookmarkNode[]) => void
    vi.spyOn(adapter.bookmarks, "getSubTree").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const pending = useBookmarkStore.getState().createSeparator("bar")
    useBookmarkStore.getState().reset()
    finish([find("bar")])
    expect(await pending).toBeNull()
    expect(chrome.bookmarks.create).not.toHaveBeenCalled()
    expect(useBookmarkStore.getState().mutationError).toBeNull()
  })
})
