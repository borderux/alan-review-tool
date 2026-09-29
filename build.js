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

  for (const [browser, manifestFile] of Object.entries(TARGETS)) {
    const outDir = path.join(DIST, browser);
    fs.mkdirSync(outDir, { recursive: true });
    for (const file of SHARED_FILES) {
      fs.copyFileSync(path.join(SRC, file), path.join(outDir, file));
    }
    fs.copyFileSync(CONTENT_OUT, path.join(outDir, "content.js"));
    fs.copyFileSync(
      path.join(SRC, manifestFile),
      path.join(outDir, "manifest.json"),
    );
  }

  fs.rmSync(path.join(DIST, ".content"), { recursive: true, force: true });
  console.log("Built extension bundles into dist/chrome and dist/firefox");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
