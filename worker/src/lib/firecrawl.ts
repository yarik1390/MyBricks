import type { Env } from '../types';
import { recordIntegrationAttempt } from './integration-health';
import { firecrawlEnabled } from './pricing-flags';
import { spendQuota } from './api-quota';
import {
  pickFirecrawlKey,
  recordFirecrawlSpend,
  isCreditExhaustion,
  type PickedFirecrawlKey,
} from './firecrawl-keys';

const FC_BASE = 'https://api.firecrawl.dev/v2';

// Keys are drained IN ORDER by lib/firecrawl-keys.ts (not rotated at random as
// they were before): the balances are one-time allotments of wildly different
// sizes, so spreading load across them would strand a nearly-empty key forever.

export interface FirecrawlScrapeOptions {
  url: string;
  /** v2 formats: 'markdown' | 'html' | 'json' | 'product' | 'links' | 'summary'. */
  formats?: string[];
  /** JSON schema + optional prompt for structured (json) extraction. */
  jsonOptions?: { schema: Record<string, unknown>; prompt?: string };
  /** Milliseconds to wait after page load before extracting (for JS-heavy pages). */
  waitFor?: number;
  timeoutMs?: number;
  /**
   * Proxy mode (Firecrawl v2): 'auto' (default — basic, auto-escalates to
   * enhanced on a block), 'basic', or 'enhanced' (mobile/residential, for sites
   * with advanced anti-bot — StockX-tier; up to 5 credits). ('stealth' was the
   * old name and is no longer accepted — kept in the union only for back-compat.)
   */
  proxy?: 'auto' | 'basic' | 'stealth' | 'enhanced';
  /** Browser actions run before extraction, e.g. wait for a selector to render:
   *  [{ type: 'wait', selector: '.price' }, { type: 'wait', milliseconds: 4000 }]. */
  actions?: Array<Record<string, unknown>>;
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
  // json LLM extract = 5; enhanced proxy (mobile, anti-bot) = up to 5; else 1.
  const creditCost = (opts.jsonOptions || formats.includes('json') || opts.proxy === 'enhanced') ? 5 : 1;
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
  if (opts.actions?.length) body.actions = opts.actions;
  if (opts.maxAge != null) body.maxAge = opts.maxAge;

  // One retry, and only for a drained key: the call that DISCOVERS a key is out
  // of credits would otherwise be thrown away, making every switchover cost a
  // scrape. Any other failure is returned as-is — retrying a timeout or a block
  // on a second key just burns the second key's credits too.
  const attempted: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const picked = await pickFirecrawlKey(env);
    if (!picked) {
      await recordIntegrationAttempt(env, 'firecrawl', false, 'all Firecrawl keys are out of credits');
      return null;
    }
    if (attempted.includes(picked.hash)) break; // pool didn't advance; don't loop
    attempted.push(picked.hash);

    const out = await scrapeOnce<T>(picked, body, opts, env, creditCost);
    if (out.kind === 'ok') return { data: out.data };
    if (out.kind === 'exhausted') continue;     // key retired; next iteration picks the next one
    return null;
  }
  return null;
}

type ScrapeOutcome<T> = { kind: 'ok'; data: T } | { kind: 'failed' } | { kind: 'exhausted' };

async function scrapeOnce<T>(
  picked: PickedFirecrawlKey,
  body: Record<string, unknown>,
  opts: FirecrawlScrapeOptions,
  env: Env,
  creditCost: number,
): Promise<ScrapeOutcome<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const resp = await fetch(`${FC_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${picked.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      // Firecrawl's own verdict on a drained balance is authoritative and beats
      // our credit counter, which can only ever be an estimate.
      const exhausted = isCreditExhaustion(resp.status, text);
      const msg = exhausted
        ? `Firecrawl key ${picked.index} is out of credits (HTTP ${resp.status}) — failing over`
        : `Firecrawl HTTP ${resp.status}: ${text.slice(0, 120)}`;
      await recordFirecrawlSpend(env, picked, 0, { exhausted });
      await recordIntegrationAttempt(env, 'firecrawl', false, msg);
      return { kind: exhausted ? 'exhausted' : 'failed' };
    }

    // Book the credits only on a call Firecrawl actually served — a rejected
    // request is free at their end, so charging the key for it would retire it early.
    await recordFirecrawlSpend(env, picked, creditCost);

    const json = JSON.parse(text) as { success: boolean; data?: { json?: T; markdown?: string; html?: string } };
    if (!json.success) {
      await recordIntegrationAttempt(env, 'firecrawl', false, 'success=false from Firecrawl');
      return { kind: 'failed' };
    }

    await recordIntegrationAttempt(env, 'firecrawl', true);
    return { kind: 'ok', data: (json.data?.json ?? json.data) as T };
  } catch (e) {
    await recordIntegrationAttempt(env, 'firecrawl', false, e);
    return { kind: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
