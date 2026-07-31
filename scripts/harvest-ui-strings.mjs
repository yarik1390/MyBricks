#!/usr/bin/env node
/**
 * Harvest user-facing English strings from the frontend into a flat list.
 *
 * Feeds the exact-match runtime dictionary (public/js/locales/ui-<code>.js).
 * Deliberately CONSERVATIVE: a string that slips through and gets translated
 * when it should not have been is a visible bug, while one that is missed just
 * stays English — the same as today. So the filters below reject anything that
 * looks like code, a class list, a URL, a format token or a bare number.
 *
 * Usage: node scripts/harvest-ui-strings.mjs > /tmp/ui-strings.json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['public/js/views', 'public/js/components', 'public/js/lib'];
const SKIP_FILES = /pure\.js$|pure-core\.js$|morphdom\.js$|i18n\.js$|locales\//;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.js' && !SKIP_FILES.test(p)) out.push(p);
  }
  return out;
}

// Reject anything that is plainly not prose the user reads.
const REJECT = [
  /^[\s\d.,:;%+\-*/()[\]{}<>|&$#@!?"'`~^=_]*$/,   // punctuation / numbers only
  /^(https?:|\/|\.\/|#|data:|mailto:)/i,           // urls and paths
  /[{}]/,                                          // template holes / JSON
  /^[a-z0-9_-]+$/i,                                // single identifier-ish token
  /^[A-Z_]{2,}$/,                                  // CONSTANT_CASE
  /\b(var|const|let|function|return|await|async)\b/,
  /^(px|em|rem|vh|vw|deg|ms|USD|EUR|GBP|CAD|AUD)$/i,
  /[;:]\s*[\w-]+\s*:/,                             // css declarations
  /^\w+\(/,                                        // fn call
];

function isProse(s) {
  const v = s.trim();
  if (v.length < 2 || v.length > 160) return false;
  if (!/[A-Za-z]{2}/.test(v)) return false;
  // Needs either a space (a phrase) or to be a plain capitalised word.
  if (!/\s/.test(v) && !/^[A-Z][a-z]+$/.test(v)) return false;
  // Must READ as a complete label: start on a letter/digit, not mid-sentence.
  // Only hole-free strings can ever exact-match a rendered text node, so a
  // fragment left over from a split template literal is pure noise here.
  if (!/^[A-Za-z0-9]/.test(v)) return false;
  if (/[,;]$/.test(v)) return false;
  if (/["\\]|\bnull\b|\bundefined\b/.test(v)) return false;
  return !REJECT.some((re) => re.test(v));
}

const found = new Map(); // string -> Set(files)
const add = (s, file) => {
  const v = s.replace(/\s+/g, ' ').trim();
  if (!isProse(v)) return;
  if (!found.has(v)) found.set(v, new Set());
  found.get(v).add(file);
};

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const short = file.replace('public/js/', '');
    // 1. Text between tags inside template literals: >Some words<
    for (const m of src.matchAll(/>([^<>{}`$]{2,160})</g)) add(m[1], short);
    // 2. Quoted strings passed to the obvious user-facing calls.
    for (const m of src.matchAll(/\b(?:toast|confirm|alert|promptSheet|aria-label=|placeholder=|title=)\s*\(?\s*["']([^"'`]{2,160})["']/g)) add(m[1], short);
    // 3. HTML attributes inside templates.
    for (const m of src.matchAll(/(?:aria-label|placeholder|title)="([^"{}`$]{2,160})"/g)) add(m[1], short);
  }
}

const rows = [...found.entries()]
  .map(([text, files]) => ({ text, files: [...files].sort() }))
  .sort((a, b) => a.text.localeCompare(b.text));

process.stdout.write(JSON.stringify(rows, null, 2));
process.stderr.write(`harvested ${rows.length} strings from ${ROOTS.join(', ')}\n`);
