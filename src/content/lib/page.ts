// The panel pushes the page rather than covering it, by shrinking
// document.documentElement's width. A fresh injection per click means no
// JS state survives between clicks, so the page's own pre-panel inline
// styles live on the DOM (dataset), not in a closure.
const html = document.documentElement;

export const HOST_ID = "alan-review-tool-host";
// Dispatched on the existing host by the next toolbar click, so the
// instance that owns the panel can close it cleanly (see main.tsx).
export const CLOSE_EVENT = "alan-review-tool:close";

export function currentPageKey(): string {
  return location.origin + location.pathname + location.search;
}

export function pushPage(width: number): void {
  html.dataset.alanReviewToolPrevWidth = html.style.width;
  html.dataset.alanReviewToolPrevTransition = html.style.transition;
  html.style.transition = "width 0.2s ease-out";
  html.style.width = `calc(100% - ${width}px)`;
}

export function setPageWidth(width: number, animate: boolean): void {
  html.style.transition = animate ? "width 0.2s ease-out" : "";
  html.style.width = `calc(100% - ${width}px)`;
}

// The panel's host element tracks the panel width, so the resize strip it
// holds stays on the panel's left edge.
export function setHostWidth(host: HTMLElement, width: number): void {
  host.style.width = `${width}px`;
}

export function restorePage(): void {
  html.style.width = html.dataset.alanReviewToolPrevWidth || "";
  html.style.transition = html.dataset.alanReviewToolPrevTransition || "";
  delete html.dataset.alanReviewToolPrevWidth;
  delete html.dataset.alanReviewToolPrevTransition;
}

// Finds an element inside the panel's shadow root.
export function findInPanel(
  host: HTMLElement,
  selector: string,
): HTMLElement | null {
  return host.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

// Defect workaround: the adapter's Panel (Mantine's Drawer) always marks
// its content role="dialog" aria-modal="true", even with every modal
// behaviour switched off. This panel is non-modal - the page behind stays
// live - so it must be announced as a named region, not a modal dialog.
// Remove when the adapter lets a non-modal panel say so.
export function markPanelNonModal(host: HTMLElement): void {
  const content = host.shadowRoot?.querySelector(".mantine-Drawer-content");
  if (!content) return;
  content.removeAttribute("aria-modal");
  content.setAttribute("role", "region");
}
