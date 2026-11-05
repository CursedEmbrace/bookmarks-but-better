// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { planImport } from "./import-plan"
import { executeImportPlan, formatImportResult } from "./import-bookmarks"

const separator: BookmarkNode = { id: "s", type: "separator", title: "" }
const nodes: BookmarkNode[] = [
  separator,
  { id: "a", title: "A", url: "https://a.example" },
  { id: "f", title: "Nested", children: [separator, separator] },
  separator,
]

describe("separator import/export", () => {
  it("round trips leading, consecutive, nested and trailing separators in sibling order", () => {
    const html = serializeNetscapeBookmarks([
      { id: "root", title: "", children: nodes },
    ])
    const parsed = parseNetscapeBookmarks(html)[0].children!
    expect(parsed.map((n) => n.type ?? n.title)).toEqual([
      "separator",
      "A",
      "Nested",
      "separator",
    ])
    expect(parsed[2].children?.map((n) => n.type)).toEqual([
      "separator",
      "separator",
    ])
    expect(parsed[0].url).toBeUndefined()
    expect(parsed[0].children).toBeUndefined()
  })

  it("awaits ordered appends around separators in each destination, including folders", async () => {
    const writes: Record<string, string[]> = {}
    const adapter = {
      create: vi.fn(
        async ({ title, parentId }: { title: string; parentId: string }) => {
          await Promise.resolve()
          ;(writes[parentId] ??= []).push(title)
          return { id: title }
        }
      ),
      createSeparator: vi.fn(async (parentId: string) => {
        ;(writes[parentId] ??= []).push("separator")
        return separator
      }),
    } as unknown as BookmarkAdapter
    const plan = planImport([], "target", nodes)
    const result = await executeImportPlan(adapter, plan.nodes, "target")
    expect(writes.target).toEqual(["separator", "A", "Nested", "separator"])
    expect(writes.Nested).toEqual(["separator", "separator"])
    expect(result).toMatchObject({
      separators: 4,
      bookmarks: 1,
      folders: 1,
      failed: 0,
    })
    expect(formatImportResult(result)).toContain("4 separators imported")
  })

  it("reports unsupported separators without creating invalid bookmarks or empty folders", async () => {
    const create = vi.fn(async ({ title }: { title: string }) => ({
      id: title,
    }))
    const adapter = { create } as unknown as BookmarkAdapter
    const result = await executeImportPlan(
      adapter,
      planImport([], "target", nodes).nodes,
      "target"
    )
    expect(create).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ failed: 4, bookmarks: 1, folders: 1 })
    expect(formatImportResult(result)).toContain(
      "does not support bookmark separators"
    )
  })
})
