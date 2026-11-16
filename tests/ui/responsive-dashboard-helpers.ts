import { expect, type Page } from "@playwright/test"

export async function seedResponsive(page: Page, counts = [3, 4]) {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/?scenario=firefox-separators")
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  const ids = await page.evaluate(async (counts) => {
    const b = "/src/stores/bookmark-store.ts"
    const p = "/src/stores/preferences-store.ts"
    const { useBookmarkStore } = await import(b)
    const { usePreferencesStore } = await import(p)
    const store = useBookmarkStore.getState()
    const api = store.adapter.bookmarks
    const root = await api.create({
      parentId: store.tree[0].id,
      title: "Responsive fixture",
    })
    const folders: string[] = []
    for (const [index, count] of counts.entries()) {
      const folder = await api.create({
        parentId: root.id,
        title: `Folder ${index + 1}`,
      })
      folders.push(folder.id)
      for (let i = 0; i < count; i++) {
        await api.create({
          parentId: folder.id,
          title: `Link ${index + 1}.${i + 1}`,
          url: `https://example.test/${index}/${i}`,
        })
      }
    }
    await store.refresh()
    store.setRootFolderId(root.id)
    usePreferencesStore.setState({
      nestedFolders: true,
      compactNestedFolders: false,
      containerMode: "contained",
      maxColumns: 6,
      cardLayouts: {},
      collapsedFolders: {},
      experimentalCardDrag: false,
    })
    return { root: root.id, folders }
  }, counts)
  await page.evaluate(() => document.fonts.ready)
  return ids
}

export async function configureResponsive(
  page: Page,
  width: number,
  max = 6,
  mode: "contained" | "fluid" = "contained",
  fontSize = 16
) {
  await page.setViewportSize({ width, height: 1000 })
  await page.evaluate(
    async ({ max, mode, fontSize }) => {
      const p = "/src/stores/preferences-store.ts"
      const { usePreferencesStore } = await import(p)
      const prefs = usePreferencesStore.getState()
      prefs.setMaxColumns(max)
      prefs.setContainerMode(mode)
      document.documentElement.style.fontSize = `${fontSize}px`
    },
    { max, mode, fontSize }
  )
}

export async function dashboardGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect()
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      }
    }
    const grid = document.querySelector<HTMLElement>(
      'main [style*="grid-template-columns"]'
    )!
    const available = document.querySelector("[data-dashboard-available]")!
    const group = document.querySelector("[data-dashboard-group]")!
    const columns = [...grid.children].map((column) => ({
      ...box(column),
      roots: [...column.children].map((wrapper) => {
        const card = wrapper.querySelector('[data-testid="bookmark-card"]')
        return {
          ...box(wrapper),
          title: card?.querySelector("h3")?.textContent,
          real: Boolean(card),
        }
      }),
    }))
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )!
    const rootFont = parseFloat(
      getComputedStyle(document.documentElement).fontSize
    )
    return {
      available: box(available),
      group: box(group),
      header: box(document.querySelector("header")!),
      grid: box(grid),
      columns,
      gap: parseFloat(getComputedStyle(grid).columnGap),
      rootFont,
      left: box(grid).x,
      right: innerWidth - box(grid).right,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      viewportOverflow: viewport.scrollWidth - viewport.clientWidth,
      placeholders: grid.querySelectorAll(
        '[data-testid="bookmark-card-placeholder"]'
      ).length,
    }
  })
}

export async function expectDashboard(page: Page, columns: number) {
  await expect(
    page.locator('main [style*="grid-template-columns"]')
  ).toBeVisible()
  await expect
    .poll(async () => (await dashboardGeometry(page)).columns.length)
    .toBe(columns)
  const g = await dashboardGeometry(page)
  expect(g.columns.every((c) => c.roots.length > 0)).toBe(true)
  expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1)
  expect(Math.abs(g.header.x - g.grid.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(g.header.right - g.grid.right)).toBeLessThanOrEqual(1)
  expect(g.documentOverflow).toBeLessThanOrEqual(1)
  expect(g.viewportOverflow).toBeLessThanOrEqual(1)
  const widths = g.columns.map((c) => c.width)
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
  for (const column of g.columns) {
    expect(column.width).toBeLessThanOrEqual(34 * g.rootFont + 1)
    if (g.available.width >= 17 * g.rootFont)
      expect(column.width).toBeGreaterThanOrEqual(17 * g.rootFont - 1)
    for (const root of column.roots)
      expect(Math.abs(root.width - column.width)).toBeLessThanOrEqual(1)
  }
  return g
}

export async function bookmarkSnapshot(page: Page) {
  return page.evaluate(async () => {
    const b = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(b)
    return JSON.stringify(
      await useBookmarkStore.getState().adapter.bookmarks.getTree()
    )
  })
}
