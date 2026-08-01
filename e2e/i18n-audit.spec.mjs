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
test.use({ locale: 'uk-UA' });

// EVERY route the router dispatches (see public/js/router.js), not the six the
// first version of this audit sampled. The set-detail tabs are separate entries
// because each renders a different view module.
const ROUTES = [
  '/', '/add', '/pile', '/minifigs', '/build', '/wishlist', '/game', '/leaderboard',
  '/me', '/me/integrations', '/me/data', '/me/contributions',
  '/set/75192-1', '/set/75192-1/forecast', '/set/75192-1/community',
  '/kids', '/kids/badges',
];

test('audit runtime coverage', async ({ page }) => {
  const misses = new Map();      // text -> count
  const where = new Map();       // text -> Set(routes)
  const perRoute = [];
  let hit = 0, miss = 0;

  for (const r of ROUTES) {
    await page.goto(`/#${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const res = await page.evaluate(async () => {
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
        // Cyrillic present = already translated (or a t() result), not a miss.
        if (/[Ѐ-ӿ]/.test(t)) { out.hit++; continue; }
        // Latin letters + a space = probably untranslated English prose.
        if (/[A-Za-z]{3}/.test(t) && /\s/.test(t) && !/^[\d\s.,$%+-]+$/.test(t)) {
          out.miss++; out.missed.push(t.slice(0, 90));
        }
      }
      return out;
    });
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
