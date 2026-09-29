import { useMemo } from "react";
import { MantineProvider, Portal, Tooltip, createTheme } from "@mantine/core";
import { Layer } from "@recursica/adapter-mantine-v8";
import { ModalPortalContext } from "./modalPortal";
import { ReviewPanel } from "./ReviewPanel";
import type { StoredState } from "./lib/storage";
import { useColorScheme } from "./useColorScheme";

interface AppProps {
  host: HTMLElement;
  rootEl: HTMLElement;
  portalEl: HTMLElement;
  modalPortalEl: HTMLElement;
  stored: StoredState;
  onClosed: () => void;
}

// Mantine sizes everything in rem, and rem resolves against the host
// page's <html> font size - which a site can set to anything. Mantine
// multiplies every rem by its scale, so scaling by 16 / the page's real
// root size keeps the panel at its designed size on every site.
function pageRemScale(): number {
  const rootPx = parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  return rootPx > 0 ? 16 / rootPx : 1;
}

export function App({
  host,
  rootEl,
  portalEl,
  modalPortalEl,
  stored,
  onClosed,
}: AppProps) {
  const scheme = useColorScheme(rootEl);

  const theme = useMemo(
    () =>
      createTheme({
        scale: pageRemScale(),
        components: {
          // Every portal (tooltips, modals) renders inside the shadow root.
          Portal: Portal.extend({ defaultProps: { target: portalEl } }),
          // Tooltips appear on keyboard focus as well as hover. Mantine's
          // default is hover only, and the adapter does not change it.
          Tooltip: Tooltip.extend({
            defaultProps: {
              events: { hover: true, focus: true, touch: false },
            },
          }),
        },
      }),
    [portalEl],
  );

  return (
    <MantineProvider
      theme={theme}
      forceColorScheme={scheme}
      // Mantine writes its variables and color-scheme attribute to the
      // panel's root element, not to the host page's <html>.
      cssVariablesSelector=".art-root"
      getRootElement={() => rootEl}
    >
      {/* Layer 0, declared once, on the panel's root. The adapter's
          RecursicaThemeProvider is not used - see mount.tsx. */}
      <Layer layer={0}>
        {/* The portals come first, so the toast's Dismiss button is a
            predictable tab stop - before the panel's controls, not after
            all of them. Everything in them is fixed-position, so their
            place in the DOM doesn't affect layout. */}
        <div
          ref={(el) => {
            if (!el) return;
            if (portalEl.parentElement !== el) el.appendChild(portalEl);
            if (modalPortalEl.parentElement !== el)
              el.appendChild(modalPortalEl);
          }}
        />
        <ModalPortalContext.Provider value={modalPortalEl}>
          <ReviewPanel
            host={host}
            portalEl={portalEl}
            stored={stored}
            onClosed={onClosed}
          />
        </ModalPortalContext.Provider>
      </Layer>
    </MantineProvider>
  );
}
