import type OpenAI from 'openai';
import type { Env } from '../types';
import { spendQuotaFailClosed } from './api-quota';

/**
 * Cloudflare Workers AI as a FREE scan step.
 *
 * The account gets 10,000 Neurons a day at no charge on the Workers plan we
 * already pay. A Gemma 4 photo scan is roughly 15-35 Neurons, so the daily
 * `workersai` api_quota cap (see QUOTA_CAPS) keeps us inside the free
 * allocation; past it the step is skipped, never billed.
 *
 * Only Cloudflare-hosted `@cf/` models are allowed. The same binding can also
 * reach third-party models (openai/..., anthropic/...) that ARE billed, so a
 * stored admin route naming one of those is refused here rather than trusted.
 */
export const WORKERS_AI_SCAN_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export function workersAiConfigured(env: Env): boolean {
  return !!env.AI;
}

export function isFreeWorkersAiModel(model: string): boolean {
  return /^@cf\//.test(model.trim());
}

type CreateParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

/**
 * A minimal stand-in for an OpenAI client: just `chat.completions.create`,
 * which is the only method the scan cascade calls. Keeps scan.ts provider-blind.
 */
export function workersAiClient(env: Env): OpenAI | null {
  const ai = env.AI;
  if (!ai) return null;
  const create = async (params: CreateParams, opts?: { timeout?: number }) => {
    if (!isFreeWorkersAiModel(params.model)) {
      throw Object.assign(new Error(`Workers AI model ${params.model} is not a free @cf/ model`), { status: 400 });
    }
    if (!(await spendQuotaFailClosed(env, 'workersai', 1))) {
      throw Object.assign(new Error('Workers AI daily free allowance reached'), { status: 429 });
    }
    const input = {
      messages: params.messages,
      max_tokens: params.max_tokens ?? 1200,
      temperature: params.temperature ?? 0,
      ...(params.response_format ? { response_format: params.response_format } : {}),
      // Gemma 4 reasons by default; a scan wants the answer, not the essay.
      chat_template_kwargs: { enable_thinking: false },
    };
    const run = (ai as unknown as {
      run: (model: string, input: unknown, options?: unknown) => Promise<unknown>;
    }).run(params.model, input, { rejectIfBusy: true });
    const timeoutMs = opts?.timeout ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raw = await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Workers AI timed out'), { status: 408 })), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    return normalizeWorkersAiResponse(raw);
  };
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

/** Newer models answer in chat.completion shape; older ones as { response }. */
export function normalizeWorkersAiResponse(raw: unknown): OpenAI.Chat.Completions.ChatCompletion {
  const r = (raw ?? {}) as Record<string, any>;
  if (Array.isArray(r.choices)) return r as OpenAI.Chat.Completions.ChatCompletion;
  const content = typeof r.response === 'string'
    ? r.response
    : r.response != null ? JSON.stringify(r.response) : '';
  return {
    id: 'workersai',
    object: 'chat.completion',
    created: 0,
    model: 'workersai',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal: null }, finish_reason: 'stop', logprobs: null }],
    usage: r.usage,
  } as OpenAI.Chat.Completions.ChatCompletion;
}
