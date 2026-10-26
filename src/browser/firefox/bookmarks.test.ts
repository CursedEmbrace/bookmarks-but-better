// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { FirefoxBookmarkAdapter } from "./bookmarks"
import { ChromeBookmarkAdapter } from "../chrome/bookmarks"
import {
  createAdapterForSource,
  createStandaloneAdapter,
} from "@/sources/adapters"
import { describeSource } from "@/sources/descriptors"

afterEach(() => vi.unstubAllGlobals())

describe("native Firefox separators", () => {
  it("retains native types and removes compatibility URLs on recursive reads and creation", async () => {
    const separator = {
      id: "s",
      title: "",
      type: "separator",
      url: "data:",
      parentId: "f",
    }
    const tree = [
      { id: "f", title: "Folder", type: "folder", children: [separator] },
    ]
    const create = vi.fn().mockResolvedValue(separator)
    vi.stubGlobal("chrome", {
      bookmarks: {
        getTree: async () => tree,
        getSubTree: async () => tree,
        create,
      },
    })
    const adapter = new FirefoxBookmarkAdapter()
    for (const result of [
      await adapter.getTree(),
      await adapter.getSubTree("f"),
    ]) {
      expect(result[0].children?.[0]).toMatchObject({
        id: "s",
        type: "separator",
        url: undefined,
        children: undefined,
      })
    }
    expect(await adapter.createSeparator("f", 1)).toMatchObject({
      type: "separator",
      url: undefined,
    })
    expect(create).toHaveBeenCalledWith({
      parentId: "f",
      type: "separator",
      index: 1,
    })
    await adapter.createSeparator("f")
    expect(create).toHaveBeenLastCalledWith({
      parentId: "f",
      type: "separator",
    })
  })

  it("uses Firefox's final index while preserving Chromium's forward adjustment", async () => {
    const move = vi.fn()
    vi.stubGlobal("chrome", {
      bookmarks: {
        move,
        get: async () => [{ id: "s", parentId: "f", index: 0 }],
      },
    })
    await new FirefoxBookmarkAdapter().move("s", { parentId: "f", index: 1 })
    expect(move).toHaveBeenLastCalledWith("s", { parentId: "f", index: 1 })
    await new ChromeBookmarkAdapter().move("s", { parentId: "f", index: 1 })
    expect(move).toHaveBeenLastCalledWith("s", { parentId: "f", index: 2 })
    await new FirefoxBookmarkAdapter().move("s", {
      parentId: "nested",
      index: 0,
    })
    expect(move).toHaveBeenLastCalledWith("s", { parentId: "nested", index: 0 })
  })

  it("offers creation only on the supported Browser Source", () => {
    const source = describeSource("browser", { enabled: true })
    vi.stubGlobal("navigator", { userAgent: "Firefox/140.0" })
    expect(createAdapterForSource(source).capabilities.separators).toBe(true)
    vi.stubGlobal("navigator", { userAgent: "Chrome/140.0" })
    expect(
      createAdapterForSource(source).bookmarks.createSeparator
    ).toBeUndefined()
    expect(createStandaloneAdapter().bookmarks.createSeparator).toBeUndefined()
  })
})
