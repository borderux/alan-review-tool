# Architecture

## Overview

Snippy is a Manifest V3 browser extension (Chrome and Firefox) that
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
  - `ReviewPanel.tsx` - the panel shell: open/close, Escape, focus, the
    footer (Start over, Download report (all n comments), which wraps onto two lines below about 470 px), toast and modals, and the
    failed-load state (storage could not be read: the panel opens empty,
    Add disabled, with a message in its body).
  - `components/` - the one view (`CommentList`: the current page's
    comments, or every page's grouped under page headings, each heading a
    link to its page, in the same tab), the view
    options (`ViewOptions`: a checkbox group, "Only view comments for this
    url" and "Show screenshot thumbnails", at the very end of the
    scrolling list, after the last card), the Add menu (`AddMenu`: a small icon-only plus button in
    the panel header, left of the title, rendered into a slot placed first
    in the header - Comment, Screenshot, Element; the menu is
    rendered into slots placed in the header, see Adapter workarounds), a
    comment card
    (`CommentItem`, the kit's Card) with Duplicate and Delete buttons and,
    when it has no screenshot, a solid Add screenshot button, the download
    modal (reviewer name, email and session details, every time comments
    are downloaded), the annotation editor (a fixed toolbar with the pen
    color dropdown and Clear annotations above a bordered, scrolling image
    area; its own confirmations - discard drawing, clear annotations,
    delete screenshot - stack on it), the shared confirmation modal, the
    resize strip,
    and `useManagedMenu` (menu focus handling that works in a shadow root).
  - `useReviewSession.ts` - all session state and saving.
  - `modalPortal.ts` - hands every modal its layer-1 portal container.
  - `lib/` - framework-free modules: storage and migration, page push,
    comment and page links (`links.ts`),
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

Permissions are deliberately minimal: `activeTab`, `scripting`, `storage`
and `unlimitedStorage`, with no blanket `host_permissions`. `content.js` only ever
runs because the user clicked the toolbar icon, which is what makes
`activeTab` sufficient. `unlimitedStorage` lifts the 10 MB
`chrome.storage.local` quota: screenshots and captured element HTML live in
the session, and a long review would otherwise fill it.

The Firefox add-on id is `snippy@borderux.com`. The shipped Alan Review
Tool used `alan-review-tool@borderux.com`; Firefox keys an add-on's storage
by that id, so Snippy installs as a new add-on and existing Firefox users
start with no stored data (an accepted consequence of the rename). The
interim name Tagger (`tagger@borderux.com`) never shipped. The storage-key
migration still matters on Chrome, where the extension's id does not
change and old-key data carries over.

Each click re-injects `content.js` from scratch. `main.tsx` starts by
checking for an existing panel host (`#snippy-host`):

- **Found → close.** It dispatches a cancelable `snippy:close`
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

Both capture modes mark themselves with a 2px dashed frame around the whole
viewport (`lib/captureFrame.ts`): a black line under white dashes, so it
shows on light and dark pages, fixed inside the viewport, ignoring the
pointer and never affecting layout. There is no tint over the page, and the
region-selection rectangle is an edge with no fill, so what is being
captured stays fully visible. The frame and every other overlay element are
removed before pixels are taken.

Element picking (`lib/element.ts`) is a second hand-built overlay in the
host page, under the same conditions: the mouse highlights the element
under it and a click chooses; arrow up and down move to the parent and
first child, Enter chooses, Escape cancels. The page's own handlers never
see those clicks and keys. Open shadow roots are followed; closed ones stop
at their host. Frames are never entered - a transparent blocker covers each
one while picking, and choosing one says its content can't be captured.

While a screenshot region is being selected, the panel is hidden and the
page gets its full width back (`withPanelAway()` in `lib/capture.ts`), so
there is no blank strip and the capture covers the page as it really lays
out; the panel and the push come back afterwards on every path - success,
cancel or failure.

While any modal is open, the host page's `<body>` and the panel content
are made `inert` (prior values restored), so only the modal is reachable.
Escape that starts inside a modal or a menu is never treated as closing the
panel: Mantine closes its modal in a capture listener on `window`, before
React's handler runs, so the panel checks where the key came from rather
than trusting its own modal state. When the panel closes, whatever had
focus on the page before it opened gets focus back. Pending typing is
written on `pagehide` and when the page is hidden, so a refresh never loses
it.

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

## Adapter workarounds

Owner policy: when the adapter or theme misbehaves, that is an adapter bug,
and the UI shows the adapter's real behaviour. A workaround stays only if
the panel is **(A)** forced to it by running in a shadow root on someone
else's page, or **(B)** would otherwise be unusable, inaccessible, or break
a MUST rule in the Recursica skills. Everything purely cosmetic of our own
**(C)** uses kit props and tokens or goes. Each kept item is reported to the
adapter. Audited in round 10; keep this list current.

Kept, (A) shadow root / someone else's page:

- `vite.config.mts` `shadowScope` - `:root` rewritten to `.art-root`: theme and Mantine variables never match inside a shadow root. Ask: ship the theme scoped to a selector the consumer chooses.
- `vite.config.mts` `shadowScope` - bare `rem` in the adapter and theme CSS converted to px: `rem` follows the host page's root font. Ask: no bare `rem`, or scale it like Mantine does.
- `App.tsx` `scale: pageRemScale()` - Mantine's scale set from the host's root font, for the same reason.
- `App.tsx` `cssVariablesSelector`, `getRootElement`; `mount.tsx`/`useColorScheme.ts` `data-recursica-theme` on the panel root - `RecursicaThemeProvider` writes to the host's `<html>`. Ask: a provider that targets a given element.
- `App.tsx` `Portal.extend` target, `panel.css` `.art-portal` - portals must stay inside the shadow root, and Mantine's modal assumes a viewport-pinned container. Ask: a documented portal target on every overlay component.
- `mount.tsx` modal portal with `data-recursica-layer="1"` - every modal sits on layer 1; the adapter's `Layer` paints a padded surface, so a plain element carries the attribute. Ask: Modal should set its own layer, or `Layer` should have a surface-less mode.
- `AnnotationEditor.tsx` `comboboxProps.portalProps` - the pen list renders with the modal (layer 1), not in the inert layer-0 portal. Follows from the two above.
- `ReviewPanel.tsx` `withinPortal={false}`, `returnFocus={false}` on Panel and modals, and `returnFocus()` - Mantine records `document.activeElement`, which is the shadow host. Ask: focus return that works in a shadow root.
- `useManagedMenu.ts` - menu focus into the first item and back to the trigger, done by hand for the same reason; Tab closes the menu.
- `fonts.ts` - the theme's typefaces added to `document.fonts` from bytes: `@font-face` is ignored in a shadow root and a page's CSP can block font requests. Ask: document this for embedded use.
- `mount.tsx` host element inline styles (`all: initial`, fixed, top z-index) - isolates the panel from the host page's CSS.
- `panel.css` `.art-root` font-family - the shadow tree inherits `all: initial`, so the base font comes from the brand token.
- `vite.config.mts` `process.env.NODE_ENV` define - the adapter reads `process` at runtime; a content script has none. Ask: no runtime `process` access.
- `lib/capture.ts`, `lib/element.ts`, `lib/captureFrame.ts` overlay inline styles and colours - they live in the host page's light DOM, where no token reaches (approved hand-built surface).

Kept, (B) adapter defect or gap that would otherwise break a MUST rule, accessibility or usability:

- `ReviewPanel.tsx` Panel `withOverlay`, `trapFocus`, `lockScroll`, `closeOnEscape`, `closeOnClickOutside` all false - the adapter's Panel keeps Mantine Drawer's modal defaults; the panel rules say a panel is never modal (MUST).
- `lib/page.ts` `markPanelNonModal` - Panel always renders `role="dialog" aria-modal="true"`, which hides the live page from screen readers.
- `lib/page.ts` `makeBehindModalInert`, `AnnotationEditor.tsx` editor made inert under its questions - "everything behind the modal must be inert" (MUST); inside a shadow root Mantine's modal doesn't do it.
- `ReviewPanel.tsx` Escape handler judged by `event.target`, `AnnotationEditor.tsx` `closeOnEscape` toggled - every open Mantine modal closes on any Escape (a window listener), so Escape in the pen list or on a stacked question would throw the drawing away.
- `App.tsx` `Tooltip.extend` focus events - tooltips must show on keyboard focus (MUST); the adapter keeps Mantine's hover-only default.
- `ReviewPanel.tsx` toast live region wrapper and `role="group"` on Toast - the live region must exist before the message (MUST); the Toast's own role would announce twice.
- `ReviewPanel.tsx` header slot (`.art-header-slot`) for Add - Panel has no header actions slot, and its compound parts carry none of its styling; a button inside the title would rename the panel "Add Snippy".
- `ReviewPanel.tsx` `overStyled` + `size` on Panel, `ResizeHandle.tsx`, `panel.css` `.art-resizer` - Panel has no width or resize option; the owner requires a 400-720 px resizable panel, default 440.
- `vite.config.mts` theme CSS alias - `recursica_variables_scoped.css` is not in the package's `exports`; without the alias the build can't import it.

Kept, our own elements that no component covers (tokens only, owner-requested):

- `panel.css` `.art-shot-frame` (the bordered frame around a comment's image; no image component), `.art-thumb` (image scales to the frame), `.art-shot-well` / `.art-shot-scroll` (the editor's bordered, scrolling image area), `.art-shot` canvases (drawing), `.art-swatch` (pen colours are baked into screenshots, so fixed), `.art-sr-only` (no visually-hidden utility), `.art-list` (reset for the list semantics a card set needs).

Owner-approved exceptions, not adapter bugs (rounds 13 and 16):

- `panel.css` token remap block also sets `--recursica_ui-kit_components_textarea_properties_rows` (Forge: 4) to 1, so every text box starts at one row and grows and shrinks with its text (with the kit's `autosize`). Gap: "TextArea should allow rows/min-height to be set by the consumer."
- `AnnotationEditor.tsx` a flexible spacer in `Modal.Footer` (`<Group flex={1} aria-hidden />`) puts the rarely used Delete screenshot at the bottom left, apart from Cancel and Save (re-added in round 16). Gap: "Modal.Footer has no slot for a rarely used action on the left."
- Several solid buttons on one surface: the header Add, a card's Add screenshot, and Download report.
- A comment is never deleted for being blank; only Delete (with its confirmation) removes one. Blank comments count, and are in the report.
- The footer's label "Download report (all n comments)" names the whole report, not just the comments showing.

- `panel.css` token remap block on `.art-root` - owner-requested token remap. The panel body's content padding (`--recursica_ui-kit_components_panel_properties_content-horizontal-padding`, 24 px, and `...content-vertical-padding`, 16 px) and the card padding (`--recursica_ui-kit_components_card_properties_padding`, 24 px) are re-pointed to the brand's general default dimension (`--recursica_brand_dimensions_general_default`, 8 px; round 13 used general small, 4 px, which the owner found too tight); the card radius for layer 0 (`--recursica_ui-kit_modes_light_layer_0_components_card_properties_borders_border-radius` and the `dark` twin, 24 px via the brand's layer-1 radius) is set to 12 px, which no theme radius token equals. No element is styled; only these token values change. Their proper home is the Forge theme's ui-kit values; remove the block once Forge carries them.
- `panel.css` `text-box: trim-both cap alphabetic` on the panel title and the card number headings, inside `@supports (text-box-trim: trim-both)` - owner-suggested fix for the theme's heading line-box bug: the header type (Dongle at 56 px, 39.2 px line height) puts the glyphs off the centre of their line box. Trimmed, the title's cap height centres on Add and Close within 0.5 px (was 4.6 px high) and a card number on its buttons within 1 px (was 4.8 px). The header gets 4 px shorter (64 to 60 px) and the number row 1.6 px shorter; descenders still show. Firefox doesn't support it yet and shows the theme's own line box.

Adapter gaps with no workaround (the UI shows the kit's real behaviour):

- `Card` and `Panel` have no size or density option and strip padding props (now remapped at token level above, by owner request).
- `Link` applies its own text style, so a page title that is a link inside a heading shows at the link's size, not the heading's.

Removed in rounds 10 and 11 (the UI now shows the adapter's real behaviour):

- `.art-toast-anchor` - the toast's hand-set bottom-left position. The kit's Toast has no placement, so the toast now shows at the top-left of the viewport.
- `.art-thumb` 320 px height cap - a tall screenshot now shows at full height.
- `maw={560}` on the confirmation text - the text now runs the modal's full width.
- The footer's wrap wrapper (`ml="auto"`) - not needed at the 400 px minimum.
- The switch row's slot and styles (round 10), then the View menu and its `menuitemcheckbox` role fix (round 11: the view options became checkboxes in the kit's pinned footer, which needs no workaround).

## Data model

Everything lives under one `chrome.storage.local` key
(`snippySession`), not one entry per comment or per page - a content
script's own page-scoped `localStorage` is isolated per origin, which would
defeat the entire "any site, one session" pitch.

```
session = {
  startedAt: <timestamp>,
  guid: <uuid>,                 // see Report identity below
  commentCounter: <int>,        // the number of comments, N (see below)
  details: <string>,            // freeform session notes
  pages: {
    "<origin+pathname+search>": {
      title: <string>,          // document.title, captured once per page
      recursica?: {             // see "Recursica detection" below
        recursica, themeMode?, layers?,
        forgeVersion?, transformVersion?, adapterVersion?
      },
      comments: [
        { id, commentNumber, text, screenshot, element? },
        ...
      ]
    },
    ...
  }
}
```

The types live in `src/content/lib/types.ts`. Reviewer identity
(`snippyUser`, `snippyEmail`), the panel's width (`snippyPanelWidth`) and
the annotation pen's last colour (`snippyPenColor`) and the two view
checkboxes (`snippyPageOnly`, `snippyShowImages`, both on unless stored as
`false`) are stored under **separate** keys and never cleared by "Start
over" - they're
identity/preference facts, not session data. The download modal edits
them (and the session's details) each time a report is downloaded. An old
`snippyDraft` / `taggerDraft` key, from when the panel had a New comment
field, is deleted on load.

The page key is the address the panel is on right now. Single-page apps
change it without a reload, and a content script can't see the page's own
history calls, so `usePageKey()` re-reads it on a short interval; comments
added after an in-app navigation are filed under the new address.

A screenshot may carry `screenshotScale`, the device pixel ratio it was captured at (added in round 16; optional, and dropped on load if it isn't a plausible ratio). The panel shows an image at no more than its natural size (its pixels divided by that ratio, or the current ratio for older comments), centred, and scales a larger one down to the frame.

There is one kind of stored comment: text plus an optional screenshot, and
an optional `element`. The panel shows it as a quick comment (text only), a
screenshot comment (thumbnail, Add annotations, text), or an element
comment (the same, plus the element's selector), depending on what it has;
the stored record is the same either way.

`element` (added with element capture, `CapturedElement` in
`lib/types.ts`) is what Add element records, like the browser's element
inspector: a CSS selector path (crossing an open shadow root is written
`>>>`), the element's HTML with its descendants, a compact set of 48
computed style properties, and the viewport size; its `screenshot` is the
element cropped from the page. Everything in it is copied from someone
else's page, so it is untrusted: it is escaped wherever it is shown. Before
it is stored, form values, textarea text, select choices, editable content,
password values, script contents and inline event handlers are removed. The
HTML is capped at 50,000 characters and the styles at 8,000; anything cut
is flagged, and the panel and the report say so. The field is optional, so
older sessions load unchanged; `migrateSession()` drops a malformed one.

**The storage keys were renamed** with the product, twice: the shipped
`alanReviewTool*` keys, then `tagger*` (an interim name used only on the
development branch), now `snippy*`. `migrateStorageKeys()` runs before
anything reads storage: for each `snippy*` key that is missing, it takes the
value from the `tagger*` key, else from the `alanReviewTool*` key; then it
deletes every older key. An existing `snippy*` key always wins, so running
it twice never overwrites newer data. The copied session still goes through
`migrateSession()` below, so an old array-shaped session is normalized as
well. A panel left open by an older version (`#tagger-host` or
`#alan-review-tool-host`) is closed on the next click, restoring the page
from that version's dataset names.

Saving: structural changes (a new, deleted or duplicated comment, a
capture, a start over) save at once; typing saves after a 400 ms pause,
and anything still pending is written when the panel closes. Saving is
silent - the panel shows no save status, an approved exception to the
autosave-status rule - but every write's promise is tracked, and a failed
write (rarer now that `unlimitedStorage` lifts the quota, but a write can
still fail) raises a toast with the browser's reason. Every action that
can't be undone asks first, in a modal on layer 1 (owner rule): deleting a
comment or the whole session, and in the annotation editor, deleting the
screenshot, clearing annotations, and closing with an unsaved drawing. The
editor's confirmations stack on the editor, so Cancel returns to the
drawing untouched.

If storage can't be read at all, `mountPanel()` opens the panel anyway with
`FAILED_LOAD_STATE`: nothing loaded, Add disabled, and a message in the
panel body. With Add disabled no session can start, so the session that
could not be read is never written over. No retry; the next toolbar click
tries again.

**Comment numbers are positions.** Every comment in the session is
numbered 1 to N, across all pages, in creation order, with no gaps, and
`commentCounter` is N. A new comment is N + 1; deleting one renumbers the
rest (`renumberComments()` in `lib/storage.ts`), so a deleted number is not
kept back. Sessions saved when numbers were never reused can have gaps, so
`migrateSession()` renumbers on load, in the order of the old numbers
(which was creation order). The stored shape is unchanged.

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
  name/email/details. The page has `lang="en"` and a viewport meta tag, and
  thumbnails keep each image's shape (at most 64 px tall, never cropped), so
  wide element strips and tall crops stay recognisable.
- **Table of contents** linking to each page section by anchor.
- **One section per page**, in the order first touched, each with a link to
  the page (visible text omits query params for readability; the `href`
  always has the full URL).
- **Comments** in ascending number order within each page (the panel
  stores and shows them newest first), each labelled "Comment <n>" with the
  plain number in `data-comment-id`. The number is the comment's position,
  1 to N across the session in creation order (see the Data model), so
  it can change when an earlier comment is deleted.
  `formatCommentId` and `commentName` in `lib/ids.ts` are the one place a
  number becomes text, in the panel and the report alike. (Reports from
  before this wrote it as `CM-<n>`.)
- **A link per comment**, in `p.comment-link`, back to the comment's own
  page (full `href`; short, muted visible text: the page's path, plus the
  `#id` for an element), so a comment
  read on its own still says where it came from. An element comment links
  to `#<id>` on that page only when its element had a simple, unique id at
  capture time: `elementFragmentId()` in `lib/links.ts` accepts only a
  selector that is exactly `#<id>` (which `selectorFor` writes only for an
  id unique in the document, never inside a shadow root) with a plain id
  that the captured HTML's own `id` matches. No fragment is ever made from
  class names or paths. Only http, https and file addresses become links.
- **Element comments** also show the captured element under a visible
  "Element" label (`p.element-label`): its selector and
  viewport, then its HTML and styles in collapsible `<details>` sections
  (no JavaScript needed), all escaped.
- **Screenshots** as 50x50 thumbnails, paired with a full-resolution image
  in a **pure-CSS lightbox** (an anchor + `:target`, no click handlers, no
  JavaScript at all).

### Recursica detection

A session spans many pages and sites, so each page records whether the page
being reviewed is built with Recursica, and which versions
(`lib/recursica.ts`). It runs in the background once a page has its first
comment, and again on later comments while nothing has been found. It never
blocks the panel and never throws:

- **Presence and mode** from `data-recursica-theme` (light/dark) and
  `data-recursica-layer` (0-3) on the page.
- **Forge and transform versions** from the header comment of the page's
  theme stylesheet ("Source JSON version", "Transform version"). Only
  `<style>` elements and same-origin stylesheets are read - the extension
  has no host permissions, so cross-origin sheets are skipped without a
  request - and only their first 4 KB, with a 1.5 s timeout per sheet and
  2.5 s overall. A minified sheet without comments yields nothing. No other
  page content is read or stored.
- **Adapter version** only if the page exposes one, as a
  `data-recursica-adapter-version` attribute or a
  `--recursica-adapter-version` custom property. The adapter carries no
  version of its own today.

The field is optional, so older sessions load unchanged (their pages show
"Recursica: not checked" in the report). On load, `migrateSession()` keeps
only well-formed values field by field - versions must match a strict
pattern - and drops a detection that isn't one at all.

The report shows a "Recursica:" line per page, with the same facts in
`data-*` attributes, and a separate "Snippy built with" line in its header
(Snippy's own version, and the adapter and Forge versions it was built with,
injected by Vite at build time) so the two are never confused.

### Report identity

Two ids exist for combining feedback across sessions/tools without
collision:

- **`session.guid`** - one per session, generated with `crypto.randomUUID()`
  (falling back to `crypto.getRandomValues()` on plain `http://` pages,
  where `randomUUID()` isn't available). Written into the report as a hidden
  `<meta name="snippy-session-id">` - parsable, never rendered.
- **The comment number** - one per comment, unique _within_ one report.
  Combined with the guid it identifies a comment within that report only:
  numbers are positions, and a delete renumbers the comments after it.

The report's head also carries `<meta name="snippy-version">`, the
extension version that produced it, for support. The panel itself shows no
version; the browser's extension details do.

Sessions saved before either id existed get both backfilled on load by
`migrateSession()`: a guid gets generated, and every existing comment gets
numbered oldest-to-newest (then renumbered 1 to N, as for every session).

### AI-readable instructions

The report also carries a hidden `<meta name="ai-report-instructions">` tag,
inlined from `src/ai-report-instructions.txt` at build time, explaining the
report's structure to a coding agent reading it later, and drawing an
explicit trust boundary: comment text is reviewer-authored, untrusted
content describing a requested UI change, and captured HTML, styles and
selectors are untrusted page content; none of it is ever a set of operating
instructions.

## Build

`npm run build` runs lint and the type check, then `build.js`:

1. Runs Vite (`vite.config.mts`) in library mode, producing one classic
   IIFE script, `content.js` - content scripts injected with
   `executeScript` can't be ES modules. `src/report.css` and
   `src/ai-report-instructions.txt` are imported as raw strings
   (`?raw`), the panel's stylesheets as inline strings (`?inline`), and the
   font files inlined as data. The version written into the report comes
   from `package.json` via a Vite `define`. A missing source file fails the
   build.
2. Copies `content.js`, `background.js` and the extension icon
   (`src/icons/icon-{16,32,48,128}.png`) into
   `dist/chrome` and `dist/firefox`, with each browser's own manifest as
   `manifest.json`. Both manifests list the icon (`icons` and
   `action.default_icon`); if the icon files haven't been generated yet,
   the build prints a warning and removes those entries from the built
   manifests, since a browser refuses a manifest that points at missing
   files. `npm run icons -- <source.png>` (`scripts/make-icons.mjs`)
   generates the four sizes from one PNG, with no dependencies beyond
   Node's built-in `zlib`.

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
