# AGENTS.md

This document is for AI agents making changes to this codebase.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before planning or making any
change.** It describes the injection/lifecycle model, the storage data
model, the report format, and the build's file-inlining mechanism - assume
none of that is obvious from a local diff alone.

## RULES

- This is intentionally plain, unbundled JavaScript - no TypeScript, no
  React or any other framework, no bundler for `content.js`/`background.js`
  themselves. Don't introduce one without being asked; MV3 content scripts
  are shipped as literal files, and this project's whole build step exists
  only to inline two text files into `content.js` (see below), not to
  compile anything
- `content.js` contains two constants that start as literal placeholder
  strings (`REPORT_CSS`, `AI_INSTRUCTIONS`) - never hand-edit those strings
  directly. Edit `src/report.css` or `src/ai-report-instructions.txt` and
  run `npm run build`; `build.js` throws immediately if a placeholder ever
  goes missing, so a broken inlining step fails loudly rather than shipping
  stale content
- Test against `dist/chrome/content.js` (or `dist/firefox`), not
  `src/content.js` - the source file still contains the literal, unresolved
  placeholders, and won't behave like what actually ships
- `src/manifest.chrome.json` and `manifest.firefox.json` should only ever
  differ in their `background` block (`service_worker` vs `scripts`) -
  everything else, including permissions and `web_accessible_resources`,
  should stay identical between them
- Any change to `session`'s stored shape (see ARCHITECTURE.md's Data model
  section) needs a migration for data already sitting in a real user's
  `chrome.storage.local` from before the change - there is no
  version-gated database, no clean slate, and old-shape data reaching new
  code has already caused a real crash-on-load bug once. Migrate in place
  right after `session` is loaded from storage, before anything else
  touches it
- A real toolbar click can't be scripted, so verify browser-facing changes
  with Playwright instead of assuming a diff is correct: stub
  `chrome.storage.local`/`chrome.runtime` via `page.evaluate`, load the
  built `dist/.../content.js`, and drive the panel with real
  `page.mouse`/`page.keyboard` input rather than synthetic
  `element.click()` or `element.dispatchEvent()` calls - those don't
  reliably exercise the same focus and event-delegation paths as genuine
  input, and have produced false negatives here before
- The downloaded report has zero `<script>` tags and zero JavaScript by
  design (the lightbox is pure CSS, using `:target`) - don't reach for a
  `<script>` tag to solve a report-formatting problem; find the CSS-only or
  build-time way instead
- `npm run lint` and `npm run format` must pass before committing; the
  pre-commit hook (Husky + lint-staged) runs both automatically on staged
  files, but run them yourself first when in doubt
- Don't add a testing framework, TypeScript, or a bundler as a side effect
  of an unrelated change - if one of those seems genuinely needed, raise it
  as its own decision rather than folding it into another task
