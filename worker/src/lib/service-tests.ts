import type { Env } from '../types';
import { fetchSetPricing } from './bricklink';
import { fetchEbayActiveListings } from './ebay';
import { configuredFirecrawlKeys, isCreditExhaustion } from './firecrawl-keys';
import { configuredBrightDataTokens, brightDataEnabled } from './brightdata-keys';
import { openCodexClient } from './opencodex';
import { firebasePushConfigured, probeFirebaseAccess } from './firebase-push';
import { geminiUrl, gatewayHeaders } from './llm';

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

  async firecrawl(env) {
    const keys = configuredFirecrawlKeys(env);
    if (!keys.length) return configured('no FIRECRAWL_API_KEY(S)');
    // Test EVERY configured key, not just the first. Keys drain IN ORDER
    // (lib/firecrawl-keys.ts) — FIRECRAWL_API_KEY is a one-time allotment spent
    // first, so it's routinely the one sitting at zero while later pooled keys
    // still have real balance. Testing only keys[0] (the old behavior) reported
    // "insufficient credits" forever once that first allotment was gone, even
    // right after confirming the account had 600k+ credits on a later key and
    // resetting the exhausted-latch — the probe was just never asking key #2.
    const results = await Promise.all(keys.map(async (key, i) => {
      const r = await http('POST', 'https://api.firecrawl.dev/v2/scrape', {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
        timeoutMs: 25000,
      });
      // Index + last-4 fingerprint so the admin can tell which key is actually
      // dead (index 0 = FIRECRAWL_API_KEY, then the FIRECRAWL_API_KEYS comma
      // list in order).
      return { i, tail: key.slice(-4), status: r.status, text: r.text };
    }));
    const good = results.filter((r) => r.status === 200);
    const bad = results.filter((r) => r.status !== 200);
    if (good.length === keys.length) return ok(`all ${keys.length} key(s) OK (~1 credit each)`);
    const badList = bad
      .map((b) => `#${b.i} (…${b.tail}) HTTP ${b.status}: ${isCreditExhaustion(b.status ?? 0, String(b.text)) ? 'out of credits' : String(b.text).slice(0, 60)}`)
      .join('; ');
    const detail = `${good.length}/${keys.length} key(s) OK; ${bad.length} rejected → ${badList}`
      + '. A drained one-time allotment is expected here and is not a problem by itself — pickFirecrawlKey() already skips it for real scrapes as long as a later key is OK.';
    // Some keys work → the service is usable; flag as degraded, not down.
    if (good.length > 0) return { ok: true, status: 'degraded', detail };
    return err(detail);
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

  // With a key, /key checks the credential itself (free, no tokens spent);
  // the public /models list only proved the site was up.
  async openrouter(env) {
    const key = (env.OPENROUTER_API_KEY ?? '').trim();
    if (!key) {
      const r = await http('GET', 'https://openrouter.ai/api/v1/models', { timeoutMs: 12000 });
      return r.status === 200 ? ok('models endpoint reachable') : err(`HTTP ${r.status}`);
    }
    const r = await http('GET', 'https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 12000 });
    return r.status === 200 ? ok('key valid') : err(`HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },

  async opencodex(env) {
    const client = openCodexClient(env);
    if (!client) return configured('OPENCODEX_API_KEY / base URL not set');
    try {
      const list = await client.models.list();
      return ok(`gateway reachable, ${list.data?.length ?? 0} model(s) listed`);
    } catch (e) { return err((e as Error).message); }
  },

  async firebase(env) {
    if (!firebasePushConfigured(env)) return configured('FIREBASE_SERVICE_ACCOUNT_JSON not set');
    try {
      await probeFirebaseAccess(env);
      return ok('service account minted an FCM access token');
    } catch (e) { return err((e as Error).message); }
  },

  async gemini(env) {
    if (!env.GEMINI_API_KEY) return configured('GEMINI_API_KEY not set');
    // A one-token generation, not just a model list: on 2026-11-07 the key
    // listed models fine while every real generateContent call got HTTP 401,
    // so the list check reported healthy and cleared the routing pause. Costs
    // a few input tokens (well under $0.0001).
    const r = await http('POST', `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`, {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(env.GEMINI_API_KEY) },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
      timeoutMs: 12000,
    });
    return r.status === 200 ? ok('key valid, generation works') : err(`HTTP ${r.status}: ${r.text.slice(0, 160)}`);
  },

  // Cloudflare AI Gateway: one Gemini token THROUGH the gateway, with the
  // gateway token. Real calls quietly retry direct when the gateway refuses
  // them (lib/ai-gateway.ts), so without this nothing shows whether
  // AI_GATEWAY_TOKEN is accepted. Raw fetch here: no fallback.
  async aigateway(env) {
    if (!env.GEMINI_API_KEY) return configured('GEMINI_API_KEY not set (the probe uses Gemini)');
    const url = geminiUrl('gemini-3.5-flash-lite', { env, routeThroughGateway: true });
    if (!url.startsWith('https://gateway.ai.cloudflare.com/')) return configured('AI_GATEWAY_ACCOUNT_ID / AI_GATEWAY_ID not set');
    const r = await http('POST', url, {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(env.GEMINI_API_KEY), ...gatewayHeaders(env) },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } }),
      timeoutMs: 12000,
    });
    if (r.status === 200) return ok(env.AI_GATEWAY_TOKEN ? 'gateway accepted the token, generation works' : 'gateway open (no token needed), generation works');
    if (r.status === 401 && /"code"\s*:\s*2009\b/.test(r.text)) {
      return err(env.AI_GATEWAY_TOKEN ? 'gateway refused AI_GATEWAY_TOKEN (code 2009): token wrong or revoked' : 'gateway requires a token (code 2009) and AI_GATEWAY_TOKEN is not set');
    }
    return err(`HTTP ${r.status}: ${r.text.slice(0, 160)}`);
  },

  // Groq: free key check (model list, no tokens), so Admin has same-day
  // evidence for the scan step even on days nobody's scan reaches it.
  async groq(env) {
    const key = (env.GROQ_API_KEY ?? '').trim();
    if (!key) return configured('GROQ_API_KEY not set');
    const r = await http('GET', 'https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` }, timeoutMs: 12000 });
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

  // Real secret health, not just "is a variable set".
  //
  // The old probe only checked TURNSTILE_SITE_KEY and reported ok, which is
  // worthless for the failure that actually happens: the site key is fine and
  // the SECRET belongs to a different or deleted widget, so every browser
  // token verifies as invalid and photo scanning 403s.
  //
  // siteverify separates the two by error code, so a deliberately bogus token
  // tests the secret alone:
  //   invalid-input-response -> secret is good; it rejected our fake token
  //   invalid-input-secret   -> the secret matches no widget
  async turnstile(env) {
    if (!env.TURNSTILE_SITE_KEY) return configured('TURNSTILE_SITE_KEY not set');
    if (!env.TURNSTILE_SECRET_KEY) {
      // Site key without a secret is a valid, deliberate state: the server-side
      // gate is skipped entirely, so scanning works and no token is demanded.
      return ok('site key set, no secret — bot check is disabled');
    }
    const r = await http('POST', 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: 'probe-not-a-real-token' }).toString(),
    });
    if (r.status !== 200) return err(`siteverify HTTP ${r.status}`);
    try {
      const j = JSON.parse(r.text) as { success?: boolean; 'error-codes'?: string[] };
      const codes = j['error-codes'] || [];
      if (codes.includes('invalid-input-secret')) {
        return err('TURNSTILE_SECRET_KEY matches no widget — it is likely from a different or deleted widget than the site key /api/config serves. Photo scanning on the web will 403 until they are from the SAME widget.');
      }
      if (codes.includes('invalid-input-response')) return ok('secret matches a live widget (test token correctly rejected)');
      return err(`unexpected siteverify reply: success=${j.success} codes=${codes.join(',') || 'none'}`);
    } catch { return err(`unparseable siteverify reply: ${r.text.slice(0, 100)}`); }
  },
  async patreon(env) {
    return env.PATREON_URL ? ok(`configured (${String(env.PATREON_URL).slice(0, 60)})`) : configured('PATREON_URL not set');
  },
  async push(env) {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return configured('VAPID keys not set');
    try {
      const { probeVapidKeys } = await import('./webpush');
      await probeVapidKeys(env);
      return ok('VAPID keypair loads as a signing key');
    } catch (e) { return err(`VAPID keypair does not load: ${(e as Error).message}`); }
  },
  // Google OAuth client: a refresh with a dummy token. Google answers
  // invalid_grant when the client id/secret are valid, invalid_client when not.
  async google(env) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return configured('Google OAuth client not set');
    const body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: 'health-probe',
      client_id: String(env.GOOGLE_CLIENT_ID), client_secret: String(env.GOOGLE_CLIENT_SECRET),
    }).toString();
    const r = await http('POST', 'https://oauth2.googleapis.com/token', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    if (/invalid_grant/.test(r.text)) return ok('OAuth client accepted (dummy refresh token rejected as expected)');
    if (/invalid_client|unauthorized_client/.test(r.text)) return err(`OAuth client rejected (HTTP ${r.status}): check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET`);
    return err(`unexpected token reply HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  },
  // Bright Data Web Unlocker: proves at least one live token and a real unlock
  // round-trip on a lightweight target. Spends one token credit.
  async brightdata(env) {
    if (!brightDataEnabled(env)) return configured('Bright Data tokens not configured');
    // Name our own daily cap instead of the generic "no usable page" when that
    // is the only reason the unlock was skipped.
    const { quotaRemaining } = await import('./api-quota');
    if ((await quotaRemaining(env, 'brightdata')) < 1) {
      return { ok: true, status: 'degraded', detail: 'daily cap reached (raise it under Pricing sources); tokens were not called' };
    }
    const { brightDataUnlock } = await import('./brightdata');
    const html = await brightDataUnlock('https://example.com/', env, { timeoutMs: 15_000 });
    if (!html || !/example/i.test(html.slice(0, 500))) return err('unlocker returned no usable page');
    // Brickset is the site that has refused the unlocker; check it too so
    // "Test now" names its reason (spends a second unit).
    const bs = await brightDataUnlock('https://brickset.com/sets/10305-1', env, { timeoutMs: 20_000 });
    const tokens = configuredBrightDataTokens(env).length;
    if (bs && /<dt\b/i.test(bs)) return ok(`unlock OK, Brickset OK (${tokens} token(s) configured)`);
    const { getIntegrationHealth } = await import('./integration-health');
    const last = (await getIntegrationHealth(env)).find((r) => r.service === 'brightdata')?.last_error ?? 'no page';
    return { ok: true, status: 'degraded', detail: `unlock OK; Brickset failed: ${String(last).slice(0, 200)} (${tokens} token(s))` };
  },
};

// Decodo: one real scrape of a Brickset page (the site Bright Data can't read).
PROBES.decodo = async (env) => {
  const { decodoConfigured, decodoScrape } = await import('./decodo');
  if (!decodoConfigured(env)) return configured('DECODO_AUTH_TOKEN not set');
  const html = await decodoScrape('https://brickset.com/sets/10305-1', env, { timeoutMs: 25_000 });
  if (html && /<dt\b/i.test(html)) return ok('scrape OK (Brickset page read)');
  const { getIntegrationHealth } = await import('./integration-health');
  const last = (await getIntegrationHealth(env)).find((r) => r.service === 'decodo')?.last_error ?? 'no page';
  return err(`scrape failed: ${String(last).slice(0, 200)}`);
};

// ZenRows: one real scrape of a Brickset page.
PROBES.zenrows = async (env) => {
  const { zenrowsConfigured, zenrowsScrape } = await import('./zenrows');
  if (!zenrowsConfigured(env)) return configured('ZENROWS_API_KEY not set');
  const html = await zenrowsScrape('https://brickset.com/sets/10305-1', env, { timeoutMs: 25_000 });
  if (html && /<dt\b/i.test(html)) return ok('scrape OK (Brickset page read)');
  const { getIntegrationHealth } = await import('./integration-health');
  const last = (await getIntegrationHealth(env)).find((r) => r.service === 'zenrows')?.last_error ?? 'no page';
  return err(`scrape failed: ${String(last).slice(0, 200)}`);
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
