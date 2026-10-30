// Tiny local web server for the checked-out app (no extra packages).
// Serves ROOT at http://127.0.0.1:PORT/witnessing-app/ so paths match the live site.
// Usage: node tests/serve.js <app-folder> [port]     (default port 8931; never 8765)
// Test-only switch for the update check (checklist step 1): the test runner can PUT an older index.html / sw.js
// to /__ci/old/index.html or /__ci/old/sw.js; they are served in place of the real ones (kept in memory only)
// until DELETE /__ci/old. Only the copy of the app being tested is affected; nothing is saved to disk.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || 'app');
const PORT = +(process.argv[3] || process.env.APP_PORT || 8931);
if (PORT === 8765) { console.error('Port 8765 is not allowed for this project.'); process.exit(2); }
const BASE = '/witnessing-app/';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css' };
const OLD = {};
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/__ci/old')) {
    const name = u.pathname.slice('/__ci/old/'.length);
    if (req.method === 'DELETE') { for (const k of Object.keys(OLD)) delete OLD[k]; res.writeHead(204); return res.end(); }
    if (req.method === 'PUT' && (name === 'index.html' || name === 'sw.js')) {
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', () => { OLD[name] = Buffer.concat(chunks); res.writeHead(204); res.end(); }); return;
    }
    res.writeHead(400); return res.end('bad request');
  }
  // Test-only blank page on the same site, used to clear and then confirm the site's saved data before each fresh start.
  // It is outside the app's folder, so no service worker controls it and the app never runs on it.
  if (u.pathname === '/__ci/blank') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end('<!doctype html><title>blank</title>'); }
  // Probe used by the offline checks: answers 204 only while the server is reachable.
  if (u.pathname === BASE + 'ci-probe') { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }
  if (u.pathname === '/' ) { res.writeHead(302, { location: BASE }); return res.end(); }
  if (!u.pathname.startsWith(BASE)) { res.writeHead(404); return res.end('not found'); }
  let rel = decodeURIComponent(u.pathname.slice(BASE.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  // Never serve dotfiles (.git and so on) or anything outside the app folder.
  if (rel.split('/').some(p => p.startsWith('.'))) { res.writeHead(404); return res.end('not found'); }
  if (OLD[rel]) { res.writeHead(200, { 'content-type': TYPES[path.extname(rel)], 'cache-control': 'no-cache' }); return res.end(OLD[rel]); }
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Serving ' + ROOT + ' at http://127.0.0.1:' + PORT + BASE));
