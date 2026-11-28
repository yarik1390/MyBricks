import { describe, it, expect } from 'vitest';
import { runTrainingPhotos } from './jobs/training-photos';
import { summarizeResult } from './lib/cron-runs';
import { ldImages, parseLegoStockHtml } from './lib/brightdata-parsers';
import { normalizeLegoStockResult } from './lib/lego-stock';

describe('training photos', () => {
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

  it('leaves Openverse to GitHub and runs Brickset photos at 23:00 UTC', async () => {
    expect(summarizeResult(await runTrainingPhotos({} as any, new Date('2026-11-27T14:25:00Z'))))
      .toBe('skipped: Brickset photos run at 23:00 UTC; Openverse runs on GitHub');
    const res = await runTrainingPhotos({} as any, new Date('2026-11-27T23:25:00Z'));
    expect(summarizeResult(res)).toBe('skipped: brickset: no BRICKSET_API_KEY');
    expect((res as { failed: number }).failed).toBe(0);
  });
});
