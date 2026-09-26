(async function () {
  const HOST_ID = "alan-review-tool-host";
  const OVERLAY_ID = "alan-review-tool-selection-overlay";
  const WIDTH_STORAGE_KEY = "alanReviewToolPanelWidth";
  const SESSION_STORAGE_KEY = "alanReviewToolSession";
  const USER_STORAGE_KEY = "alanReviewToolUser";
  const EMAIL_STORAGE_KEY = "alanReviewToolEmail";
  const DEFAULT_WIDTH = 320;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 720;
  const html = document.documentElement;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const CAMERA_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>`;
  // Replaced by build.js with the real contents of src/report.css - kept
  // as its own source file rather than a hand-maintained string here, so
  // report styling can be edited (and linted) like any other stylesheet.
  const REPORT_CSS = "__REPORT_CSS_PLACEHOLDER__";
  // Same inlining pattern as REPORT_CSS, for src/ai-report-instructions.txt -
  // kept as its own real text file rather than a string buried in here.
  const AI_INSTRUCTIONS = "__AI_INSTRUCTIONS_PLACEHOLDER__";

  // crypto.randomUUID() needs a secure context - fine on https, but this
  // extension's whole pitch is "works on any site", including plain http
  // ones, where randomUUID doesn't exist even though crypto itself does.
  // getRandomValues() isn't restricted that way, so it's the fallback
  // instead of reaching for Math.random().
  function generateGuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
      return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues)
      crypto.getRandomValues(bytes);
    else
      for (let i = 0; i < 16; i += 1)
        bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  function formatCommentId(n) {
    return `CM-${n}`;
  }

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

  const stored = await chrome.storage.local.get([
    WIDTH_STORAGE_KEY,
    SESSION_STORAGE_KEY,
    USER_STORAGE_KEY,
    EMAIL_STORAGE_KEY,
  ]);
  let panelWidth = clamp(
    stored[WIDTH_STORAGE_KEY] ?? DEFAULT_WIDTH,
    MIN_WIDTH,
    MAX_WIDTH,
  );

  // A single object under one key, not chrome.storage.local per comment:
  // this needs to work across every domain a review touches (that's the
  // whole "any site" pitch), and a content script's own page-scoped
  // localStorage is isolated per origin - it wouldn't see comments from a
  // different site at all. chrome.storage.local is shared across every
  // page this extension runs on, regardless of origin.
  let session = stored[SESSION_STORAGE_KEY] || null;
  // Sessions saved before pages gained a `title` (back when session.pages[key]
  // was just a comments array) are still sitting in real users' storage -
  // normalize them in place so every entry has the new { title, comments }
  // shape before anything else touches session.pages.
  if (session) {
    for (const key of Object.keys(session.pages)) {
      if (Array.isArray(session.pages[key])) {
        session.pages[key] = { title: key, comments: session.pages[key] };
      }
    }
    // Same story for the session guid and the CM-#### counter: sessions
    // saved before this feature existed have neither. Backfill a guid, and
    // assign every already-existing comment a number it never had -
    // oldest first (each page's own array is newest-first, from unshift),
    // so numbering approximates real creation order instead of being
    // arbitrary.
    if (!session.guid) session.guid = generateGuid();
    if (typeof session.commentCounter !== "number") session.commentCounter = 0;
    for (const page of Object.values(session.pages)) {
      for (const comment of [...page.comments].reverse()) {
        if (comment.commentNumber == null) {
          session.commentCounter += 1;
          comment.commentNumber = session.commentCounter;
        }
      }
    }
  }
  // Separate from session entirely, and never cleared by Clear Session:
  // who's reviewing persists across every session, the same way the
  // panel's own width does, since it's an identity fact rather than
  // something scoped to one review.
  let userName = stored[USER_STORAGE_KEY] || "";
  let userEmail = stored[EMAIL_STORAGE_KEY] || "";
  // Every comment renders the same way (contenteditable text, camera
  // button only while it itself has focus and no screenshot yet) - there's
  // no separate "active" comment concept or state to track, since
  // ordering already comes from unshift and focus is just DOM focus.
  let captureError = null;
  // Which comment a capture error belongs to - null means the general
  // "New screenshot" flow (no comment exists yet to attach the message
  // to), otherwise a specific comment's id, so the message renders inside
  // that comment's own card instead.
  let captureErrorCommentId = null;

  function currentPageKey() {
    return location.origin + location.pathname + location.search;
  }

  // Each page entry carries its own title (captured once, the first time
  // a comment touches that page) alongside its comments - the report
  // needs a real page title, not just the URL the page is already keyed
  // by, and document.title can change later (SPA navigation, tab title
  // updates) so it has to be captured at the moment it's still accurate.
  function ensurePageEntry(key) {
    if (!session.pages[key])
      session.pages[key] = { title: document.title, comments: [] };
    return session.pages[key];
  }

  function getPageComments() {
    if (!session) return [];
    return session.pages[currentPageKey()]?.comments || [];
  }

  function totalCommentCount() {
    if (!session) return 0;
    return Object.values(session.pages).reduce(
      (sum, page) => sum + page.comments.length,
      0,
    );
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

  let userSaveTimer = null;
  function scheduleUserInfoSave() {
    clearTimeout(userSaveTimer);
    userSaveTimer = setTimeout(() => {
      chrome.storage.local.set({
        [USER_STORAGE_KEY]: userName,
        [EMAIL_STORAGE_KEY]: userEmail,
      });
    }, 400);
  }

  function ensureSession() {
    if (!session)
      session = {
        startedAt: Date.now(),
        guid: generateGuid(),
        commentCounter: 0,
        pages: {},
        details: "",
      };
  }

  // The counter only ever goes up, even across deletes - CM-#### plus the
  // session guid is meant to be a permanent, never-reused id once a
  // comment's been assigned one, not a position in the current list.
  function nextCommentNumber() {
    session.commentCounter += 1;
    return session.commentCounter;
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

  const LOGO_URL = chrome.runtime.getURL("alan-logo.png");

  const panelRoot = document.createElement("div");
  // A percentage height only resolves against an ancestor with an explicit
  // height - without this, .panel's height: 100% (in content.css) has
  // nothing to resolve against and collapses to its content's size instead
  // of filling the host.
  panelRoot.style.height = "100%";
  shadow.appendChild(panelRoot);

  // Freehand annotation on the lightbox. Drawing happens on a transparent
  // canvas laid exactly over the <img>, in the image's own natural-
  // resolution coordinate space (not its displayed CSS size) so the
  // strokes stay crisp and correctly placed once composited into the
  // full-resolution screenshot - line width is scaled to compensate, so
  // "3px" still means 3 visual px regardless of how much smaller the
  // image displays than its native size.
  function openLightbox(comment) {
    const overlay = document.createElement("div");
    overlay.style.all = "initial";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483647";
    overlay.style.background = "rgba(0, 0, 0, 0.85)";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.gap = "12px";

    const imageWrap = document.createElement("div");
    imageWrap.style.position = "relative";
    imageWrap.style.lineHeight = "0";

    const img = document.createElement("img");
    img.src = comment.screenshot;
    img.style.display = "block";
    img.style.maxWidth = "90vw";
    img.style.maxHeight = "75vh";
    img.style.boxShadow = "0 4px 24px rgba(0, 0, 0, 0.5)";

    const drawCanvas = document.createElement("canvas");
    drawCanvas.style.position = "absolute";
    drawCanvas.style.top = "0";
    drawCanvas.style.left = "0";
    drawCanvas.style.cursor = "crosshair";
    const ctx = drawCanvas.getContext("2d");

    function sizeCanvasToImage() {
      drawCanvas.width = img.naturalWidth;
      drawCanvas.height = img.naturalHeight;
      drawCanvas.style.width = `${img.clientWidth}px`;
      drawCanvas.style.height = `${img.clientHeight}px`;
    }
    imageWrap.appendChild(img);
    imageWrap.appendChild(drawCanvas);

    const buttonRow = document.createElement("div");
    buttonRow.style.display = "flex";
    buttonRow.style.gap = "8px";

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear Annotations";
    for (const btn of [deleteBtn, clearBtn]) {
      btn.style.padding = "6px 12px";
      btn.style.border = "1px solid rgba(255, 255, 255, 0.3)";
      btn.style.borderRadius = "4px";
      btn.style.background = "#1e1e2e";
      btn.style.color = "#fff";
      btn.style.font = "13px system-ui, sans-serif";
    }
    buttonRow.appendChild(deleteBtn);
    buttonRow.appendChild(clearBtn);

    // These buttons live in the light DOM (the overlay is appended to
    // document.documentElement, not the shadow root), so content.css's
    // button:disabled rule never reaches them - the disabled look has to
    // be set by hand instead of relying on the shared stylesheet.
    let hasAnnotation = false;
    function updateClearBtnState() {
      clearBtn.disabled = !hasAnnotation;
      clearBtn.style.opacity = hasAnnotation ? "1" : "0.5";
      clearBtn.style.cursor = hasAnnotation ? "pointer" : "default";
    }
    deleteBtn.style.cursor = "pointer";
    updateClearBtnState();

    overlay.appendChild(imageWrap);
    overlay.appendChild(buttonRow);
    document.documentElement.appendChild(overlay);

    // Only after the image is actually in the rendered tree does
    // img.clientWidth mean anything - checking img.complete and sizing
    // the canvas before this point (even though the data URI had already
    // decoded) measured an unlaid-out element and got 0 every time.
    if (img.complete) sizeCanvasToImage();
    else img.addEventListener("load", sizeCanvasToImage);

    let drawing = false;
    let lastX = 0;
    let lastY = 0;

    function toCanvasPoint(event) {
      const rect = drawCanvas.getBoundingClientRect();
      const scale = drawCanvas.width / rect.width;
      return {
        x: (event.clientX - rect.left) * scale,
        y: (event.clientY - rect.top) * scale,
        scale,
      };
    }

    drawCanvas.addEventListener("mousedown", (event) => {
      drawing = true;
      const p = toCanvasPoint(event);
      lastX = p.x;
      lastY = p.y;
    });
    drawCanvas.addEventListener("mousemove", (event) => {
      if (!drawing) return;
      const p = toCanvasPoint(event);
      ctx.strokeStyle = "#00ffff";
      ctx.lineWidth = 3 * p.scale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastX = p.x;
      lastY = p.y;
      if (!hasAnnotation) {
        hasAnnotation = true;
        updateClearBtnState();
      }
    });
    function stopDrawing() {
      drawing = false;
    }
    drawCanvas.addEventListener("mouseup", stopDrawing);
    drawCanvas.addEventListener("mouseleave", stopDrawing);

    clearBtn.addEventListener("click", () => {
      ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      hasAnnotation = false;
      updateClearBtnState();
    });

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown, true);
    }

    deleteBtn.addEventListener("click", () => {
      comment.screenshot = null;
      saveSession();
      close();
      render();
    });

    // Dismissing (clicking the dark background, not the image or the
    // buttons) bakes whatever's drawn into the actual image permanently -
    // from that point on it's just pixels, not an editable annotation
    // layer, so reopening the lightbox later has nothing left to clear.
    function bakeAndClose() {
      const bakeCanvas = document.createElement("canvas");
      bakeCanvas.width = img.naturalWidth;
      bakeCanvas.height = img.naturalHeight;
      const bctx = bakeCanvas.getContext("2d");
      bctx.drawImage(img, 0, 0);
      bctx.drawImage(drawCanvas, 0, 0);
      comment.screenshot = bakeCanvas.toDataURL("image/jpeg", 0.9);
      saveSession();
      close();
      render();
    }

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) bakeAndClose();
    });

    // Escape is a plain cancel, same as it is for the drag-select overlay
    // elsewhere - it discards whatever's been drawn rather than baking it.
    function onKeyDown(event) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown, true);
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function deleteComment(id) {
    const key = currentPageKey();
    const list = session?.pages[key]?.comments;
    if (!list) return;
    const index = list.findIndex((c) => c.id === id);
    if (index !== -1) list.splice(index, 1);
    saveSession();
    render();
  }

  function focusAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // A render() rebuilds every comment's markup from scratch, so a comment
  // created a moment ago has to be re-found by id afterward rather than
  // held onto as a DOM reference.
  function focusCommentById(id) {
    const el = shadow.querySelector(`.comment-text[data-id="${id}"]`);
    if (el) focusAtEnd(el);
  }

  // Clicking the camera button, or starting the drag-select overlay
  // (outside the shadow root entirely), both blur the comment's text -
  // the empty-comment cleanup below has to know a capture is under way so
  // it doesn't delete a comment out from under itself before the user
  // even finishes selecting a region.
  let captureInProgress = false;

  async function handleCapture(comment) {
    captureInProgress = true;
    captureError = null;
    captureErrorCommentId = comment.id;
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
    captureInProgress = false;
    saveSession();
    render();
    if (!captureError) focusCommentById(comment.id);
  }

  function handleNewComment() {
    ensureSession();
    const key = currentPageKey();
    const comment = {
      id: Date.now(),
      commentNumber: nextCommentNumber(),
      text: "",
      screenshot: null,
    };
    // Newest first - every comment renders the same way regardless of
    // position, so nothing else needs to change about the rest of the list.
    ensurePageEntry(key).comments.unshift(comment);
    captureError = null;
    captureErrorCommentId = null;
    saveSession();
    render();
    focusCommentById(comment.id);
  }

  // Captures first, then creates the comment - if the user cancels the
  // drag-select (Escape, or too small to count), nothing gets added at
  // all, since the entire point of this button is the screenshot itself.
  async function handleNewScreenshot() {
    captureError = null;
    captureErrorCommentId = null;
    try {
      const rect = await selectRegion();
      if (!rect) return;
      const result = await captureAndCrop(rect);
      if (result.error) {
        captureError = result.error;
        render();
        return;
      }
      ensureSession();
      const key = currentPageKey();
      const comment = {
        id: Date.now(),
        commentNumber: nextCommentNumber(),
        text: "",
        screenshot: result.dataUrl,
      };
      ensurePageEntry(key).comments.unshift(comment);
      saveSession();
      render();
      focusCommentById(comment.id);
    } catch (err) {
      console.error("Alan Review Tool: screenshot capture failed.", err);
      captureError = String(err);
      render();
    }
  }

  // Copy is left alone (it already works natively) - only paste is
  // intercepted, and deliberately ignores whatever's actually on the
  // clipboard: the "copy, then paste" gesture is a shortcut for
  // duplicating the focused comment itself, not a real data transfer.
  function duplicateComment(source) {
    if (!source) return;
    const key = currentPageKey();
    const duplicate = {
      id: Date.now(),
      commentNumber: nextCommentNumber(),
      text: source.text,
      screenshot: source.screenshot,
    };
    ensurePageEntry(key).comments.unshift(duplicate);
    captureError = null;
    captureErrorCommentId = null;
    saveSession();
    render();
    focusCommentById(duplicate.id);
  }

  // Delegated and attached once, here, rather than in wireEvents(): render()
  // replaces panelRoot's entire innerHTML on every state change, which
  // would tear down and re-add a direct listener each time. shadow itself
  // never gets replaced, so a listener on it survives every render - the
  // same reasoning covers "input" below for live text edits.
  shadow.addEventListener("click", (event) => {
    const thumb = event.target.closest(".thumb");
    if (thumb) {
      const comment = getPageComments().find(
        (c) => String(c.id) === thumb.dataset.id,
      );
      if (comment) openLightbox(comment);
      return;
    }

    const deleteBtn = event.target.closest(".delete-comment");
    if (deleteBtn) {
      deleteComment(Number(deleteBtn.dataset.id));
      return;
    }

    const captureIconBtn = event.target.closest(".capture-btn-icon");
    if (captureIconBtn) {
      const comment = getPageComments().find(
        (c) => String(c.id) === captureIconBtn.dataset.id,
      );
      if (comment) handleCapture(comment);
      return;
    }

    // Clicking anywhere in a comment's card - not just precisely on its
    // text - focuses it with the cursor at the end, so continuing to add
    // to an existing comment doesn't require a precise click.
    const card = event.target.closest(".comment-item");
    if (card) {
      const textEl = card.querySelector(".comment-text");
      if (textEl) focusAtEnd(textEl);
      return;
    }

    // Clicking the panel's own empty background - not any specific
    // control - behaves like "+ New comment", a quicker way to start one
    // than aiming for a small button. Checked by identity (is the click
    // target literally the container itself) rather than "nothing else
    // matched", so it can never fire for a click on session-info or the
    // toolbar buttons, which have their own dedicated handlers elsewhere.
    if (
      event.target === shadow.querySelector(".panel") ||
      event.target === shadow.querySelector(".comments")
    ) {
      handleNewComment();
    }
  });

  // A blur/focusout on an empty, screenshot-less comment removes it -
  // clicking to start a comment and then clicking away without adding
  // anything shouldn't leave a permanent empty entry behind. focusout
  // (not blur) because delegation needs it to bubble, which blur doesn't.
  shadow.addEventListener("focusout", (event) => {
    if (captureInProgress) return;
    const textEl = event.target.closest(".comment-text");
    if (!textEl) return;
    // Focus moving to the camera/delete button within the SAME card isn't
    // really "leaving" the comment - only clean up once it genuinely does.
    const card = textEl.closest(".comment-item");
    if (event.relatedTarget && card?.contains(event.relatedTarget)) return;

    const comment = getPageComments().find(
      (c) => String(c.id) === textEl.dataset.id,
    );
    if (comment && !comment.text.trim() && !comment.screenshot)
      deleteComment(comment.id);
  });

  shadow.addEventListener("paste", (event) => {
    const target = event.target.closest(".comment-text");
    if (!target) return;
    event.preventDefault();

    const source = getPageComments().find(
      (c) => String(c.id) === target.dataset.id,
    );
    duplicateComment(source);
  });

  // A contenteditable doesn't store line breaks as "\n" - pressing Enter
  // wraps each new line in its own <div> ("line one<div>line two</div>"),
  // and .textContent just concatenates every descendant text node with no
  // separator between them, silently losing every line break. Walking the
  // tree and inserting "\n" at each block boundary (and for a literal
  // <br>) reconstructs what the user actually typed.
  function getTextWithLineBreaks(el) {
    let text = "";
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.nodeValue;
        return;
      }
      if (node.nodeName === "BR") {
        text += "\n";
        return;
      }
      const isBlock = node.nodeName === "DIV" || node.nodeName === "P";
      if (isBlock && text.length > 0 && !text.endsWith("\n")) text += "\n";
      for (const child of node.childNodes) walk(child);
    }
    for (const child of el.childNodes) walk(child);
    // An empty contenteditable's only child is often a placeholder <br>,
    // which the walk above turns into a bare "\n" - that's not a real
    // line break, just how the browser keeps an empty div focusable.
    return text === "\n" ? "" : text;
  }

  shadow.addEventListener("input", (event) => {
    const textEl = event.target.closest(".comment-text");
    if (textEl) {
      const comment = getPageComments().find(
        (c) => String(c.id) === textEl.dataset.id,
      );
      if (comment) {
        comment.text = getTextWithLineBreaks(textEl);
        scheduleSave();
      }
      return;
    }

    if (event.target.id === "user-name-input") {
      userName = event.target.value;
      scheduleUserInfoSave();
      return;
    }

    if (event.target.id === "user-email-input") {
      userEmail = event.target.value;
      scheduleUserInfoSave();
      return;
    }

    if (event.target.id === "session-details") {
      // The FIRST keystroke into details with no session yet silently
      // created one behind the Clear Session/Download buttons' backs -
      // their disabled attribute (and the "No active session yet" text)
      // was set at the last render(), which happened before a session
      // existed, and nothing here was updating it since typing
      // deliberately skips render() to preserve focus. A full render()
      // only on this one-time null-to-existing transition, refocusing
      // afterward, fixes it without re-rendering on every keystroke.
      const isNewSession = !session;
      ensureSession();
      session.details = event.target.value;
      scheduleSave();
      if (isNewSession) {
        render();
        const detailsEl = shadow.getElementById("session-details");
        if (detailsEl) {
          detailsEl.focus();
          detailsEl.setSelectionRange(
            detailsEl.value.length,
            detailsEl.value.length,
          );
        }
      } else {
        autoGrowTextarea(event.target);
      }
    }
  });

  function buildReportHtml() {
    const pages = Object.entries(session?.pages || {}).filter(
      ([, page]) => page.comments.length > 0,
    );
    const totalCount = totalCommentCount();
    const pageCount = pages.length;

    // Global across the whole report, not per-page, so two different
    // pages' anchors can never collide.
    let shotIndex = 0;
    const lightboxTargets = [];

    const tocHtml = pages
      .map(
        ([url], i) =>
          `<li><a href="#page-${i}">${escapeHtml(url.split("?")[0])}</a></li>`,
      )
      .join("\n");

    const pagesHtml = pages
      .map(([url, page], i) => {
        const commentsHtml = page.comments
          .map((comment) => {
            let shotsHtml = "";
            // Only comments carry a screenshot (a single one, since
            // comments were simplified back to one shot each) - the
            // lightbox target lives at the end of the document; :target
            // matching doesn't care where in the DOM it sits.
            if (comment.screenshot) {
              const shotId = `shot-${shotIndex}`;
              shotIndex += 1;
              shotsHtml = `<div class="comment-shots"><a href="#${shotId}" class="shot-thumb-link"><img class="shot-thumb" src="${comment.screenshot}" alt="Screenshot" /></a></div>`;
              lightboxTargets.push(
                `<a href="#_" id="${shotId}" class="lightbox"><img src="${comment.screenshot}" alt="Screenshot" /></a>`,
              );
            }
            // The visible CM-#### id plus the hidden session guid (in the
            // head, once) together make a globally unique id per comment -
            // shown here since that's the ask, unlike the guid itself.
            const commentId =
              comment.commentNumber != null
                ? formatCommentId(comment.commentNumber)
                : "";
            return `<div class="comment" data-comment-id="${escapeHtml(commentId)}"><div class="comment-body">${commentId ? `<p class="comment-id">${escapeHtml(commentId)}</p>` : ""}<p class="comment-text">${escapeHtml(comment.text).replace(/\n/g, "<br>")}</p></div>${shotsHtml}</div>`;
          })
          .join("\n");

        // url is the full page key (origin + pathname + search) - that's
        // exactly what the report should link to, but the visible text
        // drops the search params so the link doesn't read as a wall of
        // query-string noise.
        const urlWithoutSearch = url.split("?")[0];
        return `<div class="page-section" id="page-${i}">
<p class="page-url"><a href="${escapeHtml(url)}">${escapeHtml(urlWithoutSearch)}</a></p>
${commentsHtml}
</div>`;
      })
      .join("\n");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Feedback session</title>
${session?.guid ? `<meta name="alan-review-session-id" content="${escapeHtml(session.guid)}">` : ""}
<meta name="ai-report-instructions" content="${escapeHtml(AI_INSTRUCTIONS)}">
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="report-header">
<h1>Feedback session</h1>
<p class="report-meta">Started ${session ? new Date(session.startedAt).toLocaleString() : "-"} — ${totalCount} comment${totalCount === 1 ? "" : "s"} across ${pageCount} page${pageCount === 1 ? "" : "s"}</p>
${userName ? `<p class="report-meta">Reviewer: ${escapeHtml(userName)}</p>` : ""}
${userEmail ? `<p class="report-meta">Email: ${escapeHtml(userEmail)}</p>` : ""}
${session?.details ? `<p class="report-meta">Details: ${escapeHtml(session.details)}</p>` : ""}
</div>
<nav class="toc">
<h2>Pages reviewed</h2>
<ol>
${tocHtml}
</ol>
</nav>
${pagesHtml}
${lightboxTargets.join("\n")}
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

  // Every comment - newest or not - renders identically: a card with the
  // same upper-right delete X, click-anywhere-to-edit text, and a
  // lower-right camera/thumbnail slot. There's no longer a distinct
  // "active" comment component; which one shows its camera button is
  // driven entirely by :focus-within in content.css, not by JS state.
  function renderComment(comment) {
    return `
      <div class="comment-item">
        <button class="delete-comment round-btn round-btn-grey" type="button" data-id="${comment.id}" title="Delete this comment">×</button>
        <div class="comment-text" data-id="${comment.id}" contenteditable="true">${escapeHtml(comment.text)}</div>
        ${
          comment.screenshot
            ? `<img class="thumb" src="${comment.screenshot}" alt="Captured region" data-id="${comment.id}" />`
            : `<button class="capture-btn-icon" type="button" data-id="${comment.id}" title="Capture screenshot">${CAMERA_SVG}</button>`
        }
        ${
          captureError && captureErrorCommentId === comment.id
            ? `<p class="capture-error">Couldn't capture a screenshot: ${escapeHtml(captureError)}</p>`
            : ""
        }
      </div>
    `;
  }

  function render() {
    const pageComments = getPageComments();
    const totalCount = totalCommentCount();

    panelRoot.innerHTML = `
      <div class="resizer"></div>
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <img src="${LOGO_URL}" alt="" class="logo" />
            <h2>ALAN review tool</h2>
          </div>
          <button id="close" type="button" class="round-btn round-btn-grey" title="Close">×</button>
        </div>

        <div class="session-info">
          <div class="session-top">
            <div class="session-text">
              ${
                session
                  ? `<p>Session started ${new Date(session.startedAt).toLocaleString()}</p>
                     <p>${totalCount} comment${totalCount === 1 ? "" : "s"}</p>`
                  : `<p>No active session yet</p>`
              }
              <label class="field-row">
                <span>User:</span>
                <input type="text" id="user-name-input" value="${escapeHtml(userName)}" placeholder="Your name" />
              </label>
              <label class="field-row">
                <span>Email:</span>
                <input type="text" id="user-email-input" value="${escapeHtml(userEmail)}" placeholder="you@example.com" />
              </label>
            </div>
            <div class="session-actions">
              <button id="clear-session" type="button" ${session ? "" : "disabled"}>Clear Session</button>
              <button id="download-report" type="button" ${totalCount ? "" : "disabled"}>Download report</button>
            </div>
          </div>
          <textarea id="session-details" placeholder="Session details (what's being reviewed, context, etc.)">${escapeHtml(session?.details || "")}</textarea>
        </div>

        <div class="toolbar">
          <button id="new-comment" type="button">+ New comment</button>
          <button id="new-screenshot" type="button">+ New screenshot</button>
        </div>

        ${
          captureError && captureErrorCommentId === null
            ? `<p class="capture-error">Couldn't capture a screenshot: ${escapeHtml(captureError)}</p>`
            : ""
        }

        <div class="comments">
          ${pageComments.map(renderComment).join("")}
        </div>
      </div>
    `;
    wireEvents();

    // Sized here too, not just on input: a render() can rebuild this
    // textarea around existing multi-line content (e.g. right after
    // Clear Session resets it), and it should already be grown to fit
    // rather than waiting for the next keystroke.
    const detailsEl = shadow.getElementById("session-details");
    if (detailsEl) autoGrowTextarea(detailsEl);
  }

  function autoGrowTextarea(el) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  function wireEvents() {
    shadow.getElementById("close").addEventListener("click", () => {
      host.remove();
      restorePage();
    });

    shadow
      .getElementById("new-comment")
      .addEventListener("click", handleNewComment);
    shadow
      .getElementById("new-screenshot")
      .addEventListener("click", handleNewScreenshot);

    shadow.getElementById("clear-session")?.addEventListener("click", () => {
      if (
        !confirm(
          "Clear the current session? This removes every comment across every page.",
        )
      )
        return;
      session = null;
      saveSession();
      render();
    });

    shadow
      .getElementById("download-report")
      ?.addEventListener("click", downloadReport);

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
        if (event.buttons === 0) {
          // The mouseup that should have ended this drag never reached
          // us - most likely the button was released outside the browser
          // window entirely, which is a real thing users do dragging
          // near a screen edge. A mousemove landing back on the page
          // with no buttons held means it's already been released, so
          // finish here instead of leaving the drag - and the panel,
          // hidden this whole time - stuck forever.
          onMouseUp(event);
          return;
        }
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

      // The buttons===0 check in onMouseMove only recovers once the mouse
      // comes back over the page - if focus leaves the window entirely
      // (alt-tab, clicking another app) and never returns, no mousemove
      // ever fires again. This is the other half of that same safety net.
      function onWindowBlur() {
        cleanup();
        resolve(null);
      }

      function cleanup() {
        overlay.remove();
        host.style.visibility = "visible";
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
        return await chrome.runtime.sendMessage({
          type: "alan-review-tool:capture",
        });
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
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );

    const response = await sendCaptureRequest();
    if (!response?.dataUrl) {
      return {
        error: response?.error || "the background worker returned nothing",
      };
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
