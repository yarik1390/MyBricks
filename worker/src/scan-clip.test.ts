/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLIP_MARGIN_MIN,
  CLIP_SCORE_MIN,
  clipVectorId,
  collapseBySetNum,
  identifySetWithClip,
  inspectClipMatches,
  inspectClipRanks,
  setNumFromClipId,
} from './lib/scan-clip';
import { CLIP_DIM, resetClipCircuitForTests, validClipVector } from './lib/clip-embed';
import { isOfficialCatalogImageUrl, officialCatalogViews } from './lib/clip-images';

const IMAGE = `data:image/jpeg;base64,${btoa('clip-fixture-query')}`;

function seededVector(seed: number, dim = CLIP_DIM): number[] {
  const values = Array.from({ length: dim }, (_, i) => Math.sin((i + 1) * (seed + 0.17)));
  const mag = Math.sqrt(values.reduce((s, x) => s + x * x, 0));
  return values.map((x) => x / mag);
}

function installClip(matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>, vector = seededVector(1)) {
  (env as any).CLIP_ENABLED = '1';
  (env as any).CLIP_EMBED_URL = undefined;
  (env as any).CLIP_EMBED = {
    fetch: async () => new Response(JSON.stringify({ vector, dim: CLIP_DIM, model: 'mobileclip-s2' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  };
  (env as any).SET_CLIP = {
    query: async () => ({ matches }),
    upsert: async () => ({ mutationId: 'test' }),
  };
}

describe('CLIP ranking / collapse-by-set_num', () => {
  it('uses Brickognize-equivalent accept and margin gates', () => {
    expect(CLIP_SCORE_MIN).toBe(0.75);
    expect(CLIP_MARGIN_MIN).toBe(0.10);
  });

  it('collapses multiple views of the same set to one ranked row', () => {
    const ranked = collapseBySetNum([
      { id: clipVectorId('75192-1', 'official'), score: 0.91, metadata: { set_num: '75192-1', view: 'official' } },
      { id: clipVectorId('75192-1', 'brickset-0'), score: 0.88, metadata: { set_num: '75192-1', view: 'brickset-0' } },
      { id: clipVectorId('10179-1', 'official'), score: 0.62, metadata: { set_num: '10179-1', view: 'official' } },
    ]);
    expect(ranked.map((row) => row.setNum)).toEqual(['75192-1', '10179-1']);
    expect(ranked[0].score).toBe(0.91);
    expect(inspectClipRanks(ranked, false).kind).toBe('accepted');
  });

  it('does not treat two views of the same set as ambiguous', () => {
    const outcome = inspectClipMatches([
      { id: 'clip:v1:75313-1:official', score: 0.86, metadata: { set_num: '75313-1' } },
      { id: 'clip:v1:75313-1:brickset-0', score: 0.84, metadata: { set_num: '75313-1' } },
    ], false);
    expect(outcome).toMatchObject({ kind: 'accepted', top: { setNum: '75313-1' } });
  });

  it('falls through on low confidence and close scores across different sets', () => {
    expect(inspectClipMatches([
      { id: 'clip:v1:75192-1:official', score: 0.74, metadata: { set_num: '75192-1' } },
    ], false)).toMatchObject({ kind: 'fallback', reason: 'low_confidence' });

    expect(inspectClipMatches([
      { id: 'clip:v1:75192-1:official', score: 0.88, metadata: { set_num: '75192-1' } },
      { id: 'clip:v1:10179-1:official', score: 0.80, metadata: { set_num: '10179-1' } },
    ], false)).toMatchObject({ kind: 'fallback', reason: 'ambiguous' });
  });

  it('parses set_num from vector ids when metadata is missing', () => {
    expect(setNumFromClipId('clip:v1:75192-1:official')).toBe('75192-1');
    expect(setNumFromClipId('x', { set_num: '75313-1' })).toBe('75313-1');
  });
});

describe('official catalog image allowlist', () => {
  it('accepts Rebrickable set shots and stored Brickset URLs, never BrickLink or MOCs', () => {
    expect(isOfficialCatalogImageUrl('https://cdn.rebrickable.com/media/sets/75192-1.jpg')).toBe(true);
    expect(isOfficialCatalogImageUrl('https://images.brickset.com/sets/images/75192-1.jpg')).toBe(true);
    expect(isOfficialCatalogImageUrl('https://img.bricklink.com/ItemImage/SN/0/75192-1.png')).toBe(false);
    expect(isOfficialCatalogImageUrl('https://cdn.rebrickable.com/media/mocs/moc.jpg')).toBe(false);
    expect(officialCatalogViews({
      set_num: '75192-1',
      image_url: 'https://cdn.rebrickable.com/media/sets/75192-1.jpg',
      brickset_image_urls: JSON.stringify([
        'https://images.brickset.com/sets/images/75192-1.jpg',
        'https://images.brickset.com/sets/additional/75192-1-2.jpg',
        'https://img.bricklink.com/nope.png',
      ]),
    }).map((v) => v.view)).toEqual(['official', 'brickset-0', 'brickset-1']);
  });
});

describe('identifySetWithClip (mocked Vectorize + embedder)', () => {
  beforeEach(() => {
    resetClipCircuitForTests();
    (env as any).CACHE_KV = undefined;
    (env as any).CLIP_EMBED = undefined;
    (env as any).CLIP_EMBED_URL = undefined;
    (env as any).CLIP_ENABLED = '1';
  });

  it('accepts a unique high-confidence visual match', async () => {
    installClip([
      { id: clipVectorId('75192-1', 'official'), score: 0.92, metadata: { set_num: '75192-1', view: 'official' } },
      { id: clipVectorId('10179-1', 'official'), score: 0.55, metadata: { set_num: '10179-1', view: 'official' } },
    ]);
    await expect(identifySetWithClip(env as any, IMAGE)).resolves.toMatchObject({
      kind: 'accepted',
      top: { setNum: '75192-1' },
      cached: false,
    });
  });

  it('falls through when the embedder is unbound', async () => {
    (env as any).SET_CLIP = { query: async () => ({ matches: [] }), upsert: async () => ({}) };
    (env as any).CLIP_EMBED = undefined;
    await expect(identifySetWithClip(env as any, IMAGE)).resolves.toMatchObject({
      kind: 'fallback', reason: 'unconfigured',
    });
  });

  it('falls through on embed failure and unsupported images', async () => {
    (env as any).CLIP_ENABLED = '1';
    (env as any).CLIP_EMBED = {
      fetch: async () => new Response('nope', { status: 503 }),
    };
    (env as any).SET_CLIP = { query: async () => ({ matches: [] }), upsert: async () => ({}) };
    await expect(identifySetWithClip(env as any, IMAGE)).resolves.toMatchObject({
      kind: 'error', reason: 'embed_failed',
    });
    await expect(identifySetWithClip(env as any, 'not-an-image')).resolves.toMatchObject({
      kind: 'fallback', reason: 'unsupported_image',
    });
  });

  it('falls through when Vectorize returns an empty neighbor list', async () => {
    installClip([]);
    await expect(identifySetWithClip(env as any, IMAGE)).resolves.toMatchObject({
      kind: 'fallback', reason: 'empty',
    });
  });

  it('rejects a vector that is not 512-d', () => {
    expect(validClipVector(seededVector(1, 256))).toBe(false);
    expect(validClipVector(seededVector(1, 512))).toBe(true);
  });
});
