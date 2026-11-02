import { readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Pins the PageSpeed fixes for the first load (2026-11-02): the whole boot
// module graph is modulepreloaded so it downloads in one wave instead of a
// request waterfall, desktop.css never blocks a phone's first paint, and the
// pre-paint theme-init.js settles the shell so nothing shifts.
const read = (path) => readFileSync(new URL(`../../public/${path}`, import.meta.url), 'utf8');
const IMPORT_RE = /^\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gms;

function staticGraph(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read(file.slice(1)).matchAll(IMPORT_RE)) {
      walk(posix.normalize(posix.join(dirname(file), m[1] || m[2])));
    }
  };
  walk(entry);
  return seen;
}

const html = read('index.html');
const preloaded = new Set([...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]));

describe('first-load performance', () => {
  it('modulepreloads every module in the boot graph (app.js and App Lock)', () => {
    const needed = [...staticGraph('/js/app.js'), ...staticGraph('/js/lib/app-lock.js')]
      .filter((f) => f !== '/js/app.js');
    const missing = needed.filter((f) => !preloaded.has(f));
    assert.deepEqual(missing, [], `add these to index.html as <link rel="modulepreload">: ${missing.join(', ')}`);
    for (const f of preloaded) assert.doesNotThrow(() => read(f.slice(1)), `${f} is preloaded but does not exist`);
  });

  it('loads desktop.css media-gated, and keeps every rule in it inside a min-width query', () => {
    assert.match(html, /<link rel="stylesheet" href="\/desktop\.css" media="\(min-width: 1024px\)">/);
    const css = read('desktop.css').replace(/\/\*[\s\S]*?\*\//g, '');
    // Every top-level block's prelude must be a min-width (>= 1024px) query.
    let depth = 0;
    let prelude = '';
    for (const ch of css) {
      if (ch === '{') {
        if (depth === 0) {
          const q = prelude.trim();
          assert.match(q, /^@media \(min-width: (\d+)px\)$/, `rule outside a media query: ${q}`);
          assert.ok(Number(q.match(/\d+/)[0]) >= 1024, q);
          prelude = '';
        }
        depth++;
      } else if (ch === '}') depth--;
      else if (depth === 0) prelude += ch;
    }
    assert.match(read('bv.css'), /\.bv-side, \.bv-setrow__col, \.vault-list-head \{ display: none; \}/);
  });

  it('settles the shell pre-paint in theme-init.js (shell class, first-run welcome, view preload)', () => {
    const js = read('theme-init.js');
    assert.match(js, /'collector-ui'/);
    assert.match(js, /'bv_setup_v1'/);
    assert.match(js, /replaceState\(history\.state, '', '#\/welcome'\)/);
    assert.match(js, /mp\.rel = 'modulepreload'/);
    assert.match(read('js/views/welcome.js'), /const SETUP_FLAG = 'bv_setup_v1'/);
    assert.match(html, /<script src="\/theme-init\.js"><\/script>/);
  });
});
