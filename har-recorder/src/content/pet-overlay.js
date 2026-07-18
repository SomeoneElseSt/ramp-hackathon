// pet-overlay.js — TamaAgent pinned to the corner of every page.
//
// Declarative content script on <all_urls>, so the pet is present the moment a
// tab loads and persists as you switch tabs (each tab renders its own copy;
// state comes from the background service worker, so they stay in sync).
//
// Rendered inside a Shadow DOM: arbitrary sites have aggressive CSS and we must
// not let them restyle the pet, or let our styles leak into them.

(() => {
  if (window.__tamaPet) return;            // never double-inject
  window.__tamaPet = true;
  if (window.top !== window) return;       // top frame only, not every iframe

  // ---- 16x16 cat FACE sprites, 'X' = pixel on ----------------------------
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
    attention: [
      "..X..........X..", "..XX........XX..", "..XXX......XXX..", "..XXXXXXXXXXXX..",
      ".XXXXXXXXXXXXXX.", ".XXX..XXXX..XXX.", ".XXX..XXXX..XXX.", ".XXX..XXXX..XXX.",
      "XXXXXXXXXXXXXXXX", ".XXXXX.XX.XXXXX.", ".XXXXXXXXXXXXXX.", "..XXXXXXXXXXXX..",
      "...XXXXXXXXXX...", "................", "................", "................"],
  };
  const Z = ["XXX", "..X", ".X.", "X..", "XXX"];
  const BANG = ["X", "X", "X", ".", "X"];
  const LABEL = {
    sleeping: "asleep · 0 model calls",
    watching: "watching this tab",
    happy: "new event",
    distress: "capture error",
    attention: "needs approval",
  };

  // ---- shadow host, pinned bottom-right ----------------------------------
  const host = document.createElement("div");
  host.id = "tama-pet-host";
  host.style.cssText =
    "position:fixed;bottom:18px;right:18px;z-index:2147483647;width:96px;" +
    "pointer-events:auto;color-scheme:light;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      .wrap{display:flex;flex-direction:column;align-items:center;gap:6px;
        font:11px/1.3 ui-monospace,Menlo,monospace;cursor:pointer;
        transition:opacity .2s}
      .wrap.hidden{opacity:0;pointer-events:none}
      .pet{width:96px;padding:8px 8px 10px;border-radius:24px 24px 20px 20px;
        background:linear-gradient(160deg,#ffa8cd,#e8629b 72%);
        box-shadow:inset 0 -5px 10px rgba(0,0,0,.22),inset 0 4px 9px rgba(255,255,255,.45),
          0 5px 16px rgba(0,0,0,.32);transition:box-shadow .25s,transform .15s}
      .wrap:hover .pet{transform:translateY(-2px)}
      .pet.awake{box-shadow:inset 0 -5px 10px rgba(0,0,0,.22),inset 0 4px 9px rgba(255,255,255,.45),
        0 0 0 3px rgba(96,165,250,.65),0 5px 20px rgba(96,165,250,.55)}
      .pet.bad{background:linear-gradient(160deg,#ff9a8a,#e0483a 72%)}
      .pet.buzz{animation:bz .38s ease-out}
      @keyframes bz{0%,100%{transform:translate(0,0)}25%{transform:translate(-3px,1px) rotate(-2deg)}
        60%{transform:translate(3px,-1px) rotate(2deg)}}
      .screen{background:#2a2630;border-radius:6px;padding:4px}
      canvas{display:block;width:100%;image-rendering:pixelated;border-radius:3px;background:#9bbc0f}
      .nub{display:flex;gap:6px;justify-content:center;margin-top:6px}
      .nub i{width:7px;height:7px;border-radius:50%;
        background:linear-gradient(180deg,#fff,#cfc9d6);box-shadow:inset 0 -1px 2px rgba(0,0,0,.3)}
      .tag{background:rgba(18,16,26,.92);color:#e9e4f5;padding:3px 8px;border-radius:6px;
        white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.3)}
      .tag.hot{background:#2563eb}
      .tag.bad{background:#dc2626}
    </style>
    <div class="wrap" id="wrap" title="Tama Agent — click to hide">
      <div class="pet" id="pet">
        <div class="screen"><canvas id="lcd" width="160" height="128"></canvas></div>
        <div class="nub"><i></i><i></i><i></i></div>
      </div>
      <div class="tag" id="tag">asleep</div>
    </div>`;

  const mount = () => (document.body || document.documentElement).appendChild(host);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  const lcd = root.getElementById("lcd");
  const petEl = root.getElementById("pet");
  const tagEl = root.getElementById("tag");
  const wrapEl = root.getElementById("wrap");
  const ctx = lcd.getContext("2d");

  // ---- LCD ---------------------------------------------------------------
  const W = 20, H = 16;
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
    ctx.fillStyle = "#9bbc0f";
    ctx.fillRect(0, 0, lcd.width, lcd.height);
    ctx.fillStyle = "rgba(20,48,15,.06)";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ctx.fillRect(x * s + s - 1, y * s, 1, s);
    ctx.fillStyle = "#14300f";
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[y][x]) ctx.fillRect(x * s, y * s, s - 1, s - 1);
  }

  let state = "sleeping", frame = 0, lastCount = 0, seeded = false, revert = null;

  function draw() {
    const b = blank();
    blit(b, CAT[state] || CAT.sleeping, 1, 0);
    if (state === "sleeping") blit(b, Z, 17, 1 + (frame % 2));
    if (state === "attention") blit(b, BANG, 18, 4);
    if (state === "happy") blit(b, BANG, 18, 3);
    paint(b);
  }
  function setState(s, buzz) {
    state = s;
    tagEl.textContent = LABEL[s] || s;
    const hot = s === "happy" || s === "attention";
    tagEl.className = "tag" + (hot ? " hot" : s === "distress" ? " bad" : "");
    petEl.classList.toggle("awake", hot);
    petEl.classList.toggle("bad", s === "distress");
    if (buzz) { petEl.classList.remove("buzz"); void petEl.offsetWidth; petEl.classList.add("buzz"); }
    draw();
  }
  setInterval(() => { frame++; draw(); }, 700);

  // click to hide (a pet you can't dismiss is a pet that ruins a screenshare)
  wrapEl.addEventListener("click", () => wrapEl.classList.toggle("hidden"));

  // ---- state from the background worker -----------------------------------
  const send = (msg) =>
    new Promise((res) => {
      try { chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; res(r); }); }
      catch (_) { res(null); }
    });

  async function sync() {
    const s = await send({ type: "get-state" });
    if (!s) return;
    const count = s.entryCount || 0;
    if (seeded && count > lastCount && s.recording) {
      lastCount = count;
      setState("happy", true);
      clearTimeout(revert);
      revert = setTimeout(() => setState(s.recording ? "watching" : "sleeping"), 3500);
      return;
    }
    lastCount = count;
    seeded = true;
    if (state !== "happy") setState(s.recording ? "watching" : "sleeping");
  }

  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "state-changed") sync();
      if (msg?.type === "semantic") {
        setState("happy", true);
        clearTimeout(revert);
        revert = setTimeout(() => setState("watching"), 4000);
      }
    });
  } catch (_) {}

  setState("sleeping");
  sync();
  setInterval(sync, 1200);
})();
