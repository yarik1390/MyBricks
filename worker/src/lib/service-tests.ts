import type { Env } from '../types';
import { fetchSetPricing } from './bricklink';
import { fetchEbayActiveListings } from './ebay';
import { configuredKeys } from './brightdata-keys';
import { configuredKeys as pricesApiKeys } from './pricesapi-keys';

// ---------------------------------------------------------------------------
// On-demand per-service health probes for the admin console. Each probe is
// CHEAP and safe: a connectivity/auth check or a single minimal call — never a
// full backfill. Reuses the real signed fetchers for OAuth providers (BrickLink,
// eBay) so the test exercises the actual credential path. Every probe fails
// closed to { ok:false } and never throws.
// ---------------------------------------------------------------------------

export interface ServiceTestResult {
  service: string;
  ok: boolean;
  status: string;      // 'ok' | 'unconfigured' | 'error' | 'degraded'
  detail: string;
  ms: number;
}

const TEST_SET = '75192-1';

async function http(
  method: string,
  url: string,
  opts: { headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<{ status: number | null; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    const r = await fetch(url, { method, headers: opts.headers, body: opts.body, signal: ctrl.signal });
    const text = await r.text();
    return { status: r.status, text };
  } catch (e) {
    return { status: null, text: `${(e as Error).name}: ${(e as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

const configured = (detail: string): { ok: boolean; status: string; detail: string } =>
  ({ ok: false, status: 'unconfigured', detail });
const ok = (detail: string) => ({ ok: true, status: 'ok', detail });
const err = (detail: string) => ({ ok: false, status: 'error', detail });

type Probe = (env: Env) => Promise<{ ok: boolean; status: string; detail: string }>;

const PROBES: Record<string, Probe> = {
  async d1(env) {
    try {
      const r = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
      return r?.ok === 1 ? ok('D1 query returned') : err('unexpected D1 result');
    } catch (e) { return err((e as Error).message); }
  },

  async supabase(env) {
    if (!env.SUPABASE_URL) return configured('SUPABASE_URL not set');
    const r = await http('GET', `${String(env.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/health`, {
      headers: env.SUPABASE_ANON_KEY ? { apikey: String(env.SUPABASE_ANON_KEY) } : {},
    });
    return r.status && r.status < 500 ? ok(`auth health HTTP ${r.status}`) : err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async rebrickable(env) {
    if (!env.REBRICKABLE_API_KEY) return configured('REBRICKABLE_API_KEY not set');
    const r = await http('GET', 'https://rebrickable.com/api/v3/lego/sets/?page_size=1', {
      headers: { Authorization: `key ${env.REBRICKABLE_API_KEY}`, Accept: 'application/json' },
    });
    return r.status === 200 ? ok('catalog reachable, key valid') : err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async brickset(env) {
    if (!env.BRICKSET_API_KEY) return configured('BRICKSET_API_KEY not set');
    const r = await http('GET', `https://brickset.com/api/v3.asmx/checkKey?apiKey=${encodeURIComponent(String(env.BRICKSET_API_KEY))}`);
    try {
      const j = JSON.parse(r.text) as { status?: string };
      return j.status === 'success' ? ok('checkKey: success') : err(`checkKey: ${j.status ?? r.text.slice(0, 80)}`);
    } catch { return err(`HTTP ${r.status}: ${r.text.slice(0, 100)}`); }
  },

  async brickinsights() {
    const r = await http('GET', `https://brickinsights.com/api/sets/${TEST_SET}`, { headers: { Accept: 'application/json' } });
    return r.status === 200 ? ok('public API returned a rating') : err(`HTTP ${r.status}`);
  },

  async bricklink(env) {
    if (!env.BRICKLINK_CONSUMER_KEY) return configured('BRICKLINK_CONSUMER_KEY not set');
    try {
      const p = await fetchSetPricing(TEST_SET, env, { recordHealth: false });
      return p ? ok('signed price fetch OK') : err('signed call returned no data (check OAuth creds)');
    } catch (e) { return err((e as Error).message); }
  },

  async ebay(env) {
    if (!env.EBAY_APP_ID || !env.EBAY_CLIENT_SECRET) return configured('EBAY_APP_ID / EBAY_CLIENT_SECRET not set');
    try {
      const r = await fetchEbayActiveListings(TEST_SET, 'LEGO', env, { recordHealth: false });
      return r ? ok('OAuth token + Browse search OK') : err('no result (check eBay credentials)');
    } catch (e) { return err((e as Error).message); }
  },

  async brightdata(env) {
    const keys = configuredKeys(env);
    if (!keys.length) return configured('no BRIGHTDATA_API_TOKEN(S)');
    const zone = String(env.BRIGHTDATA_ZONE || 'web_unlocker1');
    // Test EVERY configured token, not just the first. A single bad/rejected token
    // must not make the whole service look down — real scraping rotates to a live
    // key (that's why "Last OK" can be recent while a stale keys[0] 400s here).
    const results = await Promise.all(keys.map(async (key, i) => {
      const r = await http('POST', 'https://api.brightdata.com/request', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone, url: 'https://geo.brdtest.com/welcome.txt?product=unlocker&method=api', format: 'raw' }),
        timeoutMs: 25000,
      });
      // Index + last-4 fingerprint so the admin can pinpoint WHICH token to drop
      // (index 0 = BRIGHTDATA_API_TOKEN, then the BRIGHTDATA_API_TOKENS comma list
      // in order). Only the last 4 chars are exposed — safe in an admin-only probe.
      return { i, tail: key.slice(-4), status: r.status, text: r.text };
    }));
    const good = results.filter((r) => r.status === 200).length;
    const bad = results.filter((r) => r.status !== 200);
    if (good === keys.length) return ok(`all ${keys.length} key(s) OK on zone '${zone}'`);
    const badList = bad
      .map((b) => `#${b.i} (…${b.tail}) HTTP ${b.status}: ${String(b.text).slice(0, 40)}`)
      .join('; ');
    const detail = `${good}/${keys.length} key(s) OK on '${zone}'; ${keys.length - good} rejected → ${badList}`
      + '. Remove the rejected token(s) from BRIGHTDATA_API_TOKENS (index 0 = BRIGHTDATA_API_TOKEN, then the comma list in order).';
    // Some keys work → the service is usable; flag as degraded, not down.
    if (good > 0) return { ok: true, status: 'degraded', detail };
    return err(detail);
  },

  async firecrawl(env) {
    const key = env.FIRECRAWL_API_KEY || (env.FIRECRAWL_API_KEYS?.split(',').map((k) => k.trim()).find(Boolean));
    if (!key) return configured('no FIRECRAWL_API_KEY(S)');
    const r = await http('POST', 'https://api.firecrawl.dev/v2/scrape', {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
      timeoutMs: 25000,
    });
    return r.status === 200 ? ok('scrape OK (~1 credit)') : err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async brickeconomy(env) {
    // BrickEconomy is scraped via Firecrawl; a Firecrawl-key check is the proxy.
    const res = await PROBES.firecrawl(env);
    return { ok: res.ok, status: res.status, detail: `via Firecrawl — ${res.detail}` };
  },

  async pricecharting(env) {
    if (!env.PRICECHARTING_TOKEN) return configured('PRICECHARTING_TOKEN not set');
    // Use the real /api/products search path. The per-set /api/product?id= call
    // needs PriceCharting's OWN numeric product id, so passing a LEGO set number
    // ("lego-75192-1") always returns "No such product" even with a perfectly
    // valid token — a false negative. A search returns a products array whenever
    // the token is accepted.
    const t = encodeURIComponent(String(env.PRICECHARTING_TOKEN));
    const r = await http('GET', `https://www.pricecharting.com/api/products?q=${encodeURIComponent('lego star wars')}&t=${t}`);
    try {
      const j = JSON.parse(r.text) as { status?: string; 'error-message'?: string; products?: unknown[] };
      if (j.status === 'success' || Array.isArray(j.products)) {
        const n = Array.isArray(j.products) ? j.products.length : 0;
        return ok(`token valid — search returned ${n} product(s)`);
      }
      return err(j['error-message'] || `unexpected response: ${r.text.slice(0, 80)}`);
    } catch { return err(`HTTP ${r.status}: ${r.text.slice(0, 100)}`); }
  },

  async pricesapi(env) {
    const keys = pricesApiKeys(env);
    if (!keys.length) return configured('no key (set PRICE_API_KEYS or PRICESAPI_API_KEYS)');
    // Live pricesAPI calls are 30-90s each — don't spend one on a health check.
    return ok(`${keys.length} key(s) present (a live call takes ~30-90s; use Populate → Run pricesAPI to spend one)`);
  },

  async openrouter() {
    const r = await http('GET', 'https://openrouter.ai/api/v1/models', { timeoutMs: 12000 });
    return r.status === 200 ? ok('models endpoint reachable') : err(`HTTP ${r.status}`);
  },

  async gemini(env) {
    if (!env.GEMINI_API_KEY) return configured('GEMINI_API_KEY not set');
    const r = await http('GET', `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(String(env.GEMINI_API_KEY))}`, { timeoutMs: 12000 });
    return r.status === 200 ? ok('key valid, models listed') : err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async openai(env) {
    if (!env.OPENAI_API_KEY) return configured('OPENAI_API_KEY not set');
    const r = await http('GET', 'https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, timeoutMs: 12000 });
    return r.status === 200 ? ok('key valid, models listed') : err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async resend(env) {
    if (!env.RESEND_API_KEY) return configured('RESEND_API_KEY not set');
    const r = await http('GET', 'https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, timeoutMs: 12000 });
    if (r.status === 200) return ok('key valid (full access)');
    // A send-only ("restricted") Resend key can't list domains but is valid for
    // its only job here — sending transactional email. Resend returns 401 with
    // name "restricted_api_key" for such keys; a genuinely bad key returns a
    // different error. Treat the restricted case as healthy, not a failure.
    if (r.status === 401 || r.status === 403) {
      try {
        const j = JSON.parse(r.text) as { name?: string; message?: string };
        if (j.name === 'restricted_api_key' || /restricted to only send/i.test(String(j.message || ''))) {
          return ok('key valid (send-only scope — can send email, cannot list domains)');
        }
      } catch { /* fall through to error */ }
    }
    return err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async turnstile(env) {
    return env.TURNSTILE_SITE_KEY ? ok('site key configured') : configured('TURNSTILE_SITE_KEY not set');
  },
  async patreon(env) {
    return env.PATREON_URL ? ok(`configured (${String(env.PATREON_URL).slice(0, 60)})`) : configured('PATREON_URL not set');
  },
  async push(env) {
    return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? ok('VAPID keys configured') : configured('VAPID keys not set');
  },
};

export const TESTABLE_SERVICES = Object.keys(PROBES);

/** Run a single service's probe. Unknown service -> null. Always resolves. */
export async function runServiceTest(env: Env, service: string): Promise<ServiceTestResult | null> {
  const probe = PROBES[service];
  if (!probe) return null;
  const t0 = Date.now();
  try {
    const r = await probe(env);
    return { service, ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { service, ok: false, status: 'error', detail: (e as Error).message, ms: Date.now() - t0 };
  }
}
