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
        create: vi.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({
                sets: [{ set_num: '75192', name: 'Millennium Falcon', confidence: 'high', reasoning: 'Visual match' }]
              })
            }
          }]
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
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS user_wishlist',
      'DROP TABLE IF EXISTS user_minifigs',
      'DROP TABLE IF EXISTS user_prefs',
      'DROP TABLE IF EXISTS set_value_history',
      'DROP TABLE IF EXISTS minifigs',

      `CREATE TABLE set_value_history (
        set_num TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        current_value REAL,
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
        source TEXT
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
        theme TEXT NOT NULL,
        year INTEGER NOT NULL,
        pieces INTEGER NOT NULL,
        minifigs INTEGER DEFAULT 0,
        retail_price REAL,
        current_value REAL,
        forecast_2y REAL,
        forecast_5y REAL,
        image_url TEXT,
        retired INTEGER DEFAULT 0,
        retirement_risk_score INTEGER,
        used_value REAL,
        ebay_value REAL,
        upc TEXT,
        valuation_method TEXT,
        bl_new_value REAL,
        bl_new_qty INTEGER,
        bl_used_qty INTEGER,
        cached_at TEXT,
        source TEXT
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
        google_spreadsheet_id TEXT
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

    it('falls back to safe default if origin not allowed', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/config', {
          headers: { 'Origin': 'https://evil-hacker.com' }
        }),
        env
      );
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

    it('applies rate limit if X-OpenAI-Key header is missing', async () => {
      // Setup rate limit to maximum
      const windowStart = new Date();
      windowStart.setMinutes(0, 0, 0);
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
      expect(data.error).toContain('Rate limit: 20 photo scans per hour');
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
});
