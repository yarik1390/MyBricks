import { test as base, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared fixtures for the smoke suite.
//
// `stub` fixture (auto): before any page script runs it injects a fake signed-in
// Supabase session into localStorage (the app reads localStorage["bv_session"] and
// only base64-decodes the JWT `sub` client-side — no signature check, the Worker
// verifies in prod), and intercepts EVERY /api/* request with deterministic JSON.
// It also records calls so tests can assert which endpoints fired.
// ---------------------------------------------------------------------------

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
// Well-formed JWT (header.payload.sig) — only the payload's `sub` is read client-side.
const FAKE_JWT = [
  b64url({ alg: 'HS256', typ: 'JWT' }),
  b64url({ sub: 'e2e-test-user', aud: 'authenticated', role: 'authenticated', exp: FAR_FUTURE }),
  'e2e-signature-not-verified-client-side',
].join('.');
const SESSION = {
  access_token: FAKE_JWT, refresh_token: 'e2e-refresh', token_type: 'bearer',
  expires_at: FAR_FUTURE, user: { id: 'e2e-test-user', email: 'e2e@brickvault.test' },
};

// Canonical set used across collection / search / detail so assertions line up.
// Carries the blended market provenance fields (market_value_*) the way the
// Worker's enrichSetRecord emits them, so the trust UI (provenance line,
// confidence chip) renders in tests exactly as in production.
export const SET = {
  set_num: '75192-1', name: 'Millennium Falcon', year: 2017, pieces: 7541, minifigs: 4,
  theme: 'Star Wars', subtheme: 'Ultimate Collector Series', image_url: null,
  retail_price: 849.99, current_value: 850, blended_value: 850,
  blended_confidence: 'high', blended_low: 800, blended_high: 900,
  valuation_method: 'market', retired: 1, forecast_2y: 950, forecast_5y: 1100,
  market_value: 850, market_value_low: 800, market_value_high: 900,
  market_value_confidence: 'high',
  market_value_basis: [{ id: 'pc_new' }, { id: 'bl_new' }, { id: 'ebay_new' }],
};

// Formula-valued set (no market data survived) — exercises the "~ estimate"
// styling: humble value label, ~ prefix, and the no-market-sales provenance.
export const EST_SET = {
  set_num: '4000-1', name: 'Formula Test Set', year: 2015, pieces: 400, minifigs: 0,
  theme: 'Creator', image_url: null,
  retail_price: 39.99, current_value: 42,
  valuation_method: 'formula_bulk', retired: 0,
};

function handlers(calls) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const m = req.method();

    // Keep the suite hermetic + fast: allow the app's own same-origin assets
    // (localhost) through to the static server, and BLOCK any external host
    // (Google Fonts, CDNs, Turnstile) so no real network call can stall a load.
    if (!p.startsWith('/api/')) {
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue();
      return route.abort();
    }

    calls.push({ method: m, path: p });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    // Match the real Worker shape: it always includes English
    // `recommended_action` prose. The integrations UI must instead render its
    // stable, localizable guidance from the configured/missing state.
    if (p === '/api/config') return json({
      supabase_url: 'https://stub.supabase.co', supabase_anon_key: 'stub-anon-key', patreon_url: 'https://www.patreon.com/c/BricksVault',
      status: { google: false },
      setup: { google: {
        configured: false,
        missing_secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
        recommended_action: 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as GitHub Actions secrets; the deploy workflow uploads them to Worker secrets.',
      } },
    });
    if (p === '/api/rates') return json({ base: 'USD', rates: { USD: 1, EUR: 0.92, GBP: 0.79 } });
    // NO is_admin/is_public here on purpose: a smoke test asserts a non-admin is
    // bounced off /me/admin, so this profile must stay non-admin. The i18n audit
    // needs those rows to RENDER and overrides this route itself.
    if (p === '/api/me') return json({ display_name: 'Test Collector', handle: 'tester', currency: 'USD', is_guest: false, notify_price_drops: true, portfolio_stats: {} });
    if (p === '/api/collection' && m === 'GET') return json({ items: [{ id: 1, quantity: 1, purchase_price: 700, ...SET }], total_value: 850, total_paid: 700, count: 1 });
    // Free tier by default (pro:false) so the Insights gate + locked range
    // pills render; Pro tests override this route per-test.
    if (p.startsWith('/api/collection/history')) return json({ snapshots: [], days: 90, pro: false });
    if (p === '/api/wishlist' && m === 'GET') return json({ wishlist: [{ id: 'w1', set_num: SET.set_num, name: SET.name }], unread_alerts: 0 });
    if (p === '/api/wishlist' && m === 'POST') return json({ item: { id: 'w2', set_num: SET.set_num } });
    if (p.startsWith('/api/wishlist/') && m === 'DELETE') return json({ ok: true });
    // Shape must match worker/src/routes/themes.ts: FLAT STRING ARRAYS, not
    // objects. The fixture used to return [{ id, name }], which cleanFacetList
    // silently drops (it skips non-strings) — so the catalog rendered zero theme
    // chips under test, and before that guard existed it rendered a chip reading
    // "[object Object]", which is what the committed store screenshots captured.
    if (p === '/api/themes') return json({ themes: ['Star Wars'], theme_groups: ['Licensed'], categories: ['Sets'] });
    if (p === '/api/users/tester/profile') return json({
      handle: 'tester', display_name: 'Test Collector', is_supporter: false,
      approved_contributions: 0, showcase: [], expose_public_value: true,
      collection_count: 1, collection_value: 850,
    });
    if (p === '/api/upcoming') return json({ items: [] });
    if (p === '/api/sets/search') return json({ sets: [SET], total: 1, hasMore: false });
    if (p.startsWith('/api/sets/4000-1')) return json({ set: EST_SET, entry: null });
    if (p.startsWith('/api/sets/')) return json({ set: SET, entry: null });
    // Benign fallback so an unenumerated endpoint never errors a view under test.
    return json({});
  };
}

export const test = base.extend({
  stub: [async ({ page }, use) => {
    const calls = [];
    await page.addInitScript((session) => {
      try {
        localStorage.setItem('bv_session', JSON.stringify(session));
        // Suppress the first-run setup wizard + coach-mark tour, whose modal
        // overlay would otherwise intercept clicks (e.g. the wishlist toggle).
        localStorage.setItem('bv_setup_v1', '1');
        localStorage.setItem('bv_welcome_v1', '1');
        localStorage.setItem('bv_onboarded_v1', '1');
      } catch {}
    }, SESSION);
    // Single route over ALL requests: API mocks + same-origin passthrough +
    // external-host blocking (see handlers()).
    await page.route('**/*', handlers(calls));
    await use({ calls, SET, SESSION });
  }, { auto: true }],
});

export { expect };
