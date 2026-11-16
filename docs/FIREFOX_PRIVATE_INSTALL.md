# Firefox private install (this fork)

This fork runs in Jaime's everyday Firefox as a **self-distributed (unlisted)**
add-on: Mozilla signs it but never lists it on addons.mozilla.org (AMO). Firefox
only keeps signed extensions installed across restarts, so this is the standard
route for a private extension.

## Extension ID

The fork uses its own Gecko ID, `bookmarks-but-better@wytchfire-revels`
(`manifests/manifest.firefox.json`), not the original's
`bookmarks@farhadeidi.com`. That ID belongs to the original's AMO listing and
can't be signed by anyone else. The fork can be installed alongside the
original. Its own settings and custom icons are stored separately; bookmarks
live in Firefox and are shared.

**Never change this ID after the first signed upload.** AMO ties every later
version to it; a new ID is a new, separate add-on with fresh settings and icons.

## Building the upload files

```bash
bun run build:firefox
bunx web-ext@8 lint --source-dir dist-firefox
bunx web-ext@8 build --source-dir dist-firefox --artifacts-dir dist-amo --filename "bookmarks-but-better-wytchfire-{version}.zip" --overwrite-dest
git archive --format=zip -o dist-amo/bookmarks-but-better-source.zip HEAD
```

`dist-amo/` is git-ignored. Lint must report 0 errors. Its known warnings are
the `strict_min_version` note inherited from the original and React's internal
`innerHTML` use; AMO accepts both. Use `web-ext build` rather than PowerShell's
`Compress-Archive`, which writes backslash paths that AMO rejects.

## First signing (Jaime)

1. Sign in or create an account at <https://addons.mozilla.org/developers/>.
2. **Submit a New Add-on** → choose **On your own** (self-distribution).
3. Upload `dist-amo/bookmarks-but-better-wytchfire-<version>.zip`.
4. When asked whether the add-on uses minified or bundled code, say **yes**
   and upload `dist-amo/bookmarks-but-better-source.zip`. Build instructions
   are in `README.md` → Development (`bun install && bun run build:firefox`).
5. Automated validation usually finishes within minutes. Download the signed
   `.xpi` from the version page.
6. Open the `.xpi` in Firefox (drag it onto a Firefox window, or use
   `about:addons` → gear → **Install Add-on From File…**) and accept.

## Updating later

Every upload needs a **new version number**: AMO refuses a version it has
already signed for this ID. The product rule still applies: one version across
`package.json`, `Cargo.toml` and every extension manifest. Bump them together,
rebuild, then upload under the same add-on (**Upload New Version**). Install the
new signed `.xpi` the same way; settings and icons carry over.
