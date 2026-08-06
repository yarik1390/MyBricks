#!/usr/bin/env node
/** Verify that the checked-in source catalog is a fresh, exact harvest. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const harvested = spawnSync(process.execPath, ['scripts/harvest-ui-strings.mjs'], {
  encoding: 'utf8',
});
if (harvested.status !== 0) {
  process.stderr.write(harvested.stderr || 'UI-string harvest failed.\n');
  process.exit(harvested.status || 1);
}

const expected = readFileSync('scripts/ui-strings.json', 'utf8').trim();
const actual = harvested.stdout.trim();
if (actual !== expected) {
  let expectedCount = '?';
  let actualCount = '?';
  try { expectedCount = JSON.parse(expected).length; actualCount = JSON.parse(actual).length; } catch { /* report mismatch below */ }
  console.error(`scripts/ui-strings.json is stale (checked in: ${expectedCount}, fresh harvest: ${actualCount}).`);
  console.error('Run: node scripts/harvest-ui-strings.mjs --write');
  process.exit(1);
}
const rows = JSON.parse(actual);
const catalog = new Set(rows.map((row) => row.text));
// These are source-shape regressions that previously fell through the generic
// harvester: lowercase rendered labels, ordinary status ellipses, and a literal
// in a nested conditional. Keep the examples tied to real live UI.
const required = [
  'alternate models',
  'Checking compatibility...',
  'Loading pricing methodology...',
  'needs key',
  '✓ Earned!',
  'Submitting…',
  'Uploading…',
  'Working…',
  'Saving…',
  'Testing…',
  'Syncing…',
  'Deleting…',
  '🧒 Kids mode uses its own bright, playful colors — you can switch modes in Settings to choose a different look.',
  '🧱 Add to vault · +10 XP',
  'Unlock Premium & Gold by supporting BricksVault ★',
];
const absent = required.filter((text) => !catalog.has(text));
if (absent.length) {
  console.error(`UI string catalog omitted required live copy: ${absent.map((text) => JSON.stringify(text)).join(', ')}`);
  process.exit(1);
}
const forbidden = [
  'barcode lookup', 'cloud identify round-trip',
  // Examples from source comments, not rendered copy.
  'Resume (NN%)', 'bytes START-END/TOTAL',
  // Adjacent primitive-interpolation fragments cannot match the browser's
  // combined text node. These are now parameterized t() messages instead.
  '⏳ You have', 'approved contribution', 'awaiting approval.', 'last run',
];
const admittedTelemetry = forbidden.filter((text) => catalog.has(text));
if (admittedTelemetry.length) {
  console.error(`UI string catalog included telemetry: ${admittedTelemetry.map((text) => JSON.stringify(text)).join(', ')}`);
  process.exit(1);
}
const sw = readFileSync('public/sw.js', 'utf8');
const offlineLocaleAssets = ['en', 'de', 'es', 'fr', 'hi', 'ja', 'nl', 'uk', 'zh']
  .flatMap((locale) => locale === 'en'
    ? [`/js/locales/${locale}.js`]
    : [`/js/locales/${locale}.js`, `/js/locales/ui-${locale}.js`]);
const missingOfflineLocales = offlineLocaleAssets.filter((asset) => !sw.includes(`'${asset}'`));
if (missingOfflineLocales.length) {
  console.error(`Service worker misses locale dependencies: ${missingOfflineLocales.join(', ')}`);
  process.exit(1);
}
console.log(`UI string catalog is fresh (${rows.length} strings).`);
