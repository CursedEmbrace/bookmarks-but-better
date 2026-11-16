import { expect, test } from "@playwright/test"
import {
  bookmarkSnapshot,
  configureResponsive,
  dashboardGeometry,
  expectDashboard,
  seedResponsive,
} from "./responsive-dashboard-helpers"
import {
  configureDeepLayout,
  expectUsableFolder,
  folderGeometry,
  folderMenu,
  levelHeading,
  seedDeepFolders,
} from "./deep-folder-helpers"

test("two sparse folders share centred capped tracks and aligned header bounds", async ({
  page,
}) => {
  await seedResponsive(page)
  for (const mode of ["contained", "fluid"] as const) {
    for (const max of [4, 6]) {
      await configureResponsive(page, 1920, max, mode)
      const g = await expectDashboard(page, 2)
      expect(g.grid.width).toBeCloseTo(1104, 0)
      expect(g.columns[0].width).toBeCloseTo(544, 0)
      expect(g.left).toBeCloseTo(408, 0)
    }
  }
})

test("columns fit usable width in both modes and preserve Max columns as a ceiling", async ({
  page,
}, info) => {
  test.setTimeout(90_000)
  await seedResponsive(page, [3, 9, 1, 12, 5, 0, 8, 4])
  const rows = []
  for (const mode of ["contained", "fluid"] as const) {
    for (const max of [4, 6]) {
      for (const [width, fitContained, fitFluid] of [
        [1920, 5, 6],
        [1600, 5, 5],
        [1440, 4, 4],
        [1280, 4, 4],
        [1024, 3, 3],
        [768, 2, 2],
        [390, 1, 1],
      ]) {
        await configureResponsive(page, width, max, mode)
        const g = await expectDashboard(
          page,
          Math.min(max, mode === "contained" ? fitContained : fitFluid)
        )
        rows.push({ width, max, mode, ...g })
        expect(g.available.width).toBeCloseTo(
          Math.min(width - 32, mode === "contained" ? 1440 : Infinity),
          0
        )
      }
    }
  }
  await info.attach("responsive-matrix", {
    body: JSON.stringify(rows),
    contentType: "application/json",
  })
})

test("calculated thresholds are stable and ignore irrelevant viewport breakpoints", async ({
  page,
}) => {
  await seedResponsive(page, [3, 5, 2, 7, 0, 4])
  for (const [columns, threshold] of [
    [2, 592],
    [3, 880],
    [4, 1168],
    [5, 1456],
    [6, 1744],
  ]) {
    for (const delta of [-1, 0, 1, -1, 1]) {
      await configureResponsive(page, threshold + delta, 6, "fluid")
      await expectDashboard(page, delta < 0 ? columns - 1 : columns)
    }
  }
  for (const width of [1535, 1536, 1600, 1920]) {
    await configureResponsive(page, width)
    const g = await expectDashboard(page, 5)
    expect(g.available.width).toBeCloseTo(1440, 0)
  }
})

test("measurement follows independently constrained content and narrow fallback", async ({
  page,
}) => {
  await seedResponsive(page, [3, 4, 2, 7, 0, 5])
  await configureResponsive(page, 1920)
  for (const [width, columns] of [
    [720, 2],
    [550, 1],
    [230, 1],
    [900, 3],
  ]) {
    await page.locator("[data-dashboard-available]").evaluate((el, width) => {
      ;(el as HTMLElement).style.width = `${width}px`
    }, width)
    const g = await expectDashboard(page, columns)
    expect(g.available.width).toBeCloseTo(width, 0)
    if (width < 272) expect(g.columns[0].width).toBeCloseTo(width, 0)
  }
  await page.locator("[data-dashboard-available]").evaluate((el) => {
    ;(el as HTMLElement).style.width = ""
  })
  await expectDashboard(page, 5)
})

test("live preferences and folder creation/deletion update occupied tracks without reload", async ({
  page,
}) => {
  const ids = await seedResponsive(page, [3])
  await configureResponsive(page, 1920)
  await expectDashboard(page, 1)
  const added = await page.evaluate(async (root) => {
    const b = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(b)
    return (await useBookmarkStore.getState().createFolder(root, "Added root"))!
      .id
  }, ids.root)
  await expect(
    page.getByRole("heading", { name: "Added root", exact: true })
  ).toBeVisible()
  await expectDashboard(page, 2)
  await page.evaluate(async (id) => {
    const b = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(b)
    await useBookmarkStore.getState().deleteFolder(id)
  }, added)
  await expectDashboard(page, 1)
  await page.evaluate(async (root) => {
    const b = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(b)
    for (let i = 0; i < 5; i++)
      await useBookmarkStore.getState().createFolder(root, `Extra ${i}`)
  }, ids.root)
  for (const max of [6, 2, 3, 4, 6]) {
    await configureResponsive(page, 1920, max, "fluid")
    await expectDashboard(page, max)
  }
  await page.reload()
  await expectDashboard(page, 6)
})

for (const compact of [false, true]) {
  test(`768px at 200% text preserves headings, focus and depth-20 controls (compact ${compact})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await seedDeepFolders(page, 20)
    await configureDeepLayout(page, {
      width: 768,
      maxColumns: 6,
      fontSize: 32,
      compact,
    })
    await expectDashboard(page, 1)
    const heading = levelHeading(page, 20)
    const g = await folderGeometry(heading)
    expectUsableFolder(g)
    // A compact card hugs a short title, so the title box may be exactly as
    // wide as its text: require the full text width (or 100px), not a fixed box.
    const textWidth = await heading.evaluate((el) => {
      const probe = el.cloneNode(true) as HTMLElement
      probe.style.cssText =
        "position:absolute;visibility:hidden;white-space:nowrap;width:auto"
      el.parentElement!.append(probe)
      const width = probe.getBoundingClientRect().width
      probe.remove()
      return width
    })
    expect(g.title.width).toBeGreaterThanOrEqual(Math.min(100, textWidth - 1))
    await page.mouse.click(
      g.menu.x + g.menu.width / 2,
      g.menu.y + g.menu.height / 2
    )
    await expect(
      page.getByRole("menuitem", { name: "New subfolder", exact: true })
    ).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(folderMenu(heading)).toBeFocused()
    await expect(page.getByRole("menu")).toHaveCount(0)
    await heading.focus()
    await page.keyboard.press("Enter")
    await expect(
      page.getByRole("link", { name: "Deep bookmark", exact: true })
    ).toHaveCount(0)
    await page.keyboard.press("Enter")
    await expect(
      page.getByRole("link", { name: "Deep bookmark", exact: true })
    ).toHaveCount(1)
    // Enter toggles without changing Firefox's pointer/keyboard modality.
    // Use actual Tab navigation before checking its focus-visible indicator.
    await page.keyboard.press("Tab")
    await page.keyboard.press("Shift+Tab")
    await expect(heading).toBeFocused()
    const focus = await heading.evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow,
      focused: document.activeElement === el,
    }))
    expect(focus.focused).toBe(true)
    expect(focus.shadow).not.toBe("none")
    await info.attach("large-text-geometry", {
      body: JSON.stringify(g),
      contentType: "application/json",
    })
  })
}

test("masonry keeps whole uneven cards and focus through collapse and resize", async ({
  page,
}) => {
  await seedResponsive(page, [3, 12, 1, 8, 6, 0])
  await configureResponsive(page, 1440, 4)
  const before = await bookmarkSnapshot(page)
  const initial = await expectDashboard(page, 4)
  const assignments = initial.columns.map((c) => c.roots.map((r) => r.title))
  const heading = page.getByRole("heading", { name: "Folder 2", exact: true })
  await heading.focus()
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("link", { name: "Link 2.1", exact: true })
  ).toHaveCount(0)
  expect(
    (await dashboardGeometry(page)).columns.map((c) =>
      c.roots.map((r) => r.title)
    )
  ).toEqual(assignments)
  await page.keyboard.press("Enter")
  await expect(
    page.getByRole("link", { name: "Link 2.1", exact: true })
  ).toBeVisible()
  for (const [width, count] of [
    [1024, 3],
    [768, 2],
    [390, 1],
    [1440, 4],
    [1024, 3],
  ]) {
    await configureResponsive(page, width, 4)
    await expectDashboard(page, count)
    await expect(heading).toBeFocused()
  }
  expect(await bookmarkSnapshot(page)).toBe(before)
})

test("drag destination and cancellation survive a responsive count change", async ({
  page,
}) => {
  await seedResponsive(page, [3, 4, 1, 2])
  await configureResponsive(page, 1024, 4)
  const before = await bookmarkSnapshot(page)
  const source = page
    .getByRole("link", { name: "Link 1.1", exact: true })
    .locator('xpath=ancestor::*[@draggable="true"][1]')
  await source.evaluate((el) =>
    el.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
      })
    )
  )
  await configureResponsive(page, 768, 4)
  await expectDashboard(page, 2)
  const target = page.getByRole("heading", { name: "Folder 2", exact: true })
  await target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: r.x + 10,
        clientY: r.y + r.height / 2,
      })
    )
  })
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(1)
  await expect(target.locator("../..")).toHaveAttribute(
    "data-drop-active",
    "true"
  )
  await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(0)
  expect(await bookmarkSnapshot(page)).toBe(before)
})
