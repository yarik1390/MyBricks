import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// t() falls back to the raw key, so a key missing from en.js ships as visible
// text ("catalog.comingSoon" on Discover). Every literal key the UI asks for
// must exist in the English source catalogue (plurals as keyOne / keyOther).
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const { en } = await import(new URL('../../public/js/locales/en.js', import.meta.url));

function has(key) {
  let node = en;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object' || !(part in node)) return false;
    node = node[part];
  }
  return typeof node === 'string';
}

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!['vendor', 'locales', '__tests__'].includes(name)) sources(path, out);
    } else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

test('every literal translation key used by the UI exists in en.js', () => {
  const call = /\b(t|tPlural|translate)\(\s*(['"`])([a-zA-Z]\w*(?:\.\w+)+)\2/g;
  const missing = [];
  for (const file of sources(join(ROOT, 'public/js'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(call)) {
      const key = m[3];
      const ok = m[1] === 'tPlural' ? ['One', 'Other', 'Many', ''].some((s) => has(key + s)) : has(key);
      if (!ok) missing.push(`${key} (${file.slice(ROOT.length)}:${src.slice(0, m.index).split('\n').length})`);
    }
  }
  assert.deepEqual(missing, []);
});
