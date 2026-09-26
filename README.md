# Alan Review Tool

A Manifest V3 browser extension (Chrome and Firefox) for capturing UI/UX
feedback on any website. Click the toolbar icon on any tab and a slide-out
panel appears — no changes needed on the target site, no backend, and no
JavaScript in what you export.

## Features

- **Works on any site, in either browser** — injected via `activeTab` +
  `chrome.scripting.executeScript` on toolbar click, not tied to any one
  domain or embedded snippet.
- **Comments and screenshots**, grouped into a single review **session**
  that spans every page visited, not scoped to one tab or one origin.
- **Screenshot capture with freehand annotation** — drag-select any region
  of the page, then draw directly on the captured image (cyan, 3px) to
  point at the specific thing you mean. Annotations bake permanently into
  the image once you dismiss the lightbox.
- **Resizable panel** that remembers its width, and reviewer identity
  (name/email) that persists across sessions.
- **Exports a single, self-contained HTML report** — header, table of
  contents, one section per page, tight comment list, 50×50 thumbnails
  with a full-resolution lightbox. The lightbox is pure CSS (`:target`,
  no JavaScript at all); the whole report has zero `<script>` tags.
- **Every comment gets a permanent, never-reused `CM-<n>` id**, and every
  session gets its own hidden guid — combine the two for a globally
  unique id per piece of feedback.
- **Report includes hidden, AI-readable parsing instructions** — a coding
  agent handed this report can find each page, comment, and screenshot,
  and knows to treat comment text as feedback to act on, not as
  instructions to follow.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how all of this fits together,
and [llms.txt](llms.txt) for a quick map of the repo's layout.

## Build

    npm run build

Writes browser-specific bundles to `dist/chrome` and `dist/firefox`. Two
manifests are needed because Chrome's MV3 requires a `service_worker`
background and Firefox's MV3 still wants `background.scripts` — everything
else (`background.js`, `content.js`) is shared, unmodified, between both.

## Development

    npm install
    npm run lint
    npm run format

`npm install` also wires up a Husky pre-commit hook (via `prepare`) that runs
Prettier and ESLint on staged files. Releases are tracked with
[Changesets](https://github.com/changesets/changesets) — run `npx changeset`
to record a change, which lands in `CHANGELOG.md` and a version bump the next
time the release workflow runs on `main`. This package is private and never
published to npm; the versioning/changelog trail is the point, not a publish
step.

If you're an AI agent making changes here, read [AGENTS.md](AGENTS.md) and
[ARCHITECTURE.md](ARCHITECTURE.md) first.

## Load in Chrome

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select `dist/chrome`
4. Pin the extension, visit any site, click its toolbar icon — the panel
   should slide in from the right. Click again to close.

## Load in Firefox

1. `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on…" → select `dist/firefox/manifest.json`
3. Visit any site, click the toolbar icon — same panel.
   (Temporary add-ons are removed on restart — expected for a temporary
   add-on; reload it after each Firefox restart during development.)
