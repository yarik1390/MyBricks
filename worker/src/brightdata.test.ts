/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
import {
  configuredBrightDataTokens,
  getBrightDataKeyPoolStatus,
  hashBrightDataToken,
  markBrightDataExhausted,
  pickBrightDataToken,
  reserveBrightDataUnit,
  resetBrightDataKeyPool,
} from './lib/brightdata-keys';
import { brightDataUnlock } from './lib/brightdata';
import {
  parseBrickEconomyHtml,
  parseBricksetHtml,
  parseLegoStockHtml,
} from './lib/brightdata-parsers';

const db = (env as any).DB as D1Database;
const pool = {
  ...env,
  BRIGHTDATA_API_TOKEN: 'token-a',
  BRIGHTDATA_API_TOKENS: 'token-b, token-c, token-a',
  BRIGHTDATA_KEY_CAP: '2',
} as any;

describe('Bright Data rotating monthly token pool', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['brightdata_keys', 'integration_health']);
    vi.unstubAllGlobals();
  });

  it('deduplicates configured secrets without exposing them in status', async () => {
    expect(configuredBrightDataTokens(pool)).toEqual(['token-a', 'token-b', 'token-c']);
    const status = await getBrightDataKeyPoolStatus(pool);
    expect(status.keys_configured).toBe(3);
    expect(JSON.stringify(status)).not.toContain('token-a');
  });

  it('rotates to the least-used live token and respects the monthly cap', async () => {
    const first = await pickBrightDataToken(pool);
    expect(first?.key).toBe('token-a');
    expect(await reserveBrightDataUnit(pool, first!)).toBe(true);
    const second = await pickBrightDataToken(pool);
    expect(second?.key).toBe('token-b');

    const hashB = await hashBrightDataToken('token-b');
    await db.prepare(`INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at)
      VALUES (?1, 2, 2, strftime('%Y-%m','now'), datetime('now'))
      ON CONFLICT(key_hash) DO UPDATE SET used=2, period_month=strftime('%Y-%m','now'), exhausted_at=datetime('now')`).bind(hashB).run();
    const next = await pickBrightDataToken(pool);
    expect(next?.key).toBe('token-c');
  });

  it('atomically reserves near-cap tokens so concurrent calls cannot overspend', async () => {
    const hashA = await hashBrightDataToken('token-a');
    const hashB = await hashBrightDataToken('token-b');
    const hashC = await hashBrightDataToken('token-c');
    // All three tokens at used=1 so the picker (first-least) chooses token-a.
    for (const h of [hashA, hashB, hashC]) {
      await db.prepare(`INSERT INTO brightdata_keys (key_hash, used, cap, period_month)
        VALUES (?1, 1, 2, strftime('%Y-%m','now'))`).bind(h).run();
    }
    const picked = await pickBrightDataToken(pool);
    expect(picked?.key).toBe('token-a');
    const [a, b] = await Promise.all([
      reserveBrightDataUnit(pool, picked!),
      reserveBrightDataUnit(pool, picked!),
    ]);
    // cap=2, used=1 → exactly one of the two concurrent claims can land
    expect([a, b].filter(Boolean).length).toBe(1);
    const status = await getBrightDataKeyPoolStatus(pool);
    expect(status.entries.find((e) => e.key_hash === hashA.slice(0, 12))?.used).toBe(2);
  });

  it('rolls a previous-month row into a fresh budget', async () => {
    const hashA = await hashBrightDataToken('token-a');
    await db.prepare(`INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at)
      VALUES (?1, 2, 2, strftime('%Y-%m','now','-1 month'), datetime('now'))`).bind(hashA).run();
    const picked = await pickBrightDataToken(pool);
    expect(picked?.key).toBe('token-a');
    expect(await reserveBrightDataUnit(pool, picked!)).toBe(true);
    const status = await getBrightDataKeyPoolStatus(pool);
    const entry = status.entries.find((e) => e.key_hash === hashA.slice(0, 12));
    expect(entry?.period_month).toBe(status.period_month);
    expect(entry?.used).toBe(1);
    expect(entry?.exhausted).toBe(false);
  });

  it('latching exhaustion skips the token for the rest of the month', async () => {
    const hashB = await hashBrightDataToken('token-b');
    await db.prepare(`INSERT INTO brightdata_keys (key_hash, used, cap, period_month)
      VALUES (?1, 0, 2, strftime('%Y-%m','now'))`).bind(hashB).run();
    await markBrightDataExhausted(pool, { key: 'token-b', hash: hashB, index: 1 });
    const picked = await pickBrightDataToken(pool);
    expect(picked?.key).not.toBe('token-b');
  });

  it('reset un-latches exhaustion but NEVER resets current-month usage', async () => {
    const hashA = await hashBrightDataToken('token-a');
    const hashB = await hashBrightDataToken('token-b');
    const hashC = await hashBrightDataToken('token-c');
    // token-a: used 1 + exhausted latch (the recovery target). tokens b/c are
    // already AT the monthly cap, so after a reset only token-a is eligible.
    await db.prepare(`INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at)
      VALUES (?1, 1, 2, strftime('%Y-%m','now'), datetime('now'))`).bind(hashA).run();
    for (const h of [hashB, hashC]) {
      await db.prepare(`INSERT INTO brightdata_keys (key_hash, used, cap, period_month)
        VALUES (?1, 2, 2, strftime('%Y-%m','now'))`).bind(h).run();
    }
    // Before reset: token-a is latched, b/c are at cap → nothing eligible.
    expect(await pickBrightDataToken(pool)).toBeNull();

    const result = await resetBrightDataKeyPool(pool);
    expect(result.reset).toBe(1);

    const after = await getBrightDataKeyPoolStatus(pool);
    const entry = after.entries.find((e) => e.key_hash === hashA.slice(0, 12));
    // used stays 1 — the monthly cap remains enforced after an admin recovery;
    // only the exhaustion latch cleared (a false-positive 401 can be retried
    // WITHOUT reopening paid capacity).
    expect(entry?.used).toBe(1);
    expect(entry?.exhausted).toBe(false);
    const picked = await pickBrightDataToken(pool);
    expect(picked?.key).toBe('token-a');
    // One claim is allowed (1→2 of cap 2); the counter did NOT reset to 0, so
    // the very next claim is refused at the cap.
    expect(await reserveBrightDataUnit(pool, picked!)).toBe(true);
    expect(await reserveBrightDataUnit(pool, picked!)).toBe(false);
    const spent = await getBrightDataKeyPoolStatus(pool);
    expect(spent.entries.find((e) => e.key_hash === hashA.slice(0, 12))?.used).toBe(2);
  });

  it('reports DEGRADED instead of fabricated capacity when the ledger is unreachable', async () => {
    await db.prepare(`DROP TABLE brightdata_keys`).run();
    const status = await getBrightDataKeyPoolStatus(pool);
    expect(status.ledger_available).toBe(false);
    expect(status.status).toBe('degraded');
    expect(status.keys_live).toBe(0);
    expect(status.pooled_remaining).toBe(0);
    expect(status.entries.every((e) => e.usage_unknown === true)).toBe(true);
    // Runtime fails closed on the same outage: the picker's read path degrades
    // to a candidate, but the ATOMIC reserve throws, so brightDataUnlock aborts
    // rather than spend unaccounted credits.
    const picked = await pickBrightDataToken(pool);
    expect(picked).not.toBeNull();
    await expect(reserveBrightDataUnit(pool, picked!)).rejects.toThrow();
  });
});

describe('Bright Data Web Unlocker client', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['brightdata_keys', 'integration_health']);
    vi.unstubAllGlobals();
  });

  it('posts the raw contract and fails over when a token is exhausted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Customer is not active', { status: 400 }))
      .mockResolvedValueOnce(new Response('<html>ok</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const html = await brightDataUnlock('https://example.com/page', pool, { timeoutMs: 1000 });
    expect(html).toBe('<html>ok</html>');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('https://api.brightdata.com/request');
    expect(init.headers.Authorization).toBe('Bearer token-a');
    expect(JSON.parse(init.body)).toMatchObject({
      zone: 'web_unlocker1', url: 'https://example.com/page', format: 'raw', method: 'GET', country: 'us',
    });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).not.toBe('Bearer token-a');
  });

  it('fails closed when the monthly ledger is unavailable (no outbound request)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await db.exec('DROP TABLE brightdata_keys'); // missing migration / D1 outage
    const html = await brightDataUnlock('https://example.com/page', pool, { timeoutMs: 1000 });
    expect(html).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops when the daily source cap is exhausted without burning monthly units', async () => {
    await applyTestTables(db, ['brightdata_keys', 'integration_health', 'api_quota']);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const day = new Date().toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap)
      VALUES ('brightdata', ?1, 300, 300)`).bind(day).run();
    const hashA = await hashBrightDataToken('token-a');
    const html = await brightDataUnlock('https://example.com/page', pool, { timeoutMs: 1000 });
    expect(html).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    // The daily-cap rejection must NOT consume monthly reservations.
    const rows = await db.prepare('SELECT COUNT(*) AS n FROM brightdata_keys WHERE key_hash = ?1')
      .bind(hashA).first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });
});

describe('deterministic Bright Data HTML parsers', () => {
  it('parses BrickEconomy labels without confusing current, forecast, or used values', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product","offers":{"price":"1448.03"}}</script>
      <div>Retail price</div><div>$849.99</div>
      <div>Today's value</div><div>$1,448.03</div>
      <div>Rolling growth</div><div>+2.93% <small>Previous 12 months</small></div>
      <div>5 year forecast</div><div>$2,089.05</div>
      <section><h3>Set Pricing Models</h3>
        <h4>New/Sealed</h4><div>Machine Learning/AI Model</div>
        <div>Value(today)</div><div>$1,448.03</div>
        <div>Value(in 2 years)</div><div>$1,951.71</div>
        <div>Statistical Model</div><div>Value(today)</div><div>$1,468.06</div>
        <h4>Used</h4><div>Machine Learning/AI Model</div>
        <div>Value(today)</div><div>$821.37</div><div>Low</div><div>$700</div>
      </section>`;
    expect(parseBrickEconomyHtml(html)).toEqual({
      retail_price_us: 849.99,
      current_value_new: 1448.03,
      current_value_used: 821.37,
      forecast_value_new_2_years: 1951.71,
      forecast_value_new_5_years: 2089.05,
      rolling_growth_12months: 2.93,
    });
    expect(parseBrickEconomyHtml('<h1>Yikes!</h1><p>The page you requested could not be found.</p>')).toBeNull();
  });

  it('parses Brickset dt/dd metadata, US RRP, dates, tags, age and rating', () => {
    const html = `<dl>
      <dt>Theme group</dt><dd>Licensed</dd><dt>Subtheme</dt><dd>Ultimate Collector Series</dd>
      <dt>Category</dt><dd>Normal</dd><dt>Launch/exit</dt><dd>26 Nov 21 - 31 Dec 24</dd>
      <dt>Tags</dt><dd><div id="tags31235"><a class="name">AT-AT Driver</a><a>18 Plus</a></div></dd>
      <dt>RRP</dt><dd>£734.99, $849.99, €849.99</dd><dt>Age range</dt><dd>18+</dd>
      <dt>Packaging</dt><dd>Box</dd><dt>Dimensions</dt><dd>58.2 x 48 x 43.1 cm</dd>
      <dt>Rating</dt><dd><span>4.4</span> from 386 ratings</dd></dl>`;
    expect(parseBricksetHtml(html)).toMatchObject({
      msrp_usd: 849.99,
      launch_date: '2021-11-26',
      exit_date: '2024-12-31',
      theme_group: 'Licensed',
      subtheme: 'Ultimate Collector Series',
      category: 'Normal',
      age_min: 18,
      packaging_type: 'Box',
      dimensions: '58.2 x 48 x 43.1 cm',
      tags: ['AT-AT Driver', '18 Plus'],
      rating: 4.4,
      review_count: 386,
      brickset_set_id: 31235,
    });
  });

  it('maps LEGO availabilityStatus EOL and integer centAmount deterministically', () => {
    const html = `<script>{"availabilityStatus":"EOL","price":{"centAmount":84999,"currencyCode":"USD"}}</script>`;
    expect(parseLegoStockHtml(html)).toEqual({
      in_stock: false,
      retiring_soon: false,
      availability: 'sold_out',
      retail_price_usd: 849.99,
    });
  });

  it('classifies LEGO terminal and retiring states distinctly', () => {
    expect(parseLegoStockHtml(`{"availabilityStatus":"RETIRED"}`)).toMatchObject({
      in_stock: false, retiring_soon: false, availability: 'sold_out',
    });
    expect(parseLegoStockHtml(`{"availabilityStatus":"RETIRING_SOON"}`)).toMatchObject({
      in_stock: false, retiring_soon: true, availability: 'retiring',
    });
    expect(parseLegoStockHtml(`{"availabilityStatus":"RETIRING"}`)).toMatchObject({
      in_stock: false, retiring_soon: true, availability: 'retiring',
    });
    expect(parseLegoStockHtml(`{"availabilityStatus":"EOL"}`)).toMatchObject({
      in_stock: false, retiring_soon: false, availability: 'sold_out',
    });
    expect(parseLegoStockHtml(`{"availabilityStatus":"IN_STOCK"}`)).toMatchObject({
      in_stock: true, retiring_soon: false, availability: 'in_stock',
    });
  });

  it('scopes JSON-LD to the requested product when an unrelated set appears first', () => {
    // A recommendation block for ANOTHER set precedes the requested product —
    // the old "first global match" logic would persist 75257's price/status.
    const html = `
      <script type="application/ld+json">{"@type":"Product","sku":"75257","offers":{"price":129.99,"priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
      <script type="application/ld+json">{"@type":"Product","sku":"75313","offers":{"price":849.99,"priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}}</script>`;
    expect(parseLegoStockHtml(html, '75313')).toEqual({
      in_stock: false,
      retiring_soon: false,
      availability: 'out_of_stock',
      retail_price_usd: 849.99,
    });
  });

  it('falls through when JSON-LD has several products and none matches the hint', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product","sku":"75257","offers":{"price":129.99,"priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>
      <script type="application/ld+json">{"@type":"Product","sku":"75313","offers":{"price":849.99,"priceCurrency":"USD","availability":"https://schema.org/OutOfStock"}}</script>`;
    // No hint: two candidates, neither provably the target → ambiguous → null
    // so the caller falls back to Firecrawl instead of guessing.
    expect(parseLegoStockHtml(html)).toBeNull();
    // Hint for a set that is not on the page either → ambiguous → null.
    expect(parseLegoStockHtml(html, '42146')).toBeNull();
  });

  it('rejects conflicting state values but accepts duplicated ones for the same product', () => {
    // Duplicated state for the SAME product is common (SSR + hydration) —
    // identical values are fine.
    const duplicated = `{"availabilityStatus":"EOL"} {"availabilityStatus":"EOL"}`;
    expect(parseLegoStockHtml(duplicated)).toMatchObject({
      in_stock: false, retiring_soon: false, availability: 'sold_out',
    });
    // Two DIFFERENT statuses mean another product's data is in the document.
    const conflicting = `{"availabilityStatus":"IN_STOCK"} {"availabilityStatus":"EOL"}`;
    expect(parseLegoStockHtml(conflicting)).toBeNull();
    // Two different USD prices are likewise ambiguous → no price, but status
    // (unanimous) still lands.
    const twoPrices = `{"availabilityStatus":"IN_STOCK","price":{"centAmount":12999,"currencyCode":"USD"}} {"price":{"centAmount":84999,"currencyCode":"USD"}}`;
    expect(parseLegoStockHtml(twoPrices)).toMatchObject({
      in_stock: true, availability: 'in_stock', retail_price_usd: null,
    });
  });
});
