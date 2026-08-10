import type { Env } from '../types';
import { pickKey, recordKeyCall } from './brightdata-keys';

// ---------------------------------------------------------------------------
// Bright Data WEB SCRAPER API (datasets/v3) — a different product from the Web
// Unlocker in lib/brightdata.ts, and the one that may finally give us eBay.
//
// The unlocker fetches a URL and hands back raw HTML for us to parse; it works
// on hard targets (StockX renders in ~12s) but eBay's sold-search page hangs it
// outright — a 90s probe got no answer, and the async lane was still pending
// after 10 minutes. The Scraper API instead runs Bright Data's own maintained
// per-site collector and returns STRUCTURED JSON, so there is no HTML to parse
// and no bot-check for us to lose to.
//
//   sync:  POST /datasets/v3/scrape?dataset_id=…   -> rows, or 202 if slow
//   async: POST /datasets/v3/trigger?dataset_id=…  -> { snapshot_id }
//          GET  /datasets/v3/progress/{snapshot_id}
//          GET  /datasets/v3/snapshot/{snapshot_id}
//
// TWO MODES, and the difference decides whether this is usable for us at all:
//   collect  — input is item URLs; returns those items. Needs URLs we do not have.
//   discover — input is a keyword; Bright Data runs the SEARCH itself, which is
//              precisely the step eBay blocks us on.
// Only the discover mode removes our dependency on scraping eBay search.
//
// BILLING IS DIFFERENT from the unlocker's monthly key budget: this is metered
// per delivered record (~$0.70/1,000). The key pool is still used for auth and
// call accounting, but the credit maths in brightdata-keys.ts does NOT model
// record-based charges — treat pooled budget as an auth concern here, not a cost one.
// ---------------------------------------------------------------------------

const BD_SCRAPE = 'https://api.brightdata.com/datasets/v3/scrape';
const BD_TRIGGER = 'https://api.brightdata.com/datasets/v3/trigger';
const BD_PROGRESS = 'https://api.brightdata.com/datasets/v3/progress';
const BD_SNAPSHOT = 'https://api.brightdata.com/datasets/v3/snapshot';

/** eBay products collector. Override per-env if the account exposes a different one. */
export const EBAY_DATASET_ID = 'gd_ltr9mjt81n0zzdk1fb';

export interface ScraperCall {
  /** ok = rows returned; queued = accepted, collect later; error = failed. */
  state: 'ok' | 'queued' | 'error';
  rows: unknown[] | null;
  snapshot_id: string | null;
  status: number | null;
  error: string | null;
  /** Raw first bytes, so an unexpected shape is diagnosable without a redeploy. */
  raw_head: string | null;
}

function datasetId(env: Env): string {
  return env.BRIGHTDATA_EBAY_DATASET_ID || EBAY_DATASET_ID;
}

/**
 * Bright Data returns either a JSON array, a single JSON object, or NDJSON
 * (one record per line) depending on endpoint and size. Accept all three rather
 * than assuming — a parse failure here would look identical to "no data".
 */
export function parseRows(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    // NDJSON
    const rows: unknown[] = [];
    for (const line of trimmed.split('\n')) {
      const l = line.trim();
      if (!l) continue;
      try { rows.push(JSON.parse(l)); } catch { return null; }
    }
    return rows.length ? rows : null;
  }
}

async function post(
  env: Env,
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ status: number | null; text: string; error: string | null }> {
  const picked = await pickKey(env);
  if (!picked) return { status: null, text: '', error: 'no live Bright Data token' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${picked.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    await recordKeyCall(env, picked, { exhausted: resp.status === 401 || resp.status === 402 });
    return { status: resp.status, text, error: null };
  } catch (e) {
    return { status: null, text: '', error: (e as Error)?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the eBay collector over explicit item URLs (the "collect" mode from the
 * account's own sample call).
 */
export async function scrapeEbayUrls(
  env: Env,
  urls: string[],
  opts: { sync?: boolean; timeoutMs?: number } = {},
): Promise<ScraperCall> {
  const qs = `dataset_id=${encodeURIComponent(datasetId(env))}&notify=false&include_errors=true`;
  const endpoint = `${opts.sync === false ? BD_TRIGGER : BD_SCRAPE}?${qs}`;
  const body = { input: urls.map((url) => ({ url })), limit_per_input: null };
  return interpret(await post(env, endpoint, body, opts.timeoutMs ?? 60_000));
}

/**
 * Ask the collector to DISCOVER listings from search terms — Bright Data runs
 * the eBay search on its side. This is the mode that matters: it is the only
 * one that does not require us to already hold item URLs.
 *
 * Note `keywords`, plural, in BOTH the query param and each input object. The
 * singular spelling is a natural guess and is wrong; this shape comes from the
 * account's own working sample call.
 *
 * Takes an ARRAY because the API accepts many search terms per request. That is
 * a real efficiency win for us rather than a nicety: a whole scrape tick's worth
 * of sets can go up as ONE call instead of one call per set.
 */
export async function discoverEbayByKeywords(
  env: Env,
  keywords: string[],
  opts: { sync?: boolean; timeoutMs?: number; limitPerInput?: number | null } = {},
): Promise<ScraperCall> {
  const qs = `dataset_id=${encodeURIComponent(datasetId(env))}&notify=false&include_errors=true`
    + '&type=discover_new&discover_by=keywords';
  const endpoint = `${opts.sync === false ? BD_TRIGGER : BD_SCRAPE}?${qs}`;
  const body = {
    input: keywords.map((k) => ({ keywords: k })),
    limit_per_input: opts.limitPerInput ?? null,
  };
  return interpret(await post(env, endpoint, body, opts.timeoutMs ?? 60_000));
}

function interpret(r: { status: number | null; text: string; error: string | null }): ScraperCall {
  const head = r.text ? r.text.slice(0, 400) : null;
  if (r.error) return { state: 'error', rows: null, snapshot_id: null, status: r.status, error: r.error, raw_head: head };
  if (r.status == null) return { state: 'error', rows: null, snapshot_id: null, status: null, error: 'no status', raw_head: head };
  if (r.status >= 400) {
    return { state: 'error', rows: null, snapshot_id: null, status: r.status, error: `HTTP ${r.status}: ${r.text.slice(0, 300)}`, raw_head: head };
  }
  // A slow job comes back as a snapshot handle instead of rows (202 on /scrape,
  // always on /trigger). That is queued work, not a failure.
  let snapshotId: string | null = null;
  try {
    const parsed = JSON.parse(r.text) as Record<string, unknown>;
    const s = parsed.snapshot_id ?? parsed.snapshotId;
    if (typeof s === 'string' && s) snapshotId = s;
  } catch { /* not a handle; fall through to rows */ }
  if (snapshotId) {
    return { state: 'queued', rows: null, snapshot_id: snapshotId, status: r.status, error: null, raw_head: head };
  }
  const rows = parseRows(r.text);
  if (!rows) return { state: 'error', rows: null, snapshot_id: null, status: r.status, error: 'unparseable scraper response', raw_head: head };
  return { state: 'ok', rows, snapshot_id: null, status: r.status, error: null, raw_head: head };
}

/** Poll a queued snapshot. 'queued' means still running — not an error. */
export async function fetchSnapshot(env: Env, snapshotId: string, timeoutMs = 30_000): Promise<ScraperCall> {
  const picked = await pickKey(env);
  if (!picked) return { state: 'error', rows: null, snapshot_id: snapshotId, status: null, error: 'no live Bright Data token', raw_head: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BD_SNAPSHOT}/${encodeURIComponent(snapshotId)}?format=json`, {
      headers: { 'Authorization': `Bearer ${picked.key}` },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (resp.status === 202) {
      return { state: 'queued', rows: null, snapshot_id: snapshotId, status: 202, error: null, raw_head: text.slice(0, 200) };
    }
    if (resp.status >= 400) {
      return { state: 'error', rows: null, snapshot_id: snapshotId, status: resp.status, error: `HTTP ${resp.status}: ${text.slice(0, 300)}`, raw_head: text.slice(0, 400) };
    }
    const rows = parseRows(text);
    if (!rows) return { state: 'error', rows: null, snapshot_id: snapshotId, status: resp.status, error: 'unparseable snapshot', raw_head: text.slice(0, 400) };
    return { state: 'ok', rows, snapshot_id: snapshotId, status: resp.status, error: null, raw_head: text.slice(0, 400) };
  } catch (e) {
    return { state: 'error', rows: null, snapshot_id: snapshotId, status: null, error: (e as Error)?.message || String(e), raw_head: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Progress of a queued snapshot (status/rows collected), for diagnostics. */
export async function fetchProgress(env: Env, snapshotId: string, timeoutMs = 20_000): Promise<unknown> {
  const picked = await pickKey(env);
  if (!picked) return { error: 'no live Bright Data token' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BD_PROGRESS}/${encodeURIComponent(snapshotId)}`, {
      headers: { 'Authorization': `Bearer ${picked.key}` },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    try { return JSON.parse(text); } catch { return { status: resp.status, raw: text.slice(0, 300) }; }
  } catch (e) {
    return { error: (e as Error)?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}
