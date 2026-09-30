// Every stylesheet the panel needs, as strings, injected once into the
// shadow root (see mount.tsx). Order matters: Mantine first, then the
// Recursica theme variables, then the adapter's component styles, then the
// panel's own few layout rules. All of them pass through the build's
// shadow-scope PostCSS step (vite.config.mts), which retargets `:root`.
import mantineCss from "@mantine/core/styles.css?inline";
import themeCss from "recursica-theme.css?inline";
import adapterCss from "@recursica/adapter-mantine-v8/style.css?inline";
import panelCss from "./panel.css?inline";

export const PANEL_CSS = [mantineCss, themeCss, adapterCss, panelCss].join(
  "\n",
);
