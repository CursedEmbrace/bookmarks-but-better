import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { cn } from "@/lib/utils"
import { getVisibleFolders } from "./folder-collection"
import { DashboardLayoutContext } from "./dashboard-layout-context"
import {
  ROOT_COLUMN_MIN_REM,
  sizeDashboard,
  type DashboardMetrics,
} from "./dashboard-sizing"

/** One collection and width owner for the header and whole-card masonry. */
export function DashboardLayout({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const canOrder = useBookmarkStore(
    (s) =>
      (s.adapter?.capabilities.reorder ?? true) ||
      (s.adapter?.capabilities.setChildOrder ?? false)
  )
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const experimentalCardDrag =
    usePreferencesStore((s) => s.experimentalCardDrag) && canOrder
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const safeMode = usePreferencesStore((s) => s.safeMode)
  const displayRoot = rootFolder ?? tree[0] ?? null
  const { folders, collectionError } = React.useMemo(() => {
    if (!displayRoot || safeMode) return { folders: [], collectionError: null }
    try {
      return {
        folders: getVisibleFolders({
          displayRoot,
          nestedFolders,
          experimentalCardDrag,
          folderOrder,
          isTreeRoot: rootFolder === null,
        }),
        collectionError: null,
      }
    } catch (error) {
      // Collection used to run inside GridErrorBoundary. Keep failures there
      // so the shared header, Settings and safe-mode recovery remain usable.
      return {
        folders: [],
        collectionError:
          error instanceof Error ? error : new Error(String(error)),
      }
    }
  }, [
    displayRoot,
    nestedFolders,
    experimentalCardDrag,
    folderOrder,
    rootFolder,
    safeMode,
  ])

  const availableRef = React.useRef<HTMLDivElement>(null)
  const probeRef = React.useRef<HTMLSpanElement>(null)
  const [metrics, setMetrics] = React.useState<DashboardMetrics | null>(null)

  React.useLayoutEffect(() => {
    const available = availableRef.current
    const probe = probeRef.current
    if (!available || !probe) return
    const measure = () => {
      const width = available.getBoundingClientRect().width
      const probeBox = probe.getBoundingClientRect()
      // Hidden/detached elements have no usable measurement. Keep the last
      // geometry until observation reports their visible size again.
      if (width <= 0 || probeBox.width <= 0) return
      const next = {
        availableWidth: width,
        rem: probeBox.width / ROOT_COLUMN_MIN_REM,
        gap: probeBox.height,
      }
      setMetrics((previous) =>
        previous &&
        Math.abs(previous.availableWidth - next.availableWidth) < 0.01 &&
        Math.abs(previous.rem - next.rem) < 0.01 &&
        Math.abs(previous.gap - next.gap) < 0.01
          ? previous
          : next
      )
    }
    // Neither target depends on the chosen column count. Observing the
    // occupied group instead would feed our output back into the fit input.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(available)
    observer?.observe(probe)
    window.addEventListener("resize", measure)
    measure()
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [containerMode])

  const sizing = React.useMemo(
    () => sizeDashboard(metrics, maxColumns, folders.length),
    [metrics, maxColumns, folders.length]
  )
  const value = React.useMemo(
    () => ({
      ...sizing,
      folders,
      displayRoot,
      experimentalCardDrag,
      collectionError,
    }),
    [sizing, folders, displayRoot, experimentalCardDrag, collectionError]
  )

  return (
    <div className={cn("w-full min-w-0", className)}>
      <div
        ref={availableRef}
        data-dashboard-available=""
        className={cn(
          "relative mx-auto w-full min-w-0",
          containerMode === "contained" && "max-w-[1440px]"
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
        >
          <span
            ref={probeRef}
            className="absolute h-4"
            style={{ width: `${ROOT_COLUMN_MIN_REM}rem` }}
          />
        </span>
        <div
          data-dashboard-group=""
          className="mx-auto flex max-w-full min-w-0 flex-col gap-5"
          style={{ width: sizing.groupWidth ?? "100%" }}
        >
          <DashboardLayoutContext value={value}>
            {children}
          </DashboardLayoutContext>
        </div>
      </div>
    </div>
  )
}
