#!/usr/bin/env node
/**
 * Remove dictionary keys the harvester no longer produces.
 *
 * A key that does not correspond to any string the app can render is dead: it
 * never matches a text node, but it still sits in eight dictionaries, still
 * costs a translation, and still counts towards "100% covered". verify-ui-dicts
 * cannot catch these on its own — it compares dictionaries to ui-strings.json,
 * so a dead key present in BOTH looks perfectly healthy.
 *
 * The first crop came from a capture regex whose character class excluded both
 * quote styles, so a double-quoted string was truncated at its first
 * apostrophe: alert("Couldn't reach the server") harvested "Couldn". Six such
 * fragments shipped, translated, into every language.
 *
 * DELIBERATELY NOT a blanket "delete anything not in the current harvest": the
 * source list also holds strings added from the runtime audit, which the static
 * harvester cannot see and which are the most reliable entries in the file.
 * Only keys matching a known-bad shape are considered, and each must also be
 * absent from the current harvest before it is removed.
 *
 * Usage: node scripts/prune-dead-keys.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');

// Truncated at an apostrophe: ends on the stem of a contraction.
const TRUNCATED = /\b(isn|couldn|shouldn|wouldn|don|doesn|didn|won|can|aren|wasn|weren|hasn|haven|hadn|you|they|we|it|that|there|here|what|let)$/i;

const harvested = new Set(
  JSON.parse(execFileSync('node', ['scripts/harvest-ui-strings.mjs'], { encoding: 'utf8', maxBuffer: 1 << 24 }))
    .map((r) => r.text),
);

const SRC = 'scripts/ui-strings.json';
const rows = JSON.parse(readFileSync(SRC, 'utf8'));
const dead = new Set(
  rows.map((r) => r.text).filter((t) => t.length > 8 && TRUNCATED.test(t) && !harvested.has(t)),
);

console.log(`dead keys: ${dead.size}`);
for (const d of dead) console.log(`   ${JSON.stringify(d)}`);
if (!dead.size) process.exit(0);

const kept = rows.filter((r) => !dead.has(r.text));
if (!DRY) writeFileSync(SRC, JSON.stringify(kept, null, 2));
console.log(`${SRC}: ${rows.length} -> ${kept.length}`);

for (const file of readdirSync('public/js/locales').filter((f) => /^ui-\w+\.js$/.test(f))) {
  const path = `public/js/locales/${file}`;
  const out = [];
  let removed = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*("(?:[^"\\]|\\.)*"):\s/);
    if (m && dead.has(JSON.parse(m[1]))) { removed++; continue; }
    out.push(line);
  }
  if (!DRY) writeFileSync(path, out.join('\n'));
  console.log(`  ${file}: -${removed}`);
}
