// pet.js — TamaAgent, the pet that lives in the extension popup.
//
// Deliberately standalone: this file touches nothing in popup.js. It reads the
// same background state (get-state / state-changed) and renders the pet on top.
// Keeping it separate means the recording controls and the pet can be edited by
// different people without colliding.
//
// States: sleeping (not recording, zero model cost) / watching (recording, idle)
//         happy (new events arrived) / distress / attention.

const send = (msg) => chrome.runtime.sendMessage(msg);

// ---- 16x16 cat FACE sprites, 'X' = pixel on ------------------------------
// Filled head with negative-space eyes. A full-body cat needs 24x24+ to read;
// at LCD size the outline version rendered as an unreadable blob.
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

// ---- LCD -----------------------------------------------------------------
const W = 20, H = 16;
const lcd = document.getElementById("petLcd");
const petEl = document.getElementById("pet");
const tagEl = document.getElementById("petTag");
if (lcd && petEl && tagEl) init();

function init() {
  const ctx = lcd.getContext("2d");
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

  let state = "sleeping", frame = 0, lastCount = 0, seeded = false;

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
    tagEl.className = "pet-tag" + (hot ? " hot" : s === "distress" ? " bad" : "");
    petEl.classList.toggle("awake", hot);
    petEl.classList.toggle("bad", s === "distress");
    if (buzz) { petEl.classList.remove("buzz"); void petEl.offsetWidth; petEl.classList.add("buzz"); }
    draw();
  }

  setInterval(() => { frame++; draw(); }, 700);

  // The pet reflects the recorder's real state. It is never awake for show.
  async function sync() {
    const s = await send({ type: "get-state" }).catch(() => null);
    if (!s) return;
    const count = s.entryCount || 0;

    // Don't fire on the first read: stored events from a previous session
    // shouldn't look like a live arrival.
    if (seeded && count > lastCount && s.recording) {
      lastCount = count;
      setState("happy", true);
      clearTimeout(sync._t);
      sync._t = setTimeout(() => setState(s.recording ? "watching" : "sleeping"), 3500);
      return;
    }
    lastCount = count;
    seeded = true;
    if (state !== "happy") setState(s.recording ? "watching" : "sleeping");
  }

  setState("sleeping");

  // Outside the extension (opening popup.html directly to check the art) there
  // is no chrome.runtime. Render the pet anyway and expose the state setter so
  // it can be previewed without a reload cycle.
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    window.petState = setState;
    return;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "state-changed") sync();
  });
  sync();
  setInterval(sync, 1200);
}

// Open the side-panel dashboard. sidePanel.open() requires a user gesture, and
// a click inside the popup counts as one.
const openBtn = document.getElementById("openPanel");
if (openBtn) {
  openBtn.onclick = async () => {
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      window.close();
    } catch (e) {
      console.error("[tama] side panel open failed", e);
    }
  };
}
