// listening-overlay.js — subtle top gradient when Tama is ambient on this tab.
// pointer-events: none; no focus steal. Idempotent; hide on wf-stop / tama-overlay-hide.
(() => {
  const ROOT_ID = "tama-listening-overlay";
  const STYLE_ID = "tama-listening-overlay-style";

  // Same document re-inject (SW retry) — show again, don't stack listeners.
  if (window.__tamaListeningOverlay) {
    const root = document.getElementById(ROOT_ID);
    if (root) root.setAttribute("data-visible", "1");
    else window.__tamaListeningOverlayShow?.();
    return;
  }
  window.__tamaListeningOverlay = true;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID} {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  z-index: 2147483646;
  pointer-events: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10px;
  background: linear-gradient(
    180deg,
    rgba(232, 98, 155, 0.28) 0%,
    rgba(255, 168, 205, 0.12) 42%,
    rgba(255, 168, 205, 0) 100%
  );
  font: 11px/1.3 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  letter-spacing: 0.06em;
  color: rgba(72, 28, 48, 0.88);
  opacity: 0;
  transition: opacity 0.35s ease;
}
#${ROOT_ID}[data-visible="1"] { opacity: 1; }
#${ROOT_ID} .tama-listening-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 1px 2px rgba(72, 28, 48, 0.08);
  text-transform: none;
  letter-spacing: 0.04em;
}
#${ROOT_ID} .tama-listening-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #e8629b;
  box-shadow: 0 0 0 3px rgba(232, 98, 155, 0.25);
  flex: none;
}
@media (prefers-reduced-motion: reduce) {
  #${ROOT_ID} { transition: none; }
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function show() {
    ensureStyle();
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("role", "status");
      root.setAttribute("aria-live", "polite");
      root.innerHTML =
        `<span class="tama-listening-label">` +
        `<i class="tama-listening-dot" aria-hidden="true"></i>` +
        `Tama is listening on this tab` +
        `</span>`;
      const parent = document.documentElement;
      parent.appendChild(root);
    }
    requestAnimationFrame(() => root.setAttribute("data-visible", "1"));
  }

  function hide() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.setAttribute("data-visible", "0");
    const style = document.getElementById(STYLE_ID);
    const remove = () => {
      root.remove();
      style?.remove();
    };
    root.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 400);
  }

  window.__tamaListeningOverlayShow = show;
  show();

  chrome.runtime.onMessage?.addListener?.((msg) => {
    if (msg?.type === "wf-stop" || msg?.type === "tama-overlay-hide") hide();
    if (msg?.type === "tama-overlay-show") show();
  });
})();
