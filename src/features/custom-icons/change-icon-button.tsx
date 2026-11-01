import type { RefObject } from "react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import { Image01Icon } from "@hugeicons/core-free-icons"
import type { BookmarkNode } from "@/browser"
import { Button } from "@/components/ui/button"
import { useCustomIconStore } from "@/stores/custom-icon-store"
import { useUIStore } from "@/stores/ui-store"
import { canEditCustomIcon } from "./eligibility"

export function ChangeIconButton({
  bookmark,
  footer = false,
  returnFocus,
}: {
  bookmark: BookmarkNode
  footer?: boolean
  returnFocus?: RefObject<HTMLAnchorElement | null>
}) {
  const source = useCustomIconStore((s) => s.source)
  if (!source || !canEditCustomIcon(bookmark)) return null
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={footer ? "icon-sm" : "sm"}
      aria-label={footer ? `Change icon for ${bookmark.title}` : undefined}
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        useUIStore
          .getState()
          .openIconEditor(bookmark, returnFocus?.current ?? event.currentTarget)
      }}
    >
      {footer ? <HugeiconsIcon icon={Image01Icon} size={14} /> : "Change icon"}
    </Button>
  )
  if (!footer) return button
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>Change bookmark icon (Alt+I)</TooltipContent>
    </Tooltip>
  )
}
