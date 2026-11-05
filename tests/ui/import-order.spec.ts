import { expect, test, type Page } from "@playwright/test"
import type { BookmarkNode } from "../../src/browser"

function content(nodes: BookmarkNode[]): unknown[] {
  return nodes.map((node) =>
    node.type === "separator"
      ? { type: "separator" }
      : node.url !== undefined
        ? { title: node.title, url: node.url }
        : { title: node.title, children: content(node.children ?? []) }
  )
}

async function prepare(page: Page, populated = false) {
  await page.goto("/?scenario=firefox-separators")
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  return page.evaluate(async (populated) => {
    const path = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(path)
    const store = useBookmarkStore.getState()
    const adapter = store.adapter.bookmarks
    const tree = await adapter.getTree()
    const destination = await adapter.create({
      parentId: tree[0].children[0].id,
      title: "F4 destination",
    })
    if (populated) {
      await adapter.create({
        parentId: destination.id,
        title: "Existing before",
        url: "https://f4.test/before",
      })
      const shared = await adapter.create({
        parentId: destination.id,
        title: "Shared",
      })
      await adapter.create({
        parentId: shared.id,
        title: "Existing duplicate",
        url: "https://f4.test/duplicate",
      })
      await adapter.create({
        parentId: destination.id,
        title: "Existing after",
        url: "https://f4.test/after",
      })
    }
    await store.refresh()
    store.setRootFolderId(destination.id)
    return { id: destination.id, before: await adapter.getTree() }
  }, populated)
}

async function importHtml(page: Page, html: string, replace = false) {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Data & Migration", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true })
  const picker = page.waitForEvent("filechooser")
  await dialog
    .getByRole("button", { name: "Import bookmarks", exact: true })
    .click()
  await (
    await picker
  ).setFiles({
    name: "f4.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>${html}</DL><p>`
    ),
  })
  await dialog.getByRole("button", { name: "Import here", exact: true }).click()
  if (replace)
    await page.getByRole("button", { name: "Replace all", exact: true }).click()
  const status = dialog.getByRole("status").filter({ hasText: /Imported/ })
  await expect(status).toBeVisible()
  await expect(status).not.toContainText("could not be imported")
  return { dialog, status }
}

async function readTree(page: Page): Promise<BookmarkNode[]> {
  return page.evaluate(async () => {
    const path = "/src/stores/bookmark-store.ts"
    const { useBookmarkStore } = await import(path)
    return useBookmarkStore.getState().adapter.bookmarks.getTree()
  })
}

function find(nodes: BookmarkNode[], id: string): BookmarkNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = find(node.children ?? [], id)
    if (found) return found
  }
}

function withoutDestination(nodes: BookmarkNode[], id: string): BookmarkNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({
      ...node,
      ...(node.children
        ? { children: withoutDestination(node.children, id) }
        : {}),
    }))
}

test("F4 file import keeps Folder first before Bookmark second", async ({
  page,
}) => {
  const { id, before } = await prepare(page)
  const { status } = await importHtml(
    page,
    '<DT><H3>Folder first</H3><DL><p></DL><p><DT><A HREF="https://example.test/second">Bookmark second</A>'
  )
  await expect(status).toHaveText("Imported 1 bookmark and 1 folder.")
  const after = await readTree(page)
  expect(content(find(after, id)!.children!)).toEqual([
    { title: "Folder first", children: [] },
    { title: "Bookmark second", url: "https://example.test/second" },
  ])
  expect(withoutDestination(after, id)).toEqual(withoutDestination(before, id))
  await page.reload()
  await expect(page.getByTestId("bookmark-card").first()).toBeVisible()
  expect(await readTree(page)).toEqual(after)
})

test("F4 file import and HTML export retain nested mixed nodes and separators", async ({
  page,
}) => {
  const { id, before } = await prepare(page)
  const { dialog, status } = await importHtml(
    page,
    '<DT><HR><DT><HR><DT><H3>Folder first</H3><DL><p><DT><H3>Nested first</H3><DL><p></DL><p><DT><HR><DT><A HREF="https://f4.test/nested">Nested second</A></DL><p><DT><A HREF="https://f4.test/second">Bookmark second</A><DT><H3>Empty third</H3><DL><p></DL><p><DT><HR>'
  )
  await expect(status).toHaveText(
    "Imported 2 bookmarks and 3 folders. 4 separators imported."
  )
  const expected = [
    { type: "separator" },
    { type: "separator" },
    {
      title: "Folder first",
      children: [
        { title: "Nested first", children: [] },
        { type: "separator" },
        { title: "Nested second", url: "https://f4.test/nested" },
      ],
    },
    { title: "Bookmark second", url: "https://f4.test/second" },
    { title: "Empty third", children: [] },
    { type: "separator" },
  ]
  const after = await readTree(page)
  expect(content(find(after, id)!.children!)).toEqual(expected)
  expect(withoutDestination(after, id)).toEqual(withoutDestination(before, id))
  await dialog
    .getByRole("button", { name: "Export bookmarks", exact: true })
    .click()
  const download = page.waitForEvent("download")
  await page
    .getByRole("menuitem", { name: "Dashboard folder", exact: true })
    .click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(chunk)
  const exported = await page.evaluate(async (html) => {
    const path = "/src/browser/import-export/netscape-parser.ts"
    const { parseNetscapeBookmarks } = await import(path)
    return parseNetscapeBookmarks(html)[0].children
  }, Buffer.concat(chunks).toString())
  expect(content(exported)).toEqual(expected)
})

test("F4 merges in place and appends new mixed siblings without changing unrelated entries", async ({
  page,
}) => {
  const { id, before } = await prepare(page, true)
  const { status } = await importHtml(
    page,
    '<DT><H3>New first</H3><DL><p></DL><p><DT><H3>Shared</H3><DL><p><DT><H3>Child first</H3><DL><p></DL><p><DT><A HREF="https://f4.test/duplicate">Replacement</A><DT><A HREF="https://f4.test/child">Child second</A></DL><p><DT><A HREF="https://f4.test/middle">New middle</A><DT><H3>Shared</H3><DL><p><DT><A HREF="https://f4.test/last">Child last</A></DL><p><DT><H3>New last</H3><DL><p></DL><p>',
    true
  )
  await expect(status).toHaveText(
    "Imported 3 bookmarks and 3 folders. 2 folders merged, 1 duplicate replaced."
  )
  const after = await readTree(page)
  const children = find(after, id)!.children!
  expect(children.slice(0, 3).map((n) => n.id)).toEqual(
    find(before, id)!.children!.map((n) => n.id)
  )
  expect(content(children)).toEqual([
    { title: "Existing before", url: "https://f4.test/before" },
    {
      title: "Shared",
      children: [
        { title: "Replacement", url: "https://f4.test/duplicate" },
        { title: "Child first", children: [] },
        { title: "Child second", url: "https://f4.test/child" },
        { title: "Child last", url: "https://f4.test/last" },
      ],
    },
    { title: "Existing after", url: "https://f4.test/after" },
    { title: "New first", children: [] },
    { title: "New middle", url: "https://f4.test/middle" },
    { title: "New last", children: [] },
  ])
  expect(withoutDestination(after, id)).toEqual(withoutDestination(before, id))
})
