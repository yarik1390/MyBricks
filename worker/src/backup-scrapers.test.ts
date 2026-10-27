/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
import { backupScrape } from './lib/backup-scrapers';

const db = (env as { DB: D1Database }).DB;
const keys = { ...env, DECODO_AUTH_TOKEN: 'dk', ZENROWS_API_KEY: 'zk' } as any;

describe('backup scrapers (Decodo, then ZenRows)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(async () => {
    await applyTestTables(db, ['api_quota', 'app_settings', 'integration_health']);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns the Decodo page and never calls ZenRows', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ content: '<dl><dt>RRP</dt></dl>', status_code: 200 }] })));
    expect(await backupScrape('https://brickset.com/sets/10305-1', keys)).toBe('<dl><dt>RRP</dt></dl>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://data.decodo.com/v1/scrape');
    expect(JSON.parse(String(init?.body))).toEqual({ target: 'universal', url: 'https://brickset.com/sets/10305-1' });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer dk');
  });

  it('falls back to ZenRows when Decodo fails, and records why', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ content: '', status_code: 520 }] })))
      .mockResolvedValueOnce(new Response('<html>page</html>'));
    expect(await backupScrape('https://www.lego.com/en-us/product/10305', keys)).toBe('<html>page</html>');
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^https:\/\/api\.zenrows\.com\/v1\/\?apikey=zk&url=https%3A%2F%2Fwww\.lego\.com/);
    const row = await db.prepare(`SELECT last_error FROM integration_health WHERE service='decodo'`).first<{ last_error: string }>();
    expect(row?.last_error).toBe('target page failed: www.lego.com HTTP 520');
  });

  it('does nothing when neither key is set', async () => {
    expect(await backupScrape('https://brickset.com/', env as any)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
