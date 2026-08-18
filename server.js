import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT) || 8787;
let tunnel = null;

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function state() {
  return {
    running: Boolean(tunnel?.process && !tunnel.process.killed),
    localUrl: tunnel?.localUrl ?? null,
    publicUrl: tunnel?.publicUrl ?? null,
    error: tunnel?.error ?? null
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

function stopTunnel() {
  if (tunnel?.process && !tunnel.process.killed) {
    tunnel.process.kill();
  }
  tunnel = null;
}

function startTunnel(localUrl) {
  stopTunnel();
  const child = spawn('cloudflared', ['tunnel', '--url', localUrl], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  tunnel = { process: child, localUrl, publicUrl: null, error: null };
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
    if (tunnel?.process === child && !tunnel.publicUrl) tunnel.error ??= 'Le tunnel s’est arrêté avant de fournir un lien.';
  });
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
    stopTunnel();
    return json(response, 200, state());
  }
  if (request.method === 'GET') return serveStatic(request, response);
  json(response, 404, { error: 'Route introuvable.' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Easy Cloudflared: http://127.0.0.1:${port}`);
});

process.on('SIGINT', () => { stopTunnel(); server.close(() => process.exit(0)); });