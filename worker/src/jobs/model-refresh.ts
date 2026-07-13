import type { Env } from '../types';
import { MODELS } from '../lib/llm';

/**
 * Daily OpenRouter free-model refresh — keeps the AI cascades on FREE models
 * even as OpenRouter's free-tier availability churns.
 *
 * The curated pools in lib/llm.ts are hand-verified for quality, but models
 * vanish (or lose their :free variant) without notice; a vanished model is a
 * wasted cascade step and, if the whole pool rots, every scan/valuation
 * escalates to the paid tiers. This job:
 *   1. fetches OpenRouter's public model catalog (no API key required),
 *   2. keeps curated models that are still listed AND still free (order kept —
 *      curated models are quality-verified so they stay first),
 *   3. discovers a few extra :free models as lower-priority additions,
 *   4. publishes the effective pools to KV (`ai:or-free-pools`) where
 *      getOpenRouterPools() in lib/llm.ts picks them up.
 *
 * Failure model: on any error the KV blob is left untouched (last known good),
 * and consumers fall back to the curated constants when KV is empty — so this
 * job can only ever improve the pools, never break the cascade.
 */

export const OR_POOLS_KV_KEY = 'ai:or-free-pools';

export interface OrFreePools {
  vision: string[];
  text: string[];
  missingCurated: string[];
  checkedAt: string;
}

interface OrModel {
  id: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: Record<string, string | number>;
}

// Models that match these are never auto-added: special-purpose (safety
// classifiers, media generation/preview, embeddings) or the meta-router.
const DISCOVER_BLOCKLIST = /safety|guard|preview|clip|whisper|audio|video|embed|image-gen|lyria|openrouter\/free/i;
const MAX_DISCOVERED = 3; // per pool, appended AFTER the curated survivors
const MIN_CONTEXT = 16_000;

export function isFree(m: OrModel): boolean {
  const p = m.pricing || {};
  return m.id.endsWith(':free') && Object.values(p).every((v) => Number(v) === 0);
}

export function classifyFreeModel(m: OrModel): 'vision' | 'text' | null {
  if (!isFree(m)) return null;
  if (DISCOVER_BLOCKLIST.test(m.id)) return null;
  if ((m.context_length || 0) < MIN_CONTEXT) return null;
  const inMods = m.architecture?.input_modalities || [];
  const outMods = m.architecture?.output_modalities || [];
  if (!inMods.includes('text') || !outMods.includes('text')) return null;
  return inMods.includes('image') ? 'vision' : 'text';
}

export function buildPools(models: OrModel[]): Omit<OrFreePools, 'checkedAt'> {
  const byId = new Map(models.map((m) => [m.id, m]));
  const missingCurated: string[] = [];

  const survivors = (curated: readonly string[]) => curated.filter((id) => {
    const m = byId.get(id);
    if (m && isFree(m)) return true;
    missingCurated.push(id);
    return false;
  });

  const vision = survivors(MODELS.scanOpenrouterVisionPool);
  const text = survivors(MODELS.openrouterFreePool);

  // Discover extras, largest context first as a crude capability proxy. A weak
  // pick costs nothing: the cascades fall through on error/empty/unparseable.
  const curatedAll = new Set<string>([...MODELS.scanOpenrouterVisionPool, ...MODELS.openrouterFreePool]);
  const discovered = models
    .filter((m) => !curatedAll.has(m.id))
    .map((m) => ({ id: m.id, kind: classifyFreeModel(m), ctx: m.context_length || 0 }))
    .filter((m) => m.kind)
    .sort((a, b) => b.ctx - a.ctx);
  vision.push(...discovered.filter((m) => m.kind === 'vision').slice(0, MAX_DISCOVERED).map((m) => m.id));
  text.push(...discovered.filter((m) => m.kind === 'text').slice(0, MAX_DISCOVERED).map((m) => m.id));

  return { vision, text, missingCurated };
}

export async function runModelRefresh(env: Env) {
  if (!env.CACHE_KV) return { skipped: 'KV not configured' };
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenRouter catalog fetch failed: ${res.status}`);
  const json = await res.json() as { data?: OrModel[] };
  const models = Array.isArray(json.data) ? json.data : [];
  // A tiny catalog means a broken/partial response — keep last known good.
  if (models.length < 20) throw new Error(`OpenRouter catalog suspiciously small (${models.length} models)`);

  const pools: OrFreePools = { ...buildPools(models), checkedAt: new Date().toISOString() };
  await env.CACHE_KV.put(OR_POOLS_KV_KEY, JSON.stringify(pools));
  return {
    vision: pools.vision,
    text: pools.text,
    missingCurated: pools.missingCurated,
    catalogSize: models.length,
  };
}
