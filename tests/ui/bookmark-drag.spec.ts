import { expect, test, type Locator, type Page } from "@playwright/test"

const VIEWPORT = '[data-slot="scroll-area-viewport"]'

function heading(page: Page, name: string) {
  return page.getByRole("heading", { name, exact: true })
}

function card(page: Page, name: string) {
  return heading(page, name).locator("../..")
}

async function seed(page: Page, long = false) {
  await page.goto("/?scenario=browser-only")
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  // Build a small deterministic tree through the workbench's Active Source.
  await page.evaluate(async (long) => {
    const storePath = "/src/stores/bookmark-store.ts"
    const prefsPath = "/src/stores/preferences-store.ts"
    const { useBookmarkStore } = await import(storePath)
    const { usePreferencesStore } = await import(prefsPath)
    const store = useBookmarkStore.getState()
    const bookmarks = store.adapter.bookmarks
    const folder = (parentId: string, title: string) =>
      bookmarks.create({ parentId, title })
    const link = (parentId: string, title: string) =>
      bookmarks.create({ parentId, title, url: `https://example.com/${title}` })
    const root = await folder(store.tree[0].id, "Drag fixture")
    const source = await folder(root.id, "Source folder")
    await link(source.id, "Drag me")
    const parent = await folder(root.id, "Parent folder")
    await link(parent.id, "Parent bookmark")
    const child = await folder(parent.id, "Child folder")
    await link(child.id, "Child bookmark")
    await folder(parent.id, "Sibling folder")
    if (long) {
      const filler = await folder(root.id, "Long folder")
      for (let i = 0; i < 35; i++) await link(filler.id, `Filler ${i}`)
      await folder(root.id, "Last folder")
    }
    await store.refresh()
    store.setRootFolderId(root.id)
    usePreferencesStore.setState({
      nestedFolders: true,
      maxColumns: 1,
      collapsedFolders: {},
      experimentalCardDrag: false,
    })
  }, long)
  await expect(heading(page, "Source folder")).toBeVisible()
}

/** Synthetic events let us assert hierarchy transitions without the browser's
 * own auto-scroll moving a target between assertions. The adapter is real. */
async function startDrag(page: Page, title = "Drag me") {
  const source = page
    .getByRole("link", { name: title, exact: false })
    .locator('xpath=ancestor::*[@draggable="true"][1]')
  await source.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer(),
        clientX: rect.x + 10,
        clientY: rect.y + 10,
      })
    )
  })
  await expect(source).toHaveClass(/opacity-40/)
}

async function over(target: Locator) {
  await target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 10,
        clientY: rect.y + rect.height / 2,
      })
    )
  })
}

async function expectDestination(page: Page, name: string | null) {
  await expect(page.locator('[data-drop-active="true"]')).toHaveCount(
    name ? 1 : 0
  )
  if (name)
    await expect(card(page, name)).toHaveAttribute("data-drop-active", "true")
}

test.describe("bookmark drag", () => {
  // Native drag capture can interfere with another simultaneous drag on Windows.
  test.describe.configure({ mode: "serial" })
  test.use({ viewport: { width: 900, height: 900 } })

  test("one destination through parent, child and sibling transitions; cancellation clears it", async ({
    page,
  }) => {
    await seed(page)
    await startDrag(page)
    for (const name of [
      "Parent folder",
      "Child folder",
      "Parent folder",
      "Sibling folder",
      "Child folder",
    ]) {
      await over(heading(page, name))
      await expectDestination(page, name)
    }
    await over(page.getByRole("link", { name: "Child bookmark", exact: false }))
    await expectDestination(page, "Child folder")
    await page.evaluate(() => window.dispatchEvent(new DragEvent("dragend")))
    await expectDestination(page, null)
    await expect(
      card(page, "Source folder").getByRole("link", {
        name: "Drag me",
        exact: false,
      })
    ).toHaveCount(1)
  })

  test("same-folder card is a no-op, then dropping in its parent moves only that bookmark", async ({
    page,
  }) => {
    await seed(page)
    await startDrag(page, "Child bookmark")
    await over(heading(page, "Child folder"))
    await expectDestination(page, null)
    await over(heading(page, "Parent folder"))
    await expectDestination(page, "Parent folder")
    await heading(page, "Parent folder").dispatchEvent("drop", {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    })
    await expectDestination(page, null)
    await expect(card(page, "Child folder").getByRole("link")).toHaveCount(0)
    await expect(
      card(page, "Parent folder").getByRole("link", {
        name: "Child bookmark",
        exact: false,
      })
    ).toHaveCount(1)
    await expect(
      card(page, "Source folder").getByRole("link", {
        name: "Drag me",
        exact: false,
      })
    ).toHaveCount(1)
  })

  test("native dragging scrolls down and up, stops in the centre and on Escape", async ({
    page,
  }) => {
    await seed(page, true)
    const source = page.getByRole("link", { name: "Drag me", exact: false })
    const box = (await source.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 50, box.y + box.height / 2 + 10, {
      steps: 5,
    })
    await expect(
      source.locator('xpath=ancestor::*[@draggable="true"][1]')
    ).toHaveClass(/opacity-40/)
    const viewport = page.locator(VIEWPORT).first()
    // Inside our 64px band, outside the browser's native edge scrolling.
    // This exercises the new controller rather than native autoscroll.
    await page.mouse.move(450, 860, { steps: 5 })
    // A second move ensures dragover follows dragenter in every browser.
    await page.mouse.move(450, 860)
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(250)
    await page.mouse.move(450, 450)
    const stopped = await viewport.evaluate((el) => el.scrollTop)
    // Wait for several potential animation frames to catch lingering loops.
    await page.waitForTimeout(150)
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(stopped)
    await page.mouse.move(450, 40, { steps: 5 })
    await page.mouse.move(450, 40)
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollTop))
      .toBeLessThan(stopped - 80)
    await page.keyboard.press("Escape")
    await page.mouse.up()
    await expect(
      source.locator('xpath=ancestor::*[@draggable="true"][1]')
    ).not.toHaveClass(/opacity-40/)
    const ended = await viewport.evaluate((el) => el.scrollTop)
    await page.waitForTimeout(150)
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(ended)
    await expectDestination(page, null)
  })

  test("stationary scrolling refreshes the destination and stops after a drop", async ({
    page,
  }) => {
    await seed(page, true)
    await startDrag(page)
    const viewport = page.locator(VIEWPORT).first()
    await page.evaluate(() => {
      document.elementFromPoint(450, 860)!.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: 450,
          clientY: 860,
        })
      )
    })
    await expect
      .poll(
        () =>
          viewport.evaluate(
            (el) => el.scrollHeight - el.clientHeight - el.scrollTop
          ),
        { timeout: 20_000 }
      )
      .toBeLessThan(1)
    const last = heading(page, "Last folder")
    await expectDestination(page, "Last folder")
    await last.dispatchEvent("drop", {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    })
    await expectDestination(page, null)
    await expect(
      card(page, "Last folder").getByRole("link", {
        name: "Drag me",
        exact: false,
      })
    ).toHaveCount(1)
    const ended = await viewport.evaluate((el) => el.scrollTop)
    await page.waitForTimeout(150)
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(ended)
  })
})
