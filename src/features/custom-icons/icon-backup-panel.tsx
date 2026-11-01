import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { FilePicker } from "@/components/file-picker"
import { cn } from "@/lib/utils"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useCustomIconStore } from "@/stores/custom-icon-store"
import {
  SettingGroup,
  SettingRow,
  SettingSection,
} from "@/features/settings/panels/setting-row"
import { customIconRepository } from "./storage"
import {
  createIconBackup,
  MAX_BACKUP_BYTES,
  parseIconBackup,
  planIconRestore,
  serializeIconBackup,
  type IconBackup,
  type RestorePlan,
} from "./backup"
import { prepareBackupIcon } from "./image"
import {
  fileDownloadCapability,
  requestFileDownload,
} from "@/browser/file-download"

export function IconBackupPanel() {
  const source = useCustomIconStore((s) => s.source)
  return <IconBackupControls key={source} source={source} />
}

function IconBackupControls({ source }: { source: string | null }) {
  const storageError = useCustomIconStore((s) => s.error)
  const [pending, setPending] = React.useState<{
    backup: IconBackup
    plan: RestorePlan
    targets: RestorePlan["assignments"]
  } | null>(null)
  const [report, setReport] = React.useState<RestorePlan | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{
    text: string
    tone: "success" | "cancelled" | "info"
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<{
    showInFolder?: () => Promise<void>
  } | null>(null)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Icon backup operation failed."
        )
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  async function context() {
    const adapter = useBookmarkStore.getState().adapter
    if (!adapter || !source)
      throw new Error("Choose an available Active Source first.")
    const tree = await adapter.bookmarks.getTree()
    const identity = await customIconRepository.identity()
    if (
      !mounted.current ||
      source !== useCustomIconStore.getState().source ||
      adapter !== useBookmarkStore.getState().adapter
    )
      throw new Error("The Active Source changed. Please try again.")
    return { tree, identity }
  }

  async function exportIcons() {
    setSaved(null)
    const download = fileDownloadCapability()
    // This is the first await: request optional access inside the Export click.
    if (download && !(await download.requestPermission())) {
      if (mounted.current)
        setMessage({
          text: "Export cancelled: download access was not granted. No backup was saved.",
          tone: "cancelled",
        })
      return
    }
    const { tree, identity } = await context()
    const records = await customIconRepository.list(source!)
    if (!mounted.current || source !== useCustomIconStore.getState().source)
      return
    const backup = createIconBackup(source!, identity, tree, records)
    const date = new Date()
    const stamp = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-")
    const filename = `bookmarks-but-better-icons-${stamp}.json`
    const blob = new Blob([serializeIconBackup(backup)], {
      type: "application/json",
    })
    const result = download
      ? await download.save(blob, filename)
      : requestFileDownload(blob, filename)
    if (!mounted.current) return
    if (result.status === "complete") {
      setSaved(result)
      setMessage({
        text: `Saved ${backup.assignments.length} custom icon assignments. ${result.showInFolder ? "Use Show in Folder or your browser's Downloads list to find the backup." : "Find the backup in your browser's Downloads list."}`,
        tone: "success",
      })
    } else if (result.status === "cancelled") {
      setMessage({
        text: "Export cancelled. No backup was saved.",
        tone: "cancelled",
      })
    } else {
      setMessage({
        text: `Download requested: ${filename}. Check your browser's Downloads list for its location and completion; this page cannot verify that it was saved.`,
        tone: "info",
      })
    }
  }

  async function inspect(file: File) {
    setPending(null)
    setReport(null)
    if (file.size > MAX_BACKUP_BYTES)
      throw new Error(
        "Custom icon backups cannot exceed 48 MB. No icons were changed."
      )
    const backup = parseIconBackup(await file.text())
    const { tree, identity } = await context()
    const plan = planIconRestore(backup, source!, identity, tree)
    // Decode/re-encode before review. Nothing from a backup is rendered directly.
    const targets = plan.assignments
    const valid: typeof plan.assignments = []
    for (const assignment of plan.assignments) {
      if (!mounted.current) return
      try {
        valid.push({
          ...assignment,
          image: await prepareBackupIcon(assignment.image),
        })
      } catch {
        plan.skipped.push({
          title: assignment.title,
          reason: "Invalid, corrupt or oversized image.",
        })
      }
    }
    plan.assignments = valid
    if (mounted.current) setPending({ backup, plan, targets })
  }

  async function restore() {
    if (!pending) return
    const { tree, identity } = await context()
    // Re-plan against fresh bookmarks and compare targets to what was reviewed.
    const current = planIconRestore(pending.backup, source!, identity, tree)
    if (
      current.assignments.length !== pending.targets.length ||
      current.assignments.some(
        (item, index) =>
          item.id !== pending.targets[index].id ||
          item.image !== pending.targets[index].image
      )
    )
      throw new Error(
        "Bookmarks changed since this preview. Choose the backup again to review new matches."
      )
    const changes = new Map<string, string | null>(
      pending.plan.assignments.map((item) => [item.id, item.image])
    )
    await useCustomIconStore.getState().patch(source!, changes)
    if (!mounted.current) return
    setReport(pending.plan)
    setMessage({
      text: `Restored ${changes.size}; skipped ${pending.plan.skipped.length}; conflicting ${pending.plan.conflicts.length}.`,
      tone: "success",
    })
    setPending(null)
  }

  const details = pending?.plan ?? report
  return (
    <SettingSection title="Custom bookmark icons">
      <p className="text-xs text-muted-foreground">
        Icons stay in this browser profile and aren't included in HTML
        bookmarks. Use a JSON backup to transfer them to another profile.
      </p>
      <SettingGroup>
        <SettingRow
          layout="action"
          title="Export custom icons"
          description="Save the Active Source's icons as a separate JSON backup."
          control={
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer active:bg-input/70"
              disabled={!source || busy}
              onClick={() => void run(exportIcons)}
            >
              Export custom icons
            </Button>
          }
        >
          <p>
            When prompted, allow download access to open Save As and choose a
            filename and destination. Export suggests a dated filename. The JSON
            includes bookmark URLs, titles and folder paths.
          </p>
          {saved?.showInFolder && (
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer self-start active:bg-input/70"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    await saved.showInFolder!()
                  } catch {
                    throw new Error(
                      "The saved file could not be shown. Find it in your browser's Downloads list."
                    )
                  }
                })
              }
            >
              Show in Folder
            </Button>
          )}
        </SettingRow>
        <FilePicker
          id="icon-backup-file"
          label="Restore custom icons from JSON"
          buttonLabel="Choose JSON backup to restore"
          emptyText="No backup selected."
          accept=".json,application/json"
          descriptionId="icon-backup-guidance"
          variant="outline"
          size="sm"
          disabled={!source || busy}
          onSelect={(file) => void run(() => inspect(file))}
          renderLayout={({ control, filename }) => (
            <SettingRow
              layout="action"
              title="Restore custom icons"
              description="Review matching bookmarks before replacing their custom icons."
              control={control}
            >
              {filename}
              <p id="icon-backup-guidance">
                Choose the JSON file you saved. Find exports using Show in
                Folder after a successful export, or your browser's Downloads
                list. Your browser controls which folder the file picker opens.
              </p>
              {pending && (
                <>
                  <p role="status" className="text-foreground">
                    Ready: {pending.plan.assignments.length}; skipped:{" "}
                    {pending.plan.skipped.length}; conflicting:{" "}
                    {pending.plan.conflicts.length}.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy || pending.plan.assignments.length === 0}
                      onClick={() => void run(restore)}
                    >
                      Restore matching icons
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setPending(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              )}
              {details &&
                (details.skipped.length > 0 ||
                  details.conflicts.length > 0) && (
                  <details>
                    <summary className="cursor-pointer">
                      Skipped and conflicting assignments
                    </summary>
                    <ul className="max-h-48 overflow-auto break-words">
                      {[...details.skipped, ...details.conflicts].map(
                        (issue, index) => (
                          <li key={index}>
                            {issue.title}: {issue.reason}
                          </li>
                        )
                      )}
                    </ul>
                  </details>
                )}
            </SettingRow>
          )}
        />
      </SettingGroup>
      <div className="flex flex-col gap-3">
        {storageError && (
          <>
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {storageError}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer self-start active:bg-input/70"
              disabled={busy}
              onClick={() => void useCustomIconStore.getState().reload()}
            >
              Retry icon storage
            </Button>
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <p
          role="status"
          data-tone={busy ? "info" : message?.tone}
          className={cn(
            "flex items-start gap-2 text-sm",
            (busy || message) && "rounded-lg p-3",
            !busy && message?.tone === "success"
              ? "bg-accent/40 text-foreground"
              : "bg-muted/50 text-muted-foreground"
          )}
        >
          {(busy || message) && (
            <HugeiconsIcon
              className="size-4 shrink-0"
              aria-hidden="true"
              icon={
                !busy && message?.tone === "success"
                  ? CheckmarkCircle02Icon
                  : !busy && message?.tone === "cancelled"
                    ? CancelCircleIcon
                    : InformationCircleIcon
              }
            />
          )}
          <span>
            {busy
              ? "Processing icons… Keep this dashboard open until it finishes."
              : message?.text}
          </span>
        </p>
      </div>
    </SettingSection>
  )
}
