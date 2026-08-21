/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, expect, it, vi } from 'vitest';
import {
  callPatewayEconomyScan,
  estimatePatewayEconomyCostUsd,
  patewaySetAgreement,
  shouldVerifyWithPatewayEconomy,
} from './lib/pateway';

const tinyJpeg = 'data:image/jpeg;base64,AA==';

describe('Pateway Economy scan verifier', () => {
  it('uses the Responses vision protocol and parses nested output text', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'gpt-5.6-luna',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        sets: [{ set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: 'Distinctive UCS model.' }],
        minifigs: [],
      }) }] }],
      usage: { input_tokens: 951, input_tokens_details: { cached_tokens: 0 }, output_tokens: 50 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const result = await callPatewayEconomyScan(tinyJpeg, 'sk-test', { fetcher, timeoutMs: 8_000 });

    expect(result.sets[0]?.set_num).toBe('75192');
    expect(result.usage?.input_tokens).toBe(951);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://api.pateway.ai/v1/responses');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-test', 'content-type': 'application/json' });
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe('gpt-5.6-luna');
    expect(body.max_output_tokens).toBeGreaterThanOrEqual(300);
    expect(body.input[0].content.map((part: { type: string }) => part.type)).toEqual(['input_text', 'input_image']);
  });

  it('bounds the request with an abort signal and does not retry failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('temporarily unavailable', { status: 502 }));
    await expect(callPatewayEconomyScan(tinyJpeg, 'sk-test', { fetcher, timeoutMs: 25 })).rejects.toThrow('HTTP 502');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects empty credentials without making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(callPatewayEconomyScan(tinyJpeg, ' ', { fetcher })).rejects.toThrow('not configured');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('estimates current Economy Luna token cost including cached input', () => {
    expect(estimatePatewayEconomyCostUsd({
      input_tokens: 4_000,
      input_tokens_details: { cached_tokens: 3_000 },
      output_tokens: 100,
    })).toBeCloseTo(0.000019, 9);
  });

  it('only schedules a bounded single-set background verification', () => {
    expect(shouldVerifyWithPatewayEconomy(false, [{ set_num: '75192-1' }], 'sk-test')).toBe(true);
    expect(shouldVerifyWithPatewayEconomy(true, [{ set_num: '75192-1' }], 'sk-test')).toBe(false);
    expect(shouldVerifyWithPatewayEconomy(false, [{ set_num: '75192-1' }, { set_num: '10307-1' }], 'sk-test')).toBe(false);
    expect(shouldVerifyWithPatewayEconomy(false, [{ set_num: '75192-1' }], '')).toBe(false);
  });

  it('requires the Economy answer to resolve to the same catalog set', async () => {
    const catalogRows = [
      { set_num: '75192-1', name: 'Millennium Falcon', year: 2017, theme_id: 158 },
      { set_num: '10305-1', name: 'Lion Knights Castle', year: 2022, theme_id: 186 },
    ];
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({ results: catalogRows }),
            first: vi.fn().mockResolvedValue(null),
          })),
        })),
      },
    } as never;

    await expect(patewaySetAgreement(env, '75192-1', [{
      set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: 'UCS ship',
    }])).resolves.toBe(true);
    await expect(patewaySetAgreement(env, '75192-1', [{
      set_num: '10305', name: 'Lion Knights Castle', confidence: 'high', reasoning: 'castle',
    }])).resolves.toBe(false);
  });
});
