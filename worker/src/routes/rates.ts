import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Simple in-process cache — valid for one Worker isolate lifetime (~a few minutes).
// Good enough to avoid hitting the external API on every frontend page load.
let ratesCache: { rates: Record<string, number>; fetched: number } | null = null;

// KV persistence: isolate memory dies in minutes, so without this every cold
// isolate re-fetched er-api — and an upstream outage on a cold isolate meant a
// 503 with {USD:1}. fx:usd carries the 6h freshness window across isolates;
// fx:usd:last_good never expires and is the ultimate fallback.
const KV_FRESH = 'fx:usd';
const KV_LAST_GOOD = 'fx:usd:last_good';

app.get('/', async (c) => {
  const now = Date.now();
  if (ratesCache && now - ratesCache.fetched < 6 * 3_600_000) {
    return c.json({ rates: ratesCache.rates, cached: true });
  }
  const kv = c.env.CACHE_KV;
  if (kv) {
    try {
      const fresh = await kv.get<Record<string, number>>(KV_FRESH, 'json');
      if (fresh) {
        ratesCache = { rates: fresh, fetched: now };
        return c.json({ rates: fresh, cached: true });
      }
    } catch { /* KV read failure falls through to upstream */ }
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error(`er-api ${res.status}`);
    const json = await res.json() as { rates?: Record<string, number> };
    if (!json.rates) throw new Error('no rates');
    ratesCache = { rates: json.rates, fetched: now };
    if (kv) {
      const body = JSON.stringify(json.rates);
      c.executionCtx.waitUntil(Promise.allSettled([
        kv.put(KV_FRESH, body, { expirationTtl: 21_600 }),
        kv.put(KV_LAST_GOOD, body),
      ]));
    }
    return c.json({ rates: json.rates, cached: false });
  } catch (e) {
    if (ratesCache) return c.json({ rates: ratesCache.rates, cached: true, stale: true });
    if (kv) {
      try {
        const lastGood = await kv.get<Record<string, number>>(KV_LAST_GOOD, 'json');
        if (lastGood) return c.json({ rates: lastGood, cached: true, stale: true });
      } catch { /* fall through to 503 */ }
    }
    console.warn('[rates] FX fetch failed:', (e as Error).message);
    return c.json({ rates: { USD: 1 }, cached: false, error: 'Exchange rate data temporarily unavailable' }, 503);
  }
});

export { app as ratesRoute };
