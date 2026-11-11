// Every shipped module under public/js must be precached by the service worker,
// otherwise a screen that lazy-imports it breaks offline on a fresh install.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const publicDir = join(root, 'public');
const sw = readFileSync(join(publicDir, 'sw.js'), 'utf8');

// Modules deliberately left out of the precache (fetched on demand only).
// Add an entry here with a reason if a module is too big or rarely used.
const LAZY_ONLY = new Set([]);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(join(dir, e.name));
    return e.name.endsWith('.js') ? [join(dir, e.name)] : [];
  });
}

describe('service worker asset coverage', () => {
  it('precaches every public/js module', () => {
    const missing = walk(join(publicDir, 'js'))
      .map((f) => '/' + relative(publicDir, f).split('\\').join('/'))
      .filter((url) => !LAZY_ONLY.has(url))
      .filter((url) => !sw.includes(`'${url}'`) && !sw.includes(`"${url}"`));
    assert.deepEqual(missing, [], `add these to STATIC_ASSETS in public/sw.js (and bump VERSION): ${missing.join(', ')}`);
  });
});
