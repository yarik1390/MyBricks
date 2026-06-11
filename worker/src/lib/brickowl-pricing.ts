import type { Env } from '../types';
import { fetchTracked } from './http';

export interface BrickOwlPricing {
  new_value: number | null;
  used_value: number | null;
}

export async function fetchBrickOwlPricing(
  setNum: string,
  env: Env,
  options: { recordHealth?: boolean; retries?: number; timeoutMs?: number } = {},
): Promise<BrickOwlPricing | null> {
  if (!env.BRICKOWL_API_KEY) return null;
  const id = setNum.replace(/-\d+$/, '');
  try {
    // Step 1: look up BrickOwl object ID for this set
    const lookupParams = new URLSearchParams({ key: env.BRICKOWL_API_KEY, id, type: 'set', id_type: 'brickset' });
    const lookupResp = await fetchTracked(
      env, 'brickowl',
      `https://api.brickowl.com/v1/catalog/lookup?${lookupParams}`,
      { headers: { Accept: 'application/json' } },
      {
        okStatuses: [404],
        record: options.recordHealth !== false,
        retries: options.retries,
        timeoutMs: options.timeoutMs,
      },
    );
    if (!lookupResp.ok) return null;
    const lookupData = await lookupResp.json() as Array<{ boid?: string }> | { boid?: string };
    const lookupItem = Array.isArray(lookupData) ? lookupData[0] : lookupData;
    const boid = lookupItem?.boid;
    if (!boid) return null;

    // Step 2: fetch price data for the BrickOwl object
    const priceParams = new URLSearchParams({ key: env.BRICKOWL_API_KEY, boid, currency: 'USD' });
    const priceResp = await fetchTracked(
      env, 'brickowl',
      `https://api.brickowl.com/v1/catalog/price_data?${priceParams}`,
      { headers: { Accept: 'application/json' } },
      {
        okStatuses: [404],
        record: options.recordHealth !== false,
        retries: options.retries,
        timeoutMs: options.timeoutMs,
      },
    );
    if (!priceResp.ok) return null;
    const price = await priceResp.json() as {
      med_new?: number | string | null;
      med_used?: number | string | null;
      total_new?: number;
      total_used?: number;
    };

    const newVal = parseFloat(String(price.med_new || '')) || null;
    const usedVal = parseFloat(String(price.med_used || '')) || null;
    if (!newVal && !usedVal) return null;
    return { new_value: newVal, used_value: usedVal };
  } catch {
    return null;
  }
}
