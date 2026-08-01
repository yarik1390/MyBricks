#!/usr/bin/env node
/**
 * One-off repair: HTML-ENTITY keys can never match a rendered text node.
 *
 * The harvester read source templates ("Snap &amp; identify") while the browser
 * hands translateDOM the DECODED text ("Snap & identify"). Fifteen keys shipped
 * in that state: present in ui-strings.json, translated into all eight
 * languages, counted as covered, and dead on arrival.
 *
 * Three outcomes per key:
 *   RENAME  decoded form is not in the source yet -> re-key, keep the translation
 *   DROP    decoded twin already exists (the runtime audit added it) -> discard
 *   DROP    decoding reveals a tag -> the DOM splits that span across elements,
 *           so no single key can match it; only a call-site fix would help
 *
 * The harvester itself now decodes on the way in, so this cannot recur. Kept in
 * the repo because it documents WHY those keys vanished from every dictionary
 * in one commit — a diff that otherwise looks like translation loss.
 *
 * Usage: node scripts/fix-entity-keys.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const ENTITY = /&(amp|lt|gt|quot|#0?39|nbsp);/;
const decode = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');

const SRC = 'scripts/ui-strings.json';
const rows = JSON.parse(readFileSync(SRC, 'utf8'));
const have = new Set(rows.map((r) => r.text));

const rename = new Map(); // encoded -> decoded
const drop = new Set();
for (const { text } of rows) {
  if (!ENTITY.test(text)) continue;
  const d = decode(text);
  if (/<[a-z/]/i.test(d) || have.has(d)) drop.add(text);
  else rename.set(text, d);
}
console.log(`entity keys: ${rename.size + drop.size}  rename: ${rename.size}  drop: ${drop.size}`);

// --- source list -----------------------------------------------------------
const next = rows
  .filter((r) => !drop.has(r.text))
  .map((r) => (rename.has(r.text) ? { ...r, text: rename.get(r.text) } : r))
  .sort((a, b) => a.text.localeCompare(b.text));
if (!DRY) writeFileSync(SRC, JSON.stringify(next, null, 2));
console.log(`${SRC}: ${rows.length} -> ${next.length}`);

// --- dictionaries ----------------------------------------------------------
// Rewritten by line so every untouched entry keeps its exact original
// formatting; only the affected lines change.
for (const file of readdirSync('public/js/locales').filter((f) => /^ui-\w+\.js$/.test(f))) {
  const path = `public/js/locales/${file}`;
  const lines = readFileSync(path, 'utf8').split('\n');
  let renamed = 0, dropped = 0;
  const out = [];
  const entries = [];   // [key, line] for the entry block, re-sorted at the end
  for (const line of lines) {
    const m = line.match(/^(\s*)("(?:[^"\\]|\\.)*")(: .*)$/);
    if (!m) { out.push(line); continue; }
    const key = JSON.parse(m[2]);
    if (drop.has(key)) { dropped++; continue; }
    if (rename.has(key)) {
      entries.push([rename.get(key), `${m[1]}${JSON.stringify(rename.get(key))}${m[3]}`]);
      renamed++;
      continue;
    }
    entries.push([key, line]);
  }
  // Renaming moves keys out of order, and the file is maintained sorted by the
  // English key — leaving it shuffled would make every future merge noisier.
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const at = out.findIndex((l) => l.includes('export const ui = {'));
  out.splice(at + 1, 0, ...entries.map((e) => e[1]));
  if (!DRY) writeFileSync(path, out.join('\n'));
  console.log(`  ${file}: renamed ${renamed}, dropped ${dropped}`);
}
