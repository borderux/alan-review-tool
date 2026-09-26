const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");

// Some source files exist only to be inlined into content.js's generated
// report at build time (a downloaded standalone HTML file can't fetch a
// sibling file) - kept as their own real, lintable source files instead of
// hand-maintained strings inside content.js, and inlined here via a
// placeholder-token swap.
const INLINES = [
  { file: "report.css", placeholder: '"__REPORT_CSS_PLACEHOLDER__"' },
  {
    file: "ai-report-instructions.txt",
    placeholder: '"__AI_INSTRUCTIONS_PLACEHOLDER__"',
  },
];

const SHARED_FILES = ["background.js", "content.js", "content.css"];
const TARGETS = {
  chrome: "manifest.chrome.json",
  firefox: "manifest.firefox.json",
};

fs.rmSync(DIST, { recursive: true, force: true });

const inlineLiterals = INLINES.map(({ file, placeholder }) => ({
  placeholder,
  literal: JSON.stringify(fs.readFileSync(path.join(SRC, file), "utf8")),
}));

for (const [browser, manifestFile] of Object.entries(TARGETS)) {
  const outDir = path.join(DIST, browser);
  fs.mkdirSync(outDir, { recursive: true });

  for (const file of SHARED_FILES) {
    const srcPath = path.join(SRC, file);
    const outPath = path.join(outDir, file);
    if (file === "content.js") {
      let content = fs.readFileSync(srcPath, "utf8");
      for (const { placeholder, literal } of inlineLiterals) {
        if (!content.includes(placeholder)) {
          throw new Error(
            `content.js is missing the ${placeholder} placeholder - a source file can't be inlined`,
          );
        }
        content = content.replace(placeholder, literal);
      }
      fs.writeFileSync(outPath, content);
    } else {
      fs.copyFileSync(srcPath, outPath);
    }
  }

  fs.copyFileSync(
    path.join(SRC, manifestFile),
    path.join(outDir, "manifest.json"),
  );
}

console.log("Built extension bundles into dist/chrome and dist/firefox");
