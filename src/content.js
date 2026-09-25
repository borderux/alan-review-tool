(async function () {
  const HOST_ID = "alan-review-tool-host";
  const WIDTH_STORAGE_KEY = "alanReviewToolPanelWidth";
  const DEFAULT_WIDTH = 320;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 720;
  const html = document.documentElement;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  function restorePage() {
    html.style.width = html.dataset.alanReviewToolPrevWidth || "";
    html.style.transition = html.dataset.alanReviewToolPrevTransition || "";
    delete html.dataset.alanReviewToolPrevWidth;
    delete html.dataset.alanReviewToolPrevTransition;
  }

  const existing = document.getElementById(HOST_ID);
  if (existing) {
    // A fresh injection per click means no JS state survives between clicks -
    // the "previous style" has to live on the DOM itself (dataset), not a closure.
    existing.remove();
    restorePage();
    return;
  }

  const stored = await chrome.storage.local.get(WIDTH_STORAGE_KEY);
  let panelWidth = clamp(stored[WIDTH_STORAGE_KEY] ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);

  html.dataset.alanReviewToolPrevWidth = html.style.width;
  html.dataset.alanReviewToolPrevTransition = html.style.transition;
  html.style.transition = "width 0.2s ease-out";
  html.style.width = `calc(100% - ${panelWidth}px)`;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.right = "0";
  host.style.width = `${panelWidth}px`;
  host.style.height = "100vh";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const isFirefox = navigator.userAgent.includes("Firefox");

  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .resizer {
        position: absolute;
        top: 0;
        left: 0;
        width: 6px;
        height: 100%;
        cursor: ew-resize;
        background: transparent;
      }
      .resizer:hover, .resizer.dragging {
        background: rgba(255, 255, 255, 0.25);
      }
      .panel {
        font-family: system-ui, sans-serif;
        width: 100%;
        height: 100%;
        background: #1e1e2e;
        color: #fff;
        box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
        padding: 16px;
        box-sizing: border-box;
      }
      h2 { margin: 0 0 8px; font-size: 16px; }
      p { font-size: 13px; opacity: 0.8; }
      button {
        margin-top: 12px;
        padding: 6px 12px;
        cursor: pointer;
      }
    </style>
    <div class="resizer"></div>
    <div class="panel">
      <h2>Alan Review Tool</h2>
      <p>Injected on: ${location.hostname}</p>
      <p>Browser: ${isFirefox ? "Firefox" : "Chromium-based"}</p>
      <button id="close">Close</button>
    </div>
  `;
  shadow.getElementById("close").addEventListener("click", () => {
    host.remove();
    restorePage();
  });

  // Dragging the strip resizes the panel and the page's reflowed width together,
  // then persists the final width so the next injection (a fresh script
  // execution with no memory of this one) opens at the same size.
  const resizer = shadow.querySelector(".resizer");
  resizer.addEventListener("mousedown", (mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    const startX = mouseDownEvent.clientX;
    const startWidth = panelWidth;
    resizer.classList.add("dragging");
    html.style.transition = "";

    function onMouseMove(moveEvent) {
      const delta = startX - moveEvent.clientX;
      panelWidth = clamp(startWidth + delta, MIN_WIDTH, MAX_WIDTH);
      host.style.width = `${panelWidth}px`;
      html.style.width = `calc(100% - ${panelWidth}px)`;
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      resizer.classList.remove("dragging");
      chrome.storage.local.set({ [WIDTH_STORAGE_KEY]: panelWidth });
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });
})();
