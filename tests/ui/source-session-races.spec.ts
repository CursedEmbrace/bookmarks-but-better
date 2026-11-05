import { expect, test, type Page } from "@playwright/test"

declare global {
  interface Window {
    __sourceSessionRace: { finish(): Promise<void> }
  }
}

async function switchSource(page: Page, label: string) {
  await page.getByRole("button", { name: "Bookmark source" }).click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Bookmark source" })
  ).toContainText(label)
  await expect(
    page.getByText(
      label === "reading" ? "SQLite is not a toy database" : "MDN Web Docs",
      { exact: true }
    )
  ).toBeVisible()
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const bookmarkPath = "/src/stores/bookmark-store.ts"
    const sourcePath = "/src/stores/source-store.ts"
    const { useBookmarkStore } = (await import(
      bookmarkPath
    )) as typeof import("../../src/stores/bookmark-store")
    const { useSourceStore } = (await import(
      sourcePath
    )) as typeof import("../../src/stores/source-store")
    const {
      tree,
      rootFolderId,
      rootFolder,
      status,
      isLoading,
      loadError,
      mutationError,
    } = useBookmarkStore.getState()
    return {
      tree,
      rootFolderId,
      rootFolder,
      status,
      isLoading,
      loadError,
      mutationError,
      source: useSourceStore.getState().activeSourceId,
    }
  })
}

// The real Workbench adapter performs the read/write. A deferred gate holds
// only its completion, so the actual source menu can switch deterministically.
async function begin(page: Page, kind: "retry" | "mutation", fails: boolean) {
  await page.evaluate(
    async ({ kind, fails }) => {
      const bookmarkPath = "/src/stores/bookmark-store.ts"
      const runtimePath = "/src/dev/runtime.ts"
      const { useBookmarkStore } = (await import(
        bookmarkPath
      )) as typeof import("../../src/stores/bookmark-store")
      const { setFaults } = (await import(
        runtimePath
      )) as typeof import("../../src/dev/runtime")
      await setFaults({
        daemonOnline: !(kind === "retry" && fails),
        mutationFailure: kind === "mutation" && fails,
        daemonLatencyMs: 0,
      })
      let release!: () => void
      let started!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const reached = new Promise<void>((resolve) => {
        started = resolve
      })
      const store = useBookmarkStore.getState()
      const api = store.adapter!.bookmarks
      async function hold<T>(operation: Promise<T>): Promise<T> {
        const outcome = await operation.then(
          (value) => ({ value }),
          (error) => ({ error })
        )
        started()
        await gate
        if ("error" in outcome) throw outcome.error
        return outcome.value
      }
      let pending: Promise<void>
      if (kind === "retry") {
        const original = api.checkHealth!
        api.checkHealth = () => {
          api.checkHealth = original
          return hold(original())
        }
        pending = store.retry()
      } else {
        const original = api.create
        api.create = (input) => {
          api.create = original
          return hold(original(input))
        }
        pending = store.createBookmark(
          store.tree[0].id,
          "Original source write",
          "https://example.test/original-source"
        )
      }
      window.__sourceSessionRace = {
        finish: async () => {
          release()
          await pending
        },
      }
      await reached
      await setFaults({ daemonOnline: true, mutationFailure: false })
    },
    { kind, fails }
  )
}

for (const roundTrip of [false, true]) {
  test(`C1 clears a completed mutation error after ${roundTrip ? "A → B → A" : "A → B"}`, async ({
    page,
  }, info) => {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort()
    )
    await page.goto("/?scenario=browser-daemon")
    await expect(page.getByText("MDN Web Docs", { exact: true })).toBeVisible()
    const browserBefore = await snapshot(page)
    await switchSource(page, "reading")
    const readingBefore = await snapshot(page)
    await begin(page, "mutation", true)
    // Finish the failed write and observe its banner BEFORE switching.
    await page.evaluate(() => window.__sourceSessionRace.finish())
    await expect(page.getByRole("alert")).toHaveText(
      "Simulated mutation failure (Dev Workbench failure control)."
    )
    const failed = await snapshot(page)
    expect(failed.tree).toEqual(readingBefore.tree)

    await switchSource(page, "Browser bookmarks")
    await expect(page.getByRole("alert")).toHaveCount(0)
    expect(await snapshot(page)).toEqual(browserBefore)
    if (roundTrip) {
      await switchSource(page, "reading")
      await expect(page.getByRole("alert")).toHaveCount(0)
      expect(await snapshot(page)).toEqual(readingBefore)
    }
    await info.attach("completed-error-transition", {
      body: JSON.stringify(
        { browserBefore, readingBefore, failed, after: await snapshot(page) },
        null,
        2
      ),
      contentType: "application/json",
    })
  })
}

for (const kind of ["retry", "mutation"] as const) {
  for (const fails of [false, true]) {
    for (const roundTrip of [false, true]) {
      test(`${kind} ${fails ? "failure" : "success"} stays in its session after ${roundTrip ? "A → B → A" : "A → B"}`, async ({
        page,
      }, info) => {
        await page.route("**/*", (route) =>
          new URL(route.request().url()).hostname === "127.0.0.1"
            ? route.continue()
            : route.abort()
        )
        await page.goto("/?scenario=browser-daemon")
        await switchSource(page, "reading")
        await begin(page, kind, fails)
        await switchSource(page, "Browser bookmarks")
        if (roundTrip) await switchSource(page, "reading")

        // Produce a legitimate current-session error through the store, so
        // a stale success has a visible banner it must not clear.
        if (kind === "mutation") {
          await page.evaluate(async () => {
            const path = "/src/stores/bookmark-store.ts"
            const { useBookmarkStore } = (await import(
              path
            )) as typeof import("../../src/stores/bookmark-store")
            const api = useBookmarkStore.getState().adapter!.bookmarks
            const original = api.update
            api.update = async () => {
              throw new Error("Current source mutation error")
            }
            await useBookmarkStore
              .getState()
              .updateBookmark("current", { title: "Refused" })
            api.update = original
          })
          await expect(page.getByRole("alert")).toHaveText(
            "Current source mutation error"
          )
        }
        const before = await snapshot(page)
        await page.evaluate(() => window.__sourceSessionRace.finish())
        const after = await snapshot(page)
        expect(after).toEqual(before)
        expect(after.status).toBe("ready")
        expect(after.isLoading).toBe(false)
        expect(after.loadError).toBeNull()
        await expect(
          page.getByRole("button", { name: "Bookmark source" })
        ).toContainText(roundTrip ? "reading" : "Browser bookmarks")
        await expect(
          page.getByText(
            roundTrip ? "SQLite is not a toy database" : "MDN Web Docs",
            { exact: true }
          )
        ).toBeVisible()
        await expect(
          page.getByText("Bookmarks are unavailable.", { exact: true })
        ).toHaveCount(0)
        if (kind === "mutation") {
          await expect(page.getByRole("alert")).toHaveText(
            "Current source mutation error"
          )
          // A successful write persists in its original Vault, never B.
          if (!roundTrip) {
            await expect(
              page.getByText("Original source write", { exact: true })
            ).toHaveCount(0)
            await switchSource(page, "reading")
          }
          await expect(
            page.getByText("Original source write", { exact: true })
          ).toHaveCount(fails ? 0 : 1)
        }
        await info.attach("session-state", {
          body: JSON.stringify({ before, after }, null, 2),
          contentType: "application/json",
        })
      })
    }
  }
}
