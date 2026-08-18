const input = document.querySelector('#local-url');
const startButton = document.querySelector('#start');
const stopButton = document.querySelector('#stop');
const copyButton = document.querySelector('#copy');
const resultBox = document.querySelector('#result-box');
const resultText = document.querySelector('#result-text');
const statusText = document.querySelector('#status');
let poller;

function render(data) {
  const running = data.running;
  const ready = Boolean(data.publicUrl);
  resultBox.classList.toggle('ready', ready);
  resultText.textContent = data.publicUrl ?? (data.error || (running ? 'Connexion à Cloudflare en cours…' : 'En attente du démarrage'));
  copyButton.classList.toggle('hidden', !ready);
  startButton.classList.toggle('hidden', running);
  stopButton.classList.toggle('hidden', !running);
  statusText.textContent = data.error || (ready ? 'Tunnel actif. Vous pouvez partager ce lien.' : running ? 'Cloudflared prépare votre lien public.' : 'Prêt à créer un tunnel temporaire.');
  if (ready) copyButton.dataset.url = data.publicUrl;
}

async function refresh() {
  const response = await fetch('/api/status');
  render(await response.json());
}

startButton.addEventListener('click', async () => {
  startButton.disabled = true;
  try {
    const response = await fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ localUrl: input.value.trim() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    render(data);
    clearInterval(poller);
    poller = setInterval(refresh, 900);
  } catch (error) {
    render({ error: error.message, running: false });
  } finally { startButton.disabled = false; }
});

stopButton.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' });
  clearInterval(poller);
  await refresh();
});

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(copyButton.dataset.url);
  statusText.textContent = 'Lien copié dans le presse-papiers.';
  copyButton.querySelector('span').textContent = 'Lien copié';
  setTimeout(() => { copyButton.querySelector('span').textContent = 'Copier le lien'; }, 1600);
});

refresh().catch(() => { statusText.textContent = 'Impossible de joindre le serveur local.'; });