import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <h1>Tama Agent</h1>
    <p class="tag">Recording page events. Stop polling by screenshot.</p>
    <div class="row">
      <button id="toggle">Pause</button>
      <span class="count"><b id="count">0</b> events</span>
    </div>
    <div class="status" id="status">daemon: checking…</div>
  </main>
`;

const countEl = document.getElementById('count')!;
const statusEl = document.getElementById('status')!;
const toggleEl = document.getElementById('toggle') as HTMLButtonElement;

const send = (msg: any): Promise<any> => chrome.runtime.sendMessage(msg);

async function refresh() {
  const s = await send({ type: 'get-state' }).catch(() => null);
  if (!s) return;
  countEl.textContent = String(s.count ?? 0);
  toggleEl.textContent = s.recording ? 'Pause' : 'Record';
  statusEl.textContent = s.daemon ? 'daemon: connected' : 'daemon: offline (start it on :8787)';
  statusEl.className = 'status ' + (s.daemon ? 'ok' : 'off');
}

toggleEl.onclick = async () => {
  const s = await send({ type: 'get-state' });
  await send({ type: 'set-recording', on: !s.recording });
  refresh();
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'count') countEl.textContent = String(msg.count ?? 0);
});

refresh();
setInterval(refresh, 1500);
