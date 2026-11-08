import OpenAI from 'openai';
import type { Env } from '../types';
import { getOpenRouterPools, openAIServerBaseURL, openRouterBaseURL } from './llm';
import { openCodexClient } from './opencodex';
import { isFreeWorkersAiModel, workersAiClient } from './workers-ai';
import type { RouteStep } from './llm-routing';

/**
 * The OpenAI SDK retries twice by DEFAULT, so every client here was silently
 * making up to three attempts per model. That turned a 7s per-model ceiling
 * into ~21s and is why a measured scan took 35s against a 24s budget: the
 * budget bounded each ATTEMPT, not the call.
 *
 * Zero is right inside a cascade — the next step IS the retry, and it is a
 * different provider, which is a better bet than the same one again.
 */
const RETRIES = 0;

/**
 * Turn one route step into a ready OpenAI-compatible client plus the ordered
 * model ids to try on it.
 *
 * Every provider here (opencodex, openrouter, openai, groq, workersai) speaks
 * the OpenAI wire format, so they differ only by base URL and key. Gemini is
 * NOT included here: it has its own REST
 * shape and its callers handle it separately.
 *
 * The model list is usually a single id. The exception is an `openrouter` step
 * with an empty model, which expands to the live free pool from KV — kept
 * current by the daily model-refresh cron, so that cascade position keeps
 * working as free-tier availability churns without anyone editing the route.
 */
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

export async function openAiCompatibleStep(
  env: Env,
  step: RouteStep,
  headers: Record<string, string>,
  kind: 'vision' | 'text' = 'vision',
): Promise<{ client: OpenAI | null; models: string[] }> {
  switch (step.provider) {
    case 'opencodex': {
      const client = openCodexClient(env);
      if (!client || !step.model) return { client: null, models: [] };
      return { client, models: [step.model] };
    }
    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) return { client: null, models: [] };
      const client = new OpenAI({ apiKey, baseURL: openRouterBaseURL(env), defaultHeaders: headers, maxRetries: RETRIES });
      if (step.model) return { client, models: [step.model] };
      const pools = await getOpenRouterPools(env);
      return { client, models: kind === 'vision' ? pools.vision : pools.text };
    }
    case 'openai': {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey || !step.model) return { client: null, models: [] };
      return {
        client: new OpenAI({ apiKey, baseURL: openAIServerBaseURL(env), defaultHeaders: headers, maxRetries: RETRIES }),
        models: [step.model],
      };
    }
    case 'groq': {
      // Groq is OpenAI-compatible. Free tier; API data is not used for training.
      const apiKey = (env.GROQ_API_KEY ?? '').trim();
      if (!apiKey || !step.model) return { client: null, models: [] };
      return { client: new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, maxRetries: RETRIES }), models: [step.model] };
    }
    case 'workersai': {
      const client = workersAiClient(env);
      if (!client || !step.model || !isFreeWorkersAiModel(step.model)) return { client: null, models: [] };
      return { client, models: [step.model] };
    }
    default:
      return { client: null, models: [] };
  }
}
