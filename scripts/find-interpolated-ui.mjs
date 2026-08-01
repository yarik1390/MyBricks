#!/usr/bin/env node
/**
 * Find template-literal UI text that renders WITH data baked in.
 *
 * These are the strings the exact-match dictionary can NEVER reach: the browser
 * produces one text node like "Invested $700.00" or "0/0 collected", and no
 * fixed key can match it. They are the residual ~17% of untranslated on-screen
 * text after the harvester gaps were closed, and the only fix is a call-site
 * t('key', { vars }) with {placeholders}.
 *
 * Output is the worklist for that extraction — deliberately a report, not an
 * automated rewrite, because each one needs a human decision about where the
 * placeholder boundary goes ("{n} sets" vs "{n} set" plurals, currency
 * position, and so on).
 *
 * Usage: node scripts/find-interpolated-ui.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.js' && !/__tests__/.test(p)) out.push(p);
  }
  return out;
};

const hits = new Map();
for (const root of ['public/js/views', 'public/js/components']) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const short = file.replace('public/js/', '');
    // >  text ${hole} text  <  — prose on at least one side of an interpolation.
    for (const m of src.matchAll(/>([^<>`]{0,60}\$\{[^}]{1,60}\}[^<>`]{0,60})</g)) {
      const raw = m[1].replace(/\s+/g, ' ').trim();
      const literal = raw.replace(/\$\{[^}]*\}/g, ' ');
      // Needs real words outside the hole, or there is nothing to translate.
      if (!/[A-Za-z]{3}/.test(literal)) continue;
      if (!hits.has(raw)) hits.set(raw, new Set());
      hits.get(raw).add(short);
    }
  }
}

const ranked = [...hits.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`interpolated user-facing fragments: ${ranked.length}\n`);
for (const [text, files] of ranked.slice(0, 25)) {
  console.log(`  ${JSON.stringify(text.slice(0, 82))}`);
  console.log(`      ${[...files].slice(0, 3).join(', ')}`);
}
