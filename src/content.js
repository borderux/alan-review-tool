(function () {
  const HOST_ID = "alan-review-tool-host";
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.right = "0";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const isFirefox = navigator.userAgent.includes("Firefox");

  shadow.innerHTML = `
    <style>
      .panel {
        font-family: system-ui, sans-serif;
        width: 280px;
        height: 100vh;
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
    <div class="panel">
      <h2>Alan Review Tool</h2>
      <p>Injected on: ${location.hostname}</p>
      <p>Browser: ${isFirefox ? "Firefox" : "Chromium-based"}</p>
      <button id="close">Close</button>
    </div>
  `;
  shadow.getElementById("close").addEventListener("click", () => host.remove());
})();
