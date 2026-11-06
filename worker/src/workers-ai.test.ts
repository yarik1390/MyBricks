/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { workersAiClient, normalizeWorkersAiResponse, isFreeWorkersAiModel, WORKERS_AI_SCAN_MODEL } from './lib/workers-ai';
import { QUOTA_CAPS, quotaDay } from './lib/api-quota';

const db = (env as any).DB as D1Database;

function fakeAi(reply: unknown) {
  const calls: Array<{ model: string; input: any; options: any }> = [];
  return {
    calls,
    binding: { run: async (model: string, input: any, options: any) => { calls.push({ model, input, options }); return reply; } },
  };
}

const params = (model = WORKERS_AI_SCAN_MODEL) => ({
  model,
  max_tokens: 400,
  temperature: 0,
  messages: [{ role: 'user' as const, content: 'hi' }],
});

describe('workers-ai free scan step', () => {
  beforeEach(async () => {
    await db.prepare('DROP TABLE IF EXISTS api_quota').run();
    await db.prepare(`CREATE TABLE api_quota (service TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
      cap INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (service, day))`).run();
  });

  it('is unavailable without the AI binding', () => {
    expect(workersAiClient({ ...(env as any), AI: undefined })).toBeNull();
  });

  it('only allows Cloudflare-hosted @cf/ models, never billed third-party ones', async () => {
    expect(isFreeWorkersAiModel('@cf/google/gemma-4-26b-a4b-it')).toBe(true);
    expect(isFreeWorkersAiModel('openai/gpt-5')).toBe(false);
    const ai = fakeAi({ choices: [] });
    const client = workersAiClient({ ...(env as any), AI: ai.binding })!;
    await expect(client.chat.completions.create(params('openai/gpt-5') as any)).rejects.toThrow(/not a free/);
    expect(ai.calls).toHaveLength(0);
  });

  it('runs the model with thinking off and rejectIfBusy, returning chat.completion shape', async () => {
    const ai = fakeAi({ choices: [{ index: 0, message: { role: 'assistant', content: '{"sets":[]}' } }] });
    const client = workersAiClient({ ...(env as any), AI: ai.binding })!;
    const out = await client.chat.completions.create(params() as any);
    expect(out.choices[0].message.content).toBe('{"sets":[]}');
    expect(ai.calls[0].model).toBe(WORKERS_AI_SCAN_MODEL);
    expect(ai.calls[0].input.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(ai.calls[0].options).toEqual({ rejectIfBusy: true });
  });

  it('stops at the daily cap so the step never leaves the free allocation', async () => {
    const cap = QUOTA_CAPS.workersai;
    expect(cap).toBeGreaterThan(0);
    await db.prepare('INSERT INTO api_quota (service, day, used, cap) VALUES (?, ?, ?, ?)')
      .bind('workersai', quotaDay(), cap, cap).run();
    const ai = fakeAi({ choices: [] });
    const client = workersAiClient({ ...(env as any), AI: ai.binding })!;
    await expect(client.chat.completions.create(params() as any)).rejects.toThrow(/daily free allowance/);
    expect(ai.calls).toHaveLength(0);
  });

  it('normalizes the older { response } shape', () => {
    expect(normalizeWorkersAiResponse({ response: 'ok' }).choices[0].message.content).toBe('ok');
    expect(normalizeWorkersAiResponse({ response: { a: 1 } }).choices[0].message.content).toBe('{"a":1}');
  });
});
