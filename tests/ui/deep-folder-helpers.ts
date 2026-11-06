import { expect, type Locator, type Page } from "@playwright/test"

export function levelHeading(page: Page, level: number) {
  return page.getByRole("heading", { name: `Level ${level}`, exact: true })
}

export function folderMenu(heading: Locator) {
  return heading
    .locator("..")
    .getByRole("button", { name: "Folder actions", exact: true })
}

export async function seedDeepFolders(page: Page, depth: number) {
  await page.goto("/?scenario=firefox-separators")
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  const ids = await page.evaluate(async (depth) => {
    const bookmarkPath = "/src/stores/bookmark-store.ts"
    const preferencesPath = "/src/stores/preferences-store.ts"
    const { useBookmarkStore } = await import(bookmarkPath)
    const { usePreferencesStore } = await import(preferencesPath)
    const store = useBookmarkStore.getState()
    const api = store.adapter.bookmarks
    const root = await api.create({
      parentId: store.tree[0].id,
      title: "Deep noncompact fixture",
    })
    let parentId = root.id
    const levels: string[] = []
    const cardLayouts: Record<string, "grid" | "list"> = {}
    for (let level = 0; level <= depth; level++) {
      const folder = await api.create({ parentId, title: `Level ${level}` })
      parentId = folder.id
      levels.push(folder.id)
      cardLayouts[folder.id] = "grid"
    }
    const bookmark = await api.create({
      parentId,
      title: "Deep bookmark",
      url: "https://example.test/deep",
    })
    const sibling = await api.create({ parentId: root.id, title: "Sibling" })
    const source = await api.create({
      parentId: sibling.id,
      title: "Drag source",
      url: "https://example.test/source",
    })
    cardLayouts[sibling.id] = "grid"
    await store.refresh()
    store.setRootFolderId(root.id)
    usePreferencesStore.setState({
      nestedFolders: true,
      compactNestedFolders: false,
      cardLayouts,
      maxColumns: 6,
      containerMode: "contained",
      collapsedFolders: {},
      experimentalCardDrag: false,
    })
    return {
      root: root.id,
      levels,
      bookmark: bookmark.id,
      sibling: sibling.id,
      source: source.id,
    }
  }, depth)
  await page.evaluate(() => document.fonts.ready)
  await expect(levelHeading(page, depth)).toBeVisible()
  return ids
}

export async function configureDeepLayout(
  page: Page,
  options: {
    width: number
    maxColumns: number
    containerMode?: "contained" | "fluid"
    compact?: boolean
    layout?: "grid" | "list" | "mixed"
    fontSize?: number
    dark?: boolean
  }
) {
  await page.setViewportSize({ width: options.width, height: 900 })
  await page.evaluate(async (options) => {
    const path = "/src/stores/preferences-store.ts"
    const { usePreferencesStore } = await import(path)
    const state = usePreferencesStore.getState()
    const cardLayouts: Record<string, "grid" | "list"> = {}
    Object.keys(state.cardLayouts).forEach((id, index) => {
      cardLayouts[id] =
        options.layout === "mixed"
          ? index % 2 === 0
            ? "grid"
            : "list"
          : (options.layout ?? "grid")
    })
    usePreferencesStore.setState({
      maxColumns: options.maxColumns,
      containerMode: options.containerMode ?? "contained",
      compactNestedFolders: options.compact ?? false,
      cardLayouts,
    })
    document.documentElement.style.fontSize = `${options.fontSize ?? 16}px`
    document.documentElement.classList.toggle("dark", options.dark ?? false)
  }, options)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  )
}

export async function folderGeometry(heading: Locator) {
  await heading.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" })
  )
  return heading.evaluate((title) => {
    const header = title.parentElement!
    const card = header.parentElement!
    const menu = header.querySelector<HTMLButtonElement>(
      '[aria-label="Folder actions"]'
    )!
    const collapse = header.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse folder"], [aria-label="Expand folder"]'
    )!
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect()
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        right: r.right,
        bottom: r.bottom,
      }
    }
    const visible = { left: 0, right: innerWidth, top: 0, bottom: innerHeight }
    const clips = []
    for (
      let ancestor = menu.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor)
      const rect = ancestor.getBoundingClientRect()
      const clipX = /hidden|clip|auto|scroll/.test(style.overflowX)
      const clipY = /hidden|clip|auto|scroll/.test(style.overflowY)
      if (clipX) {
        visible.left = Math.max(visible.left, rect.left + ancestor.clientLeft)
        visible.right = Math.min(
          visible.right,
          rect.left + ancestor.clientLeft + ancestor.clientWidth
        )
      }
      if (clipY) {
        visible.top = Math.max(visible.top, rect.top + ancestor.clientTop)
        visible.bottom = Math.min(
          visible.bottom,
          rect.top + ancestor.clientTop + ancestor.clientHeight
        )
      }
      if (clipX || clipY) {
        clips.push({
          slot: ancestor.dataset.slot ?? ancestor.tagName,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          ...bounds(ancestor),
        })
      }
    }
    const button = bounds(menu)
    const hit = document.elementFromPoint(
      button.x + button.width / 2,
      button.y + button.height / 2
    )
    const viewport = document.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )!
    return {
      card: bounds(card),
      header: bounds(header),
      title: bounds(title),
      collapse: bounds(collapse),
      menu: button,
      visible,
      clips,
      menuFitsVisible:
        button.x >= visible.left - 1 &&
        button.right <= visible.right + 1 &&
        button.y >= visible.top - 1 &&
        button.bottom <= visible.bottom + 1,
      hit: hit === menu || menu.contains(hit),
      overflow: card.scrollWidth - card.clientWidth,
      viewportOverflow: viewport.scrollWidth - viewport.clientWidth,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
}

export function expectUsableFolder(
  geometry: Awaited<ReturnType<typeof folderGeometry>>
) {
  expect(geometry.menuFitsVisible, JSON.stringify(geometry)).toBe(true)
  expect(geometry.hit).toBe(true)
  expect(geometry.title.width).toBeGreaterThan(20)
  expect(geometry.title.right).toBeLessThanOrEqual(geometry.collapse.x + 1)
  expect(geometry.menu.right).toBeLessThanOrEqual(geometry.header.right + 1)
  expect(geometry.menu.x).toBeGreaterThanOrEqual(geometry.card.x - 1)
  expect(geometry.overflow).toBeLessThanOrEqual(1)
  expect(geometry.viewportOverflow).toBeLessThanOrEqual(1)
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1)
}
