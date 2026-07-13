/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildPools, classifyFreeModel, runModelRefresh, OR_POOLS_KV_KEY } from './jobs/model-refresh';
import { MODELS, getOpenRouterPools, __resetOpenRouterPoolsCacheForTests } from './lib/llm';
import type { Env } from './types';

const testEnv = env as unknown as Env;

const model = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  context_length: 128_000,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  pricing: { prompt: '0', completion: '0' },
  ...over,
});
const visionModel = (id: string, over: Record<string, unknown> = {}) =>
  model(id, { architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, ...over });

afterEach(() => {
  vi.unstubAllGlobals();
  __resetOpenRouterPoolsCacheForTests();
});

describe('classifyFreeModel', () => {
  it('classifies free vision vs text models and rejects paid/special ones', () => {
    expect(classifyFreeModel(visionModel('a/b:free'))).toBe('vision');
    expect(classifyFreeModel(model('a/c:free'))).toBe('text');
    // Paid (non-zero pricing) — never auto-added.
    expect(classifyFreeModel(model('a/d:free', { pricing: { prompt: '0.0001', completion: '0' } }))).toBeNull();
    // Not a :free variant.
    expect(classifyFreeModel(model('a/e'))).toBeNull();
    // Special-purpose blocklist + tiny context.
    expect(classifyFreeModel(model('nvidia/nemotron-3.5-content-safety:free'))).toBeNull();
    expect(classifyFreeModel(model('a/small:free', { context_length: 4096 }))).toBeNull();
  });
});

describe('buildPools', () => {
  it('keeps listed curated models in order, drops vanished ones, appends discoveries', () => {
    const catalog = [
      // Curated vision: keep the first, "lose" the rest.
      visionModel(MODELS.scanOpenrouterVisionPool[0]),
      // Curated text: keep all three.
      ...MODELS.openrouterFreePool.map((id) => model(id)),
      // Discoverable extras.
      visionModel('new/vision-large:free', { context_length: 200_000 }),
      model('new/text-model:free'),
      // Noise that must not appear.
      model('paid/model'),
      visionModel('google/lyria-3-clip-preview:free'),
    ];
    const pools = buildPools(catalog as never);
    expect(pools.vision[0]).toBe(MODELS.scanOpenrouterVisionPool[0]);
    expect(pools.vision).toContain('new/vision-large:free');
    expect(pools.vision).not.toContain(MODELS.scanOpenrouterVisionPool[1]);
    expect(pools.text.slice(0, 3)).toEqual([...MODELS.openrouterFreePool]);
    expect(pools.text).toContain('new/text-model:free');
    expect(pools.missingCurated).toContain(MODELS.scanOpenrouterVisionPool[1]);
    expect(pools.vision.join()).not.toMatch(/lyria|paid/);
  });

  it('drops a curated model that lost its free pricing', () => {
    const catalog = [
      visionModel(MODELS.scanOpenrouterVisionPool[0], { pricing: { prompt: '0.0001', completion: '0.0002' } }),
    ];
    const pools = buildPools(catalog as never);
    expect(pools.vision).toHaveLength(0);
    expect(pools.missingCurated).toContain(MODELS.scanOpenrouterVisionPool[0]);
  });
});

describe('runModelRefresh + getOpenRouterPools', () => {
  it('publishes validated pools to KV and consumers read them', async () => {
    const catalog = Array.from({ length: 25 }, (_, i) => model(`filler/m${i}`)); // paid filler for the size floor
    catalog.push(visionModel(MODELS.scanOpenrouterVisionPool[0]), model(MODELS.openrouterFreePool[0]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: catalog }))));

    const out = await runModelRefresh(testEnv);
    expect(out).toMatchObject({ catalogSize: 27 });
    const stored = await testEnv.CACHE_KV!.get(OR_POOLS_KV_KEY, 'json') as { vision: string[]; text: string[] };
    expect(stored.vision).toEqual([MODELS.scanOpenrouterVisionPool[0]]);
    expect(stored.text).toEqual([MODELS.openrouterFreePool[0]]);

    const pools = await getOpenRouterPools(testEnv);
    expect(pools.vision).toEqual([MODELS.scanOpenrouterVisionPool[0]]);
    expect(pools.text).toEqual([MODELS.openrouterFreePool[0]]);
  });

  it('falls back to the curated constants when KV has no pools', async () => {
    await testEnv.CACHE_KV!.delete(OR_POOLS_KV_KEY);
    const pools = await getOpenRouterPools(testEnv);
    expect(pools.vision).toEqual([...MODELS.scanOpenrouterVisionPool]);
    expect(pools.text).toEqual([...MODELS.openrouterFreePool]);
  });

  it('keeps the last-good KV blob when the catalog response is broken', async () => {
    await testEnv.CACHE_KV!.put(OR_POOLS_KV_KEY, JSON.stringify({ vision: ['good/model:free'], text: [] }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    await expect(runModelRefresh(testEnv)).rejects.toThrow(/suspiciously small/);
    const stored = await testEnv.CACHE_KV!.get(OR_POOLS_KV_KEY, 'json') as { vision: string[] };
    expect(stored.vision).toEqual(['good/model:free']);
  });
});
