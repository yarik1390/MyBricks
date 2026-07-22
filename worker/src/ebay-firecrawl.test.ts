import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEbaySoldViaFirecrawl } from './lib/ebay-firecrawl';
import { firecrawlScrape } from './lib/firecrawl';

vi.mock('./lib/firecrawl', () => ({ firecrawlScrape: vi.fn() }));
const mockScrape = vi.mocked(firecrawlScrape);
const env = { FIRECRAWL_API_KEY: 'test-key' } as any;

describe('fetchEbaySoldViaFirecrawl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('separates new and used sold observations from one extraction', async () => {
    mockScrape.mockResolvedValue({
      data: {
        listings: [
          { title: 'LEGO 75192 Millennium Falcon new sealed', price_usd: 800, condition: 'new', sold_date: '2026-07-18' },
          { title: 'LEGO 75192 Millennium Falcon MISB', price_usd: 820, condition: 'new', sold_date: '2026-07-20' },
          { title: 'LEGO 75192 Millennium Falcon sealed', price_usd: 840, condition: 'new', sold_date: '2026-07-19' },
          { title: 'LEGO 75192 Millennium Falcon used complete', price_usd: 600, condition: 'used', sold_date: '2026-07-16' },
          { title: 'LEGO 75192 Millennium Falcon pre-owned', price_usd: 620, condition: 'used', sold_date: '2026-07-17' },
          { title: 'LEGO 75192 Millennium Falcon built', price_usd: 640, condition: 'used', sold_date: '2026-07-15' },
        ],
      },
    } as any);

    const result = await fetchEbaySoldViaFirecrawl('75192-1', 'Millennium Falcon', env);

    expect(result).toMatchObject({
      status: 'ok',
      new_value: 820,
      new_count: 3,
      new_last_sold: '2026-07-20',
      used_value: 620,
      used_count: 3,
      used_last_sold: '2026-07-17',
    });
    expect(mockScrape.mock.calls[0][0].url).not.toContain('LH_ItemCondition');
  });

  it('uses an eBay condition filter when only one condition is due', async () => {
    mockScrape.mockResolvedValue({
      data: {
        listings: [
          { title: 'LEGO 75192 Millennium Falcon', price_usd: 790, condition: '', sold_date: '2026-07-18' },
          { title: 'LEGO 75192 Millennium Falcon', price_usd: 800, condition: '', sold_date: '2026-07-19' },
          { title: 'LEGO 75192 Millennium Falcon', price_usd: 810, condition: '', sold_date: '2026-07-20' },
        ],
      },
    } as any);

    const result = await fetchEbaySoldViaFirecrawl('75192-1', 'Millennium Falcon', env, {
      includeNew: true,
      includeUsed: false,
    });

    expect(result.new_value).toBe(800);
    expect(result.used_value).toBeNull();
    expect(mockScrape.mock.calls[0][0].url).toContain('LH_ItemCondition=1000');
  });
});
