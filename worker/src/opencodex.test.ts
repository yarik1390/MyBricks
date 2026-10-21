/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  openCodexBaseURL,
  openCodexClient,
  openCodexConfigured,
  openCodexModels,
  OPENCODEX_SCAN_COMBO,
  OPENCODEX_SHELF_COMBO,
} from './lib/opencodex';
import { openAiCompatibleStep } from './lib/llm-clients';
import { openaiVisionDescribe } from './routes/scan';

const env = (extra: Record<string, string> = {}) => ({
  OPENCODEX_API_KEY: 'test-only-key',
  OPENCODEX_BASE_URL: 'https://opencodex.test/v1',
  CF_ACCESS_CLIENT_ID: 'cf-id-123',
  CF_ACCESS_CLIENT_SECRET: 'cf-secret-456',
  ...extra,
}) as any;

const validBody = JSON.stringify({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1,
  model: 'brickvault-scan-vision',
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

describe('OpenCodex scan route', () => {
  it('routes the scan step through the dedicated scan-vision combo, sets CF Access headers, and performs no SDK retries', async () => {
    const requests: Request[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(validBody, { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    const step = await openAiCompatibleStep(env(), {
      provider: 'opencodex', model: OPENCODEX_SCAN_COMBO, enabled: true,
    }, {});
    expect(step.models).toEqual([OPENCODEX_SCAN_COMBO]);
    const result = await openaiVisionDescribe(step.client!, step.models[0], 'data:image/jpeg;base64,AA==', {}, 1_000);

    expect(result.parsed).toBe(true);
    expect(result.sets[0]?.set_num).toBe('75192');
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get('x-opencodex-no-cache')).toBe('true');
    expect(requests[0].headers.get('cf-access-client-id')).toBe('cf-id-123');
    expect(requests[0].headers.get('cf-access-client-secret')).toBe('cf-secret-456');
    const sent = await requests[0].clone().json() as Record<string, unknown>;
    expect(sent.model).toBe(OPENCODEX_SCAN_COMBO);
    expect(sent.stream).toBe(false);
    expect(sent.temperature).toBe(0);
    expect(sent.tool_choice).toBe('none');
    expect(sent.reasoning_effort).toBe('low');
  });

  it('safely rejects an insecure HTTP remote endpoint override without throwing', () => {
    expect(openCodexBaseURL(env({ OPENCODEX_BASE_URL: 'http://example.com/v1' }))).toBeNull();
    expect(openCodexConfigured(env({ OPENCODEX_BASE_URL: 'http://example.com/v1' }))).toBe(false);
    expect(openCodexClient(env({ OPENCODEX_BASE_URL: 'http://example.com/v1' }))).toBeNull();
  });

  it('allows localhost or 127.0.0.1 for local dev', () => {
    expect(openCodexBaseURL(env({ OPENCODEX_BASE_URL: 'http://127.0.0.1:10100/v1' }))).toBe('http://127.0.0.1:10100/v1');
  });

  it('treats capacity failure as a provider error without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota exhausted' } }), {
      status: 429, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = openCodexClient(env())!;
    await expect(openaiVisionDescribe(client, OPENCODEX_SCAN_COMBO, 'data:image/jpeg;base64,AA==', {}, 1_000)).rejects.toMatchObject({ status: 429 });
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
      status: 200, headers: { 'content-type': 'application/json' },
    })));
    const result = await openaiVisionDescribe(openCodexClient(env())!, OPENCODEX_SCAN_COMBO, 'data:image/jpeg;base64,AA==', {}, 1_000);
    expect(result).toMatchObject({ parsed: false, sets: [], minifigs: [], imageClass: 'uncertain' });
  });

  it('enforces the bounded timeout without issuing another request', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(openaiVisionDescribe(
      openCodexClient(env())!, OPENCODEX_SCAN_COMBO, 'data:image/jpeg;base64,AA==', {}, 20,
    )).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes both scan and shelf combos in openCodexModels', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: 'gpt-6-luna' }, { id: 'anthropic/claude-sonnet-5-5' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const models = await openCodexModels(env());
    expect(models).toContain(OPENCODEX_SCAN_COMBO);
    expect(models).toContain(OPENCODEX_SHELF_COMBO);
  });
});
