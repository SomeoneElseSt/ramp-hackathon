import './style.css';

// TamaAgent — the pet, sized to live inside the extension popup box.
// Chrome caps popups at 800x600; we target 320px wide and ~430px tall so it
// never scrolls or clips. Sprites are 16x16 cat faces on a 20x16 logical LCD.
//
// State comes from the BACKGROUND service worker (get-state / count), never a
// WS opened here: a popup's socket dies the moment the popup closes.

// ---- sprites: 'X' = pixel on. Filled head, negative-space eyes ------------
const CAT: Record<string, string[]> = {
  sleeping: [
    '................', '..X..........X..', '..XX........XX..', '..XXX......XXX..',
    '..XXXXXXXXXXXX..', '.XXXXXXXXXXXXXX.', '.XXXXXXXXXXXXXX.', '.XXX..XXXX..XXX.',
    'XXXXXXXXXXXXXXXX', '.XXXXX.XX.XXXXX.', '.XXXXXXXXXXXXXX.', '..XXXXXXXXXXXX..',
    '...XXXXXXXXXX...', '................', '................', '................'],
  watching: [
    '................', '..X..........X..', '..XX........XX..', '..XXX......XXX..',
    '..XXXXXXXXXXXX..', '.XXXXXXXXXXXXXX.', '.XXX..XXXX..XXX.', '.XXX..XXXX..XXX.',
    'XXXXXXXXXXXXXXXX', '.XXXXX.XX.XXXXX.', '.XXXXXXXXXXXXXX.', '..XXXXXXXXXXXX..',
    '...XXXXXXXXXX...', '................', '................', '................'],
  happy: [
    '................', '..X..........X..', '..XX........XX..', '..XXX......XXX..',
    '..XXXXXXXXXXXX..', '.XXXXXXXXXXXXXX.', '.XXX..XXXX..XXX.', '.XXXXXXXXXXXXXX.',
    'XXXXXXXXXXXXXXXX', '.XXXXX....XXXXX.', '.XXXXXXXXXXXXXX.', '..XXXXXXXXXXXX..',
    '...XXXXXXXXXX...', '................', '................', '................'],
  distress: [
    '................', '..X..........X..', '..XX........XX..', '..XXX......XXX..',
    '..XXXXXXXXXXXX..', '.XXXXXXXXXXXXXX.', '.XXX.XXXXXX.XXX.', '.XXXX.XXXX.XXXX.',
    'XXXXXXXXXXXXXXXX', '.XXXXX.XX.XXXXX.', '.XXXXXXXXXXXXXX.', '..XXXXXXXXXXXX..',
    '...XXXXXXXXXX...', '................', '................', '................'],
  attention: [
    '..X..........X..', '..XX........XX..', '..XXX......XXX..', '..XXXXXXXXXXXX..',
    '.XXXXXXXXXXXXXX.', '.XXX..XXXX..XXX.', '.XXX..XXXX..XXX.', '.XXX..XXXX..XXX.',
    'XXXXXXXXXXXXXXXX', '.XXXXX.XX.XXXXX.', '.XXXXXXXXXXXXXX.', '..XXXXXXXXXXXX..',
    '...XXXXXXXXXX...', '................', '................', '................'],
};
const Z = ['XXX', '..X', '.X.', 'X..', 'XXX'];
const BANG = ['X', 'X', 'X', '.', 'X'];

const LABEL: Record<string, string> = {
  sleeping: 'sleeping · 0 model calls',
  watching: 'watching',
  happy: 'new event',
  distress: 'failure detected',
  attention: 'needs approval',
};

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header>
    <h1>Tama Agent</h1>
    <span class="dot" id="dot"></span>
  </header>

  <div class="pet" id="pet">
    <div class="screen"><canvas id="lcd" width="180" height="144"></canvas></div>
    <div class="nub"><i></i><i></i><i></i></div>
  </div>
  <div class="tag" id="tag">sleeping</div>

  <div class="row">
    <button id="toggle">Pause</button>
    <span class="count"><b id="count">0</b> events</span>
  </div>

  <section>
    <h2>Recent events</h2>
    <div class="events" id="events"><div class="muted">nothing yet</div></div>
  </section>

  <div class="status" id="status">daemon: checking…</div>
`;

// ---- LCD renderer --------------------------------------------------------
const W = 20, H = 16;
const lcd = document.getElementById('lcd') as HTMLCanvasElement;
const ctx = lcd.getContext('2d')!;
const blank = () => Array.from({ length: H }, () => new Array(W).fill(0));

function blit(b: number[][], s: string[], ox: number, oy: number) {
  for (let y = 0; y < s.length; y++)
    for (let x = 0; x < s[y].length; x++) {
      if (s[y][x] !== 'X') continue;
      const px = ox + x, py = oy + y;
      if (px >= 0 && px < W && py >= 0 && py < H) b[py][px] = 1;
    }
}
function paint(b: number[][]) {
  const s = lcd.width / W;
  ctx.fillStyle = '#9bbc0f';
  ctx.fillRect(0, 0, lcd.width, lcd.height);
  ctx.fillStyle = 'rgba(20,48,15,.06)';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ctx.fillRect(x * s + s - 1, y * s, 1, s);
  ctx.fillStyle = '#14300f';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b[y][x]) ctx.fillRect(x * s, y * s, s - 1, s - 1);
}

// ---- pet state -----------------------------------------------------------
const pet = document.getElementById('pet')!;
const tag = document.getElementById('tag')!;
let state = 'sleeping', frame = 0;

function draw() {
  const b = blank();
  blit(b, CAT[state] || CAT.sleeping, 1, 0);
  if (state === 'sleeping') blit(b, Z, 17, 1 + (frame % 2));
  if (state === 'attention') blit(b, BANG, 18, 4);
  if (state === 'happy') blit(b, BANG, 18, 3);
  paint(b);
}
function setState(s: string, buzz = false) {
  state = s;
  tag.textContent = LABEL[s] ?? s;
  const hot = s === 'happy' || s === 'attention';
  tag.className = 'tag' + (hot ? ' hot' : s === 'distress' ? ' bad' : '');
  pet.classList.toggle('awake', hot);
  pet.classList.toggle('bad', s === 'distress');
  if (buzz) { pet.classList.remove('buzz'); void (pet as HTMLElement).offsetWidth; pet.classList.add('buzz'); }
  draw();
}
setInterval(() => { frame++; draw(); }, 700);

function logEvent(label: string, detail: string) {
  const list = document.getElementById('events')!;
  if (list.querySelector('.muted')) list.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'ev';
  const b = document.createElement('b');
  b.textContent = label;
  const s = document.createElement('span');
  s.textContent = `${detail} · ${new Date().toLocaleTimeString()}`;
  d.append(b, s);
  list.prepend(d);
  while (list.children.length > 12) list.lastElementChild!.remove();
}

// ---- background-driven state --------------------------------------------
const countEl = document.getElementById('count')!;
const statusEl = document.getElementById('status')!;
const dot = document.getElementById('dot')!;
const toggleEl = document.getElementById('toggle') as HTMLButtonElement;

const send = (msg: any): Promise<any> => chrome.runtime.sendMessage(msg);
let lastCount = 0;

async function refresh() {
  const s = await send({ type: 'get-state' }).catch(() => null);
  if (!s) return;

  countEl.textContent = String(s.count ?? 0);
  toggleEl.textContent = s.recording ? 'Pause' : 'Record';
  statusEl.textContent = s.daemon ? 'daemon: connected' : 'daemon: offline (start it on :8787)';
  statusEl.className = 'status ' + (s.daemon ? 'ok' : 'off');
  dot.className = 'dot ' + (s.daemon ? 'ok' : 'off');

  // The pet reflects reality: awake only when actually listening.
  if (state !== 'happy') setState(s.daemon && s.recording ? 'watching' : 'sleeping');
  lastCount = s.count ?? 0;
}

toggleEl.onclick = async () => {
  const s = await send({ type: 'get-state' });
  await send({ type: 'set-recording', on: !s.recording });
  refresh();
};

chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg?.type === 'count') {
    const c = msg.count ?? 0;
    countEl.textContent = String(c);
    if (c > lastCount) {
      lastCount = c;
      setState('happy', true);
      setTimeout(() => setState('watching'), 4000);
    }
  }
  // Resolved semantic event from the daemon, if the background forwards it.
  if (msg?.type === 'semantic') {
    logEvent(msg.payload?.from?.name || 'someone', msg.payload?.text || 'new message');
    setState('happy', true);
    setTimeout(() => setState('watching'), 4000);
  }
});

setState('sleeping');
refresh();
setInterval(refresh, 1500);
