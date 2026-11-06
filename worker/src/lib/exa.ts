import type { Env } from '../types';
import { quotaRemaining, spendQuota } from './api-quota';
import { recordIntegrationAttempt } from './integration-health';

// Exa search API (exa.ai, free plan: $10 of credits a month). Exa finds pages;
// it reads its own stored copy of each page, so it is never used for live
// prices or stock (Bright Data / Firecrawl keep that job). Two uses
// (Iaroslav, 2026-11-04): a daily LEGO news scan for retiring and newly
// revealed sets, and a per-set lookup of the expected retirement date.
//
// Cost per call: $0.007 for the search (up to 10 results, page text included)
// plus $0.001 per structured page summary. The daily call cap (api_quota
// service 'exa') keeps a month inside the free credits.

const EXA_ENDPOINT = 'https://api.exa.ai/search';

/** Fan and news sites that cover LEGO releases and retirements. */
export const LEGO_NEWS_DOMAINS = [
  'lego.com', 'brickset.com', 'brickfanatics.com', 'thebrickfan.com', 'jaysbrickblog.com',
  'promobricks.de', 'stonewars.de', 'hothbricks.com', 'bricksfanz.com', 'toysnbricks.com',
  'thebrickblogger.com', 'brickfinder.net', 'zusammengebaut.com', 'brickarchitect.com',
];

export function exaConfigured(env: Env): boolean {
  return !!env.EXA_API_KEY?.trim();
}

export interface ExaResult {
  url: string;
  title: string | null;
  publishedDate: string | null;
  /** Structured summary (parsed JSON) when a summary schema was requested. */
  summary: unknown;
}

export interface ExaSearchOptions {
  query: string;
  numResults?: number;
  includeDomains?: string[];
  /** ISO timestamp; only pages published after it. */
  startPublishedDate?: string;
  /** What the per-page summary should answer, and the JSON shape to answer in. */
  summary?: { query: string; schema: unknown };
  timeoutMs?: number;
}

/** Parse Exa's summary field: an object, or a JSON string (possibly fenced). */
export function parseExaSummary(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** One Exa search, or null (no key, daily cap reached, or failure). Never throws. */
export async function exaSearch(env: Env, options: ExaSearchOptions): Promise<ExaResult[] | null> {
  if (!exaConfigured(env)) return null;
  if ((await quotaRemaining(env, 'exa')) < 1) {
    console.warn('[exa] daily cap reached');
    return null;
  }
  await spendQuota(env, 'exa', 1);
  const body: Record<string, unknown> = {
    query: options.query,
    type: 'auto',
    numResults: Math.max(1, Math.min(options.numResults ?? 5, 10)),
  };
  if (options.includeDomains?.length) body.includeDomains = options.includeDomains;
  if (options.startPublishedDate) body.startPublishedDate = options.startPublishedDate;
  if (options.summary) body.contents = { summary: { query: options.summary.query, schema: options.summary.schema } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
  try {
    const response = await fetch(EXA_ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': env.EXA_API_KEY!.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Exa HTTP ${response.status}: ${text.slice(0, 160)}`);
    const data = JSON.parse(text) as { results?: Array<Record<string, unknown>> };
    const results = (data.results ?? []).map((r): ExaResult => ({
      url: String(r.url ?? ''),
      title: typeof r.title === 'string' ? r.title : null,
      publishedDate: typeof r.publishedDate === 'string' ? r.publishedDate : null,
      summary: parseExaSummary(r.summary),
    })).filter((r) => r.url);
    await recordIntegrationAttempt(env, 'exa', true).catch(() => undefined);
    return results;
  } catch (e) {
    await recordIntegrationAttempt(env, 'exa', false, e).catch(() => undefined);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
