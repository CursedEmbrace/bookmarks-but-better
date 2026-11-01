import { beforeEach, describe, expect, it, vi } from "vitest"
import { IDBDatabase } from "fake-indexeddb"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { CustomIconRepository } from "./storage"
import { createIconBackup, planIconRestore } from "./backup"

const image = "data:image/png;base64,YQ=="
const replacement = "data:image/png;base64,Yg=="
beforeEach(() => {
  installFakeIndexedDB()
})

describe("custom icon storage", () => {
  it("restores writable matches while preserving read-only icons and other sources", async () => {
    const repository = new CustomIconRepository()
    const tree = [
      { id: "one", title: "Locked", url: "https://same.test", readOnly: true },
      { id: "two", title: "Writable", url: "https://same.test" },
    ]
    await repository.patch(
      "browser",
      new Map([
        ["one", image],
        ["two", image],
      ])
    )
    await repository.patch("other-source", new Map([["two", image]]))
    const backup = createIconBackup(
      "browser",
      "profile",
      tree,
      tree.map(({ id }) => ({
        source: "browser",
        id,
        image: replacement,
        updatedAt: 1,
      }))
    )
    const plan = planIconRestore(backup, "browser", "profile", tree)
    expect(plan.skipped).toHaveLength(1)
    expect(plan.assignments).toHaveLength(1)
    await repository.patch(
      "browser",
      new Map(plan.assignments.map(({ id, image }) => [id, image]))
    )
    expect(
      (await repository.list("browser")).map(({ id, image }) => [id, image])
    ).toEqual([
      ["one", image],
      ["two", replacement],
    ])
    expect((await repository.list("other-source"))[0].image).toBe(image)
  })
  it("allows retry after opening IndexedDB fails", async () => {
    const repository = new CustomIconRepository()
    const open = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      throw new DOMException("Storage unavailable", "SecurityError")
    })
    await expect(repository.list("browser")).rejects.toThrow(
      "Storage unavailable"
    )
    open.mockRestore()
    await expect(repository.list("browser")).resolves.toEqual([])
  })
  it("assigns, replaces, resets and survives repository recreation without mixing sources", async () => {
    const repository = new CustomIconRepository()
    await repository.patch(
      "browser",
      new Map([
        ["one", image],
        ["two", replacement],
      ])
    )
    await repository.patch("vault", new Map([["one", replacement]]))
    await repository.patch("browser", new Map([["one", replacement]]))
    const reloaded = new CustomIconRepository()
    expect(
      (await reloaded.list("browser")).map((record) => record.image)
    ).toEqual([replacement, replacement])
    await reloaded.patch("browser", new Map([["one", null]]))
    expect(
      (await repository.list("browser")).map((record) => record.id)
    ).toEqual(["two"])
    expect(await repository.list("vault")).toHaveLength(1)
    expect(await repository.identity()).toEqual(await reloaded.identity())
  })
  it("prunes deleted bookmark/folder descendants only in the requested source", async () => {
    const repository = new CustomIconRepository()
    await repository.patch(
      "browser",
      new Map([
        ["keep", image],
        ["deleted", image],
      ])
    )
    await repository.patch("vault", new Map([["deleted", image]]))
    await repository.prune("browser", new Set(["keep"]), Date.now() + 1)
    expect(
      (await repository.list("browser")).map((record) => record.id)
    ).toEqual(["keep"])
    expect(await repository.list("vault")).toHaveLength(1)
  })
  it("does not prune icons written after a tree read began", async () => {
    const repository = new CustomIconRepository()
    const readStartedAt = Date.now() - 1
    await repository.patch("browser", new Map([["new", image]]))
    await repository.prune("browser", new Set(), readStartedAt)
    expect(await repository.list("browser")).toHaveLength(1)
  })
  it("rolls back an aborted transaction and retains previously saved icons", async () => {
    const repository = new CustomIconRepository()
    await repository.patch("browser", new Map([["one", image]]))
    const original = IDBDatabase.prototype.transaction
    const spy = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementationOnce(function (this: IDBDatabase, ...args) {
        const tx = original.apply(this, args)
        queueMicrotask(() => tx.abort())
        return tx
      })
    await expect(
      repository.patch(
        "browser",
        new Map([
          ["one", replacement],
          ["two", image],
        ])
      )
    ).rejects.toThrow()
    spy.mockRestore()
    expect(
      (await repository.list("browser")).map((record) => [
        record.id,
        record.image,
      ])
    ).toEqual([["one", image]])
  })
  it("rejects unsafe data and an oversized source without evicting existing icons", async () => {
    const repository = new CustomIconRepository()
    await repository.patch("browser", new Map([["one", image]]))
    await expect(
      repository.patch(
        "browser",
        new Map([["one", "data:image/svg+xml,<svg/>"]])
      )
    ).rejects.toThrow()
    const large = "data:image/png;base64," + "a".repeat(128000)
    await expect(
      repository.patch(
        "browser",
        new Map([
          ["one", replacement],
          ...Array.from({ length: 270 }, (_, i): [string, string] => [
            String(i),
            large,
          ]),
        ])
      )
    ).rejects.toThrow("32 MB")
    expect(await repository.list("browser")).toHaveLength(1)
    expect((await repository.list("browser"))[0].image).toBe(image)
  })
})
