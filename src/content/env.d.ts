// The package.json version, injected by Vite at build time - one source of
// truth for the version shown in the panel header.
declare const __APP_VERSION__: string;

// Aliased in vite.config.mts to the adapter's theme stylesheet.
declare module "recursica-theme.css?inline" {
  const css: string;
  export default css;
}
