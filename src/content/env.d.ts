// The package.json version, injected by Vite at build time - one source of
// truth for the version shown in the panel header.
declare const __APP_VERSION__: string;
// What Snippy is built with (see vite.config.mts): the Recursica adapter's
// package version, and the Forge theme's source JSON and transform versions
// from the bundled theme stylesheet's header comment.
declare const __ADAPTER_VERSION__: string;
declare const __FORGE_VERSION__: string;
declare const __TRANSFORM_VERSION__: string;

// Aliased in vite.config.mts to the adapter's theme stylesheet.
declare module "recursica-theme.css?inline" {
  const css: string;
  export default css;
}
