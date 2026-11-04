import { expect, test } from "@playwright/test"

for (const depth of [6, 8, 10, 11, 12, 20]) {
  test(`deep compact controls remain reachable at depth ${depth}`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/?scenario=firefox-separators")
    await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
    await page.evaluate(async (depth) => {
      const b = "/src/stores/bookmark-store.ts"
      const p = "/src/stores/preferences-store.ts"
      const { useBookmarkStore } = await import(b)
      const { usePreferencesStore } = await import(p)
      const store = useBookmarkStore.getState()
      const api = store.adapter.bookmarks
      const root = await api.create({
        parentId: store.tree[0].id,
        title: "Deep fixture",
      })
      let parentId = root.id
      const cardLayouts: Record<string, "grid"> = {}
      for (let i = 0; i <= depth; i++) {
        const folder = await api.create({ parentId, title: `Level ${i}` })
        cardLayouts[folder.id] = "grid"
        parentId = folder.id
      }
      await api.create({
        parentId,
        title: "Deep bookmark",
        url: "https://example.test/deep",
      })
      await store.refresh()
      store.setRootFolderId(root.id)
      usePreferencesStore.setState({
        nestedFolders: true,
        compactNestedFolders: true,
        cardLayouts,
        maxColumns: 2,
        containerMode: "contained",
        collapsedFolders: {},
      })
    }, depth)
    const measurements = []
    for (const width of [1440, 700, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (let level = depth; level >= 0; level--) {
        const heading = page.getByRole("heading", {
          name: `Level ${level}`,
          exact: true,
        })
        const card = heading.locator("../..")
        const menu = card
          .locator(":scope > div")
          .first()
          .getByRole("button", { name: "Folder actions", exact: true })
        await heading.evaluate((element) =>
          element.scrollIntoView({ block: "center" })
        )
        await menu.scrollIntoViewIfNeeded()
        const geometry = await menu.evaluate((button) => {
          const card = button.closest('[data-testid="bookmark-card"]')!
          const rect = button.getBoundingClientRect()
          const bounds = card.getBoundingClientRect()
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          )
          const title = card.querySelector("h3")!.getBoundingClientRect()
          return {
            width: bounds.width,
            overflow: card.scrollWidth - card.clientWidth,
            hit: hit === button || button.contains(hit),
            contained: rect.left >= bounds.left && rect.right <= bounds.right,
            titleWidth: title.width,
          }
        })
        measurements.push({ width, level, ...geometry })
        expect(geometry, `viewport ${width}, level ${level}`).toMatchObject({
          hit: true,
          contained: true,
        })
        expect(geometry.overflow).toBeLessThanOrEqual(1)
        expect(geometry.titleWidth).toBeGreaterThan(20)
        await menu.click()
        await expect(
          page.getByRole("menuitem", { name: "New subfolder", exact: true })
        ).toBeVisible()
        await page.keyboard.press("Escape")
        await expect(menu).toBeFocused()
        await expect(page.getByRole("menu")).toHaveCount(0)
      }
      const deepest = page.getByRole("heading", {
        name: `Level ${depth}`,
        exact: true,
      })
      await deepest.focus()
      await page.keyboard.press("Enter")
      await expect(
        page.getByRole("link", { name: "Deep bookmark", exact: true })
      ).toHaveCount(0)
      await page.keyboard.press("Enter")
      await expect(
        page.getByRole("link", { name: "Deep bookmark", exact: true })
      ).toHaveCount(1)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true)
    }
    await info.attach("geometry", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    })
    // Noncompact desktop behavior stays unchanged; narrow/deep noncompact
    // clipping predates this option and is deliberately outside this fix.
    if (depth <= 12) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.evaluate(async () => {
        const p = "/src/stores/preferences-store.ts"
        const { usePreferencesStore } = await import(p)
        usePreferencesStore.setState({ compactNestedFolders: false })
      })
      const card = page
        .getByRole("heading", { name: `Level ${depth}`, exact: true })
        .locator("../..")
      expect((await card.boundingBox())!.width).toBeGreaterThan(300)
      await card
        .getByRole("button", { name: "Folder actions", exact: true })
        .click()
      await expect(
        page.getByRole("menuitem", { name: "New subfolder", exact: true })
      ).toBeVisible()
    }
  })
}
