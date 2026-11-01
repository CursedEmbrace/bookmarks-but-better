import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The building blocks every settings panel is laid out with: a muted section
 * heading, a bordered group, and rows that put the label and its explanation
 * on the left and the control on the right.
 */

export function SettingSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function SettingGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-border/60">
      {children}
    </div>
  )
}

export function SettingRow({
  title,
  description,
  control,
  htmlFor,
  layout = "default",
  children,
}: {
  title: string
  description?: React.ReactNode
  control: React.ReactNode
  /** The control's id, so the title labels it for assistive technology. */
  htmlFor?: string
  /** Action rows respond to the panel's available width and can include supporting feedback. */
  layout?: "default" | "action"
  children?: React.ReactNode
}) {
  const Title = htmlFor ? "label" : "span"
  const row = (
    <div
      className={cn(
        "flex flex-col gap-3 p-4",
        layout === "action"
          ? "@md:flex-row @md:items-center @md:justify-between"
          : "sm:flex-row sm:items-center sm:justify-between"
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Title htmlFor={htmlFor} className="text-sm font-medium">
          {title}
        </Title>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div
        className={cn(
          "flex shrink-0 items-center gap-2",
          layout === "action" && "max-w-full min-w-0"
        )}
      >
        {control}
      </div>
    </div>
  )
  if (layout === "default") return row
  return (
    <div className="@container" data-slot="setting-action-row">
      {row}
      {children && (
        <div className="flex flex-col gap-2 px-4 pb-4 text-xs text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
