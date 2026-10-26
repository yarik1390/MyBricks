import type { Env } from '../types';
import { runServiceTest } from '../lib/service-tests';
import { recordIntegrationAttempt, clearIntegrationBlock, type IntegrationName } from '../lib/integration-health';
import { configuredFirecrawlKeys, recoverFirecrawlKeys } from '../lib/firecrawl-keys';

// Daily health probes. Admin > Overview judges each service by the last real
// call it saw, so a service that is only used on demand (push, a fallback AI
// provider) went "stale" after two quiet days, and a revoked key was only
// noticed when a user's scan tripped over it. These probes are free key or
// reachability checks (no tokens, no metered credits), recorded like any other
// call, so the panel always has same-day evidence and a fixed key clears its
// issue (and its routing block) by itself within a day.
//
// Not probed here: services with hourly real traffic (BrickLink, eBay, Bright
// Data), and the Merge gateway, whose only honest probe is a paid completion.
const PROBED: Array<{ test: string; service: IntegrationName }> = [
  { test: 'gemini', service: 'gemini' },
  { test: 'openai', service: 'openai' },
  { test: 'openrouter', service: 'openrouter' },
  { test: 'opencodex', service: 'opencodex' },
  { test: 'firebase', service: 'firebase' },
  { test: 'resend', service: 'email' },
];

export async function runHealthProbes(env: Env) {
  const results: Record<string, string> = {};
  for (const { test, service } of PROBED) {
    const r = await runServiceTest(env, test);
    // Unconfigured services stay "not set up"; a probe must not invent evidence.
    if (!r || r.status === 'unconfigured') { results[service] = 'skipped'; continue; }
    await recordIntegrationAttempt(env, service, r.ok, r.ok ? undefined : r.detail);
    if (r.ok) await clearIntegrationBlock(env, service);
    results[service] = r.ok ? 'ok' : r.detail.slice(0, 80);
  }

  // Firecrawl: un-latch keys that were topped up. When every key is still
  // empty the stored "no credits left" error stays as the evidence.
  if (configuredFirecrawlKeys(env).length) {
    const fc = await recoverFirecrawlKeys(env);
    if (fc.withCredits > 0) await recordIntegrationAttempt(env, 'firecrawl', true);
    results.firecrawl = `${fc.withCredits}/${fc.keys} key(s) with credits, ${fc.recovered} recovered`;
  }
  return results;
}
