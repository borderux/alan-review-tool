import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin as VitePlugin } from "vite";
import react from "@vitejs/plugin-react";
import type { AcceptedPlugin, Declaration, Rule } from "postcss";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  readFileSync(path.join(rootDir, "package.json"), "utf8"),
) as { version: string };

// The class on the panel's root element inside the shadow root. Every
// stylesheet the panel injects is scoped to it - see shadowScope below.
// Must match PANEL_ROOT_CLASS in src/content/mount.tsx.
const PANEL_ROOT_CLASS = "art-root";

// Mantine and the Recursica theme both declare their base variables on
// `:root`, which never matches anything inside a shadow root. Rewriting the
// selector at build time points them at the panel's own root element
// instead. The Recursica adapter's and theme's own stylesheets also use a
// handful of bare `rem` values; a `rem` resolves against the host page's
// <html> font size, which any site can change (the 62.5% trick is common),
// so those are converted to px here. Mantine's own rem values are left
// alone - they are all multiplied by --mantine-scale, which the panel sets
// from the host page's real root font size at mount (see theme.ts).
function shadowScope(): AcceptedPlugin {
  return {
    postcssPlugin: "alan-shadow-scope",
    Rule(rule: Rule) {
      if (rule.selector.includes(":root")) {
        rule.selector = rule.selector.replace(
          /:root\b/g,
          `.${PANEL_ROOT_CLASS}`,
        );
      }
    },
    Declaration(decl: Declaration) {
      const file = decl.source?.input.file ?? "";
      if (!file.includes(`${path.sep}@recursica${path.sep}`)) return;
      if (!decl.value.includes("rem")) return;
      decl.value = decl.value.replace(
        /(-?\d*\.?\d+)rem\b/g,
        (_match, n: string) => `${parseFloat(n) * 16}px`,
      );
    },
  };
}

// The adapter ships its theme stylesheet at the package root but does not
// list it in package.json "exports", so a normal import is refused.
const themeCssPath = path.join(
  rootDir,
  "node_modules/@recursica/adapter-mantine-v8/recursica_variables_scoped.css",
);

function versionDefine(): VitePlugin {
  return {
    name: "alan-version",
    config: () => ({ define: { __APP_VERSION__: JSON.stringify(version) } }),
  };
}

export default defineConfig({
  plugins: [react(), versionDefine()],
  resolve: {
    alias: [{ find: /^recursica-theme\.css/, replacement: themeCssPath }],
  },
  css: {
    postcss: { plugins: [shadowScope()] },
  },
  define: {
    // The adapter reads process.env.NODE_ENV at runtime; a content script
    // has no `process`.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist/.content",
    emptyOutDir: true,
    // Content scripts injected with chrome.scripting.executeScript must be
    // classic scripts, so the whole panel ships as one self-running IIFE.
    lib: {
      entry: path.join(rootDir, "src/content/main.tsx"),
      formats: ["iife"],
      name: "AlanReviewTool",
      fileName: () => "content.js",
    },
    // Fonts and other assets are inlined into content.js rather than
    // shipped as separate files - see fonts.ts for why.
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    cssCodeSplit: false,
    minify: true,
    sourcemap: false,
  },
});
