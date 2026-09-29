// The panel pushes the page rather than covering it, by shrinking
// document.documentElement's width. A fresh injection per click means no
// JS state survives between clicks, so the page's own pre-panel inline
// styles live on the DOM (dataset), not in a closure.
const html = document.documentElement;

export const HOST_ID = "snippy-host";
// Host ids of earlier generations (Tagger, then the Alan Review Tool),
// each with the dataset prefix it used for the page push. A panel opened
// by an older version can still be on the page when the extension
// updates.
export const LEGACY_HOSTS = [
  { id: "tagger-host", prefix: "tagger" },
  { id: "alan-review-tool-host", prefix: "alanReviewTool" },
];
// Dispatched on the existing host by the next toolbar click, so the
// instance that owns the panel can close it cleanly (see main.tsx).
export const CLOSE_EVENT = "snippy:close";

export function currentPageKey(): string {
  return location.origin + location.pathname + location.search;
}

export function pushPage(width: number): void {
  html.dataset.snippyPrevWidth = html.style.width;
  html.dataset.snippyPrevTransition = html.style.transition;
  html.style.transition = "width 0.2s ease-out";
  html.style.width = `calc(100% - ${width}px)`;
}

export function setPageWidth(width: number, animate: boolean): void {
  html.style.transition = animate ? "width 0.2s ease-out" : "";
  html.style.width = `calc(100% - ${width}px)`;
}

// Gives the page its full width back for the length of a capture, and
// returns the function that pushes it again. While the reviewer selects a
// region (or an element) the panel is hidden, so the page should not keep
// a blank strip where the panel was - and the screenshot should cover the
// page as it really lays out. No transition either way: the reflow happens
// while the panel is hidden.
export function suspendPagePush(): () => void {
  const pushedWidth = html.style.width;
  html.style.transition = "";
  html.style.width = html.dataset.snippyPrevWidth || "";
  return () => {
    html.style.transition = "";
    html.style.width = pushedWidth;
  };
}

// The panel's host element tracks the panel width, so the resize strip it
// holds stays on the panel's left edge.
export function setHostWidth(host: HTMLElement, width: number): void {
  host.style.width = `${width}px`;
}

// Undoes an older version's page push, which used that version's dataset
// names (for example alanReviewToolPrevWidth).
export function restoreLegacyPage(prefix: string): void {
  const widthKey = `${prefix}PrevWidth`;
  const transitionKey = `${prefix}PrevTransition`;
  html.style.width = html.dataset[widthKey] || "";
  html.style.transition = html.dataset[transitionKey] || "";
  delete html.dataset[widthKey];
  delete html.dataset[transitionKey];
}

export function restorePage(): void {
  html.style.width = html.dataset.snippyPrevWidth || "";
  html.style.transition = html.dataset.snippyPrevTransition || "";
  delete html.dataset.snippyPrevWidth;
  delete html.dataset.snippyPrevTransition;
}

// Makes everything behind an open modal inert, and returns the function
// that undoes it: the host page's <body> (the panel's host sits outside
// it), the whole panel including its resize strip, and the layer-0 portal
// with the toast, tooltips and menus. Only the modal portal stays live.
// Prior values are restored, never assumed.
export function makeBehindModalInert(host: HTMLElement): () => void {
  const root = host.shadowRoot;
  const targets = [
    document.body,
    root?.querySelector<HTMLElement>(".art-panel"),
    root?.querySelector<HTMLElement>(".art-portal:not([data-recursica-layer])"),
  ].filter((el): el is HTMLElement => Boolean(el));
  const previous = targets.map((el) => el.inert);
  for (const el of targets) el.inert = true;
  return () => targets.forEach((el, i) => (el.inert = previous[i]));
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
