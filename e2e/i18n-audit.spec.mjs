import { test, expect, SET } from './fixtures.mjs';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AUDIT_DIR = tmpdir();

// Measure REAL runtime translation coverage: of the English text actually on
// screen, how much did the exact-match dictionary replace?
//
// Counting dictionary entries proves nothing — a key that never matches a
// rendered node is dead weight that still inflates the count. This walks the
// live DOM of every route and asks the only question that matters: is this
// text node English, and did we replace it?
//
// Ukrainian is the probe language because it is non-Latin: anything still in
// Latin script is, with very few exceptions, untranslated. The same audit in
// German or Dutch could not tell a translation from a miss.
// Phone viewport, because Brickvault is a mobile-first PWA and that is what
// users actually see. It is not cosmetic: several controls exist only at one
// width — the vault overflow menu is display:none above 520px, so a desktop
// run silently skipped that sheet entirely, while the alerts and wishlist
// buttons are display:none BELOW 520px because they fold into that same menu.
test.use({ locale: 'uk-UA', viewport: { width: 390, height: 844 } });

// Rows behind a flag render as nothing, and nothing reads as fully translated —
// the admin and share-profile rows on /me were invisible to the first audit for
// exactly that reason. Overridden HERE rather than in fixtures.mjs, because the
// shared fixture is also what proves a NON-admin gets redirected away from the
// admin console, and flipping it globally breaks that test.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      display_name: 'Test Collector', handle: 'tester', currency: 'USD',
      is_guest: false, is_admin: true, is_public: true,
      notify_price_drops: true, portfolio_stats: {},
    }),
  }));
  // The admin route fans out to several dashboard feeds. Stable empty responses
  // let the page render without accidentally auditing transport-error prose.
  await page.route('**/api/admin/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ runs: [], processes: [], services: [], flags: [], overrides: {}, effective: {}, defaults: {}, config: {}, items: [], users: [], supporters: [] }),
  }));
  // The manage tab is ownership-gated. Supply a real collection entry so the
  // route below audits its rendered controls instead of merely loading detail.
  await page.route('**/api/sets/75192-1', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ set: SET, entry: { id: 1, set_num: '75192-1', quantity: 1, purchase_price: 700, condition: 'new' } }),
  }));
});

// EVERY route the router dispatches (see public/js/router.js), not the six the
// first version of this audit sampled. The set-detail tabs are separate entries
// because each renders a different view module.
const ROUTES = [
  '/', '/add', '/pile', '/minifigs', '/build', '/wishlist', '/game', '/leaderboard', '/login',
  '/me', '/me/integrations', '/me/data', '/me/contributions',
  '/me/admin', '/u/tester',
  '/set/75192-1', '/set/75192-1/forecast', '/set/75192-1/community',
  '/set/75192-1/manage',
  '/kids', '/kids/badges',
];

// These are fixture values, product/provider names, required legal wording, or
// credential/URL tokens. Keeping this exact and short turns the audit into a
// regression gate: any new English UI copy has to be translated or consciously
// justified here.
const TEXT_ALLOWLIST = new Set([
  'Millennium Falcon', 'Star Wars', 'Star Wars · #75192-1 ·', 'Ultimate Collector Series',
  'Test Collector', '@tester', 'https://brickvault-5ub.pages.dev/#/u/tester',
  'Pro', 'BricksVault', 'Brick Wrapped', 'Rebrickable', 'Supabase', 'Google AI Studio',
  'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.', 'aistudio.google.com/apikey',
  '. Pricing from BrickLink, eBay, PriceCharting & Brickset. LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this app.',
]);
const ATTRIBUTE_ALLOWLIST = new Set([
  'placeholder: AIza...',
  'placeholder: https://discord.com/api/webhooks/…',
]);

// Sheets, drawers and menus are injected outside the router, so a route walk
// never renders them — they were a blind spot in the first audit, and they hold
// some of the wordiest copy in the app (the wishlist target explainer, the
// advisor drawer, the sort/filter menus).
const OVERLAYS = [
  // `wide` = only reachable above the 520px breakpoint, where it is not folded
  // into the vault overflow menu.
  { name: 'alerts sheet', route: '/', open: '#alertsBtn', wide: true },
  { name: 'wishlist sheet', route: '/set/75192-1', open: '#wishToggle' },
  { name: 'advisor drawer', route: '/', open: '#advisorFab', wide: true },
  { name: 'catalog filters', route: '/add', open: '#filterChip' },
  { name: 'minifig filters', route: '/minifigs', open: '#figFilterChip' },
  // The two richest sheets in the app, and both were missing from the first
  // overlay pass — which is most of why it reported 95.5% while the real app
  // still showed English on these exact screens.
  { name: 'pricing details', route: '/set/75192-1', open: '#pricingDetailsBtn' },
  { name: 'vault actions', route: '/', open: '#vaultMoreBtn' },
];

// Shared DOM sweep: which visible text is English, and did the dictionary
// replace it? Returned counts feed both the route pass and the overlay pass.
const SWEEP = async () => {
  const dictMod = await import('/js/locales/ui-uk.js');
  // Exact-match dictionaries legitimately leave only narrowly approved brand or
  // protocol tokens unchanged. A self-mapped English sentence is otherwise not a
  // translation and must stay visible to this runtime audit. This is deliberately
  // local because Playwright serializes SWEEP into the page context.
  const intentionalLanguageInvariants = new Set([
    'Gemini Nano', // Product/model name; it is intentionally identical in Ukrainian.
  ]);
  const translated = new Set(Object.entries(dictMod.ui)
    .filter(([english, localized]) => localized !== english || intentionalLanguageInvariants.has(english))
    .map(([, localized]) => localized));
  const out = { hit: 0, miss: 0, missed: [], attrHit: 0, attrMiss: 0, missedAttrs: [] };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = n.parentElement;
      if (!p || ['SCRIPT', 'STYLE'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (!p.offsetParent && p.tagName !== 'BODY') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (t.length < 3) continue;
    if (translated.has(t)) { out.hit++; continue; }
    if (/[Ѐ-ӿ]/.test(t)) { out.hit++; continue; }
    // Single words COUNT. Requiring a space here is what let "Appearance",
    // "Style", "Forecast", "Basis", "Sales" and the whole single-word UI
    // vocabulary pass as translated — the same blind spot the harvester had.
    if (/[A-Za-z]{3}/.test(t) && !/^[\d\s.,$%+-]+$/.test(t)) {
      out.miss++; out.missed.push(t.slice(0, 400));
    }
  }
  for (const el of document.querySelectorAll('[placeholder], [aria-label], [title]')) {
    if (el.closest('[data-no-i18n]') || (!el.offsetParent && el.tagName !== 'BODY')) continue;
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const value = el.getAttribute(attr)?.replace(/\s+/g, ' ').trim();
      if (!value || value.length < 3) continue;
      if (translated.has(value) || /[Ѐ-ӿ]/.test(value)) { out.attrHit++; continue; }
      if (/[A-Za-z]{3}/.test(value) && !/^[\d\s.,$%+-]+$/.test(value)) {
        out.attrMiss++;
        out.missedAttrs.push(`${attr}: ${value.slice(0, 400)}`);
      }
    }
  }
  return out;
};

test('audit overlay coverage', async ({ page }) => {
  const misses = new Map();
  const attrMisses = new Map();
  const rows = [];
  for (const { name, route, open, wide } of OVERLAYS) {
    await page.setViewportSize(wide ? { width: 1280, height: 900 } : { width: 390, height: 844 });
    await page.goto(`/#${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const btn = page.locator(open);
    if (!(await btn.count()) || !(await btn.first().isVisible().catch(() => false))) {
      rows.push({ name, skipped: 'control not present' });
      continue;
    }
    const before = await page.evaluate(SWEEP);
    await btn.first().click();
    await page.waitForTimeout(700);
    const after = await page.evaluate(SWEEP);
    // Only what the overlay ADDED, so the underlying page is not counted twice.
    const added = after.missed.filter((s) => !before.missed.includes(s));
    const addedAttrs = after.missedAttrs.filter((s) => !before.missedAttrs.includes(s));
    rows.push({ name, hit: after.hit - before.hit, miss: added.length, attrMiss: after.attrMiss - before.attrMiss });
    for (const s of added) misses.set(s, (misses.get(s) || 0) + 1);
    for (const s of addedAttrs) attrMisses.set(s, (attrMisses.get(s) || 0) + 1);
  }
  const ranked = [...misses.keys()];
  const rankedAttrs = [...attrMisses.keys()];
  writeFileSync(join(AUDIT_DIR, 'i18n-overlays.json'), JSON.stringify({ rows, missed: ranked, missedAttributes: rankedAttrs }, null, 2));
  console.log(`OVERLAY untranslated strings: ${ranked.length}`);
  for (const r of rows) {
    console.log(r.skipped ? `  ${r.name.padEnd(20)} SKIPPED (${r.skipped})`
      : `  ${r.name.padEnd(20)} ${String(r.hit).padStart(3)} ok  ${String(r.miss).padStart(3)} miss  ${String(r.attrMiss).padStart(3)} attr miss`);
  }
  for (const s of ranked) console.log(`     ${JSON.stringify(s.slice(0, 100))}`);
  for (const s of rankedAttrs) console.log(`     attribute ${JSON.stringify(s.slice(0, 100))}`);
  expect(ranked.filter((text) => !TEXT_ALLOWLIST.has(text)), 'unexpected untranslated overlay text').toEqual([]);
  expect(rankedAttrs.filter((attribute) => !ATTRIBUTE_ALLOWLIST.has(attribute)), 'unexpected untranslated overlay attributes').toEqual([]);
});

test('audit runtime coverage', async ({ page }) => {
  const misses = new Map();      // text -> count
  const where = new Map();       // text -> Set(routes)
  const attrWhere = new Map();   // attribute -> Set(routes)
  const perRoute = [];
  let hit = 0, miss = 0, attrHit = 0, attrMiss = 0;

  for (const r of ROUTES) {
    await page.goto(`/#${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const res = await page.evaluate(SWEEP);
    hit += res.hit; miss += res.miss; attrHit += res.attrHit; attrMiss += res.attrMiss;
    perRoute.push({ route: r, hit: res.hit, miss: res.miss, attrHit: res.attrHit, attrMiss: res.attrMiss });
    for (const s of res.missed) {
      misses.set(s, (misses.get(s) || 0) + 1);
      if (!where.has(s)) where.set(s, new Set());
      where.get(s).add(r);
    }
    for (const s of res.missedAttrs) {
      if (!attrWhere.has(s)) attrWhere.set(s, new Set());
      attrWhere.get(s).add(r);
    }
  }

  const ranked = [...misses.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([text, n]) => ({ text, n, routes: [...where.get(text)] }));
  const rankedAttrs = [...attrWhere.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([attribute, routes]) => ({ attribute, routes: [...routes] }));
  const pct = hit + miss ? ((hit / (hit + miss)) * 100).toFixed(1) : '0.0';
  writeFileSync(join(AUDIT_DIR, 'i18n-audit.json'), JSON.stringify(
    { hit, miss, pct, attrHit, attrMiss, unique: ranked.length, perRoute, missed: ranked, missedAttributes: rankedAttrs }, null, 2));
  console.log(`TRANSLATED ${hit} | UNTRANSLATED ${miss} | ${pct}% | unique misses ${ranked.length}`);
  console.log(`ATTRIBUTES translated ${attrHit} | untranslated ${attrMiss}`);
  expect(ranked.filter(({ text }) => !TEXT_ALLOWLIST.has(text)), 'unexpected untranslated route text').toEqual([]);
  expect(rankedAttrs.filter(({ attribute }) => !ATTRIBUTE_ALLOWLIST.has(attribute)), 'unexpected untranslated route attributes').toEqual([]);
  for (const { attribute, routes } of rankedAttrs) console.log(`     attribute ${JSON.stringify(attribute)} (${routes.join(', ')})`);
  for (const { route, hit: h, miss: m } of perRoute) {
    console.log(`  ${route.padEnd(26)} ${String(h).padStart(4)} ok  ${String(m).padStart(4)} miss`);
  }
});
