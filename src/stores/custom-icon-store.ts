import { create } from "zustand"
import type { BookmarkNode } from "@/browser"
import { customIconRepository } from "@/features/custom-icons/storage"
import { bookmarkIdentities } from "@/features/custom-icons/backup"
import { isStoredIcon } from "@/features/custom-icons/image"

interface IconState {
  source: string | null
  images: Record<string, string>
  ready: boolean
  error: string | null
  activate(source: string | null): void
  reconcile(
    source: string,
    tree: BookmarkNode[],
    readStartedAt: number
  ): Promise<void>
  reload(): Promise<void>
  patch(source: string, changes: Map<string, string | null>): Promise<void>
}

let generation = 0
let readVersion = 0
let channel: BroadcastChannel | undefined

export const useCustomIconStore = create<IconState>((set, get) => ({
  source: null,
  images: {},
  ready: false,
  error: null,
  activate(source) {
    generation++
    readVersion++
    set({ source, images: {}, ready: false, error: null })
    if (
      source &&
      !channel &&
      typeof BroadcastChannel !== "undefined" &&
      typeof window !== "undefined"
    ) {
      channel = new BroadcastChannel("bookmarks-but-better-custom-icons")
      channel.onmessage = (event) => {
        if (event.data === get().source) void get().reload()
      }
    }
  },
  async reconcile(source, tree, readStartedAt) {
    const token = generation
    if (source !== get().source) return
    try {
      await customIconRepository.prune(
        source,
        new Set(bookmarkIdentities(tree).map((node) => node.id)),
        readStartedAt
      )
      if (token === generation) await get().reload()
    } catch {
      if (token === generation)
        set({
          ready: true,
          error:
            "Custom icons could not be loaded or cleaned up. Retry in Settings → Data & Migration.",
        })
    }
  },
  async reload() {
    const { source } = get()
    if (!source) return
    const token = generation
    const version = ++readVersion
    try {
      const records = await customIconRepository.list(source)
      if (token !== generation || version !== readVersion) return
      set({
        images: Object.fromEntries(
          records
            .filter((record) => isStoredIcon(record.image))
            .map((record) => [record.id, record.image])
        ),
        ready: true,
        error: null,
      })
    } catch {
      if (token === generation && version === readVersion)
        set({
          ready: true,
          error:
            "Custom icon storage is unavailable. Retry or free up browser storage.",
        })
    }
  },
  async patch(source, changes) {
    const token = generation
    if (source !== get().source)
      throw new Error("The Active Source changed. Please try again.")
    try {
      await customIconRepository.patch(source, changes)
    } catch (error) {
      throw new Error(
        error instanceof Error && error.message.includes("32 MB")
          ? error.message
          : "Could not save custom icons. Existing icons are unchanged. Free up browser storage and try again."
      )
    }
    channel?.postMessage(source)
    if (token !== generation) return
    // Publish only after the transaction commits. Do not lose changes to other IDs.
    readVersion++
    const images: Record<string, string> = Object.assign(
      Object.create(null),
      get().images
    )
    for (const [id, image] of changes) {
      if (image === null) delete images[id]
      else images[id] = image
    }
    set({ images, ready: true, error: null })
    // A concurrent tab may have committed other IDs while this save was in flight.
    await get().reload()
  },
}))
