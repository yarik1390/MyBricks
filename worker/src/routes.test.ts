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
    delete (env as any).GOOGLE_CLIENT_ID;
    delete (env as any).GOOGLE_CLIENT_SECRET;
    delete (env as any).EBAY_APP_ID;
    delete (env as any).EBAY_CLIENT_SECRET;

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
      'DROP TABLE IF EXISTS import_runs',
      'DROP TABLE IF EXISTS minifigs',
      'DROP TABLE IF EXISTS lego_sets_fts',
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS oauth_sessions',
      'DROP TABLE IF EXISTS oauth_states',
      'DROP TABLE IF EXISTS user_minifigs',
      'DROP TABLE IF EXISTS set_value_history',

      `CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, year INTEGER,
        pieces INTEGER, minifigs INTEGER DEFAULT 0, retail_price REAL, current_value REAL,
        forecast_2y REAL, forecast_5y REAL, image_url TEXT, retired INTEGER DEFAULT 0,
        retirement_risk_score INTEGER, retirement_risk_updated_at TEXT, used_value REAL, ebay_value REAL, upc TEXT,
        ebay_new_value REAL, ebay_used_value REAL, ebay_new_qty INTEGER, ebay_used_qty INTEGER,
        ebay_new_cached_at TEXT, ebay_used_cached_at TEXT,
        bl_cached_at TEXT, be_cached_at TEXT,
        ebay_ask_value REAL, ebay_ask_qty INTEGER, ebay_ask_cached_at TEXT,
        valuation_method TEXT DEFAULT 'formula_bulk', bl_new_value REAL, bl_new_qty INTEGER, bl_used_qty INTEGER,
        bo_new_value REAL, bo_used_value REAL, bo_cached_at TEXT,
        valuation_expires_at TEXT, cached_at TEXT, source TEXT, ebay_cached_at TEXT, blended_value REAL
      )`,
      `CREATE TABLE set_value_history (
        set_num TEXT NOT NULL, snapshot_date TEXT NOT NULL,
        current_value REAL, ebay_value REAL, bl_value REAL,
        PRIMARY KEY (set_num, snapshot_date)
      )`,
      `CREATE VIRTUAL TABLE lego_sets_fts USING fts5(set_num, name, theme)`,
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
        email TEXT, discord_webhook_url TEXT,
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
        ok_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
        blocked_until TEXT
      )`,
      `CREATE TABLE import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT,
        status TEXT DEFAULT 'running',
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        progress_current INTEGER DEFAULT 0,
        progress_total INTEGER,
        progress_label TEXT,
        themes_loaded INTEGER,
        sets_loaded INTEGER,
        sets_skipped INTEGER,
        figs_loaded INTEGER,
        error TEXT
      )`,
      `CREATE TABLE minifigs (
        fig_num TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        series TEXT,
        rarity TEXT DEFAULT 'common',
        current_value REAL,
        image_url TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        source TEXT,
        year INTEGER,
        num_parts INTEGER,
        appears_in_sets INTEGER,
        cached_at TEXT
      )`,
      `CREATE TABLE rate_limits (
        user_id TEXT NOT NULL, endpoint TEXT NOT NULL, window_start TEXT NOT NULL,
        hit_count INTEGER DEFAULT 0, PRIMARY KEY (user_id, endpoint, window_start)
      )`,
      `CREATE TABLE oauth_sessions (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE user_minifigs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, fig_num TEXT NOT NULL,
        quantity INTEGER DEFAULT 1, added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, fig_num)
      )`,

      `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
       VALUES ('75192', 'Millennium Falcon', 'Star Wars', 2017, 7541, 849.99, 799.99, 1)`,
      `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
       VALUES ('10300', 'Back to the Future', 'Icons', 2022, 1872, 210.00, 199.99, 0)`,
      `INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
       SELECT rowid, set_num, name, theme FROM lego_sets`,
    ];
    for (const sql of sqls) await db.prepare(sql).run();
  });

  describe('Set search', () => {
    it('handles exact set numbers with dashes as plain search text', async () => {
      await db.prepare(
        `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
         VALUES ('10039-1', 'Black Falcon''s Fortress', 'Castle', 2002, 430, 67.64, 39.99, 1)`
      ).run();
      await db.prepare(
        `INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
         SELECT rowid, set_num, name, theme FROM lego_sets WHERE set_num='10039-1'`
      ).run();

      const res = await app.fetch(new Request('http://localhost/api/sets/search?q=10039-1&limit=5'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      const match = data.sets.find((set: any) => set.set_num === '10039-1');
      expect(match).toBeTruthy();
      expect(match.current_value).toBe(67.64);
    });
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
    it('imports duplicate rows once and preserves a zero purchase price', async () => {
      const res = await app.fetch(new Request('http://localhost/api/collection/import', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({
          rows: [
            { set_num: '75192', quantity: 1, condition: 'new', purchase_price: 0 },
            { set_num: '75192', quantity: 5, condition: 'sealed', purchase_price: 500 },
          ],
        }),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.imported).toBe(1);
      expect(data.skipped).toBe(1);

      const row = await db.prepare(
        `SELECT quantity, condition, purchase_price FROM user_collection WHERE user_id=? AND set_num='75192'`
      ).bind(userId).first<any>();
      expect(row.quantity).toBe(1);
      expect(row.condition).toBe('new');
      expect(row.purchase_price).toBe(0);
    });

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

    it('returns job progress fields for the admin job panel', async () => {
      await db.prepare(`
        INSERT INTO import_runs (job_type, status, progress_current, progress_total, progress_label, sets_loaded, sets_skipped, error)
        VALUES ('valuation', 'running', 2, 4, 'Revaluing 10300', 1, 2, 'method:valuation scope:all limit:4 processed:2 updated:1')
      `).run();
      const res = await app.fetch(new Request('http://localhost/api/admin/import-status', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.runs[0].job_type).toBe('valuation');
      expect(data.runs[0].progress_current).toBe(2);
      expect(data.runs[0].progress_total).toBe(4);
      expect(data.runs[0].progress_label).toBe('Revaluing 10300');
    });

    it('starts populate-everything and reports done when all source passes are complete', async () => {
      await db.prepare(`INSERT INTO minifigs (fig_num, name) VALUES ('fig-1', 'Test Fig')`).run();
      await db.prepare(`
        UPDATE lego_sets
        SET cached_at=datetime('now'),
            valuation_expires_at=datetime('now', '+1 day'),
            valuation_method='brickeconomy',
            ebay_new_cached_at=datetime('now'),
            ebay_used_cached_at=datetime('now')
      `).run();
      await db.prepare(`
        INSERT INTO import_runs (job_type, status, error)
        VALUES ('barcode_backfill', 'completed', 'method:bulk complete:true')
      `).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/populate-everything', {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ valuation_limit: 1 }),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.done).toBe(true);
      expect(data.run_id).toBeTruthy();
      await new Promise(resolve => setTimeout(resolve, 0));
      const row = await db.prepare(`SELECT job_type, progress_label, error FROM import_runs WHERE id=?`)
        .bind(data.run_id)
        .first<any>();
      expect(row.job_type).toBe('populate_everything');
      expect(row.error).toContain('complete:true');
    });

    it('does not block populate-everything completion when eBay sold-comps access is denied', async () => {
      (env as any).EBAY_APP_ID = 'real-ebay-app-id';
      (env as any).EBAY_CLIENT_SECRET = 'real-ebay-client-secret';
      await db.prepare(`INSERT INTO minifigs (fig_num, name) VALUES ('fig-1', 'Test Fig')`).run();
      await db.prepare(`
        UPDATE lego_sets
        SET cached_at=datetime('now'),
            valuation_expires_at=datetime('now', '+1 day'),
            valuation_method='brickeconomy'
      `).run();
      await db.prepare(`
        INSERT INTO import_runs (job_type, status, error)
        VALUES ('barcode_backfill', 'completed', 'method:bulk complete:true')
      `).run();
      await db.prepare(`
        INSERT INTO integration_health (service, last_fail_at, last_error, ok_count, fail_count, updated_at)
        VALUES ('ebay', datetime('now'), 'eBay Marketplace Insights HTTP 401: unauthorized', 0, 1, datetime('now'))
      `).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/populate-everything', {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ valuation_limit: 1 }),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.done).toBe(true);
      expect(data.coverage.ebay_access_blocked).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      const row = await db.prepare(`SELECT error FROM import_runs WHERE id=?`)
        .bind(data.run_id)
        .first<any>();
      expect(row.error).toContain('complete:true');
      expect(row.error).toContain('ebay_available:false');
      expect(row.error).toContain('ebay_blocked:true');
    });

    it('rotates formula rows when no trusted source valuation is available during populate-everything', async () => {
      await db.prepare(`INSERT INTO minifigs (fig_num, name) VALUES ('fig-1', 'Test Fig')`).run();
      await db.prepare(`
        UPDATE lego_sets
        SET cached_at=datetime('now'),
            valuation_expires_at=datetime('now', '+1 day'),
            valuation_method='brickeconomy',
            upc='test-upc-10300'
        WHERE set_num='10300'
      `).run();
      await db.prepare(`
        UPDATE lego_sets
        SET cached_at='2000-01-01',
            valuation_expires_at=datetime('now', '-1 day'),
            valuation_method='formula_bulk',
            upc='test-upc-75192'
        WHERE set_num='75192'
      `).run();
      await db.prepare(`
        INSERT INTO import_runs (job_type, status, error)
        VALUES ('barcode_backfill', 'completed', 'method:bulk complete:true')
      `).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/populate-everything', {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ valuation_limit: 1 }),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.done).toBe(false);
      let run: any = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        run = await db.prepare(`SELECT status, sets_skipped, error FROM import_runs WHERE id=?`)
          .bind(data.run_id)
          .first<any>();
        if (run?.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(run.status, run.error).toBe('completed');
      expect(run.sets_skipped).toBe(1);
      expect(run.error).toContain('formula_bulk:1');

      const set = await db.prepare(`
        SELECT cached_at, valuation_expires_at
        FROM lego_sets
        WHERE set_num='75192'
      `).first<any>();
      expect(set.cached_at).toBeTruthy();
      expect(new Date(set.cached_at).getTime()).toBeGreaterThan(new Date('2020-01-01').getTime());
      expect(new Date(set.valuation_expires_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('returns recorded integration health for the admin', async () => {
      await db.prepare(
        `UPDATE lego_sets SET upc='0673419280310', used_value=725 WHERE set_num='75192'`
      ).run();
      await db.prepare(
        `UPDATE lego_sets SET ebay_new_value=180, ebay_used_value=140, ebay_new_qty=5, ebay_used_qty=4, bl_new_value=220 WHERE set_num='10300'`
      ).run();
      await db.prepare(
        `INSERT INTO integration_health (service, last_ok_at, ok_count, fail_count, updated_at)
         VALUES ('ebay', datetime('now'), 5, 1, datetime('now'))`
      ).run();
      const res = await app.fetch(new Request('http://localhost/api/admin/integrations', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.integrations.length).toBeGreaterThan(1);
      const ebay = data.integrations.find((row: any) => row.service === 'ebay');
      expect(ebay).toBeTruthy();
      expect(ebay.ok_count).toBe(5);
      expect(ebay.recommended_action).toBeTruthy();
      expect(Array.isArray(ebay.required_secrets)).toBe(true);
      const google = data.integrations.find((row: any) => row.service === 'google');
      expect(google.configured).toBe(false);
      expect(google.missing_secrets).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
      expect(google.recommended_action).toContain('GOOGLE_CLIENT_ID');
      expect(data.coverage.total_sets).toBe(2);
      expect(data.coverage.sets_with_upc).toBe(1);
      expect(data.coverage.sets_with_ebay).toBe(1);
      expect(data.coverage.sets_with_ebay_new).toBe(1);
      expect(data.coverage.sets_with_ebay_used).toBe(1);
      expect(data.coverage.sets_with_bricklink_new).toBe(1);
      expect(data.coverage.sets_with_bricklink_used).toBe(1);
      expect(data.coverage.sets_with_bricklink).toBe(2);
      expect(data.coverage.barcode_coverage_pct).toBe(50);
      expect(data.coverage.ebay_coverage_pct).toBe(50);
      expect(data.coverage.ebay_new_coverage_pct).toBe(50);
      expect(data.coverage.ebay_used_coverage_pct).toBe(50);
      expect(data.coverage.bricklink_coverage_pct).toBe(100);
      expect(data.coverage.quality.missing_msrp).toBe(0);
      expect(data.coverage.quality.missing_upc).toBe(1);
      expect(data.coverage.quality.low_confidence_values).toBe(2);
      expect(data.coverage.quality.needs_market_refresh).toBe(2);
      expect(data.api_routing.worker_base_url).toBe('http://localhost');
      // Blend-quality lens: 10300 has BrickLink + eBay (multi-source); 75192 has neither.
      expect(data.coverage.blend_quality).toBeTruthy();
      expect(data.coverage.blend_quality.multi_source).toBe(1);
      expect(data.coverage.blend_quality.src2).toBe(1);
      expect(data.coverage.blend_quality.src0).toBe(1);
      expect(data.coverage.blend_quality.blended_count).toBe(0);
      expect(data.coverage.blend_quality.confidence.estimated).toBe(1);
      expect(data.coverage.blend_quality.confidence.low).toBe(1);
    });

    it('expires running jobs when their progress heartbeat is stale', async () => {
      await db.prepare(`
        INSERT INTO import_runs (job_type, status, started_at, updated_at, progress_current, progress_total, progress_label)
        VALUES ('populate_everything', 'running', datetime('now', '-14 minutes'), datetime('now', '-12 minutes'), 433, 600, 'Refreshing 10057-1')
      `).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/import-status', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      const run = data.runs.find((row: any) => row.job_type === 'populate_everything');
      expect(run.status).toBe('expired');
      expect(run.progress_label).toBe('Stopped');
      expect(run.error).toContain('no progress heartbeat');
    });

    it('classifies provider access failures as degraded, not down', async () => {
      (env as any).EBAY_APP_ID = 'test-ebay-app-id';
      (env as any).EBAY_CLIENT_SECRET = 'test-ebay-client-secret';
      await db.prepare(
        `INSERT INTO integration_health (service, last_fail_at, last_error, ok_count, fail_count, updated_at)
         VALUES ('ebay', datetime('now'), 'HTTP 403', 0, 4, datetime('now'))`
      ).run();
      const res = await app.fetch(new Request('http://localhost/api/admin/integrations', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      const ebay = data.integrations.find((row: any) => row.service === 'ebay');
      expect(ebay.status).toBe('degraded');
      expect(ebay.reachable).toBe(true);
      expect(ebay.recommended_action).toContain('Marketplace Insights');
    });

    it('repairs the derived catalog search index with a narrow update trigger', async () => {
      const repair = await app.fetch(new Request('http://localhost/api/admin/repair-search-index', {
        method: 'POST',
        headers: auth(adminToken),
      }), env);
      expect(repair.status).toBe(200);
      const repairData = await repair.json<any>();
      expect(repairData.indexed_sets).toBe(2);

      const trigger = await db.prepare(
        `SELECT sql FROM sqlite_master WHERE type='trigger' AND name='lego_sets_au'`
      ).first<{ sql: string }>();
      expect(trigger?.sql).toContain('AFTER UPDATE OF set_num, name, theme ON lego_sets');

      await db.prepare(`UPDATE lego_sets SET upc='0673419280310' WHERE set_num='75192'`).run();
      const search = await app.fetch(new Request('http://localhost/api/sets/search?q=Millennium&limit=5'), env);
      expect(search.status).toBe(200);
      const searchData = await search.json<any>();
      expect(searchData.sets.some((set: any) => set.set_num === '75192')).toBe(true);
    });
  });

  describe('Minifigs route', () => {
    const seedFigs = async () => {
      await db.batch([
        db.prepare(`INSERT INTO minifigs (fig_num, name, series, rarity, current_value) VALUES ('sw0001', 'Luke Skywalker', 'Star Wars', 'legendary', 120)`),
        db.prepare(`INSERT INTO minifigs (fig_num, name, series, rarity, current_value) VALUES ('sw0002', 'Stormtrooper', 'Star Wars', 'common', NULL)`),
        db.prepare(`INSERT INTO minifigs (fig_num, name, series, rarity, current_value) VALUES ('cty001', 'Firefighter', 'City', 'uncommon', NULL)`),
      ]);
    };

    it('lists minifigs with rarity filter, returning raw current_value (null when unset)', async () => {
      await seedFigs();
      const res = await app.fetch(new Request('http://localhost/api/minifigs?rarity=common', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.minifigs).toHaveLength(1);
      expect(data.minifigs[0].fig_num).toBe('sw0002');
      // No stored value — returns null so the frontend can distinguish real prices from fallback.
      expect(data.minifigs[0].current_value).toBeNull();
      expect(data.total).toBe(1);
    });

    it('marks a fig owned, filters by ownership, then removes it', async () => {
      await seedFigs();
      const put = await app.fetch(new Request('http://localhost/api/minifigs/sw0001', {
        method: 'PUT', headers: auth(), body: JSON.stringify({ quantity: 2 }),
      }), env);
      expect(put.status).toBe(200);
      expect((await put.json<any>()).quantity).toBe(2);

      const owned = await app.fetch(new Request('http://localhost/api/minifigs?owned=yes', { headers: auth() }), env);
      const ownedData = await owned.json<any>();
      expect(ownedData.minifigs.map((f: any) => f.fig_num)).toEqual(['sw0001']);
      expect(ownedData.minifigs[0].owned_qty).toBe(2);

      const unowned = await app.fetch(new Request('http://localhost/api/minifigs?owned=no', { headers: auth() }), env);
      expect((await unowned.json<any>()).total).toBe(2);

      // Ownership is per-user: another user sees nothing owned.
      const other = await app.fetch(new Request('http://localhost/api/minifigs?owned=yes', { headers: auth(otherToken) }), env);
      expect((await other.json<any>()).total).toBe(0);

      const del = await app.fetch(new Request('http://localhost/api/minifigs/sw0001', { method: 'DELETE', headers: auth() }), env);
      expect(del.status).toBe(204);
      const after = await app.fetch(new Request('http://localhost/api/minifigs?owned=yes', { headers: auth() }), env);
      expect((await after.json<any>()).total).toBe(0);
    });

    it('404s when marking an unknown fig owned', async () => {
      const res = await app.fetch(new Request('http://localhost/api/minifigs/nope999', {
        method: 'PUT', headers: auth(), body: JSON.stringify({}),
      }), env);
      expect(res.status).toBe(404);
    });
  });

  describe('Collection item CRUD', () => {
    const addSet = async () => {
      const res = await app.fetch(new Request('http://localhost/api/collection', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ set_num: '75192', quantity: 1, condition: 'new', purchase_price: 700 }),
      }), env);
      expect(res.status).toBe(201);
      return (await res.json<any>()).item;
    };

    it('returns a single item with joined set fields', async () => {
      const item = await addSet();
      const res = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.item.set_num).toBe('75192');
      expect(data.item.name).toBe('Millennium Falcon');
      expect(data.item.purchase_price).toBe(700);
    });

    it('updates condition and storage, rejects invalid values', async () => {
      const item = await addSet();
      const patch = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, {
        method: 'PATCH', headers: auth(),
        body: JSON.stringify({ condition: 'sealed', storage_location: 'Shelf A', missing_pieces: 0 }),
      }), env);
      expect(patch.status).toBe(200);
      const updated = (await patch.json<any>()).item;
      expect(updated.condition).toBe('sealed');
      expect(updated.storage_location).toBe('Shelf A');

      const bad = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, {
        method: 'PATCH', headers: auth(),
        body: JSON.stringify({ condition: 'mint' }),
      }), env);
      expect(bad.status).toBe(400);
    });

    it('soft-deletes: item vanishes from reads but row survives', async () => {
      const item = await addSet();
      const del = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, {
        method: 'DELETE', headers: auth(),
      }), env);
      expect(del.status).toBe(204);

      const get = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, { headers: auth() }), env);
      expect(get.status).toBe(404);

      const row = await db.prepare('SELECT deleted_at FROM user_collection WHERE id=?')
        .bind(item.id).first<{ deleted_at: string | null }>();
      expect(row?.deleted_at).toBeTruthy();
    });

    it("blocks access to another user's item", async () => {
      const item = await addSet();
      const res = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, { headers: auth(otherToken) }), env);
      expect(res.status).toBe(404);
      const patch = await app.fetch(new Request(`http://localhost/api/collection/${item.id}`, {
        method: 'PATCH', headers: auth(otherToken), body: JSON.stringify({ quantity: 5 }),
      }), env);
      expect(patch.status).toBe(404);
    });
  });
});

describe('DB hygiene job', () => {
  // Own schema setup — this suite is outside the route-coverage describe, so
  // it can't rely on that suite's beforeEach having run.
  beforeEach(async () => {
    const db = (env as any).DB as D1Database;
    const sqls = [
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS oauth_sessions',
      'DROP TABLE IF EXISTS oauth_states',
      'DROP TABLE IF EXISTS import_runs',
      `CREATE TABLE rate_limits (
        user_id TEXT NOT NULL, endpoint TEXT NOT NULL, window_start TEXT NOT NULL,
        hit_count INTEGER DEFAULT 0, PRIMARY KEY (user_id, endpoint, window_start)
      )`,
      `CREATE TABLE oauth_sessions (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE oauth_states (state TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_type TEXT, status TEXT DEFAULT 'running',
        started_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT, progress_current INTEGER DEFAULT 0, progress_total INTEGER,
        progress_label TEXT, themes_loaded INTEGER, sets_loaded INTEGER, sets_skipped INTEGER,
        figs_loaded INTEGER, error TEXT
      )`,
    ];
    for (const sql of sqls) await db.prepare(sql).run();
  });

  it('purges stale rate limits, expired oauth nonces, and old import runs', async () => {
    const db = (env as any).DB as D1Database;
    const { runDbHygiene } = await import('./jobs/db-hygiene');

    await db.batch([
      // rate_limits: one stale (3 days old), one live (current hour)
      db.prepare(`INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
                  VALUES ('u1', 'scan_image', datetime('now', '-3 days'), 5)`),
      db.prepare(`INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
                  VALUES ('u1', 'scan_image', datetime('now'), 2)`),
      // oauth nonces: one expired 2 days ago, one still valid
      db.prepare(`INSERT INTO oauth_sessions (code, user_id, expires_at) VALUES ('old', 'u1', unixepoch() - 172800)`),
      db.prepare(`INSERT INTO oauth_sessions (code, user_id, expires_at) VALUES ('live', 'u1', unixepoch() + 300)`),
      db.prepare(`INSERT INTO oauth_states (state, user_id, expires_at) VALUES ('old', 'u1', unixepoch() - 172800)`),
      // import_runs: one ancient (60 days), one recent
      db.prepare(`INSERT INTO import_runs (job_type, status, started_at) VALUES ('daily', 'completed', datetime('now', '-60 days'))`),
      db.prepare(`INSERT INTO import_runs (job_type, status, started_at) VALUES ('daily', 'completed', datetime('now'))`),
    ]);

    const result = await runDbHygiene(env as any);
    expect(result.deleted.rate_limits).toBe(1);
    expect(result.deleted.oauth_sessions).toBe(1);
    expect(result.deleted.oauth_states).toBe(1);

    const rl = await db.prepare('SELECT COUNT(*) AS n FROM rate_limits').first<{ n: number }>();
    expect(rl?.n).toBe(1);
    const sessions = await db.prepare('SELECT code FROM oauth_sessions').all<{ code: string }>();
    expect(sessions.results.map(r => r.code)).toEqual(['live']);
  });

  it('keeps the 20 most recent import runs even when older than 30 days', async () => {
    const db = (env as any).DB as D1Database;
    const { runDbHygiene } = await import('./jobs/db-hygiene');

    // 25 ancient runs: with only these in the table, the 20 newest survive.
    for (let i = 0; i < 25; i++) {
      await db.prepare(
        `INSERT INTO import_runs (job_type, status, started_at) VALUES ('daily', 'completed', datetime('now', ?))`
      ).bind(`-${40 + i} days`).run();
    }

    const result = await runDbHygiene(env as any);
    expect(result.deleted.import_runs).toBe(5);
    const remaining = await db.prepare('SELECT COUNT(*) AS n FROM import_runs').first<{ n: number }>();
    expect(remaining?.n).toBe(20);
  });
});
