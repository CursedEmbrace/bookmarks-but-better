import { expect, test, type Locator, type Page } from "@playwright/test"

const LONG_TITLE =
  "Painting techniques, terrain building and miniature collections — " +
  "UnbrokenFolderName".repeat(7)

function card(page: Page, title: string) {
  return page
    .getByRole("heading", { name: title, exact: true })
    .locator("../..")
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  expect(bounds).not.toBeNull()
  return bounds!
}

async function seed(page: Page) {
  await page.goto("/?scenario=firefox-separators")
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  const ids = await page.evaluate(async (longTitle) => {
    const storePath = "/src/stores/bookmark-store.ts"
    const prefsPath = "/src/stores/preferences-store.ts"
    const { useBookmarkStore } = await import(storePath)
    const { usePreferencesStore } = await import(prefsPath)
    const store = useBookmarkStore.getState()
    const adapter = store.adapter.bookmarks
    const layouts: Record<string, "grid" | "list"> = {}
    const ids: Record<string, string> = {}
    const folder = async (parentId: string, title: string, count = 0) => {
      const created = await adapter.create({ parentId, title })
      ids[title] = created.id
      layouts[created.id] = "grid"
      for (let i = 0; i < count; i++) {
        await adapter.create({
          parentId: created.id,
          title: `${title} ${i + 1}`,
          url: `https://example.test/${created.id}/${i}`,
        })
      }
      return created
    }
    const root = await folder(store.tree[0].id, "Compact fixture")
    const parent = await folder(root.id, "Warhammer", 1)
    await folder(parent.id, "Warhammer 40,000", 4)
    await folder(parent.id, "Age of Sigmar", 2)
    await folder(parent.id, "Painting & Hobby", 6)
    await folder(parent.id, "General Subreddits", 2)
    await folder(parent.id, "Empty")
    await folder(parent.id, "One", 1)
    await folder(parent.id, "Large", 20)
    const separated = await folder(parent.id, "Separated", 2)
    await adapter.createSeparator(separated.id)
    for (let i = 3; i <= 4; i++) {
      await adapter.create({
        parentId: separated.id,
        title: `Separated ${i}`,
        url: `https://example.test/separated/${i}`,
      })
    }
    const mixed = await folder(parent.id, "Mixed", 2)
    const deep = await folder(mixed.id, "Deep", 1)
    await folder(deep.id, "Deeper", 2)
    await folder(parent.id, longTitle, 2)
    const list = await folder(parent.id, "List stays wide", 2)
    layouts[list.id] = "list"
    await store.refresh()
    store.setRootFolderId(root.id)
    usePreferencesStore.setState({
      nestedFolders: true,
      compactNestedFolders: true,
      maxColumns: 2,
      containerMode: "contained",
      cardLayouts: layouts,
      collapsedFolders: {},
      experimentalCardDrag: false,
    })
    return ids
  }, LONG_TITLE)
  await expect(card(page, "Warhammer")).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return ids
}

async function compact(page: Page, enabled: boolean) {
  await page.evaluate(async (compactNestedFolders) => {
    const path = "/src/stores/preferences-store.ts"
    const { usePreferencesStore } = await import(path)
    usePreferencesStore.setState({ compactNestedFolders })
  }, enabled)
}

async function assertBoundaries(page: Page) {
  const violations = await page
    .getByTestId("bookmark-card")
    .evaluateAll((cards) => {
      const errors: string[] = []
      for (const card of cards) {
        const bounds = card.getBoundingClientRect()
        if (!bounds.height) continue
        const title = card.querySelector("h3")?.textContent
        for (const child of card.querySelectorAll(
          "h3, a, button, [data-testid=bookmark-card]"
        )) {
          const rect = child.getBoundingClientRect()
          if (
            rect.width &&
            (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
          )
            errors.push(`${title}: ${child.tagName}`)
          if (
            rect.height &&
            (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
          )
            errors.push(`${title}: vertical ${child.tagName}`)
        }
        if (card.scrollWidth > card.clientWidth + 1)
          errors.push(`${title}: overflow`)
      }
      return errors
    })
  expect(violations).toEqual([])
}

test.describe("compact nested folders", () => {
  test.use({ viewport: { width: 1440, height: 1100 } })

  test("content widths, independent boundaries and local separator row breaks", async ({
    page,
  }) => {
    await seed(page)
    const four = await box(card(page, "Warhammer 40,000"))
    const two = await box(card(page, "Age of Sigmar"))
    expect(two.width).toBeLessThan(four.width)
    expect(Math.abs(two.y - four.y)).toBeLessThan(2)
    expect(two.x).toBeGreaterThanOrEqual(four.x + four.width)
    for (const title of ["Empty", "One"]) {
      const small = await box(card(page, title))
      expect(small.width).toBeLessThan(four.width)
      expect(small.width).toBeGreaterThanOrEqual(150)
    }
    const large = card(page, "Large")
    expect((await box(large)).width).toBeLessThanOrEqual(416)
    expect((await box(large.getByRole("link").last())).y).toBeGreaterThan(
      (await box(large.getByRole("link").first())).y
    )
    const separated = card(page, "Separated")
    const divider = await box(separated.getByTestId("bookmark-separator"))
    const before = await box(
      separated.getByRole("link", { name: "Separated 2", exact: true })
    )
    const after = await box(
      separated.getByRole("link", { name: "Separated 3", exact: true })
    )
    expect(divider.y).toBeGreaterThanOrEqual(before.y + before.height)
    expect(after.y).toBeGreaterThanOrEqual(divider.y + divider.height)
    expect(
      Math.abs(divider.width - ((await box(separated)).width - 32))
    ).toBeLessThan(2)
    // Its row break cannot make the neighbouring card wrap.
    expect(
      Math.abs((await box(large)).y - (await box(separated)).y)
    ).toBeLessThan(2)
    expect((await box(card(page, "List stays wide"))).width).toBeCloseTo(
      (await box(card(page, "Warhammer"))).width - 32,
      0
    )
    await assertBoundaries(page)
  })

  test("resizes without overflow, wraps siblings and retains all nesting levels", async ({
    page,
  }) => {
    await seed(page)
    for (const width of [1000, 700, 390, 1440]) {
      await page.setViewportSize({ width, height: 1100 })
      await assertBoundaries(page)
      const four = await box(card(page, "Warhammer 40,000"))
      const two = await box(card(page, "Age of Sigmar"))
      if (width === 1000)
        expect(two.y).toBeGreaterThanOrEqual(four.y + four.height)
      if (width === 1440)
        await expect
          .poll(async () =>
            Math.abs(
              (await box(card(page, "Warhammer 40,000"))).y -
                (await box(card(page, "Age of Sigmar"))).y
            )
          )
          .toBeLessThan(2)
      await expect(card(page, "Deeper").getByRole("link")).toHaveCount(2)
    }
  })

  test("full-width preference provides before/after views of the same arrangement", async ({
    page,
  }, testInfo) => {
    await seed(page)
    await compact(page, false)
    const full = await box(card(page, "Warhammer 40,000"))
    expect((await box(card(page, "Age of Sigmar"))).width).toBeCloseTo(
      full.width,
      0
    )
    await page.screenshot({
      path: testInfo.outputPath("nested-folders-before.png"),
    })
    await compact(page, true)
    await expect(card(page, "Age of Sigmar")).toHaveAttribute(
      "data-compact",
      "true"
    )
    expect((await box(card(page, "Age of Sigmar"))).width).toBeLessThan(
      full.width
    )
    await page.screenshot({
      path: testInfo.outputPath("nested-folders-after.png"),
    })
    await assertBoundaries(page)
  })

  test("adds, removes, moves and renames without stale card widths", async ({
    page,
  }) => {
    const ids = await seed(page)
    const initial = await box(card(page, "Age of Sigmar"))
    const added = await page.evaluate(async (parentId) => {
      const path = "/src/stores/bookmark-store.ts"
      const { useBookmarkStore } = await import(path)
      const store = useBookmarkStore.getState()
      const added: string[] = []
      for (let i = 3; i <= 4; i++) {
        const node = await store.adapter.bookmarks.create({
          parentId,
          title: `Added ${i}`,
          url: `https://example.test/added/${i}`,
        })
        added.push(node.id)
      }
      await store.refresh()
      return added
    }, ids["Age of Sigmar"])
    await expect(card(page, "Age of Sigmar").getByRole("link")).toHaveCount(4)
    expect((await box(card(page, "Age of Sigmar"))).width).toBeGreaterThan(
      initial.width
    )
    await page.evaluate(async (ids) => {
      const path = "/src/stores/bookmark-store.ts"
      const { useBookmarkStore } = await import(path)
      const store = useBookmarkStore.getState()
      for (const id of ids) await store.adapter.bookmarks.remove(id)
      await store.refresh()
    }, added)
    await expect(card(page, "Age of Sigmar").getByRole("link")).toHaveCount(2)
    expect((await box(card(page, "Age of Sigmar"))).width).toBeCloseTo(
      initial.width,
      0
    )
    await page.evaluate(
      async ({ ids, longTitle }) => {
        const path = "/src/stores/bookmark-store.ts"
        const { useBookmarkStore } = await import(path)
        const store = useBookmarkStore.getState()
        const [source] = await store.adapter.bookmarks.getSubTree(
          ids["Warhammer 40,000"]
        )
        await store.adapter.bookmarks.move(source.children[0].id, {
          parentId: ids["Age of Sigmar"],
          index: 0,
        })
        await store.adapter.bookmarks.update(ids.One, {
          title: longTitle + " renamed",
        })
        await store.refresh()
      },
      { ids, longTitle: LONG_TITLE }
    )
    await expect(card(page, "Age of Sigmar").getByRole("link")).toHaveCount(3)
    await expect(card(page, "Warhammer 40,000").getByRole("link")).toHaveCount(
      3
    )
    expect(
      (await box(card(page, LONG_TITLE + " renamed"))).width
    ).toBeGreaterThan(initial.width)
    await assertBoundaries(page)
  })

  test("keyboard traversal, collapse, reordering and subfolder creation stay usable", async ({
    page,
  }) => {
    await seed(page)
    const four = page.getByRole("heading", {
      name: "Warhammer 40,000",
      exact: true,
    })
    await four.focus()
    await page.keyboard.press("ArrowDown")
    await expect(
      page.getByRole("link", { name: "Warhammer 40,000 1", exact: true })
    ).toBeFocused()
    await page.keyboard.press("Alt+ArrowDown")
    await expect(
      card(page, "Warhammer 40,000").getByRole("link").nth(1)
    ).toHaveAccessibleName("Warhammer 40,000 1")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await expect(
      page.getByRole("heading", { name: "Age of Sigmar", exact: true })
    ).toBeFocused()
    const large = card(page, "Large")
    const expanded = await box(large)
    const heading = page.getByRole("heading", { name: "Large", exact: true })
    await heading.focus()
    await page.keyboard.press("Enter")
    await expect(large.getByRole("link")).toHaveCount(0)
    expect((await box(large)).width).toBeLessThan(expanded.width)
    await expect(heading).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(large.getByRole("link")).toHaveCount(20)
    expect((await box(large)).width).toBeCloseTo(expanded.width, 0)
    const menu = card(page, "Empty")
      .getByRole("button", {
        name: "Folder actions",
        exact: true,
      })
      .first()
    await menu.focus()
    await page.keyboard.press("Enter")
    await page
      .getByRole("menuitem", { name: "New subfolder", exact: true })
      .click()
    await page
      .getByLabel("Title", { exact: true })
      .fill("Created inside compact folder")
    await page.keyboard.press("Enter")
    await expect(
      card(page, "Empty").getByRole("heading", {
        name: "Created inside compact folder",
        exact: true,
      })
    ).toBeVisible()
    await expect(menu).toBeFocused()
    await assertBoundaries(page)
  })

  test("compact grid bookmarks retain icon editing and native link navigation", async ({
    page,
  }) => {
    await seed(page)
    const link = card(page, "Age of Sigmar").getByRole("link").first()
    const title = await link.getAttribute("aria-label")
    const href = (await link.getAttribute("href"))!
    await link.focus()
    await page.keyboard.press("Alt+i")
    const dialog = page.getByRole("dialog", {
      name: "Change icon",
      exact: true,
    })
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 32
      const context = canvas.getContext("2d")!
      context.fillStyle = "#c026d3"
      context.fillRect(0, 0, 32, 32)
      return canvas.toDataURL().split(",")[1]
    })
    await dialog.getByLabel("Choose an image").setInputFiles({
      name: "test.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    })
    await expect(dialog.getByAltText("New icon preview")).toBeVisible()
    await dialog.getByRole("button", { name: "Save icon", exact: true }).click()
    await expect(dialog.getByRole("status")).toHaveText("Custom icon saved.")
    await dialog.getByRole("button", { name: "Done", exact: true }).click()
    await expect(link).toBeFocused()
    await expect(link.locator("img[data-custom-icon=true]")).toBeVisible()
    await link.hover()
    await page
      .getByRole("button", { name: `Change icon for ${title}`, exact: true })
      .click()
    await dialog
      .getByRole("button", { name: "Reset icon", exact: true })
      .click()
    await expect(link.locator("img[data-custom-icon=true]")).toHaveCount(0)
    await dialog.getByRole("button", { name: "Done", exact: true }).click()
    await page.route(href, (route) =>
      route.fulfill({ contentType: "text/html", body: "Bookmark destination" })
    )
    await link.focus()
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(href)
  })

  test("a compact card is the only highlighted destination and accepts a cross-folder drop", async ({
    page,
  }) => {
    await seed(page)
    const source = page
      .getByRole("link", { name: "Age of Sigmar 1", exact: true })
      .locator('xpath=ancestor::*[@draggable="true"][1]')
    await source.dispatchEvent("dragstart", {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    })
    await expect(source).toHaveClass(/opacity-40/)
    for (const title of ["Warhammer", "Warhammer 40,000", "Empty"]) {
      const target = page.getByRole("heading", { name: title, exact: true })
      await target.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        element.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: bounds.x + 5,
            clientY: bounds.y + 5,
          })
        )
      })
      await expect(page.locator('[data-drop-active="true"]')).toHaveCount(1)
      await expect(card(page, title)).toHaveAttribute(
        "data-drop-active",
        "true"
      )
    }
    await page
      .getByRole("heading", { name: "Empty", exact: true })
      .dispatchEvent("drop")
    await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
    await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0)
    await expect(
      card(page, "Empty").getByRole("link", {
        name: "Age of Sigmar 1",
        exact: true,
      })
    ).toBeVisible()
    await expect(card(page, "Age of Sigmar").getByRole("link")).toHaveCount(1)
    await assertBoundaries(page)
  })

  test("Appearance switch is keyboard accessible, persists and leaves layout preferences independent", async ({
    page,
  }) => {
    const ids = await seed(page)
    // Persist the fixture's existing display preferences through their public setters.
    await page.evaluate(async () => {
      const path = "/src/stores/preferences-store.ts"
      const { usePreferencesStore } = await import(path)
      const state = usePreferencesStore.getState()
      state.setNestedFolders(true)
      for (const [id, layout] of Object.entries(state.cardLayouts))
        state.setCardLayout(id, layout)
      state.setMaxColumns(2)
    })
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    await page.getByRole("tab", { name: "Appearance", exact: true }).click()
    const toggle = page.getByRole("switch", {
      name: "Compact nested folders",
      exact: true,
    })
    await expect(toggle).toBeChecked()
    await toggle.focus()
    await page.keyboard.press("Space")
    await expect(toggle).not.toBeChecked()
    await page.keyboard.press("Space")
    await expect(toggle).toBeChecked()
    await page.keyboard.press("Escape")
    await page.reload()
    await expect(card(page, "Age of Sigmar")).toHaveAttribute(
      "data-compact",
      "true"
    )
    await page.evaluate(async (ids) => {
      const path = "/src/stores/preferences-store.ts"
      const { usePreferencesStore } = await import(path)
      usePreferencesStore.getState().setCardLayout(ids["Age of Sigmar"], "list")
    }, ids)
    expect((await box(card(page, "Age of Sigmar"))).width).toBeCloseTo(
      (await box(card(page, "Warhammer"))).width - 32,
      0
    )
    await expect(card(page, "Warhammer 40,000")).toHaveAttribute(
      "data-compact",
      "true"
    )
    for (const containerMode of ["contained", "fluid"] as const) {
      await page.setViewportSize({ width: 1900, height: 1100 })
      await page.evaluate(async (containerMode) => {
        const path = "/src/stores/preferences-store.ts"
        const { usePreferencesStore } = await import(path)
        usePreferencesStore.setState({ containerMode, maxColumns: 2 })
      }, containerMode)
      await assertBoundaries(page)
      const parent = await box(card(page, "Warhammer"))
      expect(
        containerMode === "contained" ? parent.width < 720 : parent.width > 720
      ).toBe(true)
    }
    await page.evaluate(async () => {
      const path = "/src/stores/preferences-store.ts"
      const { usePreferencesStore } = await import(path)
      usePreferencesStore.setState({ nestedFolders: false })
    })
    await expect(page.locator('[data-compact="true"]')).toHaveCount(0)
    await expect(card(page, "Warhammer 40,000")).toBeVisible()
  })

  for (const theme of ["light", "dark"]) {
    test(`long titles and focus rings fit in ${theme} theme with an accent colour`, async ({
      page,
    }, testInfo) => {
      await seed(page)
      await page.evaluate(async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark")
        const path = "/src/stores/preferences-store.ts"
        const { usePreferencesStore } = await import(path)
        usePreferencesStore.getState().setColorTheme("bubblegum")
      }, theme)
      const heading = page.getByRole("heading", {
        name: LONG_TITLE,
        exact: true,
      })
      await heading.focus()
      await page.keyboard.press("ArrowDown")
      const focused = page.locator(":focus")
      await expect(focused).toHaveRole("link")
      expect(
        await focused.evaluate((el) => getComputedStyle(el).boxShadow)
      ).not.toBe("none")
      const title = await heading.evaluate((el) => ({
        scroll: el.scrollWidth,
        width: el.clientWidth,
        whiteSpace: getComputedStyle(el).whiteSpace,
      }))
      expect(title.scroll).toBeLessThanOrEqual(title.width + 1)
      expect(title.whiteSpace).toBe("normal")
      await assertBoundaries(page)
      await page.screenshot({
        path: testInfo.outputPath(`nested-folders-${theme}.png`),
      })
    })
  }

  test("drag auto-scroll still runs and stops on cancellation with compact cards", async ({
    page,
  }) => {
    await seed(page)
    const source = page
      .getByRole("link", { name: "Age of Sigmar 1", exact: true })
      .locator('xpath=ancestor::*[@draggable="true"][1]')
    await source.dispatchEvent("dragstart", {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    })
    await expect(source).toHaveClass(/opacity-40/)
    const viewport = page.locator('[data-slot="scroll-area-viewport"]').first()
    await page.evaluate(() => {
      document.elementFromPoint(450, 1060)!.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: 450,
          clientY: 1060,
        })
      )
    })
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(100)
    await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
    await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0)
    const stopped = await viewport.evaluate((el) => el.scrollTop)
    await page.waitForTimeout(150)
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(stopped)
  })

  test("large trees keep compact widths through viewport virtualization and keyboard mounting", async ({
    page,
  }) => {
    await seed(page)
    await page.evaluate(async () => {
      const storePath = "/src/stores/bookmark-store.ts"
      const prefsPath = "/src/stores/preferences-store.ts"
      const { useBookmarkStore } = await import(storePath)
      const { usePreferencesStore } = await import(prefsPath)
      // A deterministic large tree exercises the real viewport gate, with no
      // hundreds of adapter writes unrelated to this rendering test.
      const folders = Array.from({ length: 140 }, (_, i) => ({
        id: `virtual-${i}`,
        title: `Virtual ${i}`,
        children: Array.from({ length: 4 }, (_, j) => ({
          id: `virtual-${i}-${j}`,
          title: `Virtual bookmark ${i}-${j}`,
          url: `https://example.test/${i}/${j}`,
        })),
      }))
      const parent = {
        id: "virtual-parent",
        title: "Virtual parent",
        children: folders,
      }
      const root = {
        id: "virtual-root",
        title: "Virtual root",
        children: [parent],
      }
      useBookmarkStore.setState({
        tree: [root],
        rootFolder: root,
        rootFolderId: root.id,
      })
      usePreferencesStore.setState({
        cardLayouts: Object.fromEntries(
          folders.map((folder) => [folder.id, "grid"])
        ),
      })
    })
    const first = card(page, "Virtual 0")
    await expect(first).toBeVisible()
    const width = (await box(first)).width
    const viewport = page.locator('[data-slot="scroll-area-viewport"]').first()
    await viewport.evaluate((el) => {
      el.scrollTop = 5000
    })
    const placeholder = page.getByTestId("bookmark-card-placeholder").filter({
      has: page.getByRole("heading", { name: "Virtual 0", exact: true }),
    })
    await expect(placeholder).toBeAttached()
    expect((await box(placeholder)).width).toBeCloseTo(width, 0)
    await page
      .getByRole("heading", { name: "Virtual parent", exact: true })
      .focus()
    await page.keyboard.press("End")
    const last = page.getByRole("link", {
      name: "Virtual bookmark 139-3",
      exact: true,
    })
    await expect(last).toBeFocused()
    await expect(last).toBeInViewport()
    await viewport.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(first).toBeVisible()
    expect((await box(first)).width).toBeCloseTo(width, 0)
    await assertBoundaries(page)
  })
})
