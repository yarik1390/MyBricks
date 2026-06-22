import type { Env } from '../types';
import { recordIntegrationAttempt } from './integration-health';
import { firecrawlEnabled } from './pricing-flags';
import { spendQuota } from './api-quota';

const FC_BASE = 'https://api.firecrawl.dev/v2';

export interface FirecrawlScrapeOptions {
  url: string;
  /** v2 formats: 'markdown' | 'html' | 'json' | 'product' | 'links' | 'summary'. */
  formats?: string[];
  /** JSON schema + optional prompt for structured (json) extraction. */
  jsonOptions?: { schema: Record<string, unknown>; prompt?: string };
  /** Milliseconds to wait after page load before extracting (for JS-heavy pages). */
  waitFor?: number;
  timeoutMs?: number;
  /** Proxy mode: 'auto' (default — basic, escalate to stealth only on failure), 'basic', 'stealth'. */
  proxy?: 'auto' | 'basic' | 'stealth';
  /** Serve a cached copy if younger than this many ms (faster; same credit cost). */
  maxAge?: number;
}

/**
 * Call Firecrawl /v2/scrape and return the parsed response data.
 * Returns null on any failure — never throws.
 * Health is recorded via integration_health regardless of outcome.
 */
export async function firecrawlScrape<T = unknown>(
  opts: FirecrawlScrapeOptions,
  env: Env,
): Promise<{ data: T } | null> {
  if (!firecrawlEnabled(env)) return null;

  // Credit guard: Firecrawl is metered in CREDITS (json LLM extraction = 5,
  // basic/markdown/product = 1). Charge the real cost against the daily ceiling
  // BEFORE the call and bail when the budget is spent — this gates EVERY scrape
  // (crons + on-demand), so we can never overrun the one-time allotment or the
  // ~1,000/mo plan. (A failed scrape is free at Firecrawl, so this only ever
  // over-counts slightly — the safe direction.)
  const formats = opts.formats ?? ['json'];
  const creditCost = (opts.jsonOptions || formats.includes('json')) ? 5 : 1;
  if (!(await spendQuota(env, 'firecrawl', creditCost))) {
    await recordIntegrationAttempt(env, 'firecrawl', false, 'daily Firecrawl credit ceiling reached');
    return null;
  }

  // v2 request shape: the json format carries its schema/prompt inline as a
  // format object; other formats (markdown, product, links…) pass through as
  // plain strings. proxy defaults to 'auto' (cheap basic, escalate only if blocked).
  const v2Formats = formats.map((f) =>
    f === 'json' ? { type: 'json', ...(opts.jsonOptions ?? {}) } : f,
  );
  const body: Record<string, unknown> = {
    url: opts.url,
    formats: v2Formats,
    proxy: opts.proxy ?? 'auto',
  };
  if (opts.waitFor) body.waitFor = opts.waitFor;
  if (opts.maxAge != null) body.maxAge = opts.maxAge;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const resp = await fetch(`${FC_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      const msg = `Firecrawl HTTP ${resp.status}: ${text.slice(0, 120)}`;
      await recordIntegrationAttempt(env, 'firecrawl', false, msg);
      return null;
    }

    const json = JSON.parse(text) as { success: boolean; data?: { json?: T; markdown?: string; html?: string } };
    if (!json.success) {
      await recordIntegrationAttempt(env, 'firecrawl', false, 'success=false from Firecrawl');
      return null;
    }

    await recordIntegrationAttempt(env, 'firecrawl', true);
    const extracted = (json.data?.json ?? json.data) as T;
    return { data: extracted };
  } catch (e) {
    await recordIntegrationAttempt(env, 'firecrawl', false, e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
