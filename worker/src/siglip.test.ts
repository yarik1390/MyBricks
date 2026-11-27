/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { collapseNearest, fuseCandidates, siglipSecondOpinion, SIGLIP_ACCEPT_MARGIN } from './lib/siglip';
import { MAX_VIEWS_PER_SET, runSiglipBackfill, viewVectorId } from './jobs/siglip-backfill';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const unit = (i: number) => { const v = Array(768).fill(0); v[i] = 1; return v; };

describe('fuseCandidates', () => {
  it('lets image similarity overturn a narrow Brickognize lead', () => {
    const fused = fuseCandidates(
      [{ id: '21325-1', score: 0.52 }, { id: '21341', score: 0.49 }],
      new Map([['21325-1', 0.55], ['21341-1', 0.9]]),
      [{ id: '21341-1', similarity: 0.9 }, { id: '10305-1', similarity: 0.6 }],
    )!;
    expect(fused.ranked[0].id).toBe('21341-1');
    expect(fused.ranked.map((c) => c.id)).toEqual(['21341-1', '21325-1', '10305-1']);
    expect(fused.margin).toBeGreaterThan(0.3);
  });

  it('keeps candidates without a catalog vector at the lowest similarity', () => {
    const fused = fuseCandidates([{ id: 'A-1', score: 0.5 }, { id: 'B-1', score: 0.3 }], new Map([['B-1', 0.8]]), [])!;
    expect(fused.ranked[0]).toMatchObject({ id: 'A-1', similarity: 0.8, score: 0.5 });
  });

  it('returns null without candidates or similarities', () => {
    expect(fuseCandidates([], new Map([['A-1', 0.5]]), [])).toBeNull();
    expect(fuseCandidates([{ id: 'A-1', score: 0.5 }], new Map(), [])).toBeNull();
  });
});

describe('siglipSecondOpinion', () => {
  const index = (stored: Record<string, number[]>, nearest: { id: string; score: number }[]) => ({
    getByIds: async (ids: string[]) => ids.filter((id) => stored[id]).map((id) => ({ id, values: stored[id] })),
    query: async () => ({ matches: nearest }),
  });

  it('accepts the fused winner only above the margin', async () => {
    const photo = unit(0);
    const close = { ...env, SIGLIP_INDEX: index({ 'A-1': unit(0), 'B-1': unit(1) }, [{ id: 'A-1', score: 1 }]) } as any;
    const sure = await siglipSecondOpinion(close, photo, [{ id: 'B-1', name: 'B', type: 'set', score: 0.55 }, { id: 'A-1', name: 'A', type: 'set', score: 0.5 }]);
    expect(sure!.accepted?.id).toBe('A-1');
    expect(sure!.margin).toBeGreaterThanOrEqual(SIGLIP_ACCEPT_MARGIN);

    const unsure = await siglipSecondOpinion(
      { ...env, SIGLIP_INDEX: index({ 'A-1': unit(1), 'B-1': unit(1) }, []) } as any,
      photo,
      [{ id: 'B-1', name: 'B', type: 'set', score: 0.55 }, { id: 'A-1', name: 'A', type: 'set', score: 0.5 }],
    );
    expect(unsure!.accepted).toBeNull();
  });
});

describe('extra official views', () => {
  const index = (stored: Record<string, number[]>, nearest: { id: string; score: number }[]) => ({
    getByIds: async (ids: string[]) => {
      if (ids.length > 20) throw new Error('getByIds takes at most 20 ids');
      return ids.filter((id) => stored[id]).map((id) => ({ id, values: stored[id] }));
    },
    query: async () => ({ matches: nearest }),
  });
  const preds = [{ id: 'B-1', name: 'B', type: 'set', score: 0.55 }, { id: 'A-1', name: 'A', type: 'set', score: 0.5 }];

  beforeEach(async () => {
    await applyTestTables(db, ['siglip_view_embeddings']);
    await db.prepare("INSERT INTO siglip_view_embeddings (url, set_num, vec_id, source) VALUES ('https://x/a-back.jpg', 'A-1', 'A-1#back', 'lego.com')").run();
  });

  it('collapses nearest vectors to the best one per set', () => {
    expect(collapseNearest([{ id: 'A-1#x', score: 0.9 }, { id: 'A-1', score: 0.5 }, { id: 'B-1', score: 0.7 }]))
      .toEqual([{ id: 'A-1', similarity: 0.9 }, { id: 'B-1', similarity: 0.7 }]);
    expect(collapseNearest([{ id: 'A-1#x', score: 0.9 }, { id: 'B-1', score: 0.7 }], false)).toEqual([{ id: 'B-1', similarity: 0.7 }]);
  });

  it('a matching extra view (box back) lets the right set win; SIGLIP_VIEWS=0 ignores it', async () => {
    const photo = unit(2);
    const stored = { 'A-1': unit(1), 'B-1': unit(1), 'A-1#back': unit(2) };
    const nearest = [{ id: 'A-1#back', score: 1 }];
    const on = await siglipSecondOpinion({ ...env, SIGLIP_INDEX: index(stored, nearest) } as any, photo, preds);
    expect(on!.accepted?.id).toBe('A-1');
    const off = await siglipSecondOpinion({ ...env, SIGLIP_VIEWS: '0', SIGLIP_INDEX: index(stored, nearest) } as any, photo, preds);
    expect(off!.accepted).toBeNull();
    expect(off!.ranked.every((c) => !c.id.includes('#'))).toBe(true);
  });

  it('fetches many view vectors in chunks of 20', async () => {
    for (let i = 0; i < 30; i++) {
      await db.prepare("INSERT INTO siglip_view_embeddings (url, set_num, vec_id, source) VALUES (?, 'B-1', ?, 'brickset')").bind(`https://x/b${i}.jpg`, `B-1#${i}`).run();
    }
    const res = await siglipSecondOpinion({ ...env, SIGLIP_INDEX: index({ 'A-1': unit(0), 'B-1': unit(1) }, []) } as any, unit(0), preds);
    expect(res!.ranked[0].id).toBe('A-1');
  });

  it('view ids stay short and stable', async () => {
    const id = await viewVectorId('75192-1', 'https://www.lego.com/cdn/x.png');
    expect(id).toMatch(/^75192-1#[0-9a-f]{10}$/);
    expect(await viewVectorId('75192-1', 'https://www.lego.com/cdn/x.png')).toBe(id);
  });
});

describe('siglip-backfill', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'siglip_embeddings']);
    for (let i = 0; i < 5; i++) {
      await db.prepare('INSERT INTO lego_sets (set_num, name, year, image_url) VALUES (?, ?, 2024, ?)')
        .bind(`S${i}-1`, `Set ${i}`, i === 0 ? null : `https://cdn.rebrickable.com/media/sets/S${i}-1.jpg`).run();
    }
  });

  function fakes(failUrl?: string) {
    const calls: string[][] = [];
    const upserted: string[] = [];
    return {
      calls, upserted,
      env: {
        ...(env as any),
        SIGLIP: {
          fetch: async (_u: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            calls.push(body.urls);
            return Response.json({ vectors: body.urls.map((u: string) => (u === failUrl ? null : unit(0))) });
          },
        },
        SIGLIP_INDEX: { upsert: async (v: { id: string }[]) => { upserted.push(...v.map((x) => x.id)); return { count: v.length }; } },
      },
    };
  }

  it('embeds every set photo once and records failures', async () => {
    const f = fakes('https://cdn.rebrickable.com/media/sets/S2-1.jpg');
    expect(await runSiglipBackfill(f.env, { batch: 2, concurrency: 1 })).toMatchObject({ picked: 5, embedded: 4, noImage: 1, failedBatches: 0 });
    // A set without image_url falls back to the Rebrickable CDN path.
    expect(f.calls.flat()).toContain('https://cdn.rebrickable.com/media/sets/S0-1.jpg');
    expect(f.upserted.sort()).toEqual(['S0-1', 'S1-1', 'S3-1', 'S4-1']);
    const failed = await db.prepare('SELECT set_num FROM siglip_embeddings WHERE ok = 0').all<{ set_num: string }>();
    expect(failed.results.map((r) => r.set_num)).toEqual(['S2-1']);

    const g = fakes();
    expect(await runSiglipBackfill(g.env)).toMatchObject({ picked: 0, embedded: 0 });
    expect(g.calls).toEqual([]);
  });

  it('then embeds extra official views, capped per set, skipping the catalog photo', async () => {
    await applyTestTables(db, ['training_images', 'siglip_view_embeddings']);
    await db.prepare("UPDATE lego_sets SET brickset_image_urls = ? WHERE set_num = 'S1-1'")
      .bind(JSON.stringify(['https://images.brickset.com/sets/AdditionalImages/S1-1/a.jpg', 'https://cdn.rebrickable.com/media/sets/S1-1.jpg'])).run();
    for (let i = 0; i < MAX_VIEWS_PER_SET + 3; i++) {
      await db.prepare("INSERT INTO training_images (set_num, url, source) VALUES ('S3-1', ?, 'lego.com')").bind(`https://www.lego.com/cdn/S3/${i}.png`).run();
    }
    await db.prepare("INSERT INTO training_images (set_num, url, source) VALUES ('S4-1', 'https://live.staticflickr.com/cc.jpg', 'openverse')").run();
    const f = fakes('https://www.lego.com/cdn/S3/0.png');
    const out = await runSiglipBackfill(f.env, { batch: 4, concurrency: 1 }) as any;
    expect(out.views).toMatchObject({ picked: 1 + MAX_VIEWS_PER_SET, embedded: MAX_VIEWS_PER_SET, failed: 1 });
    // Creative Commons photos are not catalog views; the catalog photo is not embedded twice.
    expect(f.calls.flat()).not.toContain('https://live.staticflickr.com/cc.jpg');
    expect(f.calls.flat().filter((u) => u === 'https://cdn.rebrickable.com/media/sets/S1-1.jpg')).toHaveLength(1);
    expect(f.upserted.filter((id) => id.includes('#'))).toHaveLength(MAX_VIEWS_PER_SET);

    const g = fakes();
    expect((await runSiglipBackfill(g.env) as any).views).toMatchObject({ picked: 0 });
  });

  it('skips cleanly without the bindings', async () => {
    expect(await runSiglipBackfill({ ...(env as any), SIGLIP: undefined })).toEqual({ skipped: 'no SIGLIP binding or SIGLIP_INDEX' });
  });
});
