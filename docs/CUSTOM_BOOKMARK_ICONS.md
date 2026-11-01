# Custom bookmark icons

Choose **Change icon** from a bookmark's hover-card footer (or press Alt+I on a
focused bookmark), or the bookmark editor. Choose a PNG, JPEG or WebP,
review the preview, and select **Save icon**. **Reset icon** returns that bookmark
to its website favicon. These controls apply to individual bookmarks, including
two bookmarks with identical URLs, in list/grid views and nested folders.

## Implementation files

| Files                                                                                                                 | Purpose                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/custom-icons/image.ts`                                                                                  | Raster validation, size limits and local PNG normalization.                                                                      |
| `src/features/custom-icons/storage.ts`                                                                                | Separate IndexedDB repository, atomic writes, source limits and orphan cleanup.                                                  |
| `src/features/custom-icons/backup.ts`                                                                                 | Versioned JSON format, validation, bookmark metadata and conservative restore matching.                                          |
| `src/features/custom-icons/change-icon-button.tsx`, `icon-editor-dialog.tsx`, `icon-backup-panel.tsx`                 | Picker controls, preview/reset/save dialog and reviewed backup restoration.                                                      |
| `src/stores/custom-icon-store.ts`                                                                                     | Reactive assignments, source-session guards, errors and cross-tab updates.                                                       |
| `src/stores/bookmark-store.ts`, `source-store.ts`                                                                     | Initialize/reconcile icons on successful full-tree reads and source transitions.                                                 |
| `src/stores/ui-store.ts`, `src/App.tsx`                                                                               | Dialog state, lazy dialog mounting and storage error feedback.                                                                   |
| `src/features/bookmark-item/favicon.tsx`, `bookmark-item.tsx`                                                         | Custom-first rendering, accessible link labels, picker buttons and Alt+I.                                                        |
| `src/features/bookmark-editor/bookmark-editor-dialog.tsx`                                                             | Picker entry from existing bookmark editing.                                                                                     |
| `src/features/settings/panels/settings-panels.tsx`                                                                    | Backup controls in Data & Migration.                                                                                             |
| `src/components/file-picker.tsx`, `src/features/settings/panels/setting-row.tsx`                                      | Accessible native file selection, filename feedback and responsive settings action rows.                                         |
| `src/browser/file-download.ts`, `manifests/manifest.firefox.json`                                                     | Optional native download capability, completion monitoring and Show in Folder.                                                   |
| `src/features/custom-icons/{image,storage,backup,rendering}.test.*`, `src/stores/__tests__/custom-icon-store.test.ts` | Focused image, storage, restore, renderer and session coverage.                                                                  |
| `tests/ui/custom-icons.spec.ts`                                                                                       | Real browser fixture tests, including drag, persistence, backup, multiple tabs and source switching.                             |
| `tests/ui/data-migration.spec.ts`, `src/components/file-picker.test.tsx`                                              | Action consistency, theme and narrow-width layout, keyboard operation, filenames and existing HTML handlers.                     |
| `src/features/safety-net/__tests__/safe-mode.test.tsx`                                                                | Reset the previous bookmark session before rendering each test, preventing false early success and asynchronous teardown errors. |
| `docs/CUSTOM_BOOKMARK_ICONS.md`                                                                                       | Architecture, usage, limitations and the manual verification checklist.                                                          |

## Storage and image processing

- The shared `Favicon` component checks the custom assignment before mounting the
  existing website favicon resolver. A working custom image needs no favicon
  network request. Failed custom images use the existing favicon/fallback path.
- `bookmarks-but-better-custom-icons` is a separate IndexedDB database. Records
  are keyed by `[source ID, bookmark ID]`, never by URL or domain. Source IDs
  distinguish the Browser Source, Standalone Source and individual daemon Vaults.
  There are no bookmark record changes. Native backup saving uses the optional
  download permission described below.
- Raster signatures and dimensions are inspected before decoding. Input is
  limited to 8 MB, 16 megapixels and 8192 pixels per side. The browser decodes the
  image locally and canvas re-encodes it as a PNG within 128 × 128 pixels,
  preserving aspect ratio and transparency. SVG is rejected. Animation is
  flattened. Metadata is removed. Each stored data URL is limited to 128 KiB;
  each source has a 32 MiB limit, with no automatic eviction of user icons.
- Move, reorder, title and URL changes preserve the assignment while the source's
  bookmark ID remains stable. Read-only/non-bookmark nodes have no picker.
- Successful full-source loads reconcile deleted bookmark IDs, including deleted
  folders' descendants. Cleanup happens at dashboard startup and on bookmark
  changes, and never on a failed/offline load or against a dashboard subtree.
  Writes newer than the tree read are protected from stale cleanup snapshots.
  Deletions made while the dashboard is closed are collected on its next load.
- IndexedDB transaction completion determines success. Failed/aborted saves keep
  previous icons; bookmark and preference databases are untouched. Source Session
  transitions clear in-memory assignments and expire pending work. A local
  BroadcastChannel updates other open dashboard tabs after saves/resets/restores.
- Icons are local to this browser profile/origin, including icons for Daemon
  Sources. They are not stored in vault Markdown, synced between devices, or
  embedded in HTML bookmark exports. Clearing extension/site data removes them;
  use the JSON backup before changing profiles or reinstalling.

## Backups

Settings → **Data & Migration** → **Custom bookmark icons** exports the Active
Source's assignments with a suggested filename of
`bookmarks-but-better-icons-YYYY-MM-DD.json` (the local export date). The versioned file
contains embedded PNG data, bookmark IDs, full URLs, titles, folder-title paths,
source ID and a locally generated database identity. No additional credentials
are collected, but bookmark URLs themselves may contain sensitive information.
Treat it with the same privacy as a bookmark export.

### Choosing and finding an export

The Firefox manifest declares **optional** `downloads` access. Clicking Export
requests it directly from that user gesture; cancelling or denying access stops
the export without silently downloading somewhere else. Firefox's native Save As
dialog then lets you change the suggested filename and destination. Installing
or updating the extension does not require this optional grant.

The download permission allows interaction with the browser's download manager,
including download metadata. This feature uses it only to save the local backup,
observe that export's completion, query that download by ID, and reveal it on
request. It does not read unrelated download history or store filesystem paths.
It does not request `downloads.open`, host access or extra bookmark permissions.
The grant can be revoked in the browser's extension settings.

Success appears only after a `complete` download state, not merely after
`downloads.download()` returns an ID. Cancelled and failed downloads have distinct
feedback. **Show in Folder** appears only for a completed export when the runtime
supports revealing files; a missing file or failed reveal gives a useful error.
Keep the dashboard tab open until saving finishes, since the blob and completion
listener belong to that page. The completion/reveal information is session-only.

Other manifests and the web Workbench retain ordinary browser downloads. Without
the declared download capability, the UI says **Download requested** and directs
you to the browser's Downloads list to check completion and location; it cannot
verify a save or offer Show in Folder. The existing HTML export is unchanged.

Restore still uses a user-initiated `<input type="file">`. Firefox controls its
initial directory; there is no supported directory parameter on that input, and
its real path cannot be set or recovered by the page. Firefox may remember a
directory itself, but the restore workflow does not rely on that. Locate the JSON
using Show in Folder or the Downloads list, then select it in Restore. No directory
preference is persisted.

References: [download / Save As](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/download),
[completion events](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/onChanged),
[reveal file](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads/show),
[download permission](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/downloads),
[file input restrictions](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file).

### Reviewing a restore

Restoring first previews successful, skipped and conflicting counts. Selecting
**Restore matching icons** replaces only reviewed icon assignments atomically;
bookmarks and folder hierarchy are never written. Invalid images are skipped
after passing through the same raster validation/normalization as file uploads.
Export and import share a 48 MiB UTF-8 file limit and a maximum folder-path
depth of 256. There is no separate assignment-count limit: backups with 10,001
or more assignments are accepted within these resource limits. Export checks
these limits before downloading and reports an error rather than truncating
assignments. Unknown schemas and malformed entries are rejected. The existing
32 MiB per-source image quota still applies atomically during restoration;
capacity failures retain every previous assignment.

Matching is deliberately conservative:

1. In the same icon database and source, an existing bookmark ID with the same
   URL wins, even if the bookmark was renamed or moved.
2. Otherwise, require a unique exact URL, title and folder-title path match. The
   synthetic tree root is omitted from paths. A different browser's root-folder
   naming may therefore require manually reassigning some icons.
3. Duplicate metadata, competing assignments or changed metadata are reported as
   conflicts. Missing bookmarks and invalid images are reported as skipped.
   Expand the report to see titles and reasons. No URL-only guess is made.
4. Unique read-only targets are skipped with an explanation, using the same
   eligibility rules as the picker and save/reset controls. Existing icons on
   these targets remain untouched. Read-only duplicates still count toward
   ambiguous matches; they are never filtered out to guess a writable target.
5. Targets and their eligibility are rechecked before writing; changed matches
   or permissions require a new preview.

Restore the bookmarks using the existing HTML import first, then restore icons.
Keep the backup if any entries are skipped/conflicting. There is no manual
conflict-mapping interface in this version. Toby imports are not implemented;
future importers can call the same image normalization, identity matching and
repository APIs without changing the renderer or bookmark storage.

## Automated verification

Verified on 2026-11-01 during the final feature review:

- `bun run test`: 108 test files, 1,030 tests passed.
- `bun run test:ui --browser=firefox --workers=2`: all 71 tests passed on the
  full rerun, including separators, drag-and-drop, custom icons and settings.
- `bun run test:ui --browser=chromium --workers=2`: all 71 tests passed.
- `bun run lint`, `bun run typecheck`, `bun run build:firefox`, changed-file
  Prettier checks and `git diff --check`: passed.

Download API responses are mocked for Save As, completion, permission,
cancellation and failure tests; the ordinary file-download and restore path
uses real browser downloads. The shared picker and settings action tests cover
keyboard operation, filename feedback, neutral button styles, different accents
in light/dark themes and narrow layouts down to 320 pixels.

Backup regression coverage includes 10,000/10,001-assignment round trips,
UTF-8 byte boundaries, malformed input, excessive folder depth, ambiguous
read-only duplicates, source isolation, and atomic quota-failure preservation.
The 14 download-helper tests also cover early completion before the initiation
promise resolves, unrelated download events, blob cleanup, reveal failure and
unsupported-runtime fallback. Native OS dialogs and permission prompts require
the manual Firefox checks below.

Windows sandbox restrictions required a workspace-local temporary directory for
Vitest and execution outside the socket sandbox for the isolated UI server.
The first full Firefox run passed 70 tests and lost the page execution context
during one cross-tab test's fixture setup, before icon assertions. The trace
did not establish the cause. That test passed three consecutive isolated runs,
then the full 71-test rerun passed without code changes, with builds and file
edits finished before starting the UI server. No Rust or daemon protocol code
changed.

The browser tests use simulated Workbench bookmarks, not a personal Firefox
profile. Actual extension reload and Firefox restart remain manual checks.

## Firefox manual verification (disposable test profile)

1. Load the Firefox production build in a temporary test profile. Use fixture
   bookmarks only. Confirm the separator implementation still works.
2. Assign different PNG/JPEG/WebP images to two identical URLs. Check preview,
   transparency and aspect ratio, list/grid layouts and nested folders.
3. Replace an image, reload the dashboard, reload the extension, and restart
   Firefox. Confirm assignments survive; reset one and check its favicon returns.
4. Rename/reorder/drag a bookmark across folders. Delete a bookmark and a folder
   containing icons; reopen the dashboard and check the export excludes them.
5. Open two dashboards and check icon saves/resets appear in both. Switch Active
   Sources while a picker is open; verify it closes and icons stay source-local.
6. Export JSON, reset icons and restore it. Try restoration after HTML import in
   a second test profile. Review missing/duplicate conflicts and confirm bookmark
   titles, URLs and folder hierarchy do not change.
7. Try SVG, corrupt and oversized files. Check clear feedback and retained icons.
   Use keyboard controls (arrow keys/Alt+I/Enter/Escape) and verify focus returns
   to the originating bookmark or picker button. Check existing hover actions,
   native context menus and dragging.
8. Reload the rebuilt extension. Click Export and allow the optional download
   permission. Confirm Save As suggests a dated filename; choose a different
   filename and folder. Wait for Saved, then use Show in Folder and restore that
   JSON. Repeat while cancelling Save As and denying optional access; neither
   should claim success or reveal a file. Test a download failure and a deleted
   exported file's Show in Folder error. Keep the dashboard open while exporting.
9. In Data & Migration, check all four action rows at wide and narrow widths in
   light and dark themes with different accents. Tab through the controls and
   use Enter/Space to open a file picker. Check selected filenames, cancellation,
   restore preview and success/error feedback.
