// Tama popup = Tamagotchi from demo/pet-widget.html, wired to ambient get-state
// + daemon viewer WS for semantic wake.

const send = (msg) => chrome.runtime.sendMessage(msg);

const CAT = {
  sleeping: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................",
  ],
  watching: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.", ".XXX..XXXX..XXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................",
  ],
  happy: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.", ".XXXXXXXXXXXXXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX....XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................",
  ],
  distress: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXX.XXXXXX.XXX.", ".XXXX.XXXX.XXXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................",
  ],
  attention: [
    "..X..........X..", "..XX........XX..", "..XXX......XXX..", "..XXXXXXXXXXXX..",
    ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.", ".XXX..XXXX..XXX.", ".XXX..XXXX..XXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................",
  ],
};
const Z = ["XXX", "..X", ".X.", "X..", "XXX"];
const BANG = ["X", "X", "X", ".", "X"];

const W = 20;
const H = 16;
const LCD = "#9bbc0f";
const INK = "#14300f";
const LABEL = {
  sleeping: "asleep · 0 model calls",
  watching: "watching this tab",
  happy: "new event",
  distress: "capture error",
  attention: "needs approval",
};

const lcd = document.getElementById("lcd");
const ctx = lcd.getContext("2d");
const pet = document.getElementById("pet");
const tag = document.getElementById("tag");
const panel = document.getElementById("panel");
const statusLine = document.getElementById("statusLine");
const listenerRows = document.getElementById("listenerRows");
const listenerEmpty = document.getElementById("listenerEmpty");
const eventsEl = document.getElementById("events");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const exportBtn = document.getElementById("export");
const clearBtn = document.getElementById("clear");

let state = "sleeping";
let frame = 0;
let hits = 0;
let ambientOn = false;
let holdHappyUntil = 0;

const blank = () => Array.from({ length: H }, () => Array(W).fill(0));

function blit(b, s, ox, oy) {
  for (let y = 0; y < s.length; y++) {
    for (let x = 0; x < s[y].length; x++) {
      if (s[y][x] !== "X") continue;
      const px = ox + x;
      const py = oy + y;
      if (px >= 0 && px < W && py >= 0 && py < H) b[py][px] = 1;
    }
  }
}

function paint(b) {
  const s = lcd.width / W;
  ctx.fillStyle = LCD;
  ctx.fillRect(0, 0, lcd.width, lcd.height);
  ctx.fillStyle = "rgba(20,48,15,.06)";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) ctx.fillRect(x * s + s - 1, y * s, 1, s);
  }
  ctx.fillStyle = INK;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (b[y][x]) ctx.fillRect(x * s, y * s, s - 1, s - 1);
    }
  }
}

function draw() {
  const b = blank();
  blit(b, CAT[state] || CAT.sleeping, 1, 0);
  if (state === "sleeping") blit(b, Z, 17, 1 + (frame % 2));
  if (state === "attention" || state === "happy") blit(b, BANG, 18, state === "happy" ? 3 : 4);
  paint(b);
}

function setState(s, { buzz = false } = {}) {
  state = s;
  tag.textContent = LABEL[s] || s;
  const hot = s === "happy" || s === "attention";
  const bad = s === "distress";
  tag.className = "tag" + (hot ? " hot" : bad ? " bad" : "");
  pet.classList.toggle("awake", hot);
  pet.classList.toggle("bad", bad);
  if (buzz) {
    pet.classList.remove("buzz");
    void pet.offsetWidth;
    pet.classList.add("buzz");
  }
  draw();
}

function shortUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const path = u.pathname.length > 28 ? u.pathname.slice(0, 25) + "…" : u.pathname;
    return u.host + path;
  } catch {
    return String(url).slice(0, 36);
  }
}

function renderListeners(listening) {
  const items = Array.isArray(listening) ? listening : [];
  listenerRows.innerHTML = "";
  const has = items.length > 0;
  listenerEmpty.classList.toggle("hidden", has);
  for (const w of items) {
    const row = document.createElement("div");
    row.className = "row";
    const label = w.label || w.intent || w.subId || "listener";
    row.innerHTML =
      `<span><i class="dot"></i>${escapeHtml(label)}</span>` +
      `<b title="${escapeAttr(w.pageUrl || "")}">${escapeHtml(shortUrl(w.pageUrl) || "…")}</b>`;
    listenerRows.appendChild(row);
  }
}

function onSemanticEvent(ev) {
  hits += 1;
  if (hits === 1) eventsEl.innerHTML = "";
  const d = document.createElement("div");
  d.className = "ev";
  const from = ev.from || "someone";
  const text = ev.text || "new message";
  d.innerHTML =
    `<b>${escapeHtml(from)}</b>` +
    `<span>${escapeHtml(text)} · ${new Date().toLocaleTimeString()}</span>`;
  eventsEl.prepend(d);
  holdHappyUntil = Date.now() + 5000;
  setState("happy", { buzz: true });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function render() {
  const s = await send({ type: "get-state" });
  ambientOn = !!s.recording;
  const connected = !!s.daemonConnected;
  const listening = s.listening || [];
  const nTabs = s.attached?.length || 0;

  renderListeners(listening);

  const daemonBit = connected ? "daemon live" : "daemon offline";
  const ambientBit = ambientOn
    ? `ambient on · ${nTabs} tab${nTabs === 1 ? "" : "s"}`
    : "ambient off";
  const listenBit =
    listening.length > 0
      ? ` · ${listening.length} listener${listening.length === 1 ? "" : "s"}`
      : "";
  statusLine.textContent = `${daemonBit} · ${ambientBit}${listenBit}`;

  startBtn.disabled = ambientOn;
  stopBtn.disabled = !ambientOn;

  if (Date.now() < holdHappyUntil) return;
  // Daemon offline is not "failure detected" — SW WebSockets flap on MV3 wake.
  // Only console.error / explicit bad signals use distress (see WS handler).
  if (ambientOn || listening.length > 0) setState("watching");
  else if (!connected) {
    setState("sleeping");
    tag.textContent = "daemon offline";
  } else {
    setState("sleeping");
  }
}

startBtn.onclick = async (e) => {
  e.stopPropagation();
  const { currentWindow } = await send({ type: "list-tabs" });
  const res = await send({ type: "start", scope: { mode: "window", windowId: currentWindow } });
  if (!res?.ok) alert("Could not start ambient: " + (res?.error || "unknown"));
  render();
};

stopBtn.onclick = async (e) => {
  e.stopPropagation();
  await send({ type: "stop" });
  render();
};

clearBtn.onclick = async (e) => {
  e.stopPropagation();
  if (confirm("Clear the local capture buffer?")) {
    await send({ type: "clear" });
    render();
  }
};

exportBtn.onclick = async (e) => {
  e.stopPropagation();
  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting…";
  try {
    const res = await send({ type: "export" });
    if (!res?.ok) throw new Error(res?.error || "export failed");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download(res.artifacts.har, `network-${stamp}.har`);
    download(res.artifacts.trace, `activity-trace-${stamp}.json`);
    download(res.artifacts.summary, `activity-summary-${stamp}.json`);
  } catch (err) {
    alert("Export error: " + (err.message || err));
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "Export";
  }
};

function download(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false });
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

pet.onclick = () => panel.classList.toggle("open");

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "state-changed") render();
});

// Live semantic wake (CONTRACT §0 viewer)
try {
  const ws = new WebSocket("ws://localhost:8787");
  ws.addEventListener("open", () => ws.send(JSON.stringify({ role: "viewer" })));
  ws.addEventListener("message", (m) => {
    let msg;
    try {
      msg = JSON.parse(String(m.data));
    } catch {
      return;
    }
    if (msg.kind === "semantic") {
      onSemanticEvent({
        from: msg.payload?.from?.name,
        text: msg.payload?.text,
      });
      return;
    }
    if (msg.kind === "raw" && msg.payload?.type === "console.error") {
      setState("distress", { buzz: true });
    }
  });
} catch {
  /* daemon optional at popup open */
}

setInterval(() => {
  frame += 1;
  draw();
  if (holdHappyUntil && Date.now() >= holdHappyUntil) {
    holdHappyUntil = 0;
    render();
  }
}, 700);

setState("sleeping");
render();
setInterval(render, 2000);
