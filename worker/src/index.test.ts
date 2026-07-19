/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from './index';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

// Mock openai module completely
vi.mock('openai', () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn().mockImplementation((args: any) => {
          const userMessage = args?.messages?.find((m: any) => m.role === 'user')?.content;
          const promptText = typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage || '');
          const systemMessage = args?.messages?.find((m: any) => m.role === 'system')?.content;
          const systemText = typeof systemMessage === 'string' ? systemMessage : '';
          const content = promptText.includes('Generate an eBay listing')
            ? JSON.stringify({
                title: 'LEGO 75192 Millennium Falcon - Star Wars UCS',
                description: 'Complete LEGO Star Wars UCS Millennium Falcon set with collector appeal.',
                suggested_price: 849,
                price_reasoning: 'Suggested near current market value with room for offers.',
              })
            // Shelf Snap prompt -> many sets, including one not in the catalog
            // (must be dropped by matching, not returned).
            : systemText.includes('COLLECTION on a shelf')
            ? JSON.stringify({
                sets: [
                  { set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: 'UCS dish visible' },
                  { set_num: '10497', name: 'Galaxy Explorer', confidence: 'medium', reasoning: 'Classic space colors' },
                  { set_num: '55555', name: 'Not A Real Set', confidence: 'low', reasoning: 'Partial view' },
                ],
                minifigs: [],
              })
            : JSON.stringify({
                sets: [{ set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: 'Visual match' }]
              });
          return Promise.resolve({ choices: [{ message: { content } }] });
        })
      }
    };
  }
  return {
    default: MockOpenAI
  };
});

// Monkeypatch app.fetch to automatically supply a mock ExecutionContext
const originalAppFetch = app.fetch;
app.fetch = (request: any, env?: any, executionCtx?: any) => {
  const mockCtx = executionCtx || {
    waitUntil: (promise: Promise<any>) => {
      // Keep track of background tasks if needed, or just let them resolve
      promise.catch((err) => console.error('[mock-ctx] Error in background task:', err));
    },
    passThroughOnException: () => {},
  };
  return originalAppFetch(request, env, mockCtx);
};

async function createMockJWT(userId: string, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const b64url = (json: any) => btoa(JSON.stringify(json)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64url(header)}.${b64url(payload)}`;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${unsigned}.${sigB64}`;
}

describe('BrickVault API Worker Tests', () => {
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  let token: string;
  const testUserId = 'test-user-123';
  let db: D1Database;

  beforeEach(async () => {
    // Inject secrets/configs into env
    (env as any).SUPABASE_JWT_SECRET = JWT_SECRET;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'supabase-anon-key-mock';
    (env as any).GOOGLE_CLIENT_ID = 'google-client-id-mock';
    (env as any).GOOGLE_CLIENT_SECRET = 'google-client-secret-mock';
    (env as any).OPENAI_API_KEY = 'openai-api-key-mock';

    token = await createMockJWT(testUserId, JWT_SECRET);
    db = (env as any).DB;

    const sqls = [
      'DROP TABLE IF EXISTS oauth_sessions',
      'DROP TABLE IF EXISTS oauth_states',
      'DROP TABLE IF EXISTS user_collection',
      'DROP TABLE IF EXISTS lego_sets',
      'DROP TABLE IF EXISTS set_market_ext',
      'DROP TABLE IF EXISTS set_valuation_state',
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS user_wishlist',
      'DROP TABLE IF EXISTS user_minifigs',
      'DROP TABLE IF EXISTS kids_badges',
      'DROP TABLE IF EXISTS user_prefs',
      'DROP TABLE IF EXISTS set_value_history',
      'DROP TABLE IF EXISTS minifigs',

      `CREATE TABLE set_value_history (
        set_num TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        current_value REAL,
        ebay_value REAL,
        bl_value REAL,
        PRIMARY KEY (set_num, snapshot_date)
      )`,

      `CREATE TABLE minifigs (
        fig_num TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        series TEXT,
        rarity TEXT DEFAULT 'common',
        current_value REAL,
        image_url TEXT,
        added_at TEXT,
        source TEXT,
        cached_at TEXT,
        year INTEGER,
        num_parts INTEGER,
        appears_in_sets INTEGER
      )`,

      `CREATE TABLE oauth_sessions (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,

      `CREATE TABLE oauth_states (
        state TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,

      `CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        theme TEXT,
        year INTEGER,
        pieces INTEGER,
        minifigs INTEGER DEFAULT 0,
        retail_price REAL,
        current_value REAL,
        forecast_2y REAL,
        forecast_5y REAL,
        image_url TEXT,
        retired INTEGER DEFAULT 0,
        retirement_risk_score INTEGER,
        retirement_risk_updated_at TEXT,
        used_value REAL,
        ebay_value REAL,
        ebay_new_value REAL,
        ebay_used_value REAL,
        ebay_new_qty INTEGER,
        ebay_used_qty INTEGER,
        ebay_new_cached_at TEXT,
        ebay_used_cached_at TEXT,
        ebay_new_last_sold TEXT,
        ebay_used_last_sold TEXT,
        ebay_cached_at TEXT,
        bl_new_value REAL,
        bl_new_qty INTEGER,
        bl_used_qty INTEGER,
        bl_cached_at TEXT,
        be_cached_at TEXT,
        ebay_ask_value REAL,
        ebay_ask_qty INTEGER,
        ebay_ask_cached_at TEXT,
        upc TEXT,
        cached_at TEXT,
        valuation_method TEXT DEFAULT 'formula_bulk',
        valuation_expires_at TEXT,
        source TEXT,
        be_growth_12m REAL,
        be_value_new REAL,
        be_value_used REAL,
        be_forecast_2y REAL,
        be_forecast_5y REAL,
        be_retail REAL,
        bo_new_value REAL,
        bo_used_value REAL,
        bo_new_qty INTEGER,
        bo_used_qty INTEGER,
        bo_cached_at TEXT,
        blended_value REAL,
        blended_confidence TEXT, blended_low REAL, blended_high REAL,
        subtheme TEXT,
        bl_new_min REAL,
        bl_new_max REAL,
        bl_used_min REAL,
        bl_used_max REAL,
        lego_in_stock INTEGER,
        lego_retiring_soon INTEGER,
        lego_availability TEXT,
        age_min INTEGER, age_max INTEGER, brickset_rating REAL, brickset_review_count INTEGER,
        retired_year INTEGER, lego_checked_at TEXT,
        brickinsights_rating INTEGER, brickinsights_review_count INTEGER, brickinsights_url TEXT, brickinsights_cached_at TEXT,
        brickset_msrp REAL, launch_date TEXT, exit_date TEXT, brickset_enriched_at TEXT,
        theme_group TEXT, category TEXT, brickset_tags TEXT,
        brickset_dimensions TEXT, packaging_type TEXT, instructions_count INTEGER, additional_image_count INTEGER,
        brickset_description TEXT, brickset_set_id INTEGER, brickset_image_urls TEXT, brickset_images_cached_at TEXT,
        deal_signal TEXT, deal_discount_pct REAL, deal_strong INTEGER, deal_cached_at TEXT,
        part_out_value REAL, part_out_coverage REAL, part_out_cached_at TEXT,
        pc_new_value REAL, pc_complete_value REAL, pc_id TEXT, pc_cached_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE set_market_ext (
        set_num TEXT PRIMARY KEY,
        pc_loose_value REAL, pc_sales_volume INTEGER,
        pa_retail_value REAL, pa_lowest_offer REAL, pa_in_stock INTEGER,
        pa_best_merchant TEXT, pa_offer_count INTEGER, pa_market TEXT, pa_cached_at TEXT
      )`,

      `CREATE TABLE set_valuation_state (
        set_num TEXT NOT NULL, condition TEXT NOT NULL, fair_value REAL, low REAL, high REAL,
        liquidation_value REAL, confidence TEXT, confidence_score REAL, sample_count INTEGER,
        independent_family_count INTEGER, basis_json TEXT, flags_json TEXT, forecast_json TEXT,
        as_of TEXT, model_version TEXT, updated_at TEXT, PRIMARY KEY (set_num, condition)
      )`,

      `CREATE TABLE user_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        set_num TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        condition TEXT NOT NULL,
        purchase_price REAL,
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        purchased_at TEXT,
        deleted_at TEXT,
        last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
        storage_location TEXT,
        acquisition_source TEXT,
        is_complete INTEGER DEFAULT 1,
        missing_pieces INTEGER DEFAULT 0,
        spike_alerted_at TEXT,
        custom_image_url TEXT,
        UNIQUE(user_id, set_num)
      )`,

      `CREATE TABLE rate_limits (
        user_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        window_start TEXT NOT NULL,
        hit_count INTEGER NOT NULL,
        PRIMARY KEY (user_id, endpoint, window_start)
      )`,

      `CREATE TABLE user_wishlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        set_num TEXT NOT NULL,
        target_price REAL,
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        alerted_at TEXT,
        UNIQUE(user_id, set_num)
      )`,

      `CREATE TABLE user_minifigs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        fig_num TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, fig_num)
      )`,

      `CREATE TABLE user_prefs (
        user_id TEXT PRIMARY KEY,
        google_refresh_token TEXT,
        google_spreadsheet_id TEXT,
        handle TEXT, display_name TEXT, currency TEXT DEFAULT 'USD',
        notify_price_drops INTEGER DEFAULT 1, notify_weekly_digest INTEGER DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
        expose_public_value INTEGER NOT NULL DEFAULT 1,
        email TEXT, discord_webhook_url TEXT, brickset_user_hash TEXT,
        is_supporter INTEGER DEFAULT 0, supporter_since TEXT, stripe_customer_id TEXT,
        kids_pin_hash TEXT, kids_xp INTEGER NOT NULL DEFAULT 0, kids_level INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS kids_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, badge_slug TEXT NOT NULL,
        awarded_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, badge_slug)
      )`,

      `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price)
       VALUES ('75192', 'Millennium Falcon', 'Star Wars', 2017, 7541, 849.99, 799.99)`
    ];

    for (const sql of sqls) {
      await db.prepare(sql).run();
    }
  });

  describe('CORS Headers', () => {
    it('sets allowed domains and headers dynamically', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/config', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'http://localhost:3000',
            'Access-Control-Request-Headers': 'X-OpenAI-Key',
            'Access-Control-Request-Method': 'GET'
          }
        }),
        env
      );
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-OpenAI-Key');
    });

    it('reflects the bundled Capacitor origins', async () => {
      for (const origin of ['https://localhost', 'capacitor://localhost']) {
        const res = await app.fetch(
          new Request('http://localhost/api/config', { headers: { Origin: origin } }),
          env,
        );
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      }
    });

    // Regression guard: every request header the front-end sends to the worker MUST
    // be in the CORS allowHeaders (worker/src/index.ts), or the browser preflight
    // silently blocks the whole cross-origin request (this is exactly what broke
    // photo scanning when cf-turnstile-token was added but not allow-listed).
    // When the front-end starts sending a NEW header, add it to BOTH index.ts's
    // allowHeaders AND this list.
    it('allow-lists every header the front-end sends (CORS preflight)', async () => {
      const REQUIRED_HEADERS = ['Content-Type', 'Authorization', 'X-Gemini-Key', 'X-OpenAI-Key', 'cf-turnstile-token'];
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://brickvault-5ub.pages.dev',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': REQUIRED_HEADERS.join(','),
          },
        }),
        env,
      );
      const allowed = (res.headers.get('Access-Control-Allow-Headers') || '').toLowerCase();
      for (const h of REQUIRED_HEADERS) {
        expect(allowed).toContain(h.toLowerCase());
      }
    });

    it('falls back to the safe default origin when the request origin is not allowed', async () => {
      // A foreign site AND an arbitrary *.pages.dev project (a different Cloudflare
      // tenant) must NOT be reflected — only this project's own origins are.
      for (const origin of ['https://evil-hacker.com', 'https://someone-else.pages.dev']) {
        const res = await app.fetch(
          new Request('http://localhost/api/config', { headers: { Origin: origin } }),
          env,
        );
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://brickvault-5ub.pages.dev');
      }
    });

    it("reflects this project's own Pages preview deployments", async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/config', {
          headers: { Origin: 'https://abc123.brickvault-5ub.pages.dev' },
        }),
        env,
      );
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://abc123.brickvault-5ub.pages.dev');
    });
  });

  describe('Public Config Setup Checklist', () => {
    it('returns public config setup status flags', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/config'),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.supabase_url).toBe('https://supabase.mock.io');
      expect(data.status).toBeDefined();
      expect(data.status.supabase).toBe(true);
      expect(data.status.d1).toBe(true);
      expect(data.status.openai).toBe(true);
      expect(data.status.google).toBe(true);
      expect(data.setup.google.configured).toBe(true);
      expect(data.setup.google.missing_secrets).toEqual([]);
      expect(data.setup.google.recommended_action).toContain('ready');
    });

    it('omits Stripe from public readiness (Patreon is the public supporter flow)', async () => {
      const res = await app.fetch(new Request('http://localhost/api/config'), env);
      const data = await res.json<any>();
      expect(data.status).not.toHaveProperty('stripe');
    });

    it('reflects PATREON_URL when configured', async () => {
      (env as any).PATREON_URL = 'https://patreon.com/brickvault';
      const res = await app.fetch(new Request('http://localhost/api/config'), env);
      const data = await res.json<any>();
      expect(data.patreon_url).toBe('https://patreon.com/brickvault');
      delete (env as any).PATREON_URL;
    });

    it('explains which Google secrets are missing when Sheets sync is disabled', async () => {
      delete (env as any).GOOGLE_CLIENT_ID;
      delete (env as any).GOOGLE_CLIENT_SECRET;
      const res = await app.fetch(
        new Request('http://localhost/api/config'),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.status.google).toBe(false);
      expect(data.setup.google.configured).toBe(false);
      expect(data.setup.google.missing_secrets).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
      expect(data.setup.google.recommended_action).toContain('GitHub Actions secrets');
    });

    it('reports optional Gemini, email, and push setup readiness', async () => {
      delete (env as any).GEMINI_API_KEY;
      delete (env as any).RESEND_API_KEY;
      delete (env as any).VAPID_PUBLIC_KEY;
      delete (env as any).VAPID_PRIVATE_KEY;
      delete (env as any).VAPID_SUBJECT;
      const res = await app.fetch(
        new Request('http://localhost/api/config'),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.status.gemini).toBe(false);
      expect(data.status.email).toBe(false);
      expect(data.status.push).toBe(false);
      expect(data.setup.gemini.recommended_action).toContain('GEMINI_API_KEY');
      expect(data.setup.email.recommended_action).toContain('RESEND_API_KEY');
      expect(data.setup.push.missing_secrets).toEqual(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']);
    });
  });

  describe('Google OAuth Flow Security', () => {
    it('generates secure auth-init sessions and verifies state nonces', async () => {
      // 1. Initialize auth session
      const initRes = await app.fetch(
        new Request('http://localhost/api/google/auth-init', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }),
        env
      );
      expect(initRes.status).toBe(200);
      const initData = await initRes.json<{ code: string }>();
      expect(initData.code).toBeDefined();
      expect(initData.code.length).toBeGreaterThan(16);

      // Verify it was saved to DB
      const session = await db.prepare('SELECT user_id FROM oauth_sessions WHERE code = ?')
        .bind(initData.code)
        .first<{ user_id: string }>();
      expect(session?.user_id).toBe(testUserId);

      // 2. Access auth endpoint
      const authRes = await app.fetch(
        new Request(`http://localhost/api/google/auth?code=${initData.code}`),
        env
      );
      expect(authRes.status).toBe(302);
      const redirectLocation = authRes.headers.get('Location') || '';
      const redirectUrl = new URL(redirectLocation);
      expect(redirectUrl.host).toBe('accounts.google.com');
      const state = redirectUrl.searchParams.get('state') || '';
      expect(state).toBeDefined();

      // Verify the short-lived session code was deleted on first use
      const sessionAfter = await db.prepare('SELECT user_id FROM oauth_sessions WHERE code = ?')
        .bind(initData.code)
        .first<{ user_id: string }>();
      expect(sessionAfter).toBeNull();

      // Verify state was saved to DB
      const stateRecord = await db.prepare('SELECT user_id FROM oauth_states WHERE state = ?')
        .bind(state)
        .first<{ user_id: string }>();
      expect(stateRecord?.user_id).toBe(testUserId);

      // 3. Callback with the state
      // Mock global fetch for token exchange
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url === 'https://oauth2.googleapis.com/token') {
          return Promise.resolve(new Response(JSON.stringify({
            refresh_token: 'mock-refresh-token',
            access_token: 'mock-access-token'
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const callbackRes = await app.fetch(
        new Request(`http://localhost/api/google/oauth?code=oauth-code-123&state=${state}`),
        env
      );
      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.get('Location')).toContain('google_sync=success');

      // Verify state was deleted after use
      const stateAfter = await db.prepare('SELECT user_id FROM oauth_states WHERE state = ?')
        .bind(state)
        .first<{ user_id: string }>();
      expect(stateAfter).toBeNull();

      // Restore fetch
      globalThis.fetch = originalFetch;
    });

    it('rejects duplicate or invalid state nonces', async () => {
      const callbackRes = await app.fetch(
        new Request(`http://localhost/api/google/oauth?code=oauth-code-123&state=invalid-or-reused-state`),
        env
      );
      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.get('Location')).toContain('google_sync=error');
    });
  });

  describe('Rate Limiting & OpenAI BYOK', () => {
    it('bypasses rate limit if X-OpenAI-Key header is present', async () => {
      // Mock OpenAI API Response
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (url.toString().includes('openai.com')) {
          return Promise.resolve(new Response(JSON.stringify({
            choices: [{
              message: {
                content: JSON.stringify({
                  sets: [{ set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: 'Visual match' }]
                })
              }
            }]
          }), { status: 200 }));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      // Hit scan identify with X-OpenAI-Key
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-OpenAI-Key': 'user-provided-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
        }),
        env
      );

      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean }>();
      expect(data.identified).toBe(true);

      // Verify no rate limit hits were recorded in the database
      const rateLimitHits = await db.prepare('SELECT COUNT(*) as count FROM rate_limits').first<{ count: number }>();
      expect(rateLimitHits?.count).toBe(0);

      globalThis.fetch = originalFetch;
    });

    it('shelf mode returns every catalog-matched set from one photo', async () => {
      await db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price)
        VALUES ('10497', 'Galaxy Explorer', 'Icons', 2022, 1254, 120, 99.99)`).run();

      // BYOK OpenAI goes through the mocked 'openai' module, whose shelf branch
      // returns three described sets — one of which (55555) is not in the
      // catalog and must be dropped by matching.
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-OpenAI-Key': 'user-provided-key',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'shelf', image: 'data:image/png;base64,mock' }),
        }),
        env
      );

      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean; sets: Array<{ set_num: string; match_confidence?: string }> }>();
      expect(data.identified).toBe(true);
      const nums = data.sets.map(s => s.set_num);
      expect(nums).toContain('75192');
      expect(nums).toContain('10497');
      expect(nums).not.toContain('55555');
      // Per-set AI identification confidence survives the catalog match under
      // its own key (enrichSetRecord overwrites `confidence` with PRICING
      // confidence); the shelf checklist UI shows it per row.
      expect(data.sets.find(s => s.set_num === '10497')?.match_confidence).toBe('medium');
    });

    it('rejects unknown scan modes', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'bogus', image: 'data:image/png;base64,mock' }),
        }),
        env
      );
      expect(res.status).toBe(400);
    });

    it('applies rate limit if X-OpenAI-Key header is missing', async () => {
      // Free users are capped per UTC day — seed today's bucket at the limit.
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);
      const ws = windowStart.toISOString();

      await db.prepare(`
        INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
        VALUES (?, 'scan_image', ?, 20)
      `).bind(testUserId, ws).run();

      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
        }),
        env
      );

      expect(res.status).toBe(429);
      const data = await res.json<{ error: string }>();
      expect(data.error).toContain('Rate limit: 20 photo scans per day');
    });

    it('allows the 20th shared photo scan and blocks the 21st', async () => {
      // Free tier: 20 scans per UTC day. Seed today's bucket at 19 so the next
      // scan is the 20th (allowed) and the one after is the 21st (blocked).
      const windowStart = new Date();
      windowStart.setUTCHours(0, 0, 0, 0);
      const ws = windowStart.toISOString();

      await db.prepare(`
        INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
        VALUES (?, 'scan_image', ?, 19)
      `).bind(testUserId, ws).run();

      const first = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
        }),
        env
      );
      expect(first.status).toBe(200);
      expect((await first.json<{ identified: boolean }>()).identified).toBe(true);

      const second = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
        }),
        env
      );
      expect(second.status).toBe(429);
    });
  });

  describe('Input Validation & Safe Operations', () => {
    it('rejects invalid inputs on collection add/update', async () => {
      // 1. Negative quantity
      let res = await app.fetch(
        new Request('http://localhost/api/collection', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ set_num: '75192', quantity: -5 })
        }),
        env
      );
      expect(res.status).toBe(400);
      expect((await res.json<{ error: string }>()).error).toContain('Quantity must be an integer');

      // 2. Negative purchase price
      res = await app.fetch(
        new Request('http://localhost/api/collection', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ set_num: '75192', purchase_price: -100 })
        }),
        env
      );
      expect(res.status).toBe(400);
      expect((await res.json<{ error: string }>()).error).toContain('Purchase price must be a number');

      // 3. Invalid condition
      res = await app.fetch(
        new Request('http://localhost/api/collection', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ set_num: '75192', condition: 'trash' })
        }),
        env
      );
      expect(res.status).toBe(400);
      expect((await res.json<{ error: string }>()).error).toContain('Invalid condition');

      // 4. Invalid purchased_at format
      res = await app.fetch(
        new Request('http://localhost/api/collection', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ set_num: '75192', purchased_at: '2026/06/05' })
        }),
        env
      );
      expect(res.status).toBe(400);
      expect((await res.json<{ error: string }>()).error).toContain('Purchased at must be a valid YYYY-MM-DD');
    });

    it('rejects invalid inputs on wishlist add', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/wishlist', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ set_num: '75192', target_price: -10 })
        }),
        env
      );
      expect(res.status).toBe(400);
      expect((await res.json<{ error: string }>()).error).toContain('Target price must be a number');
    });
  });

  describe('ETag Correctness & Collection Cache', () => {
    it('returns 200 with new ETag, then 304 on matching ETag', async () => {
      // 1. Initial collection list
      const res1 = await app.fetch(
        new Request('http://localhost/api/collection', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        env
      );
      expect(res1.status).toBe(200);
      const etag1 = res1.headers.get('ETag') || '';
      expect(etag1).toBeDefined();

      // 2. Fetch with If-None-Match matching etag1
      const res2 = await app.fetch(
        new Request('http://localhost/api/collection', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'If-None-Match': etag1
          }
        }),
        env
      );
      expect(res2.status).toBe(304);

      // 3. Add item to collection
      const addRes = await app.fetch(
        new Request('http://localhost/api/collection', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ set_num: '75192', quantity: 1, condition: 'new', purchase_price: 799.99 })
        }),
        env
      );
      expect(addRes.status).toBe(201);

      // 4. Fetch list again, ETag should be different and status should be 200
      const res3 = await app.fetch(
        new Request('http://localhost/api/collection', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        env
      );
      expect(res3.status).toBe(200);
      const etag2 = res3.headers.get('ETag') || '';
      expect(etag2).not.toBe(etag1);

      // 5. Fetch again with etag2, should be 304
      const res4 = await app.fetch(
        new Request('http://localhost/api/collection', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'If-None-Match': etag2
          }
        }),
        env
      );
      expect(res4.status).toBe(304);

      // 6. Patch/update item (older item cached state changes)
      const collItem = (await addRes.json<{ item: { id: number } }>()).item;
      const patchRes = await app.fetch(
        new Request(`http://localhost/api/collection/${collItem.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ quantity: 2 })
        }),
        env
      );
      expect(patchRes.status).toBe(200);

      // Manually increment last_modified in the database to simulate elapsed time since tests run in milliseconds
      await db.prepare("UPDATE user_collection SET last_modified = datetime('now', '+5 seconds') WHERE id = ?").bind(collItem.id).run();

      // 7. Fetch list again, ETag must be different because last_modified was updated
      const res5 = await app.fetch(
        new Request('http://localhost/api/collection', {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        env
      );
      expect(res5.status).toBe(200);
      const etag3 = res5.headers.get('ETag') || '';
      expect(etag3).not.toBe(etag2);
    });
  });

  describe('Scanner — barcode mode', () => {
    it('returns match for known EAN-13 barcode', async () => {
      // Set upc on the existing seed row
      await db.prepare(`UPDATE lego_sets SET upc='0673419280310' WHERE set_num='75192'`).run();
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'barcode', barcode: '0673419280310' })
        }),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean; confidence: string }>();
      expect(data.identified).toBe(true);
      expect(data.confidence).toBe('high');
    });

    it('converts UPC-A to EAN-13 for lookup', async () => {
      await db.prepare(`UPDATE lego_sets SET upc='0673419280310' WHERE set_num='75192'`).run();
      // 12-digit UPC-A — scanner should prepend '0' and find the match
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'barcode', barcode: '673419280310' })
        }),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean }>();
      expect(data.identified).toBe(true);
    });

    it('returns identified:false for unknown barcode', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'barcode', barcode: '0000000000000' })
        }),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean; reasoning: string }>();
      expect(data.identified).toBe(false);
      expect(data.reasoning).toContain('Try a photo scan');
    });

    it('returns 400 when barcode field is missing', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'barcode' })
        }),
        env
      );
      expect(res.status).toBe(400);
    });
  });

  describe('Scanner — image mode', () => {
    it('returns 413 when image exceeds size limit', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'image', image: 'x'.repeat(2_100_000) })
        }),
        env
      );
      expect(res.status).toBe(413);
    });

    it('returns 400 when mode is invalid', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'unknown', image: 'data:image/png;base64,abc' })
        }),
        env
      );
      expect(res.status).toBe(400);
    });

    it('requires Turnstile for shared web scans when configured', async () => {
      const previous = (env as any).TURNSTILE_SECRET_KEY;
      (env as any).TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
      try {
        const res = await app.fetch(
          new Request('http://localhost/api/scan/identify', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
          }),
          env
        );
        expect(res.status).toBe(403);
      } finally {
        (env as any).TURNSTILE_SECRET_KEY = previous;
      }
    });

    it('uses the authenticated per-user quota instead of Turnstile in Android', async () => {
      const previous = (env as any).TURNSTILE_SECRET_KEY;
      (env as any).TURNSTILE_SECRET_KEY = 'turnstile-test-secret';
      try {
        const res = await app.fetch(
          new Request('http://localhost/api/scan/identify', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'X-Brickvault-Platform': 'android',
            },
            body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
          }),
          env
        );
        expect(res.status).toBe(200);
        const data = await res.json<{ identified: boolean }>();
        expect(data.identified).toBe(true);
      } finally {
        (env as any).TURNSTILE_SECRET_KEY = previous;
      }
    });

    it('uses BYOK OpenAI key and returns matched set', async () => {
      // 75192 already seeded by beforeEach; OpenAI module is fully mocked to return it
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-OpenAI-Key': 'user-provided-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
        }),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean; model: string }>();
      expect(data.identified).toBe(true);
      expect(data.model).toContain('gpt-4o');
    });

    it('returns identified:false via Gemini when set not in catalog', async () => {
      // Mock Gemini to return a set number that doesn't exist in the DB
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.toString().includes('generativelanguage.googleapis.com')) {
          return Promise.resolve(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              sets: [{ set_num: '99999', name: 'Ghost Set', confidence: 'high', reasoning: 'Test' }]
            }) }] } }]
          }), { status: 200 }));
        }
        return originalFetch(url);
      });
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Gemini-Key': 'user-gemini-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,dGVzdA==' })
        }),
        env
      );
      globalThis.fetch = originalFetch;
      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean }>();
      expect(data.identified).toBe(false);
    });

    it('falls back to server OpenAI key under rate limit threshold', async () => {
      // 75192 already seeded by beforeEach; rate limit at 5 (under 20 cap)
      const windowStart = new Date();
      windowStart.setMinutes(0, 0, 0);
      await db.prepare(
        `INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES (?, 'scan_image', ?, 5)`
      ).bind(testUserId, windowStart.toISOString()).run();
      const res = await app.fetch(
        new Request('http://localhost/api/scan/identify', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'image', image: 'data:image/png;base64,mock' })
        }),
        env
      );
      expect(res.status).toBe(200);
      const data = await res.json<{ identified: boolean }>();
      expect(data.identified).toBe(true);
    });
  });

  describe('AI listing drafts', () => {
    it('uses a user OpenAI key when the server key is absent', async () => {
      (env as any).OPENAI_API_KEY = '';

      const res = await app.fetch(
        new Request('http://localhost/api/sets/75192/listing-draft', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-OpenAI-Key': 'user-openai-key',
            'Content-Type': 'application/json',
          },
        }),
        env
      );

      expect(res.status).toBe(200);
      const data = await res.json<{ title: string; suggested_price: number }>();
      expect(data.title).toContain('75192');
      expect(data.suggested_price).toBeGreaterThan(0);
    });

    it('sends Gemini listing keys in headers, not URLs', async () => {
      const originalFetch = globalThis.fetch;
      let seenUrl = '';
      let seenHeader = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.toString().includes('generativelanguage.googleapis.com')) {
          seenUrl = url.toString();
          seenHeader = String((init?.headers as Record<string, string>)?.['x-goog-api-key'] || '');
          return Promise.resolve(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: JSON.stringify({
              title: 'LEGO 75192 Millennium Falcon',
              description: 'A strong collector listing.',
              suggested_price: 849,
              price_reasoning: 'Priced near current market value.',
            }) }] } }]
          }), { status: 200 }));
        }
        return originalFetch(url, init);
      });

      try {
        const res = await app.fetch(
          new Request('http://localhost/api/sets/75192/listing-draft', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Gemini-Key': 'user-gemini-key',
              'Content-Type': 'application/json',
            },
          }),
          env
        );

        expect(res.status).toBe(200);
        expect(seenHeader).toBe('user-gemini-key');
        expect(seenUrl).not.toContain('user-gemini-key');
        expect(seenUrl).not.toContain('key=');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Advisor rate limiting', () => {
    const advisorWindowStart = () => {
      const ws = new Date();
      ws.setHours(0, 0, 0, 0);
      return ws.toISOString();
    };

    it('blocks the 11th daily query on the server key with a 429', async () => {
      await db.prepare(
        `INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES (?, 'advisor', ?, 10)`
      ).bind(testUserId, advisorWindowStart()).run();

      const res = await app.fetch(new Request('http://localhost/api/advisor', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: 'Which sets should I sell?' }),
      }), env);
      expect(res.status).toBe(429);
      const data = await res.json<{ error: string }>();
      expect(data.error).toContain('10 advisor queries per day');
    });

    it('bypasses the daily limit with a user Gemini key', async () => {
      await db.prepare(
        `INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES (?, 'advisor', ?, 10)`
      ).bind(testUserId, advisorWindowStart()).run();

      // Stub the streaming Gemini call so no real network request happens.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: any, init?: RequestInit) => {
        if (url.toString().includes('generativelanguage.googleapis.com')) {
          return Promise.resolve(new Response('data: {"candidates":[]}\n\n', {
            status: 200, headers: { 'Content-Type': 'text/event-stream' },
          }));
        }
        return originalFetch(url, init);
      });
      try {
        const res = await app.fetch(new Request('http://localhost/api/advisor', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Gemini-Key': 'user-gemini-key',
          },
          body: JSON.stringify({ q: 'Which sets should I sell?' }),
        }), env);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type') || '').toContain('text/event-stream');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects an empty question before consuming the rate limit', async () => {
      const res = await app.fetch(new Request('http://localhost/api/advisor', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: '   ' }),
      }), env);
      expect(res.status).toBe(400);
      const hits = await db.prepare(
        `SELECT hit_count FROM rate_limits WHERE user_id=? AND endpoint='advisor'`
      ).bind(testUserId).first<{ hit_count: number }>();
      expect(hits).toBeNull();
    });
  });
});
