# alan-review-tool

Perform design reviews on any site

## Dev testing: injection prototype

This first slice only proves the injection mechanic: click the toolbar icon on
any tab, in any browser, and a slide-out panel appears — no permissions beyond
`activeTab` + `scripting`, no changes needed on the target site.

### Build

    npm run build

Writes browser-specific bundles to `dist/chrome` and `dist/firefox`. Two
manifests are needed because Chrome's MV3 requires a `service_worker`
background and Firefox's MV3 still wants `background.scripts` — everything
else (`background.js`, `content.js`) is shared, unmodified, between both.

### Development

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

### Load in Chrome

1. `chrome://extensions`
2. Enable "Developer mode" (top right)
3. "Load unpacked" → select `dist/chrome`
4. Pin the extension, visit any site, click its toolbar icon — the panel
   should slide in from the right. Click again to close.

### Load in Firefox

1. `about:debugging#/runtime/this-firefox`
2. "Load Temporary Add-on…" → select `dist/firefox/manifest.json`
3. Visit any site, click the toolbar icon — same panel.
   (Temporary add-ons are removed on restart — expected for this test.)

### What this proves

- Injection works via `activeTab` + `chrome.scripting.executeScript`,
  triggered by a user gesture (icon click) — no blanket host permissions.
- Shadow DOM isolates the panel's styles from the host page and vice versa.
- Same `background.js` / `content.js` source runs unmodified in both
  browsers; only the manifest's background declaration differs.

### Not yet built

Comment capture, screenshot capture, and the universal clipboard export are
next — this step is just the injection shell.
