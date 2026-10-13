// Shopline server - zero dependencies, runs on plain Node 18+.
//   * serves the web app from /public
//   * shares the data model from /shared with the browser
//   * exposes a small REST API over a JSON-file database
//   * pushes live updates over Server-Sent Events so every screen stays in sync
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import * as db from './lib/db.js';
import * as sse from './lib/sse.js';
import { collections, collectionByName } from './shared/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const SHARED_DIR = join(__dirname, 'shared');

const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

db.load();
db.onChange((event) => sse.broadcast(event));

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function actorFrom(req) {
  const header = req.headers['x-actor'];
  return header ? decodeURIComponent(String(header)) : 'unknown';
}

async function serveStatic(res, root, urlPath) {
  // Resolve safely inside root; reject traversal attempts.
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(root, rel);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (filePath !== root && !filePath.startsWith(rootWithSep)) {
    return json(res, 403, { error: 'Forbidden' });
  }
  let target = filePath;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
  } catch {
    return false; // caller may try a fallback
  }
  try {
    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1);
  const method = req.method.toUpperCase();

  // GET /api/state  -> full snapshot
  if (seg[0] === 'state' && method === 'GET') {
    return json(res, 200, { ...db.snapshot(), clients: sse.clientCount() });
  }

  // GET /api/events -> SSE stream
  if (seg[0] === 'events' && method === 'GET') {
    sse.addClient(res);
    return;
  }

  // GET /api/export -> download the whole database
  if (seg[0] === 'export' && method === 'GET') {
    const data = JSON.stringify(db.get(), null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="shopline-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      'Content-Length': Buffer.byteLength(data),
    });
    res.end(data);
    return;
  }

  // POST /api/import -> replace the whole database
  if (seg[0] === 'import' && method === 'POST') {
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object') throw new Error('Bad payload');
      db.replaceAll(body, actorFrom(req));
      sse.broadcast({ type: 'reload' });
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // POST /api/clear -> empty every collection, keep settings (hand-off / start clean)
  if (seg[0] === 'clear' && method === 'POST') {
    db.clear(actorFrom(req));
    sse.broadcast({ type: 'reload' });
    return json(res, 200, { ok: true });
  }

  // Settings: PATCH /api/settings
  if (seg[0] === 'settings') {
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req).catch((e) => e);
      if (body instanceof Error) return json(res, 400, { error: body.message });
      return json(res, 200, db.updateSettings(body, actorFrom(req)));
    }
    return json(res, 405, { error: 'Method not allowed' });
  }

  const collectionName = seg[0];
  if (!collectionByName[collectionName]) {
    return json(res, 404, { error: `Unknown collection "${collectionName}"` });
  }

  // GET /api/:collection
  if (seg.length === 1 && method === 'GET') {
    return json(res, 200, db.get()[collectionName]);
  }

  // POST /api/:collection
  if (seg.length === 1 && method === 'POST') {
    const body = await readBody(req).catch((e) => e);
    if (body instanceof Error) return json(res, 400, { error: body.message });
    return json(res, 201, db.create(collectionName, body, actorFrom(req)));
  }

  // /api/:collection/:id
  if (seg.length === 2) {
    const id = seg[1];
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readBody(req).catch((e) => e);
      if (body instanceof Error) return json(res, 400, { error: body.message });
      const updated = db.update(collectionName, id, body, actorFrom(req));
      return updated ? json(res, 200, updated) : json(res, 404, { error: 'Not found' });
    }
    if (method === 'DELETE') {
      const removed = db.remove(collectionName, id, actorFrom(req));
      return removed ? json(res, 200, { ok: true, item: removed }) : json(res, 404, { error: 'Not found' });
    }
    if (method === 'GET') {
      const item = db.get()[collectionName].find((r) => r.id === id);
      return item ? json(res, 200, item) : json(res, 404, { error: 'Not found' });
    }
  }

  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    if (url.pathname.startsWith('/shared/')) {
      const ok = await serveStatic(res, SHARED_DIR, url.pathname.replace(/^\/shared\//, ''));
      if (ok) return;
      return json(res, 404, { error: 'Not found' });
    }

    // Friendly alias for the wall board.
    if (url.pathname === '/display' || url.pathname === '/display/') {
      const ok = await serveStatic(res, PUBLIC_DIR, '/display.html');
      if (ok) return;
    }

    // Static app. Directories resolve to index.html; unknown paths fall back
    // to the SPA shell so deep links like /display keep working.
    const ok = await serveStatic(res, PUBLIC_DIR, url.pathname);
    if (ok) return;
    const shell = await serveStatic(res, PUBLIC_DIR, '/index.html');
    if (shell) return;
    return json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) json(res, 500, { error: 'Internal server error' });
  }
});

function lanAddresses() {
  const out = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const total = collections.reduce((n, c) => n + (db.get()[c.name]?.length || 0), 0);
  console.log('');
  console.log('  Shopline maintenance dashboard is running');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Local:      http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`  Network:    http://${ip}:${PORT}`);
    console.log(`  Wall TV:    http://${ip}:${PORT}/display`);
  }
  console.log('');
  console.log(`  Records loaded: ${total} across ${collections.length} collections`);
  console.log('  Press Ctrl+C to stop');
  console.log('');
});

const shutdown = () => {
  console.log('\n[server] saving and shutting down...');
  try {
    db.persistNow();
  } catch (err) {
    console.error('[server] failed to persist', err);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
