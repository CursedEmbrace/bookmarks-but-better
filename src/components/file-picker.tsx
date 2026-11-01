import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { FolderOpenIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface FilePickerProps {
  id: string
  label: string
  buttonLabel: string
  accept: string
  emptyText: string
  disabled?: boolean
  descriptionId?: string
  variant?: "default" | "outline"
  size?: "default" | "sm"
  /** Place the trigger and its filename in a surrounding row without duplicating picker logic. */
  renderLayout?: (parts: {
    control: React.ReactNode
    filename: React.ReactNode
  }) => React.ReactNode
  onSelect(file: File): void
}

/** A native single-file picker with one visible, keyboard-operable entry point. */
export function FilePicker({
  id,
  label,
  buttonLabel,
  accept,
  emptyText,
  disabled,
  descriptionId,
  variant = "default",
  size = "default",
  renderLayout,
  onSelect,
}: FilePickerProps) {
  const input = React.useRef<HTMLInputElement>(null)
  const [filename, setFilename] = React.useState("")
  const filenameId = `${id}-filename`
  const control = (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      className={cn(
        "cursor-pointer disabled:cursor-not-allowed",
        variant === "outline" ? "active:bg-input/70" : "active:bg-primary/70",
        size === "sm"
          ? "h-auto min-h-8 max-w-full whitespace-normal"
          : "w-full sm:w-auto"
      )}
      aria-describedby={[filenameId, descriptionId].filter(Boolean).join(" ")}
      onClick={() => input.current?.click()}
    >
      <HugeiconsIcon icon={FolderOpenIcon} aria-hidden="true" />
      {buttonLabel}
    </Button>
  )
  const filenameFeedback = (
    <p
      id={filenameId}
      className={cn(
        "max-w-full break-all text-muted-foreground",
        size === "sm" ? "text-xs" : "text-sm"
      )}
      aria-live="polite"
      aria-atomic="true"
    >
      {filename ? `Selected: ${filename}` : emptyText}
    </p>
  )
  return (
    <div
      className={
        renderLayout ? undefined : "flex min-w-0 flex-col items-start gap-2"
      }
      data-slot="file-picker"
    >
      <input
        ref={input}
        id={id}
        type="file"
        hidden
        aria-label={label}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          // Allow selecting the same file again; cancelling retains the last selection.
          event.currentTarget.value = ""
          if (!file) return
          setFilename(file.name)
          onSelect(file)
        }}
      />
      {renderLayout ? (
        renderLayout({ control, filename: filenameFeedback })
      ) : (
        <>
          {control}
          {filenameFeedback}
        </>
      )}
    </div>
  )
}
