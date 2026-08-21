import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT) || 8787;
const tunnels = new Map();
let nextTunnelId = 1;

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function state() {
  return {
    tunnels: [...tunnels.values()].map((item) => ({
      id: item.id,
      running: Boolean(item.process && !item.process.killed && item.process.exitCode === null),
      localUrl: item.localUrl,
      publicUrl: item.publicUrl,
      error: item.error,
      createdAt: item.createdAt
    }))
  };
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function stopTunnelById(id) {
  const tunnel = tunnels.get(id);
  if (!tunnel) return false;
  if (tunnel.process && !tunnel.process.killed) {
    tunnel.process.kill();
  }
  tunnels.delete(id);
  return true;
}

function stopAllTunnels() {
  for (const id of tunnels.keys()) {
    stopTunnelById(id);
  }
}

function startTunnel(localUrl) {
  const id = String(nextTunnelId++);
  const child = spawn('cloudflared', ['tunnel', '--url', localUrl], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const tunnel = { id, process: child, localUrl, publicUrl: null, error: null, createdAt: Date.now() };
  tunnels.set(id, tunnel);

  const onOutput = (chunk) => {
    const output = chunk.toString();
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) tunnel.publicUrl = match[0];
  };
  child.stdout.on('data', onOutput);
  child.stderr.on('data', (chunk) => {
    onOutput(chunk);
    const message = chunk.toString();
    if (/error|failed|unable/i.test(message)) tunnel.error = message.trim();
  });
  child.on('error', (error) => {
    tunnel.error = error.code === 'ENOENT'
      ? 'cloudflared est introuvable. Installez-le puis relancez l’application.'
      : error.message;
  });
  child.on('exit', () => {
    if (!tunnel.publicUrl && !tunnel.error) tunnel.error = 'Le tunnel s’est arrêté avant de fournir un lien.';
    tunnel.process = null;
  });

  return tunnel;
}

async function serveStatic(request, response) {
  const requested = request.url === '/' ? '/index.html' : request.url;
  const filePath = normalize(join(publicDir, requested.split('?')[0]));
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: 'Accès refusé.' });
  try {
    const content = await readFile(filePath);
    const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' };
    response.writeHead(200, { 'Content-Type': `${types[extname(filePath)] ?? 'application/octet-stream'}; charset=utf-8` });
    response.end(content);
  } catch {
    json(response, 404, { error: 'Page introuvable.' });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/status') return json(response, 200, state());
  if (request.method === 'POST' && request.url === '/api/start') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        const { localUrl } = JSON.parse(body);
        if (!isLocalUrl(localUrl)) return json(response, 400, { error: 'Utilisez une URL locale http://localhost ou http://127.0.0.1.' });
        startTunnel(localUrl);
        json(response, 202, state());
      } catch {
        json(response, 400, { error: 'Requête invalide.' });
      }
    });
    return;
  }
  if (request.method === 'POST' && request.url === '/api/stop') {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (!body) {
        stopAllTunnels();
        return json(response, 200, state());
      }
      try {
        const { id } = JSON.parse(body);
        if (!id) {
          stopAllTunnels();
          return json(response, 200, state());
        }
        if (!stopTunnelById(String(id))) return json(response, 404, { error: 'Tunnel introuvable.' });
        json(response, 200, state());
      } catch {
        json(response, 400, { error: 'Requête invalide.' });
      }
    });
    return;
  }
  if (request.method === 'GET') return serveStatic(request, response);
  json(response, 404, { error: 'Route introuvable.' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Easy Cloudflared: http://127.0.0.1:${port}`);
});

process.on('SIGINT', () => { stopAllTunnels(); server.close(() => process.exit(0)); });