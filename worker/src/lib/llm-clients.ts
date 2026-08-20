import OpenAI from 'openai';
import type { Env } from '../types';
import { getOpenRouterPools, openAIServerBaseURL, openRouterBaseURL } from './llm';
import { mergeBaseURL } from './merge-gateway';
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
 * Three of the four providers (merge, openrouter, openai) speak the OpenAI wire
 * format, so they differ only by base URL and key — which is the whole reason
 * Merge was cheap to add. Gemini is NOT included here: it has its own REST
 * shape and its callers handle it separately.
 *
 * The model list is usually a single id. The exception is an `openrouter` step
 * with an empty model, which expands to the live free pool from KV — kept
 * current by the daily model-refresh cron, so that cascade position keeps
 * working as free-tier availability churns without anyone editing the route.
 */
export async function openAiCompatibleStep(
  env: Env,
  step: RouteStep,
  headers: Record<string, string>,
  kind: 'vision' | 'text' = 'vision',
): Promise<{ client: OpenAI | null; models: string[] }> {
  switch (step.provider) {
    case 'merge': {
      const apiKey = (env.MERGE_GATEWAY_API_KEY ?? '').trim();
      if (!apiKey || !step.model) return { client: null, models: [] };
      // Merge is billed against a fixed monthly allowance and is not fronted by
      // the Cloudflare AI Gateway — it is a gateway itself, and double-proxying
      // would hide the per-call `usage.cost` we meter the budget from.
      return { client: new OpenAI({ apiKey, baseURL: mergeBaseURL(), maxRetries: RETRIES }), models: [step.model] };
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
    default:
      return { client: null, models: [] };
  }
}
