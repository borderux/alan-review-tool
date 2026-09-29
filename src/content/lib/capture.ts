// Screenshot capture: a drag-select overlay on the page itself, then a
// round trip to the background worker (only it can capture pixels), then
// a crop. The overlay lives in the host page's light DOM, outside the
// panel's shadow root, so no Recursica component or token reaches it - it
// is the one deliberately hand-built surface, approved as such.

import { suspendPagePush } from "./page";

export const OVERLAY_ID = "tagger-selection-overlay";

function setPanelHidden(host: HTMLElement, hidden: boolean): void {
  host.style.visibility = hidden ? "hidden" : "visible";
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Lets the user drag a rectangle directly on the page (not the panel) and
// resolves with its viewport coordinates, or null if they cancel (Escape,
// leaving the window, or too small a drag to count as intentional).
export function selectRegion(): Promise<Rect | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.all = "initial";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.zIndex = "2147483647";
    overlay.style.cursor = "crosshair";
    overlay.style.background = "rgba(0, 0, 0, 0.15)";
    document.documentElement.appendChild(overlay);

    const box = document.createElement("div");
    box.style.all = "initial";
    box.style.position = "fixed";
    box.style.border = "2px dashed #4f9dff";
    box.style.background = "rgba(79, 157, 255, 0.2)";
    box.style.display = "none";
    overlay.appendChild(box);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    function currentRect(event: MouseEvent): Rect {
      const x = Math.min(event.clientX, startX);
      const y = Math.min(event.clientY, startY);
      const width = Math.abs(event.clientX - startX);
      const height = Math.abs(event.clientY - startY);
      return { x, y, width, height };
    }

    function onMouseDown(event: MouseEvent) {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      box.style.display = "block";
    }

    function onMouseMove(event: MouseEvent) {
      if (!dragging) return;
      if (event.buttons === 0) {
        // The mouseup that should have ended this drag never reached us -
        // most likely the button was released outside the browser window.
        // A mousemove with no buttons held means it's already released, so
        // finish here instead of leaving the drag (and the hidden panel)
        // stuck forever.
        onMouseUp(event);
        return;
      }
      const rect = currentRect(event);
      box.style.left = `${rect.x}px`;
      box.style.top = `${rect.y}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }

    function onMouseUp(event: MouseEvent) {
      if (!dragging) return;
      dragging = false;
      const rect = currentRect(event);
      cleanup();
      resolve(rect.width < 4 || rect.height < 4 ? null : rect);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // The panel also closes on Escape; this Escape belongs to the
        // overlay alone.
        event.stopPropagation();
        cleanup();
        resolve(null);
      }
    }

    // The other half of the stuck-drag safety net: focus leaving the window
    // entirely (alt-tab) means no mousemove will ever arrive.
    function onWindowBlur() {
      cleanup();
      resolve(null);
    }

    function cleanup() {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onWindowBlur);
    }

    overlay.addEventListener("mousedown", onMouseDown);
    overlay.addEventListener("mousemove", onMouseMove);
    overlay.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onWindowBlur);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

interface CaptureResponse {
  dataUrl?: string;
  error?: string;
}

// The MV3 service worker unloads after ~30s idle; the message that wakes
// it can lose that race and fail with "Receiving end does not exist". A
// short retry almost always lands after it's awake.
async function sendCaptureRequest(
  attempts = 3,
  delayMs = 200,
): Promise<CaptureResponse | undefined> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return (await chrome.runtime.sendMessage({
        type: "tagger:capture",
      })) as CaptureResponse | undefined;
    } catch (err) {
      if (attempt === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return undefined;
}

export type CaptureResult = { dataUrl: string } | { error: string };

export async function captureAndCrop(rect: Rect): Promise<CaptureResult> {
  // Give the compositor a couple of frames to paint the panel as hidden
  // before the screenshot is taken.
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );

  const response = await sendCaptureRequest();
  if (!response?.dataUrl) {
    return {
      error: response?.error || "the browser did not return an image",
    };
  }

  const dpr = window.devicePixelRatio || 1;
  const img = await loadImage(response.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { error: "the browser could not create a canvas" };
  ctx.drawImage(
    img,
    rect.x * dpr,
    rect.y * dpr,
    rect.width * dpr,
    rect.height * dpr,
    0,
    0,
    rect.width * dpr,
    rect.height * dpr,
  );
  // JPEG rather than PNG - a UI screenshot has enough gradients (shadows,
  // anti-aliased text) that lossy compression saves real space.
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
}

// Runs a capture with the panel hidden and the page at its full width,
// and always puts both back afterwards - on success, cancel or failure.
// Hidden, not removed, so nothing about the panel's state is lost, and it
// stays hidden until the pixels are taken, so it can never appear in its
// own screenshot.
export async function withPanelAway<T>(
  host: HTMLElement,
  run: () => Promise<T>,
): Promise<T> {
  setPanelHidden(host, true);
  const resumePush = suspendPagePush();
  try {
    return await run();
  } finally {
    resumePush();
    setPanelHidden(host, false);
  }
}

// Selects a region and captures it in one step. Resolves null when the
// user cancels; never throws - a failure comes back as { error }. The
// selection rectangle is in the full-width page's viewport coordinates,
// which is exactly what captureVisibleTab then captures.
export async function captureRegion(
  host: HTMLElement,
): Promise<CaptureResult | null> {
  try {
    return await withPanelAway(host, async () => {
      const rect = await selectRegion();
      if (!rect) return null;
      return captureAndCrop(rect);
    });
  } catch (err) {
    console.error("Tagger: screenshot capture failed.", err);
    return { error: String(err) };
  }
}
