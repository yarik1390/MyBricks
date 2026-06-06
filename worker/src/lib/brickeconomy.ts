import type { Env } from '../types';
import { fetchWithRetry } from './http';

export interface BrickEconomyDetails {
  retail_price_us: number | null;
  current_value_new: number | null;
  current_value_used: number | null;
  forecast_value_new_2_years: number | null;
  rolling_growth_12months: number | null;
}

export async function fetchBrickEconomyDetails(
  setNum: string,
  env: Env,
): Promise<BrickEconomyDetails | null> {
  const apiKey = env.BRICKECONOMY_API_KEY;
  if (!apiKey) return null;

  try {
    // Ensure variation variation suffix exists (e.g. "10236-1")
    const formattedSetNum = setNum.includes('-') ? setNum : `${setNum}-1`;

    const resp = await fetchWithRetry(
      `https://www.brickeconomy.com/api/v1/set/${encodeURIComponent(formattedSetNum)}`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MyBricksApp/1.0',
          'x-apikey': apiKey,
        },
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
    return {
      retail_price_us: typeof d.retail_price_us === 'number' ? d.retail_price_us : null,
      current_value_new: typeof d.current_value_new === 'number' ? d.current_value_new : null,
      current_value_used: typeof d.current_value_used === 'number' ? d.current_value_used : null,
      forecast_value_new_2_years: typeof d.forecast_value_new_2_years === 'number' ? d.forecast_value_new_2_years : null,
      rolling_growth_12months: typeof d.rolling_growth_12months === 'number' ? d.rolling_growth_12months : null,
    };
  } catch (err) {
    console.error('[brickeconomy] Error fetching details:', err);
    return null;
  }
}
