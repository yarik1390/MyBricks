import { describe, it, expect } from 'vitest';
import { openverseMatches, bareSetNum, runTrainingPhotos, throttleSeconds } from './jobs/training-photos';
import { summarizeResult } from './lib/cron-runs';
import { ldImages, parseLegoStockHtml } from './lib/brightdata-parsers';
import { normalizeLegoStockResult } from './lib/lego-stock';

describe('training photos', () => {
  it('keeps Openverse results only when title or tags name the set number', () => {
    const base = { url: 'https://live.staticflickr.com/1/2_b.jpg' };
    expect(openverseMatches('75192-1', { ...base, title: 'LEGO 75192 Millennium Falcon' })).toBe(true);
    expect(openverseMatches('75192-1', { ...base, title: 'Falcon', tags: [{ name: 'lego75192' }] })).toBe(true);
    expect(openverseMatches('75192-1', { ...base, title: 'LEGO 751923 something' })).toBe(false);
    expect(openverseMatches('75192-1', { ...base, title: 'A LEGO ship' })).toBe(false);
    expect(openverseMatches('75192-1', { title: 'LEGO 75192' })).toBe(false); // no URL
    expect(openverseMatches('10-1', { ...base, title: 'LEGO 10' })).toBe(false); // too short to match safely
    expect(bareSetNum('10294-2')).toBe('10294');
  });

  it('reads LEGO.com gallery photos from the scoped JSON-LD product', () => {
    expect(ldImages(['https://a/1.jpg', { url: 'https://a/2.jpg' }, 'http://a/3.jpg', 'https://a/1.jpg'])).toEqual(['https://a/1.jpg', 'https://a/2.jpg']);
    const ld = (sku: string, images: string[]) => `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product', sku, image: images,
      offers: { availability: 'https://schema.org/InStock', price: 99.99, priceCurrency: 'USD' },
    })}</script>`;
    const html = ld('10316', ['https://www.lego.com/cdn/cs/set/assets/a.png', 'https://www.lego.com/cdn/cs/set/assets/b.png'])
      + ld('99999', ['https://www.lego.com/cdn/other.png']);
    const parsed = parseLegoStockHtml(html, '10316');
    expect(parsed?.images).toEqual(['https://www.lego.com/cdn/cs/set/assets/a.png', 'https://www.lego.com/cdn/cs/set/assets/b.png']);
    expect(normalizeLegoStockResult(parsed)?.images).toHaveLength(2);
    // Photos alone never count as a stock observation.
    expect(normalizeLegoStockResult({ images: ['https://a/1.jpg'] })).toBeNull();
  });

  it('reports why the Openverse step did nothing in the run summary', async () => {
    const res = await runTrainingPhotos({} as any, new Date('2026-11-27T14:25:00Z'));
    expect(summarizeResult(res)).toBe('skipped: openverse: no OPENVERSE_CLIENT_ID');
  });

  it('waits out an Openverse throttle instead of failing every hour', async () => {
    expect(throttleSeconds('{"detail":"Request was throttled. Expected available in 79877 seconds."}')).toBe(79877);
    const kv = new Map<string, string>([['openverse:backoff-until', new Date(Date.now() + 3600_000).toISOString()]]);
    const CACHE_KV = { get: async (k: string) => kv.get(k) ?? null, put: async () => {}, delete: async () => {} };
    const res = await runTrainingPhotos({ OPENVERSE_CLIENT_ID: 'id', OPENVERSE_CLIENT_SECRET: 's', CACHE_KV } as any, new Date('2026-11-28T14:25:00Z'));
    expect(summarizeResult(res)).toMatch(/^skipped: openverse: throttled until /);
    expect((res as { failed: number }).failed).toBe(0);
  });
});
