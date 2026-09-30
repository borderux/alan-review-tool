// .mjs, not .js: this package has no "type": "module" (build.js and
// background.js are plain scripts, not ES modules), so a plain .js file
// using `export default` here would be parsed as CommonJS and fail to load.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "release-zips/**"] },
  {
    // The injected panel: React + TypeScript, bundled by Vite into one
    // content script. Runs in a page's own browser context, plus the
    // chrome.* extension APIs. Type checking itself is `npm run typecheck`.
    files: ["src/content/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended
        .map((config) => config.rules ?? {})
        .reduce((all, rules) => ({ ...all, ...rules }), {}),
      ...reactHooks.configs.recommended.rules,
      // TypeScript already reports undefined names, including type-only
      // globals the `globals` package does not list.
      "no-undef": "off",
    },
  },
  {
    // The service worker - no DOM, but the same chrome.* APIs.
    files: ["src/background.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.serviceworker, ...globals.webextensions },
    },
    rules: js.configs.recommended.rules,
  },
  {
    // The Node-side build script and lint-staged config - CommonJS.
    files: ["build.js", "scripts/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
  {
    // This config file and the release-packaging script - real ESM.
    files: ["eslint.config.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
  {
    // Vite's config - TypeScript, run by Node.
    files: ["vite.config.mts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { ...js.configs.recommended.rules, "no-undef": "off" },
  },
];
