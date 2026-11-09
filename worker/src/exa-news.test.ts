/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
import { parseExaSummary } from './lib/exa';
import { computeRetirementRisk } from './lib/retirement-risk';
import {
  normalizeNewsDate, normalizeSetNum, runExaNewsScan, runExaRetirementLookups,
} from './jobs/exa-news';

const db = (env as { DB: D1Database }).DB;
const withKey = { ...env, EXA_API_KEY: 'ek' } as any;
const NOW = new Date('2026-11-04T12:00:00Z');

const exaResponse = (results: Array<{ url: string; summary: unknown }>) =>
  new Response(JSON.stringify({ results: results.map((r) => ({ title: 't', publishedDate: '2026-11-02T00:00:00.000Z', ...r })) }));
const empty = () => exaResponse([]);

describe('Exa helpers', () => {
  it('parses set numbers and article dates', () => {
    expect(normalizeSetNum('76419')).toBe('76419-1');
    expect(normalizeSetNum('Set 10305-2')).toBe('10305-2');
    expect(normalizeSetNum('abc')).toBeNull();
    expect(normalizeNewsDate('2026-12', 'retiring', NOW)).toBe('2026-12-31');
    expect(normalizeNewsDate('2027-02', 'upcoming', NOW)).toBe('2027-02-01');
    expect(normalizeNewsDate('2026', 'retiring', NOW)).toBe('2026-12-31');
    expect(normalizeNewsDate('2019-05-01', 'retiring', NOW)).toBeNull();
    expect(normalizeNewsDate('', 'retiring', NOW)).toBeNull();
  });

  it('reads a summary given as an object or a JSON string', () => {
    expect(parseExaSummary('{"a":1}')).toEqual({ a: 1 });
    expect(parseExaSummary('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseExaSummary({ a: 1 })).toEqual({ a: 1 });
    expect(parseExaSummary('not json')).toBeNull();
  });

  it('weighs news reports below LEGO\'s own flag unless two sites agree', () => {
    const base = { year: new Date().getFullYear() - 1, theme: 'Star Wars', pieces: 300, retired: 0 };
    const soon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    expect(computeRetirementRisk(base)).toBe(0);
    expect(computeRetirementRisk({ ...base, news_retiring_sources: 1, news_exit_date: soon })).toBe(50);
    expect(computeRetirementRisk({ ...base, news_retiring_sources: 2, news_exit_date: soon })).toBe(70);
    // Brickset's exit date wins over the news date.
    expect(computeRetirementRisk({ ...base, exit_date: '2030-01-01', news_retiring_sources: 2, news_exit_date: soon })).toBe(40);
  });
});

describe('Exa jobs', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(async () => {
    await applyTestTables(db, ['api_quota', 'app_settings', 'integration_health', 'lego_sets', 'set_market_ext',
      'upcoming_sets', 'set_news', 'exa_lookups', 'user_collection', 'user_wishlist']);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing without a key', async () => {
    expect(await runExaNewsScan({ ...env, EXA_API_KEY: '' } as any)).toEqual({ skipped: 'EXA_API_KEY not set' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns news reports into retirement risk and Coming soon rows', async () => {
    const y = new Date().getFullYear();
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, pieces, retired) VALUES ('75301-1','Luke X-Wing',?1,'Star Wars',474,0)`).bind(y - 1),
      // On sale already: a "new" report must not move it to Coming soon.
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, pieces, retired, lego_availability) VALUES ('60400-1','On Sale',?1,'City',200,0,'in_stock')`).bind(y),
    ]);
    const month = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 7);
    const article = (sets: unknown[]) => ({ sets });
    fetchMock
      .mockResolvedValueOnce(exaResponse([
        { url: 'https://www.brickfanatics.com/retiring', summary: JSON.stringify(article([{ set_number: '75301', status: 'retiring', date: month }])) },
        { url: 'https://www.brickfanatics.com/new', summary: article([{ set_number: '77777', name: 'Secret Ship', status: 'new', price_usd: 79.99 }, { set_number: '60400', status: 'new' }]) },
      ]))
      .mockResolvedValueOnce(exaResponse([
        { url: 'https://jaysbrickblog.com/retiring', summary: article([{ set_number: '75301-1', status: 'retiring' }, { set_number: '99999', status: 'retiring' }]) },
        { url: 'https://thebrickfan.com/new', summary: article([{ set_number: '77777', name: 'Secret Ship', status: 'new' }, { set_number: '60400', status: 'new' }]) },
      ]))
      .mockImplementation(async () => empty());

    const r = await runExaNewsScan(withKey, { now: new Date() }) as unknown as Record<string, number>;
    expect(r.searches).toBe(10);
    expect(r.rescored).toBe(1);
    const set = await db.prepare(`SELECT retirement_risk_score AS risk FROM lego_sets WHERE set_num='75301-1'`).first<{ risk: number }>();
    expect(set?.risk).toBe(70); // two sites (40) + a retirement date within 6 months (30)
    // Unknown set 99999 is not stored as a retiring report.
    expect((await db.prepare(`SELECT COUNT(*) n FROM set_news WHERE set_num='99999-1'`).first<{ n: number }>())?.n).toBe(0);
    const up = await db.prepare(`SELECT set_num, name, price_usd FROM upcoming_sets ORDER BY set_num`).all();
    expect(up.results).toEqual([{ set_num: '77777-1', name: 'Secret Ship', price_usd: 79.99 }]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.contents.summary.schema).toBeTruthy();
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['x-api-key']).toBe('ek');
  });

  it('looks up retirement dates for sets that have none and stamps every attempt', async () => {
    const y = new Date().getFullYear();
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, pieces, retired) VALUES ('10300-1','Time Machine',?1,'Icons',1872,0)`).bind(y - 2),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, pieces, retired) VALUES ('10301-1','Nothing Known',?1,'Icons',500,0)`).bind(y - 2),
      db.prepare(`INSERT INTO lego_sets (set_num, name, year, theme, pieces, retired) VALUES ('892175-1','Polybag',?1,'Ninjago',10,0)`).bind(y - 2),
    ]);
    fetchMock.mockImplementation(async (_url, init) => {
      const q = JSON.parse(String(init?.body)).query as string;
      if (q.includes('10300')) {
        return exaResponse([{ url: 'https://brickset.com/article/1', summary: { mentions_set: 'true', retiring: true, retirement_date: `${y}-12` } }]);
      }
      return exaResponse([{ url: 'https://brickset.com/article/2', summary: { mentions_set: true, retiring: false } }]);
    });
    const r = await runExaRetirementLookups(withKey, { limit: 10 });
    expect(r).toMatchObject({ processed: 2, found: 1, search_errors: 0 });
    const news = await db.prepare(`SELECT set_num, expected_date FROM set_news`).all();
    expect(news.results).toEqual([{ set_num: '10300-1', expected_date: `${y}-12-31` }]);
    const stamps = await db.prepare(`SELECT set_num, status FROM exa_lookups ORDER BY set_num`).all();
    expect(stamps.results).toEqual([{ set_num: '10300-1', status: 'found' }, { set_num: '10301-1', status: 'none' }]);
    // Asked again only after 60 days.
    fetchMock.mockClear();
    expect((await runExaRetirementLookups(withKey, { limit: 10 })).processed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
