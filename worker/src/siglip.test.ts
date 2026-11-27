/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { fuseCandidates, siglipSecondOpinion, SIGLIP_ACCEPT_MARGIN } from './lib/siglip';
import { runSiglipBackfill } from './jobs/siglip-backfill';
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

  it('skips cleanly without the bindings', async () => {
    expect(await runSiglipBackfill({ ...(env as any), SIGLIP: undefined })).toEqual({ skipped: 'no SIGLIP binding or SIGLIP_INDEX' });
  });
});
