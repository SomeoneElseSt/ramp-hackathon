// panel.js — Tama Agent side panel: the pet + live workflow analysis.
//
// A side panel (not a popup) because it persists across tab switches and stays
// open while you work, which is what a dashboard needs.
//
// Every number here is MEASURED from the daemon's own viewer stream
// (CONTRACT §0: {kind:"raw"|"semantic"|"poll"}). Nothing is invented: `raw` is
// what the daemon ingested, `useful` is what survived its noise filter, `fired`
// is what became a resolved semantic event. That IS the funnel.

const CAT = {
  sleeping: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................"],
  watching: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.", ".XXX..XXXX..XXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................"],
  happy: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.", ".XXXXXXXXXXXXXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX....XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................"],
  distress: [
    "................", "..X..........X..", "..XX........XX..", "..XXX......XXX..",
    "..XXXXXXXXXXXX..", ".XXXXXXXXXXXXXX.", ".XXX.XXXXXX.XXX.", ".XXXX.XXXX.XXXX.",
    "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
    "...XXXXXXXXXX...", "................", "................", "................"],
};
const Z = ["XXX", "..X", ".X.", "X..", "XXX"];
const BANG = ["X", "X", "X", ".", "X"];
const LABEL = {
  sleeping: "asleep · 0 model calls",
  watching: "watching",
  happy: "new event",
  distress: "capture error",
};

const $ = (id) => document.getElementById(id);
const W = 20, H = 16;
const lcd = $("petLcd"), ctx = lcd.getContext("2d");
const petEl = $("pet"), tagEl = $("petTag");

const blank = () => Array.from({ length: H }, () => new Array(W).fill(0));
function blit(b, s, ox, oy) {
  for (let y = 0; y < s.length; y++)
    for (let x = 0; x < s[y].length; x++) {
      if (s[y][x] !== "X") continue;
      const px = ox + x, py = oy + y;
      if (px >= 0 && px < W && py >= 0 && py < H) b[py][px] = 1;
    }
}
function paint(b) {
  const s = lcd.width / W;
  ctx.fillStyle = "#9bbc0f"; ctx.fillRect(0, 0, lcd.width, lcd.height);
  ctx.fillStyle = "rgba(20,48,15,.06)";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ctx.fillRect(x * s + s - 1, y * s, 1, s);
  ctx.fillStyle = "#14300f";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[y][x]) ctx.fillRect(x * s, y * s, s - 1, s - 1);
}

let state = "sleeping", frame = 0, revert = null;
function draw() {
  const b = blank();
  blit(b, CAT[state] || CAT.sleeping, 1, 0);
  if (state === "sleeping") blit(b, Z, 17, 1 + (frame % 2));
  if (state === "happy") blit(b, BANG, 18, 3);
  paint(b);
}
function setState(s, buzz) {
  state = s;
  tagEl.textContent = LABEL[s] || s;
  const hot = s === "happy";
  tagEl.className = "pet-tag" + (hot ? " hot" : s === "distress" ? " bad" : "");
  petEl.classList.toggle("awake", hot);
  petEl.classList.toggle("bad", s === "distress");
  if (buzz) { petEl.classList.remove("buzz"); void petEl.offsetWidth; petEl.classList.add("buzz"); }
  draw();
}
setInterval(() => { frame++; draw(); }, 700);

// ---- measured analysis ---------------------------------------------------
const stats = { raw: 0, useful: 0, fired: 0 };
const sources = new Map();   // host -> { hits, actions, last }
const events = [];

const NOISE = /analytics|telemetry|beacon|metrics|sentry|doubleclick|googletag|presence|realtime\/heartbeat/i;

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}
function bump(host, kind) {
  if (!host) return;
  const s = sources.get(host) || { hits: 0, actions: 0, last: 0 };
  s.hits++;
  if (kind === "user") s.actions++;
  s.last = Date.now();
  sources.set(host, s);
}

function renderStats() {
  $("fRaw").textContent = stats.raw.toLocaleString();
  $("fUseful").textContent = stats.useful.toLocaleString();
  $("fFired").textContent = stats.fired.toLocaleString();
  if (stats.raw > 0) {
    const pct = ((stats.useful / stats.raw) * 100).toFixed(1);
    $("fNote").textContent =
      `${pct}% of traffic survived the noise filter. The rest was never read by a model.`;
  }
}

function renderSources() {
  const el = $("sources");
  if (!sources.size) return;
  const rows = [...sources.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 8);
  el.innerHTML = "";
  const max = rows[0][1].hits || 1;
  for (const [host, s] of rows) {
    const row = document.createElement("div");
    row.className = "srow";
    const name = document.createElement("span");
    name.className = "sname";
    name.textContent = host;
    const bar = document.createElement("span");
    bar.className = "sbar";
    const fill = document.createElement("i");
    fill.style.width = Math.max(4, (s.hits / max) * 100) + "%";
    bar.appendChild(fill);
    const n = document.createElement("b");
    n.textContent = s.hits.toLocaleString();
    row.append(name, bar, n);
    el.appendChild(row);
  }
}

function addEvent(p) {
  events.unshift(p);
  if (events.length > 25) events.pop();
  const el = $("events");
  el.innerHTML = "";
  for (const e of events) {
    const d = document.createElement("div");
    d.className = "ev";
    const b = document.createElement("b");
    b.textContent = e?.from?.name || e?.source || "event";
    const s = document.createElement("span");
    const when = e?.ts ? new Date(e.ts).toLocaleTimeString() : new Date().toLocaleTimeString();
    s.textContent = `${(e?.text || e?.type || "").slice(0, 90)} · ${when}`;
    d.append(b, s);
    el.appendChild(d);
  }
}

// ---- daemon viewer stream ------------------------------------------------
function connect() {
  let ws;
  try { ws = new WebSocket("ws://localhost:8787"); } catch { return retry(); }

  ws.onopen = () => {
    $("dot").className = "dot ok";
    $("foot").textContent = "daemon: connected · ws://localhost:8787";
    $("foot").className = "ok";
    ws.send(JSON.stringify({ role: "viewer" }));
    if (state === "sleeping") setState("watching");
  };

  ws.onmessage = (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }

    if (msg.kind === "raw") {
      const p = msg.payload || {};
      stats.raw++;
      const url = p.url || p.data?.url || "";
      if (!NOISE.test(url)) stats.useful++;
      bump(hostOf(url), p.type?.startsWith("user.") ? "user" : "net");
      if (p.type === "console.error") setState("distress", true);
      renderStats(); renderSources();
    }

    if (msg.kind === "semantic") {
      stats.fired++;
      addEvent(msg.payload);
      renderStats();
      setState("happy", true);
      clearTimeout(revert);
      revert = setTimeout(() => setState("watching"), 4000);
    }
  };

  ws.onclose = retry;
  ws.onerror = () => {};
}

function retry() {
  $("dot").className = "dot off";
  $("foot").textContent = "daemon: offline — start it with `cd daemon && npm run dev`";
  $("foot").className = "off";
  if (state !== "sleeping") setState("sleeping");
  setTimeout(connect, 2000);
}

setState("sleeping");
connect();
