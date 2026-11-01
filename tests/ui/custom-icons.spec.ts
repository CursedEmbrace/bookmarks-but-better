import { expect, test, type Page } from "@playwright/test"

async function setup(page: Page, scenario = "browser-only") {
  await page.goto(`/?scenario=${scenario}`)
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  return page.evaluate(async () => {
    const storePath = "/src/stores/bookmark-store.ts"
    const preferencesPath = "/src/stores/preferences-store.ts"
    const { useBookmarkStore } = await import(storePath)
    const { usePreferencesStore } = await import(preferencesPath)
    const store = useBookmarkStore.getState()
    const api = store.adapter.bookmarks
    const root = await api.create({
      parentId: store.tree[0].id,
      title: "Icon fixture",
    })
    const folder = await api.create({ parentId: root.id, title: "Icons" })
    const one = await api.create({
      parentId: folder.id,
      title: "Icon One",
      url: "https://same.test/page",
    })
    const two = await api.create({
      parentId: folder.id,
      title: "Icon Two",
      url: "https://same.test/page",
    })
    const nested = await api.create({
      parentId: folder.id,
      title: "Nested icons",
    })
    const three = await api.create({
      parentId: nested.id,
      title: "Nested icon",
      url: "https://same.test/other",
    })
    await store.refresh()
    store.setRootFolderId(root.id)
    await usePreferencesStore.getState().setNestedFolders(true)
    return {
      one: one.id,
      two: two.id,
      three: three.id,
      folder: folder.id,
      nested: nested.id,
    }
  })
}

async function fixture(page: Page, color = "red", mime = "image/png") {
  const data = await page.evaluate(
    ({ color, mime }) => {
      const canvas = document.createElement("canvas")
      canvas.width = 512
      canvas.height = 256
      const context = canvas.getContext("2d")!
      context.fillStyle = color
      context.fillRect(0, 0, 256, 256)
      return canvas.toDataURL(mime).split(",")[1]
    },
    { color, mime }
  )
  return {
    name: `icon.${mime.split("/")[1]}`,
    mimeType: mime,
    buffer: Buffer.from(data, "base64"),
  }
}

async function openIconPicker(page: Page, title: string) {
  await page.getByRole("link", { name: title, exact: true }).hover()
  await page
    .getByRole("button", { name: `Change icon for ${title}`, exact: true })
    .click()
}

async function assign(
  page: Page,
  title: string,
  color = "red",
  mime = "image/png"
) {
  await openIconPicker(page, title)
  const dialog = page.getByRole("dialog", { name: "Change icon", exact: true })
  await dialog
    .getByLabel("Choose an image")
    .setInputFiles(await fixture(page, color, mime))
  await expect(dialog.getByAltText("New icon preview")).toBeVisible()
  await dialog.getByRole("button", { name: "Save icon", exact: true }).click()
  await expect(dialog.getByRole("status")).toHaveText("Custom icon saved.")
  await dialog.getByRole("button", { name: "Done", exact: true }).click()
}

function icon(page: Page, title: string) {
  return page
    .getByRole("link", { name: title, exact: true })
    .locator('img[data-custom-icon="true"]')
}

async function dataSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Data & Migration", exact: true }).click()
}

for (const scheme of ["light", "dark"]) {
  test(`file pickers are discoverable and keyboard operable in ${scheme} theme`, async ({
    page,
  }) => {
    await setup(page)
    await page.evaluate(
      (scheme) =>
        document.documentElement.classList.toggle("dark", scheme === "dark"),
      scheme
    )
    await openIconPicker(page, "Icon One")
    const dialog = page.getByRole("dialog", {
      name: "Change icon",
      exact: true,
    })
    const choose = dialog.getByRole("button", {
      name: "Choose image from computer",
      exact: true,
    })
    await expect(
      dialog.getByText("No image selected.", { exact: true })
    ).toBeVisible()
    await expect(choose).toHaveCSS("cursor", "pointer")
    const background = await choose.evaluate(
      (button) => getComputedStyle(button).backgroundColor
    )
    await choose.hover()
    await expect
      .poll(() =>
        choose.evaluate((button) => getComputedStyle(button).backgroundColor)
      )
      .not.toBe(background)
    const hover = await choose.evaluate(
      (button) => getComputedStyle(button).backgroundColor
    )
    await page.mouse.down()
    await expect
      .poll(() =>
        choose.evaluate((button) => getComputedStyle(button).backgroundColor)
      )
      .not.toBe(hover)
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await choose.focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Shift+Tab")
    await expect(choose).toBeFocused()
    await expect
      .poll(() =>
        choose.evaluate((button) => getComputedStyle(button).boxShadow)
      )
      .not.toBe("none")
    const fileChooser = page.waitForEvent("filechooser")
    await choose.press("Enter")
    await (await fileChooser).setFiles(await fixture(page))
    await expect(
      dialog.getByText("Selected: icon.png", { exact: true })
    ).toBeVisible()
    await expect(dialog.getByAltText("New icon preview")).toBeVisible()
    await dialog.screenshot({
      path: `test-results/file-picker-${scheme}.png`,
      animations: "disabled",
    })
    await dialog.getByRole("button", { name: "Done", exact: true }).click()
    await dataSettings(page)
    const restore = page.getByRole("button", {
      name: "Choose JSON backup to restore",
      exact: true,
    })
    await expect(
      page.getByText("No backup selected.", { exact: true })
    ).toBeVisible()
    await expect(restore).toHaveCSS("cursor", "pointer")
    const restoreBackground = await restore.evaluate(
      (button) => getComputedStyle(button).backgroundColor
    )
    await restore.hover()
    await expect
      .poll(() =>
        restore.evaluate((button) => getComputedStyle(button).backgroundColor)
      )
      .not.toBe(restoreBackground)
    const restoreHover = await restore.evaluate(
      (button) => getComputedStyle(button).backgroundColor
    )
    await page.mouse.down()
    await expect
      .poll(() =>
        restore.evaluate((button) => getComputedStyle(button).backgroundColor)
      )
      .not.toBe(restoreHover)
    await page.mouse.move(0, 0)
    await page.mouse.up()
    await restore.focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Shift+Tab")
    await expect(restore).toBeFocused()
    await expect
      .poll(() =>
        restore.evaluate((button) => getComputedStyle(button).boxShadow)
      )
      .toMatch(/0px 0px 0px 3px/)
    const backupChooser = page.waitForEvent("filechooser")
    await restore.press("Space")
    await (
      await backupChooser
    ).setFiles({
      name: "my-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "bookmarks-but-better-custom-icons",
          version: 1,
          source: "browser",
          identity: "fixture",
          assignments: [],
        })
      ),
    })
    await expect(
      page.getByText("Selected: my-backup.json", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("Ready: 0; skipped: 0; conflicting: 0.", { exact: true })
    ).toBeVisible()
    // A pointer click also opens the native picker; dismissing it retains the filename.
    const cancelled = page.waitForEvent("filechooser")
    await restore.click()
    await (await cancelled).setFiles([])
    await expect(
      page.getByText("Selected: my-backup.json", { exact: true })
    ).toBeVisible()
  })
}

type DownloadProbe = {
  options?: { url: string; filename: string; saveAs: boolean }
  requests: number
  shown: number[]
  finish(state: string, error?: string): void
}

async function mockNativeDownloads(page: Page, outcome = "pending") {
  await page.evaluate((outcome) => {
    let state = "in_progress"
    let error: string | undefined
    const listeners = new Set<
      (delta: { id: number; state: { current: string } }) => void
    >()
    const probe: DownloadProbe = {
      requests: 0,
      shown: [],
      finish(next, reason) {
        state = next
        error = reason
        for (const listener of listeners)
          listener({ id: 73, state: { current: state } })
      },
    }
    Object.assign(globalThis, {
      iconDownloadProbe: probe,
      browser: {
        runtime: {
          id: "fixture",
          getManifest: () => ({ optional_permissions: ["downloads"] }),
        },
        permissions: {
          request: async () => {
            probe.requests++
            return outcome !== "denied"
          },
        },
        downloads: {
          download: async (options: DownloadProbe["options"]) => {
            probe.options = options
            if (outcome === "cancelled")
              throw new Error("Download canceled by the user")
            if (outcome === "failed") throw new Error("FILE_ACCESS_DENIED")
            return 73
          },
          search: async () => [{ state, error }],
          show: async (id: number) => {
            probe.shown.push(id)
            return false
          },
          onChanged: {
            addListener: (
              listener: (delta: {
                id: number
                state: { current: string }
              }) => void
            ) => listeners.add(listener),
            removeListener: (
              listener: (delta: {
                id: number
                state: { current: string }
              }) => void
            ) => listeners.delete(listener),
          },
        },
      },
    })
  }, outcome)
}

test("native export waits for completion, suggests a dated filename and reveals only the saved download", async ({
  page,
}) => {
  await setup(page)
  await mockNativeDownloads(page)
  await dataSettings(page)
  await page
    .getByRole("button", { name: "Export custom icons", exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (globalThis as unknown as { iconDownloadProbe: DownloadProbe })
            .iconDownloadProbe.options
      )
    )
    .toMatchObject({ saveAs: true })
  const options = await page.evaluate(
    () =>
      (globalThis as unknown as { iconDownloadProbe: DownloadProbe })
        .iconDownloadProbe.options!
  )
  expect(options.filename).toMatch(
    /^bookmarks-but-better-icons-\d{4}-\d{2}-\d{2}\.json$/
  )
  const data = await page.evaluate(
    async (url) => (await fetch(url)).json(),
    options.url
  )
  expect(data.format).toBe("bookmarks-but-better-custom-icons")
  expect(data.version).toBe(1)
  await expect(page.getByText(/Saved \d+ custom icon assignments/)).toHaveCount(
    0
  )
  await expect(
    page.getByRole("button", { name: "Show in Folder", exact: true })
  ).toHaveCount(0)
  await page.evaluate(() =>
    (
      globalThis as unknown as { iconDownloadProbe: DownloadProbe }
    ).iconDownloadProbe.finish("complete")
  )
  await expect(page.getByText(/Saved 0 custom icon assignments/)).toBeVisible()
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Saved 0 custom icon assignments" })
  ).toHaveAttribute("data-tone", "success")
  await page
    .getByRole("button", { name: "Show in Folder", exact: true })
    .click()
  await expect(
    page.getByText(
      "The saved file could not be shown. Find it in your browser's Downloads list."
    )
  ).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { iconDownloadProbe: DownloadProbe })
          .iconDownloadProbe.shown
    )
  ).toEqual([73])
})

for (const outcome of ["cancelled", "denied", "failed", "interrupted"]) {
  test(`native export reports ${outcome} without false success`, async ({
    page,
  }) => {
    await setup(page)
    await mockNativeDownloads(page, outcome)
    await dataSettings(page)
    await page
      .getByRole("button", { name: "Export custom icons", exact: true })
      .click()
    if (outcome === "interrupted") {
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (globalThis as unknown as { iconDownloadProbe: DownloadProbe })
                .iconDownloadProbe.options
          )
        )
        .toBeTruthy()
      await page.evaluate(() =>
        (
          globalThis as unknown as { iconDownloadProbe: DownloadProbe }
        ).iconDownloadProbe.finish("interrupted", "FILE_FAILED")
      )
    }
    await expect(
      page.getByText(
        outcome === "denied"
          ? "Export cancelled: download access was not granted. No backup was saved."
          : outcome === "cancelled"
            ? "Export cancelled. No backup was saved."
            : "The backup download failed. Check your browser's Downloads list and try exporting again.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(
      page.getByText(/Saved \d+ custom icon assignments/)
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Show in Folder", exact: true })
    ).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: "Export custom icons", exact: true })
    ).toBeEnabled()
    if (outcome === "cancelled" || outcome === "denied") {
      const feedback = page
        .getByRole("status")
        .filter({ hasText: "Export cancelled" })
      await expect(feedback).toHaveAttribute("data-tone", "cancelled")
      await expect(feedback.locator('svg[aria-hidden="true"]')).toHaveCount(1)
    } else {
      await expect(page.getByRole("alert")).toHaveClass(/text-destructive/)
      await expect(page.getByRole("alert")).toHaveClass(/bg-destructive\/10/)
    }
  })
}

test("independent duplicate-URL icons survive replacement, reload, grid/list and nested folders", async ({
  page,
}) => {
  await setup(page)
  await assign(page, "Icon One")
  await assign(page, "Icon Two", "blue", "image/jpeg")
  await assign(page, "Nested icon", "green", "image/webp")
  const red = await icon(page, "Icon One").getAttribute("src")
  expect(await icon(page, "Icon Two").getAttribute("src")).not.toBe(red)
  await assign(page, "Icon One", "purple")
  const purple = await icon(page, "Icon One").getAttribute("src")
  expect(purple).not.toBe(red)
  const card = page
    .getByRole("heading", { name: "Icons", exact: true })
    .locator("../..")
  await card.getByRole("button", { name: "Folder actions" }).first().click()
  await page.getByRole("menuitem", { name: "Grid view", exact: true }).click()
  await expect(icon(page, "Icon One")).toHaveCSS("width", "40px")
  await expect(icon(page, "Nested icon")).toBeVisible()
  await page.reload()
  await expect(icon(page, "Icon One")).toHaveAttribute("src", purple!)
  await expect(icon(page, "Icon Two")).toBeVisible()
  await expect(icon(page, "Nested icon")).toBeVisible()
  await openIconPicker(page, "Icon One")
  const dialog = page.getByRole("dialog", { name: "Change icon" })
  await page.screenshot({ path: "test-results/custom-icon-dialog.png" })
  await dialog.getByRole("button", { name: "Reset icon", exact: true }).click()
  await expect(dialog.getByRole("status")).toHaveText(
    "Website favicon restored."
  )
  await page.keyboard.press("Escape")
  await expect(icon(page, "Icon One")).toHaveCount(0)
  await expect(icon(page, "Icon Two")).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Icon One", exact: true })
  ).toBeFocused()
})

test("invalid images and storage failure leave the existing icon intact", async ({
  page,
}) => {
  await setup(page)
  await assign(page, "Icon One")
  const original = await icon(page, "Icon One").getAttribute("src")
  await page.getByRole("link", { name: "Icon One", exact: true }).focus()
  await page.keyboard.press("Alt+i")
  const dialog = page.getByRole("dialog", { name: "Change icon" })
  for (const input of [
    {
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    },
    {
      name: "corrupt.png",
      mimeType: "image/png",
      buffer: Buffer.from("corrupt"),
    },
    {
      name: "oversized.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
    },
  ]) {
    await dialog.getByLabel("Choose an image").setInputFiles(input)
    await expect(dialog.getByRole("alert")).toBeVisible()
    await expect(
      dialog.getByRole("button", { name: "Save icon", exact: true })
    ).toBeDisabled()
  }
  await dialog
    .getByLabel("Choose an image")
    .setInputFiles(await fixture(page, "blue"))
  await expect(dialog.getByAltText("New icon preview")).toBeVisible()
  await page.evaluate(async () => {
    const path = "/src/features/custom-icons/storage.ts"
    const { customIconRepository } = await import(path)
    customIconRepository.patch = async () => {
      throw new Error("quota exceeded")
    }
  })
  await dialog.getByRole("button", { name: "Save icon", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText(
    "Existing icons are unchanged"
  )
  await page.keyboard.press("Escape")
  await expect(icon(page, "Icon One")).toHaveAttribute("src", original!)
  await page.reload()
  await expect(icon(page, "Icon One")).toHaveAttribute("src", original!)
})

test("export and reviewed restoration change only icons and report ambiguous/missing assignments", async ({
  page,
}) => {
  await setup(page)
  await assign(page, "Icon One")
  await dataSettings(page)
  const download = page.waitForEvent("download")
  await page
    .getByRole("button", { name: "Export custom icons", exact: true })
    .click()
  const exportedDownload = await download
  expect(exportedDownload.suggestedFilename()).toMatch(
    /^bookmarks-but-better-icons-\d{4}-\d{2}-\d{2}\.json$/
  )
  await expect(
    page.getByText(/Download requested: bookmarks-but-better-icons-/)
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Show in Folder", exact: true })
  ).toHaveCount(0)
  const stream = await exportedDownload.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  const backup = JSON.parse(Buffer.concat(chunks).toString())
  expect(backup.assignments).toHaveLength(1)
  await page.keyboard.press("Escape")
  await openIconPicker(page, "Icon One")
  await page.getByRole("button", { name: "Reset icon", exact: true }).click()
  await expect(page.getByText("Website favicon restored.")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(icon(page, "Icon One")).toHaveCount(0)
  await dataSettings(page)
  const before = await page.evaluate(async () => {
    const path = "/src/stores/bookmark-store.ts"
    return (await import(path)).useBookmarkStore
      .getState()
      .adapter.bookmarks.getTree()
  })
  backup.identity = "another-profile"
  backup.assignments.push({
    ...backup.assignments[0],
    id: "missing",
    url: "https://missing.test",
    title: "Missing",
  })
  backup.assignments.push({
    ...backup.assignments[0],
    id: "ambiguous",
    title: "Unknown title",
  })
  await page.getByLabel("Restore custom icons from JSON").setInputFiles({
    name: "icons.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  await expect(
    page.getByText("Ready: 1; skipped: 1; conflicting: 1.")
  ).toBeVisible()
  await page
    .getByRole("button", { name: "Restore matching icons", exact: true })
    .click()
  await expect(
    page.getByText("Restored 1; skipped 1; conflicting 1.")
  ).toBeVisible()
  const after = await page.evaluate(async () => {
    const path = "/src/stores/bookmark-store.ts"
    return (await import(path)).useBookmarkStore
      .getState()
      .adapter.bookmarks.getTree()
  })
  expect(after).toEqual(before)
  await page.keyboard.press("Escape")
  await expect(icon(page, "Icon One")).toBeVisible()
})

for (const becomesReadOnly of [false, true]) {
  test(`restore preserves read-only icons${becomesReadOnly ? " when permissions change after preview" : " in a mixed backup"}`, async ({
    page,
  }) => {
    const ids = await setup(page)
    await assign(page, "Icon One")
    await assign(page, "Icon Two")
    const original = await icon(page, "Icon One").getAttribute("src")
    const backup = await page.evaluate(async () => {
      const storagePath = "/src/features/custom-icons/storage.ts"
      const backupPath = "/src/features/custom-icons/backup.ts"
      const storePath = "/src/stores/bookmark-store.ts"
      const { customIconRepository } = await import(storagePath)
      const { createIconBackup } = await import(backupPath)
      const { useBookmarkStore } = await import(storePath)
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 16
      const context = canvas.getContext("2d")!
      context.fillStyle = "blue"
      context.fillRect(0, 0, 16, 16)
      return createIconBackup(
        "browser",
        await customIconRepository.identity(),
        await useBookmarkStore.getState().adapter.bookmarks.getTree(),
        (await customIconRepository.list("browser")).map(
          (record: { image: string }) => ({
            ...record,
            image: canvas.toDataURL(),
          })
        )
      )
    })
    async function makeReadOnly() {
      await page.evaluate(async (id) => {
        const path = "/src/stores/bookmark-store.ts"
        const api = (await import(path)).useBookmarkStore.getState().adapter
          .bookmarks
        const getTree = api.getTree.bind(api)
        api.getTree = async () => {
          const tree = await getTree()
          type Node = { id: string; readOnly?: boolean; children?: Node[] }
          function mark(nodes: Node[]) {
            for (const node of nodes) {
              if (node.id === id) node.readOnly = true
              if (node.children) mark(node.children)
            }
          }
          mark(tree)
          return tree
        }
      }, ids.one)
    }
    if (!becomesReadOnly) await makeReadOnly()
    await dataSettings(page)
    const file = {
      name: "mixed-icons.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    }
    await page.getByLabel("Restore custom icons from JSON").setInputFiles(file)
    if (becomesReadOnly) {
      await expect(
        page.getByText("Ready: 2; skipped: 0; conflicting: 0.")
      ).toBeVisible()
      await makeReadOnly()
      await page
        .getByRole("button", { name: "Restore matching icons", exact: true })
        .click()
      await expect(
        page.getByText(
          "Bookmarks changed since this preview. Choose the backup again to review new matches."
        )
      ).toBeVisible()
      const images = await page.evaluate(async () => {
        const path = "/src/features/custom-icons/storage.ts"
        return (
          await (await import(path)).customIconRepository.list("browser")
        ).map((record: { image: string }) => record.image)
      })
      expect(images).toEqual([original, original])
      await page
        .getByLabel("Restore custom icons from JSON")
        .setInputFiles(file)
    }
    await expect(
      page.getByText("Ready: 1; skipped: 1; conflicting: 0.")
    ).toBeVisible()
    await page
      .getByText("Skipped and conflicting assignments", { exact: true })
      .click()
    await expect(
      page.getByText(
        "Icon One: Bookmark is read-only; its existing icon was not changed."
      )
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Restore matching icons", exact: true })
      .click()
    await expect(
      page.getByText("Restored 1; skipped 1; conflicting 0.")
    ).toBeVisible()
    const records = await page.evaluate(async () => {
      const path = "/src/features/custom-icons/storage.ts"
      return (await import(path)).customIconRepository.list("browser")
    })
    expect(
      records.find((record: { id: string }) => record.id === ids.one).image
    ).toBe(original)
    expect(
      records.find((record: { id: string }) => record.id === ids.two).image
    ).not.toBe(original)
  })
}

test("rename, native drag and deletion preserve identity and collect orphan images", async ({
  page,
}) => {
  const ids = await setup(page)
  await assign(page, "Icon One")
  await page.evaluate(async ({ one }) => {
    const path = "/src/stores/bookmark-store.ts"
    const store = (await import(path)).useBookmarkStore.getState()
    await store.adapter.bookmarks.update(one, { title: "Renamed icon" })
    await store.refresh()
  }, ids)
  await expect(icon(page, "Renamed icon")).toBeVisible()
  const source = page
    .getByRole("link", { name: "Renamed icon", exact: true })
    .locator('xpath=ancestor::*[@draggable="true"][1]')
  await source.dispatchEvent("dragstart", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  })
  await expect(source).toHaveClass(/opacity-40/)
  const target = page
    .getByRole("heading", { name: "Nested icons", exact: true })
    .locator("../..")
  await target.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    el.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 10,
        clientY: rect.y + rect.height / 2,
      })
    )
  })
  await expect(target).toHaveAttribute("data-drop-active", "true")
  await target.dispatchEvent("drop")
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
  await expect(
    target
      .getByRole("link", { name: "Renamed icon", exact: true })
      .locator("img[data-custom-icon]")
  ).toBeVisible()
  await page.evaluate(async ({ nested }) => {
    const path = "/src/stores/bookmark-store.ts"
    const store = (await import(path)).useBookmarkStore.getState()
    await store.adapter.bookmarks.removeTree(nested)
    await store.refresh()
  }, ids)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const path = "/src/features/custom-icons/storage.ts"
        return (await import(path)).customIconRepository.list("browser")
      })
    )
    .toEqual([])
})

test("open dashboard tabs share committed assignments and resets", async ({
  page,
  context,
}) => {
  await setup(page)
  const second = await context.newPage()
  await second.goto("/")
  await expect(
    second.getByRole("link", { name: "Icon One", exact: true })
  ).toBeVisible()
  await assign(page, "Icon One")
  await expect(icon(second, "Icon One")).toBeVisible()
  await openIconPicker(second, "Icon One")
  await second.getByRole("button", { name: "Reset icon", exact: true }).click()
  await expect(second.getByText("Website favicon restored.")).toBeVisible()
  await expect(icon(page, "Icon One")).toHaveCount(0)
})

test("source switches close the picker and restore only that source's icons", async ({
  page,
}) => {
  await setup(page, "browser-daemon")
  await assign(page, "Icon One")
  await openIconPicker(page, "Icon One")
  await page.evaluate(async () => {
    const path = "/src/stores/source-store.ts"
    const store = (await import(path)).useSourceStore.getState()
    const vault = Object.keys(store.config.sources).find((id) =>
      id.startsWith("daemon:")
    )
    await store.switchSource(vault)
  })
  await expect(
    page.getByRole("dialog", { name: "Change icon", exact: true })
  ).toHaveCount(0)
  await expect(page.locator("img[data-custom-icon]")).toHaveCount(0)
  await page.evaluate(async () => {
    const path = "/src/stores/source-store.ts"
    await (await import(path)).useSourceStore.getState().switchSource("browser")
  })
  await expect(icon(page, "Icon One")).toBeVisible()
})

test("bookmark Delete matches the folder destructive icon colour across interaction states", async ({
  page,
}) => {
  await setup(page)
  const card = page
    .getByRole("heading", { name: "Icons", exact: true })
    .locator("../..")
  await card.getByRole("button", { name: "Folder actions" }).first().click()
  const folderDelete = page
    .locator('[data-slot="dropdown-menu-item"][data-variant="destructive"] svg')
    .last()
  await expect(folderDelete).toBeVisible()
  const destructiveColour = await folderDelete.evaluate(
    (icon) => getComputedStyle(icon).color
  )
  await page.keyboard.press("Escape")
  await page.getByRole("link", { name: "Icon One", exact: true }).hover()
  const remove = page
    .locator('[data-slot="hover-card-content"]')
    .getByRole("button", { name: "Delete", exact: true })
  const bin = remove.locator("svg")
  await expect(bin).toHaveCSS("color", destructiveColour)
  await remove.hover()
  await expect(bin).toHaveCSS("color", destructiveColour)
  await remove.focus()
  await page.keyboard.press("Shift+Tab")
  await page.keyboard.press("Tab")
  await expect(remove).toBeFocused()
  await expect(bin).toHaveCSS("color", destructiveColour)
})

for (const layout of ["List", "Grid"]) {
  test(`${layout} icons have one footer action, no overlay, and keyboard activation preserves navigation`, async ({
    page,
  }) => {
    await setup(page)
    const card = page
      .getByRole("heading", { name: "Icons", exact: true })
      .locator("../..")
    if (layout === "Grid") {
      await card.getByRole("button", { name: "Folder actions" }).first().click()
      await page
        .getByRole("menuitem", { name: "Grid view", exact: true })
        .click()
    }
    const link = page.getByRole("link", { name: "Icon One", exact: true })
    const row = link.locator("..")
    await link.hover()
    const action = page.getByRole("button", {
      name: "Change icon for Icon One",
      exact: true,
    })
    await expect(action).toBeVisible()
    await expect(row.getByRole("button")).toHaveCount(0)
    const popup = page
      .locator('[data-slot="hover-card-content"]')
      .filter({ has: action })
    await expect(popup.getByRole("button")).toHaveCount(4)
    await expect(
      popup.getByRole("button", { name: "Change icon", exact: true })
    ).toHaveCount(0)
    const footer = action.locator("..")
    await expect(footer.getByRole("button")).toHaveCount(4)
    if (layout === "Grid")
      await popup.screenshot({
        path: "test-results/custom-icon-footer.png",
        animations: "disabled",
      })
    await action.hover()
    await expect(
      page
        .locator('[data-slot="tooltip-content"]')
        .filter({ hasText: "Change bookmark icon (Alt+I)" })
    ).toBeVisible()
    const originalUrl = page.url()
    // Keyboard order follows the compact left group, then the right-aligned Delete.
    await expect(footer.getByRole("button")).toHaveCount(4)
    expect(
      await footer
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("aria-label"))
        )
    ).toEqual(["Edit", "Change icon for Icon One", "Copy Link", "Delete"])
    const boxes = await footer.getByRole("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect()
        return {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          right: box.right,
        }
      })
    )
    expect(boxes[1].x - boxes[0].right).toBeCloseTo(
      boxes[2].x - boxes[1].right,
      0
    )
    expect(boxes[3].x - boxes[2].right).toBeGreaterThan(
      boxes[1].x - boxes[0].right + 20
    )
    const bounds = await footer.boundingBox()
    expect(boxes[0].x).toBeCloseTo(bounds!.x, 0)
    expect(boxes[3].right).toBeCloseTo(bounds!.x + bounds!.width, 0)
    for (const box of boxes) {
      expect(box.width).toBe(boxes[0].width)
      expect(box.height).toBe(boxes[0].height)
      expect(box.y).toBeCloseTo(boxes[0].y, 0)
    }
    await footer.getByRole("button", { name: "Edit", exact: true }).focus()
    for (const name of ["Change icon for Icon One", "Copy Link", "Delete"]) {
      await page.keyboard.press("Tab")
      await expect(
        footer.getByRole("button", { name, exact: true })
      ).toBeFocused()
    }
    await footer.getByRole("button", { name: "Edit", exact: true }).focus()
    await page.keyboard.press("Tab")
    await expect(action).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(
      page.getByRole("dialog", { name: "Change icon", exact: true })
    ).toBeVisible()
    expect(page.url()).toBe(originalUrl)
    await page.keyboard.press("Escape")
    await expect(link).toBeFocused()
    await expect(row.getByRole("button")).toHaveCount(0)
    await page.route("https://same.test/page", (route) =>
      route.fulfill({ body: "Bookmark destination" })
    )
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL("https://same.test/page")
  })
}
