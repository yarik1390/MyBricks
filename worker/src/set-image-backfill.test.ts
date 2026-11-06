/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/brightdata', () => ({ brightDataUnlock: vi.fn(async () => null) }));
vi.mock('./lib/backup-scrapers', () => ({ backupFetch: vi.fn(async () => ({ html: null, missing: false })) }));
vi.mock('./lib/firecrawl', () => ({ firecrawlScrape: vi.fn(async () => null) }));
vi.mock('./lib/source-config', () => ({ sourceEnabled: vi.fn(async () => true) }));
vi.mock('./lib/pricing-flags', () => ({ firecrawlEnabled: () => false }));

import { brightDataUnlock } from './lib/brightdata';
import { parseLegoProductImage, runSetImageBackfill, recordMissingRebrickableImage } from './jobs/set-image-backfill';

const db = (env as any).DB as D1Database;
const RB = (n: string) => `https://cdn.rebrickable.com/media/sets/${n}.jpg`;
const run = (e: any = {}) => runSetImageBackfill({ ...env, PHOTO_BUCKET: undefined, ...e } as any);

function stubFetch(map: Record<string, number>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const status = map[url] ?? 404;
    return new Response(null, { status, headers: { 'content-type': status === 200 ? 'image/jpeg' : 'text/html' } });
  }));
}

describe('parseLegoProductImage', () => {
  it('takes the og:image when it names the set', () => {
    const html = '<meta property="og:image" content="https://www.lego.com/cdn/cs/set/assets/blt1/45833_Prod.png?fit=bounds&amp;width=800">';
    expect(parseLegoProductImage(html, '45833')).toBe('https://www.lego.com/cdn/cs/set/assets/blt1/45833_Prod.png?fit=bounds&width=800');
  });
  it('rejects banners, other sets and other hosts', () => {
    expect(parseLegoProductImage('<meta property="og:image" content="https://www.lego.com/cdn/banner.png">', '45833')).toBeNull();
    expect(parseLegoProductImage('<meta property="og:image" content="https://evil.example/45833.png">', '45833')).toBeNull();
  });
  it('falls back to the JSON-LD Product image for this sku', () => {
    const html = `<script type="application/ld+json">[{"@type":"Product","sku":"10316","image":"https://www.lego.com/a/10316.png"},
      {"@type":"Product","sku":"45833","image":["https://www.lego.com/a/45833_alt.png"]}]</script>`;
    expect(parseLegoProductImage(html, '45833')).toBe('https://www.lego.com/a/45833_alt.png');
  });
});

describe('runSetImageBackfill', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'set_image_checks']);
    vi.mocked(brightDataUnlock).mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('marks present photos and swaps a missing one for Brickset', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, image_url) VALUES
      ('10316-1','Rivendell',2023,?1), ('45833-1','BIOGLOW',2026,?2)`).bind(RB('10316-1'), RB('45833-1')).run();
    const bs = 'https://images.brickset.com/sets/images/45833-1.jpg';
    stubFetch({ [RB('10316-1')]: 200, [bs]: 200 });
    const r = await run();
    expect(r).toMatchObject({ probed: 2, missing: 1, resolved: 1, brickset: 1 });
    const row = await db.prepare(`SELECT image_url FROM lego_sets WHERE set_num='45833-1'`).first<any>();
    expect(row.image_url).toBe(bs);
    const ok = await db.prepare(`SELECT image_url FROM lego_sets WHERE set_num='10316-1'`).first<any>();
    expect(ok.image_url).toBe(RB('10316-1'));
    // Second run: nothing left to probe or resolve.
    expect(await run()).toMatchObject({ probed: 0, resolved: 0 });
  });

  it('uses the LEGO.com product photo when Brickset has none', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, image_url) VALUES ('45832-1','BIOGLOW',2026,?1)`).bind(RB('45832-1')).run();
    stubFetch({});
    vi.mocked(brightDataUnlock).mockResolvedValue('<meta property="og:image" content="https://www.lego.com/cdn/x/45832_Prod.png">');
    const r = await run();
    expect(r).toMatchObject({ resolved: 1, lego: 1 });
    const row = await db.prepare(`SELECT image_url FROM lego_sets WHERE set_num='45832-1'`).first<any>();
    expect(row.image_url).toBe('https://www.lego.com/cdn/x/45832_Prod.png');
  });

  it('never scrapes LEGO.com for gear/book codes and records the miss', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, image_url) VALUES ('TSHIRT-1','Tee',2026,?1)`).bind(RB('TSHIRT-1')).run();
    stubFetch({});
    const r = await run();
    expect(r).toMatchObject({ missing: 1, resolved: 0, scraped: 0 });
    expect(brightDataUnlock).not.toHaveBeenCalled();
    const c = await db.prepare(`SELECT attempts, fallback_checked_at FROM set_image_checks WHERE set_num='TSHIRT-1'`).first<any>();
    expect(c.attempts).toBe(1);
    expect(c.fallback_checked_at).toBeTruthy();
  });

  it('switches back to Rebrickable once it has the photo', async () => {
    const bs = 'https://images.brickset.com/sets/images/45833-1.jpg';
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, image_url) VALUES ('45833-1','BIOGLOW',2026,?1)`).bind(bs).run();
    await db.prepare(`INSERT INTO set_image_checks (set_num, rb_url, rb_status, checked_at, fallback_url, fallback_source)
      VALUES ('45833-1', ?1, 404, datetime('now','-40 days'), ?2, 'brickset')`).bind(RB('45833-1'), bs).run();
    stubFetch({ [RB('45833-1')]: 200 });
    const r = await run();
    expect(r.restored).toBe(1);
    const row = await db.prepare(`SELECT image_url FROM lego_sets WHERE set_num='45833-1'`).first<any>();
    expect(row.image_url).toBe(RB('45833-1'));
  });

  it('recordMissingRebrickableImage only records real catalog images', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, image_url) VALUES ('45834-1','BIOGLOW',?1)`).bind(RB('45834-1')).run();
    await recordMissingRebrickableImage(env as any, RB('45834-1'));
    await recordMissingRebrickableImage(env as any, RB('nope-1'));
    const { results } = await db.prepare(`SELECT set_num, rb_status FROM set_image_checks`).all<any>();
    expect(results).toEqual([{ set_num: '45834-1', rb_status: 404 }]);
  });
});
