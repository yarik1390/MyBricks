import { test } from './fixtures.mjs';
import { writeFileSync } from 'node:fs';

// Measure REAL runtime translation coverage: of the English text actually on
// screen, how much did the exact-match dictionary replace?
test.use({ locale: 'uk-UA' });
test('audit runtime coverage', async ({ page }) => {
  const routes = ['/', '/add', '/minifigs', '/me', '/wishlist', '/set/75192-1'];
  const misses = new Map();
  let hit = 0, miss = 0;

  for (const r of routes) {
    await page.goto(`/#${r}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const res = await page.evaluate(async () => {
      const m = await import('/js/lib/i18n.js');
      const dictMod = await import('/js/locales/ui-uk.js');
      const dict = dictMod.ui;
      const translated = new Set(Object.values(dict));
      const out = { hit: 0, miss: 0, missed: [] };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const p = n.parentElement;
          if (!p || ['SCRIPT','STYLE'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (!p.offsetParent && p.tagName !== 'BODY') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (t.length < 3) continue;
        if (translated.has(t)) { out.hit++; continue; }
        // Latin letters + a space = probably untranslated English prose.
        if (/[A-Za-z]{3}/.test(t) && /\s/.test(t) && !/^[\d\s.,$%+-]+$/.test(t)) {
          out.miss++; out.missed.push(t.slice(0, 90));
        }
      }
      return out;
    });
    hit += res.hit; miss += res.miss;
    for (const s of res.missed) misses.set(s, (misses.get(s) || 0) + 1);
  }
  const ranked = [...misses.entries()].sort((a,b) => b[1]-a[1]);
  writeFileSync('/tmp/i18n-audit.json', JSON.stringify({ hit, miss, unique: ranked.length, top: ranked.slice(0,40) }, null, 2));
  console.log(`TRANSLATED ${hit} | UNTRANSLATED ${miss} | unique misses ${ranked.length}`);
});
