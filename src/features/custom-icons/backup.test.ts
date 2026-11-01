import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import {
  createIconBackup,
  MAX_BACKUP_BYTES,
  parseIconBackup,
  planIconRestore,
  serializeIconBackup,
} from "./backup"

const image = "data:image/png;base64,aGVsbG8="
const tree: BookmarkNode[] = [
  {
    id: "root",
    title: "",
    children: [
      {
        id: "folder",
        title: "Reading",
        parentId: "root",
        children: [
          { id: "one", title: "One", url: "https://example.com/same" },
          { id: "two", title: "Two", url: "https://example.com/same" },
        ],
      },
    ],
  },
]
const backup = () =>
  createIconBackup(
    "browser",
    "profile-a",
    tree,
    ["one", "two"].map((id) => ({ source: "browser", id, image, updatedAt: 1 }))
  )

describe("custom icon backups", () => {
  it.each([10000, 10001])(
    "exports, imports and matches all %i assignments",
    (count) => {
      const nodes = Array.from({ length: count }, (_, i) => ({
        id: String(i),
        title: `Bookmark ${i}`,
        url: "https://same.test",
      }))
      const records = nodes.map(({ id }) => ({
        source: "browser",
        id,
        image,
        updatedAt: 1,
      }))
      const exported = createIconBackup("browser", "profile-a", nodes, records)
      const imported = parseIconBackup(serializeIconBackup(exported))
      expect(imported).toEqual(exported)
      // Exercise cross-profile metadata matching with many identical URLs too.
      const plan = planIconRestore(imported, "browser", "profile-b", nodes)
      expect(plan.assignments).toHaveLength(count)
      expect(plan.skipped).toEqual([])
      expect(plan.conflicts).toEqual([])
    }
  )

  it("enforces the same UTF-8 byte limit on export and import", () => {
    const large = backup()
    large.assignments[0].title = "é".repeat(MAX_BACKUP_BYTES / 2)
    const text = JSON.stringify(large)
    expect(text.length).toBeLessThan(MAX_BACKUP_BYTES)
    expect(() => serializeIconBackup(large)).toThrow("48 MB")
    expect(() => parseIconBackup(text)).toThrow("48 MB")
    expect(() => parseIconBackup(" ".repeat(MAX_BACKUP_BYTES + 1))).toThrow(
      "48 MB"
    )
  })

  it("accepts the byte boundary and rejects invalid assignment fields and excessive paths", () => {
    const text = serializeIconBackup(backup())
    expect(parseIconBackup(text.padEnd(MAX_BACKUP_BYTES, " "))).toEqual(
      backup()
    )
    for (const patch of [{ folderPath: [42] }, { image: null }, { url: 42 }]) {
      const invalid = {
        ...backup(),
        assignments: [{ ...backup().assignments[0], ...patch }],
      }
      expect(() => parseIconBackup(JSON.stringify(invalid))).toThrow(
        "invalid assignment"
      )
    }
    const deep = backup()
    deep.assignments[0].folderPath = Array(257).fill("Folder")
    expect(() => serializeIconBackup(deep)).toThrow("256 levels")
    expect(() => parseIconBackup(JSON.stringify(deep))).toThrow("256 levels")
  })

  it.each([
    ["browser", "profile-a"],
    ["browser", "other-profile"],
    ["other-source", "profile-a"],
  ])("skips read-only targets when matching in %s / %s", (source, identity) => {
    const mixed = structuredClone(tree)
    mixed[0].children![0].children![0].readOnly = true
    const plan = planIconRestore(backup(), source, identity, mixed)
    expect(plan.assignments.map((item) => item.id)).toEqual(["two"])
    expect(plan.skipped).toEqual([
      {
        title: "One",
        reason: "Bookmark is read-only; its existing icon was not changed.",
      },
    ])
    expect(plan.conflicts).toEqual([])
    // Permission metadata belongs to the current destination, never the file format.
    expect(
      serializeIconBackup(
        createIconBackup(source, identity, mixed, [
          { source, id: "one", image, updatedAt: 1 },
        ])
      )
    ).not.toContain("readOnly")
  })

  it("does not resolve ambiguity by excluding read-only duplicates", () => {
    const mixed = structuredClone(tree)
    mixed[0].children![0].children!.push({
      ...mixed[0].children![0].children![0],
      id: "locked-duplicate",
      readOnly: true,
    })
    const plan = planIconRestore(backup(), "browser", "other-profile", mixed)
    expect(plan.assignments.map((item) => item.id)).toEqual(["two"])
    expect(plan.skipped).toEqual([])
    expect(plan.conflicts).toEqual([
      { title: "One", reason: "Multiple bookmarks have identical metadata." },
    ])
  })
  it("round trips only live bookmark assignments, with paths and no bookmark mutation", () => {
    const original = structuredClone(tree)
    expect(parseIconBackup(JSON.stringify(backup()))).toEqual(backup())
    expect(backup().assignments[0].folderPath).toEqual(["Reading"])
    expect(tree).toEqual(original)
    expect(
      createIconBackup("browser", "p", tree, [
        { source: "browser", id: "deleted", image, updatedAt: 1 },
      ]).assignments
    ).toEqual([])
  })
  it("keeps duplicate URLs distinct by identity in the original profile, even after move/rename", () => {
    const renamed = structuredClone(tree)
    renamed[0].children![0].title = "Moved folder"
    renamed[0].children![0].children![0].title = "Renamed"
    const plan = planIconRestore(backup(), "browser", "profile-a", renamed)
    expect(plan.assignments.map((item) => item.id)).toEqual(["one", "two"])
    expect(plan.conflicts).toEqual([])
  })
  it("matches new IDs by full metadata, never by a coincidentally reused ID", () => {
    const imported = structuredClone(tree)
    imported[0].children![0].children!.forEach((node, index) => {
      node.id = index === 0 ? "two" : "one"
    })
    expect(
      planIconRestore(
        backup(),
        "browser",
        "another-profile",
        imported
      ).assignments.map((item) => item.id)
    ).toEqual(["two", "one"])
    expect(
      planIconRestore(
        backup(),
        "another-source",
        "profile-a",
        imported
      ).assignments.map((item) => item.id)
    ).toEqual(["two", "one"])
  })
  it("reports missing bookmarks and same-URL metadata conflicts", () => {
    const imported = structuredClone(tree)
    imported[0].children![0].children![0].title = "Changed"
    imported[0].children![0].children![1].url = "https://elsewhere.com"
    const plan = planIconRestore(backup(), "browser", "other", imported)
    expect(plan.assignments).toHaveLength(0)
    expect(plan.conflicts).toHaveLength(2)
    expect(
      planIconRestore(backup(), "browser", "other", []).skipped
    ).toHaveLength(2)
  })
  it("refuses indistinguishable duplicates and multiple backup entries targeting one node", () => {
    const duplicate = structuredClone(tree)
    duplicate[0].children![0].children!.push({
      ...duplicate[0].children![0].children![0],
      id: "duplicate",
    })
    const plan = planIconRestore(backup(), "browser", "other", duplicate)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.assignments.map((item) => item.id)).toEqual(["two"])
    const repeated = backup()
    repeated.assignments.push(repeated.assignments[0])
    expect(
      planIconRestore(repeated, "browser", "profile-a", tree).conflicts
    ).toHaveLength(2)
  })
  it("rejects malformed, unknown-version and HTML backups", () => {
    for (const value of [
      "not JSON",
      "null",
      "{}",
      JSON.stringify({ ...backup(), version: 2 }),
      JSON.stringify({ ...backup(), assignments: [null] }),
    ])
      expect(() => parseIconBackup(value)).toThrow()
  })
})
