/** Root layout policy. Compact descendants keep their own cap (`COMPACT_MAX_REM`). */
export const ROOT_COLUMN_MIN_REM = 17
export const ROOT_COLUMN_MAX_REM = 34

export interface DashboardMetrics {
  availableWidth: number
  rem: number
  gap: number
}

export function sizeDashboard(
  metrics: DashboardMetrics | null,
  maxColumns: number,
  folderCount: number
) {
  // Before the first layout measurement (or in a non-layout renderer), use
  // the existing preference. The layout effect resolves this before paint.
  const fit = metrics
    ? Math.max(
        1,
        Math.floor(
          (metrics.availableWidth + metrics.gap + 0.01) /
            (ROOT_COLUMN_MIN_REM * metrics.rem + metrics.gap)
        )
      )
    : maxColumns
  const columnCount = Math.max(1, Math.min(maxColumns, fit, folderCount || 1))
  const groupWidth = metrics
    ? folderCount
      ? Math.min(
          metrics.availableWidth,
          columnCount * ROOT_COLUMN_MAX_REM * metrics.rem +
            (columnCount - 1) * metrics.gap
        )
      : metrics.availableWidth
    : undefined
  return {
    columnCount,
    groupWidth,
    columnWidth:
      metrics && groupWidth !== undefined
        ? (groupWidth - (columnCount - 1) * metrics.gap) / columnCount
        : undefined,
    gap: metrics?.gap ?? 16,
  }
}
