/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { openaiVisionDescribe } from './routes/scan';

const completion = (content: unknown) => JSON.stringify({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1,
  model: 'test',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

function stubCompletion(content: unknown) {
  const sent: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(await new Request(input, init).json() as Record<string, unknown>);
    return new Response(completion(content), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
  return sent;
}

const client = () => new OpenAI({ apiKey: 'test', baseURL: 'https://llm.test/v1', maxRetries: 0,
  // Late-bound so each test's stubbed fetch is the one used.
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) });
const IMAGE = 'data:image/jpeg;base64,AA==';

afterEach(() => vi.unstubAllGlobals());

describe('openaiVisionDescribe', () => {
  it('accepts a shelf answer without image_class and keeps the valid rows', async () => {
    stubCompletion({
      sets: [
        { set_num: '10276', name: 'Colosseum', theme: 'Icons', year: 2020, confidence: 'high', reasoning: 'Box art', box: [1, 2, 3, 4] },
        { set_num: '60337', name: 'Express Passenger Train', theme: 'City', year: 2022, confidence: 'medium', reasoning: 'Box art' },
        { name: 'Jaguar E-Type', confidence: 'very high' },
      ],
      minifigs: [],
    });
    const r = await openaiVisionDescribe(client(), 'google/gemini-3.5-flash-lite', IMAGE, {}, 1_000);
    expect(r.parsed).toBe(true);
    expect(r.imageClass).toBe('lego');
    expect(r.sets.map((s) => s.set_num)).toEqual(['10276', '60337']);
  });

  it('does not send tool_choice to OpenAI models, which reject it without tools', async () => {
    const sent = stubCompletion({ image_class: 'uncertain', sets: [], minifigs: [] });
    await openaiVisionDescribe(client(), 'openai/gpt-4o', IMAGE, {}, 1_000);
    await openaiVisionDescribe(client(), 'gpt-4o-mini', IMAGE, {}, 1_000);
    await openaiVisionDescribe(client(), 'google/gemini-3.5-flash-lite', IMAGE, {}, 1_000);
    expect(sent[0]).not.toHaveProperty('tool_choice');
    expect(sent[1]).not.toHaveProperty('tool_choice');
    expect(sent[2].tool_choice).toBe('none');
  });

  it('still rejects an answer with no usable rows', async () => {
    stubCompletion({ sets: [{ set_num: 75192, name: 'Millennium Falcon', confidence: 'certain' }], minifigs: [] });
    const r = await openaiVisionDescribe(client(), 'google/gemini-3.5-flash-lite', IMAGE, {}, 1_000);
    expect(r).toMatchObject({ parsed: false, sets: [] });
  });
});
