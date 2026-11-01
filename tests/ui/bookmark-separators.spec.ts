import { expect, test, type Page, type Locator } from "@playwright/test"

function card(page: Page, name = "Separator demo") {
  return page.getByRole("heading", { name, exact: true }).locator("../..")
}

async function setup(page: Page) {
  await page.goto("/?scenario=firefox-separators")
  await expect(card(page)).toBeVisible()
  await page.evaluate(async () => {
    const path = "/src/stores/preferences-store.ts"
    const { usePreferencesStore } = await import(path)
    usePreferencesStore.setState({
      nestedFolders: true,
      maxColumns: 1,
      collapsedFolders: {},
    })
  })
}

async function order(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(path)
    const tree = useBookmarkStore.getState().tree
    const folder = tree[0].children[0].children.find(
      (n: { title: string }) => n.title === "Separator demo"
    )
    return folder.children.map((n: { type?: string; title: string }) =>
      n.type === "separator" ? "separator" : n.title
    )
  })
}

async function dragOnto(
  source: Locator,
  target: Locator,
  edge: "top" | "bottom"
) {
  await source.dispatchEvent("dragstart", {
    dataTransfer: await source.page().evaluateHandle(() => new DataTransfer()),
  })
  await expect(source).toHaveClass(/opacity-40/)
  await target.evaluate((element, edge) => {
    const rect = element.getBoundingClientRect()
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: edge === "top" ? rect.y + 1 : rect.bottom - 1,
    }
    element.dispatchEvent(new DragEvent("dragover", init))
  }, edge)
  // The monitor processes dragover on the next animation frame.
  await expect(target.locator(":scope > .pointer-events-none")).toBeVisible()
  await target.dispatchEvent("drop")
  await source
    .page()
    .evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
}

test.describe("native separator dashboard", () => {
  test.describe.configure({ mode: "serial" })
  test.use({ viewport: { width: 900, height: 900 } })

  test("folder creation, nested creation and bookmark insertion persist after reload", async ({
    page,
  }) => {
    await setup(page)
    await card(page)
      .getByRole("button", { name: "Folder actions", exact: true })
      .first()
      .click()
    await page
      .getByRole("menuitem", { name: "Add separator", exact: true })
      .click()
    await expect
      .poll(() => order(page))
      .toEqual(["First", "separator", "Second", "Nested", "separator"])
    await expect(
      page.getByRole("menuitem", { name: "Add separator", exact: true })
    ).toHaveCount(0)
    await card(page, "Nested")
      .getByRole("button", { name: "Folder actions" })
      .click()
    await page
      .getByRole("menuitem", { name: "Add separator", exact: true })
      .click()
    await expect(
      card(page, "Nested").getByTestId("bookmark-separator")
    ).toHaveCount(2)
    await page.getByRole("link", { name: /^First/ }).hover()
    await page.getByRole("button", { name: "Insert separator below" }).click()
    await expect
      .poll(() => order(page))
      .toEqual([
        "First",
        "separator",
        "separator",
        "Second",
        "Nested",
        "separator",
      ])
    await page.reload()
    await expect(card(page)).toBeVisible()
    await expect
      .poll(() => order(page))
      .toEqual([
        "First",
        "separator",
        "separator",
        "Second",
        "Nested",
        "separator",
      ])
    await expect(
      card(page, "Nested").getByTestId("bookmark-separator")
    ).toHaveCount(2)
  })

  test("grid divider spans its folder and starts a new row; list and nested dividers stay compact", async ({
    page,
  }) => {
    await setup(page)
    await card(page)
      .getByRole("button", { name: "Folder actions" })
      .first()
      .click()
    await page.getByRole("menuitem", { name: "Grid view", exact: true }).click()
    const first = page.getByRole("link", { name: /^First/ })
    const second = page.getByRole("link", { name: /^Second/ })
    const divider = card(page).getByTestId("bookmark-separator").first()
    const a = (await first.boundingBox())!
    const b = (await second.boundingBox())!
    const s = (await divider.boundingBox())!
    const width = await divider.evaluate(
      (el) => el.parentElement!.getBoundingClientRect().width
    )
    expect(Math.abs(s.width - width)).toBeLessThan(2)
    expect(s.y).toBeGreaterThanOrEqual(a.y + a.height)
    expect(b.y).toBeGreaterThanOrEqual(s.y + s.height)
    expect(s.height).toBeLessThanOrEqual(24)
    const nested = (await card(page, "Nested")
      .getByTestId("bookmark-separator")
      .boundingBox())!
    expect(nested.width).toBeLessThan(s.width)
    await page.screenshot({ path: "test-results/separators-grid.png" })
    await card(page)
      .getByRole("button", { name: "Folder actions" })
      .first()
      .click()
    await page.getByRole("menuitem", { name: "List view", exact: true }).click()
    expect((await divider.boundingBox())!.height).toBeLessThanOrEqual(24)
  })

  test("keyboard navigation, reordering, Organizer leaf actions and deletion", async ({
    page,
  }) => {
    await setup(page)
    await page.getByRole("link", { name: /^First/ }).focus()
    await page.keyboard.press("ArrowDown")
    const separator = card(page)
      .getByRole("button", { name: "Separator actions" })
      .first()
    await expect(separator).toBeFocused()
    await page.keyboard.press("Alt+ArrowDown")
    await expect(separator).toHaveAttribute("aria-expanded", "false")
    await expect
      .poll(() => order(page))
      .toEqual(["First", "Second", "separator", "Nested"])
    await separator.focus()
    await page.keyboard.press("Enter")
    await page.getByRole("menuitem", { name: "Organize separator" }).click()
    const row = page
      .getByRole("treeitem", { name: "Separator", exact: true })
      .first()
    await expect(row).toBeVisible()
    await expect(row.getByRole("button", { name: "Rename item" })).toHaveCount(
      0
    )
    await expect(
      row.getByRole("button", { name: "Expand folder" })
    ).toHaveCount(0)
    await row.getByRole("button", { name: "Delete item", exact: true }).click()
    await expect(
      page.getByRole("heading", { name: "Delete Separator" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Delete", exact: true }).click()
    await expect.poll(() => order(page)).toEqual(["First", "Second", "Nested"])
    await expect(
      page.getByRole("treeitem", { name: "Separator", exact: true })
    ).toHaveCount(0)
  })

  test("Organizer creates separators and keeps keyboard drag available on leaf rows", async ({
    page,
  }) => {
    await setup(page)
    await card(page)
      .getByRole("button", { name: "Separator actions" })
      .first()
      .click()
    await page.getByRole("menuitem", { name: "Organize separator" }).click()
    const tree = page.getByRole("tree", { name: "Bookmark Organizer" })
    const first = tree.getByRole("treeitem", { name: "First", exact: true })
    await first.getByRole("button", { name: "Insert separator below" }).click()
    await expect
      .poll(() => order(page))
      .toEqual(["First", "separator", "separator", "Second", "Nested"])
    await expect(
      tree.getByRole("treeitem", { name: "Separator", exact: true })
    ).toHaveCount(2)
    const folder = tree.getByRole("treeitem", {
      name: "Separator demo",
      exact: true,
    })
    await folder.getByRole("button", { name: "Add item", exact: true }).click()
    await page
      .getByRole("menuitem", { name: "Add separator", exact: true })
      .click()
    await expect
      .poll(() => order(page))
      .toEqual([
        "First",
        "separator",
        "separator",
        "Second",
        "Nested",
        "separator",
      ])
    await expect(
      tree.getByRole("treeitem", { name: "Separator", exact: true })
    ).toHaveCount(3)
    const separator = tree
      .getByRole("treeitem", { name: "Separator", exact: true })
      .first()
    await separator.click()
    await page.keyboard.press("Control+Shift+d")
    await expect(page.locator('[aria-live="assertive"]')).toContainText(
      "Dragging Separator"
    )
    await page.keyboard.press("Escape")
  })

  test("pointer drops put bookmarks on either side of separators and move separators", async ({
    page,
  }) => {
    await setup(page)
    const draggable = (link: Locator) =>
      link.locator('xpath=ancestor::*[@draggable="true"][1]')
    const divider = () => card(page).getByTestId("bookmark-separator").first()
    await dragOnto(
      draggable(page.getByRole("link", { name: /^First/ })),
      divider(),
      "bottom"
    )
    await expect
      .poll(() => order(page))
      .toEqual(["separator", "First", "Second", "Nested"])
    await dragOnto(
      draggable(page.getByRole("link", { name: /^Second/ })),
      divider(),
      "top"
    )
    await expect
      .poll(() => order(page))
      .toEqual(["Second", "separator", "First", "Nested"])
    await dragOnto(
      divider(),
      draggable(page.getByRole("link", { name: /^First/ })),
      "bottom"
    )
    await expect
      .poll(() => order(page))
      .toEqual(["Second", "First", "separator", "Nested"])
  })

  for (const initiallyOpen of [false, true]) {
    for (const outcome of ["drop", "cancel"] as const) {
      test(`native separator drag with menu ${initiallyOpen ? "open" : "closed"}: ${outcome} leaves actions closed`, async ({
        page,
      }) => {
        await setup(page)
        const separator = card(page).getByTestId("bookmark-separator").first()
        const trigger = separator.getByRole("button", {
          name: "Separator actions",
        })
        const menu = page.getByRole("menuitem", { name: "Organize separator" })
        if (initiallyOpen) {
          await trigger.click()
          await expect(menu).toBeVisible()
        }
        const box = (await trigger.boundingBox())!
        await page.mouse.move(box.x + 30, box.y + box.height / 2)
        await page.mouse.down()
        // Allow the menu's deferred mousedown handler to run before moving.
        await page.evaluate(() => new Promise(requestAnimationFrame))
        await expect(trigger).toHaveAttribute(
          "aria-expanded",
          String(initiallyOpen)
        )
        await page.mouse.move(box.x + 50, box.y - 10, { steps: 5 })
        await expect(separator).toHaveClass(/opacity-40/)
        await expect(trigger).toHaveAttribute("aria-expanded", "false")
        await expect(menu).toBeHidden()

        const target = page
          .getByRole("link", { name: /^Second/ })
          .locator('xpath=ancestor::*[@draggable="true"][1]')
        const targetBox = (await target.boundingBox())!
        await page.mouse.move(
          targetBox.x + 30,
          targetBox.y + targetBox.height - 2,
          { steps: 5 }
        )
        await page.mouse.move(
          targetBox.x + 30,
          targetBox.y + targetBox.height - 2
        )
        await expect(
          target.locator(":scope > .pointer-events-none")
        ).toBeVisible()
        await expect(menu).toBeHidden()
        if (outcome === "cancel") await page.keyboard.press("Escape")
        await page.mouse.up()
        await expect(separator).not.toHaveClass(/opacity-40/)
        await expect(
          target.locator(":scope > .pointer-events-none")
        ).toHaveCount(0)
        await expect
          .poll(() => order(page))
          .toEqual(
            outcome === "drop"
              ? ["First", "Second", "separator", "Nested"]
              : ["First", "separator", "Second", "Nested"]
          )
        // Guard even browsers that deliver a click after dragend/cancellation.
        await trigger.dispatchEvent("click", { detail: 1 })
        await expect(trigger).toHaveAttribute("aria-expanded", "false")
        await expect(menu).toBeHidden()

        // Leave the neighbouring bookmark's hover actions before checking
        // keyboard focus independently of that popup's dismissal.
        await page.mouse.move(5, 5)
        await trigger.focus()
        await page.keyboard.press("Space")
        await expect(menu).toBeVisible()
        await expect(menu).toBeFocused()
        await page.keyboard.press("Escape")
        await expect(trigger).toBeFocused()
        await page.keyboard.press("Enter")
        await expect(menu).toBeVisible()
        await expect(menu).toBeFocused()
        await page.keyboard.press("Escape")
        await trigger.click()
        await expect(menu).toBeVisible()
      })
    }
  }
})
