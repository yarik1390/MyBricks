#!/usr/bin/env node
/**
 * Decode HTML entities that ended up in dictionary VALUES.
 *
 * translateDOM assigns to node.nodeValue, which is plain text — the browser
 * does not decode it. So a value containing "&gt;" paints the five characters
 * "&gt;" on screen. A user reported seeing "Я &gt; Інтеграції".
 *
 * These are fallout from the entity KEY repair. The keys used to be stored
 * encoded ("Me &gt; Integrations"), the translators faithfully mirrored the
 * entity into their translations, and when the keys were later decoded the
 * values were left alone. Fixing the key made the entry match a real text node
 * for the first time — which is exactly what exposed the broken value.
 *
 * Usage: node scripts/fix-entity-values.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const ENTITY = /&(amp|lt|gt|quot|#0?39|nbsp);/;
const decode = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
  // &amp; LAST, so "&amp;lt;" does not become "<".
  .replace(/&amp;/g, '&');

let total = 0;
for (const file of readdirSync('public/js/locales').filter((f) => /^ui-\w+\.js$/.test(f))) {
  const path = `public/js/locales/${file}`;
  let fixed = 0;
  const out = readFileSync(path, 'utf8').split('\n').map((line) => {
    const m = line.match(/^(\s*"(?:[^"\\]|\\.)*":\s*)("(?:[^"\\]|\\.)*")(,?)$/);
    if (!m) return line;
    const value = JSON.parse(m[2]);
    if (!ENTITY.test(value)) return line;
    fixed++;
    return `${m[1]}${JSON.stringify(decode(value))}${m[3]}`;
  });
  if (!DRY && fixed) writeFileSync(path, out.join('\n'));
  if (fixed) console.log(`  ${file}: ${fixed} value(s) decoded`);
  total += fixed;
}
console.log(`${DRY ? 'would decode' : 'decoded'} ${total} values`);
