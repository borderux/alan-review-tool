(async function () {
  const HOST_ID = "alan-review-tool-host";
  const OVERLAY_ID = "alan-review-tool-selection-overlay";
  const WIDTH_STORAGE_KEY = "alanReviewToolPanelWidth";
  const SESSION_STORAGE_KEY = "alanReviewToolSession";
  const DEFAULT_WIDTH = 320;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 720;
  const html = document.documentElement;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const CAMERA_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>`;

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

  const stored = await chrome.storage.local.get([WIDTH_STORAGE_KEY, SESSION_STORAGE_KEY]);
  let panelWidth = clamp(stored[WIDTH_STORAGE_KEY] ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);

  // A single object under one key, not chrome.storage.local per comment:
  // this needs to work across every domain a review touches (that's the
  // whole "any site" pitch), and a content script's own page-scoped
  // localStorage is isolated per origin - it wouldn't see comments from a
  // different site at all. chrome.storage.local is shared across every
  // page this extension runs on, regardless of origin.
  let session = stored[SESSION_STORAGE_KEY] || null;
  // Which comment (if any) shows as the live textarea "stack top" rather
  // than a read-only entry. Always starts null on a fresh injection - only
  // clicking "+ New comment" activates one, even if this page already has
  // comments from a previous visit.
  let activeCommentId = null;
  let captureError = null;

  function currentPageKey() {
    return location.origin + location.pathname + location.search;
  }

  function getPageComments() {
    if (!session) return [];
    return session.pages[currentPageKey()] || [];
  }

  function totalCommentCount() {
    if (!session) return 0;
    return Object.values(session.pages).reduce((sum, list) => sum + list.length, 0);
  }

  function saveSession() {
    if (session) chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
    else chrome.storage.local.remove(SESSION_STORAGE_KEY);
  }

  // Structural changes (new/deleted comment, capture, clear) save
  // immediately - they already trigger a render(), so there's no
  // keystroke-rate concern. Plain typing goes through this instead: saving
  // on every keystroke would hammer chrome.storage.local for no benefit,
  // since "never lost" only needs to survive a pause in typing, not every
  // single character.
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 400);
  }

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
  // of filling the host.
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

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function deleteComment(id) {
    const key = currentPageKey();
    const list = session?.pages[key];
    if (!list) return;
    const index = list.findIndex((c) => c.id === id);
    if (index !== -1) list.splice(index, 1);
    if (activeCommentId === id) activeCommentId = null;
    saveSession();
    render();
  }

  async function handleCapture(comment) {
    captureError = null;
    try {
      const rect = await selectRegion();
      if (rect) {
        const result = await captureAndCrop(rect);
        if (result.error) captureError = result.error;
        else comment.screenshot = result.dataUrl;
      }
    } catch (err) {
      // Whatever broke, the panel must still re-render with the reason
      // visible - a swallowed exception here is indistinguishable from
      // the button doing nothing at all.
      console.error("Alan Review Tool: screenshot capture failed.", err);
      captureError = String(err);
    }
    saveSession();
    render();
  }

  function handleNewComment() {
    if (!session) session = { startedAt: Date.now(), pages: {} };
    const key = currentPageKey();
    if (!session.pages[key]) session.pages[key] = [];
    const comment = { id: Date.now(), text: "", screenshot: null };
    // Newest first - the previously-active comment (if any) automatically
    // becomes "just another entry" in the read-only list below once this
    // one takes over as active, with no separate reordering step needed.
    session.pages[key].unshift(comment);
    activeCommentId = comment.id;
    captureError = null;
    saveSession();
    render();
  }

  // Delegated and attached once, here, rather than in wireEvents(): render()
  // replaces panelRoot's entire innerHTML on every state change, which
  // would tear down and re-add a direct listener each time. shadow itself
  // never gets replaced, so a listener on it survives every render - the
  // same reasoning covers "input" below for live text edits.
  shadow.addEventListener("click", (event) => {
    const thumb = event.target.closest(".thumb");
    if (thumb) {
      openLightbox(thumb.src);
      return;
    }

    // The active comment's X clears its draft in place rather than
    // deleting it - the slot stays active and ready for input again. A
    // read-only comment's X is a real delete, since there's no "draft" to
    // go back to once it's no longer the one being actively edited.
    const clearActiveBtn = event.target.closest(".delete-active");
    if (clearActiveBtn) {
      const comment = getPageComments().find((c) => c.id === activeCommentId);
      if (comment) {
        comment.text = "";
        comment.screenshot = null;
        captureError = null;
        saveSession();
        render();
      }
      return;
    }

    const deleteBtn = event.target.closest(".delete-comment");
    if (deleteBtn) {
      deleteComment(Number(deleteBtn.dataset.id));
      return;
    }

    const captureIconBtn = event.target.closest(".capture-btn-icon");
    if (captureIconBtn) {
      const comment = getPageComments().find((c) => c.id === activeCommentId);
      if (comment) handleCapture(comment);
    }
  });

  shadow.addEventListener("input", (event) => {
    const activeText = event.target.closest("#active-comment-text");
    if (activeText) {
      const comment = getPageComments().find((c) => c.id === activeCommentId);
      if (comment) {
        comment.text = activeText.value;
        scheduleSave();
      }
      return;
    }

    const readonlyText = event.target.closest(".readonly-text");
    if (readonlyText) {
      const comment = getPageComments().find((c) => String(c.id) === readonlyText.dataset.id);
      if (comment) {
        comment.text = readonlyText.textContent;
        scheduleSave();
      }
    }
  });

  function buildReportHtml() {
    const pagesHtml = Object.entries(session?.pages || {})
      .filter(([, list]) => list.length > 0)
      .map(([pageUrl, list]) => {
        const commentsHtml = list
          .map(
            (comment, index) => `<div class="comment">
<h3>Comment ${index + 1}</h3>
<p>${escapeHtml(comment.text).replace(/\n/g, "<br>")}</p>
${comment.screenshot ? `<img src="${comment.screenshot}">` : ""}
</div>`,
          )
          .join("\n");
        return `<h2>${escapeHtml(pageUrl)}</h2>\n${commentsHtml}`;
      })
      .join("\n");

    const totalCount = totalCommentCount();
    return `<!doctype html>
<html>
<body>
<h1>Feedback session</h1>
<p>Started ${session ? new Date(session.startedAt).toLocaleString() : "-"} — ${totalCount} comment${totalCount === 1 ? "" : "s"} across ${Object.keys(session?.pages || {}).length} page${Object.keys(session?.pages || {}).length === 1 ? "" : "s"}</p>
${pagesHtml}
</body>
</html>
`;
  }

  function downloadReport() {
    const blob = new Blob([buildReportHtml()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alan-review-session-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderActiveComment(comment) {
    return `
      <div class="active-comment">
        <button class="delete-active" type="button" data-id="${comment.id}" title="Clear this comment">×</button>
        <textarea id="active-comment-text" placeholder="What's the feedback?">${escapeHtml(comment.text)}</textarea>
        ${
          comment.screenshot
            ? `<img class="thumb" src="${comment.screenshot}" alt="Captured region" />`
            : `<button class="capture-btn-icon" type="button" title="Capture screenshot">${CAMERA_SVG}</button>`
        }
      </div>
      ${captureError ? `<p class="capture-error">Couldn't capture a screenshot: ${escapeHtml(captureError)}</p>` : ""}
    `;
  }

  function renderReadOnlyComment(comment) {
    return `
      <div class="comment-item">
        <button class="delete-comment" type="button" data-id="${comment.id}" title="Delete this comment">×</button>
        <div class="readonly-text" data-id="${comment.id}" contenteditable="true">${escapeHtml(comment.text)}</div>
        ${comment.screenshot ? `<img class="thumb" src="${comment.screenshot}" alt="Captured region" />` : ""}
      </div>
    `;
  }

  function render() {
    const pageComments = getPageComments();
    const activeComment = pageComments.find((c) => c.id === activeCommentId) || null;
    const readOnlyComments = pageComments.filter((c) => c.id !== activeCommentId);
    const totalCount = totalCommentCount();

    panelRoot.innerHTML = `
      <div class="resizer"></div>
      <div class="panel">
        <div class="panel-header">
          <h2>Alan Review Tool</h2>
          <button id="close" type="button">Close</button>
        </div>

        <div class="session-info">
          <div class="session-text">
            ${
              session
                ? `<p>Session started ${new Date(session.startedAt).toLocaleString()}</p>
                   <p>${totalCount} comment${totalCount === 1 ? "" : "s"}</p>`
                : `<p>No active session yet</p>`
            }
          </div>
          <div class="session-actions">
            <button id="clear-session" type="button" ${session ? "" : "disabled"}>Clear Session</button>
            <button id="download-report" type="button" ${totalCount ? "" : "disabled"}>Download report</button>
          </div>
        </div>

        <button id="new-comment" type="button">+ New comment</button>

        ${activeComment ? renderActiveComment(activeComment) : ""}

        <div class="comments">
          ${readOnlyComments.map(renderReadOnlyComment).join("")}
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

    shadow.getElementById("new-comment").addEventListener("click", handleNewComment);

    shadow.getElementById("clear-session")?.addEventListener("click", () => {
      if (!confirm("Clear the current session? This removes every comment across every page.")) return;
      session = null;
      activeCommentId = null;
      saveSession();
      render();
    });

    shadow.getElementById("download-report")?.addEventListener("click", downloadReport);

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
    // real space. 0.85 keeps text legible; PNG's lossless fidelity was
    // never load-bearing for a review screenshot.
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.85) };
  }

  render();
})();
