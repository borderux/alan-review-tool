// .mjs, not .js: this package has no "type": "module" (content.js/build.js
// are plain scripts, not ES modules), so a plain .js file using `export
// default` here would be parsed as CommonJS and fail to load.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    // The injected panel and its report-building code - runs in a page's
    // own browser context, plus the chrome.* extension APIs.
    files: ["src/content.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: js.configs.recommended.rules,
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
    // This config file itself - real ESM (import/export), unlike the rest
    // of this plain-JS, no-bundler project.
    files: ["eslint.config.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.node,
    },
    rules: js.configs.recommended.rules,
  },
];
