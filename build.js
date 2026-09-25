const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");

const SHARED_FILES = ["background.js", "content.js"];
const TARGETS = {
  chrome: "manifest.chrome.json",
  firefox: "manifest.firefox.json",
};

fs.rmSync(DIST, { recursive: true, force: true });

for (const [browser, manifestFile] of Object.entries(TARGETS)) {
  const outDir = path.join(DIST, browser);
  fs.mkdirSync(outDir, { recursive: true });

  for (const file of SHARED_FILES) {
    fs.copyFileSync(path.join(SRC, file), path.join(outDir, file));
  }

  fs.copyFileSync(path.join(SRC, manifestFile), path.join(outDir, "manifest.json"));
}

console.log("Built extension bundles into dist/chrome and dist/firefox");
