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
