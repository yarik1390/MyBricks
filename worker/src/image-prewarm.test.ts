/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runImagePrewarm } from './jobs/image-prewarm';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// Minimal in-memory R2 stand-in — the job only calls head()/put().
function fakeBucket() {
  const puts: string[] = [];
  return {
    puts,
    head: async () => null,               // nothing pre-cached
    put: async (key: string) => { puts.push(key); return {} as any; },
  };
}
const REB = 'https://cdn.rebrickable.com/media/sets/75192-1.jpg';

describe('runImagePrewarm', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'minifigs', 'user_minifigs']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('skips when R2 is not configured', async () => {
    const r = await runImagePrewarm({ ...env, PHOTO_BUCKET: undefined } as any);
    expect(r.skipped).toMatch(/R2 not configured/);
  });

  it('processes nothing when no Rebrickable image needs prewarming', async () => {
    const r = await runImagePrewarm({ ...env, PHOTO_BUCKET: {} } as any);
    expect(r).toMatchObject({ processed: 0, cached: 0 });
  });

  it('caches the image into R2 and stamps prewarmed_at', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, image_url, img_prewarmed_at) VALUES ('75192-1','Falcon', ?1, NULL)`).bind(REB).run();
    const bucket = fakeBucket();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200, headers: { 'content-type': 'image/jpeg' } })));

    const r = await runImagePrewarm({ ...env, PHOTO_BUCKET: bucket } as any);
    expect(r).toMatchObject({ processed: 1, cached: 1 });
    expect(bucket.puts.length).toBe(1);
    const row = await db.prepare(`SELECT img_prewarmed_at FROM lego_sets WHERE set_num='75192-1'`).first<{ img_prewarmed_at: string }>();
    expect(row!.img_prewarmed_at).toBeTruthy();
  });

  it('stamps prewarmed_at even when the image fetch fails (queue advances)', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, image_url, img_prewarmed_at) VALUES ('75192-1','Falcon', ?1, NULL)`).bind(REB).run();
    const bucket = fakeBucket();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));

    const r = await runImagePrewarm({ ...env, PHOTO_BUCKET: bucket } as any);
    expect(r).toMatchObject({ processed: 1, cached: 0 }); // fetch failed → not cached
    expect(bucket.puts.length).toBe(0);
    const row = await db.prepare(`SELECT img_prewarmed_at FROM lego_sets WHERE set_num='75192-1'`).first<{ img_prewarmed_at: string }>();
    expect(row!.img_prewarmed_at).toBeTruthy(); // still stamped so we don't re-hammer it
  });

  it('drains the minifig queue with leftover capacity and stamps minifigs', async () => {
    await db.prepare(`INSERT INTO minifigs (fig_num, name, image_url) VALUES ('fig-000123','Chewbacca','https://cdn.rebrickable.com/media/figs/fig-000123.jpg')`).run();
    const bucket = fakeBucket();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200, headers: { 'content-type': 'image/jpeg' } })));

    const r = await runImagePrewarm({ ...env, PHOTO_BUCKET: bucket } as any);
    expect(r).toMatchObject({ processed: 1, cached: 1, sets: 0, minifigs: 1 });
    const row = await db.prepare(`SELECT img_prewarmed_at FROM minifigs WHERE fig_num='fig-000123'`).first<{ img_prewarmed_at: string }>();
    expect(row!.img_prewarmed_at).toBeTruthy();
  });
});
