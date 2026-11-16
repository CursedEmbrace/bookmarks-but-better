import type { BookmarkAdapter } from "@/browser"
import type { ConflictResolution, ImportPlanNode } from "./import-plan"

export interface ImportResult {
  /** Native separators created, omitted when none were imported. */
  separators?: number
  /** Folders created. Folders merged into an existing one are not counted. */
  folders: number
  /** Folders that landed inside an existing folder of the same name. */
  merged: number
  /** Bookmarks created, including "keep both" duplicates. */
  bookmarks: number
  /** Existing bookmarks retitled in place because the user chose "replace". */
  replaced: number
  /** Conflicting bookmarks the user chose not to import. */
  skipped: number
  /**
   * Nodes that could not be written, including every descendant of a folder
   * whose own creation failed — those descendants have nowhere to go, so they
   * are reported as lost rather than silently forgotten.
   */
  failed: number
  /** The first error message seen, for showing the user *why* it went wrong. */
  firstError: string | null
}

/** Total nodes in a subtree, counting the nodes themselves. */
function countNodes(nodes: ImportPlanNode[]): number {
  let total = 0
  for (const node of nodes) {
    total += 1 + (node.kind === "folder" ? countNodes(node.children) : 0)
  }
  return total
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Caps how many adapter requests are in flight across the *whole* import.
 *
 * Batching per folder is not enough: a file with 100 sibling folders would
 * create all 100 at once and then run 100 subtrees in parallel, each with its
 * own allowance — hundreds of simultaneous requests from a limit that reads
 * like eight. A single shared pool makes the number mean what it says.
 *
 * A slot is held only for the duration of one request, never across the
 * recursion into a folder's children, so nothing can deadlock waiting on work
 * that is itself queued behind it.
 */
function createLimiter(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else {
      active += 1
    }

    try {
      return await task()
    } finally {
      // Hand the slot straight to the next waiter rather than freeing and
      // reacquiring it, so the count cannot drift.
      const next = waiting.shift()
      if (next) next()
      else active -= 1
    }
  }
}

/**
 * Carries out a plan from `planImport` under the user's conflict choices.
 *
 * Every write is isolated: a single rejected node (a URL the back-end refuses,
 * a transient daemon conflict) costs that node and — for a folder — its
 * subtree, never the rest of the import. This function never rejects, so a
 * caller cannot end up with a half-written tree and no message.
 *
 * A conflict with no recorded choice defaults to `"skip"`, so an import that
 * is confirmed without answering leaves what is already there alone.
 */
export async function executeImportPlan(
  bookmarks: BookmarkAdapter,
  nodes: ImportPlanNode[],
  parentId: string,
  resolutions: Record<string, ConflictResolution> = {},
  concurrency = 8
): Promise<ImportResult> {
  const result: ImportResult = {
    folders: 0,
    merged: 0,
    bookmarks: 0,
    replaced: 0,
    skipped: 0,
    failed: 0,
    firstError: null,
  }

  const record = (error: unknown, lost: number) => {
    result.failed += lost
    result.firstError ??= messageOf(error)
  }

  const limit = createLimiter(concurrency)

  /** Resolves the id of a newly created bookmark, or `null` for anything else. */
  async function writeBookmark(
    node: Extract<ImportPlanNode, { kind: "bookmark" }>,
    target: string
  ): Promise<string | null> {
    const choice = node.conflict
      ? (resolutions[node.conflict.key] ?? "skip")
      : "keep-both"

    try {
      if (node.conflict && choice === "skip") {
        result.skipped += 1
        return null
      }

      if (node.conflict && choice === "replace") {
        // The URLs are identical by definition of the conflict, so the only
        // thing left to carry over is the incoming title.
        const existingId = node.conflict.existingId
        await limit(() => bookmarks.update(existingId, { title: node.title }))
        result.replaced += 1
        return null
      }

      const created = await limit(() =>
        bookmarks.create({
          parentId: target,
          title: node.title,
          url: node.url,
        })
      )
      result.bookmarks += 1
      return created.id
    } catch (error) {
      record(error, 1)
      return null
    }
  }

  async function writeSeparator(target: string): Promise<string | null> {
    try {
      if (!bookmarks.createSeparator)
        throw new Error("This source does not support bookmark separators")
      const created = await limit(() => bookmarks.createSeparator!(target))
      result.separators = (result.separators ?? 0) + 1
      return created.id
    } catch (error) {
      record(error, 1)
      return null
    }
  }

  /** The folder its children go into, and whether it was newly created. */
  async function writeFolder(
    node: Extract<ImportPlanNode, { kind: "folder" }>,
    target: string
  ): Promise<{ id: string; created: boolean } | null> {
    if (node.existingId) {
      result.merged += 1
      return { id: node.existingId, created: false }
    }
    try {
      const created = await limit(() =>
        bookmarks.create({ parentId: target, title: node.title })
      )
      result.folders += 1
      return { id: created.id, created: true }
    } catch (error) {
      record(error, 1 + countNodes(node.children))
      return null
    }
  }

  /**
   * Puts this level's new nodes after the folder's existing children, in
   * source order. Existing folders and replaced bookmarks keep their place.
   */
  async function restoreOrder(target: string, createdIds: string[]) {
    if (createdIds.length < 2 || !bookmarks.setChildOrder) return
    try {
      const [folder] = await limit(() => bookmarks.getSubTree(target))
      const created = new Set(createdIds)
      const existing = (folder?.children ?? [])
        .map((child) => child.id)
        .filter((id) => !created.has(id))
      await limit(() =>
        bookmarks.setChildOrder!(target, [...existing, ...createdIds])
      )
    } catch (error) {
      // Every node was written; only their order could not be fixed.
      result.firstError ??= messageOf(error)
    }
  }

  async function write(level: ImportPlanNode[], target: string): Promise<void> {
    const writeNode = (node: ImportPlanNode) =>
      node.kind === "bookmark"
        ? writeBookmark(node, target).then((id) => ({ id, folder: null }))
        : node.kind === "separator"
          ? writeSeparator(target).then((id) => ({ id, folder: null }))
          : writeFolder(node, target).then((folder) => ({
              id: folder?.created ? folder.id : null,
              folder,
            }))

    // create() appends, but adapters need not complete concurrent requests
    // in submission order. A source that can set a whole child order (the
    // daemon, where every request is a network round trip) writes siblings
    // concurrently and fixes their order once afterwards. Browser sources
    // answer locally, so they simply await each sibling in turn.
    let written: Awaited<ReturnType<typeof writeNode>>[]
    if (bookmarks.setChildOrder) {
      written = await Promise.all(level.map(writeNode))
      await restoreOrder(
        target,
        written.flatMap(({ id }) => (id === null ? [] : [id]))
      )
    } else {
      written = []
      for (const node of level) written.push(await writeNode(node))
    }

    // Repeated incoming names may merge into the same existing folder.
    // Combine their children in source order before starting that folder,
    // so two branches cannot concurrently append to the same destination.
    const childrenByTarget = new Map<string, ImportPlanNode[]>()
    level.forEach((node, index) => {
      const folder = written[index].folder
      if (node.kind !== "folder" || !folder) return
      const children = childrenByTarget.get(folder.id) ?? []
      for (const child of node.children) children.push(child)
      childrenByTarget.set(folder.id, children)
    })

    // Distinct destination folders can still progress concurrently, sharing
    // the import-wide request limit. No slot is held while awaiting children.
    await Promise.all(
      [...childrenByTarget].map(([id, children]) => write(children, id))
    )
  }

  await write(nodes, parentId)

  return result
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** A short, human-readable summary of an import, for showing in the UI. */
export function formatImportResult(result: ImportResult): string {
  let summary = `Imported ${plural(result.bookmarks, "bookmark")} and ${plural(
    result.folders,
    "folder"
  )}.`

  const extras: string[] = []
  if (result.separators)
    extras.push(`${plural(result.separators, "separator")} imported`)
  if (result.merged > 0) {
    extras.push(`${plural(result.merged, "folder")} merged`)
  }
  if (result.replaced > 0) {
    extras.push(`${plural(result.replaced, "duplicate")} replaced`)
  }
  if (result.skipped > 0) {
    extras.push(`${plural(result.skipped, "duplicate")} skipped`)
  }
  if (extras.length > 0) {
    summary += ` ${extras.join(", ")}.`
  }

  if (result.failed > 0) {
    summary += ` ${plural(result.failed, "item")} could not be imported`
    summary += result.firstError ? ` (${result.firstError}).` : "."
  }

  return summary
}
