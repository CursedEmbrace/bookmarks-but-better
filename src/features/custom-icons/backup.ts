import type { BookmarkNode } from "@/browser"
import type { IconRecord } from "./storage"
import { canEditCustomIcon } from "./eligibility"

export const MAX_BACKUP_BYTES = 48 * 1024 * 1024
export interface BookmarkIdentity {
  id: string
  url: string
  title: string
  folderPath: string[]
}
export interface IconAssignment extends BookmarkIdentity {
  image: string
}
export interface IconBackup {
  format: "bookmarks-but-better-custom-icons"
  version: 1
  identity: string
  source: string
  assignments: IconAssignment[]
}

export function bookmarkIdentities(tree: BookmarkNode[]): BookmarkIdentity[] {
  return bookmarkEntries(tree).map((entry) => entry.identity)
}

function bookmarkEntries(tree: BookmarkNode[]) {
  const result: { identity: BookmarkIdentity; node: BookmarkNode }[] = []
  function visit(nodes: BookmarkNode[], folderPath: string[]) {
    for (const node of nodes) {
      if (node.type === "separator") continue
      if (node.url !== undefined)
        result.push({
          node,
          identity: {
            id: node.id,
            url: node.url,
            title: node.title,
            folderPath,
          },
        })
      else if (node.children)
        visit(
          node.children,
          node.parentId === undefined ? folderPath : [...folderPath, node.title]
        )
    }
  }
  visit(tree, [])
  return result
}

export function createIconBackup(
  source: string,
  identity: string,
  tree: BookmarkNode[],
  records: IconRecord[]
): IconBackup {
  const nodes = new Map(bookmarkIdentities(tree).map((node) => [node.id, node]))
  return {
    format: "bookmarks-but-better-custom-icons",
    version: 1,
    source,
    identity,
    assignments: records.flatMap((record) => {
      const node = nodes.get(record.id)
      return node ? [{ ...node, image: record.image }] : []
    }),
  }
}

function checkBackupSize(text: string): void {
  // The file picker checks bytes too. Count UTF-8 here so exports and direct
  // parser callers enforce the same limit for non-ASCII bookmark metadata.
  if (
    text.length > MAX_BACKUP_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES
  )
    throw new Error(
      "Custom icon backups cannot exceed 48 MB. No icons were changed."
    )
}

export function serializeIconBackup(backup: IconBackup): string {
  validateIconBackup(backup)
  const text = JSON.stringify(backup, null, 2)
  checkBackupSize(text)
  return text
}

export function parseIconBackup(text: string): IconBackup {
  checkBackupSize(text)
  let value: IconBackup
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("This file is not valid JSON.")
  }
  validateIconBackup(value)
  return value
}

function validateIconBackup(value: IconBackup): void {
  if (
    !value ||
    value.format !== "bookmarks-but-better-custom-icons" ||
    value.version !== 1 ||
    typeof value.identity !== "string" ||
    typeof value.source !== "string" ||
    !Array.isArray(value.assignments)
  )
    throw new Error("This is not a supported custom icon backup.")
  for (const item of value.assignments) {
    if (
      !item ||
      typeof item.id !== "string" ||
      typeof item.url !== "string" ||
      typeof item.title !== "string" ||
      !Array.isArray(item.folderPath) ||
      !item.folderPath.every((part) => typeof part === "string") ||
      typeof item.image !== "string"
    )
      throw new Error("This backup contains an invalid assignment.")
    if (item.folderPath.length > 256)
      throw new Error(
        "Custom icon backups support folder paths up to 256 levels deep."
      )
  }
}

export interface RestoreIssue {
  title: string
  reason: string
}
export interface RestorePlan {
  assignments: { id: string; image: string; title: string }[]
  skipped: RestoreIssue[]
  conflicts: RestoreIssue[]
}

/** IDs are trusted only in this database/source. Otherwise require exact, unique metadata. */
export function planIconRestore(
  backup: IconBackup,
  source: string,
  identity: string,
  tree: BookmarkNode[]
): RestorePlan {
  const nodes = bookmarkEntries(tree).map(({ identity, node }) => ({
    ...identity,
    editable: canEditCustomIcon(node),
  }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const urls = new Set(nodes.map((node) => node.url))
  const metadataKey = (node: BookmarkIdentity) =>
    JSON.stringify([node.url, node.title, node.folderPath])
  const byMetadata = new Map<string, typeof nodes>()
  for (const node of nodes) {
    const key = metadataKey(node)
    const matches = byMetadata.get(key) ?? []
    matches.push(node)
    byMetadata.set(key, matches)
  }
  const plan: RestorePlan = { assignments: [], skipped: [], conflicts: [] }
  const proposed = new Map<
    string,
    { id: string; image: string; title: string }[]
  >()
  for (const item of backup.assignments) {
    const direct =
      backup.identity === identity && backup.source === source
        ? byId.get(item.id)
        : undefined
    const exact =
      direct?.url === item.url
        ? [direct]
        : (byMetadata.get(metadataKey(item)) ?? [])
    if (exact.length === 1) {
      if (!exact[0].editable) {
        plan.skipped.push({
          title: item.title,
          reason: "Bookmark is read-only; its existing icon was not changed.",
        })
        continue
      }
      const id = exact[0].id
      const matches = proposed.get(id) ?? []
      matches.push({ id, image: item.image, title: item.title })
      proposed.set(id, matches)
    } else if (urls.has(item.url)) {
      plan.conflicts.push({
        title: item.title,
        reason:
          exact.length > 1
            ? "Multiple bookmarks have identical metadata."
            : "URL exists, but title or folder path differs.",
      })
    } else {
      plan.skipped.push({ title: item.title, reason: "Bookmark not found." })
    }
  }
  for (const matches of proposed.values()) {
    if (matches.length === 1) plan.assignments.push(matches[0])
    else
      for (const match of matches)
        plan.conflicts.push({
          title: match.title,
          reason: "Multiple assignments target the same bookmark.",
        })
  }
  return plan
}
