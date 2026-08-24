#!/usr/bin/env node
/**
 * Keep interpolated UI sentences in the message catalogue.  The allowlist is
 * deliberately limited to value-only counters, an already-localized t() call,
 * a static DOM label, and the application-version brand line.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const uiRoots = ['public/js/views', 'public/js/components'];
const collectJs = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? collectJs(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name).replaceAll('\\', '/')] : []);
// Start at every UI entry point and follow relative imports. This brings shared
// render helpers (for example filter-summary.js) into the audit without a
// hand-maintained lib allowlist. The exclusions are data/rendering machinery
// with no authored UI prose; user-visible helpers remain in scope.
const semanticExclusions = new Set([
  'public/js/lib/i18n.js',
  'public/js/lib/morphdom.js',
  'public/js/lib/seed-catalog.js',
]);
const entryFiles = [...uiRoots.flatMap(collectJs), 'public/js/app.js', 'public/js/api.js'];
const localImports = (file) => {
  const source = readFileSync(file, 'utf8');
  const paths = new Set();
  for (const match of source.matchAll(/\bimport\s*(?:\(\s*)?(?:[^;'"()]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const imported = normalize(join(dirname(file), match[1])).replaceAll('\\', '/');
    if (existsSync(imported) && !semanticExclusions.has(imported)) paths.add(imported);
  }
  return paths;
};
const files = (() => {
  const seen = new Set(), pending = [...entryFiles];
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file) || semanticExclusions.has(file)) continue;
    seen.add(file);
    for (const imported of localImports(file)) if (!seen.has(imported)) pending.push(imported);
  }
  return [...seen];
})();
// A number passed to t() is not automatically plural grammar: percentages,
// ordinals, progress positions, ratios, and deliberately label-style metrics
// stay grammatical in every shipped locale. Every exception is documented here
// by message key; a new count-bearing t() otherwise has to use tPlural().
// Exceptions are deliberately restricted to invariant units and genuine
// ratio/progress values. Count-dependent nouns and verbs must use tPlural().
const COUNT_NEUTRAL_T_KEYS = new Map([
  ['downloads.scanProgress', 'ratio/progress'],
  ['game.roundOf', 'ratio/progress'],
  ['kids.xp', 'invariant-unit'],
  ['kids.xpToLevel', 'ratio/progress'],
  ['portfolio.insightQuantity', 'invariant-symbol'],
]);
const APPROVED_COUNT_NEUTRAL_KEYS = new Set([
  'downloads.scanProgress', 'game.roundOf', 'kids.xp', 'kids.xpToLevel',
  'portfolio.insightQuantity',
]);
for (const [key, category] of COUNT_NEUTRAL_T_KEYS) {
  if (!APPROVED_COUNT_NEUTRAL_KEYS.has(key) || !['ratio/progress', 'invariant-unit', 'invariant-symbol'].includes(category)) {
    throw new Error(`Unapproved count-neutral exception ${key} (${category})`);
  }
}
// These messages carry a count-dependent noun in at least one live locale.
// They must never be admitted as “neutral”: every caller has to use tPlural()
// (or pass already pluralized fragments into a neutral summary template).
const NOUN_BEARING_COUNT_KEYS = new Set([
  'admin.importedMinifigs', 'build.needParts', 'card.lots',
  'data.importResult', 'data.bricklinkImportResult', 'market.salesSuffix',
]);
for (const key of NOUN_BEARING_COUNT_KEYS) {
  if (COUNT_NEUTRAL_T_KEYS.has(key)) throw new Error(`Noun-bearing count key ${key} cannot be a count-neutral exception`);
}
const COUNT_VARIABLE = /\b(?:count|n|total|added|imported|failed|restored|salesVolume|volume|processed|updated|rejected|inserted|parsed|owned|quantity|qty|years|days|current|matched|spikes|drops|removed)\b/;
function literalTCalls(source) {
  const calls = [];
  for (const match of source.matchAll(/\bt\s*\(/g)) {
    let depth = 1, quote = '', escaped = false, end = match.index + match[0].length;
    for (; end < source.length && depth; end++) {
      const ch = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth) throw new Error(`Unclosed t() call near ${match.index}`);
    const call = source.slice(match.index + match[0].length, end - 1);
    const literal = call.match(/^\s*(['"])([a-z]+(?:\.[A-Za-z0-9]+)+)\1\s*,\s*\{([\s\S]*)\}\s*$/);
    if (literal && COUNT_VARIABLE.test(literal[3])) calls.push({ key: literal[2], offset: match.index });
  }
  return calls;
}
const countCallRegressions = [
  ["t('data.setsImported', { count: imported })", ['data.setsImported']],
  ["tPlural('data.setsImported', imported)", []],
  ["t('fees.marketplace', { pct: feePct })", []],
];
for (const [snippet, expected] of countCallRegressions) {
  const actual = literalTCalls(snippet).map(({ key }) => key);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`count-bearing t() parser regression for ${snippet}`);
}
const safeValueOnly = [
  /count\.textContent\s*=\s*[^;]*`\$\{lb\.index \+ 1\} \/ \$\{n\}`/,
  /badge\.textContent\s*=\s*`×\$\{qty\}`/,
  /(?:grossEl|feesEl|netEl)\.textContent\s*=\s*`-?\$\{symbol\}/,
  /appVersionLine[\s\S]{0,180}textContent\s*=\s*`BRICKSVAULT · v\$\{info\.version\}/,
];
// Template HTML does not pass through assignment APIs. Parse template literals
// and inspect text nodes that combine an interpolation with English prose.
// This deliberately ignores values, markup, CSS, ids/datasets, provider/catalog
// content, and a bare counter/badge. It catches the class of bug that an exact
// UI dictionary cannot translate: a rendered text node whose sentence contains
// a runtime value.
function templateLiterals(source) {
  const literals = [];
  for (let start = source.indexOf('`'); start >= 0; start = source.indexOf('`', start + 1)) {
    let escaped = false;
    let depth = 0;
    for (let end = start + 1; end < source.length; end++) {
      const ch = source[end];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '$' && source[end + 1] === '{') { depth++; end++; continue; }
      if (ch === '}' && depth) { depth--; continue; }
      if (ch === '`' && depth === 0) {
        literals.push({ start, raw: source.slice(start + 1, end) });
        start = end;
        break;
      }
    }
  }
  return literals;
}

function rawInterpolatedTemplateProse(source) {
  const found = [];
  for (const literal of templateLiterals(source)) {
    // A node's direct text must be between tags. Nested markup is separately
    // represented by its own match, which keeps attribute/CSS prose out.
    for (const match of literal.raw.matchAll(/>([^<>]*\$\{[\s\S]*?\}[^<>]*)</g)) {
      const prose = match[1].replace(/\$\{[\s\S]*?\}/g, ' ').replace(/&(?:nbsp|amp|lt|gt);/g, ' ').replace(/\s+/g, ' ').trim();
      // The lightweight parser intentionally scans only direct text nodes. A
      // quote/equality/operator means this match crossed an attribute, style,
      // or nested expression boundary rather than representing rendered copy.
      if (/["=;`(){}]/.test(prose)) continue;
      // Value-only text such as "$12", "×3", "20%", or an icon is not UI
      // copy. Require a sentence-like amount of natural-language text.
      const words = prose.match(/[A-Za-zÀ-ÿ]{2,}/g) || [];
      if (words.length < 2) continue;
      found.push({ offset: literal.start + match.index, prose });
    }
    // `=>`, `<`, and `>` inside an interpolation used to fool the simple
    // text-node matcher above: it mistook the operator for HTML. Catch a
    // visible phrase that follows such an expression without treating CSS or
    // data attributes as user copy.
    for (const match of literal.raw.matchAll(/\$\{([^{}]*(?:=>|[<>]=?)[^{}]*)\}([^<\n]*)/g)) {
      const prose = match[2].replace(/\$\{[\s\S]*?\}/g, ' ').replace(/\s+/g, ' ').trim();
      if (/^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+)+$/.test(prose)) found.push({ offset: literal.start + match.index, prose });
    }
    // A count followed by a compact status is still user-visible prose. It is
    // intentionally narrower than the sentence rule to avoid numeric values.
    for (const match of literal.raw.matchAll(/\$\{[^{}]+\}\s*((?:active|matched|found|selected))\b/gi)) {
      found.push({ offset: literal.start + match.index, prose: match[1] });
    }
  }
  return found.filter((hit, i) => found.findIndex((other) => other.offset === hit.offset && other.prose === hit.prose) === i);
}

const nestedConditionalInterpolatedProse = (source) => /\$\{[\s\S]*?\?\s*`[\s\S]*?[A-Za-z]{2}[\s\S]*?`\s*:\s*['"][\s\S]*?[A-Za-z]{2}/.test(source);
const countNounInterpolatedProse = (source) => /\$\{[^{}]+\}\s+of\s+\$\{[^{}]+\}\s+[A-Za-z]{2,}/.test(source);
const confirmSheetRawCopy = (source) => /\bconfirmSheet\s*\(\s*\{[\s\S]{0,400}?(?:title|message|confirmLabel)\s*:\s*(?:`|['"][A-Za-z])/.test(source);
const shortDynamicUiProse = (source) => [...source.matchAll(/\$\{[^{}]+\}\s+(?:sets? found|parts?|confidence|match)\b/gi)];
const emptyConditionalUiProse = (source) => [...source.matchAll(/\$\{[^{}]+\?\s*`Nothing matches|:\s*"No (?:sets|minifigs) match/gi)];
const compactMinifigMetadataProse = (source) => [...source.matchAll(/\bminifig\$\{[^}]*fig\.(?:series|rarity)/g)];

// Focused parser regressions: these guard the reviewed sites and make the
// detector's semantic boundary explicit without relying on file-specific
// production regexes.
const parserRegressions = [
  ['<p>Starting with: ${sample}. Existing sets are kept.</p>', true],
  ['<span>${count} sets found</span>', true],
  ['<span>It’s worth ${value} today</span>', true],
  ['<span>${items.filter(x => x.ok).length} of ${items.length} matched</span>', true],
  ['<span>${count} active</span>', true],
  ['<span>${fmtMoney(value)}</span>', false],
  ['<span>${t(\'market.askingSummary\', { count })}</span>', false],
  ['<span class="badge">${escapeHtml(provider)}</span>', false],
];
for (const [snippet, expected] of parserRegressions) {
  const actual = rawInterpolatedTemplateProse(`const html = \`${snippet}\`;`).length > 0;
  if (actual !== expected) throw new Error(`dynamic-sink parser regression failed for ${snippet}`);
}
const specializedParserRegressions = [
  ['<p>${query ? `Nothing matches "${query}".` : "No matches."} Try again.</p>', nestedConditionalInterpolatedProse, true],
  ['<strong>${retired} of ${total} sets</strong>', countNounInterpolatedProse, true],
  ['confirmSheet({ title: "Already owned", message: `You already have ${names}.`, confirmLabel: "Add anyway" })', confirmSheetRawCopy, true],
  ["confirmSheet({ title: t('scanner.duplicateConfirmTitle'), message: t('scanner.duplicateConfirmMessage', { names }), confirmLabel: t('scanner.duplicateConfirmAction') })", confirmSheetRawCopy, false],
];
for (const [snippet, detector, expected] of specializedParserRegressions) {
  if (detector(snippet) !== expected) throw new Error(`dynamic-sink specialized parser regression failed for ${snippet}`);
}
const sinkRegressions = [
  ['celebrate(`It’s been ${years} years`) ', true],
  ["celebrate(tPlural('portfolio.anniversaryCelebration', years))", false],
];
for (const [snippet, expected] of sinkRegressions) {
  const actual = /\bcelebrate\s*\(\s*`/.test(snippet);
  if (actual !== expected) throw new Error(`dynamic-sink celebrate regression failed for ${snippet}`);
}

// Sharing and canvas cards are easy to miss: their text does not enter the
// page DOM, yet it is shown by the operating system or baked into an image.
// Reject authored prose at the direct sinks rather than relying on a reviewer
// to notice it in a share sheet or exported Wrapped card.
function rawDirectShareProse(source) {
  const pattern = /\b(?:shareContent|navigator\.share|Share\.share)\s*\(\s*\{[\s\S]{0,700}?\b(?:title|text|dialogTitle)\s*:\s*(?:`(?=[^`]*[A-Za-z])|['"](?=[^'"\n]*[A-Za-z]))/g;
  return [...source.matchAll(pattern)];
}
function rawCanvasLabelProse(source) {
  return [...source.matchAll(/\.(?:fillText|strokeText)\s*\(\s*(?:`(?=[^`]*[A-Za-z])|['"](?=[^'"\n]*[A-Za-z]))/g)];
}
const directSinkRegressions = [
  ["shareContent({ title: 'Share my collection', text: 'See my sets' })", rawDirectShareProse, true],
  ["shareContent({ title: t('share.portfolioTitle'), text: t('share.portfolioText') })", rawDirectShareProse, false],
  ["navigator.share({ files: [file], title: `Brick Wrapped ${year}` })", rawDirectShareProse, true],
  ["navigator.share({ files: [file], title: t('share.wrappedTitle', { year }) })", rawDirectShareProse, false],
  ["Share.share({ title: 'BricksVault export', files: [uri] })", rawDirectShareProse, true],
  ["x.fillText('Best performer', 80, 48)", rawCanvasLabelProse, true],
  ["x.fillText(t('share.wrappedBestCanvas'), 80, 48)", rawCanvasLabelProse, false],
];
for (const [snippet, detector, expected] of directSinkRegressions) {
  const actual = detector(snippet).length > 0;
  if (actual !== expected) throw new Error(`direct share/canvas sink regression failed for ${snippet}`);
}

const productionRegressions = [
  ['public/js/views/game.js', /t\(out\.correct \? 'game\.revealCorrect' : 'game\.revealIncorrect'/, /it['’]s\s*\$\{fmtMoney\(out\.actual\)\}/],
  ['public/js/components/scanner.js', /tPlural\('scanner\.bulkMatched', results\.filter\(r => r\.success\)\.length, \{ total: results\.length \}\)/, /results\.filter\(r => r\.success\)\.length\}\s+of\s+\$\{results\.length\}\s+matched/],
  ['public/js/views/me-data.js', /tPlural\('data\.migrationStillFailing', migrated\.errors\.length, \{ error: migrated\.errors\[0\] \}\)[\s\S]*?tPlural\('data\.setsImported', r\.imported\)/, /t\('data\.migrationStillFailing'|t\('data\.setsImported'/],
  ['public/js/views/portfolio-detail.js', /tPlural\('detail\.sellReasonSellsFast', vars\.salesVolume, \{ volume: vars\.salesVolume \}\)/, /t\('detail\.sellReasonSellsFast'/],
  ['public/js/views/catalog.js', /tPlural\('catalog\.activeFilters', activeCount\)/, /\$\{activeCount\}\s+active/],
  ['public/js/views/portfolio.js', /celebrate\(tPlural\('portfolio\.anniversaryCelebration', years, \{ set: it\.name \|\| it\.set_num \}\)/, /celebrate\(`\$\{years\}\s+year/],
  ['public/js/views/catalog.js', /t\('catalog\.emptySearchResults', \{ query: f\.catalogQ \}\)/, /Nothing matches\s+"\$\{escapeHtml\(f\.catalogQ\)\}/],
  ['public/js/components/advisor.js', /tPlural\('advisor\.retiredSetsOfTotal', totalSets, \{ retired: retiredCount, total: totalSets \}\)/, /\$\{retiredCount\}\s+of\s+\$\{totalSets\}\s+sets/],
  ['public/js/components/scanner.js', /title: t\('scanner\.duplicateConfirmTitle'\),\s+message: t\('scanner\.duplicateConfirmMessage', \{ names \}\),\s+confirmLabel: t\('scanner\.duplicateConfirmAction'\)/, /title:\s*`Already owned`|message:\s*`You already have|confirmLabel:\s*'Add anyway'/],
  ['public/js/components/scanner.js', /scanResultHeading\(sets\.length, minifigs\.length\)[\s\S]*?tPlural\('scanner\.setsFound', heading\.count\)[\s\S]*?tPlural\('scanner\.minifigsFound', heading\.count\)[\s\S]*?tPlural\('scanner\.mixedResultsFound', heading\.count\)/, /0 sets found|sets\.length\} SETS FOUND/],
  ['public/js/views/minifigs.js', /tPlural\('minifigs\.inSets', n\)/, /`In \$\{n\} sets`|capRarity\(rarity\)|part\$\{f\.num_parts > 1/],
  ['public/js/views/me-admin.js', /adminJobStartFeedback\(type, r, t, adminToolLabel\(type\)\)/, /admin\.jobStarted', \{ id: activeAdminRunId \|\| '' \}/],
  ['public/js/components/scanner.js', /t\("scanner\.minifigWithSeries", \{ minifig: minifigLabel, series: String\(fig\.series\) \}\)/, /\bminifig\$\{fig\.(?:series|rarity)/],
  ['public/js/components/scanner.js', /t\("scanner\.minifigWithRarity", \{[\s\S]*?rarity: t\(rarityKeys\[String\(fig\.rarity\)\.toLowerCase\(\)\] \|\| "scanner\.rarityUnknown"\)/, /\bminifig\$\{fig\.(?:series|rarity)/],
  ['public/js/components/scanner.js', /const badge = kidsBadge \? kidsBadgeLabel\(kidsBadge\) : '';[\s\S]*?kidsXpMessage\(kidsXp, \{ level: kidsLevel, badge \}\)/, /kidsXpMessage\(kidsXp, \{ level: kidsLevel, badge: kidsBadgeLabel\(kidsBadge\) \}\)/],
  ['public/js/views/catalog.js', /const badge = new_badges\?\.\[0\] \? kidsBadgeLabel\(new_badges\[0\]\) : '';[\s\S]*?kidsXpMessage\(xp_gained, \{ level: new_level, badge \}\)/, /kidsXpMessage\(xp_gained, \{ level: new_level, badge: kidsBadgeLabel\(new_badges\?\.\[0\]\) \}\)/],
  ['public/js/views/portfolio-detail.js', /const badge = new_badges\?\.\[0\];[\s\S]*?const xpToast = badge[\s\S]*?kidsXpMessage\(xp_gained, \{ level: new_level, badge: kidsBadgeLabel\(badge\) \}\)[\s\S]*?kidsXpMessage\(xp_gained, \{ level: new_level \}\)/, /kidsXpMessage\(xp_gained, \{ level: new_level, badge: kidsBadgeLabel\(new_badges\?\.\[0\]\) \}\)/],
  ['public/js/views/me-data.js', /tPlural\('data\.importedCount', r\.imported\)[\s\S]*?t\('data\.importResult', importSummary\)[\s\S]*?tPlural\('data\.setsAddedCount', res\.added\)[\s\S]*?tPlural\('data\.skippedCount', res\.skipped\)[\s\S]*?t\('data\.bricklinkImportResult', bricklinkSummary\)/, /t\('data\.importResult', \{ imported: r\.imported/],
  ['public/js/views/me-admin.js', /tPlural\('admin\.minifigsImported', Number\(r\.inserted \?\? 0\)\)[\s\S]*?tPlural\('admin\.minifigsParsed', Number\(r\.parsed \?\? 0\)\)[\s\S]*?t\('admin\.importedMinifigs', minifigImportSummary\)/, /t\('admin\.importedMinifigs', \{/],
  ['public/js/views/game.js', /shareContent\(\{ title: t\('share\.gameTitle'\), text: t\('share\.gameText'/, /shareContent\(\{[^}]*title:\s*['"`]/],
  ['public/js/views/portfolio.js', /shareContent\(\{[\s\S]*?title: t\('share\.portfolioTitle'\)[\s\S]*?text: t\('share\.portfolioText'\)[\s\S]*?dialogTitle: t\('share\.portfolioDialogTitle'\)/, /shareContent\(\{[^}]*text:\s*['"`]/],
  ['public/js/views/portfolio-detail.js', /shareContent\(\{[\s\S]*?text: t\('share\.setText'[\s\S]*?dialogTitle: t\('share\.setDialogTitle'/, /shareContent\(\{[^}]*text:\s*['"`]/],
  ['public/js/views/me.js', /navigator\.share\(\{ files: \[file\], title: t\('share\.wrappedTitle'/, /navigator\.share\(\{ files: \[file\], title:\s*['"`]/],
  ['public/js/views/me.js', /shareContent\(\{ title: t\('share\.wrappedTitle', \{ year: w\.year \}\), text: lines\.join\("\\n"\) \}\)/, /shareContent\(\{ title:\s*['"`]/],
  ['public/js/views/me.js', /fillText\(t\('share\.wrappedTagline'\)/, /fillText\(\s*['"`]/],
  ['public/js/views/me-data.js', /exportBlob\(blob, "bricksvault-insurance-report\.html", \{ title: t\('data\.insuranceReportTitle'\) \}\)[\s\S]*?exportBlob\(blob, "brickvault-collection\.csv", \{ title: t\('data\.collectionExportTitle'\) \}\)/, /title:\s*["'](?:BricksVault insurance report|Share BricksVault collection)/],
];
const bad = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const [guardedFile, required, forbidden] of productionRegressions) {
    if (file !== guardedFile) continue;
    if (!required.test(source) || forbidden.test(source)) bad.push(`${file}: reviewed dynamic UI regression must remain localized`);
  }
  for (const hit of rawInterpolatedTemplateProse(source)) {
    const line = source.slice(0, hit.offset).split('\n').length;
    bad.push(`${file}:${line}: raw interpolated template prose: ${hit.prose.slice(0, 120)}`);
  }
  for (const match of shortDynamicUiProse(source)) {
    const line = source.slice(0, match.index).split('\n').length;
    bad.push(`${file}:${line}: raw dynamic short-label prose: ${match[0]}`);
  }
  for (const match of compactMinifigMetadataProse(source)) {
    const line = source.slice(0, match.index).split('\n').length;
    bad.push(`${file}:${line}: raw compact minifig metadata: ${match[0]}`);
  }
  for (const match of emptyConditionalUiProse(source)) {
    const line = source.slice(0, match.index).split('\n').length;
    bad.push(`${file}:${line}: raw conditional empty-state prose: ${match[0]}`);
  }
  for (const match of rawDirectShareProse(source)) {
    const line = source.slice(0, match.index).split('\n').length;
    bad.push(`${file}:${line}: raw prose passed to a direct share sink`);
  }
  for (const match of rawCanvasLabelProse(source)) {
    const line = source.slice(0, match.index).split('\n').length;
    bad.push(`${file}:${line}: raw prose drawn into a canvas label`);
  }
  const sinks = /(?:\b(?:toast|celebrate)\s*\(\s*(?:`|['"][^'"\n]*['"]\s*\+)|\bshowScanResult\s*\(\s*\{[\s\S]{0,400}?reasoning\s*:\s*(?:`|['"][^'"\n]*['"]\s*\+)|\.(?:textContent|innerText|title)\s*=\s*(?:`|['"][^'"\n]*['"]\s*\+)|\.setAttribute\(\s*['"](?:title|aria-label)['"]\s*,\s*(?:`|['"][^'"\n]*['"]\s*\+))/g;
  for (const match of source.matchAll(sinks)) {
    const snippet = match[0];
    const context = source.slice(Math.max(0, match.index - 180), match.index + snippet.length + 80);
    if (safeValueOnly.some((pattern) => pattern.test(context))) continue;
    const line = source.slice(0, match.index).split('\n').length;
    bad.push(`${file}:${line}: ${snippet.replace(/\s+/g, ' ').slice(0, 180)}`);
  }
}
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const { key, offset } of literalTCalls(source)) {
    if (COUNT_NEUTRAL_T_KEYS.has(key)) continue;
    const line = source.slice(0, offset).split('\n').length;
    bad.push(`${file}:${line}: count-bearing t('${key}', …) must use tPlural() or a documented count-neutral exception`);
  }
}
if (bad.length) {
  console.error('Uncatalogued dynamic UI sink(s):\n' + bad.join('\n'));
  process.exit(1);
}

// These are newly parameterized, user-facing messages.  Identical English is
// almost always an accidental fallback; XP is intentionally product jargon.
const messageKeys = [
  'common.offlineActionsSyncedOne', 'common.offlineActionsSyncedOther', 'common.offlineActionsDiscardedOne', 'common.offlineActionsDiscardedOther', 'common.localItemsSyncedOne', 'common.localItemsSyncedOther', 'common.kidsXp', 'common.kidsXpLevel', 'common.kidsXpBadge', 'common.copied',
  'admin.serviceTestResult', 'admin.providerStatus', 'admin.serviceTestFailed', 'admin.providerTestFailed', 'admin.featureFlagStatus', 'admin.featureFlagUpdateFailed', 'admin.providerSaved', 'admin.providerSaveFailed', 'admin.pricingConfigLoadFailed', 'admin.resetFailed', 'admin.contributionAction', 'admin.enabled', 'admin.disabled', 'admin.approved', 'admin.rejected',
  'minifigs.ownedCount', 'data.restoredFromBackup', 'data.migrationStillFailing', 'data.migrationComplete', 'data.importResult', 'data.setsImported', 'data.bricklinkImportResult', 'data.bricklinkSetsImported', 'integrations.keyRemoved', 'integrations.keyVerified',
  'scanner.setNotFound', 'scanner.localAiOfflineFailed', 'scanner.addItemFailed', 'scanner.minifig', 'scanner.minifigWithSeries', 'scanner.minifigWithRarity', 'scanner.rarityUnknown', 'scanner.itemsAddedOne', 'scanner.itemsAddedOther', 'scanner.itemsSavedOfflineOne', 'scanner.itemsSavedOfflineOther', 'scanner.setsSavedOfflineOne', 'scanner.setsSavedOfflineOther', 'portfolio.soldFor', 'portfolio.wishlistAlertsTooltip', 'portfolio.bulkLocationPartial',
  'kids.badgeCelebration', 'kids.badgeQuip', 'kids.levelCelebration', 'kids.levelQuip', 'kids.badgeFirstBrick', 'kids.badgeJuniorBuilder', 'kids.badgeArchitect', 'kids.badgeMaster', 'kids.badgeGrandMaster', 'kids.badgeLegend',
  'game.marketGenius', 'game.streakQuipOne', 'game.streakQuipOther', 'scanner.setNumberMatched',
  'data.csvImportConfirmTitleOne', 'data.csvImportConfirmTitleOther', 'data.csvImportMore', 'data.csvImportConfirmMessage', 'data.importConfirm',
  'data.migrationStillFailingOne', 'data.migrationStillFailingOther', 'data.migrationCompleteOne', 'data.migrationCompleteOther', 'data.setsImportedOne', 'data.setsImportedOther', 'data.bricklinkSetsImportedOne', 'data.bricklinkSetsImportedOther',
  'portfolio.insightHeadlineOne', 'portfolio.insightHeadlineOther', 'market.goodTimeToSell', 'market.goodTimeToBuy', 'market.onlyForSale', 'market.askingHighHint', 'market.askingLowHint', 'market.askingSummary', 'market.askingSummaryWithSold',
  'catalog.loadFailedDetail', 'market.partsCoverage', 'market.forecastScenarios', 'market.salesSuffix', 'market.newSold', 'market.usedSold', 'market.viewOnBrickLink', 'portfolio.moreThemesOne', 'portfolio.moreThemesOther', 'portfolio.sealedParts', 'advisor.moreThemesOne', 'advisor.moreThemesOther',
  'market.sellingAbove', 'market.sellingBelow', 'scanner.findingSet', 'scanner.lookingUpSet',
  'game.revealCorrect', 'game.revealIncorrect', 'scanner.bulkMatched', 'catalog.activeFiltersOne', 'catalog.activeFiltersOther',
  'portfolio.anniversaryGain', 'portfolio.anniversaryNoGain', 'portfolio.anniversaryQuip', 'portfolio.anniversaryCelebrationOne', 'portfolio.anniversaryCelebrationOther',
  'game.loadFailed', 'contributions.loadFailed', 'me.wrappedLoadFailed', 'me.wrappedValueChange', 'me.wrappedUp', 'me.wrappedDown',
  'catalog.filterSummaryNone', 'catalog.filterSummaryActiveOne', 'catalog.filterSummaryActiveOther', 'catalog.filterSummarySearch', 'catalog.filterSummaryStatusRetired', 'catalog.filterSummaryStatusActive', 'catalog.filterSummaryStatusRetiring', 'catalog.filterSummaryDeal', 'catalog.filterSummaryRangeYear', 'catalog.filterSummaryRangePieces', 'catalog.filterSummaryRangeValue', 'catalog.filterSummaryRangeBetween', 'catalog.filterSummaryRangeMin', 'catalog.filterSummaryRangeMax', 'catalog.filterSummaryPiecesValue', 'catalog.filterSummaryValueAmount',
  'minifigs.filterSummaryNone', 'minifigs.filterSummaryActiveOne', 'minifigs.filterSummaryActiveOther', 'minifigs.filterSummarySearch', 'minifigs.filterSummaryRarity', 'minifigs.filterSummaryRarityCommon', 'minifigs.filterSummaryRarityUncommon', 'minifigs.filterSummaryRarityRare', 'minifigs.filterSummaryRarityLegendary', 'minifigs.filterSummaryOwned', 'minifigs.filterSummaryUnowned',
  'catalog.emptySearchResults', 'catalog.emptyFilteredResults', 'advisor.retiredSetsOfTotalOne', 'advisor.retiredSetsOfTotalOther', 'scanner.duplicateConfirmTitle', 'scanner.duplicateConfirmMessage', 'scanner.duplicateConfirmAction',
  'admin.jobAccepted', 'admin.pricechartingBulkAccepted', 'admin.pricechartingVerifyAccepted',
  'scanner.setsFoundOne', 'scanner.setsFoundOther', 'scanner.minifigsFoundOne', 'scanner.minifigsFoundOther', 'scanner.mixedResultsFoundOne', 'scanner.mixedResultsFoundOther', 'scanner.confidenceHigh', 'scanner.confidenceMedium', 'scanner.confidenceLow', 'scanner.confidenceUnknown', 'scanner.matchHigh', 'scanner.matchMedium', 'scanner.matchLow', 'scanner.match',
  'detail.sellReasonGainSincePurchase', 'detail.sellReasonTrendDown', 'detail.sellReasonClimbFlattened', 'detail.sellReasonLittleUpside', 'detail.sellReasonSellsFastOne', 'detail.sellReasonSellsFastOther', 'detail.sellReasonWatchClosely', 'detail.sellReasonStillClimbing', 'detail.sellReasonForecastUpside', 'detail.sellReasonNotRetired', 'detail.sellReasonNoSellTrigger',
  'minifigs.setExclusive', 'minifigs.inSetsOne', 'minifigs.inSetsOther', 'minifigs.partsOne', 'minifigs.partsOther', 'minifigs.emptySearchResults', 'minifigs.emptyFilteredResults',
  'share.gameTitle', 'share.gameText', 'share.setText', 'share.setDialogTitle', 'share.portfolioTitle', 'share.portfolioText', 'share.portfolioDialogTitle', 'share.wrappedTitle', 'share.wrappedBest', 'share.wrappedTracked', 'share.wrappedValueChange', 'share.wrappedTagline', 'share.wrappedHeading', 'share.wrappedDescription', 'share.wrappedLoading', 'share.wrappedSummaryTitle', 'share.wrappedSetsAddedOne', 'share.wrappedSetsAddedOther', 'share.wrappedPiecesAddedOne', 'share.wrappedPiecesAddedOther', 'share.wrappedMinifigsOne', 'share.wrappedMinifigsOther', 'share.wrappedInvested', 'share.wrappedSoldOne', 'share.wrappedSoldOther', 'share.wrappedSoldLabel', 'share.wrappedBestLabel', 'share.wrappedBestCanvas', 'share.wrappedBestCanvasWithRoi', 'share.wrappedLongestHeld', 'share.wrappedClose', 'share.wrappedShareYear',
  'data.reportPreparing', 'data.insuranceReportTitle', 'data.reportSharedReady', 'data.reportDownloadedReady', 'data.noSnapshotsYet', 'data.backupsUnavailable', 'data.retryingSync', 'data.guestVaultSynced', 'data.exportPreparing', 'data.collectionExportTitle', 'data.guestExportShared', 'data.guestExportDownloaded', 'data.syncedExportShared', 'data.syncedExportDownloaded',
];
const exactInvariant = new Set([
  // XP and these placeholder-only status layouts are language-neutral; their
  // populated values are localized by the surrounding catalogue entries.
  'common.kidsXp', 'admin.serviceTestResult', 'admin.providerStatus',
  'admin.featureFlagStatus', 'admin.contributionAction',
  // Mathematical range layouts are language-neutral once the adjacent label
  // is localized; several locales correctly share this exact notation.
  'catalog.filterSummaryRangeBetween', 'catalog.filterSummaryRangeMin', 'catalog.filterSummaryRangeMax',
  // “Rare” is the native French LEGO rarity label as well.
  'minifigs.filterSummaryRarityRare',
]);
const english = (await import('../public/js/locales/en.js')).default;
const read = (obj, key) => key.split('.').reduce((value, part) => value?.[part], obj);
for (const code of ['de', 'es', 'fr', 'hi', 'ja', 'nl', 'uk', 'zh']) {
  const locale = (await import(`../public/js/locales/${code}.js`)).default;
  for (const key of messageKeys) {
    const localized = read(locale, key);
    const source = read(english, key);
    if (!localized || !source) throw new Error(`Missing required localized message ${code}.${key}`);
    if (!exactInvariant.has(key) && localized === source) throw new Error(`English fallback in ${code}.${key}`);
    const placeholders = (value) => [...String(value).matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort().join(',');
    if (placeholders(localized) !== placeholders(source)) throw new Error(`Placeholder mismatch in ${code}.${key}`);
  }
}

// Ukrainian needs every plural category at every live tPlural family.  This is
// intentionally source-derived (including conditional family choices) so a new
// call cannot accidentally rely on the English one/other fallback.
function pluralFamiliesIn(source) {
  const families = new Set();
  for (const match of source.matchAll(/\btPlural\s*\(/g)) {
    let depth = 1, quote = '', escaped = false, end = match.index + match[0].length;
    for (; end < source.length && depth; end++) {
      const ch = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth) throw new Error(`Unclosed tPlural call near ${match.index}`);
    const firstArg = source.slice(match.index + match[0].length, end - 1)
      .match(/^\s*['"]([a-z]+(?:\.[A-Za-z0-9]+)+)['"]/);
    if (firstArg) families.add(firstArg[1]);
  }
  return families;
}
const pluralFamilies = new Set(files.flatMap((file) => [...pluralFamiliesIn(readFileSync(file, 'utf8'))]));
const uk = (await import('../public/js/locales/uk.js')).default;
const ukCategories = new Intl.PluralRules('uk').resolvedOptions().pluralCategories;
for (const family of pluralFamilies) {
  for (const category of ukCategories) {
    const key = `${family}${category[0].toUpperCase()}${category.slice(1)}`;
    if (!read(uk, key)) throw new Error(`Missing Ukrainian plural form ${key}`);
  }
}
