const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");

// content.css styles the live panel (loaded via a real <link>, since the
// panel is a long-lived injected UI). report.css styles the one-shot
// downloaded HTML report instead, and has to end up INLINE in that file
// (a downloaded standalone file can't fetch a sibling stylesheet) - kept
// as its own source file rather than a hand-maintained string inside
// content.js, and inlined into content.js's REPORT_CSS constant here at
// build time instead.
const REPORT_CSS_PLACEHOLDER = '"__REPORT_CSS_PLACEHOLDER__"';

const SHARED_FILES = ["background.js", "content.js", "content.css"];
const TARGETS = {
  chrome: "manifest.chrome.json",
  firefox: "manifest.firefox.json",
};

fs.rmSync(DIST, { recursive: true, force: true });

const reportCss = fs.readFileSync(path.join(SRC, "report.css"), "utf8");
const reportCssLiteral = JSON.stringify(reportCss);

for (const [browser, manifestFile] of Object.entries(TARGETS)) {
  const outDir = path.join(DIST, browser);
  fs.mkdirSync(outDir, { recursive: true });

  for (const file of SHARED_FILES) {
    const srcPath = path.join(SRC, file);
    const outPath = path.join(outDir, file);
    if (file === "content.js") {
      const content = fs.readFileSync(srcPath, "utf8");
      if (!content.includes(REPORT_CSS_PLACEHOLDER)) {
        throw new Error(`content.js is missing the ${REPORT_CSS_PLACEHOLDER} placeholder - report.css can't be inlined`);
      }
      fs.writeFileSync(outPath, content.replace(REPORT_CSS_PLACEHOLDER, reportCssLiteral));
    } else {
      fs.copyFileSync(srcPath, outPath);
    }
  }

  fs.copyFileSync(path.join(SRC, manifestFile), path.join(outDir, "manifest.json"));
}

console.log("Built extension bundles into dist/chrome and dist/firefox");
