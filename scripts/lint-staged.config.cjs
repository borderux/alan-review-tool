// .cjs, not .js: safe regardless of whether package.json ever gains
// "type": "module" later - a plain .js file using `module.exports` would
// then be parsed as ESM and fail to load, which lint-staged reports as
// "Failed to read config from file" and fails the Husky pre-commit hook
// outright.
module.exports = {
  // For all non-code files, just format them.
  "*.{json,md,css}": ["prettier --write"],

  // Plain JS files: format and lint only the staged files.
  "*.{js,cjs,mjs}": (filenames) => [
    `prettier --write ${filenames.join(" ")}`,
    `eslint --fix ${filenames.join(" ")}`,
  ],

  // TypeScript: format and lint the staged files, then type-check the
  // whole project. tsc cannot check a single file in isolation against
  // tsconfig.json, so the type-check deliberately ignores the file list.
  "*.{ts,tsx,mts}": (filenames) => [
    `prettier --write ${filenames.join(" ")}`,
    `eslint --fix ${filenames.join(" ")}`,
    "npm run typecheck",
  ],
};
