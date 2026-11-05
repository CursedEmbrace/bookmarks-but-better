// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { MutableBookmarkEngine } from "@/dev/engine"
import { clearSourceData } from "@/dev/state"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { executeImportPlan } from "./import-bookmarks"
import { planImport, type ConflictResolution } from "./import-plan"

installFakeIndexedDB()
beforeEach(() => clearSourceData())

const folder = (
  title: string,
  children: BookmarkNode[] = []
): BookmarkNode => ({
  id: title,
  title,
  children,
})
const bookmark = (title: string): BookmarkNode => ({
  id: title,
  title,
  url: `https://example.test/${encodeURIComponent(title)}`,
})

const separator = (): BookmarkNode => ({
  id: "separator",
  title: "",
  type: "separator",
})

// Compare content and sibling order at every level, without generated metadata.
function content(nodes: BookmarkNode[]): unknown[] {
  return nodes.map((node) =>
    node.type === "separator"
      ? { type: "separator" }
      : node.url !== undefined
        ? { title: node.title, url: node.url }
        : { title: node.title, children: content(node.children ?? []) }
  )
}

function destination(
  children: BookmarkNode[] = [],
  flavor: "browser" | "daemon" = "browser"
) {
  const engine = new MutableBookmarkEngine({
    sourceKey: "import-order",
    flavor,
    seed: () => structuredClone(folder("root", children)),
  })
  const adapter = {
    create: engine.create.bind(engine),
    update: engine.update.bind(engine),
    ...(flavor === "browser"
      ? { createSeparator: engine.createSeparator.bind(engine) }
      : {}),
  } as BookmarkAdapter
  return { engine, adapter }
}

const mixed = [
  folder("Z folder"),
  bookmark("Y bookmark"),
  folder("X folder"),
  bookmark("W bookmark"),
]
const nested = [
  folder("Parent", [
    folder("First", mixed),
    bookmark("Middle"),
    folder("Empty"),
    bookmark("Last"),
  ]),
  bookmark("Outside"),
]
const separated = [
  separator(),
  separator(),
  ...mixed,
  folder("Nested separators", [separator(), ...nested, separator()]),
  separator(),
  separator(),
]

describe("imported sibling order", () => {
  it("preserves the original F4 folder-before-bookmark reproduction", async () => {
    const { engine, adapter } = destination()
    const incoming = [folder("Folder first"), bookmark("Bookmark second")]
    const plan = planImport(await engine.getTree(), "root", incoming)

    const result = await executeImportPlan(adapter, plan.nodes, "root")

    expect(result).toMatchObject({ folders: 1, bookmarks: 1, failed: 0 })
    expect(
      (await engine.getTree())[0].children?.map((node) => node.title)
    ).toEqual(["Folder first", "Bookmark second"])
  })

  for (const flavor of ["browser", "daemon"] as const) {
    it.each([
      ["bookmark before folder", [bookmark("First"), folder("Second")]],
      ["alternating siblings", mixed],
      ["nested mixed contents and empty folders", nested],
      [
        "duplicate URLs and repeated new folder names",
        [
          folder("Same"),
          bookmark("Same URL"),
          folder("Same"),
          bookmark("Same URL"),
        ],
      ],
    ])(
      `preserves %s in an empty ${flavor} destination`,
      async (_, incoming) => {
        const { engine, adapter } = destination([], flavor)
        const plan = planImport(await engine.getTree(), "root", incoming)
        const result = await executeImportPlan(adapter, plan.nodes, "root")
        expect(result.failed).toBe(0)
        expect(content((await engine.getTree())[0].children!)).toEqual(
          content(incoming)
        )
      }
    )
  }

  it("preserves leading, trailing, consecutive and nested separators", async () => {
    const { engine, adapter } = destination()
    const plan = planImport(await engine.getTree(), "root", separated)
    const result = await executeImportPlan(adapter, plan.nodes, "root")
    expect(result).toMatchObject({ failed: 0, separators: 6 })
    expect(content((await engine.getTree())[0].children!)).toEqual(
      content(separated)
    )
  })

  it.each(["skip", "replace", "keep-both"] as const)(
    "preserves existing positions and merged child order with %s",
    async (choice: ConflictResolution) => {
      const existing = [
        bookmark("Unrelated before"),
        folder("Shared", [
          bookmark("Duplicate"),
          folder("Nested", [bookmark("Nested existing")]),
          bookmark("Unrelated child"),
        ]),
        bookmark("Unrelated after"),
      ]
      const { engine, adapter } = destination(existing)
      const incoming = [
        folder("New first"),
        folder("Shared", [
          folder("First child"),
          { ...bookmark("Duplicate"), title: "Replacement" },
          bookmark("Duplicate"),
          folder("Nested", [folder("Nested first"), bookmark("Nested second")]),
        ]),
        bookmark("New middle"),
        folder(" shared ", [
          bookmark("Next child"),
          folder("Nested", [bookmark("Nested third"), folder("Nested fourth")]),
          folder("Last child"),
        ]),
        bookmark("New last"),
      ]
      const before = await engine.getTree()
      const plan = planImport(before, "root", incoming)
      expect(plan.conflicts).toHaveLength(1)
      const result = await executeImportPlan(adapter, plan.nodes, "root", {
        [plan.conflicts[0].key]: choice,
      })
      const actual = (await engine.getTree())[0].children!
      expect(actual.slice(0, 3).map((n) => n.id)).toEqual(
        existing.map((n) => n.id)
      )
      expect(actual[0]).toEqual(before[0].children![0])
      expect(actual[2]).toEqual(before[0].children![2])
      expect(content(actual.slice(3))).toEqual(
        content([
          folder("New first"),
          bookmark("New middle"),
          bookmark("New last"),
        ])
      )
      expect(content(actual[1].children!)).toEqual(
        content([
          {
            ...bookmark("Duplicate"),
            title: choice === "replace" ? "Replacement" : "Duplicate",
          },
          folder("Nested", [
            bookmark("Nested existing"),
            folder("Nested first"),
            bookmark("Nested second"),
            bookmark("Nested third"),
            folder("Nested fourth"),
          ]),
          bookmark("Unrelated child"),
          folder("First child"),
          ...(choice === "keep-both"
            ? [{ ...bookmark("Duplicate"), title: "Replacement" }]
            : []),
          bookmark("Duplicate"),
          bookmark("Next child"),
          folder("Last child"),
        ])
      )
      expect(result).toMatchObject({
        merged: 4,
        folders: 5,
        bookmarks: choice === "keep-both" ? 7 : 6,
        failed: 0,
        skipped: choice === "skip" ? 1 : 0,
        replaced: choice === "replace" ? 1 : 0,
      })
    }
  )

  it("retains successful entries in order and counts failed parents, descendants, updates and separators", async () => {
    const existing = [bookmark("Unrelated"), bookmark("Duplicate")]
    const { engine, adapter } = destination(existing)
    const before = await engine.getTree()
    const incoming = [
      folder("Good first"),
      folder("Refused parent", [
        bookmark("Lost child"),
        folder("Lost folder", [bookmark("Lost grandchild")]),
      ]),
      bookmark("Refused bookmark"),
      separator(),
      { ...bookmark("Duplicate"), title: "Refused replacement" },
      bookmark("Good second"),
      folder("Good last", mixed),
    ]
    const plan = planImport(before, "root", incoming)
    const result = await executeImportPlan(
      {
        ...adapter,
        create: async (input) => {
          if (input.title.startsWith("Refused"))
            throw new Error("Synthetic refusal")
          return adapter.create(input)
        },
        update: async () => {
          throw new Error("Update refused")
        },
        createSeparator: async () => {
          throw new Error("Separator refused")
        },
      },
      plan.nodes,
      "root",
      { [plan.conflicts[0].key]: "replace" }
    )
    expect(result).toMatchObject({
      folders: 4,
      bookmarks: 3,
      failed: 7,
      replaced: 0,
      firstError: "Synthetic refusal",
    })
    const actual = (await engine.getTree())[0].children!
    expect(actual.slice(0, 2)).toEqual(before[0].children)
    expect(content(actual.slice(2))).toEqual(
      content([
        folder("Good first"),
        bookmark("Good second"),
        folder("Good last", mixed),
      ])
    )
  })

  it("reports unsupported separators while preserving successful sibling order", async () => {
    const { engine, adapter } = destination([], "daemon")
    const incoming = [
      separator(),
      folder("First"),
      separator(),
      bookmark("Second"),
      separator(),
    ]
    const result = await executeImportPlan(
      adapter,
      planImport(await engine.getTree(), "root", incoming).nodes,
      "root"
    )
    expect(result).toMatchObject({
      folders: 1,
      bookmarks: 1,
      failed: 3,
      firstError: "This source does not support bookmark separators",
    })
    expect(content((await engine.getTree())[0].children!)).toEqual(
      content([folder("First"), bookmark("Second")])
    )
  })

  it("leaves a refusing destination unchanged and reports every unimported node", async () => {
    const { engine, adapter } = destination([bookmark("Protected")])
    const before = await engine.getTree()
    const incoming = [
      folder("Denied", [bookmark("Child")]),
      bookmark("Denied too"),
    ]
    const result = await executeImportPlan(
      {
        ...adapter,
        create: async () => {
          throw new Error("Read only")
        },
      },
      planImport(before, "root", incoming).nodes,
      "root"
    )
    expect(result).toMatchObject({
      folders: 0,
      bookmarks: 0,
      failed: 3,
      firstError: "Read only",
    })
    expect(await engine.getTree()).toEqual(before)
  })

  it("round trips the actual imported tree through HTML without changing sibling order", async () => {
    const { engine, adapter } = destination()
    const incoming = [
      ...separated,
      folder("Repeated"),
      folder("Repeated"),
      bookmark("Duplicate"),
      bookmark("Duplicate"),
    ]
    const parsed = parseNetscapeBookmarks(
      serializeNetscapeBookmarks([folder("root", incoming)])
    )[0].children!
    await executeImportPlan(
      adapter,
      planImport(await engine.getTree(), "root", parsed).nodes,
      "root"
    )
    const actual = await engine.getTree()
    expect(content(actual[0].children!)).toEqual(content(incoming))
    const exported = parseNetscapeBookmarks(
      serializeNetscapeBookmarks(actual)
    )[0].children!
    expect(content(exported)).toEqual(content(incoming))
    // Import the exported tree again into a different, empty destination.
    const second = new MutableBookmarkEngine({
      sourceKey: "round-trip",
      flavor: "browser",
      seed: () => folder("root"),
    })
    await executeImportPlan(
      second as unknown as BookmarkAdapter,
      planImport(await second.getTree(), "root", exported).nodes,
      "root"
    )
    expect(content((await second.getTree())[0].children!)).toEqual(
      content(incoming)
    )
  })

  it("keeps different folders concurrent without overlapping writes to one parent", async () => {
    const { engine, adapter } = destination()
    const incoming = Array.from({ length: 4 }, (_, i) =>
      folder(`Folder ${i}`, [
        bookmark(`First ${i}`),
        folder(`Empty ${i}`),
        bookmark(`Last ${i}`),
      ])
    )
    const plan = planImport(await engine.getTree(), "root", incoming)
    const deferred = () => {
      let resolve!: () => void
      const promise = new Promise<void>((done) => {
        resolve = done
      })
      return { promise, resolve }
    }
    let changed = deferred()
    const notify = () => {
      changed.resolve()
      changed = deferred()
    }
    const firstWave = deferred()
    const pending: { release: () => void; completed: Promise<void> }[] = []
    const activeParents = new Set<string>()
    let peak = 0
    let overlap = false
    let done = false
    const run = executeImportPlan(
      {
        ...adapter,
        create: async (input) => {
          if (input.parentId === "root") return adapter.create(input)
          overlap ||= activeParents.has(input.parentId)
          activeParents.add(input.parentId)
          peak = Math.max(peak, activeParents.size)
          const gate = deferred()
          const completed = deferred()
          pending.push({ release: gate.resolve, completed: completed.promise })
          if (pending.length === 2) firstWave.resolve()
          notify()
          await gate.promise
          try {
            return await adapter.create(input)
          } finally {
            activeParents.delete(input.parentId)
            completed.resolve()
          }
        },
      },
      plan.nodes,
      "root",
      {},
      2
    ).finally(() => {
      done = true
      notify()
    })
    await firstWave.promise
    // Complete the newest pending request first, deliberately reversing the
    // arrival order across folders. No timers or scheduler-speed assumptions.
    while (!done) {
      const request = pending.pop()
      if (!request) {
        await changed.promise
        continue
      }
      request.release()
      await request.completed
    }
    expect(await run).toMatchObject({ failed: 0, bookmarks: 8, folders: 8 })
    expect(peak).toBe(2)
    expect(overlap).toBe(false)
    expect(content((await engine.getTree())[0].children!)).toEqual(
      content(incoming)
    )
  })

  it("preserves a 2,000-bookmark synthetic collection and persists its complete order", async () => {
    const { engine, adapter } = destination()
    const incoming = Array.from({ length: 100 }, (_, f) =>
      folder(
        `Folder ${f}`,
        Array.from({ length: 20 }, (_, b) => [
          ...(b % 5 === 0 ? [folder(`Empty ${f}-${b}`)] : []),
          bookmark(`Bookmark ${f}-${b}`),
        ]).flat()
      )
    )
    const result = await executeImportPlan(
      adapter,
      planImport(await engine.getTree(), "root", incoming).nodes,
      "root"
    )
    expect(result).toMatchObject({ folders: 500, bookmarks: 2000, failed: 0 })
    expect(content((await engine.getTree())[0].children!)).toEqual(
      content(incoming)
    )
    const reloaded = destination().engine
    expect(content((await reloaded.getTree())[0].children!)).toEqual(
      content(incoming)
    )
  }, 60_000)
})
