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
// methodology.html is a full page of product copy ("How we price LEGO sets"),
// reachable from every set page, and it was never scanned — HTML_FILES held only
// the shell. privacy.html and terms.html are deliberately NOT here: they are
// legal text, where shipping an unreviewed machine translation is a real risk
// rather than a cosmetic one, and English is the safer default until a human
// translates them.
const HTML_FILES = ['public/index.html', 'public/methodology.html'];
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
  // CLASS LISTS. The broad literal rule (9) sees every quoted string, and this
  // codebase passes className strings constantly: "btn-secondary compact-btn",
  // "icon-btn vault-extra-action", "chip active". Two or more all-lowercase
  // hyphenated tokens is a class list, never a sentence — prose that short has
  // a capital or punctuation.
  // A class list has no English function words; "when your device supports it"
  // is a sentence fragment split by a link and was being rejected as one.
  //    The stopword test must match a WHOLE token: \b finds "is" inside the
  //    class name "is-error" and "no" inside "no-tab-swipe", which let class
  //    lists straight back through.
  (v) => {
    if (!/^[a-z][a-z0-9-]*([ ,]+[a-z][a-z0-9-]*)+$/.test(v)) return false;
    const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for',
      'with', 'your', 'you', 'we', 'is', 'are', 'it', 'this', 'that', 'when', 'if',
      'not', 'no', 'from', 'by', 'at', 'as', 'has', 'have', 'each', 'more', 'yet']);
    return !v.split(/[\s,]+/).some((tok) => STOP.has(tok));
  },
  // CSS SELECTOR of bare tag names, e.g. querySelectorAll('a, button'). The
  // stopword exemption above protects it, because "a" is both an article and a
  // tag. Every token being an HTML tag is the tell.
  (v) => {
    const TAGS = new Set(['a', 'button', 'div', 'span', 'p', 'ul', 'ol', 'li', 'img',
      'svg', 'input', 'select', 'textarea', 'label', 'form', 'table', 'tr', 'td', 'th',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav']);
    const toks = v.split(/[\s,]+/).filter(Boolean);
    return toks.length > 1 && toks.every((t) => TAGS.has(t));
  },
  // Inline CSS values: "opacity .18s ease", "transform .2s linear".
  /\d*\.?\d+(s|ms|px|em|rem|vh|vw)\b/,
  /\b(ease|ease-in|ease-out|linear|cubic-bezier|infinite|forwards|nowrap|inherit)\b/,
  // Pipe/tab-delimited data blobs, e.g. "Harry Potter|n".
  /[|\t]/,
  /=device-width|initial-scale|user-scalable|charset=/i,   // <meta> directives
  // CONTRACTION REMNANTS. Scanning for quoted literals without a JS parser
  // mis-pairs an apostrophe inside a template literal with a later quote, so
  // `You're short. (You need ${n})` can yield the tail "re short. (You".
  // Matching per quote style fixed most of it; a parser would fix the rest.
  // These shapes are the giveaway and are never real UI: no label begins with a
  // lowercase contraction ending, and none is a bare pronoun.
  /^(re|t|s|ve|ll|d|m)\s/,
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
  // Provider and vendor names that appear as bare labels in the admin
  // console and the source list. Translating a vendor's name is wrong in
  // every language.
  'Bright Data', 'Google Sheets', 'StockX', 'Firecrawl', 'OpenAI', 'OpenRouter',
  'BrickOwl', 'BrickInsights', 'Cloudflare', 'Hugging Face', 'UPCitemdb',
  // A LEGO theme name, not UI copy.
  'Modular Buildings',
  // Vendor, and an HTTP auth scheme that appears verbatim in a header.
  'Supabase', 'Bearer', 'PUT',
  // Supporter tier names, shown as "PRO"/"Pro" and left English on purpose so
  // the paywall copy reads the same in every language.
  'PRO', 'Pro',
]);

// Rendered position is strong evidence a string is UI, but not proof. These are
// the shapes that still slip through it: a bare lowercase word (a colour or a
// condition key echoed into markup), a dotted identifier, and a URL that has no
// scheme so the REJECT list's url rule misses it.
const RENDERED_JUNK = [
  /^[a-z][a-z0-9_-]*$/,             // "gray", "used", "value_desc", "your-name"
  /^[a-z]+([A-Z][a-z0-9]*)+$/,      // camelCase element ids: "signInRow"
  /^[a-z-]+=$/i,                    // "aria-live=", "data-set=" attribute stubs
  /\.\.\.$/,                        // "AIza...", "sk-..." credential placeholders
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
  // A capitalised word, optionally hyphenated: "Forecast", "Set-exclusive".
  const looksLikeLabel = /^[A-Z][a-z]+(-[a-z]+)*$/.test(v);
  if (!/\s/.test(v) && !looksLikeLabel && !rendered) return false;
  // The identifier reject is CASE-INSENSITIVE, so on its own it also matches
  // "Forecast" and "Set-exclusive" and undoes the line above — the same shape
  // of bug that hid the single-word vocabulary for the whole first pass.
  // Exempting anything that already read as a label is what makes the two
  // rules agree.
  if (!rendered && !looksLikeLabel && /^[a-z0-9_-]+$/i.test(v)) return false;
  // A bare pronoun is the tail of a mis-paired contraction ("(You" from
  // "You're short. (You need 4)") — unless it is rendered, where "You" is the
  // profile tab's label.
  if (!rendered && /^(You|We|It|They|That|There)$/.test(v)) return false;
  // Must READ as a complete label: start on a letter/digit, not mid-sentence.
  // Rendered labels may lead with a symbol ("+ Wishlist", "← Back"); a quoted
  // fragment from a split template literal may not.
  if (!/^[A-Za-z0-9]/.test(v) && !(rendered && /^[+←→✓✕·—–]\s?\S/.test(v))) return false;
  if (/[,;]$/.test(v)) return false;
  if (/["\\]|\bnull\b|\bundefined\b/.test(v)) return false;
  if (rendered && /^[A-Z][A-Z\d\s&()/–—-]+$/.test(v)) return true;   // ALL-CAPS label
  return !REJECT.some((re) => (typeof re === 'function' ? re(v) : re.test(v)));
}

// Source templates carry HTML-ENCODED text ("Snap &amp; identify"), but the
// browser hands translateDOM the DECODED text node ("Snap & identify"). An
// encoded key therefore never matches anything: it is dead weight that still
// gets translated into every language and still counts towards "100% covered".
// 15 such keys shipped before a runtime audit caught them.
const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');

// LEGO THEME NAMES are brands, not copy — "Creator", "Friends", "Technic" must
// read the same in every language. Sourced from the THEME_COLORS map in
// lib/pure.js rather than hand-listed, so a theme added there is excluded here
// automatically instead of quietly reaching a translator.
for (const m of readFileSync('public/js/lib/pure.js', 'utf8')
  .matchAll(/^\s*"([^"]{2,40})":\s*\{\s*c:/gm)) DO_NOT_TRANSLATE.add(m[1]);

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
    // 2. Quoted strings passed to the obvious user-facing calls. These are as
    //    explicitly user-facing as rendered text, so they take rendered=true —
    //    otherwise the identifier reject eats every single-word one ("Alerts"),
    //    which is exactly what it did to the vault sheet's aria-labels.
    //    The quote styles are matched SEPARATELY: a single char class excluding
    //    both truncated any double-quoted string at its first apostrophe, so
    //    alert("Couldn't reach the server") harvested the word "Couldn".
    for (const m of src.matchAll(/\b(?:toast|confirm|alert|promptSheet|aria-label=|placeholder=|title=)\s*\(?\s*"([^"`]{2,160})"/g)) add(m[1], short, true);
    for (const m of src.matchAll(/\b(?:toast|confirm|alert|promptSheet|aria-label=|placeholder=|title=)\s*\(?\s*'([^'`]{2,160})'/g)) add(m[1], short, true);
    // 3. HTML attributes inside templates.
    for (const m of src.matchAll(/(?:aria-label|placeholder|title)="([^"{}`$]{2,160})"/g)) add(m[1], short, true);
    // 4. Both branches of a ternary INSIDE a template hole:
    //      <button>${owned ? 'Your Sets' : 'All sets'}</button>
    // Rule 1 cannot see these — it requires the span between > and < to contain
    // no `$`, which a hole always does — and they turned out to be a large
    // share of the visible untranslated text.
    //    rendered=true: both branches sit inside a template hole between tags,
    //    so they ARE painted text. Without it the symbol-led labels are dropped
    //    — "+ Wishlist" and "✓ Wishlisted" stayed English for exactly that
    //    reason, since a quoted fragment may not start on punctuation.
    for (const m of src.matchAll(/\?\s*(['"])([^'"`\n]{3,160})\1\s*:\s*(['"])([^'"`\n]{3,160})\3/g)) {
      add(m[2], short, true); add(m[4], short, true);
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
    // 7. ENUM LOOKUP MAPS. This app renders a lot of copy through
    //      ({ sold: 'Verified sold data', modeled: 'Market guides (not live sales)' })[value]
    //    where the keys are the enum, not `label`/`title`, so rule 5's fixed key
    //    list never sees them. Any identifier key is accepted here, but the
    //    STRICT prose test applies (rendered=false): a value has to read like a
    //    phrase, which keeps enum keys like 'sold' and 'modeled' out.
    for (const m of src.matchAll(/\b[A-Za-z_$][\w$]*\s*:\s*(['"])([^'"`\n]{3,160})\1/g)) {
      add(m[2], short);
    }
    // 8. EITHER branch of a ternary, not both. Rule 4 requires two quoted
    //    strings, so it misses the common shapes where one side is a template
    //    literal or a call:
    //      n === 1 ? 'Set-exclusive' : `Appears in ${n} sets`
    //      liquidation > 0 ? fmtMoney(liquidation) : 'Not enough sold data yet'
    for (const m of src.matchAll(/\?\s*(['"])([^'"`\n]{3,160})\1/g)) add(m[2], short);
    for (const m of src.matchAll(/:\s*(['"])([^'"`\n]{3,160})\1/g)) add(m[2], short);
    // 6. Positional string arguments to the app's own row/section helpers, which
    //    render their arguments as the visible title and subtitle:
    //      linkRow("#/me/admin", "Admin console", "Catalog imports, jobs, ...")
    for (const m of src.matchAll(/\b(?:linkRow|settingRow|sectionRow|navRow|card|tile|emptyState|conditionStateHTML|chip)\s*\(([^)]{0,400})\)/g)) {
      for (const q of m[1].matchAll(/(['"])([^'"`\n]{2,160})\1/g)) add(q[2], short, true);
    }
    // 9. EVERY remaining quoted literal, gated ONLY by the strict prose test.
    //    Rules 1-8 each chase a syntactic shape, and the shapes kept coming:
    //    array elements (rows.push(['Used & complete', ...])), positional args
    //    to helpers not on the list (fact('Packaging', value)), and so on. The
    //    real gate was never the shape — it is isProse, which already demands a
    //    phrase or a capitalised word and rejects identifiers, code fragments,
    //    URLs and CSS. Running it over every literal is both simpler and wider;
    //    the shape-specific rules above remain only because they pass
    //    rendered=true where the evidence justifies relaxing the filter.
    //    A quoted OBJECT KEY is skipped (the literal is followed by a colon):
    //    those are config and lookup tables — THEME_COLORS is keyed by LEGO
    //    theme name, so taking keys would have handed "Disney", "Creator" and
    //    "Collectible Minifigures" to the translators as if they were UI copy.
    //    Rule 7 already takes the VALUE side of `key: 'string'`.
    //    Matched PER QUOTE STYLE. A single class excluding both truncates any
    //    double-quoted string at its first apostrophe and harvests the tail:
    //    "You're short. (You need 4)" yielded the fragment "re short. (You".
    //    Rule 2 had this exact bug; rule 9 inherited it by copying the pattern.
    for (const re of [/"((?:[^"\\`\n]|\\.){3,160})"(\s*:)?/g, /'((?:[^'\\`\n]|\\.){3,160})'(\s*:)?/g]) {
      for (const m of src.matchAll(re)) {
        if (m[2]) continue;   // quoted OBJECT KEY — config, not copy
        add(m[1], short);
      }
    }
  }
}

// The app shell: static markup, so plain tag-text extraction is enough.
for (const file of HTML_FILES) {
  // <style> and <script> bodies are not copy. Scanning them harvested the CSS
  // selector "a, button" from methodology.html, which the stopword exemption
  // then protected from the class-list reject ("a" is a stopword). Stripping
  // the blocks is the honest fix; filtering their output is whack-a-mole.
  const src = readFileSync(file, 'utf8')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const short = file.replace('public/', '');
  for (const m of src.matchAll(/>([^<>{}`$]{2,160})</g)) add(m[1], short);
  // `content` is deliberately NOT here: <meta content="width=device-width,…">
  // is a browser directive, and og:description is page metadata rather than
  // in-app UI. Both reached the source list before this.
  for (const m of src.matchAll(/(?:aria-label|placeholder|title)="([^"{}`$]{2,160})"/g)) add(m[1], short);
}

const rows = [...found.entries()]
  .map(([text, files]) => ({ text, files: [...files].sort() }))
  .sort((a, b) => a.text.localeCompare(b.text));

process.stdout.write(JSON.stringify(rows, null, 2));
process.stderr.write(`harvested ${rows.length} strings from ${ROOTS.join(', ')}\n`);
