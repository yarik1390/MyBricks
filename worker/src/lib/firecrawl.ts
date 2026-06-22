import type { Env } from '../types';
import { recordIntegrationAttempt } from './integration-health';
import { firecrawlEnabled } from './pricing-flags';

const FC_BASE = 'https://api.firecrawl.dev/v1';

export interface FirecrawlScrapeOptions {
  url: string;
  formats?: ('markdown' | 'html' | 'json')[];
  /** JSON schema + optional extraction prompt for structured output. */
  jsonOptions?: { schema: Record<string, unknown>; prompt?: string };
  /** Milliseconds to wait after page load before extracting (for JS-heavy pages). */
  waitFor?: number;
  timeoutMs?: number;
}

/**
 * Call Firecrawl /v1/scrape and return the parsed response data.
 * Returns null on any failure — never throws.
 * Health is recorded via integration_health regardless of outcome.
 */
export async function firecrawlScrape<T = unknown>(
  opts: FirecrawlScrapeOptions,
  env: Env,
): Promise<{ data: T } | null> {
  if (!firecrawlEnabled(env)) return null;

  const body: Record<string, unknown> = {
    url: opts.url,
    formats: opts.formats ?? ['json'],
  };
  if (opts.jsonOptions) body.jsonOptions = opts.jsonOptions;
  if (opts.waitFor) body.waitFor = opts.waitFor;

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
