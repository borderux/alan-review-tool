# Tagger

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
- **Fast comments** — type in New comment and press Enter; each comment
  lands in a numbered list and focus stays in the field for the next one.
- **Screenshot capture with freehand annotation** — drag-select any region
  of the page, then use Add annotations to draw on it in one of six
  colors (red by default; the last choice is remembered). Every stroke
  has a thin contrasting outline so it shows on light and dark
  screenshots. Save annotations bakes the drawing into the image.
- **Element capture** — Add element lets you pick any element on the page,
  like the browser's element inspector (hover and click, or the arrow keys
  and Enter). Tagger records its selector, HTML, key computed styles, the
  viewport size and a screenshot of just that element, with typed form
  values and script contents removed.
- **Built on the Recursica design system** (React, TypeScript and the
  Recursica Mantine adapter, with the default Recursica Forge theme), in
  light or dark mode following your operating system.
- **Resizable panel** that remembers its width (drag the left edge, or
  focus it and use the arrow keys), and reviewer identity (name/email)
  that persists across sessions.
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

## Supported screens

Desktop browsers only. The panel is designed for a desktop window and has
no separate small-screen or touch layout.

## Build

    npm run build

Runs lint and the type check, bundles the panel with Vite into a single
`content.js`, and writes browser-specific bundles to `dist/chrome` and
`dist/firefox`. Two manifests are needed because Chrome's MV3 requires a
`service_worker` background and Firefox's MV3 still wants
`background.scripts` — everything else (`background.js`, `content.js`) is
shared, unmodified, between both.

## Development

    npm install
    npm run lint        # ESLint, then the TypeScript type check
    npm run typecheck   # the type check alone
    npm run format

The panel lives in `src/content/` (React + TypeScript). `npm install` also
wires up a Husky pre-commit hook (via `prepare`) that runs Prettier, ESLint
and the type check on staged files. Releases are tracked with
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
