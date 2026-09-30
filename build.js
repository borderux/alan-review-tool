const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
// Vite writes the bundled panel here first; it is then copied, unchanged,
// into each browser's folder.
const CONTENT_OUT = path.join(DIST, ".content", "content.js");

// Copied as-is. content.js is not in this list - it is Vite's output.
const SHARED_FILES = ["background.js"];
// The extension icon, in the four sizes the manifests list. Generated from
// one source image with `npm run icons -- <source.png>` (see README).
const ICON_SIZES = [16, 32, 48, 128];
const ICONS_DIR = path.join(SRC, "icons");
const iconFile = (size) => `icon-${size}.png`;

// package.json's version is the only source of truth: the manifests carry
// none in src, and each built manifest gets it here. Browsers need one to
// four dot-separated integers (0-65535) - a prerelease or build suffix
// (1.2.0-beta.1) is refused rather than silently mapped.
const { version } = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
);
if (
  !/^\d+(\.\d+){0,3}$/.test(version) ||
  version.split(".").some((part) => Number(part) > 65535 || /^0\d/.test(part))
) {
  throw new Error(
    `package.json version "${version}" is not a valid extension version: ` +
      "browsers accept only 1 to 4 dot-separated integers (like 1.2.3), " +
      "with no prerelease or build suffix.",
  );
}

const TARGETS = {
  chrome: "manifest.chrome.json",
  firefox: "manifest.firefox.json",
};

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });

  // Vite is ESM-only; this script stays CommonJS so it keeps working
  // without "type": "module" in package.json.
  const { build } = await import("vite");
  await build({
    configFile: path.join(ROOT, "vite.config.mts"),
    logLevel: "warn",
  });

  if (!fs.existsSync(CONTENT_OUT)) {
    throw new Error(`Vite did not produce ${CONTENT_OUT}`);
  }

  // Until the real icon has been generated, build without it rather than
  // ship a manifest pointing at missing files (which a browser refuses to
  // load): drop the icon entries and say so loudly.
  const missingIcons = ICON_SIZES.filter(
    (size) => !fs.existsSync(path.join(ICONS_DIR, iconFile(size))),
  );
  if (missingIcons.length > 0) {
    console.warn(
      `WARNING: no extension icon (missing ${missingIcons.map(iconFile).join(", ")} in src/icons). ` +
        "Building without one; run `npm run icons -- <source.png>` to add it.",
    );
  }

  for (const [browser, manifestFile] of Object.entries(TARGETS)) {
    const outDir = path.join(DIST, browser);
    fs.mkdirSync(outDir, { recursive: true });
    for (const file of SHARED_FILES) {
      fs.copyFileSync(path.join(SRC, file), path.join(outDir, file));
    }
    fs.copyFileSync(CONTENT_OUT, path.join(outDir, "content.js"));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(SRC, manifestFile), "utf8"),
    );
    if ("version" in manifest) {
      throw new Error(
        `${manifestFile} has its own "version"; remove it - the build writes package.json's.`,
      );
    }
    // Right after the name, where browsers and people expect it.
    const { manifest_version, name, ...rest } = manifest;
    Object.keys(manifest).forEach((key) => delete manifest[key]);
    Object.assign(manifest, { manifest_version, name, version, ...rest });
    if (missingIcons.length > 0) {
      delete manifest.icons;
      delete manifest.action.default_icon;
    } else {
      fs.mkdirSync(path.join(outDir, "icons"), { recursive: true });
      for (const size of ICON_SIZES) {
        fs.copyFileSync(
          path.join(ICONS_DIR, iconFile(size)),
          path.join(outDir, "icons", iconFile(size)),
        );
      }
    }
    fs.writeFileSync(
      path.join(outDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  // Guard: every built manifest, and the panel itself, must carry exactly
  // package.json's version.
  for (const browser of Object.keys(TARGETS)) {
    const built = JSON.parse(
      fs.readFileSync(path.join(DIST, browser, "manifest.json"), "utf8"),
    );
    if (built.version !== version) {
      throw new Error(
        `dist/${browser}/manifest.json says ${built.version}, package.json says ${version}`,
      );
    }
    const content = fs.readFileSync(
      path.join(DIST, browser, "content.js"),
      "utf8",
    );
    // As a string literal in any quote style the minifier picked.
    const literal = new RegExp(`["'\`]${version.replace(/\./g, "\\.")}["'\`]`);
    if (!literal.test(content)) {
      throw new Error(
        `dist/${browser}/content.js does not carry version ${version}`,
      );
    }
  }

  fs.rmSync(path.join(DIST, ".content"), { recursive: true, force: true });
  console.log("Built extension bundles into dist/chrome and dist/firefox");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
