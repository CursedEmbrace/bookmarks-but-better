import { createContext } from "react"
import type { BookmarkNode } from "@/browser"
import type { sizeDashboard } from "./dashboard-sizing"

export interface DashboardLayoutValue extends ReturnType<typeof sizeDashboard> {
  folders: BookmarkNode[]
  displayRoot: BookmarkNode | null
  experimentalCardDrag: boolean
  collectionError: Error | null
}

export const DashboardLayoutContext =
  createContext<DashboardLayoutValue | null>(null)
