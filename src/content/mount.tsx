import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerFonts } from "./fonts";
import { HOST_ID, pushPage, restorePage } from "./lib/page";
import { loadStoredState } from "./lib/storage";
import { PANEL_CSS } from "./styles";
import { initialScheme } from "./useColorScheme";

// Must match PANEL_ROOT_CLASS in vite.config.mts.
const PANEL_ROOT_CLASS = "art-root";

export async function mountPanel(): Promise<void> {
  const stored = await loadStoredState();
  registerFonts();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.right = "0";
  host.style.width = `${stored.width}px`;
  host.style.height = "100vh";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);
  pushPage(stored.width);

  // Everything the panel draws lives in this shadow root, so panel styles
  // can't leak into the page and page styles can't leak into the panel.
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);

  // The theme attribute sits on the panel's own root, never on the host
  // page's <html>: the adapter's RecursicaThemeProvider writes it to
  // document.documentElement, which here would be someone else's site.
  // Set before the first render so there is no flash of the wrong theme.
  const rootEl = document.createElement("div");
  rootEl.className = PANEL_ROOT_CLASS;
  rootEl.setAttribute("data-recursica-theme", initialScheme());
  shadow.appendChild(rootEl);

  // Tooltips and modals render here rather than in document.body, which
  // is outside the shadow root and would leave them unstyled. App places
  // it inside the layer-0 scope.
  const portalEl = document.createElement("div");
  portalEl.className = "art-portal";
  // Modals render here instead: the same pinned container, declaring
  // layer 1. It is a plain element carrying the layer attribute rather than
  // the adapter's Layer component, because Layer paints its own padded
  // surface, which would show as a box at the top-left corner of the page.
  const modalPortalEl = document.createElement("div");
  modalPortalEl.className = "art-portal";
  modalPortalEl.setAttribute("data-recursica-layer", "1");

  const reactRoot = createRoot(rootEl);
  const teardown = () => {
    reactRoot.unmount();
    host.remove();
    restorePage();
  };
  reactRoot.render(
    <App
      host={host}
      rootEl={rootEl}
      portalEl={portalEl}
      modalPortalEl={modalPortalEl}
      stored={stored}
      onClosed={teardown}
    />,
  );
}
