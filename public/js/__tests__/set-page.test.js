import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { jsonLd, setPageHtml, setSummary, setValue, notFoundHtml, handleSetPage } from '../../../worker/og/set-page.js';
import { sitemapIndexXml, setsSitemapXml, staticSitemapXml, handleSitemapFile } from '../../../worker/og/sitemap.js';

const titanic = {
  set_num: '10294-1', name: 'Titanic', theme: 'Icons', subtheme: 'Miscellaneous', year: 2021, pieces: 9092, minifigs: 0,
  image_url: 'https://cdn.example/10294.jpg', retail_price: 679.99, retired: false,
  market_value: 571.33, market_value_low: 537.05, market_value_high: 668.14,
};

function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

describe('crawlable set pages', () => {
  it('escapes JSON-LD so a name cannot close the script tag', () => {
    const out = jsonLd({ name: '</script><script>alert(1)</script>' });
    assert.doesNotMatch(out, /<\/script>/i);
    assert.equal(JSON.parse(out).name, '</script><script>alert(1)</script>');
  });

  it('renders facts, value, canonical, CTA and Product data', () => {
    const html = setPageHtml(titanic, [
      { set_num: '10276-1', name: 'Colosseum', year: 2020, market_value: 1094 },
      { set_num: '10294-1', name: 'Titanic' },
    ]);
    assert.match(html, /<link rel="canonical" href="https:\/\/bricksvault\.app\/s\/10294-1">/);
    assert.match(html, /<h1>Titanic<\/h1>/);
    assert.match(html, /\$571/);
    assert.match(html, /9,092/);
    assert.match(html, /href="\/#\/set\/10294-1"/);
    assert.match(html, /href="\/s\/10276-1"/);
    assert.doesNotMatch(html, /href="\/s\/10294-1"/, 'does not link to itself as related');
    assert.doesNotMatch(html, /noindex/);
    const [product, crumbs] = ldBlocks(html);
    assert.equal(product['@type'], 'Product');
    assert.equal(product.sku, '10294-1');
    assert.equal(product.mpn, '10294');
    assert.equal(product.brand.name, 'LEGO');
    assert.equal(product.offers, undefined, 'no offers: BricksVault does not sell sets');
    assert.equal(crumbs['@type'], 'BreadcrumbList');
  });

  it('escapes set names in HTML', () => {
    const html = setPageHtml({ ...titanic, name: 'Cafe <Corner> & "Co"' });
    assert.match(html, /<h1>Cafe &lt;Corner&gt; &amp; &quot;Co&quot;<\/h1>/);
  });

  it('writes a summary from our own numbers only', () => {
    assert.match(setSummary(titanic), /^Titanic \(10294-1\) is a LEGO Icons set from 2021 with 9,092 pieces\./);
    assert.match(setSummary(titanic), /about \$571 \(typical range \$537–\$668\)/);
    assert.equal(setValue({ market_value: 0, current_value: null }), null);
  });

  it('marks the missing-set page noindex', () => {
    assert.match(notFoundHtml('x'), /<meta name="robots" content="noindex">/);
  });

  it('serves the same page to people and bots, 404 for unknown sets', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/search')) return new Response(JSON.stringify({ sets: [] }), { status: 200 });
      if (u.includes('99999-1')) return new Response('{"error":"not found"}', { status: 404 });
      return new Response(JSON.stringify({ set: titanic }), { status: 200 });
    };
    try {
      const ctx = (id, ua) => ({ request: new Request(`https://bricksvault.app/s/${id}`, { headers: { 'user-agent': ua } }), params: { id }, env: {} });
      const person = await handleSetPage(ctx('10294-1', 'Mozilla/5.0 Chrome/130'));
      const bot = await handleSetPage(ctx('10294-1', 'Googlebot/2.1'));
      assert.equal(person.status, 200);
      assert.equal(bot.status, 200);
      assert.equal(await person.text(), await bot.text());
      assert.match(person.headers.get('cache-control'), /s-maxage=3600/);
      assert.equal((await handleSetPage(ctx('99999-1', 'x'))).status, 404);
      assert.equal((await handleSetPage(ctx('../etc', 'x'))).status, 404);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('sitemaps', () => {
  it('indexes the static pages and every set shard', () => {
    const xml = sitemapIndexXml(3, '2026-11-11');
    assert.match(xml, /sitemaps\/static\.xml/);
    assert.match(xml, /sitemaps\/sets-3\.xml/);
    assert.doesNotMatch(xml, /sets-4/);
    assert.match(staticSitemapXml(), /https:\/\/bricksvault\.app\/methodology/);
  });

  it('lists set URLs with valid lastmod only', () => {
    const xml = setsSitemapXml([{ set_num: '10294-1', updated: '2026-11-10' }, { set_num: 'a&b', updated: 'garbage' }]);
    assert.match(xml, /<loc>https:\/\/bricksvault\.app\/s\/10294-1<\/loc><lastmod>2026-11-10<\/lastmod>/);
    assert.match(xml, /a%26b<\/loc><\/url>/);
  });

  it('404s unknown sitemap files', async () => {
    assert.equal((await handleSitemapFile({ params: { file: 'nope.xml' }, env: {} })).status, 404);
    assert.equal((await handleSitemapFile({ params: { file: 'static.xml' }, env: {} })).status, 200);
  });
});
