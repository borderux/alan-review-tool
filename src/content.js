(async function () {
  const HOST_ID = "alan-review-tool-host";
  const OVERLAY_ID = "alan-review-tool-selection-overlay";
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

  // The stylesheet loads once, here, rather than as a <style> block inside
  // render()'s template: render() replaces its target's entire innerHTML on
  // every state change, and a <link> re-added that way would refetch and
  // reapply on every keystroke-triggered re-render, flashing unstyled
  // content each time. panelRoot is what render() actually rewrites;
  // shadow.getElementById/querySelector still work unchanged since they
  // search the whole shadow tree regardless of this extra nesting level.
  const styleLink = document.createElement("link");
  styleLink.rel = "stylesheet";
  styleLink.href = chrome.runtime.getURL("content.css");
  shadow.appendChild(styleLink);

  const panelRoot = document.createElement("div");
  // A percentage height only resolves against an ancestor with an explicit
  // height - without this, .panel's height: 100% (in content.css) has
  // nothing to resolve against and collapses to its content's size instead
  // of filling the host, which is exactly the regression this introduced.
  panelRoot.style.height = "100%";
  shadow.appendChild(panelRoot);

  function openLightbox(src) {
    const overlay = document.createElement("div");
    overlay.style.all = "initial";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.background = "rgba(0, 0, 0, 0.85)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.cursor = "zoom-out";

    const img = document.createElement("img");
    img.src = src;
    img.style.maxWidth = "90vw";
    img.style.maxHeight = "90vh";
    img.style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.5)";
    overlay.appendChild(img);

    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown, true);
    }

    overlay.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown, true);
    document.documentElement.appendChild(overlay);
  }

  // Delegated and attached once, here, rather than in wireEvents(): render()
  // replaces the shadow root's entire innerHTML on every state change, which
  // would tear down and re-add a direct listener each time. The shadow root
  // itself never gets replaced, so a listener on it survives every render.
  function flashButton(buttonEl, label) {
    const original = buttonEl.textContent;
    buttonEl.textContent = label;
    buttonEl.disabled = true;
    setTimeout(() => {
      buttonEl.textContent = original;
      buttonEl.disabled = false;
    }, 1200);
  }

  // Two representations in one ClipboardItem: text/html so a rich target
  // (Docs, Slack, ChatGPT's input, Jira) shows the screenshot inline, and
  // text/plain as a markdown fallback so a plain textarea still gets
  // something legible instead of nothing. See the earlier thread for why
  // this beats a Jira-API-shaped "backbone."
  async function copyCommentToClipboard(comment, buttonEl) {
    // Chrome's navigator.clipboard.write() does not implement multiple
    // ClipboardItems in one call ("Support for multiple ClipboardItems is
    // not implemented" - confirmed directly, not assumed), so text and
    // image can't be offered as two independent clipboard entries the way
    // Word/Docs handle mixed copies. Everything has to live in ONE item as
    // alternative representations, and a paste target picks exactly one of
    // them - which is also the real explanation for ChatGPT showing raw
    // base64 text: it read text/plain rather than rendering the <img> in
    // text/html. Offering image/png directly, rather than only buried
    // inside an <img> tag, at least gives an image-preferring target
    // something to pick that isn't a wall of base64.
    const html = `${comment.text ? `<p>${escapeHtml(comment.text)}</p>` : ""}${comment.screenshots
      .map((shot) => `<img src="${shot}" alt="Screenshot" />`)
      .join("")}`;
    const plain = `${comment.text || ""}${comment.screenshots
      .map((shot) => `\n\n![Screenshot](${shot})`)
      .join("")}`.trim();

    const representations = {
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    };
    // image/png can only ever carry one representation - the platform
    // limitation from the earlier thread, not new here. First shot only;
    // the rest still travel in the html/plain fallbacks above.
    //
    // Also confirmed directly: Chrome's clipboard.write() rejects
    // image/jpeg outright ("Type image/jpeg not supported on write"),
    // regardless of what format the stored screenshot uses. Re-encode to
    // PNG here, on the way out to the clipboard only - the smaller JPEG
    // stays what's actually stored and downloaded.
    if (comment.screenshots.length) {
      const img = await loadImage(comment.screenshots[0]);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      representations["image/png"] = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    }

    try {
      await navigator.clipboard.write([new ClipboardItem(representations)]);
      flashButton(buttonEl, "Copied!");
    } catch (err) {
      console.error("Alan Review Tool: clipboard write failed.", err);
      flashButton(buttonEl, "Copy failed");
    }
  }

  shadow.addEventListener("click", (event) => {
    const thumb = event.target.closest(".thumb");
    if (thumb) {
      openLightbox(thumb.src);
      return;
    }

    const copyBtn = event.target.closest(".copy-btn");
    if (copyBtn) {
      const comment = comments.find((c) => String(c.id) === copyBtn.dataset.id);
      if (comment) copyCommentToClipboard(comment, copyBtn);
      return;
    }

    const removeBtn = event.target.closest(".remove-shot");
    if (removeBtn) {
      const draftText = shadow.getElementById("comment-text")?.value ?? "";
      pendingScreenshots.splice(Number(removeBtn.dataset.index), 1);
      render();
      const textEl = shadow.getElementById("comment-text");
      if (textEl) textEl.value = draftText;
    }
  });

  // In-memory only - lost on close/navigation, same as the rest of this
  // session's state. Persisting a review session across page loads is a
  // separate, bigger feature (see the activeTab-vs-host-permissions thread).
  let comments = [];
  let composerOpen = false;
  let pendingScreenshots = [];
  let captureError = null;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // A single self-contained file sidesteps the whole "which representation
  // does this target pick" problem from the per-comment clipboard button -
  // there's only one thing to hand over, and it carries everything
  // (comments and their inline screenshots) rather than making a paste
  // target choose between them.
  // Markdown's one big win - inline images - turned out to be its problem
  // too: a data URI can't be wrapped across lines without breaking it, so
  // a real screenshot became a single ~90,000-character line, which is
  // exactly the shape that breaks editor tooling like VS Code's preview.
  // Back to HTML, but deliberately minimal - no <style>, no nested
  // wrappers beyond what the structure needs - so it stays easy to parse
  // rather than becoming the styled page the first version was.
  function buildReportHtml() {
    const commentsHtml = comments
      .map((comment, index) => {
        const images = comment.screenshots.map((shot) => `<img src="${shot}">`).join("\n");
        return `<div class="comment">
<h2>Comment ${index + 1}</h2>
<p>${escapeHtml(comment.text).replace(/\n/g, "<br>")}</p>
${images}
</div>`;
      })
      .join("\n");

    return `<!doctype html>
<html>
<body>
<h1>Feedback for ${escapeHtml(location.hostname)}</h1>
<p>Captured ${new Date().toLocaleString()} — ${comments.length} comment${comments.length === 1 ? "" : "s"}</p>
${commentsHtml}
</body>
</html>
`;
  }

  function downloadReport() {
    const blob = new Blob([buildReportHtml()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alan-review-${location.hostname}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderComposer() {
    return `
      <div class="composer">
        <textarea id="comment-text" placeholder="What's the feedback?"></textarea>
        ${
          pendingScreenshots.length
            ? `<div class="shot-row">${pendingScreenshots
                .map(
                  (shot, index) => `
                  <span class="shot-thumb">
                    <img class="thumb" src="${shot}" alt="Captured region" />
                    <button class="remove-shot" type="button" data-index="${index}" title="Remove">×</button>
                  </span>`,
                )
                .join("")}</div>`
            : ""
        }
        ${captureError ? `<p class="capture-error">Couldn't capture a screenshot: ${escapeHtml(captureError)}</p>` : ""}
        <div class="composer-actions">
          <button id="capture-btn" type="button">Capture screenshot</button>
          <button id="save-btn" type="button">Add comment</button>
          <button id="cancel-btn" type="button">Cancel</button>
        </div>
      </div>
    `;
  }

  function renderCommentItem(comment) {
    return `
      <div class="comment-item">
        ${
          comment.screenshots.length
            ? `<div class="shot-row">${comment.screenshots
                .map((shot) => `<img class="thumb" src="${shot}" alt="Captured region" />`)
                .join("")}</div>`
            : ""
        }
        <p>${escapeHtml(comment.text)}</p>
        <button class="copy-btn" type="button" data-id="${comment.id}">Copy to clipboard</button>
      </div>
    `;
  }

  function render() {
    panelRoot.innerHTML = `
      <div class="resizer"></div>
      <div class="panel">
        <div class="panel-header">
          <h2>Alan Review Tool</h2>
          <button id="close" type="button">Close</button>
        </div>
        <p>Injected on: ${location.hostname}</p>
        <p>Browser: ${isFirefox ? "Firefox" : "Chromium-based"}</p>

        ${
          composerOpen
            ? renderComposer()
            : `<div class="toolbar">
                <button id="new-comment" type="button">+ New comment</button>
                <button id="download-report" type="button" ${comments.length ? "" : "disabled"}>Download report</button>
              </div>`
        }

        <div class="comments">
          ${comments.map(renderCommentItem).join("")}
        </div>
      </div>
    `;
    wireEvents();
  }

  function wireEvents() {
    shadow.getElementById("close").addEventListener("click", () => {
      host.remove();
      restorePage();
    });

    shadow.getElementById("new-comment")?.addEventListener("click", () => {
      composerOpen = true;
      pendingScreenshots = [];
      captureError = null;
      render();
    });

    shadow.getElementById("download-report")?.addEventListener("click", downloadReport);

    shadow.getElementById("cancel-btn")?.addEventListener("click", () => {
      composerOpen = false;
      pendingScreenshots = [];
      captureError = null;
      render();
    });

    shadow.getElementById("save-btn")?.addEventListener("click", () => {
      const text = shadow.getElementById("comment-text")?.value.trim() || "";
      if (!text && pendingScreenshots.length === 0) return;
      comments.push({ id: Date.now(), text, screenshots: [...pendingScreenshots] });
      composerOpen = false;
      pendingScreenshots = [];
      render();
    });

    shadow.getElementById("capture-btn")?.addEventListener("click", async () => {
      const draftText = shadow.getElementById("comment-text")?.value ?? "";
      captureError = null;
      try {
        const rect = await selectRegion();
        if (rect) {
          const result = await captureAndCrop(rect);
          if (result.error) captureError = result.error;
          else pendingScreenshots.push(result.dataUrl);
        }
      } catch (err) {
        // Whatever broke, the composer must still re-render with the
        // reason visible - a swallowed exception here is indistinguishable
        // from the button doing nothing at all.
        console.error("Alan Review Tool: screenshot capture failed.", err);
        captureError = String(err);
      }
      render();
      const textEl = shadow.getElementById("comment-text");
      if (textEl) textEl.value = draftText;
    });

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
  }

  // Lets the user drag a rectangle directly on the page (not the panel) and
  // resolves with its viewport coordinates, or null if they cancel (Escape,
  // or too small a drag to count as intentional).
  function selectRegion() {
    return new Promise((resolve) => {
      // Hidden, not removed - the page stays at its pushed width, so the
      // panel's own region is just blank canvas during selection, not page
      // content that would otherwise be unreachable.
      host.style.visibility = "hidden";

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

      function currentRect(event) {
        const x = Math.min(event.clientX, startX);
        const y = Math.min(event.clientY, startY);
        const width = Math.abs(event.clientX - startX);
        const height = Math.abs(event.clientY - startY);
        return { x, y, width, height };
      }

      function onMouseDown(event) {
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        box.style.left = `${startX}px`;
        box.style.top = `${startY}px`;
        box.style.width = "0px";
        box.style.height = "0px";
        box.style.display = "block";
      }

      function onMouseMove(event) {
        if (!dragging) return;
        const rect = currentRect(event);
        box.style.left = `${rect.x}px`;
        box.style.top = `${rect.y}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
      }

      function onMouseUp(event) {
        if (!dragging) return;
        dragging = false;
        const rect = currentRect(event);
        cleanup();
        resolve(rect.width < 4 || rect.height < 4 ? null : rect);
      }

      function onKeyDown(event) {
        if (event.key === "Escape") {
          cleanup();
          resolve(null);
        }
      }

      function cleanup() {
        overlay.remove();
        host.style.visibility = "visible";
        document.removeEventListener("keydown", onKeyDown, true);
      }

      overlay.addEventListener("mousedown", onMouseDown);
      overlay.addEventListener("mousemove", onMouseMove);
      overlay.addEventListener("mouseup", onMouseUp);
      document.addEventListener("keydown", onKeyDown, true);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // The MV3 background service worker unloads after ~30s idle and wakes on
  // the next message - but the message that wakes it can itself lose that
  // race and fail with "Receiving end does not exist" before its listener
  // has finished registering. A short retry almost always lands after it's
  // awake, without needing anything to keep it alive artificially.
  async function sendCaptureRequest(attempts = 3, delayMs = 200) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await chrome.runtime.sendMessage({ type: "alan-review-tool:capture" });
      } catch (err) {
        if (attempt === attempts) throw err;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  async function captureAndCrop(rect) {
    // Give the compositor a couple of frames to actually paint the panel as
    // hidden before the screenshot is taken - otherwise a still-visible
    // panel from the previous frame can end up in the captured pixels.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const response = await sendCaptureRequest();
    if (!response?.dataUrl) {
      return { error: response?.error || "the background worker returned nothing" };
    }

    const dpr = window.devicePixelRatio || 1;
    const img = await loadImage(response.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
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
    // JPEG rather than PNG - a UI screenshot has enough photographic-ish
    // gradients (shadows, anti-aliased text) that lossy compression saves
    // real space, and the base64 bloat was the whole complaint that sent
    // us back from Markdown. 0.85 keeps text legible; PNG's lossless
    // fidelity was never load-bearing for a review screenshot.
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
  }

  render();
})();
