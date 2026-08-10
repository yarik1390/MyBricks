import type { Env } from '../types';
import { pickKey, recordKeyCall, type PickedKey } from './brightdata-keys';

// ---------------------------------------------------------------------------
// Bright Data Web Unlocker — ASYNCHRONOUS mode.
//
// WHY THIS EXISTS. The synchronous unlocker (lib/brightdata.ts) works fine on
// hard targets — the StockX probe returns 735KB of rendered markup in ~12s —
// but eBay's sold-search page HANGS it: a 90s timed probe on 2026-08-10 got no
// answer at all, while the same call, same zone, same tokens, succeeded against
// StockX. eBay does not refuse us; it simply never replies in a window any
// scrape batch can afford to wait.
//
// Bright Data's own guidance is that async mode is what slow-responding sites
// need. Instead of holding a socket open, we hand the job over and collect it
// later:
//
//   POST /unblocker/req?zone=…        -> { response_id }
//   GET  /unblocker/get_result?response_id=…  -> 200 with the body once ready
//
// Documented behaviour: results typically land within ~5 minutes (up to 8 hours
// at peak) and are retained for 48 HOURS. That retention is the important part
// — it is far longer than the 3-hourly scrape tick, so a submit in one run can
// be collected by the next one without any state beyond the response_id.
//
// NOTE: async has to be enabled per zone in the Bright Data control panel
// (Zone -> Advanced Options -> "Asynchronous requests"). If it is off, submit
// returns a 4xx; submitAsyncUnlock surfaces that verbatim rather than guessing,
// because "not enabled yet" and "eBay is blocking us" are different problems.
// ---------------------------------------------------------------------------

const BD_ASYNC_SUBMIT = 'https://api.brightdata.com/unblocker/req';
const BD_ASYNC_RESULT = 'https://api.brightdata.com/unblocker/get_result';
const DEFAULT_ZONE = 'web_unlocker1';

export interface AsyncSubmission {
  ok: boolean;
  response_id: string | null;
  status: number | null;
  /** Provider's own words on a failure — never paraphrased. */
  error: string | null;
}

export interface AsyncResult {
  /** pending = accepted but not finished; the caller should come back later. */
  state: 'ready' | 'pending' | 'error';
  body: string | null;
  status: number | null;
  error: string | null;
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hand a URL to the unlocker and get back a claim ticket. Cheap and fast — this
 * call only queues the work, so it is safe on the short timeout that the
 * synchronous path could never live with.
 */
export async function submitAsyncUnlock(
  env: Env,
  url: string,
  opts: { timeoutMs?: number; picked?: PickedKey } = {},
): Promise<AsyncSubmission> {
  const picked = opts.picked ?? (await pickKey(env));
  if (!picked) {
    return { ok: false, response_id: null, status: null, error: 'no live Bright Data token (monthly budget drained)' };
  }
  const zone = env.BRIGHTDATA_ZONE || DEFAULT_ZONE;
  try {
    const resp = await withTimeout(opts.timeoutMs ?? 15_000, (signal) =>
      fetch(`${BD_ASYNC_SUBMIT}?zone=${encodeURIComponent(zone)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${picked.key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, format: 'raw', method: 'GET', country: 'US' }),
        signal,
      }),
    );
    const text = await resp.text();
    // The submit itself spends a call against the key's monthly budget.
    await recordKeyCall(env, picked, { exhausted: resp.status === 401 || resp.status === 402 || resp.status === 403 });
    if (!resp.ok) {
      return { ok: false, response_id: null, status: resp.status, error: `HTTP ${resp.status}: ${text.slice(0, 240)}` };
    }
    // Be liberal about where the id lives — the field has been documented as
    // response_id, and a wrapper object is cheap to tolerate.
    let responseId: string | null = null;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const candidate = parsed.response_id ?? parsed.responseId ?? parsed.id;
      if (typeof candidate === 'string' && candidate) responseId = candidate;
    } catch {
      // Not JSON. A bare id string is still usable; anything else is a failure.
      const trimmed = text.trim();
      if (trimmed && trimmed.length < 200 && !trimmed.startsWith('<')) responseId = trimmed;
    }
    if (!responseId) {
      return { ok: false, response_id: null, status: resp.status, error: `no response_id in submit reply: ${text.slice(0, 240)}` };
    }
    return { ok: true, response_id: responseId, status: resp.status, error: null };
  } catch (e) {
    return { ok: false, response_id: null, status: null, error: (e as Error)?.message || String(e) };
  }
}

/**
 * Collect a previously submitted job. A job that is not finished yet is
 * reported as 'pending' rather than as an error — the whole point of async is
 * that "not ready" is the normal, expected intermediate state.
 */
export async function fetchAsyncResult(
  env: Env,
  responseId: string,
  opts: { timeoutMs?: number; picked?: PickedKey } = {},
): Promise<AsyncResult> {
  const picked = opts.picked ?? (await pickKey(env));
  if (!picked) {
    return { state: 'error', body: null, status: null, error: 'no live Bright Data token to collect with' };
  }
  try {
    const resp = await withTimeout(opts.timeoutMs ?? 20_000, (signal) =>
      fetch(`${BD_ASYNC_RESULT}?response_id=${encodeURIComponent(responseId)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${picked.key}` },
        signal,
      }),
    );
    const text = await resp.text();
    if (resp.status === 200) return { state: 'ready', body: text, status: 200, error: null };
    // 202/404 while the job is still in flight — documented as poll-until-200,
    // and a just-queued id can read as "not found" before it is durable.
    if (resp.status === 202 || resp.status === 404) {
      return { state: 'pending', body: null, status: resp.status, error: null };
    }
    return { state: 'error', body: null, status: resp.status, error: `HTTP ${resp.status}: ${text.slice(0, 240)}` };
  } catch (e) {
    return { state: 'error', body: null, status: null, error: (e as Error)?.message || String(e) };
  }
}

/** The eBay sold-search URL the sync lane uses, kept in one place. */
export function ebaySoldUrl(setNum: string, setName: string, conditionId: 1000 | 3000 = 1000): string {
  const base = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${base} ${setName || ''}`.trim());
  return `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=${conditionId}&_ipg=60`;
}
