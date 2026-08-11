import type { Env } from '../types';
import { recordIntegrationAttempt } from './integration-health';
import { firecrawlEnabled } from './pricing-flags';
import { spendQuota } from './api-quota';
import {
  pickFirecrawlKey,
  pickNextFirecrawlKey,
  recordFirecrawlSpend,
  isCreditExhaustion,
  isRateLimited,
  type PickedFirecrawlKey,
} from './firecrawl-keys';

const FC_BASE = 'https://api.firecrawl.dev/v2';

/**
 * Concurrent scrapes the Firecrawl PLAN allows. Every job that scrapes must cap
 * its wave at this — going wider does not go faster, the surplus calls come
 * straight back as 429s, and a 429 on the last live key surfaces as "no
 * Firecrawl key could serve the request".
 *
 * It lives here, next to the client, because it is a property of the ACCOUNT and
 * not of any one job: the caps were previously set per job (eBay-sold 2,
 * brickeconomy 5, StockX 3) with nothing keeping them honest, so fixing one lane
 * left the others over-subscribing the same two connections. Raise this only
 * when the plan itself is raised.
 */
export const FIRECRAWL_MAX_CONCURRENCY = 2;

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

  // Retry on TWO conditions, both of which mean "this key can't serve the call
  // but another one could", and neither of which costs credits on the key that
  // refused it:
  //   exhausted (402) — the balance is gone; the key is retired and we move on.
  //   rate_limited (429) — Firecrawl's per-minute ceiling is PER KEY, so an idle
  //     key still has its own allowance. The key is NOT retired and keeps its
  //     place in the drain order; we just borrow the next one for this call.
  // Anything else returns as-is: retrying a timeout or a block on a second key
  // would burn the second key's credits for the same failure.
  const attempted = new Set<string>();
  let picked = await pickFirecrawlKey(env);
  // Small pools are common once earlier one-time allotments drain (observed
  // live: 2 configured keys, key 0 permanently spent, key 1 the only real
  // budget) — a 429 on the sole live key used to fail outright with "no
  // Firecrawl key could serve the request" even though the key wasn't out of
  // credits, just briefly over its own per-minute ceiling. One short
  // backoff-and-retry on the SAME key covers that case without risking a
  // runaway wall-clock time on a genuinely dead/blocked key (isRateLimited is
  // specifically NOT the same signal as a hung/blocked request).
  let sameKeyRetries = 0;
  const MAX_SAME_KEY_RETRIES = 1;
  const RATE_LIMIT_BACKOFF_MS = 1500;
  for (let attempt = 0; attempt < 3 && picked; attempt++) {
    if (attempted.has(picked.hash) && sameKeyRetries === 0) break;   // pool didn't advance; don't loop
    attempted.add(picked.hash);

    const out = await scrapeOnce<T>(picked, body, opts, env, creditCost);
    if (out.kind === 'ok') return { data: out.data };
    if (out.kind === 'failed') return null;
    if (out.kind === 'exhausted') {
      // The key is now latched, so the normal head-of-pool pick advances by itself.
      picked = await pickFirecrawlKey(env);
      continue;
    }
    // rate_limited: the key is still live and still first in the drain order,
    // so step PAST it explicitly for this call only, when another key exists.
    const next = await pickNextFirecrawlKey(env, picked.index);
    if (next) { picked = next; continue; }
    if (sameKeyRetries >= MAX_SAME_KEY_RETRIES) { picked = null; break; }
    sameKeyRetries++;
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_BACKOFF_MS * sameKeyRetries));
    attempted.delete(picked.hash); // intentional same-key retry, not a stuck pool
  }
  if (!picked) {
    await recordIntegrationAttempt(env, 'firecrawl', false, 'no Firecrawl key could serve the request');
  }
  return null;
}

type ScrapeOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'failed' }
  | { kind: 'exhausted' }
  | { kind: 'rate_limited' };

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
      const throttled = !exhausted && isRateLimited(resp.status);
      const msg = exhausted
        ? `Firecrawl key ${picked.index + 1} is out of credits (HTTP ${resp.status}) — retiring it and failing over`
        : throttled
          ? `Firecrawl key ${picked.index + 1} hit its per-minute rate limit — borrowing the next key for this call`
          : `Firecrawl HTTP ${resp.status}: ${text.slice(0, 120)}`;
      // A throttled key is healthy: don't latch it, and don't charge it either
      // (Firecrawl bills nothing for a request it refused).
      await recordFirecrawlSpend(env, picked, 0, { exhausted });
      await recordIntegrationAttempt(env, 'firecrawl', false, msg);
      if (exhausted) return { kind: 'exhausted' };
      return { kind: throttled ? 'rate_limited' : 'failed' };
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
