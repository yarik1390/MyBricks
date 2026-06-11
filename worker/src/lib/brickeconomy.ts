import type { Env } from '../types';
import { fetchTracked } from './http';

export interface BrickEconomyDetails {
  retail_price_us: number | null;
  current_value_new: number | null;
  current_value_used: number | null;
  forecast_value_new_2_years: number | null;
  rolling_growth_12months: number | null;
}

// Cached entries may have been written by an older Worker version with a
// narrower shape — missing fields come back as undefined, which D1's bind()
// rejects with D1_TYPE_ERROR. Normalize every field to number-or-null.
function normalizeDetails(raw: Partial<BrickEconomyDetails> | null): BrickEconomyDetails | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    retail_price_us: num(raw.retail_price_us),
    current_value_new: num(raw.current_value_new),
    current_value_used: num(raw.current_value_used),
    forecast_value_new_2_years: num(raw.forecast_value_new_2_years),
    rolling_growth_12months: num(raw.rolling_growth_12months),
  };
}

export async function fetchBrickEconomyDetails(
  setNum: string,
  env: Env,
  options: { recordHealth?: boolean; retries?: number; timeoutMs?: number } = {},
): Promise<BrickEconomyDetails | null> {
  const apiKey = env.BRICKECONOMY_API_KEY;
  if (!apiKey) return null;

  try {
    // Ensure variation variation suffix exists (e.g. "10236-1")
    const formattedSetNum = setNum.includes('-') ? setNum : `${setNum}-1`;
    const cacheKey = `be:${formattedSetNum}`;

    if (env.CACHE_KV) {
      const cached = normalizeDetails(await env.CACHE_KV.get(cacheKey, 'json'));
      if (cached) return cached;
    }

    const resp = await fetchTracked(
      env,
      'brickeconomy',
      `https://www.brickeconomy.com/api/v1/set/${encodeURIComponent(formattedSetNum)}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MyBricksApp/1.0',
          'x-apikey': apiKey,
        },
      },
      {
        okStatuses: [400, 404],
        record: options.recordHealth !== false,
        retries: options.retries,
        timeoutMs: options.timeoutMs,
      }
    );

    if (!resp.ok) {
      console.warn(`[brickeconomy] API error: ${resp.status} for ${formattedSetNum}`);
      return null;
    }

    const json = await resp.json() as {
      data?: {
        retail_price_us?: number;
        current_value_new?: number;
        current_value_used?: number;
        forecast_value_new_2_years?: number;
        rolling_growth_12months?: number;
      };
    };

    if (!json || !json.data) return null;

    const d = json.data;
    const result: BrickEconomyDetails = {
      retail_price_us: typeof d.retail_price_us === 'number' ? d.retail_price_us : null,
      current_value_new: typeof d.current_value_new === 'number' ? d.current_value_new : null,
      current_value_used: typeof d.current_value_used === 'number' ? d.current_value_used : null,
      forecast_value_new_2_years: typeof d.forecast_value_new_2_years === 'number' ? d.forecast_value_new_2_years : null,
      rolling_growth_12months: typeof d.rolling_growth_12months === 'number' ? d.rolling_growth_12months : null,
    };

    if (env.CACHE_KV) {
      env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 21600 }).catch(() => {});
    }

    return result;
  } catch (err) {
    console.error('[brickeconomy] Error fetching details:', err);
    return null;
  }
}
