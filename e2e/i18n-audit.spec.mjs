import { test } from './fixtures.mjs';
import { writeFileSync } from 'node:fs';

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
});

// EVERY route the router dispatches (see public/js/router.js), not the six the
// first version of this audit sampled. The set-detail tabs are separate entries
// because each renders a different view module.
const ROUTES = [
  '/', '/add', '/pile', '/minifigs', '/build', '/wishlist', '/game', '/leaderboard',
  '/me', '/me/integrations', '/me/data', '/me/contributions',
  '/set/75192-1', '/set/75192-1/forecast', '/set/75192-1/community',
  '/kids', '/kids/badges',
];

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
  const translated = new Set(Object.values(dictMod.ui));
  const out = { hit: 0, miss: 0, missed: [] };
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
  return out;
};

test('audit overlay coverage', async ({ page }) => {
  const misses = new Map();
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
    rows.push({ name, hit: after.hit - before.hit, miss: added.length });
    for (const s of added) misses.set(s, (misses.get(s) || 0) + 1);
  }
  const ranked = [...misses.keys()];
  writeFileSync('/tmp/i18n-overlays.json', JSON.stringify({ rows, missed: ranked }, null, 2));
  console.log(`OVERLAY untranslated strings: ${ranked.length}`);
  for (const r of rows) {
    console.log(r.skipped ? `  ${r.name.padEnd(20)} SKIPPED (${r.skipped})`
      : `  ${r.name.padEnd(20)} ${String(r.hit).padStart(3)} ok  ${String(r.miss).padStart(3)} miss`);
  }
  for (const s of ranked) console.log(`     ${JSON.stringify(s.slice(0, 100))}`);
});

test('audit runtime coverage', async ({ page }) => {
  const misses = new Map();      // text -> count
  const where = new Map();       // text -> Set(routes)
  const perRoute = [];
  let hit = 0, miss = 0;

  for (const r of ROUTES) {
    await page.goto(`/#${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const res = await page.evaluate(SWEEP);
    hit += res.hit; miss += res.miss;
    perRoute.push({ route: r, hit: res.hit, miss: res.miss });
    for (const s of res.missed) {
      misses.set(s, (misses.get(s) || 0) + 1);
      if (!where.has(s)) where.set(s, new Set());
      where.get(s).add(r);
    }
  }

  const ranked = [...misses.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([text, n]) => ({ text, n, routes: [...where.get(text)] }));
  const pct = hit + miss ? ((hit / (hit + miss)) * 100).toFixed(1) : '0.0';
  writeFileSync('/tmp/i18n-audit.json', JSON.stringify(
    { hit, miss, pct, unique: ranked.length, perRoute, missed: ranked }, null, 2));
  console.log(`TRANSLATED ${hit} | UNTRANSLATED ${miss} | ${pct}% | unique misses ${ranked.length}`);
  for (const { route, hit: h, miss: m } of perRoute) {
    console.log(`  ${route.padEnd(26)} ${String(h).padStart(4)} ok  ${String(m).padStart(4)} miss`);
  }
});
