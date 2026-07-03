/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

// Partial mock: keep the real UPC_THROTTLE_CODES set, stub only the network call.
vi.mock('./lib/upcitemdb', async (orig) => ({
  ...(await orig<typeof import('./lib/upcitemdb')>()),
  searchUpcItemDb: vi.fn(),
}));
import { searchUpcItemDb, UPC_THROTTLE_CODES } from './lib/upcitemdb';
import { runUpcItemDbBackfill } from './jobs/upcitemdb-backfill';

const db = (env as any).DB as D1Database;
const mockSearch = vi.mocked(searchUpcItemDb);
const today = new Date().toISOString().slice(0, 10);

describe('runUpcItemDbBackfill', () => {
  beforeEach(async () => {
    mockSearch.mockReset();
    await applyTestTables(db, ['lego_sets', 'integration_health', 'api_quota']);
  });

  it('skips when disabled', async () => {
    const r = await runUpcItemDbBackfill({ ...env, UPCITEMDB_ENABLED: '0' } as any);
    expect(r.lastCode).toBe('disabled');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('stops when the daily quota is exhausted', async () => {
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('upcitemdb', ?1, 96, 96)`).bind(today).run();
    const r = await runUpcItemDbBackfill(env as any);
    expect(r.lastCode).toBe('quota_exhausted');
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('fills a validated barcode and advances', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, upc) VALUES ('75300-1','X-Wing', 2020, 'Star Wars', NULL)`).run();
    mockSearch.mockResolvedValue({ code: 'OK', barcode: '0673419340373' } as any);
    const r = await runUpcItemDbBackfill(env as any, { limit: 1 });
    expect(r).toMatchObject({ processed: 1, filled: 1, lastCode: 'OK' });
    const row = await db.prepare(`SELECT upc FROM lego_sets WHERE set_num='75300-1'`).first<{ upc: string }>();
    expect(row!.upc).toBe('0673419340373');
  });

  it('stops without advancing when throttled', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, upc) VALUES ('75301-1','TIE', 2020, 'Star Wars', NULL)`).run();
    const throttleCode = [...UPC_THROTTLE_CODES][0];
    mockSearch.mockResolvedValue({ code: throttleCode, barcode: null } as any);
    const r = await runUpcItemDbBackfill(env as any, { limit: 1 });
    expect(r).toMatchObject({ processed: 1, filled: 0 });
    expect(UPC_THROTTLE_CODES.has(r.lastCode)).toBe(true);
    const row = await db.prepare(`SELECT upc FROM lego_sets WHERE set_num='75301-1'`).first<{ upc: string | null }>();
    expect(row!.upc).toBeNull(); // not written on a throttle
  });
});
