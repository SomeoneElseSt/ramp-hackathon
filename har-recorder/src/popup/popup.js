const send = (msg) => chrome.runtime.sendMessage(msg);

const els = {
  dot: document.getElementById("dot"),
  status: document.getElementById("status"),
  start: document.getElementById("start"),
  stop: document.getElementById("stop"),
  exportBtn: document.getElementById("export"),
  clear: document.getElementById("clear"),
  tabList: document.getElementById("tabList"),
  scopeBox: document.getElementById("scopeBox"),
  listenerList: document.getElementById("listenerList"),
  listenerEmpty: document.getElementById("listenerEmpty"),
};

function selectedScopeMode() {
  return document.querySelector('input[name="scope"]:checked')?.value || "window";
}

function shortUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 40 ? u.pathname.slice(0, 37) + "…" : u.pathname;
    return u.host + path;
  } catch {
    return String(url).slice(0, 48);
  }
}

async function renderTabs() {
  const mode = selectedScopeMode();
  els.tabList.classList.toggle("hidden", mode !== "tabs");
  if (mode !== "tabs") return;
  const { tabs = [] } = await send({ type: "list-tabs" });
  els.tabList.innerHTML = "";
  for (const t of tabs) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = String(t.id);
    cb.dataset.tabId = String(t.id);
    const span = document.createElement("span");
    span.className = "t";
    span.textContent = t.title || t.url || `Tab ${t.id}`;
    span.title = t.url || "";
    li.append(cb, span);
    els.tabList.appendChild(li);
  }
}

function renderListeners(listening) {
  const items = Array.isArray(listening) ? listening : [];
  els.listenerList.innerHTML = "";
  const has = items.length > 0;
  els.listenerList.classList.toggle("hidden", !has);
  els.listenerEmpty.classList.toggle("hidden", has);
  for (const w of items) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = w.label || w.subId || "listener";
    const page = document.createElement("span");
    page.className = "page";
    page.textContent = shortUrl(w.pageUrl) || "page pending";
    page.title = w.pageUrl || "";
    li.append(label, page);
    els.listenerList.appendChild(li);
  }
}

async function render() {
  const s = await send({ type: "get-state" });
  const rec = !!s.recording;
  const connected = !!s.daemonConnected;
  const listening = s.listening || [];
  const nTabs = s.attached?.length || 0;

  if (rec) {
    els.dot.className = "dot rec";
    els.dot.title = "ambient on";
  } else if (!connected) {
    els.dot.className = "dot off";
    els.dot.title = "daemon offline";
  } else {
    els.dot.className = "dot idle";
    els.dot.title = "ambient off";
  }

  const daemonLine = connected
    ? `<b>Daemon connected</b> · localhost:8787`
    : `<b>Daemon offline</b> · start with <code>cd daemon && npm run dev</code>`;

  let ambientLine;
  if (rec) {
    const listenBit =
      listening.length > 0
        ? ` · <b>${listening.length}</b> listener${listening.length === 1 ? "" : "s"}`
        : " · discovering as you browse";
    ambientLine = `<b>Ambient on</b> · ${nTabs} tab${nTabs === 1 ? "" : "s"}${listenBit}`;
  } else {
    ambientLine = `Ambient off · sit on a window to capture while you work`;
  }

  els.status.innerHTML =
    `<span class="line">${daemonLine}</span>` +
    `<span class="line">${ambientLine}</span>`;

  renderListeners(listening);

  els.start.disabled = rec;
  els.stop.disabled = !rec;
  els.scopeBox.disabled = rec;
}

els.start.onclick = async () => {
  const mode = selectedScopeMode();
  let scope = { mode: "window" };
  if (mode === "window") {
    const { currentWindow } = await send({ type: "list-tabs" });
    scope = { mode: "window", windowId: currentWindow };
  } else {
    const tabIds = [...els.tabList.querySelectorAll("input:checked")].map((c) => Number(c.value));
    if (!tabIds.length) {
      alert("Select at least one tab.");
      return;
    }
    scope = { mode: "tabs", tabIds };
  }
  const res = await send({ type: "start", scope });
  if (!res?.ok) alert("Could not start ambient: " + (res?.error || "unknown"));
  render();
};

els.stop.onclick = async () => {
  await send({ type: "stop" });
  render();
};

els.clear.onclick = async () => {
  if (confirm("Clear the local capture buffer?")) {
    await send({ type: "clear" });
    render();
  }
};

els.exportBtn.onclick = async () => {
  els.exportBtn.disabled = true;
  els.exportBtn.textContent = "Exporting…";
  try {
    const res = await send({ type: "export" });
    if (!res?.ok) throw new Error(res?.error || "export failed");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download(res.artifacts.har, `network-${stamp}.har`);
    download(res.artifacts.trace, `activity-trace-${stamp}.json`);
    download(res.artifacts.summary, `activity-summary-${stamp}.json`);
  } catch (e) {
    alert("Export error: " + (e.message || e));
  } finally {
    els.exportBtn.disabled = false;
    els.exportBtn.textContent = "Export";
  }
};

function download(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

for (const r of document.querySelectorAll('input[name="scope"]')) {
  r.onchange = renderTabs;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "state-changed") render();
});

renderTabs();
render();
