import './style.css';

// TamaAgent — the pet, sized to live inside the extension popup box.
// Chrome caps popups at 800x600; we target 320px wide and ~430px tall so it
// never scrolls or clips. Sprites are 16x16 cat faces on a 20x16 logical LCD.

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
    <h1>reflex</h1>
    <span class="dot" id="dot"></span>
  </header>

  <div class="pet" id="pet">
    <div class="screen"><canvas id="lcd" width="180" height="144"></canvas></div>
    <div class="nub"><i></i><i></i><i></i></div>
  </div>
  <div class="tag" id="tag">sleeping</div>

  <section>
    <h2>Listeners</h2>
    <div class="row" id="lrow"><span class="muted">no listener yet</span></div>
  </section>

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

// ---- state ---------------------------------------------------------------
const pet = document.getElementById('pet')!;
const tag = document.getElementById('tag')!;
let state = 'sleeping', frame = 0, hits = 0;

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

function onEvent(ev: { from?: string; text?: string }) {
  hits++;
  const hitEl = document.getElementById('hits');
  if (hitEl) hitEl.textContent = String(hits);
  const list = document.getElementById('events')!;
  if (hits === 1) list.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'ev';
  const b = document.createElement('b');
  b.textContent = ev.from || 'someone';
  const s = document.createElement('span');
  s.textContent = `${ev.text || 'new message'} · ${new Date().toLocaleTimeString()}`;
  d.append(b, s);
  list.prepend(d);
  setState('happy', true);
  setTimeout(() => setState('sleeping'), 5000);
}

// ---- daemon (CONTRACT.md §0 viewer role) ---------------------------------
const statusEl = document.getElementById('status')!;
const dot = document.getElementById('dot')!;

function connect() {
  const ws = new WebSocket('ws://localhost:8787');
  ws.addEventListener('open', () => {
    statusEl.textContent = 'daemon: connected';
    statusEl.className = 'status ok';
    dot.className = 'dot ok';
    ws.send(JSON.stringify({ role: 'viewer' }));
    document.getElementById('lrow')!.innerHTML =
      '<span>linkedin · new messages</span><b id="hits">0</b>';
    setState('watching');
  });
  ws.addEventListener('message', (m) => {
    let msg: any;
    try { msg = JSON.parse(m.data as string); } catch { return; }
    if (msg.kind === 'semantic') onEvent({ from: msg.payload?.from?.name, text: msg.payload?.text });
    else if (msg.kind === 'raw' && msg.payload?.type === 'console.error') setState('distress', true);
  });
  ws.addEventListener('error', () => {
    statusEl.textContent = 'daemon: offline (start it on :8787)';
    statusEl.className = 'status off';
    dot.className = 'dot off';
  });
}

setState('sleeping');
connect();
