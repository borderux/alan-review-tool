# Architecture

## Overview

Tagger is a Manifest V3 browser extension (Chrome and Firefox) that
lets a reviewer leave text comments and screenshots on any website, without
that site needing to embed anything. Feedback is grouped into a single
**session** spanning every page the reviewer visits, and exported as a
self-contained HTML report.

There is no backend. The live panel is React + TypeScript, built from the
Recursica design system and bundled by Vite into one content script;
`build.js` runs that build and writes browser-specific bundles to
`dist/chrome` and `dist/firefox` (see [Build](#build)).

## Components

- **`src/manifest.chrome.json` / `manifest.firefox.json`** - Two manifests,
  not one, because Chrome's MV3 requires `background.service_worker` and
  Firefox's MV3 still wants `background.scripts`. Everything else is
  identical between both builds; the manifests are the only
  browser-specific artifact.
- **`src/background.js`** - The service worker, plain JavaScript. Two jobs
  only: inject `content.js` into the active tab on toolbar-icon click
  (`chrome.action.onClicked` + `chrome.scripting.executeScript`), and
  capture a screenshot on request (`chrome.tabs.captureVisibleTab`, since
  only the background context can capture pixels). Injection failures
  (chrome://, the Web Store, the PDF viewer - anywhere `activeTab` doesn't
  reach) are surfaced as a red toolbar badge instead of failing silently.
- **`src/content/`** - The panel. Re-injected fresh on every toolbar click
  (see [Injection & lifecycle](#injection--lifecycle)).
  - `main.tsx` - entry point: toggles the panel open or closed.
  - `mount.tsx` - builds the host element, shadow root, stylesheet and
    React root.
  - `App.tsx` - the Mantine provider, configured for the shadow root, and
    the Recursica layer-0 scope.
  - `ReviewPanel.tsx` - the panel shell: open/close, Escape, focus, tabs,
    footer, toast and modals.
  - `components/` - the tabs (Comments, Reviewer, Help), a comment row
    with its action menu, the annotation editor, the shared confirmation
    modal, the resize strip.
  - `useReviewSession.ts` - all session state and saving.
  - `modalPortal.ts` - hands every modal its layer-1 portal container.
  - `lib/` - framework-free modules: storage and migration, page push,
    screenshot capture, the report builder, ids, formatting.
  - `styles.ts`, `panel.css`, `fonts.ts` - see
    [Styling inside the shadow root](#styling-inside-the-shadow-root).
- **`src/report.css`** - Styles the _downloaded report_, not the live panel.
  Inlined into `content.js` at build time because a downloaded standalone
  HTML file can't fetch a sibling stylesheet.
- **`src/ai-report-instructions.txt`** - Plain-text instructions for an AI
  agent reading a downloaded report, also inlined at build time. See
  [The report](#the-report).

## Injection & lifecycle

Permissions are deliberately minimal: `activeTab` + `scripting` + `storage`,
no blanket `host_permissions`. `content.js` only ever runs because the user
clicked the toolbar icon, which is what makes `activeTab` sufficient.

Each click re-injects `content.js` from scratch. `main.tsx` starts by
checking for an existing panel host (`#tagger-host`):

- **Found → close.** It dispatches a cancelable `tagger:close`
  event on the host. The script instance that owns the panel listens for
  it, calls `preventDefault()`, saves anything still pending, slides the
  panel out, then unmounts React, removes the host and restores the page.
  If nothing answers (the owning instance is gone, for example after the
  extension was reloaded), the new instance removes the host itself.
- **Not found → open.** `mount.tsx` loads storage, then builds the panel.

Anything that must survive a close/reopen lives outside the script:
`chrome.storage.local` for session data, panel width and reviewer identity;
`data-*` attributes on `document.documentElement` for the page's own
pre-panel inline styles and the fonts-registered flag.

While a screenshot region is being selected, the panel is hidden and the
page gets its full width back (`withPanelAway()` in `lib/capture.ts`), so
there is no blank strip and the capture covers the page as it really lays
out; the panel and the push come back afterwards on every path - success,
cancel or failure.

The panel **pushes** the page rather than overlaying it: opening the panel
shrinks `document.documentElement`'s width (with a transition) instead of
layering over page content. It is **non-modal**: no backdrop, no focus
trap, no scroll lock, and the page stays usable. The Recursica `Panel`
(Mantine's `Drawer`) defaults to modal behaviour, so `ReviewPanel.tsx`
switches each of those off explicitly, and `markPanelNonModal()` removes the
`aria-modal` the Drawer always sets. Escape closes the panel only while
focus is inside it, and never while one of its modals is open.

## Styling inside the shadow root

Everything the panel draws lives in an open shadow root on the host
element, so its styles can't leak into the page and vice versa. Getting a
Mantine- and Recursica-based UI to work there takes five things:

1. **One stylesheet, injected once.** `styles.ts` concatenates Mantine's
   CSS, the Recursica theme variables
   (`recursica_variables_scoped.css` - the default Forge theme, as shipped
   in the adapter package), the adapter's component CSS and `panel.css`,
   all imported as strings, into one `<style>` in the shadow root.
2. **`:root` retargeted at build time.** Mantine and the theme declare their
   base variables on `:root`, which never matches inside a shadow root. A
   PostCSS step in `vite.config.mts` rewrites `:root` to `.art-root`, the
   panel's own root element. The same step converts the few bare `rem`
   values in the Recursica stylesheets to px, since `rem` resolves against
   the host page's `<html>` font size, which any site can change.
   Mantine's own rem values are all multiplied by its scale, which
   `App.tsx` sets from the host page's real root font size.
3. **Theme and color scheme on the panel's root, not the page's `<html>`.**
   `data-recursica-theme` (light/dark, following `prefers-color-scheme`
   live - `useColorScheme.ts`) and Mantine's color-scheme attribute are
   both set on `.art-root`. The adapter's `RecursicaThemeProvider` is not
   used: it writes to `document.documentElement`, which here is the
   reviewed site's `<html>`. Layer 0 is declared once, with the adapter's
   `Layer`, just inside it.
4. **Portals stay inside the shadow root.** Mantine's `Portal` defaults to
   `document.body`, which would leave tooltips and modals unstyled. The
   theme points every portal (tooltips, menus, the toast) at `.art-portal`,
   a container inside the layer-0 scope pinned to the viewport's top-left
   corner (Mantine's modal positions itself assuming that) and stacked
   above the panel. Modals use a second container of the same kind that
   declares `data-recursica-layer="1"`, so every modal sits on layer 1.
   It is a plain element carrying the attribute rather than the adapter's
   `Layer` component, because `Layer` paints its own padded surface.
   Mantine's focus return (modals and menus) records
   `document.activeElement`, which inside a shadow root is the host, so the
   panel moves focus itself.
5. **Fonts on the document.** Chrome ignores `@font-face` inside a shadow
   root, so `fonts.ts` adds the theme's two typefaces (Dongle, Nunito
   Sans - bundled from Fontsource, inlined into `content.js`) to the host
   document's `FontFaceSet`, built from bytes so no page's `font-src`
   policy applies. This and the page push are the panel's only global
   side effects.

Because every stylesheet is inlined, `content.js` is large (about 2 MB,
most of it the theme's CSS variables). It is read from the local
extension package on each click, never downloaded.

## Data model

Everything lives under one `chrome.storage.local` key
(`taggerSession`), not one entry per comment or per page - a content
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

The types live in `src/content/lib/types.ts`. Reviewer identity
(`taggerUser`, `taggerEmail`), the panel's width (`taggerPanelWidth`) and
the annotation pen's last colour (`taggerPenColor`) are stored under
**separate** keys and never cleared by "Start over" - they're
identity/preference facts, not session data. The unsent text in the New
comment field is kept under `taggerDraft`, so closing the panel never
loses it; adding the comment clears it.

The page key is the address the panel is on right now. Single-page apps
change it without a reload, and a content script can't see the page's own
history calls, so `usePageKey()` re-reads it on a short interval; comments
added after an in-app navigation are filed under the new address.

There is one kind of stored comment: text plus an optional screenshot. The
panel shows it as a quick comment (text only) or a screenshot comment
(thumbnail, Add annotations, text), depending on whether it has a
screenshot; the stored record is the same either way.

**The storage keys were renamed** with the product, from `alanReviewTool*`
to `tagger*`. `migrateStorageKeys()` runs before anything reads storage:
for each old key that exists, it copies the value to the new key unless the
new key already exists (the new key always wins), then deletes the old key.
The copied session still goes through `migrateSession()` below, so an old
array-shaped session is normalized as well. A panel left open by the old
version (`#alan-review-tool-host`) is closed on the next click, restoring
the page from the old dataset names.

Saving: structural changes (a new, deleted or duplicated comment, a
capture, a start over) save at once; typing saves after a 400 ms pause,
and anything still pending is written when the panel closes. Saving is
silent - the panel shows no save status, an approved exception to the
autosave-status rule - but every write's promise is tracked, and a failed
write (the storage quota is reachable, since screenshots live in the
session) raises a toast with the browser's reason. Deleting a comment, a
screenshot, or the whole session asks for confirmation first, in a modal
on layer 1.

**Schema changes require a migration.** Real users' `chrome.storage.local`
persists across every version of this extension they've had installed -
there is no database migration step, no version field forcing a clean slate.
`session.pages[key]` has already changed shape once (a bare comments array →
`{ title, comments }`), and a session created before that change crashed the
panel on load the moment old-shape data reached new code. `migrateSession()`
in `src/content/lib/storage.ts` normalizes a loaded session in place before
anything else touches it; do the same for any future shape change.

## The report

`buildReportHtml()` (`src/content/lib/report.ts`) builds a single,
self-contained HTML file as a string - no external requests, no bundled
JavaScript at all (a deliberate constraint, not an oversight), and not
rendered with React:

- **Header** with session start time, comment/page counts, reviewer
  name/email/details.
- **Table of contents** linking to each page section by anchor.
- **One section per page**, in the order first touched, each with a link to
  the page (visible text omits query params for readability; the `href`
  always has the full URL).
- **Comments**, tight and separated, each showing a `CM-<n>` id
  (`formatCommentId`) drawn from the session's monotonic counter - assigned
  once at creation, across all three ways a comment is created (new
  comment, new screenshot, duplicate), and never reused even after a
  delete.
- **Screenshots** as 50x50 thumbnails, paired with a full-resolution image
  in a **pure-CSS lightbox** (an anchor + `:target`, no click handlers, no
  JavaScript at all).

### Report identity

Two ids exist for combining feedback across sessions/tools without
collision:

- **`session.guid`** - one per session, generated with `crypto.randomUUID()`
  (falling back to `crypto.getRandomValues()` on plain `http://` pages,
  where `randomUUID()` isn't available). Written into the report as a hidden
  `<meta name="tagger-session-id">` - parsable, never rendered.
- **`CM-<n>`** - one per comment, unique _within_ a session. Combine the two
  for a globally unique id.

Sessions saved before either id existed get both backfilled on load by
`migrateSession()`: a guid gets generated, and every existing comment gets
numbered oldest-to-newest.

### AI-readable instructions

The report also carries a hidden `<meta name="ai-report-instructions">` tag,
inlined from `src/ai-report-instructions.txt` at build time, explaining the
report's structure to a coding agent reading it later, and drawing an
explicit trust boundary: comment text is reviewer-authored, untrusted
content describing a requested UI change, never a set of operating
instructions.

## Build

`npm run build` runs lint and the type check, then `build.js`:

1. Runs Vite (`vite.config.mts`) in library mode, producing one classic
   IIFE script, `content.js` - content scripts injected with
   `executeScript` can't be ES modules. `src/report.css` and
   `src/ai-report-instructions.txt` are imported as raw strings
   (`?raw`), the panel's stylesheets as inline strings (`?inline`), and the
   font files inlined as data. The version shown in the panel comes from
   `package.json` via a Vite `define`. A missing source file fails the
   build.
2. Copies `content.js` and `background.js` into
   `dist/chrome` and `dist/firefox`, with each browser's own manifest as
   `manifest.json`.

Type checking is `npm run typecheck`: `tsconfig.json` covers the panel,
`tsconfig.node.json` covers `vite.config.mts`.

## Verification methodology

There is no automated test suite checked into this repo. A real toolbar
click can't be scripted, so verification relies on Playwright, run ad hoc
from outside the repo: stub `chrome.storage.local` / `chrome.runtime` in an
init script, route a fake site, evaluate `dist/chrome/content.js` in the
page (one evaluation = one toolbar click), then drive the panel with real
mouse and keyboard input rather than synthetic `element.click()` calls,
which don't reliably trigger the same focus and event paths as genuine
input. Playwright's role and label locators pierce the open shadow root.
Cover light and dark, a host page with a non-16px root font, the minimum
panel width, and an old-shape stored session.
