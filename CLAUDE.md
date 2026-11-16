# Bookmarks But Better (Jaime's fork)

A browser extension (Chrome, Firefox, Safari) that replaces the new-tab page
with a bookmarks dashboard, plus an optional local daemon that serves bookmarks
from Markdown vaults. No accounts, analytics, tracking or collection of
bookmark content.

This repository is Jaime's fork of `farhadeidi/bookmarks-but-better` (remote
`upstream`); her copy is `origin`. She leads design and gives final acceptance;
her global instructions apply in full. The Codex-era instructions are archived
unchanged at `archive/AGENTS_Codex_2026-11-16.md`.

## Product rules (from the original project; keep them)

- Bookmarks come from **sources** that are never implicitly merged. Operations
  affect only the **Active Source**; switching sources never merges or moves
  bookmarks.
- **Privacy:** the daemon binds to `127.0.0.1`/`localhost` only. No telemetry,
  accounts, or collection of bookmark content.
- The legacy **Standalone Source** is retiring. Migration is an explicit copy
  that leaves the legacy data intact.
- Browser differences are **Platform Capabilities**, never browser-name
  branches; unsupported capabilities are omitted. Safari is daemon-only.
- One product version spans `package.json`, `Cargo.toml` and every extension
  manifest. The npm Daemon Manager has its own version; its
  `daemon.version` names the daemon release it installs.
- Use the vocabulary in `CONTEXT.md`. If a change contradicts an ADR in
  `docs/adr/`, say so explicitly rather than overriding it silently.

## Shape

- **Frontend:** React 19 + Vite + Tailwind v4 + shadcn/ui, run with Bun.
  Sources and adapters in `src/sources/` and
  `src/browser/{chrome,firefox,standalone,daemon}/`; state in `src/stores/`;
  features in `src/features/`.
- **Daemon:** Rust workspace in `crates/` (server/CLI/service and vault core).
  It asks no questions and answers in JSON; the npm manager
  (`packages/bookmarks-but-better`) is where every question lives (ADR-0006).
- **Dev Workbench:** `bun run dev` runs the full app with URL-addressable
  scenarios, no extension or daemon (`docs/DEV_WORKBENCH.md`).
- **Website:** `website/` (Astro + Starlight, Node >= 22.12); user docs in
  `website/src/content/docs/docs/`.

## Features added in this fork

Each has notes in `docs/` where listed and an automatic browser test in
`tests/ui/`. Don't break them; re-run their tests after any related change.

- Subfolder creation from the dashboard; drag-and-drop improvements
  (`bookmark-drag.spec.ts`).
- Native bookmark separators (`bookmark-separators.spec.ts`).
- Custom bookmark icons with backup and restore
  (`docs/CUSTOM_BOOKMARK_ICONS.md`, `custom-icons.spec.ts`).
- Compact nested folders and deep-nesting fixes
  (`docs/COMPACT_NESTED_FOLDERS.md`, `compact-nested-folders`,
  `deep-compact-folders`, `deep-noncompact-folders` specs).
- Cross-source session race fixes (`source-session-races.spec.ts`).
- Imports keep mixed folder/bookmark order (`import-order.spec.ts`).
- In progress: responsive dashboard layout
  (`docs/RESPONSIVE_DASHBOARD_LAYOUT.md`, branch
  `feature/responsive-dashboard-layout`).

## How we work here

- One branch per feature or fix, merged into `main` after checks pass.
- Keep layout limits and provisional values in one named place (as
  `dashboard-sizing.ts` does), not scattered literals.
- Write test logs to `logs/` (git-ignored), never the repository root.
- UI components: shadcn/ui per `components.json` (`base-maia`, `hugeicons`).
  Check the current API at `https://ui.shadcn.com/llms.txt` or the
  component's docs page rather than guessing.
- Issues: GitHub Issues on this fork (`CursedEmbrace/bookmarks-but-better`),
  via `gh` (see `docs/agents/issue-tracker.md`). Never file issues, comments or
  pull requests on the original unless Jaime asks; features may be offered
  back to it later by pull request, with her approval.

## Verification

- Frontend: `bun run check` (format, lint, typecheck, unit tests, builds).
  Targeted: `bun run typecheck`, `bun run lint`, `bun run test`.
- UI/e2e: `bun run test:ui`, `bun run test:e2e:daemon`,
  `bun run test:e2e:multi-vault`.
- Rust: `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets --all-features -- -D warnings`,
  `cargo test --workspace --all-features`.
- Full command list: `README.md` → Development.

## On-demand docs

- Releasing: read `docs/RELEASING.md` in full first.
- Daemon: `docs/DAEMON.md` (contributor reference); user docs on the website.
- Safari build, signing and QA: `docs/SAFARI.md`.
