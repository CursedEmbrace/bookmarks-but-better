import { expect, test } from "@playwright/test"
import {
  configureDeepLayout,
  expectUsableFolder,
  folderGeometry,
  folderMenu,
  levelHeading,
  seedDeepFolders,
} from "./deep-folder-helpers"

for (const depth of [1, 2, 6, 8, 10, 12, 20]) {
  test(`noncompact controls remain usable at depth ${depth}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await seedDeepFolders(page, depth)
    const measurements = []
    const cases = [
      { width: 768, maxColumns: 6 },
      ...[1440, 1024, 700, 390].map((width) => ({ width, maxColumns: 4 })),
      { width: 1920, maxColumns: 4, containerMode: "contained" as const },
      { width: 1920, maxColumns: 4, containerMode: "fluid" as const },
    ]
    for (const options of cases) {
      await configureDeepLayout(page, options)
      // Check each header after scrolling it into view, including the clipping
      // intersections of every ancestor. A DOM-visible button alone is insufficient.
      for (let level = 0; level <= depth; level++) {
        const geometry = await folderGeometry(levelHeading(page, level))
        measurements.push({ ...options, level, ...geometry })
        expectUsableFolder(geometry)
        if (level > 0 && level <= 2 && options.width === 1440) {
          const parent = await levelHeading(page, level - 1)
            .locator("../..")
            .boundingBox()
          // Preserve the established shallow, full-width inset at desktop size.
          expect(geometry.card.width).toBeCloseTo(parent!.width - 32, 0)
        }
      }
      const heading = levelHeading(page, depth)
      const menu = folderMenu(heading)
      const target = (await folderGeometry(heading)).menu
      // A locator click can scroll an overflow-hidden ancestor automatically,
      // masking the original clipping. Click the measured visible point directly.
      await page.mouse.click(
        target.x + target.width / 2,
        target.y + target.height / 2
      )
      await expect(
        page.getByRole("menuitem", { name: "New subfolder", exact: true })
      ).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(menu).toBeFocused()
      await expect(page.getByRole("menu")).toHaveCount(0)

      await heading.focus()
      await page.keyboard.press("Tab")
      await expect(
        heading
          .locator("..")
          .getByRole("button", { name: "Collapse folder", exact: true })
      ).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(menu).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(page.getByRole("menu")).toBeVisible()
      await page.keyboard.press("Escape")
      await expect(menu).toBeFocused()
      await heading.focus()
      await page.keyboard.press("Enter")
      await expect(
        page.getByRole("link", { name: "Deep bookmark", exact: true })
      ).toHaveCount(0)
      await expect(heading).toBeFocused()
      expectUsableFolder(await folderGeometry(heading))
      await page.keyboard.press("Enter")
      await expect(
        page.getByRole("link", { name: "Deep bookmark", exact: true })
      ).toBeVisible()
      await expect(page.locator('[data-compact="true"]')).toHaveCount(0)
    }
    await info.attach("geometry", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    })
  })
}

test("deep noncompact Grid/List, compact toggle, themes and text scaling", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await seedDeepFolders(page, 12)
  for (const compact of [false, true, false]) {
    for (const layout of ["grid", "list", "mixed"] as const) {
      for (const dark of [false, true]) {
        await configureDeepLayout(page, {
          width: 768,
          maxColumns: 6,
          compact,
          layout,
          dark,
        })
        expectUsableFolder(await folderGeometry(levelHeading(page, 12)))
        const menu = folderMenu(levelHeading(page, 12))
        await menu.click()
        await expect(page.getByRole("menu")).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(menu).toBeFocused()
      }
    }
  }
  for (const options of [
    { width: 768, maxColumns: 6, fontSize: 20 },
    { width: 1440, maxColumns: 4, fontSize: 32 },
  ]) {
    await configureDeepLayout(page, options)
    expectUsableFolder(await folderGeometry(levelHeading(page, 12)))
  }
})

test("deep child creation, rename, separators, custom icons and drag cancellation", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const ids = await seedDeepFolders(page, 12)
  await configureDeepLayout(page, { width: 768, maxColumns: 6 })
  const heading = levelHeading(page, 12)
  const menu = folderMenu(heading)
  await folderGeometry(heading)
  await menu.click()
  await page
    .getByRole("menuitem", { name: "New subfolder", exact: true })
    .click()
  await page.getByLabel("Title", { exact: true }).fill("Created deep child")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const child = page.getByRole("heading", {
    name: "Created deep child",
    exact: true,
  })
  await expect(child).toBeVisible()
  await expect(menu).toBeFocused()
  expectUsableFolder(await folderGeometry(child))
  await folderMenu(child).click()
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const longName = "Renamed deep child — " + "UnbrokenFolderName".repeat(8)
  await page.getByLabel("Title", { exact: true }).fill(longName)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const renamed = page.getByRole("heading", { name: longName, exact: true })
  await expect(renamed).toBeVisible()
  expectUsableFolder(await folderGeometry(renamed))
  const tree = await page.evaluate(
    async ({ parentId, longName, bookmark }) => {
      const path = "/src/stores/bookmark-store.ts"
      const iconPath = "/src/stores/custom-icon-store.ts"
      const { useBookmarkStore } = await import(path)
      const { useCustomIconStore } = await import(iconPath)
      const store = useBookmarkStore.getState()
      const api = store.adapter.bookmarks
      await api.createSeparator(parentId)
      await api.create({
        parentId,
        title: "After separator",
        url: "https://example.test/after",
      })
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 40
      const context = canvas.getContext("2d")!
      context.fillStyle = "purple"
      context.fillRect(0, 0, 40, 40)
      const icon = canvas.toDataURL("image/png")
      await store.refresh()
      const icons = useCustomIconStore.getState()
      await icons.patch(icons.source, new Map([[bookmark, icon]]))
      const [parent] = await api.getSubTree(parentId)
      const created = parent.children.find(
        (node: { title: string }) => node.title === longName
      )
      return {
        parentId: parent.id,
        childId: created?.id,
        childTitle: created?.title,
        childCount: parent.children.filter(
          (node: { children?: unknown[] }) => node.children !== undefined
        ).length,
        icon,
      }
    },
    { parentId: ids.levels[12], longName, bookmark: ids.bookmark }
  )
  expect(tree.parentId).toBe(ids.levels[12])
  expect(tree.childId).toBeTruthy()
  expect(tree.childTitle).toBe(longName)
  expect(tree.childCount).toBe(1)
  const link = page.getByRole("link", { name: "Deep bookmark", exact: true })
  await expect(link.locator("img")).toHaveAttribute("src", tree.icon)
  const deepest = heading.locator("../..")
  const separator = deepest.getByTestId("bookmark-separator")
  const before = await link.boundingBox()
  const after = await page
    .getByRole("link", { name: "After separator", exact: true })
    .boundingBox()
  const separatorBox = await separator.boundingBox()
  expect(separatorBox!.y).toBeGreaterThanOrEqual(before!.y + before!.height)
  expect(after!.y).toBeGreaterThanOrEqual(
    separatorBox!.y + separatorBox!.height
  )
  await heading.focus()
  await page.keyboard.press("ArrowDown")
  await expect(link).toBeFocused()

  const source = page
    .getByRole("link", { name: "Drag source", exact: true })
    .locator('xpath=ancestor::*[@draggable="true"][1]')
  await source.dispatchEvent("dragstart", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  })
  await renamed.evaluate((element) => {
    element.scrollIntoView({ block: "center" })
    const r = element.getBoundingClientRect()
    element.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: r.x + 5,
        clientY: r.y + 5,
      })
    )
  })
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(1)
  await expect(renamed.locator("../..")).toHaveAttribute(
    "data-drop-active",
    "true"
  )
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0)
  await expect(
    page
      .getByRole("heading", { name: "Sibling", exact: true })
      .locator("../..")
      .getByRole("link", { name: "Drag source", exact: true })
  ).toHaveCount(1)
})

test("lazy deep noncompact controls survive keyboard mounting and animated collapse", async ({
  page,
}) => {
  test.setTimeout(60_000)
  await seedDeepFolders(page, 12)
  await configureDeepLayout(page, { width: 768, maxColumns: 6 })
  await page.evaluate(async () => {
    const bookmarkPath = "/src/stores/bookmark-store.ts"
    const preferencesPath = "/src/stores/preferences-store.ts"
    const { useBookmarkStore } = await import(bookmarkPath)
    const { usePreferencesStore } = await import(preferencesPath)
    const root = structuredClone(useBookmarkStore.getState().rootFolder)
    const chain = root.children.find(
      (node: { title: string }) => node.title === "Level 0"
    )
    const fillers = Array.from({ length: 130 }, (_, i) => ({
      id: `deep-lazy-${i}`,
      title: `Lazy filler ${i}`,
      children: Array.from({ length: 4 }, (_, j) => ({
        id: `deep-lazy-${i}-${j}`,
        title: `Filler bookmark ${i}-${j}`,
        url: `https://example.test/lazy/${i}/${j}`,
      })),
    }))
    // Rendering-only fixture: 521 bookmarks activate the real lazy gate.
    // Mutation tests above use the actual Workbench adapter instead.
    chain.children = [...fillers, ...chain.children]
    root.children = [chain]
    useBookmarkStore.setState({ tree: [root], rootFolder: root })
    usePreferencesStore.setState({
      cardLayouts: {
        ...usePreferencesStore.getState().cardLayouts,
        ...Object.fromEntries(fillers.map((folder) => [folder.id, "grid"])),
      },
    })
  })
  await expect(
    page.getByTestId("bookmark-card-placeholder").first()
  ).toBeAttached()
  await levelHeading(page, 0).focus()
  await page.keyboard.press("End")
  const bookmark = page.getByRole("link", {
    name: "Deep bookmark",
    exact: true,
  })
  await expect(bookmark).toBeFocused()
  await expect(bookmark).toBeInViewport()
  const heading = levelHeading(page, 12)
  expectUsableFolder(await folderGeometry(heading))
  const menu = folderMenu(heading)
  await menu.click()
  await expect(page.getByRole("menu")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(menu).toBeFocused()
  await heading.focus()
  await page.keyboard.press("Enter")
  await expect(bookmark).toHaveCount(0)
  await expect(heading).toBeFocused()
  expectUsableFolder(await folderGeometry(heading))
  await page.keyboard.press("Enter")
  await expect(bookmark).toBeVisible()
  await heading.focus()
  await page.keyboard.press("ArrowDown")
  await expect(bookmark).toBeFocused()
  await page.keyboard.press("Home")
  await expect(levelHeading(page, 0)).toBeFocused()
})
