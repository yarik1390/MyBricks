import type { Env } from '../types';

export interface MarketPricing {
  retail_price: number | null;
  current_value: number | null;
  forecast_2y: number | null;
  forecast_5y: number | null;
  retired: boolean;
}

// In-memory throttle: BrickEconomy allows 4 req/min and 100/day.
// We track per-isolate call count; cron resets it naturally each invocation.
let _callsThisMinute = 0;
let _minuteStart = 0;

function canCall(): boolean {
  const now = Date.now();
  if (now - _minuteStart > 60_000) { _callsThisMinute = 0; _minuteStart = now; }
  if (_callsThisMinute >= 4) return false;
  _callsThisMinute++;
  return true;
}

export async function fetchSetPricing(setNum: string, env: Env): Promise<MarketPricing | null> {
  if (!env.BRICKECONOMY_API_KEY) return null;
  if (!canCall()) return null;

  try {
    const url = `https://www.brickeconomy.com/api/v1/set?key=${encodeURIComponent(env.BRICKECONOMY_API_KEY)}&setid=${encodeURIComponent(setNum)}`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;

    // BrickEconomy returns: retailPrice, currentValue (avg resale), etc.
    const retail = parseFloat(String(data.retailPrice ?? data.retail_price ?? '')) || null;
    const current = parseFloat(String(data.currentValue ?? data.current_value ?? data.value ?? '')) || null;
    if (!current) return null;

    // BrickEconomy doesn't return forecasts directly; derive from their growth rate if present,
    // otherwise use conservative fixed rates (better than our old formula).
    const growthRate = parseFloat(String(data.yearlyGrowth ?? data.annualGrowth ?? '')) || null;
    const yr = growthRate !== null ? growthRate / 100 : 0.12;
    const forecast_2y = current ? Math.round(current * Math.pow(1 + yr, 2) * 100) / 100 : null;
    const forecast_5y = current ? Math.round(current * Math.pow(1 + yr, 5) * 100) / 100 : null;

    const retired = !!(data.retired ?? data.isRetired ?? false);

    return { retail_price: retail, current_value: current, forecast_2y, forecast_5y, retired };
  } catch {
    return null;
  }
}
