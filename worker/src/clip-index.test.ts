/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIP_DIM, resetClipCircuitForTests } from './lib/clip-embed';
import { clipVectorId } from './lib/scan-clip';
import { loadClipIndexCandidates, runClipIndex } from './jobs/clip-index';

const db = (env as any).DB as D1Database;

function seededVector(seed: number, dim = CLIP_DIM): number[] {
  const values = Array.from({ length: dim }, (_, i) => Math.sin((i + 1) * (seed + 0.17)));
  const mag = Math.sqrt(values.reduce((s, x) => s + x * x, 0));
  return values.map((x) => x / mag);
}

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS set_clip_index').run();
  await db.prepare('DROP TABLE IF EXISTS user_collection').run();
  await db.prepare('DROP TABLE IF EXISTS user_wishlist').run();
  await db.prepare('DROP TABLE IF EXISTS lego_sets').run();
  await db.prepare(`CREATE TABLE lego_sets (
    set_num TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT,
    brickset_image_urls TEXT,
    blended_value REAL,
    current_value REAL
  )`).run();
  await db.prepare(`CREATE TABLE set_clip_index (
    vector_id TEXT PRIMARY KEY,
    set_num TEXT NOT NULL,
    view TEXT NOT NULL,
    image_url TEXT NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare(`INSERT INTO lego_sets (set_num, name, image_url, brickset_image_urls, blended_value, current_value) VALUES
    ('75192-1', 'Millennium Falcon', 'https://cdn.rebrickable.com/media/sets/75192-1.jpg',
     '["https://images.brickset.com/sets/images/75192-1.jpg"]', 800, 800),
    ('MOC-1', 'A MOC', 'https://cdn.rebrickable.com/media/mocs/x.jpg', NULL, 10, 10),
    ('NOIMG', 'No photo', NULL, NULL, 5, 5)
  `).run();
}

describe('CLIP catalog indexer', () => {
  beforeEach(async () => {
    resetClipCircuitForTests();
    await freshSchema();
    (env as any).CLIP_ENABLED = '1';
    (env as any).CLIP_EMBED_URL = undefined;
    (env as any).PHOTO_BUCKET = undefined;
  });

  it('selects official Rebrickable (+ stored Brickset) views and skips MOCs', async () => {
    const views = await loadClipIndexCandidates(db, 20);
    expect(views.map((v) => `${v.setNum}:${v.view}`)).toEqual([
      '75192-1:official',
      '75192-1:brickset-0',
    ]);
    expect(views.every((v) => !v.imageUrl.includes('/mocs/'))).toBe(true);
  });

  it('no-ops when the embedder is not bound', async () => {
    (env as any).CLIP_EMBED = undefined;
    (env as any).SET_CLIP = { query: async () => ({ matches: [] }), upsert: async () => ({}) };
    await expect(runClipIndex(env as any, { limit: 10 })).resolves.toMatchObject({
      processed: 0,
      upserted: 0,
    });
  });

  it('embeds catalog images and upserts Vectorize rows', async () => {
    const upserted: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
    (env as any).CLIP_EMBED = {
      fetch: async () => new Response(JSON.stringify({ vector: seededVector(3), dim: CLIP_DIM }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    };
    (env as any).SET_CLIP = {
      query: async () => ({ matches: [] }),
      upsert: async (rows: Array<{ id: string; metadata?: Record<string, unknown> }>) => {
        upserted.push(...rows);
        return { mutationId: 'test' };
      },
    };
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    )) as typeof fetch;

    try {
      const result = await runClipIndex(env as any, { limit: 10 });
      expect(result.upserted).toBe(2);
      expect(upserted.map((row) => row.id).sort()).toEqual([
        clipVectorId('75192-1', 'brickset-0'),
        clipVectorId('75192-1', 'official'),
      ]);
      const indexed = await db.prepare('SELECT set_num, view FROM set_clip_index ORDER BY view').all();
      expect(indexed.results).toEqual([
        { set_num: '75192-1', view: 'brickset-0' },
        { set_num: '75192-1', view: 'official' },
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('skips sets already in set_clip_index', async () => {
    await db.prepare(
      `INSERT INTO set_clip_index (vector_id, set_num, view, image_url, model, dim)
       VALUES (?, '75192-1', 'official', 'https://cdn.rebrickable.com/media/sets/75192-1.jpg', 'mobileclip-s2', 512)`,
    ).bind(clipVectorId('75192-1', 'official')).run();
    const views = await loadClipIndexCandidates(db, 20);
    expect(views).toEqual([]);
  });
});
