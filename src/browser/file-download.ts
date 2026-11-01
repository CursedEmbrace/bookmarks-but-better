/** A small platform capability, independent of the Active Source adapter. */
export interface DownloadApi {
  download(options: {
    url: string
    filename: string
    saveAs: boolean
  }): Promise<number>
  search(query: { id: number }): Promise<{ state: string; error?: string }[]>
  show?: (id: number) => Promise<boolean | void>
  onChanged: {
    addListener(
      listener: (delta: {
        id: number
        state?: { current?: string }
        error?: { current?: string }
      }) => void
    ): void
    removeListener(
      listener: (delta: {
        id: number
        state?: { current?: string }
        error?: { current?: string }
      }) => void
    ): void
  }
}

interface ExtensionApi {
  runtime: {
    id?: string
    getManifest(): { permissions?: string[]; optional_permissions?: string[] }
  }
  permissions: {
    request(permissions: { permissions: string[] }): Promise<boolean>
  }
  downloads?: DownloadApi
}

export type FileDownloadResult =
  | { status: "complete"; showInFolder?: () => Promise<void> }
  | { status: "cancelled" }
  | { status: "requested" }

export interface FileDownloadCapability {
  /** Call directly from the click handler, before any asynchronous preparation. */
  requestPermission(): Promise<boolean>
  save(blob: Blob, filename: string): Promise<FileDownloadResult>
}

export function fileDownloadCapability(): FileDownloadCapability | null {
  const globals = globalThis as typeof globalThis & {
    browser?: ExtensionApi
    chrome?: ExtensionApi
  }
  const api = globals.browser?.runtime?.id ? globals.browser : globals.chrome
  if (!api?.runtime?.id) return null
  const manifest = api.runtime.getManifest()
  const required = manifest.permissions?.includes("downloads")
  if (!required && !manifest.optional_permissions?.includes("downloads"))
    return null
  return {
    // Request even if already granted: the browser resolves immediately then.
    // A contains() await first would lose Firefox's user-gesture context.
    requestPermission: () =>
      required
        ? Promise.resolve(true)
        : api.permissions.request({ permissions: ["downloads"] }),
    save: (blob, filename) => {
      if (!api.downloads)
        return Promise.reject(
          new Error(
            "Download access is unavailable. Try exporting again and allow download access."
          )
        )
      return saveBlobAs(api.downloads, blob, filename)
    },
  }
}

function cancelled(reason: unknown): boolean {
  const message =
    reason && typeof reason === "object" && "message" in reason
      ? String(reason.message)
      : String(reason)
  return /^(USER_CANCELED|Download cancel(?:led|ed)(?: by the user)?\.?)$/i.test(
    message
  )
}

/** Keep the blob alive and observe terminal state, not just the initiation ID. */
export async function saveBlobAs(
  api: DownloadApi,
  blob: Blob,
  filename: string
): Promise<FileDownloadResult> {
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<FileDownloadResult>((resolve, reject) => {
      let id: number | undefined
      let settled = false
      const finish = (state: string, error?: string) => {
        if (settled || state === "in_progress") return
        settled = true
        api.onChanged.removeListener(changed)
        if (state === "complete") {
          resolve({
            status: "complete",
            ...(api.show
              ? {
                  showInFolder: async () => {
                    const shown = await api.show!(id!)
                    if (shown === false)
                      throw new Error(
                        "The saved file could not be shown. Find it in your browser's Downloads list."
                      )
                  },
                }
              : {}),
          })
        } else if (cancelled(error)) resolve({ status: "cancelled" })
        else
          reject(
            new Error(
              "The backup download failed. Check your browser's Downloads list and try exporting again."
            )
          )
      }
      const inspect = async () => {
        try {
          const [item] = await api.search({ id: id! })
          if (!settled) finish(item?.state ?? "missing", item?.error)
        } catch {
          finish("failed")
        }
      }
      const changed: Parameters<DownloadApi["onChanged"]["addListener"]>[0] = (
        delta
      ) => {
        if (id === undefined || delta.id !== id) return
        if (delta.state?.current === "complete") finish("complete")
        else if (delta.state?.current === "interrupted" || delta.error?.current)
          void inspect()
      }
      api.onChanged.addListener(changed)
      void (async () => {
        try {
          id = await api.download({ url, filename, saveAs: true })
          if (!Number.isInteger(id)) {
            finish("failed")
            return
          }
          // Also catches completion before download() resolves or before its ID is known.
          await inspect()
        } catch (error) {
          finish("failed", cancelled(error) ? "USER_CANCELED" : undefined)
        }
      })()
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Web/unsupported contexts cannot observe the browser's eventual download result. */
export function requestFileDownload(
  blob: Blob,
  filename: string
): FileDownloadResult {
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    return { status: "requested" }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
