import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useBookmarkStore } from "../bookmark-store"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useCustomIconStore } from "../custom-icon-store"

/**
 * The session-lifecycle regression suite: what a Source Session owes even
 * when its first load fails. A failed `init` must not leave the session
 * deaf (no adapter-event subscriptions, so a `retry()` that recovers can
 * never refresh on changes) or leak the adapter (its SSE stream and
 * reconnect timers survive teardown) — the failure path owns the same
 * listener registration and disposal as the success path.
 */

function sessionAdapter() {
  const listeners = {
    changed: new Set<() => void>(),
    created: new Set<() => void>(),
    removed: new Set<() => void>(),
    moved: new Set<() => void>(),
  }
  const dispose = vi.fn()
  const adapter: BrowserAdapter = {
    bookmarks: {
      getTree: vi.fn(),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "n1",
        title: "New",
        url: "https://n.example",
      }),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: (cb: () => void) => {
        listeners.changed.add(cb)
        return () => listeners.changed.delete(cb)
      },
      onCreated: (cb: () => void) => {
        listeners.created.add(cb)
        return () => listeners.created.delete(cb)
      },
      onRemoved: (cb: () => void) => {
        listeners.removed.add(cb)
        return () => listeners.removed.delete(cb)
      },
      onMoved: (cb: () => void) => {
        listeners.moved.add(cb)
        return () => listeners.moved.delete(cb)
      },
      openInManager: vi.fn(),
      dispose,
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: false,
    },
  }
  return { adapter, listeners, dispose }
}

function totalListeners(l: ReturnType<typeof sessionAdapter>["listeners"]) {
  return l.changed.size + l.created.size + l.removed.size + l.moved.size
}

/** The store debounces event-driven refreshes at 100ms; let them land. */
function settleDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 150))
}

beforeEach(() => {
  vi.clearAllMocks()
  useBookmarkStore.getState().reset()
  useBookmarkStore.setState({
    tree: [],
    rootFolderId: null,
    isLoading: true,
    adapter: null,
    status: "loading",
    loadError: null,
    mutationError: null,
    rootFolder: null,
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const sourceTree = (title: string): BookmarkNode[] => [
  {
    id: "root",
    title,
    children: [
      { id: "item", title: `${title} item`, url: "https://example.test" },
    ],
  },
]

// Match the source store's generation-backed ownership callback, including
// invalidation before the replacement adapter is available.
let generation = 0
let cleanups: (() => void)[] = []
async function startSession(adapter: BrowserAdapter) {
  const token = ++generation
  const cleanup = await useBookmarkStore.getState().init(adapter, {
    isCurrent: () => token === generation,
  })
  if (cleanup) cleanups.push(cleanup)
}

function readyAdapter(title: string) {
  const { adapter } = sessionAdapter()
  vi.mocked(adapter.bookmarks.getTree).mockResolvedValue(sourceTree(title))
  vi.mocked(adapter.storage.get).mockResolvedValue("root")
  adapter.bookmarks.getSubTree = vi.fn().mockResolvedValue(sourceTree(title))
  adapter.bookmarks.createSeparator = vi.fn()
  adapter.bookmarks.setChildOrder = vi.fn()
  adapter.capabilities.separators = true
  adapter.capabilities.setChildOrder = true
  return adapter
}

afterEach(() => {
  for (const cleanup of cleanups) cleanup()
  cleanups = []
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const mutations = [
  {
    name: "createBookmark",
    method: "create",
    args: [{ parentId: "root", title: "New", url: "https://new.example" }],
    run: () =>
      useBookmarkStore
        .getState()
        .createBookmark("root", "New", "https://new.example"),
  },
  {
    name: "updateBookmark",
    method: "update",
    args: ["item", { title: "Renamed", url: "https://changed.example" }],
    run: () =>
      useBookmarkStore.getState().updateBookmark("item", {
        title: "Renamed",
        url: "https://changed.example",
      }),
  },
  {
    name: "deleteBookmark",
    method: "remove",
    args: ["item"],
    run: () => useBookmarkStore.getState().deleteBookmark("item"),
  },
  {
    name: "deleteFolder",
    method: "removeTree",
    args: ["folder"],
    run: () => useBookmarkStore.getState().deleteFolder("folder"),
  },
  {
    name: "moveBookmark",
    method: "move",
    args: ["item", { parentId: "destination", index: 2 }],
    run: () =>
      useBookmarkStore
        .getState()
        .moveBookmark("item", { parentId: "destination", index: 2 }),
    booleanResult: true,
  },
  {
    name: "setChildOrder",
    method: "setChildOrder",
    args: ["root", ["folder", "item"]],
    run: () =>
      useBookmarkStore.getState().setChildOrder("root", ["folder", "item"]),
    booleanResult: true,
  },
] as const

describe.each(mutations)("$name Source Session ownership", (mutation) => {
  it.each([false, true])(
    "keeps current-session feedback and result semantics (failure=%s)",
    async (fails) => {
      const a = readyAdapter("A")
      await startSession(a)
      const result = deferred<never>()
      const method = vi
        .spyOn(a.bookmarks, mutation.method)
        .mockImplementation(() => result.promise)
      useBookmarkStore.setState({ mutationError: "Previous error" })
      const pending = mutation.run()
      const before = useBookmarkStore.getState()
      if (fails) result.reject(new Error("Current operation failed"))
      else result.resolve(undefined as never)
      expect(await pending).toBe(
        "booleanResult" in mutation ? !fails : undefined
      )
      expect(method).toHaveBeenCalledExactlyOnceWith(...mutation.args)
      expect(useBookmarkStore.getState()).toEqual({
        ...before,
        mutationError: fails ? "Current operation failed" : null,
      })
    }
  )

  for (const transition of [
    "B",
    "B loading",
    "A again",
    "invalidated",
    "reset",
  ] as const) {
    for (const currentError of [null, "Current session error"]) {
      it.each([false, true])(
        `preserves all state after ${transition}, error=${currentError} (failure=%s)`,
        async (fails) => {
          const a = readyAdapter("A")
          const b = readyAdapter("B")
          await startSession(a)
          const result = deferred<never>()
          const method = vi
            .spyOn(a.bookmarks, mutation.method)
            .mockImplementation(() => result.promise)
          const pending = mutation.run()
          const loading = deferred<BookmarkNode[]>()
          let next: Promise<void> | undefined
          if (transition === "invalidated") generation++
          else if (transition === "reset") useBookmarkStore.getState().reset()
          else {
            if (transition === "B loading")
              vi.mocked(b.bookmarks.getTree).mockReturnValueOnce(
                loading.promise
              )
            next = startSession(b)
            if (transition !== "B loading") await next
            if (transition === "A again") await startSession(a) // Reuse the exact adapter.
          }
          useBookmarkStore.setState({ mutationError: currentError })
          const before = useBookmarkStore.getState()
          if (fails) result.reject(new Error("Old operation failed"))
          else result.resolve(undefined as never)
          expect(await pending).toBe(
            "booleanResult" in mutation ? !fails : undefined
          )
          expect(useBookmarkStore.getState()).toEqual(before)
          expect(method).toHaveBeenCalledExactlyOnceWith(...mutation.args)
          expect(b.bookmarks[mutation.method]).not.toHaveBeenCalled()
          loading.resolve(sourceTree("B"))
          await next
        }
      )
    }
  }
})

describe("C1 mutation error lifetime", () => {
  describe.each(mutations)("completed $name", (mutation) => {
    it.each([false, true])(
      "starts B and the next A session without previous feedback (failure=%s)",
      async (fails) => {
        const a = readyAdapter("A")
        const b = readyAdapter("B")
        await startSession(a)
        const result = deferred<never>()
        const method = vi
          .spyOn(a.bookmarks, mutation.method)
          .mockImplementationOnce(() => result.promise)
        const pending = mutation.run()
        if (fails) result.reject(new Error("Completed A failure"))
        else result.resolve(undefined as never)
        await pending
        expect(useBookmarkStore.getState().mutationError).toBe(
          fails ? "Completed A failure" : null
        )

        await startSession(b)
        expect(useBookmarkStore.getState()).toMatchObject({
          adapter: b,
          tree: sourceTree("B"),
          rootFolder: sourceTree("B")[0],
          rootFolderId: "root",
          mutationError: null,
          loadError: null,
          status: "ready",
          isLoading: false,
        })
        expect(method).toHaveBeenCalledExactlyOnceWith(...mutation.args)
        expect(b.bookmarks[mutation.method]).not.toHaveBeenCalled()

        // A legitimate B error must also end when returning to the exact
        // same A adapter: errors belong to sessions, not adapter objects.
        vi.mocked(b.bookmarks.update).mockRejectedValueOnce(
          new Error("Completed B failure")
        )
        await useBookmarkStore.getState().updateBookmark("item", { title: "B" })
        expect(useBookmarkStore.getState().mutationError).toBe(
          "Completed B failure"
        )
        await startSession(a)
        expect(useBookmarkStore.getState()).toMatchObject({
          adapter: a,
          tree: sourceTree("A"),
          rootFolder: sourceTree("A")[0],
          mutationError: null,
          loadError: null,
          status: "ready",
          isLoading: false,
        })
      }
    )
  })

  it("switches without an error or mutation and preserves each source's data", async () => {
    const a = readyAdapter("A")
    const b = readyAdapter("B")
    await startSession(a)
    const before = useBookmarkStore.getState()
    await startSession(b)
    expect(useBookmarkStore.getState().mutationError).toBeNull()
    expect(useBookmarkStore.getState().tree).toEqual(sourceTree("B"))
    await startSession(a)
    expect(useBookmarkStore.getState()).toEqual({
      ...before,
      isCurrentSession: expect.any(Function),
    })
    expect(a.bookmarks.update).not.toHaveBeenCalled()
    expect(b.bookmarks.update).not.toHaveBeenCalled()
  })

  it("clears the old error at init entry, preserving a new error during loading and refresh", async () => {
    const a = readyAdapter("A")
    await startSession(a)
    vi.mocked(a.bookmarks.update).mockRejectedValueOnce(new Error("A failed"))
    await useBookmarkStore.getState().updateBookmark("item", { title: "A" })
    const b = readyAdapter("B")
    const loading = deferred<BookmarkNode[]>()
    vi.mocked(b.bookmarks.getTree).mockReturnValueOnce(loading.promise)
    const pending = startSession(b)
    expect(useBookmarkStore.getState().mutationError).toBeNull()
    expect(useBookmarkStore.getState().status).toBe("loading")

    vi.mocked(b.bookmarks.update).mockRejectedValueOnce(new Error("B failed"))
    await useBookmarkStore.getState().updateBookmark("item", { title: "B" })
    expect(useBookmarkStore.getState().mutationError).toBe("B failed")
    loading.resolve(sourceTree("B"))
    await pending
    const before = useBookmarkStore.getState()
    await useBookmarkStore.getState().refresh()
    await useBookmarkStore.getState().retry()
    expect(useBookmarkStore.getState()).toEqual(before)
    expect(before.mutationError).toBe("B failed")

    await useBookmarkStore.getState().updateBookmark("item", { title: "B" })
    expect(useBookmarkStore.getState()).toEqual({
      ...before,
      mutationError: null,
    })
  })

  it("does not clear the active session's error for a superseded init", async () => {
    const a = readyAdapter("A")
    await startSession(a)
    vi.mocked(a.bookmarks.update).mockRejectedValueOnce(new Error("A failed"))
    await useBookmarkStore.getState().updateBookmark("item", { title: "A" })
    const before = useBookmarkStore.getState()
    const b = readyAdapter("B")
    const cleanup = await useBookmarkStore.getState().init(b, {
      isCurrent: () => false,
    })
    cleanup?.()
    expect(useBookmarkStore.getState()).toEqual(before)
    expect(b.bookmarks.getTree).not.toHaveBeenCalled()
    expect(b.bookmarks.dispose).toHaveBeenCalledTimes(1)
  })

  it("clears a completed error on direct same-adapter session reinitialization", async () => {
    const a = readyAdapter("A")
    await startSession(a)
    vi.mocked(a.bookmarks.update).mockRejectedValueOnce(new Error("A failed"))
    await useBookmarkStore.getState().updateBookmark("item", { title: "A" })
    const before = useBookmarkStore.getState()
    const cleanup = await useBookmarkStore.getState().init(a)
    if (cleanup) cleanups.push(cleanup)
    expect(useBookmarkStore.getState()).toEqual({
      ...before,
      isCurrentSession: expect.any(Function),
      mutationError: null,
    })
    expect(useBookmarkStore.getState().isCurrentSession).not.toBe(
      before.isCurrentSession
    )
  })

  it.each(["reset", "dispose"] as const)(
    "preserves %s semantics with a completed error and a pending failure",
    async (end) => {
      const a = readyAdapter("A")
      await startSession(a)
      vi.mocked(a.bookmarks.update).mockRejectedValueOnce(new Error("A failed"))
      await useBookmarkStore.getState().updateBookmark("item", { title: "A" })
      const result = deferred<never>()
      vi.mocked(a.bookmarks.update).mockReturnValueOnce(result.promise)
      const pending = useBookmarkStore
        .getState()
        .updateBookmark("item", { title: "Late" })
      const cleanup = cleanups.pop()!
      cleanup()
      if (end === "reset") useBookmarkStore.getState().reset()
      const before = useBookmarkStore.getState()
      expect(before.mutationError).toBe(end === "reset" ? null : "A failed")
      result.reject(new Error("Expired failure"))
      await pending
      expect(useBookmarkStore.getState()).toEqual(before)
      expect(a.bookmarks.dispose).toHaveBeenCalledTimes(1)
      await startSession(readyAdapter("B"))
      expect(useBookmarkStore.getState().mutationError).toBeNull()
      expect(useBookmarkStore.getState().tree).toEqual(sourceTree("B"))
    }
  )
})

describe("retry Source Session ownership", () => {
  it.each([false, true])(
    "ignores completion after icon reconciliation in an old session (failure=%s)",
    async (fails) => {
      const a = readyAdapter("A")
      await startSession(a)
      useCustomIconStore.getState().activate("A")
      const result = deferred<void>()
      const reached = deferred<void>()
      vi.spyOn(
        useCustomIconStore.getState(),
        "reconcile"
      ).mockImplementationOnce(() => {
        reached.resolve()
        return result.promise
      })
      const pending = useBookmarkStore.getState().retry()
      await reached.promise
      await startSession(readyAdapter("B"))
      await startSession(a)
      const before = useBookmarkStore.getState()
      if (fails) result.reject(new Error("Old icon read failed"))
      else result.resolve()
      await pending
      expect(useBookmarkStore.getState()).toEqual(before)
    }
  )

  for (const transition of [
    "B",
    "B loading",
    "B unavailable",
    "A again",
    "invalidated",
    "reset",
  ] as const) {
    it.each([false, true])(
      `preserves all state after ${transition} (failure=%s)`,
      async (fails) => {
        const a = readyAdapter("A")
        const b = readyAdapter("B")
        vi.mocked(a.bookmarks.getTree).mockRejectedValueOnce(
          new Error("A unavailable")
        )
        await startSession(a)
        const result = deferred<BookmarkNode[]>()
        vi.mocked(a.bookmarks.getTree).mockReturnValueOnce(result.promise)
        const pending = useBookmarkStore.getState().retry()
        expect(useBookmarkStore.getState()).toMatchObject({
          status: "loading",
          loadError: null,
          isLoading: true,
        })
        const loading = deferred<BookmarkNode[]>()
        let next: Promise<void> | undefined
        if (transition === "invalidated") generation++
        else if (transition === "reset") useBookmarkStore.getState().reset()
        else {
          if (transition === "B loading")
            vi.mocked(b.bookmarks.getTree).mockReturnValueOnce(loading.promise)
          if (transition === "B unavailable")
            vi.mocked(b.bookmarks.getTree).mockRejectedValueOnce(
              new Error("B unavailable")
            )
          next = startSession(b)
          if (transition !== "B loading") await next
          if (transition === "A again") await startSession(a)
        }
        useBookmarkStore.setState({ mutationError: "Current session error" })
        const before = useBookmarkStore.getState()
        if (fails) result.reject(new Error("Old retry failed"))
        else result.resolve(sourceTree("Stale retry"))
        await pending
        expect(useBookmarkStore.getState()).toEqual(before)
        loading.resolve(sourceTree("B"))
        await next
      }
    )
  }

  it.each([false, true])(
    "publishes a current retry completion (failure=%s)",
    async (fails) => {
      const a = readyAdapter("A")
      vi.mocked(a.bookmarks.getTree).mockRejectedValueOnce(new Error("Offline"))
      await startSession(a)
      const result = deferred<BookmarkNode[]>()
      vi.mocked(a.bookmarks.getTree).mockReturnValueOnce(result.promise)
      const pending = useBookmarkStore.getState().retry()
      const before = useBookmarkStore.getState()
      const tree = sourceTree("Recovered")
      if (fails) result.reject(new Error("Still offline"))
      else result.resolve(tree)
      await pending
      expect(useBookmarkStore.getState()).toEqual({
        ...before,
        ...(fails
          ? { status: "unavailable", loadError: "Still offline" }
          : {
              tree,
              rootFolder: null,
              status: "ready",
              loadError: null,
              isLoading: false,
            }),
      })
    }
  )
})

describe("session loading and disposal", () => {
  it.each([false, true])(
    "expires an initial load after a direct same-adapter reinitialization (failure=%s)",
    async (fails) => {
      const a = readyAdapter("A")
      const result = deferred<BookmarkNode[]>()
      vi.mocked(a.bookmarks.getTree).mockReturnValueOnce(result.promise)
      const pending = useBookmarkStore.getState().init(a)
      const cleanup = await useBookmarkStore.getState().init(a)
      if (cleanup) cleanups.push(cleanup)
      const before = useBookmarkStore.getState()
      if (fails) result.reject(new Error("Old initial load failed"))
      else result.resolve(sourceTree("Old initial load"))
      const oldCleanup = await pending
      oldCleanup?.()
      expect(useBookmarkStore.getState()).toEqual(before)
    }
  )

  it("expires a retry when its session is disposed without a replacement", async () => {
    const a = readyAdapter("A")
    const cleanup = await useBookmarkStore.getState().init(a)
    const result = deferred<BookmarkNode[]>()
    vi.mocked(a.bookmarks.getTree).mockReturnValueOnce(result.promise)
    const pending = useBookmarkStore.getState().retry()
    cleanup?.()
    const before = useBookmarkStore.getState()
    result.reject(new Error("Disposed session failed"))
    await pending
    expect(useBookmarkStore.getState()).toEqual(before)
  })

  it("does not route an old queued adapter event to the new source", async () => {
    vi.useFakeTimers()
    const { adapter: a, listeners } = sessionAdapter()
    vi.mocked(a.bookmarks.getTree).mockResolvedValue(sourceTree("A"))
    await startSession(a)
    for (const cb of listeners.changed) cb()
    const b = readyAdapter("B")
    await startSession(b)
    const before = useBookmarkStore.getState()
    await vi.advanceTimersByTimeAsync(100)
    expect(useBookmarkStore.getState()).toEqual(before)
    expect(b.bookmarks.getTree).toHaveBeenCalledTimes(1)
  })
})

describe.each(["folder", "separator"] as const)(
  "%s creation session regression",
  (kind) => {
    for (const phase of ["creation", "refresh"] as const) {
      it.each([false, true])(
        `ignores stale ${phase} after A → B → A (failure=%s)`,
        async (fails) => {
          const a = readyAdapter("A")
          await startSession(a)
          const result = deferred<never>()
          const reached = deferred<void>()
          const method =
            phase === "refresh"
              ? "getTree"
              : kind === "folder"
                ? "create"
                : "createSeparator"
          const created: BookmarkNode = {
            id: "new",
            title: "New",
            ...(kind === "folder" ? { children: [] } : { type: "separator" }),
          }
          vi.mocked(a.bookmarks.create).mockResolvedValue(created)
          vi.mocked(a.bookmarks.createSeparator!).mockResolvedValue(created)
          vi.spyOn(a.bookmarks, method).mockImplementationOnce(() => {
            reached.resolve()
            return result.promise
          })
          const pending =
            kind === "folder"
              ? useBookmarkStore.getState().createFolder("root", "New")
              : useBookmarkStore.getState().createSeparator("root", "item")
          await reached.promise
          await startSession(readyAdapter("B"))
          await startSession(a)
          useBookmarkStore.setState({ mutationError: "New A session error" })
          const before = useBookmarkStore.getState()
          if (fails) result.reject(new Error("Old creation failed"))
          else
            result.resolve(
              (phase === "refresh" ? sourceTree("Old A") : created) as never
            )
          expect(await pending).toBeNull()
          expect(useBookmarkStore.getState()).toEqual(before)
        }
      )
    }
  }
)

describe("bookmark-store failed-init session lifecycle", () => {
  it("a session recovered by retry() still refreshes its tree on adapter events", async () => {
    const firstLoad = [{ id: "root", title: "Root", children: [] }] as const
    const afterCreate = [
      {
        id: "root",
        title: "Root",
        children: [{ id: "n1", title: "New", url: "https://n.example" }],
      },
    ] as const
    const { adapter, listeners } = sessionAdapter()
    adapter.bookmarks.getTree = vi
      .fn()
      .mockRejectedValueOnce(new Error("daemon offline"))
      .mockResolvedValueOnce([...firstLoad])
      .mockResolvedValueOnce([...afterCreate])

    const cleanup = await useBookmarkStore.getState().init(adapter)
    expect(useBookmarkStore.getState().status).toBe("unavailable")

    // The daemon comes back; retry recovers the tree...
    await useBookmarkStore.getState().retry()
    expect(useBookmarkStore.getState().status).toBe("ready")
    expect(useBookmarkStore.getState().tree).toEqual([...firstLoad])

    // ...and the session must still be subscribed: a mutation refreshes the
    // tree only because the adapter's created event reaches the store.
    await useBookmarkStore
      .getState()
      .createBookmark("root", "New", "https://n.example")
    for (const cb of listeners.created) cb()
    await settleDebounce()

    expect(adapter.bookmarks.getTree).toHaveBeenCalledTimes(3)
    expect(useBookmarkStore.getState().tree).toEqual([...afterCreate])
    // One subscription per event — retry() repairs the session, it must not
    // duplicate it.
    expect(listeners.changed.size).toBe(1)
    expect(listeners.created.size).toBe(1)
    expect(listeners.removed.size).toBe(1)
    expect(listeners.moved.size).toBe(1)

    cleanup?.()
  })

  it("an external change event also refreshes a session whose init failed", async () => {
    const externalTree = [
      {
        id: "root",
        title: "Root",
        children: [{ id: "x1", title: "Elsewhere" }],
      },
    ] as const
    const { adapter, listeners } = sessionAdapter()
    adapter.bookmarks.getTree = vi
      .fn()
      .mockRejectedValueOnce(new Error("daemon offline"))
      .mockResolvedValueOnce([{ id: "root", title: "Root", children: [] }])
      .mockResolvedValueOnce([...externalTree])

    const cleanup = await useBookmarkStore.getState().init(adapter)
    await useBookmarkStore.getState().retry()

    for (const cb of listeners.changed) cb()
    await settleDebounce()

    expect(useBookmarkStore.getState().tree).toEqual([...externalTree])
    cleanup?.()
  })

  it("the cleanup returned by a failed init unsubscribes the listeners and disposes the adapter", async () => {
    const { adapter, listeners, dispose } = sessionAdapter()
    adapter.bookmarks.getTree = vi
      .fn()
      .mockRejectedValue(new Error("daemon offline"))

    const cleanup = await useBookmarkStore.getState().init(adapter)
    expect(useBookmarkStore.getState().status).toBe("unavailable")

    // The session owned subscriptions despite the failed load...
    expect(totalListeners(listeners)).toBe(4)

    cleanup?.()
    // ...so its cleanup must tear them down and dispose the adapter (SSE
    // stream included) instead of being the init-failure no-op.
    expect(totalListeners(listeners)).toBe(0)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe("folder creation Source Session isolation", () => {
  it.each([false, true])(
    "ignores a stale creation result (failure=%s)",
    async (fails) => {
      const { adapter } = sessionAdapter()
      let resolve!: (node: BookmarkNode) => void
      let reject!: (error: Error) => void
      adapter.bookmarks.create = vi.fn(
        () =>
          new Promise<BookmarkNode>((res, rej) => {
            resolve = res
            reject = rej
          })
      )
      useBookmarkStore.setState({ adapter })
      const pending = useBookmarkStore
        .getState()
        .createFolder("parent", "Child")
      const next = sessionAdapter().adapter
      useBookmarkStore.setState({
        adapter: next,
        mutationError: "Current source error",
      })
      if (fails) reject(new Error("Old source error"))
      else resolve({ id: "child", title: "Child", children: [] })
      expect(await pending).toBeNull()
      expect(useBookmarkStore.getState().mutationError).toBe(
        "Current source error"
      )
      expect(adapter.bookmarks.getTree).not.toHaveBeenCalled()
      expect(next.bookmarks.create).not.toHaveBeenCalled()
      expect(next.bookmarks.getTree).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    "ignores a stale post-creation refresh (failure=%s)",
    async (fails) => {
      const { adapter } = sessionAdapter()
      let resolve!: (tree: BookmarkNode[]) => void
      let reject!: (error: Error) => void
      adapter.bookmarks.getTree = vi.fn(
        () =>
          new Promise<BookmarkNode[]>((res, rej) => {
            resolve = res
            reject = rej
          })
      )
      useBookmarkStore.setState({ adapter })
      const pending = useBookmarkStore
        .getState()
        .createFolder("parent", "Child")
      await vi.waitFor(() =>
        expect(adapter.bookmarks.getTree).toHaveBeenCalled()
      )
      const tree = [{ id: "next", title: "Next source", children: [] }]
      useBookmarkStore.setState({
        adapter: sessionAdapter().adapter,
        tree,
        rootFolder: tree[0],
        status: "ready",
        loadError: null,
      })
      if (fails) reject(new Error("Old source offline"))
      else resolve([{ id: "old", title: "Old source", children: [] }])
      expect(await pending).toBeNull()
      expect(useBookmarkStore.getState().tree).toBe(tree)
      expect(useBookmarkStore.getState().rootFolder).toBe(tree[0])
      expect(useBookmarkStore.getState().status).toBe("ready")
      expect(useBookmarkStore.getState().loadError).toBeNull()
    }
  )
})
