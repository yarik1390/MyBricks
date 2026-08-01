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
 * FROZEN SOURCE. scripts/ui-strings.json is the list the shipped ui-<code>.js
 * dictionaries are keyed to, and it is NOT regenerated casually: dropping an
 * entry leaves every dictionary holding a key that no longer exists in the
 * source, which verify-ui-dicts.mjs reports as drift. Regenerating means
 * re-running the translators. The filter below is kept current anyway so the
 * next deliberate regeneration starts clean — as of this commit it drops the 6
 * expression fragments that reached the first harvest and had to be passed
 * through by hand in every language (776 -> 770), while keeping lookalikes
 * that are real UI ("Critics' score", "No active high-risk sets (score >= 70)").
 *
 * Usage: node scripts/harvest-ui-strings.mjs > /tmp/ui-strings.json
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['public/js/views', 'public/js/components', 'public/js/lib'];
// The app SHELL is not JavaScript. "Skip to content", the nav labels and the
// offline banner live in index.html and were invisible to the first harvest.
const HTML_FILES = ['public/index.html'];
// pure.js was skipped as "pure logic" — wrong. It returns user-facing COPY from
// helpers like catalogFilterSummary() and valuationTrust() ("Market price",
// "No filters active"), so its strings reach the screen like any other.
const SKIP_FILES = /pure-core\.js$|morphdom\.js$|i18n\.js$|locales\/|__tests__\//;

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
  /^[A-Z_]{2,}$/,                                  // CONSTANT_CASE
  /\b(var|const|let|function|return|await|async)\b/,
  /^(px|em|rem|vh|vw|deg|ms|USD|EUR|GBP|CAD|AUD)$/i,
  /[;:]\s*[\w-]+\s*:/,                             // css declarations
  /^\w+\(/,                                        // fn call
  // Expression fragments that survived the char-class filters because the
  // template hole fell OUTSIDE the captured span, so no `${` was ever seen,
  // e.g. "80 && Math.abs(dy)". Six reached the first harvest and had to be
  // passed through by hand in every language.
  /&&|\|\||=>|\+\+|--|\bMath\.|\.\w+\(|[([]\s*[a-z]{1,3}\s*[)\]]/,
  /\+=|-=|\belse if\b|^\d+(\.\d+)?\)/,   // "0.2) score += 8; else if (…"
];

// Acronyms, units and formats that are the SAME word in every language. They
// reach the screen as real labels, so nothing else here would reject them, and
// translating one is a visible bug rather than a missed opportunity.
const DO_NOT_TRANSLATE = new Set([
  'CSV', 'PDF', 'JSON', 'API', 'URL', 'PIN', 'ROI', 'AI', 'XP', 'ID', 'OK',
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'UPC', 'EAN', 'SKU', 'PWA', 'QR',
  'BrickLink', 'BrickEconomy', 'Brickset', 'Brickset.com', 'Rebrickable',
  'PriceCharting', 'LEGO', 'BricksVault', 'Brickvault', 'Amazon', 'eBay',
  'WebGPU', 'Gemma', 'Gemini', 'Discord', 'Chrome',
  // Supporter tier names, shown as "PRO"/"Pro" and left English on purpose so
  // the paywall copy reads the same in every language.
  'PRO', 'Pro',
]);

// Rendered position is strong evidence a string is UI, but not proof. These are
// the shapes that still slip through it: a bare lowercase word (a colour or a
// condition key echoed into markup), a dotted identifier, and a URL that has no
// scheme so the REJECT list's url rule misses it.
const RENDERED_JUNK = [
  /^[a-z][a-z0-9_]*$/,              // "gray", "green", "used", and "value_desc"
  /^[a-z]\.\w+$/i,                  // "i.annualized_roi", "x.slope_90d"
  /^[a-z][\w.-]*:\/\//i,            // "chrome://flags/…"
  /^[a-z0-9-]+(\.[a-z]{2,})+\//i,   // "aistudio.google.com/apikey"
  /\bhigh\/medium\/low\b/i,         // enum documentation, not a label
];

/**
 * `rendered` = the string was captured between > and <, i.e. it IS a text node
 * the browser paints. That is much stronger evidence than a quoted argument
 * somewhere in the source, so the filters relax: a single word, an ALL-CAPS
 * display label ("VALUE", "PREFERENCES") or a symbol-led label ("+ Wishlist",
 * "A–Z") are all legitimate UI there, and they are a large share of this app's
 * vocabulary — every settings row, sort chip and section heading.
 */
function isProse(s, rendered = false) {
  const v = s.trim();
  if (v.length < 2 || v.length > 160) return false;
  if (!/[A-Za-z]{2}/.test(v)) return false;
  if (DO_NOT_TRANSLATE.has(v)) return false;
  if (rendered && RENDERED_JUNK.some((re) => re.test(v))) return false;
  // A phrase, a plain capitalised word, or — only when rendered — any single
  // display label. The old code intended to allow capitalised single words but
  // the REJECT list's identifier rule (/^[a-z0-9_-]+$/i) silently overrode it,
  // which is why "Appearance", "Forecast", "Wishlist" and the whole single-word
  // UI vocabulary never reached a dictionary.
  if (!/\s/.test(v) && !/^[A-Z][a-z]+$/.test(v) && !rendered) return false;
  if (!rendered && /^[a-z0-9_-]+$/i.test(v)) return false;
  // Must READ as a complete label: start on a letter/digit, not mid-sentence.
  // Rendered labels may lead with a symbol ("+ Wishlist", "← Back"); a quoted
  // fragment from a split template literal may not.
  if (!/^[A-Za-z0-9]/.test(v) && !(rendered && /^[+←→✓✕·—–]\s?\S/.test(v))) return false;
  if (/[,;]$/.test(v)) return false;
  if (/["\\]|\bnull\b|\bundefined\b/.test(v)) return false;
  if (rendered && /^[A-Z][A-Z\d\s&()/–—-]+$/.test(v)) return true;   // ALL-CAPS label
  return !REJECT.some((re) => re.test(v));
}

// Source templates carry HTML-ENCODED text ("Snap &amp; identify"), but the
// browser hands translateDOM the DECODED text node ("Snap & identify"). An
// encoded key therefore never matches anything: it is dead weight that still
// gets translated into every language and still counts towards "100% covered".
// 15 such keys shipped before a runtime audit caught them.
const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');

const found = new Map(); // string -> Set(files)
const add = (s, file, rendered = false) => {
  const v = decodeEntities(s).replace(/\s+/g, ' ').trim();
  // Decoding can reveal a tag, which means the span was never one text node —
  // the DOM splits it around the element and no single key can ever match.
  if (/<[a-z/]/i.test(v)) return;
  if (!isProse(v, rendered)) return;
  if (!found.has(v)) found.set(v, new Set());
  found.get(v).add(file);
};

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const short = file.replace('public/js/', '');
    // 1. Text between tags inside template literals: >Some words<
    for (const m of src.matchAll(/>([^<>{}`$]{2,160})</g)) add(m[1], short, true);
    // 2. Quoted strings passed to the obvious user-facing calls.
    for (const m of src.matchAll(/\b(?:toast|confirm|alert|promptSheet|aria-label=|placeholder=|title=)\s*\(?\s*["']([^"'`]{2,160})["']/g)) add(m[1], short);
    // 3. HTML attributes inside templates.
    for (const m of src.matchAll(/(?:aria-label|placeholder|title)="([^"{}`$]{2,160})"/g)) add(m[1], short);
    // 4. Both branches of a ternary INSIDE a template hole:
    //      <button>${owned ? 'Your Sets' : 'All sets'}</button>
    // Rule 1 cannot see these — it requires the span between > and < to contain
    // no `$`, which a hole always does — and they turned out to be a large
    // share of the visible untranslated text.
    for (const m of src.matchAll(/\?\s*(['"])([^'"`\n]{3,160})\1\s*:\s*(['"])([^'"`\n]{3,160})\3/g)) {
      add(m[2], short); add(m[4], short);
    }
    // 5. User-facing OBJECT-LITERAL properties. This codebase builds most lists
    //    declaratively — sort chips are { label: 'Newest' }, settings rows are
    //    { title: 'Integrations', sub: '...' } — and none of it is inside a
    //    template, so rules 1-4 are blind to all of it.
    //    A `label:` key is as strong a signal as rendered position — stronger,
    //    if anything — so these pass rendered=true. Without it the identifier
    //    reject swallows every single-word label ("Newest", "Growth", "Recent",
    //    "Integrations"), which is exactly what it did.
    for (const m of src.matchAll(/\b(?:label|title|sub|subtitle|desc|description|heading|caption|hint|cta|blurb|body|tip)\s*:\s*(['"])([^'"`\n]{2,160})\1/g)) {
      add(m[2], short, true);
    }
    // 6. Positional string arguments to the app's own row/section helpers, which
    //    render their arguments as the visible title and subtitle:
    //      linkRow("#/me/admin", "Admin console", "Catalog imports, jobs, ...")
    for (const m of src.matchAll(/\b(?:linkRow|settingRow|sectionRow|navRow|card|tile|emptyState|conditionStateHTML|chip)\s*\(([^)]{0,400})\)/g)) {
      for (const q of m[1].matchAll(/(['"])([^'"`\n]{2,160})\1/g)) add(q[2], short, true);
    }
  }
}

// The app shell: static markup, so plain tag-text extraction is enough.
for (const file of HTML_FILES) {
  const src = readFileSync(file, 'utf8');
  const short = file.replace('public/', '');
  for (const m of src.matchAll(/>([^<>{}`$]{2,160})</g)) add(m[1], short);
  for (const m of src.matchAll(/(?:aria-label|placeholder|title|content)="([^"{}`$]{2,160})"/g)) add(m[1], short);
}

const rows = [...found.entries()]
  .map(([text, files]) => ({ text, files: [...files].sort() }))
  .sort((a, b) => a.text.localeCompare(b.text));

process.stdout.write(JSON.stringify(rows, null, 2));
process.stderr.write(`harvested ${rows.length} strings from ${ROOTS.join(', ')}\n`);
