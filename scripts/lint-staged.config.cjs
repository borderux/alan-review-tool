// .cjs, not .js: safe regardless of whether package.json ever gains
// "type": "module" later - a plain .js file using `module.exports` would
// then be parsed as ESM and fail to load, which lint-staged reports as
// "Failed to read config from file" and fails the Husky pre-commit hook
// outright.
module.exports = {
  // For all non-JS files, just format them.
  "*.{json,md,css}": ["prettier --write"],

  // For JS files: format and lint only the staged files. No type-check or
  // test step - this is a plain-JS project with no TypeScript and no test
  // script wired into package.json yet.
  "*.js": (filenames) => [`prettier --write ${filenames.join(" ")}`, `eslint --fix ${filenames.join(" ")}`],
};
