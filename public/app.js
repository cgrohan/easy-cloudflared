const input = document.querySelector('#local-url');
const startButton = document.querySelector('#start');
const stopAllButton = document.querySelector('#stop-all');
const list = document.querySelector('#tunnel-list');
const emptyState = document.querySelector('#empty-state');
const statusText = document.querySelector('#status');
let poller;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(data) {
  const tunnels = Array.isArray(data.tunnels) ? data.tunnels.slice().sort((a, b) => b.createdAt - a.createdAt) : [];
  const runningCount = tunnels.filter((item) => item.running).length;

  stopAllButton.classList.toggle('hidden', tunnels.length === 0);
  emptyState.classList.toggle('hidden', tunnels.length > 0);
  list.innerHTML = '';

  for (const tunnel of tunnels) {
    const localUrl = escapeHtml(tunnel.localUrl);
    const publicUrl = tunnel.publicUrl ? escapeHtml(tunnel.publicUrl) : '';
    const displayText = escapeHtml(tunnel.publicUrl ?? (tunnel.error || (tunnel.running ? 'Connexion a Cloudflare en cours...' : 'Tunnel arrete.')));
    const item = document.createElement('article');
    item.className = `tunnel-item${tunnel.publicUrl ? ' ready' : ''}`;
    item.innerHTML = `
      <div class="tunnel-top">
        <span class="badge">#${tunnel.id}</span>
        <span class="local">${localUrl}</span>
      </div>
      <p class="public-url">${displayText}</p>
      <div class="tunnel-actions">
        <button class="copy small${tunnel.publicUrl ? '' : ' hidden'}" data-action="copy" data-url="${publicUrl}"><span>Copier</span></button>
        <button class="secondary small" data-action="stop" data-id="${tunnel.id}">Arreter</button>
      </div>
    `;
    list.appendChild(item);
  }

  if (tunnels.length === 0) {
    statusText.textContent = 'Pret a creer un tunnel temporaire.';
  } else if (runningCount > 0) {
    statusText.textContent = `${runningCount} tunnel(s) actif(s).`;
  } else {
    statusText.textContent = 'Tous les tunnels sont arretes.';
  }

  ensurePolling(runningCount > 0);
}

async function refresh() {
  const response = await fetch('/api/status');
  render(await response.json());
}

function ensurePolling(enabled) {
  if (enabled && !poller) {
    poller = setInterval(refresh, 900);
    return;
  }
  if (!enabled && poller) {
    clearInterval(poller);
    poller = null;
  }
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  try {
    const response = await fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localUrl: input.value.trim() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    render(data);
  } catch (error) {
    statusText.textContent = error.message;
  } finally { startButton.disabled = false; }
});

stopAllButton.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' });
  await refresh();
});

list.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (button.dataset.action === 'copy') {
    await navigator.clipboard.writeText(button.dataset.url);
    const previous = button.querySelector('span')?.textContent;
    if (button.querySelector('span')) button.querySelector('span').textContent = 'Copie';
    statusText.textContent = 'Lien copie dans le presse-papiers.';
    setTimeout(() => {
      if (button.querySelector('span') && previous) button.querySelector('span').textContent = previous;
    }, 1300);
    return;
  }

  if (button.dataset.action === 'stop') {
    await fetch('/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: button.dataset.id })
    });
    await refresh();
  }
});

refresh().catch(() => { statusText.textContent = 'Impossible de joindre le serveur local.'; });