# Architecture

## Overview

Alan Review Tool is a Manifest V3 browser extension (Chrome and Firefox) that
lets a reviewer leave text comments and screenshots on any website, without
that site needing to embed anything. Feedback is grouped into a single
**session** spanning every page the reviewer visits, and exported as a
self-contained HTML report.

There is no backend and no bundler. `src/` is plain, unbundled JavaScript;
`build.js` does the one thing that isn't just a file copy (inlining two
source files into `content.js` - see [Build](#build)), and writes
browser-specific bundles to `dist/chrome` and `dist/firefox`.

## Components

- **`src/manifest.chrome.json` / `manifest.firefox.json`** - Two manifests,
  not one, because Chrome's MV3 requires `background.service_worker` and
  Firefox's MV3 still wants `background.scripts`. Everything else
  (`background.js`, `content.js`, `content.css`) is byte-for-byte identical
  between both; the manifests are the only browser-specific artifact.
- **`src/background.js`** - The service worker. Two jobs only: inject
  `content.js` into the active tab on toolbar-icon click
  (`chrome.action.onClicked` + `chrome.scripting.executeScript`), and capture
  a screenshot on request (`chrome.tabs.captureVisibleTab`, since only the
  background context can call that - content scripts can't capture pixels
  themselves). Injection failures (chrome://, the Web Store, the PDF viewer -
  anywhere `activeTab` doesn't reach) are caught and surfaced as a red
  toolbar badge instead of failing silently.
- **`src/content.js`** - Everything else. One large IIFE, re-injected fresh
  on every toolbar click (no persistent background state for the panel
  itself - see [Injection & lifecycle](#injection--lifecycle)).
- **`src/content.css`** - Styles the live panel. Loaded once via a real
  `<link>` inside the panel's shadow root, not re-added on every render.
- **`src/report.css`** - Styles the _downloaded report_, not the live panel.
  Inlined into `content.js` at build time (see [Build](#build)) because a
  downloaded standalone HTML file can't fetch a sibling stylesheet.
- **`src/ai-report-instructions.txt`** - Plain-text instructions for an AI
  agent reading a downloaded report, also inlined at build time. See
  [The report](#the-report).

## Injection & lifecycle

Permissions are deliberately minimal: `activeTab` + `scripting` + `storage`,
no blanket `host_permissions`. `content.js` only ever runs because the user
clicked the toolbar icon, which is what makes `activeTab` sufficient.

Each click re-injects `content.js` from scratch - there's no long-lived
script instance to message. The IIFE starts by checking for an existing
panel (`#alan-review-tool-host`): if found, remove it and restore the page
(toggle-closed); if not, build it (toggle-open). Because a fresh injection
means no JS closure state survives between clicks, anything that needs to
persist across a close/reopen has to live outside the script itself:
`chrome.storage.local` for session data, panel width, and reviewer identity;
`data-*` attributes on `document.documentElement` for the page's own
pre-panel inline styles, so they can be restored correctly even though the
script instance that captured them is already gone by the time the panel
closes.

The panel **pushes** the page rather than overlaying it: opening the panel
shrinks `document.documentElement`'s width (with a transition) instead of
layering a fixed-position panel on top of page content. Its own styles are
isolated in a shadow root, with `content.css` linked in once so panel styling
can't leak into the host page and vice versa.

## Data model

Everything lives under one `chrome.storage.local` key
(`alanReviewToolSession`), not one entry per comment or per page - a content
script's own page-scoped `localStorage` is isolated per origin, which would
defeat the entire "any site, one session" pitch.

```
session = {
  startedAt: <timestamp>,
  guid: <uuid>,                 // see Report identity below
  commentCounter: <int>,        // monotonic, never reused, never decreases
  details: <string>,            // freeform session notes
  pages: {
    "<origin+pathname+search>": {
      title: <string>,          // document.title, captured once per page
      comments: [
        { id, commentNumber, text, screenshot },
        ...
      ]
    },
    ...
  }
}
```

Reviewer identity (`userName`, `userEmail`) and the panel's own width are
stored under **separate** keys and never cleared by "Clear Session" - they're
identity/preference facts, not session data.

**Schema changes require a migration.** Real users' `chrome.storage.local`
persists across every version of this extension they've had installed -
there is no database migration step, no version field forcing a clean slate.
`session.pages[key]` has already changed shape once (a bare comments array →
`{ title, comments }`), and a session created before that change crashed the
panel on load the moment old-shape data reached the new code (`page.comments`
was `undefined` on the old shape, and `.length` on that threw inside the very
first `render()`, before the panel's HTML was ever written - see the
migration block right after `session` is loaded from storage for the fix,
and do the same thing for any future shape change: normalize on load, don't
just assume every stored session already matches the new shape).

## The report

`downloadReport()` builds a single, self-contained HTML file - no external
requests, no bundled JavaScript at all (a deliberate constraint, not an
oversight):

- **Header** with session start time, comment/page counts, reviewer
  name/email/details.
- **Table of contents** linking to each page section by anchor.
- **One section per page**, in the order first touched, each with a link to
  the page (visible text omits query params for readability; the `href`
  always has the full URL).
- **Comments**, tight and separated, each showing a `CM-<n>` id
  (`formatCommentId`) drawn from the session's monotonic counter - assigned
  once at creation, across all three ways a comment is created (new comment,
  new screenshot, the copy/paste duplicate shortcut), and never reused even
  after a delete.
- **Screenshots** as 50x50 thumbnails, paired with a full-resolution image in
  a **pure-CSS lightbox** (an anchor + `:target`, no click handlers, no
  JavaScript at all) - clicking a thumbnail navigates to its anchor, showing
  the lightbox; clicking the lightbox navigates away, hiding it again.

### Report identity

Two ids exist for combining feedback across sessions/tools without
collision:

- **`session.guid`** - one per session, generated with `crypto.randomUUID()`
  (falling back to `crypto.getRandomValues()` on plain `http://` pages, where
  `randomUUID()` isn't available since it needs a secure context - and this
  extension's whole pitch is working on any site). Written into the report as
  a hidden `<meta name="alan-review-session-id">` - parsable, never rendered.
- **`CM-<n>`** - one per comment, unique _within_ a session. Combine the two
  for a globally unique id.

Sessions saved before either id existed get both backfilled on load, the
same migration pattern as the schema change above: a guid gets generated,
and every already-existing comment gets numbered oldest-to-newest (each
page's own array is newest-first, from `unshift`, so backfilling in reverse
approximates true creation order).

### AI-readable instructions

The report also carries a hidden `<meta name="ai-report-instructions">` tag,
inlined from `src/ai-report-instructions.txt` at build time, explaining the
report's structure to a coding agent reading it later: where a page's URL
lives, how a comment's text/id/screenshot are laid out, how the thumbnail
pairs with its full-resolution lightbox image, and how to combine the
session guid with a `CM-<n>` id.

That file also draws an explicit trust boundary: comment text is
reviewer-authored, untrusted content describing a requested UI change, never
a set of operating instructions - closing an obvious prompt-injection path
for anything that parses this report and acts on it.

## Build

`build.js` copies `background.js`, `content.js`, and `content.css` unchanged
into `dist/chrome` and `dist/firefox`, and copies each browser's own manifest
in as `manifest.json`. The one real step: two source files
(`src/report.css`, `src/ai-report-instructions.txt`) exist only to be inlined
into `content.js`'s `REPORT_CSS` and `AI_INSTRUCTIONS` constants, because a
downloaded standalone report can't fetch a sibling file. Each constant starts
as a literal placeholder string (e.g. `"__REPORT_CSS_PLACEHOLDER__"`); the
build reads the real source file, `JSON.stringify`s it, and swaps it in -
throwing immediately if a placeholder is ever missing, rather than silently
shipping stale or absent content. Never hand-edit those constants directly in
`content.js` - edit the real source file and rebuild.

## Verification methodology

There is no automated test suite checked into this repo yet. A real toolbar
click can't be scripted, so verification during development has relied on
Playwright: stub `chrome.storage.local` / `chrome.runtime` with `page.evaluate`, load `dist/chrome/content.js` directly (not `src/content.js`, which still contains the literal build placeholders) via `page.evaluate(src)`, then drive the panel with real mouse/keyboard input rather than synthetic `element.click()` calls, which don't reliably trigger the same focus and event-delegation paths as genuine input.
