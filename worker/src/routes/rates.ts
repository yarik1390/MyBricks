import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Simple in-process cache — valid for one Worker isolate lifetime (~a few minutes).
// Good enough to avoid hitting the external API on every frontend page load.
let ratesCache: { rates: Record<string, number>; fetched: number } | null = null;

app.get('/', async (c) => {
  const now = Date.now();
  if (ratesCache && now - ratesCache.fetched < 6 * 3_600_000) {
    return c.json({ rates: ratesCache.rates, cached: true });
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error(`er-api ${res.status}`);
    const json = await res.json() as { rates?: Record<string, number> };
    if (!json.rates) throw new Error('no rates');
    ratesCache = { rates: json.rates, fetched: now };
    return c.json({ rates: json.rates, cached: false });
  } catch (e) {
    if (ratesCache) return c.json({ rates: ratesCache.rates, cached: true, stale: true });
    console.warn('[rates] FX fetch failed:', (e as Error).message);
    return c.json({ rates: { USD: 1 }, cached: false, error: 'Exchange rate data temporarily unavailable' }, 503);
  }
});

export { app as ratesRoute };
