/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identifySetWithBrickognize, resetBrickognizeCircuitForTests } from './lib/brickognize';

const IMAGE_A = `data:image/jpeg;base64,${btoa('brickognize-fixture-a')}`;
const IMAGE_B = `data:image/jpeg;base64,${btoa('brickognize-fixture-b')}`;
const IMAGE_C = `data:image/jpeg;base64,${btoa('brickognize-fixture-c')}`;
const IMAGE_D = `data:image/jpeg;base64,${btoa('brickognize-fixture-d')}`;

function response(items: unknown, status = 200): Response {
  return new Response(JSON.stringify({ listing_id: 'test', bounding_box: {}, items }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Brickognize recognition gates', () => {
  beforeEach(() => {
    resetBrickognizeCircuitForTests();
    (env as any).BRICKOGNIZE_ENABLED = '1';
    (env as any).CACHE_KV = undefined;
    vi.restoreAllMocks();
  });

  it('accepts a strong set result with a clear top-result margin', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(response([
      { id: '75192-1', name: 'Millennium Falcon', type: 'set', score: 0.82 },
      { id: '10179-1', name: 'Millennium Falcon', type: 'set', score: 0.56 },
    ])) as typeof fetch;

    await expect(identifySetWithBrickognize(env as any, IMAGE_A)).resolves.toMatchObject({
      kind: 'accepted', top: { id: '75192-1' }, cached: false,
    });
  });

  it('falls back for low-confidence and ambiguous predictions', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(response([
        { id: '75192-1', name: 'Millennium Falcon', type: 'set', score: 0.74 },
      ]))
      .mockResolvedValueOnce(response([
        { id: '75192-1', name: 'Millennium Falcon', type: 'set', score: 0.82 },
        { id: '10179-1', name: 'Millennium Falcon', type: 'set', score: 0.76 },
      ])) as typeof fetch;

    await expect(identifySetWithBrickognize(env as any, IMAGE_A)).resolves.toMatchObject({ kind: 'fallback', reason: 'low_confidence' });
    await expect(identifySetWithBrickognize(env as any, IMAGE_B)).resolves.toMatchObject({ kind: 'fallback', reason: 'ambiguous' });
  });

  it('fails open to the AI cascade on provider errors and opens its circuit', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('down', { status: 503 })) as typeof fetch;

    for (const image of [IMAGE_A, IMAGE_B, IMAGE_C]) {
      await expect(identifySetWithBrickognize(env as any, image)).resolves.toMatchObject({
        kind: 'error', reason: 'provider_error',
      });
    }
    await expect(identifySetWithBrickognize(env as any, IMAGE_D)).resolves.toMatchObject({
      kind: 'fallback', reason: 'circuit_open',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not call the public API when the emergency rollback is enabled', async () => {
    (env as any).BRICKOGNIZE_ENABLED = '0';
    globalThis.fetch = vi.fn() as typeof fetch;
    await expect(identifySetWithBrickognize(env as any, IMAGE_A)).resolves.toMatchObject({
      kind: 'fallback', reason: 'disabled',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
