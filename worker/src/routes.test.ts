/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import app from './index';

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

// Supply a mock ExecutionContext so background tasks (c.executionCtx.waitUntil)
// don't blow up under the test pool.
const originalAppFetch = app.fetch;
app.fetch = (request: any, e?: any, executionCtx?: any) => {
  const mockCtx = executionCtx || {
    waitUntil: (p: Promise<any>) => { p.catch(() => {}); },
    passThroughOnException: () => {},
  };
  return originalAppFetch(request, e, mockCtx);
};

async function createMockJWT(userId: string, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 };
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

describe('Route coverage: me / wishlist / profile / collection', () => {
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  const userId = 'route-user-1';
  const otherUserId = 'route-user-2';
  const adminUserId = 'admin-user';
  let token: string;
  let otherToken: string;
  let adminToken: string;
  let db: D1Database;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = JWT_SECRET;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'supabase-anon-key-mock';
    (env as any).ADMIN_USER_ID = 'admin-user';

    token = await createMockJWT(userId, JWT_SECRET);
    otherToken = await createMockJWT(otherUserId, JWT_SECRET);
    adminToken = await createMockJWT(adminUserId, JWT_SECRET);
    db = (env as any).DB;

    const sqls = [
      'DROP TABLE IF EXISTS user_collection',
      'DROP TABLE IF EXISTS lego_sets',
      'DROP TABLE IF EXISTS user_wishlist',
      'DROP TABLE IF EXISTS wishlist_alerts',
      'DROP TABLE IF EXISTS user_prefs',
      'DROP TABLE IF EXISTS user_showcase',
      'DROP TABLE IF EXISTS portfolio_snapshots',
      'DROP TABLE IF EXISTS integration_health',

      `CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, year INTEGER,
        pieces INTEGER, minifigs INTEGER DEFAULT 0, retail_price REAL, current_value REAL,
        forecast_2y REAL, forecast_5y REAL, image_url TEXT, retired INTEGER DEFAULT 0,
        retirement_risk_score INTEGER, used_value REAL, ebay_value REAL, upc TEXT,
        cached_at TEXT, source TEXT
      )`,
      `CREATE TABLE user_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1, condition TEXT NOT NULL DEFAULT 'new',
        purchase_price REAL, notes TEXT, added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        purchased_at TEXT, deleted_at TEXT, last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
        storage_location TEXT, acquisition_source TEXT, is_complete INTEGER DEFAULT 1,
        missing_pieces INTEGER DEFAULT 0, UNIQUE(user_id, set_num)
      )`,
      `CREATE TABLE user_wishlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        target_price REAL, notes TEXT, added_at TEXT DEFAULT CURRENT_TIMESTAMP, alerted_at TEXT,
        UNIQUE(user_id, set_num)
      )`,
      `CREATE TABLE wishlist_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        set_name TEXT, target_price REAL, current_value REAL,
        triggered_at TEXT DEFAULT CURRENT_TIMESTAMP, read_at TEXT, alert_type TEXT DEFAULT 'drop'
      )`,
      `CREATE TABLE user_prefs (
        user_id TEXT PRIMARY KEY, handle TEXT, display_name TEXT, currency TEXT DEFAULT 'USD',
        notify_price_drops INTEGER DEFAULT 1, is_public INTEGER NOT NULL DEFAULT 0,
        expose_public_value INTEGER NOT NULL DEFAULT 1,
        google_refresh_token TEXT, google_spreadsheet_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE user_showcase (
        user_id TEXT NOT NULL, set_num TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, set_num)
      )`,
      `CREATE TABLE portfolio_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, snapshot_date TEXT NOT NULL,
        snapshot_at TEXT DEFAULT CURRENT_TIMESTAMP, total_value REAL DEFAULT 0,
        total_paid REAL DEFAULT 0, set_count INTEGER DEFAULT 0, UNIQUE(user_id, snapshot_date)
      )`,
      `CREATE TABLE integration_health (
        service TEXT PRIMARY KEY, last_ok_at TEXT, last_fail_at TEXT, last_error TEXT,
        ok_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT
      )`,

      `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
       VALUES ('75192', 'Millennium Falcon', 'Star Wars', 2017, 7541, 849.99, 799.99, 1)`,
      `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
       VALUES ('10300', 'Back to the Future', 'Icons', 2022, 1872, 210.00, 199.99, 0)`,
    ];
    for (const sql of sqls) await db.prepare(sql).run();
  });

  describe('GET /api/me', () => {
    it('requires authentication', async () => {
      const res = await app.fetch(new Request('http://localhost/api/me'), env);
      expect(res.status).toBe(401);
    });

    it('returns a seeded display name and zeroed stats for a new user', async () => {
      const res = await app.fetch(new Request('http://localhost/api/me', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(typeof data.display_name).toBe('string');
      expect(data.display_name.length).toBeGreaterThan(0);
      expect(data.handle).toBeNull();
      expect(data.is_public).toBe(false);
      expect(data.currency).toBe('USD');
      expect(data.portfolio_stats.set_count).toBe(0);
      expect(data.is_admin).toBe(false);
    });

    it('reflects collection in portfolio_stats', async () => {
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
         VALUES (?, '75192', 2, 'new', 700)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/me', { headers: auth() }), env);
      const data = await res.json<any>();
      expect(data.portfolio_stats.set_count).toBe(1);
      expect(data.portfolio_stats.total_value).toBeCloseTo(849.99 * 2, 1);
      expect(data.portfolio_stats.total_paid).toBeCloseTo(700 * 2, 1);
    });
  });

  describe('PATCH /api/me', () => {
    it('rejects an invalid handle', async () => {
      const res = await app.fetch(new Request('http://localhost/api/me', {
        method: 'PATCH', headers: auth(), body: JSON.stringify({ handle: 'no' }),
      }), env);
      expect(res.status).toBe(400);
    });

    it('saves a valid handle and currency, then reflects them on GET', async () => {
      const patch = await app.fetch(new Request('http://localhost/api/me', {
        method: 'PATCH', headers: auth(),
        body: JSON.stringify({ handle: 'brick-master', currency: 'EUR', is_public: true }),
      }), env);
      expect(patch.status).toBe(200);

      const res = await app.fetch(new Request('http://localhost/api/me', { headers: auth() }), env);
      const data = await res.json<any>();
      expect(data.handle).toBe('brick-master');
      expect(data.currency).toBe('EUR');
      expect(data.is_public).toBe(true);
    });

    it('returns 409 when a handle is already taken by another user', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, handle) VALUES (?, 'taken-handle')`
      ).bind(otherUserId).run();
      const res = await app.fetch(new Request('http://localhost/api/me', {
        method: 'PATCH', headers: auth(), body: JSON.stringify({ handle: 'taken-handle' }),
      }), env);
      expect(res.status).toBe(409);
    });
  });

  describe('Wishlist', () => {
    it('rejects POST without set_num', async () => {
      const res = await app.fetch(new Request('http://localhost/api/wishlist', {
        method: 'POST', headers: auth(), body: JSON.stringify({ target_price: 10 }),
      }), env);
      expect(res.status).toBe(400);
    });

    it('returns 404 when the set is not in the catalog', async () => {
      const res = await app.fetch(new Request('http://localhost/api/wishlist', {
        method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '00000' }),
      }), env);
      expect(res.status).toBe(404);
    });

    it('creates, lists, and deletes a wishlist item', async () => {
      const create = await app.fetch(new Request('http://localhost/api/wishlist', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ set_num: '10300', target_price: 150 }),
      }), env);
      expect(create.status).toBe(201);

      const list = await app.fetch(new Request('http://localhost/api/wishlist', { headers: auth() }), env);
      const listData = await list.json<any>();
      expect(listData.wishlist).toHaveLength(1);
      expect(listData.wishlist[0].set_num).toBe('10300');
      const id = listData.wishlist[0].id;

      const del = await app.fetch(new Request(`http://localhost/api/wishlist/${id}`, {
        method: 'DELETE', headers: auth(),
      }), env);
      expect(del.status).toBe(204);

      const list2 = await app.fetch(new Request('http://localhost/api/wishlist', { headers: auth() }), env);
      expect((await list2.json<any>()).wishlist).toHaveLength(0);
    });

    it('marks an alert as read via POST /:id', async () => {
      await db.prepare(
        `INSERT INTO wishlist_alerts (id, user_id, set_num, set_name, alert_type)
         VALUES (1, ?, '75192', 'Millennium Falcon', 'drop')`
      ).bind(userId).run();

      const before = await app.fetch(new Request('http://localhost/api/wishlist', { headers: auth() }), env);
      expect((await before.json<any>()).unread_alerts).toHaveLength(1);

      const mark = await app.fetch(new Request('http://localhost/api/wishlist/1', {
        method: 'POST', headers: auth(),
      }), env);
      expect(mark.status).toBe(200);

      const after = await app.fetch(new Request('http://localhost/api/wishlist', { headers: auth() }), env);
      expect((await after.json<any>()).unread_alerts).toHaveLength(0);
    });
  });

  describe('Public profile', () => {
    it('returns 404 for an unknown handle', async () => {
      const res = await app.fetch(new Request('http://localhost/api/users/nobody/profile'), env);
      expect(res.status).toBe(404);
    });

    it('returns 404 for a private profile', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, handle, display_name, is_public) VALUES (?, 'priv', 'Private', 0)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/users/priv/profile'), env);
      expect(res.status).toBe(404);
    });

    it('returns public profile data without auth, including themes and stats', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, handle, display_name, is_public, expose_public_value)
         VALUES (?, 'pub', 'Public Collector', 1, 1)`
      ).bind(userId).run();
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES (?, '75192', 1, 'new')`
      ).bind(userId).run();

      const res = await app.fetch(new Request('http://localhost/api/users/pub/profile'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.handle).toBe('pub');
      expect(data.display_name).toBe('Public Collector');
      expect(data.set_count).toBe(1);
      expect(data.total_value).toBeCloseTo(849.99, 1);
      expect(data.top_themes[0].theme).toBe('Star Wars');
    });

    it('hides value when expose_public_value is off', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, handle, display_name, is_public, expose_public_value)
         VALUES (?, 'shy', 'Shy Collector', 1, 0)`
      ).bind(userId).run();
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES (?, '75192', 1, 'new')`
      ).bind(userId).run();

      const res = await app.fetch(new Request('http://localhost/api/users/shy/profile'), env);
      const data = await res.json<any>();
      expect(data.set_count).toBe(1);
      expect(data.total_value).toBeNull();
      expect(data.top_themes[0].value).toBeNull();
    });

    it('check-handle rejects invalid handles and flags taken ones', async () => {
      const bad = await app.fetch(new Request('http://localhost/api/users/check-handle/no', { headers: auth() }), env);
      expect((await bad.json<any>()).available).toBe(false);

      await db.prepare(`INSERT INTO user_prefs (user_id, handle) VALUES (?, 'mine')`).bind(otherUserId).run();
      const taken = await app.fetch(new Request('http://localhost/api/users/check-handle/mine', { headers: auth() }), env);
      expect((await taken.json<any>()).available).toBe(false);

      const free = await app.fetch(new Request('http://localhost/api/users/check-handle/wide-open', { headers: auth() }), env);
      expect((await free.json<any>()).available).toBe(true);
    });

    it('blocks editing a showcase that is not yours', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, handle, is_public) VALUES (?, 'owner', 1)`
      ).bind(otherUserId).run();
      const res = await app.fetch(new Request('http://localhost/api/users/owner/showcase', {
        method: 'POST', headers: auth(), body: JSON.stringify({ set_nums: ['75192'] }),
      }), env);
      expect(res.status).toBe(403);
    });
  });

  describe('Collection export & history', () => {
    it('exports CSV with a header row and the owned set', async () => {
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
         VALUES (?, '75192', 1, 'new', 700)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/collection/export', { headers: auth() }), env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/csv');
      const csv = await res.text();
      const lines = csv.split('\n');
      expect(lines[0]).toContain('set_num');
      expect(lines[0]).toContain('roi_pct');
      expect(csv).toContain('75192');
      expect(csv).toContain('Millennium Falcon');
    });

    it('returns portfolio snapshots from history', async () => {
      await db.prepare(
        `INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
         VALUES (?, DATE('now'), 1000, 800, 3)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/collection/history', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.snapshots).toHaveLength(1);
      expect(data.snapshots[0].total_value).toBe(1000);
    });
  });

  describe('Admin integrations health', () => {
    it('rejects non-admin members', async () => {
      const res = await app.fetch(new Request('http://localhost/api/admin/integrations', { headers: auth() }), env);
      expect(res.status).toBe(403);
    });

    it('returns recorded integration health for the admin', async () => {
      await db.prepare(
        `INSERT INTO integration_health (service, last_ok_at, ok_count, fail_count, updated_at)
         VALUES ('ebay', datetime('now'), 5, 1, datetime('now'))`
      ).run();
      const res = await app.fetch(new Request('http://localhost/api/admin/integrations', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.integrations).toHaveLength(1);
      expect(data.integrations[0].service).toBe('ebay');
      expect(data.integrations[0].ok_count).toBe(5);
    });
  });
});
