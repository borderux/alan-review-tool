# Snippy

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
- **One Add menu** — the plus button in the panel header offers Comment,
  Screenshot or Element. Each creates a new numbered comment card at the
  top of the list, with focus in its text box.
- **This page only, or every page** — two checkboxes at the end of the
  comment list. "Only view comments for this url" (checked by default) shows
  just the current page's comments; unchecked, it shows every page's,
  grouped under page headings that link to each page. "Show screenshot
  thumbnails" (checked by
  default) can hide the screenshots in the panel (never in the report).
  Both are remembered.
- **Screenshot capture with freehand annotation** — drag-select any region
  of the page, then use Add annotations to draw on it, choosing one of six
  pen colors from a dropdown (red by default; the last choice is
  remembered). Every stroke
  has a thin contrasting outline so it shows on light and dark
  screenshots. Save annotations bakes the drawing into the image.
- **Element capture** — Add, then Element, lets you pick any element on the page,
  like the browser's element inspector (hover and click, or the arrow keys
  and Enter). Snippy records its selector, HTML, key computed styles, the
  viewport size and a screenshot of just that element, with typed form
  values and script contents removed.
- **Built on the Recursica design system** (React, TypeScript and the
  Recursica Mantine adapter, with the default Recursica Forge theme), in
  light or dark mode following your operating system.
- **Resizable panel** (400 to 720 px, 440 by default) that remembers its
  width (drag the left edge, or
  focus it and use the arrow keys). Download comments (with the number
  of comments across every page) asks for the
  reviewer's name, email and session details each time, prefilled with
  the last values used.
- **Exports a single, self-contained HTML report** — header, table of
  contents, one section per page, tight comment list, a link on every
  comment back to its page (to the element itself when it has a simple,
  unique id), thumbnails that keep each image's shape
  with a full-resolution lightbox. The lightbox is pure CSS (`:target`,
  no JavaScript at all); the whole report has zero `<script>` tags.
- **Comments are numbered 1 to N** across the session, in the order they
  were made, with no gaps — deleting one renumbers the rest. Every session
  also gets its own hidden guid, which with a comment's number identifies
  that comment within one report.
- **Asks before anything that can't be undone** — deleting a comment,
  Start over, and in the annotation editor, deleting the screenshot,
  clearing annotations or closing with an unsaved drawing.
- **Recursica versions of the reviewed page** — when a page is built with
  Recursica, the report says so per page, with the Forge theme version
  (when the page's theme stylesheet still carries its header comment), the
  theme mode, and the adapter version if the page exposes one. The report
  header separately lists what Snippy itself was built with.
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

## Extension icon

The toolbar and extension-page icon comes from one source image:

    npm run icons -- path/to/source.png

This writes `src/icons/icon-16.png`, `icon-32.png`, `icon-48.png` and
`icon-128.png`; commit those four files. The script has no dependencies: use
a square PNG of at least 128 px (8 or 16 bits per channel, not interlaced).
Until the icon files exist, `npm run build` warns and builds without an
icon.

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

**Upgrading from the Alan Review Tool:** Snippy has a new Firefox add-on id,
replacing the Alan Review Tool's, so Firefox installs Snippy as a new add-on and any comments stored by the old
version are not carried over. Download a report from the old version first
if you need them. Chrome is not affected: its stored data moves to Snippy
automatically.

1. `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on…" → select `dist/firefox/manifest.json`
3. Visit any site, click the toolbar icon — same panel.
   (Temporary add-ons are removed on restart — expected for a temporary
   add-on; reload it after each Firefox restart during development.)
