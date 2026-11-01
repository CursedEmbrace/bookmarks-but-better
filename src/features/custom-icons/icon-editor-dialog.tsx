import * as React from "react"
import type { BookmarkNode } from "@/browser"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FilePicker } from "@/components/file-picker"
import { Favicon } from "@/features/bookmark-item/favicon"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useCustomIconStore } from "@/stores/custom-icon-store"
import { IMAGE_ACCEPT, prepareIcon } from "./image"
import { canEditCustomIcon } from "./eligibility"

export function IconEditorDialog() {
  const request = useUIStore((s) => s.iconEditor)
  if (!request) return null
  return (
    <IconEditor
      key={request.bookmark.id}
      bookmark={request.bookmark}
      returnFocus={request.returnFocus}
    />
  )
}

function IconEditor({
  bookmark,
  returnFocus,
}: {
  bookmark: BookmarkNode
  returnFocus?: HTMLElement
}) {
  const source = useCustomIconStore((s) => s.source)
  const image = useCustomIconStore((s) =>
    Object.hasOwn(s.images, bookmark.id) ? s.images[bookmark.id] : undefined
  )
  const storageError = useCustomIconStore((s) => s.error)
  const [preview, setPreview] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState("")
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function choose(file?: File) {
    if (!file) return
    setBusy(true)
    setError(null)
    setStatus("")
    setPreview(null)
    try {
      const processed = await prepareIcon(file)
      if (mounted.current) setPreview(processed)
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Could not read this image."
        )
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function save(next: string | null) {
    const adapter = useBookmarkStore.getState().adapter
    if (!source || !adapter) return
    setBusy(true)
    setError(null)
    setStatus("")
    try {
      const [current] = await adapter.bookmarks.getSubTree(bookmark.id)
      if (!mounted.current || useBookmarkStore.getState().adapter !== adapter)
        return
      if (!current || current.id !== bookmark.id || !canEditCustomIcon(current))
        throw new Error(
          "This bookmark is no longer available. Close this dialog and refresh."
        )
      await useCustomIconStore
        .getState()
        .patch(source, new Map([[bookmark.id, next]]))
      if (mounted.current) {
        setPreview(null)
        setStatus(next ? "Custom icon saved." : "Website favicon restored.")
      }
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error ? cause.message : "Could not save this icon."
        )
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) useUIStore.getState().closeIconEditor()
      }}
    >
      <DialogContent
        finalFocus={() => (returnFocus?.isConnected ? returnFocus : null)}
      >
        <DialogHeader>
          <DialogTitle>Change icon</DialogTitle>
          <DialogDescription>
            {bookmark.title} — this bookmark only.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-4">
          {preview ? (
            <img
              src={preview}
              alt="New icon preview"
              draggable="false"
              className="size-16 shrink-0 rounded-md object-contain"
            />
          ) : (
            <Favicon
              bookmarkId={bookmark.id}
              url={bookmark.url ?? ""}
              title={bookmark.title}
              size={64}
            />
          )}
          <p className="text-sm text-muted-foreground">
            PNG, JPEG or WebP, up to 8 MB. Images are fitted within 128 × 128
            pixels and stored locally.
          </p>
        </div>
        <FilePicker
          id="custom-icon-file"
          label="Choose an image"
          buttonLabel="Choose image from computer"
          emptyText="No image selected."
          accept={IMAGE_ACCEPT}
          disabled={busy}
          onSelect={(file) => void choose(file)}
        />
        {(error || storageError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? storageError}
          </p>
        )}
        <p role="status" className="text-sm text-muted-foreground">
          {busy ? "Processing…" : status}
        </p>
        <DialogFooter>
          {image && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void save(null)}
            >
              Reset icon
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => useUIStore.getState().closeIconEditor()}
          >
            Done
          </Button>
          <Button
            type="button"
            disabled={!preview || busy}
            onClick={() => void save(preview)}
          >
            Save icon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
