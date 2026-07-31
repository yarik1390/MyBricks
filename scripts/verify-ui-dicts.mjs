#!/usr/bin/env node
/**
 * Verify the exact-match UI dictionaries against the harvested English source.
 *
 * The failure mode this exists to catch is silent: a key that drifted by even
 * one character never matches a rendered node, so the translation is dead code
 * that looks present in the file and in any entry count. Counting entries is
 * therefore NOT verification — comparing keys to the source is.
 *
 * Usage: node scripts/verify-ui-dicts.mjs [path/to/ui-strings.json]
 * Exits non-zero if any dictionary has drifted or untranslated keys.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SRC = process.argv[2] || 'scripts/ui-strings.json';

const source = JSON.parse(readFileSync(SRC, 'utf8')).map((r) => r.text);
const sourceSet = new Set(source);

const files = readdirSync('public/js/locales').filter((f) => /^ui-[a-z]{2}\.js$/.test(f));
if (!files.length) {
  console.log('no ui-*.js dictionaries yet');
  process.exit(0);
}

let bad = 0;
console.log(`source: ${source.length} strings\n`);

for (const file of files.sort()) {
  const mod = await import(pathToFileURL(`public/js/locales/${file}`).href);
  const dict = mod.ui || mod.default || {};
  const keys = Object.keys(dict);

  const drifted = keys.filter((k) => !sourceSet.has(k));
  const missing = source.filter((s) => !(s in dict));
  // A value identical to its key is untranslated — legitimate for brand names,
  // but a large count means the translator passed text through wholesale.
  const passthrough = keys.filter((k) => dict[k] === k);
  const empty = keys.filter((k) => !String(dict[k]).trim());

  const ok = !drifted.length && !missing.length && !empty.length;
  if (!ok) bad++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${file.padEnd(10)} ${String(keys.length).padStart(4)} keys` +
    `  drifted:${drifted.length}  missing:${missing.length}  passthrough:${passthrough.length}  empty:${empty.length}`);
  for (const k of drifted.slice(0, 3)) console.log(`       drifted key: ${JSON.stringify(k.slice(0, 60))}`);
  for (const k of missing.slice(0, 3)) console.log(`       missing key: ${JSON.stringify(k.slice(0, 60))}`);
}

process.exit(bad ? 1 : 0);
