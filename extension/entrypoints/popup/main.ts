import './style.css';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <h1>reflex</h1>
    <p class="tag">Subscribe to page events. Stop polling by screenshot.</p>
    <div class="status" id="status">daemon: checking…</div>
  </main>
`;

// reflect daemon connectivity (ws://localhost:8787)
const statusEl = document.getElementById('status')!;
function render() {
  const ws = new WebSocket('ws://localhost:8787');
  ws.addEventListener('open', () => {
    statusEl.textContent = 'daemon: connected';
    statusEl.className = 'status ok';
    ws.close();
  });
  ws.addEventListener('error', () => {
    statusEl.textContent = 'daemon: offline (start it on :8787)';
    statusEl.className = 'status off';
  });
}
render();
