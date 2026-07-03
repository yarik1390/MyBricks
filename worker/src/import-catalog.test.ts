/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

// Mock the HTTP layer to serve gzipped Rebrickable CSVs, so importSets/importFigs
// exercise the REAL gunzip + CSV parse + upsert + formula valuation, no network.
const H = vi.hoisted(() => {
  const THEMES = 'id,name,parent_id\n1,Star Wars,\n2,Ultimate Collector Series,1';
  // One set with a quoted, comma-containing name to exercise the CSV parser; img "None" → null.
  const SETS = 'set_num,name,year,theme_id,num_parts,num_minifigs,img_url\n' +
    '75192-1,"Millennium Falcon, UCS",2017,2,7541,4,https://cdn.rebrickable.com/x.jpg';
  const FIGS = 'fig_num,name,img_url\nfig-001,Luke Skywalker,None';
  const gz = async (s: string) => {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(s)); w.close();
    return new Uint8Array(await new Response(cs.readable).arrayBuffer());
  };
  return { THEMES, SETS, FIGS, gz };
});
vi.mock('./lib/http', () => ({
  fetchTracked: vi.fn(),
  fetchWithRetry: vi.fn(async (url: string) => {
    const body = url.includes('themes') ? H.THEMES : url.includes('minifigs') ? H.FIGS : H.SETS;
    return new Response(await H.gz(body), { status: 200 });
  }),
}));
import { runBatches, importSets, importFigs } from './jobs/import-catalog';

const db = (env as any).DB as D1Database;

describe('import-catalog', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_themes', 'lego_sets', 'minifigs']);
  });

  it('runBatches executes every statement and reports cumulative progress', async () => {
    await db.prepare('DROP TABLE IF EXISTS t_batch').run();
    await db.prepare('CREATE TABLE t_batch (n INTEGER)').run();
    const stmts = Array.from({ length: 250 }, (_, i) => db.prepare('INSERT INTO t_batch (n) VALUES (?)').bind(i));
    const progress: number[] = [];
    await runBatches(db, stmts, { onProgress: async (p) => { progress.push(p); } });

    const n = await db.prepare('SELECT COUNT(*) AS n FROM t_batch').first<{ n: number }>();
    expect(n!.n).toBe(250);
    expect(progress.at(-1)).toBe(250); // final callback reports the full count
  });

  it('importSets resolves themes, parses quoted CSV, and writes a formula valuation', async () => {
    const r = await importSets(db);
    expect(r).toMatchObject({ loaded: 1, themes: 2 });

    const row = await db.prepare(`SELECT name, theme, pieces, minifigs, image_url, current_value, valuation_method FROM lego_sets WHERE set_num='75192-1'`)
      .first<any>();
    expect(row.name).toBe('Millennium Falcon, UCS'); // quoted comma preserved
    expect(row.theme).toBe('Star Wars');             // resolved to the top-level parent
    expect(row.pieces).toBe(7541);
    expect(row.minifigs).toBe(4);
    expect(row.image_url).toBe('https://cdn.rebrickable.com/x.jpg');
    expect(row.current_value).toBeGreaterThan(0);    // formulaValuation ran
    expect(row.valuation_method).toBe('formula_bulk');
  });

  it('importFigs upserts minifigs and maps an img_url of "None" to null', async () => {
    const r = await importFigs(db);
    expect(r.loaded).toBe(1);
    const fig = await db.prepare(`SELECT name, image_url FROM minifigs WHERE fig_num='fig-001'`).first<{ name: string; image_url: string | null }>();
    expect(fig!.name).toBe('Luke Skywalker');
    expect(fig!.image_url).toBeNull();
  });
});
