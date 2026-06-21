import type { Env } from '../types';
import { brickInsightsEnabled } from './pricing-flags';
import { fetchWithRetry } from './http';

export interface BrickInsightsRating {
  rating: number | null;        // aggregate review score 0-100
  review_count: number | null;
  url: string | null;
}

const BASE = 'https://brickinsights.com/api/sets';

// Per-set review-score lookup against the owner-documented BrickInsights JSON
// endpoint (60/min). set_id matches our set_num (e.g. "75192-1"). THROWS on a
// transport/HTTP failure so callers can aggregate health; returns null when the
// set simply isn't reviewed there (the API answers HTTP 200 { error: ... }).
export async function fetchBrickInsightsRating(
  setNum: string,
  env: Env,
  options: { timeoutMs?: number } = {},
): Promise<BrickInsightsRating | null> {
  if (!brickInsightsEnabled(env)) return null;
  // fetchWithRetry supplies the timeout (was a manual AbortController) AND a retry
  // on transient 5xx/429 this lookup previously lacked. Still THROWS on a hard HTTP
  // failure so the job's aggregate health tally records it.
  const resp = await fetchWithRetry(`${BASE}/${encodeURIComponent(setNum)}`, {
    headers: { Accept: 'application/json' },
  }, { timeoutMs: options.timeoutMs ?? 8000 });
  if (!resp.ok) throw new Error(`BrickInsights HTTP ${resp.status}`);
  const data = await resp.json() as {
    error?: string;
    average_rating?: string | number;
    review_count?: string | number;
    url?: string;
  };
  if (data.error) return null;
  const rating = data.average_rating != null ? Math.round(Number(data.average_rating)) : NaN;
  if (!Number.isFinite(rating)) return null;
  const reviews = data.review_count != null ? Math.round(Number(data.review_count)) : null;
  return {
    rating,
    review_count: Number.isFinite(reviews as number) ? (reviews as number) : null,
    url: typeof data.url === 'string' && data.url ? data.url : null,
  };
}
