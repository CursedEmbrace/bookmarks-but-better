import { isStoredIcon } from "./image"

export interface IconRecord {
  source: string
  id: string
  image: string
  updatedAt: number
}

const DB_NAME = "bookmarks-but-better-custom-icons"
const MAX_SOURCE_BYTES = 32 * 1024 * 1024

/** Durable user data, separate from both the evictable favicon cache and preferences. */
export class CustomIconRepository {
  private database: Promise<IDBDatabase> | null = null

  private db(): Promise<IDBDatabase> {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      let blocked = false
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("icons", {
          keyPath: ["source", "id"],
        })
        store.createIndex("source", "source")
        request.result.createObjectStore("metadata")
      }
      request.onsuccess = () => {
        const db = request.result
        if (blocked) {
          db.close()
          return
        }
        db.onversionchange = () => {
          db.close()
          this.database = null
        }
        resolve(db)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => {
        blocked = true
        reject(new Error("Close other dashboard tabs and retry."))
      }
    }).catch((error) => {
      this.database = null
      throw error
    }))
  }

  async identity(): Promise<string> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction("metadata", "readwrite")
      const store = tx.objectStore("metadata")
      const request = store.get("identity")
      let identity: string
      request.onsuccess = () => {
        identity = request.result ?? crypto.randomUUID()
        if (!request.result) store.put(identity, "identity")
      }
      tx.oncomplete = () => resolve(identity)
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Icon storage failed."))
    })
  }

  async list(source: string): Promise<IconRecord[]> {
    const db = await this.db()
    return new Promise((resolve, reject) => {
      const tx = db.transaction("icons", "readonly")
      const request = tx.objectStore("icons").index("source").getAll(source)
      tx.oncomplete = () => resolve(request.result as IconRecord[])
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Icon storage failed."))
    })
  }

  /** Atomic patch: a quota error rolls back every assignment, retaining old icons. */
  async patch(
    source: string,
    changes: Map<string, string | null>
  ): Promise<void> {
    for (const image of changes.values())
      if (image !== null && !isStoredIcon(image))
        throw new Error("Invalid icon image.")
    const db = await this.db()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("icons", "readwrite")
      const store = tx.objectStore("icons")
      const request = store.index("source").getAll(source)
      let failure: Error | null = null
      request.onsuccess = () => {
        const records = new Map(
          (request.result as IconRecord[]).map((record) => [
            record.id,
            record.image,
          ])
        )
        for (const [id, image] of changes) {
          if (image === null) records.delete(id)
          else records.set(id, image)
        }
        if (
          Array.from(records.values()).reduce(
            (size, image) => size + image.length,
            0
          ) > MAX_SOURCE_BYTES
        ) {
          failure = new Error(
            "Custom icons have reached the 32 MB limit for this source. Export a backup and reset some icons first."
          )
          tx.abort()
          return
        }
        for (const [id, image] of changes) {
          if (image === null) store.delete([source, id])
          else
            store.put({
              source,
              id,
              image,
              updatedAt: Date.now(),
            } satisfies IconRecord)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error("Icon storage failed."))
    })
  }

  /** Only a successful full-source read can collect orphans. Newer writes survive stale reads. */
  async prune(
    source: string,
    liveIds: Set<string>,
    readStartedAt: number
  ): Promise<void> {
    const db = await this.db()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("icons", "readwrite")
      const request = tx.objectStore("icons").index("source").openCursor(source)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const record = cursor.value as IconRecord
        if (!liveIds.has(record.id) && record.updatedAt < readStartedAt)
          cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error("Icon cleanup failed."))
    })
  }
}

export const customIconRepository = new CustomIconRepository()
