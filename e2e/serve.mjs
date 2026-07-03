// Zero-dependency static file server for the Playwright smoke suite. Serves the
// built `public/` SPA so tests run against the REAL frontend bundle with no live
// services. Correct JS MIME is essential — a wrong content-type makes the browser
// refuse to execute the ES module scripts. /api/* is never served here: the tests
// intercept it via page.route(). Hash routing means the browser only ever requests
// "/" for navigations, so no server-side SPA rewrite is needed (but we fall back to
// index.html for any extensionless path just in case).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.env.PORT || 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};
const extOf = (p) => { const i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i).toLowerCase(); };

const server = createServer(async (req, res) => {
  // Path only — drop the query (e.g. /manifest.json?_=123 → /manifest.json).
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // Block traversal, then resolve within PUBLIC_DIR.
  const safe = pathname.replace(/\\/g, '/').replace(/\.\.+/g, '.');
  let filePath = fileURLToPath(new URL('.' + safe, 'file://' + PUBLIC_DIR));
  let ext = extOf(filePath);
  try {
    let body = await readFile(filePath).catch(() => null);
    if (body == null) {
      // Extensionless (e.g. a deep link) → SPA shell.
      if (!ext) { filePath = PUBLIC_DIR + 'index.html'; ext = '.html'; body = await readFile(filePath); }
      else { res.writeHead(404); res.end('not found'); return; }
    }
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

server.listen(PORT, () => console.log(`[e2e] static server on http://localhost:${PORT} (root: ${PUBLIC_DIR})`));
