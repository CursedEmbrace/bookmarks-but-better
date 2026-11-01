import { expect, test, type Page } from "@playwright/test"

const actions = [
  "Import bookmarks",
  "Export bookmarks",
  "Export custom icons",
  "Choose JSON backup to restore",
]
const titles = [...actions.slice(0, 3), "Restore custom icons"]

async function openDataSettings(page: Page) {
  await page.goto("/?scenario=browser-only")
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Data & Migration", exact: true }).click()
  return page.getByRole("dialog", { name: "Settings", exact: true })
}

for (const scheme of ["light", "dark"]) {
  test(`data actions share neutral styling and keyboard order across ${scheme} accents`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    const dialog = await openDataSettings(page)
    const rows = dialog.locator('[data-slot="setting-action-row"]')
    await expect(rows).toHaveCount(4)
    for (let i = 0; i < actions.length; i++) {
      await expect(rows.nth(i)).toContainText(titles[i])
      await expect(
        rows.nth(i).getByRole("button", { name: actions[i], exact: true })
      ).toBeEnabled()
    }
    await expect(dialog.locator('[data-slot="file-picker"]')).toHaveCount(1)
    await expect(
      dialog.getByLabel("Restore custom icons from JSON")
    ).toHaveAttribute("type", "file")

    for (const theme of ["default", "claude", "t3-chat"]) {
      await page.evaluate(
        ({ scheme, theme }) => {
          const root = document.documentElement
          root.classList.toggle("dark", scheme === "dark")
          root.classList.toggle("light", scheme === "light")
          if (theme === "default") root.removeAttribute("data-color-theme")
          else root.setAttribute("data-color-theme", theme)
        },
        { scheme, theme }
      )
      await page.mouse.move(0, 0)
      // The buttons' transitions need to settle before comparing theme colours.
      const controls = actions.map((name) =>
        dialog.getByRole("button", { name, exact: true })
      )
      await controls[0].focus()
      await page.keyboard.press("Tab")
      await page.keyboard.press("Shift+Tab")
      for (const [i, control] of controls.entries()) {
        if (i) await page.keyboard.press("Tab")
        await expect(control).toBeFocused()
        await expect(control).toHaveCSS("cursor", "pointer")
        await expect(control).toHaveCSS("height", "32px")
        await expect(control).toHaveClass(/bg-input\/30/)
        await expect(control).not.toHaveClass(/bg-primary/)
        await expect
          .poll(() =>
            control.evaluate((node) => getComputedStyle(node).boxShadow)
          )
          .toMatch(/0px 0px 0px 3px/)
      }
      const reference = await controls[0].evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          background: style.backgroundColor,
          radius: style.borderRadius,
          padding: style.padding,
        }
      })
      for (const control of controls.slice(1)) {
        await expect(control).toHaveCSS(
          "background-color",
          reference.background
        )
        await expect(control).toHaveCSS("border-radius", reference.radius)
        await expect(control).toHaveCSS("padding", reference.padding)
      }
      await dialog.screenshot({
        path: `test-results/data-migration-${theme}-${scheme}.png`,
        animations: "disabled",
      })
    }
  })
}

test("action rows adapt to panel width and long filenames without overlap or horizontal overflow", async ({
  page,
}) => {
  const dialog = await openDataSettings(page)
  const filename = `${"my-custom-icons-".repeat(12)}backup.json`
  await dialog.getByLabel("Restore custom icons from JSON").setInputFiles({
    name: filename,
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
    dialog.getByText(`Selected: ${filename}`, { exact: true })
  ).toBeVisible()
  await expect(
    dialog.getByText("Ready: 0; skipped: 0; conflicting: 0.", { exact: true })
  ).toBeVisible()

  for (const width of [1280, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const rows = dialog.locator('[data-slot="setting-action-row"]')
    for (let i = 0; i < 4; i++) {
      const row = rows.nth(i)
      await row
        .getByRole("button", { name: actions[i], exact: true })
        .scrollIntoViewIfNeeded()
      const layout = await row.evaluate((node) => {
        const line = node.firstElementChild as HTMLElement
        const text = line.firstElementChild!.getBoundingClientRect()
        const button = line.querySelector("button")!.getBoundingClientRect()
        const bounds = line.getBoundingClientRect()
        const style = getComputedStyle(line)
        return {
          width: node.clientWidth,
          overflow: node.scrollWidth - node.clientWidth,
          direction: style.flexDirection,
          textRight: text.right,
          textBottom: text.bottom,
          buttonLeft: button.left,
          buttonRight: button.right,
          buttonTop: button.top,
          left: bounds.left + parseFloat(style.paddingLeft),
          right: bounds.right - parseFloat(style.paddingRight),
          buttonWidth: button.width,
        }
      })
      expect(layout.overflow, `row ${i} at ${width}px`).toBeLessThanOrEqual(1)
      expect(layout.buttonWidth).toBeLessThanOrEqual(
        layout.right - layout.left + 1
      )
      if (layout.width >= 448) {
        expect(layout.direction).toBe("row")
        expect(layout.textRight).toBeLessThan(layout.buttonLeft)
        expect(Math.abs(layout.buttonRight - layout.right)).toBeLessThanOrEqual(
          1
        )
      } else {
        expect(layout.direction).toBe("column")
        expect(layout.textBottom).toBeLessThan(layout.buttonTop)
        expect(Math.abs(layout.buttonLeft - layout.left)).toBeLessThanOrEqual(1)
      }
    }
    await expect(
      dialog.getByText(`Selected: ${filename}`, { exact: true })
    ).toBeVisible()
    await dialog.screenshot({
      path: `test-results/data-migration-width-${width}.png`,
      animations: "disabled",
    })
  }
})

test("bookmark import and both HTML export scopes retain their handlers", async ({
  page,
}) => {
  const dialog = await openDataSettings(page)
  await page.evaluate(async () => {
    const path = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(path)
    const store = useBookmarkStore.getState()
    const folder = await store.adapter.bookmarks.create({
      parentId: store.tree[0].id,
      title: "HTML action fixture",
    })
    await store.refresh()
    store.setRootFolderId(folder.id)
  })
  const picker = page.waitForEvent("filechooser")
  await dialog
    .getByRole("button", { name: "Import bookmarks", exact: true })
    .click()
  await (
    await picker
  ).setFiles({
    name: "bookmarks.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><A HREF="https://data-migration.test/imported">Data row import</A></DL>'
    ),
  })
  await expect(dialog.getByText(/Found 1 bookmark in 0 folders/)).toBeVisible()
  await dialog.getByRole("button", { name: "Import here", exact: true }).click()
  await expect(
    dialog.getByRole("status").filter({ hasText: /Imported/ })
  ).toContainText("1 bookmark")

  for (const scope of ["Dashboard folder", "Everything"]) {
    await dialog
      .getByRole("button", { name: "Export bookmarks", exact: true })
      .click()
    const download = page.waitForEvent("download")
    await page.getByRole("menuitem", { name: scope, exact: true }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/\.html$/)
    const stream = await file.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(chunk)
    const html = Buffer.concat(chunks).toString()
    expect(html).toContain("NETSCAPE-Bookmark-file-1")
    expect(html).toContain("https://data-migration.test/imported")
  }
})
