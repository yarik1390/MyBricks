/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertOmniRouteHeaders,
  omniRouteBaseURL,
  omniRouteClient,
  OMNIROUTE_SCAN_COMBO,
} from './lib/omniroute';
import { openAiCompatibleStep } from './lib/llm-clients';
import { openaiVisionDescribe } from './routes/scan';

const env = (extra: Record<string, string> = {}) => ({
  OMNIROUTE_API_KEY: 'test-only-key',
  OMNIROUTE_BASE_URL: 'https://omniroute.test/v1',
  ...extra,
}) as any;

const goodHeaders = () => new Headers({
  'x-omniroute-provider': 'openrouter',
  'x-omniroute-model': 'google/gemini-3.5-flash-lite',
  'x-omniroute-cache-hit': 'false',
});

const validBody = JSON.stringify({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1,
  model: 'google/gemini-3.5-flash-lite',
  choices: [{
    index: 0,
    finish_reason: 'stop',
    message: {
      role: 'assistant',
      content: JSON.stringify({
        image_class: 'lego',
        sets: [{
          set_num: '75192', name: 'Millennium Falcon', theme: 'Star Wars', year: 2017,
          confidence: 'high', reasoning: 'Visible UCS box',
        }],
        minifigs: [],
      }),
    },
  }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
});

afterEach(() => vi.unstubAllGlobals());

describe('OmniRoute scan route', () => {
  it('routes the scan step through the dedicated scan-vision combo, disables cache, and performs no SDK retries', async () => {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(validBody, { status: 200, headers: { ...Object.fromEntries(goodHeaders()), 'content-type': 'application/json' } });
    }));

    const step = await openAiCompatibleStep(env(), {
      provider: 'omniroute', model: OMNIROUTE_SCAN_COMBO, enabled: true,
    }, {});
    expect(step.models).toEqual([OMNIROUTE_SCAN_COMBO]);
    const result = await openaiVisionDescribe(step.client!, step.models[0], 'data:image/jpeg;base64,AA==', {}, 1_000);

    expect(result.parsed).toBe(true);
    expect(result.sets[0]?.set_num).toBe('75192');
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('x-omniroute-no-cache')).toBe('true');
    const sent = await requests[0].clone().json() as Record<string, unknown>;
    expect(sent.model).toBe(OMNIROUTE_SCAN_COMBO);
    expect(sent.stream).toBe(false);
    expect(sent.temperature).toBe(0);
  });

  it.each([
    ['missing provider header', { 'x-omniroute-model': 'google/gemini-3.5-flash-lite', 'x-omniroute-cache-hit': 'false' }],
    ['missing model header', { 'x-omniroute-provider': 'openrouter', 'x-omniroute-cache-hit': 'false' }],
    ['cache hit', { 'x-omniroute-provider': 'openrouter', 'x-omniroute-model': 'google/gemini-3.5-flash-lite', 'x-omniroute-cache-hit': 'true' }],
    ['missing headers', {}],
  ])('rejects %s instead of silently accepting a synthetic answer', (_name, values) => {
    expect(() => assertOmniRouteHeaders(new Headers(values))).toThrow(/OmniRoute/);
  });

  it('accepts any measured combo leg: OpenRouter anchor or Antigravity subscription lane', () => {
    expect(() => assertOmniRouteHeaders(new Headers({
      'x-omniroute-provider': 'openrouter',
      'x-omniroute-model': 'google/gemini-3.5-flash-lite',
      'x-omniroute-cache-hit': 'false',
    }))).not.toThrow();
    expect(() => assertOmniRouteHeaders(new Headers({
      'x-omniroute-provider': 'antigravity',
      'x-omniroute-model': 'gemini-3.5-flash-lite',
      'x-omniroute-cache-hit': 'false',
    }))).not.toThrow();
  });

  it('rejects an insecure remote endpoint override', () => {
    expect(() => omniRouteBaseURL(env({ OMNIROUTE_BASE_URL: 'http://example.com/v1' }))).toThrow(/HTTPS/);
  });

  it('treats capacity failure as a provider error without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), {
      status: 429, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = omniRouteClient(env())!;
    await expect(openaiVisionDescribe(client, OMNIROUTE_SCAN_COMBO, 'data:image/jpeg;base64,AA==', {}, 1_000)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed 200 output so the cascade can fall through', async () => {
    const malformed = JSON.parse(validBody);
    malformed.choices[0].message.content = JSON.stringify({
      image_class: 'lego',
      sets: [{ set_num: 75192, name: 'Millennium Falcon', confidence: 'certain' }],
      minifigs: [],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(malformed), {
      status: 200, headers: { ...Object.fromEntries(goodHeaders()), 'content-type': 'application/json' },
    })));
    const result = await openaiVisionDescribe(omniRouteClient(env())!, OMNIROUTE_SCAN_COMBO, 'data:image/jpeg;base64,AA==', {}, 1_000);
    expect(result).toMatchObject({ parsed: false, sets: [], minifigs: [], imageClass: 'uncertain' });
  });

  it('enforces the bounded timeout without issuing another request', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(openaiVisionDescribe(
      omniRouteClient(env())!, OMNIROUTE_SCAN_COMBO, 'data:image/jpeg;base64,AA==', {}, 20,
    )).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
