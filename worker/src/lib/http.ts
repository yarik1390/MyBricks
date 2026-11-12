import type { Env } from '../types';
import { integrationErrorMessage, recordIntegrationAttempt, setIntegrationBlock, type IntegrationName } from './integration-health';
import { gatewayDirectUrl, isGatewayAuthRejection, warnGatewayRejected, withoutGatewayHeaders } from './ai-gateway';

// Shared fetch helper for external API integrations.
//
// Adds a hard timeout (AbortController) plus retry-with-exponential-backoff on
// transient failures (HTTP 429 and 5xx, or network errors). Integration callers
// keep their existing contract: they wrap this in try/catch and fall back to
// `null` on failure, so a permanently-failing upstream still degrades gracefully.

export interface FetchRetryOptions {
  retries?: number;     // number of *additional* attempts after the first
  backoffMs?: number;   // base backoff, doubled each retry
  timeoutMs?: number;   // per-attempt timeout
}

export interface FetchTrackedOptions extends FetchRetryOptions {
  okStatuses?: number[];
  record?: boolean;
  /**
   * Treat a non-JSON 403 as the provider's front door refusing all traffic
   * (an outage), not as a rejected credential. Only for APIs that always
   * answer real auth errors in JSON (BrickLink).
   */
  edgeRefusalIsOutage?: boolean;
}

/** Header on the synthetic 503 fetchTracked returns for a detected outage. */
export const OUTAGE_HEADER = 'x-bv-outage';
export const EDGE_REFUSAL_ERROR = 'Provider offline (its front door refuses API calls before any key is checked)';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const backoffMs = opts.backoffMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 8000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(timer);
      // Retry transient server/rate-limit statuses; return everything else
      // (including 4xx like 404) to the caller to handle.
      if (RETRYABLE_STATUS.has(resp.status) && attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
      return resp;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('fetchWithRetry failed');
}

export async function fetchTracked(
  env: Env,
  service: IntegrationName,
  url: string,
  init: RequestInit = {},
  opts: FetchTrackedOptions = {},
): Promise<Response> {
  const shouldRecord = opts.record !== false;
  try {
    let resp = await fetchWithRetry(url, init, opts);
    // The AI Gateway refusing us is not the provider refusing its key: send
    // the same request straight to the provider (see lib/ai-gateway.ts).
    if (await isGatewayAuthRejection(url, resp)) {
      const direct = gatewayDirectUrl(url);
      if (direct) {
        warnGatewayRejected();
        resp = await fetchWithRetry(direct, withoutGatewayHeaders(init), opts);
      }
    }
    // A planned outage: BrickLink answers every API call with a 302 to
    // maintenance.bricklink.com, fetch follows it, and callers then choked on
    // an HTML 200 ("Unexpected token '<'") while burning the daily call budget
    // (2026-11-08: ~1,200 wasted calls). Report it as what it is, pause the
    // service for an hour (callers that honour the block skip it), and hand
    // callers a plain 503 so they take their normal outage path.
    // Since 2026-11-12 the same outage also shows up as a bare HTTP 403 from
    // BrickLink's edge. Recorded as plain "HTTP 403" it read as "needs access"
    // in Admin, which sent the owner looking for a key problem that is not there.
    const outage = isMaintenanceRedirect(resp)
      ? `Planned maintenance (redirected to ${safeHost(resp.url)})`
      : (opts.edgeRefusalIsOutage && isEdgeRefusal(resp)) ? EDGE_REFUSAL_ERROR : null;
    if (outage) {
      if (shouldRecord) {
        await recordIntegrationAttempt(env, service, false, outage);
        await setIntegrationBlock(env, service, 1);
      }
      return new Response('upstream outage', {
        status: 503, statusText: 'Service Unavailable', headers: { [OUTAGE_HEADER]: outage },
      });
    }
    const okStatuses = new Set(opts.okStatuses ?? []);
    if (shouldRecord) {
      if (resp.ok || okStatuses.has(resp.status)) {
        await recordIntegrationAttempt(env, service, true);
      } else {
        await recordIntegrationAttempt(env, service, false, `HTTP ${resp.status}`);
      }
    }
    return resp;
  } catch (error) {
    if (shouldRecord) {
      await recordIntegrationAttempt(env, service, false, integrationErrorMessage(error));
    }
    throw error;
  }
}

/** A 403 that did not come from the API itself (the API answers in JSON). */
export function isEdgeRefusal(resp: Pick<Response, 'status' | 'headers'>): boolean {
  if (resp.status !== 403) return false;
  return !/json/i.test(resp.headers.get('content-type') || '');
}

/** True when the request was redirected to an upstream maintenance page. */
export function isMaintenanceRedirect(resp: Pick<Response, 'redirected' | 'url'>): boolean {
  if (!resp.redirected || !resp.url) return false;
  try {
    const u = new URL(resp.url);
    return /(^|\.)maintenance\./i.test(u.hostname) || /\/maintenance\b/i.test(u.pathname);
  } catch {
    return false;
  }
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return 'a maintenance page'; }
}
