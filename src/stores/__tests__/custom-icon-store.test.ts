import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { customIconRepository } from "@/features/custom-icons/storage"
import { useCustomIconStore } from "../custom-icon-store"
import { useBookmarkStore } from "../bookmark-store"

const image = "data:image/png;base64,YQ=="
beforeEach(() => {
  vi.spyOn(customIconRepository, "list").mockImplementation(async (source) =>
    Object.entries(useCustomIconStore.getState().images).map(([id, image]) => ({
      source,
      id,
      image,
      updatedAt: 1,
    }))
  )
  vi.spyOn(customIconRepository, "patch").mockResolvedValue()
  vi.spyOn(customIconRepository, "prune").mockResolvedValue()
  useCustomIconStore.getState().activate("browser")
})
afterEach(() => {
  useBookmarkStore.getState().reset()
  vi.restoreAllMocks()
})

describe("custom icon source sessions", () => {
  it("applies independent assignments, replaces and resets without touching bookmarks", async () => {
    const store = useCustomIconStore.getState()
    await store.patch(
      "browser",
      new Map([
        ["one", image],
        ["two", image],
      ])
    )
    await store.patch("browser", new Map([["one", null]]))
    expect(useCustomIconStore.getState().images).toEqual({ two: image })
    expect(customIconRepository.patch).toHaveBeenCalledTimes(2)
  })
  it("retains current images if storage fails", async () => {
    useCustomIconStore.setState({ images: { one: image } })
    vi.mocked(customIconRepository.patch).mockRejectedValue(
      new Error("quota exceeded")
    )
    await expect(
      useCustomIconStore.getState().patch("browser", new Map([["one", null]]))
    ).rejects.toThrow("Existing icons are unchanged")
    expect(useCustomIconStore.getState().images).toEqual({ one: image })
  })
  it("ignores stale reads and writes after switching source", async () => {
    let resolve!: (
      value: Awaited<ReturnType<typeof customIconRepository.list>>
    ) => void
    vi.mocked(customIconRepository.list).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const load = useCustomIconStore.getState().reload()
    useCustomIconStore.getState().activate("vault")
    resolve([{ source: "browser", id: "one", image, updatedAt: 1 }])
    await load
    expect(useCustomIconStore.getState().images).toEqual({})
    await expect(
      useCustomIconStore.getState().patch("browser", new Map([["one", image]]))
    ).rejects.toThrow("Active Source changed")
    expect(customIconRepository.patch).not.toHaveBeenCalled()
  })
  it("reports read errors without preventing bookmark rendering or destroying data", async () => {
    vi.mocked(customIconRepository.list).mockRejectedValue(
      new Error("unavailable")
    )
    await useCustomIconStore.getState().reload()
    expect(useCustomIconStore.getState().ready).toBe(true)
    expect(useCustomIconStore.getState().error).toContain("unavailable")
    expect(customIconRepository.patch).not.toHaveBeenCalled()
  })
  it("reconciles the full tree on startup and changes, preserving IDs after move/rename and ignoring failed loads", async () => {
    let tree: BookmarkNode[] = [
      {
        id: "root",
        title: "Root",
        children: [
          { id: "one", title: "One", url: "https://same.test" },
          { id: "two", title: "Two", url: "https://same.test" },
        ],
      },
    ]
    const subscribe = () => () => {}
    const adapter = {
      bookmarks: {
        getTree: vi.fn(async () => tree),
        onChanged: subscribe,
        onMoved: subscribe,
        onCreated: subscribe,
        onRemoved: subscribe,
      },
      storage: { get: async () => null },
      capabilities: {},
    } as unknown as BrowserAdapter
    const cleanup = await useBookmarkStore
      .getState()
      .init(adapter, { iconSource: "browser" })
    expect(customIconRepository.prune).toHaveBeenLastCalledWith(
      "browser",
      new Set(["one", "two"]),
      expect.any(Number)
    )
    tree = [
      {
        id: "new-parent",
        title: "Moved",
        children: [{ id: "one", title: "Renamed", url: "https://same.test" }],
      },
    ]
    await useBookmarkStore.getState().refresh()
    expect(customIconRepository.prune).toHaveBeenLastCalledWith(
      "browser",
      new Set(["one"]),
      expect.any(Number)
    )
    vi.mocked(adapter.bookmarks.getTree).mockRejectedValue(new Error("offline"))
    await useBookmarkStore.getState().refresh()
    expect(customIconRepository.prune).toHaveBeenCalledTimes(2)
    cleanup?.()
  })
})
