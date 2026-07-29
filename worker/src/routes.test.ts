/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from './index';
import { runEbaySoldScrape } from './jobs/ebay-sold-scrape';
import { USER_SCOPED_TABLES } from './routes/me';
import { recomputeBlendedValues } from './lib/market-sources';

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
    delete (env as any).PRICING_V3_READ_PERCENT;

    token = await createMockJWT(userId, JWT_SECRET);
    otherToken = await createMockJWT(otherUserId, JWT_SECRET);
    adminToken = await createMockJWT(adminUserId, JWT_SECRET);
    db = (env as any).DB;

    const sqls = [
      'DROP TABLE IF EXISTS user_collection',
      'DROP TABLE IF EXISTS collection_stories',
      'DROP TABLE IF EXISTS price_guesses',
      'DROP TABLE IF EXISTS lego_sets',
      'DROP TABLE IF EXISTS user_wishlist',
      'DROP TABLE IF EXISTS wishlist_alerts',
      'DROP TABLE IF EXISTS kids_badges',
      'DROP TABLE IF EXISTS user_prefs',
      'DROP TABLE IF EXISTS user_showcase',
      'DROP TABLE IF EXISTS portfolio_snapshots',
      'DROP TABLE IF EXISTS integration_health',
      'DROP TABLE IF EXISTS import_runs',
      'DROP TABLE IF EXISTS minifigs',
      'DROP TABLE IF EXISTS minifig_value_history',
      'DROP TABLE IF EXISTS lego_sets_fts',
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS oauth_sessions',
      'DROP TABLE IF EXISTS oauth_states',
      'DROP TABLE IF EXISTS user_minifigs',
      'DROP TABLE IF EXISTS set_value_history',
      'DROP TABLE IF EXISTS set_market_ext',
      'DROP TABLE IF EXISTS set_valuation_state',
      'DROP TABLE IF EXISTS upcoming_sets',

      `CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, year INTEGER,
        pieces INTEGER, minifigs INTEGER DEFAULT 0, retail_price REAL, current_value REAL,
        forecast_2y REAL, forecast_5y REAL, image_url TEXT, retired INTEGER DEFAULT 0,
        retirement_risk_score INTEGER, retirement_risk_updated_at TEXT, used_value REAL, ebay_value REAL, upc TEXT,
        ebay_new_value REAL, ebay_used_value REAL, ebay_new_qty INTEGER, ebay_used_qty INTEGER,
        ebay_new_cached_at TEXT, ebay_used_cached_at TEXT, ebay_new_last_sold TEXT, ebay_used_last_sold TEXT,
        bl_cached_at TEXT, be_cached_at TEXT,
        ebay_ask_value REAL, ebay_ask_qty INTEGER, ebay_ask_cached_at TEXT,
        valuation_method TEXT DEFAULT 'formula_bulk', bl_new_value REAL, bl_new_qty INTEGER, bl_used_qty INTEGER,
        bo_new_value REAL, bo_used_value REAL, bo_new_qty INTEGER, bo_used_qty INTEGER, bo_cached_at TEXT,
        brickinsights_rating INTEGER, brickinsights_review_count INTEGER, brickinsights_url TEXT, brickinsights_cached_at TEXT,
        valuation_expires_at TEXT, cached_at TEXT, source TEXT, ebay_cached_at TEXT, blended_value REAL,
        blended_confidence TEXT, blended_low REAL, blended_high REAL,
        subtheme TEXT, be_growth_12m REAL, bl_new_min REAL, bl_new_max REAL,
        be_value_new REAL, be_value_used REAL, be_forecast_2y REAL, be_forecast_5y REAL, be_retail REAL,
        bl_used_min REAL, bl_used_max REAL, lego_in_stock INTEGER, lego_retiring_soon INTEGER, lego_availability TEXT,
        theme_group TEXT, category TEXT, brickset_tags TEXT,
        created_at TEXT, age_min INTEGER, age_max INTEGER, brickset_rating REAL,
        brickset_review_count INTEGER, retired_year INTEGER, lego_checked_at TEXT,
        brickset_msrp REAL, launch_date TEXT, exit_date TEXT, brickset_enriched_at TEXT,
        brickset_dimensions TEXT, packaging_type TEXT, instructions_count INTEGER,
        additional_image_count INTEGER, brickset_description TEXT, brickset_set_id INTEGER,
        brickset_image_urls TEXT, brickset_images_cached_at TEXT,
        deal_signal TEXT, deal_discount_pct REAL, deal_strong INTEGER, deal_cached_at TEXT,
        part_out_value REAL, part_out_coverage REAL, part_out_cached_at TEXT,
        pc_new_value REAL, pc_complete_value REAL, pc_id TEXT, pc_cached_at TEXT
      )`,
      `CREATE TABLE set_market_ext (
        set_num TEXT PRIMARY KEY,
        pc_loose_value REAL, pc_sales_volume INTEGER,
        pa_retail_value REAL, pa_lowest_offer REAL, pa_in_stock INTEGER,
        pa_best_merchant TEXT, pa_offer_count INTEGER, pa_market TEXT, pa_cached_at TEXT,
        stockx_ask REAL, stockx_cached_at TEXT, ebay_sold_attempted_at TEXT, ebay_used_attempted_at TEXT,
        bl_nodata_at TEXT
      )`,
      `CREATE TABLE set_valuation_state (
        set_num TEXT NOT NULL, condition TEXT NOT NULL, fair_value REAL, low REAL, high REAL,
        liquidation_value REAL, confidence TEXT, confidence_score REAL, sample_count INTEGER,
        independent_family_count INTEGER, basis_json TEXT, flags_json TEXT, forecast_json TEXT,
        as_of TEXT, model_version TEXT, updated_at TEXT, PRIMARY KEY (set_num, condition)
      )`,
      `CREATE TABLE set_value_history (
        set_num TEXT NOT NULL, snapshot_date TEXT NOT NULL,
        current_value REAL, ebay_value REAL, bl_value REAL,
        PRIMARY KEY (set_num, snapshot_date)
      )`,
      `CREATE TABLE upcoming_sets (
        set_num TEXT PRIMARY KEY, name TEXT NOT NULL, price_usd REAL,
        availability TEXT, first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP, scraped_at TEXT
      )`,
      `CREATE VIRTUAL TABLE lego_sets_fts USING fts5(set_num, name, theme)`,
      `CREATE TABLE user_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1, condition TEXT NOT NULL DEFAULT 'new',
        purchase_price REAL, notes TEXT, added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        purchased_at TEXT, deleted_at TEXT, last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
        storage_location TEXT, acquisition_source TEXT, is_complete INTEGER DEFAULT 1,
        missing_pieces INTEGER DEFAULT 0, spike_alerted_at TEXT, custom_image_url TEXT,
        sold_price REAL, sold_at TEXT, UNIQUE(user_id, set_num)
      )`,
      `CREATE TABLE collection_stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        collection_id INTEGER, kind TEXT NOT NULL DEFAULT 'note' CHECK(kind IN ('note','photo')),
        body TEXT, r2_key TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE price_guesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, day TEXT NOT NULL,
        set_num TEXT NOT NULL, guessed_value REAL NOT NULL, actual_value REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        user_id TEXT PRIMARY KEY, handle TEXT, display_name TEXT, currency TEXT DEFAULT 'USD', retail_market TEXT DEFAULT 'FR',
        notify_price_drops INTEGER DEFAULT 1, notify_weekly_digest INTEGER DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
        expose_public_value INTEGER NOT NULL DEFAULT 1,
        google_refresh_token TEXT, google_spreadsheet_id TEXT,
        email TEXT, discord_webhook_url TEXT, brickset_user_hash TEXT,
        is_supporter INTEGER DEFAULT 0, supporter_since TEXT, stripe_customer_id TEXT,
        kids_pin_hash TEXT, kids_xp INTEGER NOT NULL DEFAULT 0, kids_level INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS kids_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, badge_slug TEXT NOT NULL,
        awarded_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, badge_slug)
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
        cached_at TEXT,
        ebay_value REAL, ebay_qty INTEGER, ebay_cached_at TEXT
      )`,
      `CREATE TABLE minifig_value_history (
        fig_num TEXT NOT NULL, snapshot_date TEXT NOT NULL,
        current_value REAL, ebay_value REAL,
        PRIMARY KEY (fig_num, snapshot_date)
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
      `CREATE TABLE IF NOT EXISTS set_minifigs (
        set_num TEXT NOT NULL, fig_num TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
        fig_name TEXT, fig_img_url TEXT, PRIMARY KEY (set_num, fig_num)
      )`,
      `CREATE TABLE IF NOT EXISTS set_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        rating INTEGER NOT NULL, title TEXT, body TEXT,
        status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS set_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        r2_key TEXT NOT NULL, caption TEXT,
        status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME
      )`,
      `CREATE TABLE IF NOT EXISTS set_contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        kind TEXT NOT NULL, payload TEXT NOT NULL, note TEXT,
        status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, review_note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME, deleted_at DATETIME
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
    // The unfiltered total is cached (the COUNT was a full catalog scan on every
    // page load). A cached total must never be served for a FILTERED query — that
    // would report the whole catalog as the result count.
    it('caches only the unfiltered total, never a filtered one', async () => {
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, current_value) VALUES ('CNT-1','One','Castle',2002,10)`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, current_value) VALUES ('CNT-2','Two','Castle',2003,20)`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, current_value) VALUES ('CNT-3','Three','City',2004,30)`),
      ]);

      // Other tests in this suite share the catalog, so compare against the DB
      // rather than hard-coded counts.
      const all = (await db.prepare(`SELECT COUNT(*) AS n FROM lego_sets`).first<{ n: number }>())!.n;
      const castle = (await db.prepare(`SELECT COUNT(*) AS n FROM lego_sets WHERE theme='Castle'`).first<{ n: number }>())!.n;
      expect(castle).toBeLessThan(all); // the filter must actually narrow

      const bare = await (await app.fetch(new Request('http://localhost/api/sets/search?limit=2'), env)).json<any>();
      expect(bare.total).toBe(all);

      // Filtered request while the unfiltered total is warm in KV.
      const filtered = await (await app.fetch(new Request('http://localhost/api/sets/search?theme=Castle&limit=50'), env)).json<any>();
      expect(filtered.total).toBe(castle);

      // Unfiltered again still reports the full catalog.
      const again = await (await app.fetch(new Request('http://localhost/api/sets/search?limit=2'), env)).json<any>();
      expect(again.total).toBe(all);
    });

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

    it('ranks real sets above non-building "Gear" merch for a keyword query', async () => {
      // Both rows match "millennium falcon". The Gear bag tag is the shorter /
      // tighter bm25 match, so WITHOUT the theme demotion it would rank first —
      // this asserts the demotion overrides raw text relevance.
      await db.batch([
        db.prepare(
          `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
           VALUES ('RELSET-1', 'Millennium Falcon Deluxe Edition', 'Star Wars', 2023, 1500, 180.00, 169.99, 0)`
        ),
        db.prepare(
          `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
           VALUES ('RELGEAR-1', 'Millennium Falcon', 'Gear', 2019, 0, 9.99, 7.99, 0)`
        ),
      ]);
      await db.prepare(
        `INSERT INTO lego_sets_fts(rowid, set_num, name, theme)
         SELECT rowid, set_num, name, theme FROM lego_sets WHERE set_num IN ('RELSET-1', 'RELGEAR-1')`
      ).run();

      const res = await app.fetch(
        new Request('http://localhost/api/sets/search?q=Millennium%20Falcon&limit=20'),
        env,
      );
      expect(res.status).toBe(200);
      const data = await res.json<any>();

      const setIdx = data.sets.findIndex((s: any) => s.set_num === 'RELSET-1');
      const gearIdx = data.sets.findIndex((s: any) => s.set_num === 'RELGEAR-1');

      // The merch is demoted, not hidden: both are still returned…
      expect(setIdx).toBeGreaterThan(-1);
      expect(gearIdx).toBeGreaterThan(-1);
      // …and the real set outranks the Gear item.
      expect(setIdx).toBeLessThan(gearIdx);

      // Stronger invariant: no Gear-themed result appears before a non-Gear one.
      const firstGear = data.sets.findIndex((s: any) => s.theme === 'Gear');
      const nonGearAfterGear = data.sets
        .slice(firstGear + 1)
        .some((s: any) => s.theme !== 'Gear');
      expect(nonGearAfterGear).toBe(false);
    });
  });

  describe('GET /api/catalog/seed (offline seed)', () => {
    it('returns compact, image-backed top sets ordered by value', async () => {
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, blended_value, retail_price, retired, image_url)
          VALUES ('SEED-HI', 'High Value Set', 'Icons', 2021, 3000, 400, 450, 300, 0, 'https://cdn.rebrickable.com/x.jpg')`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, blended_value, retail_price, retired, image_url)
          VALUES ('SEED-LO', 'Low Value Set', 'City', 2021, 200, 20, 25, 20, 0, 'https://cdn.rebrickable.com/y.jpg')`),
        db.prepare(`INSERT INTO lego_sets (
            set_num, name, theme, year, pieces, current_value, blended_value,
            retail_price, retired, image_url, be_value_new, be_cached_at,
            pc_new_value, pc_cached_at
          ) VALUES (
            'SEED-PC', 'Quarantined Variant', 'Star Wars', 2018, 100,
            280, 2413.58, 20, 1, 'https://cdn.rebrickable.com/pc.jpg',
            280, datetime('now'), 2413.58, datetime('now')
          )`),
        db.prepare(`INSERT INTO set_valuation_state (
            set_num, condition, fair_value, low, high, confidence,
            confidence_score, sample_count, independent_family_count,
            basis_json, flags_json, as_of, model_version
          ) VALUES (
            'SEED-PC', 'new_sealed', 280, 266, 410, 'low',
            30, 5, 1, '[]', '["history_anomaly"]', datetime('now'), 'v3-shadow'
          )`),
        // No image → must be excluded from the seed.
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
          VALUES ('SEED-NOIMG', 'No Image Set', 'City', 2021, 100, 500, 20, 0)`),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/catalog/seed?limit=50'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.model_version).toBe('v4');
      expect(data.valuation_generation).toMatch(/-1$/);
      const nums = data.sets.map((s: any) => s.set_num);
      expect(nums).toContain('SEED-HI');
      expect(nums).toContain('SEED-LO');
      expect(nums).not.toContain('SEED-NOIMG');           // no image_url → excluded
      expect(nums.indexOf('SEED-HI')).toBeLessThan(nums.indexOf('SEED-LO')); // value DESC
      const hi = data.sets.find((s: any) => s.set_num === 'SEED-HI');
      expect(hi.market_value).toBe(450);                  // shadow rollout keeps the legacy read path
      const quarantined = data.sets.find((s: any) => s.set_num === 'SEED-PC');
      expect(quarantined.market_value).toBe(280);         // PriceCharting cannot leak into the offline headline
      expect(quarantined.market_value_confidence).toBe('low');
      const searchRes = await app.fetch(new Request('http://localhost/api/sets/search?sort=value_desc&limit=100'), env);
      const searchData = await searchRes.json<any>();
      const searchQuarantined = searchData.sets.find((s: any) => s.set_num === 'SEED-PC');
      expect(searchQuarantined.market_value).toBe(quarantined.market_value);
      expect(searchQuarantined.market_value_confidence).toBe(quarantined.market_value_confidence);
      expect(hi).not.toHaveProperty('bl_new_min');        // compact: pricing internals stripped
      expect(res.headers.get('ETag')).toBeTruthy();
    });
  });

  describe('Admin maintenance jobs', () => {
    it('v3-preview reports the 0-vs-100 rollout delta for seeded holdings', async () => {
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, current_value, blended_value) VALUES ('PV-1','Preview Set', 100, 100)`),
        db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity) VALUES (?, 'PV-1', 1)`).bind(userId),
        db.prepare(`INSERT INTO set_valuation_state (set_num, condition, fair_value, confidence, model_version) VALUES ('PV-1','new_sealed', 150, 'high', 'v3')`),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/admin/pricing/v3-preview', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.holdings).toBeGreaterThanOrEqual(1);
      expect(data.users_with_delta).toBeGreaterThanOrEqual(1);
      expect(data.top_set_deltas[0].set_num).toBe('PV-1');
      expect(data.top_set_deltas[0].delta).toBe(50); // 150 v3 vs 100 legacy
    });

    it('recompute-blends fills a missing confidence band from existing sources', async () => {
      // A retired set with real market sources but a value persisted before the
      // band columns existed (blended_low/high NULL) — the v2.2-calibration gap.
      await db.prepare(
        `INSERT INTO lego_sets (set_num, name, theme, year, pieces, retired,
           bl_new_value, bl_cached_at, pc_new_value, pc_cached_at,
           be_value_new, be_cached_at, ebay_ask_value, ebay_ask_cached_at,
           blended_value, blended_confidence, blended_low, blended_high)
         VALUES ('RECOMP-1', 'Recompute Test Set', 'Icons', 2020, 1000, 1,
           100, datetime('now'), 105, datetime('now'),
           102, datetime('now'), 120, datetime('now'),
           103, NULL, NULL, NULL)`
      ).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/jobs/recompute-blends?limit=50', {
        method: 'POST', headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.ok).toBe(true);
      expect(data.recomputed).toBeGreaterThanOrEqual(1);

      const row = await db.prepare(
        `SELECT blended_low, blended_high FROM lego_sets WHERE set_num='RECOMP-1'`
      ).first<any>();
      expect(row.blended_low).not.toBeNull();
      expect(row.blended_high).not.toBeNull();
      expect(row.blended_high).toBeGreaterThan(row.blended_low);
    });

    it('brickinsights-ratings backfill prioritizes higher-value sets', async () => {
      // Two never-rated retired sets; with limit=1 only the highest-value one
      // (by the new COALESCE(blended_value,current_value) tiebreak) is processed.
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, retired, blended_value, current_value)
                    VALUES ('BIHI-1', 'High Value Set', 'Icons', 2018, 1, 9999, 9999)`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, year, retired, blended_value, current_value)
                    VALUES ('BILO-1', 'Low Value Set', 'Icons', 2018, 1, 5, 5)`),
      ]);

      (env as any).BRICKINSIGHTS_ENABLED = '1';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
        average_rating: '88', review_count: '10', url: 'https://brickinsights.com/sets/x',
      }), { status: 200 })) as any;
      try {
        const res = await app.fetch(new Request('http://localhost/api/admin/jobs/brickinsights-ratings?limit=1', {
          method: 'POST', headers: auth(adminToken),
        }), env);
        expect(res.status).toBe(200);
        const data = await res.json<any>();
        expect(data.ok).toBe(true);
        expect(data.processed).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
        delete (env as any).BRICKINSIGHTS_ENABLED;
      }

      const hi = await db.prepare(`SELECT brickinsights_rating FROM lego_sets WHERE set_num='BIHI-1'`).first<any>();
      const lo = await db.prepare(`SELECT brickinsights_rating FROM lego_sets WHERE set_num='BILO-1'`).first<any>();
      expect(hi.brickinsights_rating).toBe(88);
      expect(lo.brickinsights_rating).toBeNull();
    });

    it('flags Bright Data on the integration-health panel when it falls back to Firecrawl with no token', async () => {
      // No Bright Data token in the Worker env, Firecrawl present, not paused: the
      // scrape must record a brightdata health warning instead of silently degrading.
      // (The seed has no scrape candidates, so no network call is made.)
      delete (env as any).BRIGHTDATA_API_TOKEN;
      delete (env as any).BRIGHTDATA_API_TOKENS;
      delete (env as any).BRIGHTDATA_SOLD_ENABLED;
      (env as any).FIRECRAWL_API_KEY = 'test-firecrawl-key';
      try {
        await runEbaySoldScrape(env as any, { limit: 5 });
        const row = await db.prepare(
          `SELECT fail_count, last_error FROM integration_health WHERE service='brightdata'`
        ).first<any>();
        expect(row).toBeTruthy();
        expect(row.fail_count).toBeGreaterThanOrEqual(1);
        expect(String(row.last_error)).toMatch(/not configured/i);
      } finally {
        delete (env as any).FIRECRAWL_API_KEY;
      }
    });

    it('does not flag Bright Data when it is deliberately paused (BRIGHTDATA_SOLD_ENABLED=0)', async () => {
      delete (env as any).BRIGHTDATA_API_TOKEN;
      delete (env as any).BRIGHTDATA_API_TOKENS;
      (env as any).BRIGHTDATA_SOLD_ENABLED = '0';
      (env as any).FIRECRAWL_API_KEY = 'test-firecrawl-key';
      try {
        await runEbaySoldScrape(env as any, { limit: 5 });
        const row = await db.prepare(
          `SELECT 1 AS x FROM integration_health WHERE service='brightdata'`
        ).first<any>();
        expect(row).toBeNull();
      } finally {
        delete (env as any).FIRECRAWL_API_KEY;
        delete (env as any).BRIGHTDATA_SOLD_ENABLED;
      }
    });

    it('brightdata-reset-pool clears the exhausted/drained latch on the key pool', async () => {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS brightdata_keys (
           key_hash TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, cap INTEGER NOT NULL DEFAULT 5000,
           period_month TEXT, exhausted_at TEXT, last_used_at TEXT, updated_at TEXT
         )`
      ).run();
      await db.prepare(`DELETE FROM brightdata_keys`).run();
      await db.prepare(
        `INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at)
         VALUES ('hash-a', 5000, 5000, strftime('%Y-%m','now'), datetime('now')),
                ('hash-b', 4999, 5000, strftime('%Y-%m','now'), datetime('now'))`
      ).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/jobs/brightdata-reset-pool', {
        method: 'POST', headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.ok).toBe(true);
      expect(data.reset).toBe(2);

      const rows = await db.prepare(
        `SELECT used, exhausted_at FROM brightdata_keys ORDER BY key_hash`
      ).all<any>();
      for (const r of rows.results) {
        expect(r.used).toBe(0);
        expect(r.exhausted_at).toBeNull();
      }
      await db.prepare(`DROP TABLE brightdata_keys`).run();
    });

    it('ebay-sold-scrape admin job is dispatchable (skips cleanly when no scraper is configured)', async () => {
      delete (env as any).BRIGHTDATA_API_TOKEN;
      delete (env as any).BRIGHTDATA_API_TOKENS;
      delete (env as any).FIRECRAWL_API_KEY;
      const res = await app.fetch(new Request('http://localhost/api/admin/jobs/ebay-sold-scrape?limit=3', {
        method: 'POST', headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.ok).toBe(true);
      expect(data.job).toBe('ebay-sold-scrape');
      expect(String(data.skipped || '')).toMatch(/neither/i);
    });

    it('per-service test probe: d1 passes and an unknown service 400s', async () => {
      const good = await app.fetch(new Request('http://localhost/api/admin/test/d1', {
        method: 'POST', headers: auth(adminToken),
      }), env);
      expect(good.status).toBe(200);
      const gd = await good.json<any>();
      expect(gd.service).toBe('d1');
      expect(gd.ok).toBe(true);
      expect(typeof gd.ms).toBe('number');

      const bad = await app.fetch(new Request('http://localhost/api/admin/test/not-a-service', {
        method: 'POST', headers: auth(adminToken),
      }), env);
      expect(bad.status).toBe(400);
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

    it('shows the announced price immediately for an upcoming wishlisted set', async () => {
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, retail_price, current_value, valuation_method)
          VALUES ('90001-1', 'Upcoming Set', 799.99, 9.9, 'formula_bulk')`),
        db.prepare(`INSERT INTO upcoming_sets (set_num, name, price_usd, availability)
          VALUES ('90001-1', 'Upcoming Set', 849.99, 'Pre-order')`),
        db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES (?, '90001-1')`).bind(userId),
      ]);

      const response = await app.fetch(new Request('http://localhost/api/wishlist', { headers: auth() }), env);
      expect(response.status).toBe(200);
      const item = (await response.json<any>()).wishlist[0];
      expect(item.current_value).toBe(849.99);
      expect(item.upcoming_price).toBe(849.99);
      expect(item.coming_soon).toBe(true);
      expect(item.lego_availability).toBe('pre_order');
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
      await db.batch([
        db.prepare(`INSERT INTO user_showcase (user_id, set_num) VALUES (?, '75192')`).bind(userId),
        db.prepare(`INSERT INTO set_valuation_state (set_num, condition, fair_value, model_version)
                    VALUES ('75192', 'new_sealed', 899.5, 'v3-test')`),
      ]);
      (env as any).PRICING_V3_READ_PERCENT = '100';

      const res = await app.fetch(new Request('http://localhost/api/users/pub/profile'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.handle).toBe('pub');
      expect(data.display_name).toBe('Public Collector');
      expect(data.set_count).toBe(1);
      expect(data.total_value).toBeCloseTo(899.5, 1);
      expect(data.top_themes[0].theme).toBe('Star Wars');
      expect(data.showcase[0].market_value).toBeCloseTo(899.5, 1);
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

    it('leaderboard ranks opted-in public collections by value, excluding private ones', async () => {
      await db.batch([
        db.prepare(`INSERT INTO user_prefs (user_id, handle, display_name, is_public, expose_public_value) VALUES (?, 'rich', 'Rich', 1, 1)`).bind(userId),
        db.prepare(`INSERT INTO user_prefs (user_id, handle, display_name, is_public, expose_public_value) VALUES (?, 'modest', 'Modest', 1, 1)`).bind(otherUserId),
        db.prepare(`INSERT INTO user_prefs (user_id, handle, is_public, expose_public_value) VALUES ('lb-private', 'hidden', 0, 1)`),
        db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES (?, '75192', 2, 'new')`).bind(userId),
        db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES (?, '75192', 1, 'new')`).bind(otherUserId),
        db.prepare(`INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES ('lb-private', '75192', 9, 'new')`),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/users/leaderboard'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      // 'rich' (2×) outranks 'modest' (1×); the private profile is excluded
      // despite the highest value.
      expect(data.leaders.map((l: any) => l.handle)).toEqual(['rich', 'modest']);
      expect(data.leaders[0].rank).toBe(1);
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

    it('caps free-text fields at 500 chars server-side', async () => {
      const res = await app.fetch(new Request('http://localhost/api/collection', {
        method: 'POST',
        headers: auth(),
        body: JSON.stringify({ set_num: '75192', quantity: 1, notes: 'x'.repeat(5000) }),
      }), env);
      expect(res.status).toBe(201);
      const row = await db.prepare(
        `SELECT LENGTH(notes) AS n FROM user_collection WHERE user_id=? AND set_num='75192'`
      ).bind(userId).first<{ n: number }>();
      expect(row?.n).toBe(500);
    });

    it('caps external catalog lookups at 25 per import request', async () => {
      (env as any).REBRICKABLE_API_KEY = 'test-key';
      const originalFetch = globalThis.fetch;
      // Successful Rebrickable lookup for whichever set was requested.
      const fetchSpy = vi.fn(async (url: any) => {
        const m = String(url).match(/sets\/([^/]+)\//);
        const setNum = decodeURIComponent(m?.[1] || '999999-1');
        return new Response(JSON.stringify({
          set_num: setNum, name: `Set ${setNum}`, year: 2020,
          num_parts: 100, num_minifigs: 0, set_img_url: null,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
      globalThis.fetch = fetchSpy as any;
      try {
        // 28 unique unknown sets: only the first 25 may hit Rebrickable; the
        // remaining 3 must be skipped with an explicit lookup-limit reason
        // instead of firing 28 serial external subrequests.
        const rows = Array.from({ length: 28 }, (_, i) => ({ set_num: `99900${i}-1`, quantity: 1 }));
        const res = await app.fetch(new Request('http://localhost/api/collection/import', {
          method: 'POST',
          headers: auth(),
          body: JSON.stringify({ rows }),
        }), env);
        expect(res.status).toBe(200);
        const data = await res.json<any>();
        expect(fetchSpy.mock.calls.length).toBe(25);
        expect(data.imported).toBe(25);
        expect(data.errors.filter((e: any) => String(e.reason).includes('lookup limit'))).toHaveLength(3);
      } finally {
        globalThis.fetch = originalFetch;
        delete (env as any).REBRICKABLE_API_KEY;
      }
    });

    it('insurance report: Pro user gets printable HTML with set + totals', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, is_supporter) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET is_supporter=1`
      ).bind(userId).run();
      await db.prepare(
        `UPDATE lego_sets SET blended_value=850, blended_confidence='high' WHERE set_num='75192'`
      ).run();
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
         VALUES (?, '75192', 1, 'new', 700)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/me/insurance-report', { headers: auth() }), env);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const html = await res.text();
      expect(html).toContain('75192');
      expect(html).toContain('$850.00');
      expect(html).toContain('Verified market price');
      expect(html).toContain('methodology');
    });

    it('insurance report: free user gets a 403 naming the Pro gate', async () => {
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num) VALUES (?, '75192')`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/me/insurance-report', { headers: auth() }), env);
      expect(res.status).toBe(403);
      const data = await res.json<any>();
      expect(data.error).toMatch(/Pro/);
    });

    it('exports CSV with a header row and the owned set (Pro)', async () => {
      await db.prepare(
        `INSERT INTO user_prefs (user_id, is_supporter) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET is_supporter=1`
      ).bind(userId).run();
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

    it('free export keeps the entered data but omits the Pro market columns', async () => {
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
         VALUES (?, '75192', 1, 'new', 700)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/collection/export', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const csv = await res.text();
      const header = csv.split('\n')[0];
      // Data portability: everything the user typed in still exports…
      expect(header).toContain('set_num');
      expect(header).toContain('purchase_price');
      expect(header).toContain('notes');
      // …but the computed market-intelligence columns are Pro-only.
      expect(header).not.toContain('current_value');
      expect(header).not.toContain('roi_pct');
      expect(header).not.toContain('retail_price');
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

    it('caps history depth at 90 days for free users and unlocks 365 for Pro', async () => {
      await db.batch([
        db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
                    VALUES (?, DATE('now', '-120 days'), 500, 400, 2)`).bind(userId),
        db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value, total_paid, set_count)
                    VALUES (?, DATE('now'), 1000, 800, 3)`).bind(userId),
      ]);
      // Free: the 120-day-old snapshot is outside the capped window.
      const free = await app.fetch(new Request('http://localhost/api/collection/history?days=365', { headers: auth() }), env);
      const freeData = await free.json<any>();
      expect(freeData.days).toBe(90);
      expect(freeData.pro).toBe(false);
      expect(freeData.snapshots).toHaveLength(1);
      // Pro: the same request returns the full year.
      await db.prepare(
        `INSERT INTO user_prefs (user_id, is_supporter) VALUES (?, 1)
         ON CONFLICT(user_id) DO UPDATE SET is_supporter=1`
      ).bind(userId).run();
      const pro = await app.fetch(new Request('http://localhost/api/collection/history?days=365', { headers: auth() }), env);
      const proData = await pro.json<any>();
      expect(proData.days).toBe(365);
      expect(proData.pro).toBe(true);
      expect(proData.snapshots).toHaveLength(2);
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
      expect(data.done).toBe(false);
      expect(data.coverage.pricing_v3_missing).toBeGreaterThan(0);
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
      expect(data.done).toBe(false);
      expect(data.coverage.pricing_v3_missing).toBeGreaterThan(0);
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
      expect(run.sets_skipped).toBeGreaterThanOrEqual(1);
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
      // Firecrawl diagnostics block: credit ledger + bootstrap snapshot + action.
      expect(data.firecrawl).toBeTruthy();
      expect(typeof data.firecrawl.daily_cap).toBe('number');
      expect(typeof data.firecrawl.credits_used_today).toBe('number');
      expect(data.firecrawl.bootstrap).toBeTruthy();
      expect(data.firecrawl.recommended_action).toBeTruthy();
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
      // rebuildSearchIndex detects indexable columns via pragma_table_info, so the
      // narrow trigger covers whichever of (set_num, name, theme, subtheme,
      // theme_group, brickset_tags) the table actually has. This fixture now mirrors
      // production (subtheme + theme_group + brickset_tags all present), so the trigger
      // fires on all 6 FTS columns — still narrow (not upc, current_value, etc.).
      expect(trigger?.sql).toContain('AFTER UPDATE OF set_num, name, theme, subtheme, theme_group, brickset_tags ON lego_sets');

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

    it('returns distinct series with counts for the filter dropdown', async () => {
      await seedFigs();
      const res = await app.fetch(new Request('http://localhost/api/minifigs/series', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      // Most-populated series first; empty/null series excluded.
      expect(data.series).toEqual([
        { series: 'Star Wars', n: 2 },
        { series: 'City', n: 1 },
      ]);
    });

    it('sorts by scarcity: fewest set appearances first, unknown (null) last', async () => {
      await db.batch([
        db.prepare(`INSERT INTO minifigs (fig_num, name, appears_in_sets) VALUES ('a1', 'A One', 5)`),
        db.prepare(`INSERT INTO minifigs (fig_num, name, appears_in_sets) VALUES ('a2', 'A Two', 1)`),
        db.prepare(`INSERT INTO minifigs (fig_num, name, appears_in_sets) VALUES ('a3', 'A Three', NULL)`),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/minifigs?sort=scarcity', { headers: auth() }), env);
      const data = await res.json<any>();
      expect(data.minifigs.map((f: any) => f.fig_num)).toEqual(['a2', 'a1', 'a3']);
    });

    it('blindbox resolves a CMF series barcode to its candidate figs', async () => {
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme, upc) VALUES ('71051-0', 'Series 28 - Random Box', 'Collectible Minifigures', '673419419536')`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme) VALUES ('71051-1', 'Peacock Suit', 'Collectible Minifigures')`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme) VALUES ('71051-2', 'Cat Suit', 'Collectible Minifigures')`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, theme) VALUES ('71051-13', 'Series 28 - Complete - All Sets', 'Collectible Minifigures')`),
        db.prepare(`INSERT INTO minifigs (fig_num, name, rarity) VALUES ('fig-peacock', 'Peacock Suit', 'rare')`),
        db.prepare(`INSERT INTO minifigs (fig_num, name, rarity) VALUES ('fig-cat', 'Cat Suit', 'rare')`),
        db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('71051-1', 'fig-peacock', 1)`),
        db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('71051-2', 'fig-cat', 1)`),
        // The "Complete" meta-entry also lists a fig — it must be excluded.
        db.prepare(`INSERT INTO set_minifigs (set_num, fig_num, quantity) VALUES ('71051-13', 'fig-peacock', 1)`),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/minifigs/blindbox?code=673419419536'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.series).toBe('Series 28');
      expect(data.figs.map((f: any) => f.fig_num).sort()).toEqual(['fig-cat', 'fig-peacock']);
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

    it('rolls up portfolio pricing confidence over priced holdings', async () => {
      await addSet();
      // Give the set a fresh single sold source → medium-confidence blend.
      await db.prepare(
        "UPDATE lego_sets SET valuation_method='market', bl_new_value=820, bl_new_qty=8, bl_cached_at=datetime('now'), blended_value=820 WHERE set_num='75192'"
      ).run();
      const res = await app.fetch(new Request('http://localhost/api/collection', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.pricing_confidence).toBeTruthy();
      expect(data.pricing_confidence.priced).toBe(1);
      expect(data.pricing_confidence.high_medium).toBe(1);
      expect(data.pricing_confidence.pct).toBe(75);       // medium confidence is weighted at 75%
    });

    it('uses the same complete market blend for collection cards and the portfolio total', async () => {
      await addSet();
      await db.prepare(
        "UPDATE lego_sets SET current_value=850, pc_new_value=1200, pc_cached_at=datetime('now'), blended_value=1200 WHERE set_num='75192'"
      ).run();
      await recomputeBlendedValues(db, ['75192']);
      const res = await app.fetch(new Request('http://localhost/api/collection', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.items[0].market_value).toBeCloseTo(850, 1); // unverified legacy PC cannot alter fair value
      expect(data.total_value).toBeCloseTo(data.items[0].market_value, 1);
    });

    it('records condition when adding a set as Used (drives used-vs-new valuation)', async () => {
      const add = await app.fetch(new Request('http://localhost/api/collection', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ set_num: '75192', quantity: 1, condition: 'used_good' }),
      }), env);
      expect(add.status).toBe(201);
      expect((await add.json<any>()).item.condition).toBe('used_good');
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

  describe('Themes route', () => {
    it('aggregates distinct themes, theme groups, and categories', async () => {
      await db.batch([
        db.prepare("UPDATE lego_sets SET theme_group='Star Wars Universe', category='Normal' WHERE set_num='75192'"),
        db.prepare("UPDATE lego_sets SET theme_group='Icons Group', category='Normal' WHERE set_num='10300'"),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/themes'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.themes).toEqual(expect.arrayContaining(['Star Wars', 'Icons']));
      expect(data.theme_groups).toEqual(expect.arrayContaining(['Star Wars Universe', 'Icons Group']));
      expect(data.categories).toEqual(['Normal']);
    });
  });

  describe('GET /api/upcoming', () => {
    it('returns empty array when table does not exist', async () => {
      const res = await app.fetch(new Request('http://localhost/api/upcoming'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(Array.isArray(data.upcoming)).toBe(true);
    });

    it('returns upcoming sets ordered by price descending', async () => {
      await db.prepare(
        `CREATE TABLE IF NOT EXISTS upcoming_sets (
          set_num TEXT PRIMARY KEY, name TEXT NOT NULL, price_usd REAL,
          availability TEXT, first_seen_at TEXT, scraped_at TEXT
        )`
      ).run();
      await db.batch([
        db.prepare(`INSERT INTO upcoming_sets (set_num, name, price_usd, availability) VALUES ('99001-1', 'Cheap Set', 49.99, 'Pre-order')`),
        db.prepare(`INSERT INTO upcoming_sets (set_num, name, price_usd, availability) VALUES ('99002-1', 'Expensive Set', 349.99, 'Coming Soon')`),
      ]);

      const res = await app.fetch(new Request('http://localhost/api/upcoming'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.upcoming).toHaveLength(2);
      expect(data.upcoming[0].set_num).toBe('99002-1');
      expect(data.upcoming[0].price_usd).toBe(349.99);
      expect(data.upcoming[0].availability).toBe('Coming Soon');
      expect(data.upcoming[1].set_num).toBe('99001-1');
    });
  });

  describe('Admin coverage fields', () => {
    it('includes brickset_enrich_remaining in integration coverage', async () => {
      // One set has brickset_enriched_at set, one does not — both are year>=2000.
      await db.prepare(`UPDATE lego_sets SET brickset_enriched_at=datetime('now') WHERE set_num='75192'`).run();

      const res = await app.fetch(new Request('http://localhost/api/admin/integrations', {
        headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      // 75192 is year 2017 (enriched), 10300 is year 2022 (not enriched) → 1 remaining.
      expect(typeof data.coverage.brickset_enrich_remaining).toBe('number');
      expect(data.coverage.brickset_enrich_remaining).toBe(1);
    });

    it('rejects unknown job names from /api/admin/jobs/:job', async () => {
      const res = await app.fetch(new Request('http://localhost/api/admin/jobs/nonexistent-job', {
        method: 'POST', headers: auth(adminToken),
      }), env);
      expect(res.status).toBe(400);
      const data = await res.json<any>();
      expect(data.error).toContain('nonexistent-job');
    });
  });

  describe('Snapshot jobs', () => {
    it('snapshots each user portfolio at COALESCE(blended_value, current_value) x qty', async () => {
      const { runSnapshotPortfolios } = await import('./jobs/snapshot-portfolios');
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
         VALUES (?, '75192', 2, 'new', 700)`
      ).bind(userId).run();

      const result = await runSnapshotPortfolios(env as any);
      expect(result.snapped).toBe(1);

      const snap = await db.prepare(
        'SELECT total_value, total_paid, set_count FROM portfolio_snapshots WHERE user_id=?'
      ).bind(userId).first<any>();
      // 75192 current_value 849.99, blended_value NULL -> COALESCE picks current_value
      expect(snap.total_value).toBeCloseTo(849.99 * 2, 1);
      expect(snap.total_paid).toBeCloseTo(700 * 2, 1);
      expect(snap.set_count).toBe(1);
    });

    it('records owned/wishlisted set values into set_value_history', async () => {
      const { runSnapshotSetValues } = await import('./jobs/snapshot-set-values');
      await db.prepare(
        "INSERT INTO user_collection (user_id, set_num, quantity, condition) VALUES (?, '75192', 1, 'new')"
      ).bind(userId).run();

      const result = await runSnapshotSetValues(env as any);
      expect(result.snapshotted).toBeGreaterThanOrEqual(1);

      const hist = await db.prepare(
        "SELECT current_value FROM set_value_history WHERE set_num='75192' AND snapshot_date = DATE('now')"
      ).first<any>();
      expect(hist).toBeTruthy();
      expect(hist.current_value).toBeCloseTo(849.99, 1);
    });

    it('snapshots high-value catalog sets (not owned/wishlisted) and prefers the blended value', async () => {
      const { runSnapshotSetValues } = await import('./jobs/snapshot-set-values');
      // A set that is neither owned nor wishlisted but high-value should still
      // accumulate history, and the snapshotted figure should be the blended
      // market value (250), not the legacy current_value (200).
      await db.prepare(
        "INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, blended_value, retired) VALUES ('D2TEST-1', 'Catalog Whale', 'Icons', 2020, 1000, 200, 250, 0)"
      ).run();

      await runSnapshotSetValues(env as any);

      const hist = await db.prepare(
        "SELECT current_value FROM set_value_history WHERE set_num='D2TEST-1' AND snapshot_date = DATE('now')"
      ).first<any>();
      expect(hist).toBeTruthy();
      expect(hist.current_value).toBeCloseTo(250, 1);
    });

    it('snapshots priced minifigs into minifig_value_history (and skips unpriced)', async () => {
      const { runSnapshotSetValues } = await import('./jobs/snapshot-set-values');
      await db.batch([
        db.prepare("INSERT INTO minifigs (fig_num, name, current_value, ebay_value) VALUES ('sw0010', 'Priced Fig', 42.5, 40)"),
        db.prepare("INSERT INTO minifigs (fig_num, name, current_value) VALUES ('sw0011', 'Unpriced Fig', NULL)"),
      ]);

      const result = await runSnapshotSetValues(env as any);
      expect(result.figSnapshotted).toBeGreaterThanOrEqual(1);

      const priced = await db.prepare(
        "SELECT current_value, ebay_value FROM minifig_value_history WHERE fig_num='sw0010' AND snapshot_date = DATE('now')"
      ).first<any>();
      expect(priced).toBeTruthy();
      expect(priced.current_value).toBeCloseTo(42.5, 1);

      const unpriced = await db.prepare(
        "SELECT 1 FROM minifig_value_history WHERE fig_num='sw0011'"
      ).first<any>();
      expect(unpriced).toBeFalsy();
    });
  });

  describe('minifig detail + history routes', () => {
  it('GET /api/minifigs/:fignum returns a real value + source when priced', async () => {
    const db = (env as any).DB as D1Database;
    await db.prepare(
      "INSERT INTO minifigs (fig_num, name, series, rarity, current_value, source, appears_in_sets) VALUES ('sw0020', 'Boba Fett', 'Star Wars', 'legendary', 95, 'bricklink+ebay', 4)"
    ).run();
    const res = await app.fetch(new Request('http://localhost/api/minifigs/sw0020'), env);
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.minifig.value).toBeCloseTo(95, 1);
    expect(body.minifig.value_is_estimate).toBe(false);
    expect(body.minifig.source).toBe('bricklink+ebay');
  });

  it('GET /api/minifigs/:fignum flags a rarity estimate when unpriced', async () => {
    const db = (env as any).DB as D1Database;
    await db.prepare(
      "INSERT INTO minifigs (fig_num, name, rarity, current_value) VALUES ('cty050', 'Common Cop', 'common', NULL)"
    ).run();
    const res = await app.fetch(new Request('http://localhost/api/minifigs/cty050'), env);
    const body = await res.json<any>();
    expect(body.minifig.value_is_estimate).toBe(true);
    expect(body.minifig.value).toBeCloseTo(3.5, 2);
  });

  it('GET /api/minifigs/:fignum/history returns ordered snapshots', async () => {
    const db = (env as any).DB as D1Database;
    await db.batch([
      db.prepare("INSERT INTO minifigs (fig_num, name) VALUES ('sw0021', 'Fig With History')"),
      db.prepare("INSERT INTO minifig_value_history (fig_num, snapshot_date, current_value) VALUES ('sw0021', DATE('now','-2 days'), 10)"),
      db.prepare("INSERT INTO minifig_value_history (fig_num, snapshot_date, current_value) VALUES ('sw0021', DATE('now'), 14)"),
    ]);
    const res = await app.fetch(new Request('http://localhost/api/minifigs/sw0021/history?days=90'), env);
    const body = await res.json<any>();
    expect(body.history.length).toBe(2);
    expect(body.history[0].current_value).toBeCloseTo(10, 1);
    expect(body.history[1].current_value).toBeCloseTo(14, 1);
  });
  });

  describe('Set stories', () => {
    let entryId: number;
    beforeEach(async () => {
      await db.prepare(`INSERT INTO lego_sets (set_num, name, current_value) VALUES ('75192-1', 'Millennium Falcon', 800)`).run();
      const row = await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, purchase_price) VALUES (?, '75192-1', 700) RETURNING id`
      ).bind(userId).first<{ id: number }>();
      entryId = row!.id;
    });

    it('adds a note and lists it on the timeline', async () => {
      const post = await app.fetch(new Request(`http://localhost/api/collection/${entryId}/story`, {
        method: 'POST', headers: auth(), body: JSON.stringify({ body: 'Built it with my son over the holidays.' }),
      }), env);
      expect(post.status).toBe(200);
      const list = await app.fetch(new Request(`http://localhost/api/collection/${entryId}/story`, { headers: auth() }), env);
      const data = await list.json<{ set_num: string; stories: Array<{ kind: string; body: string }> }>();
      expect(data.set_num).toBe('75192-1');
      expect(data.stories.length).toBe(1);
      expect(data.stories[0].kind).toBe('note');
      expect(data.stories[0].body).toContain('holidays');
    });

    it('rejects empty and over-long notes', async () => {
      const empty = await app.fetch(new Request(`http://localhost/api/collection/${entryId}/story`, {
        method: 'POST', headers: auth(), body: JSON.stringify({ body: '   ' }),
      }), env);
      expect(empty.status).toBe(400);
      const long = await app.fetch(new Request(`http://localhost/api/collection/${entryId}/story`, {
        method: 'POST', headers: auth(), body: JSON.stringify({ body: 'x'.repeat(1001) }),
      }), env);
      expect(long.status).toBe(400);
    });

    it("404s on another user's entry and deletes only own stories", async () => {
      const foreign = await app.fetch(new Request(`http://localhost/api/collection/${entryId}/story`, {
        method: 'POST', headers: auth(otherToken), body: JSON.stringify({ body: 'not mine' }),
      }), env);
      expect(foreign.status).toBe(404);

      const post = await app.fetch(new Request(`http://localhost/api/collection/${entryId}/story`, {
        method: 'POST', headers: auth(), body: JSON.stringify({ body: 'mine' }),
      }), env);
      const { id: storyId } = await post.json<{ id: number }>();
      const foreignDel = await app.fetch(new Request(`http://localhost/api/collection/story/${storyId}`, {
        method: 'DELETE', headers: auth(otherToken),
      }), env);
      expect(foreignDel.status).toBe(404);
      const del = await app.fetch(new Request(`http://localhost/api/collection/story/${storyId}`, {
        method: 'DELETE', headers: auth(),
      }), env);
      expect(del.status).toBe(204);
      const n = await db.prepare('SELECT COUNT(*) AS n FROM collection_stories').first<{ n: number }>();
      expect(n!.n).toBe(0);
    });
  });

  describe('GET /api/me/wrapped', () => {
    it('aggregates the collector year: adds, sales, snapshots, best performer', async () => {
      const year = new Date().getUTCFullYear();
      await db.batch([
        db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, current_value, blended_value) VALUES ('W1-1', 'Winner', 1000, 200, 200)`),
        db.prepare(`INSERT INTO lego_sets (set_num, name, pieces, current_value) VALUES ('W2-1', 'Sold One', 500, 300)`),
        db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, purchased_at) VALUES (?, 'W1-1', 100, '2020-03-01')`).bind(userId),
        db.prepare(`INSERT INTO user_collection (user_id, set_num, purchase_price, sold_price, sold_at, deleted_at) VALUES (?, 'W2-1', 100, 250, ?, datetime('now'))`).bind(userId, `${year}-05-10`),
        db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value) VALUES (?, ?, 1000)`).bind(userId, `${year}-01-05`),
        db.prepare(`INSERT INTO portfolio_snapshots (user_id, snapshot_date, total_value) VALUES (?, ?, 1500)`).bind(userId, `${year}-06-01`),
      ]);
      const res = await app.fetch(new Request('http://localhost/api/me/wrapped', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const w = await res.json<Record<string, any>>();
      expect(w.year).toBe(year);
      expect(w.sets_added).toBe(2);           // both rows added_at now
      expect(w.invested).toBe(200);
      expect(w.pieces_added).toBe(1500);
      expect(w.sets_sold).toBe(1);
      expect(w.sale_total).toBe(250);
      expect(w.realized_gain).toBe(150);
      expect(w.value_start).toBe(1000);
      expect(w.value_end).toBe(1500);
      expect(w.best_performer.set_num).toBe('W1-1');
      expect(w.best_performer.roi_pct).toBe(100);
      expect(w.longest_held.set_num).toBe('W1-1');
    });

    it('requires auth', async () => {
      const res = await app.fetch(new Request('http://localhost/api/me/wrapped'), env);
      expect(res.status).toBe(401);
    });
  });

  describe('Daily price game', () => {
    beforeEach(async () => {
      const stmts = [];
      for (let i = 1; i <= 8; i++) {
        stmts.push(db.prepare(
          `INSERT INTO lego_sets (set_num, name, theme, year, pieces, image_url, retail_price, blended_value, current_value, valuation_method)
           VALUES (?, ?, 'Icons', 2020, 1000, 'https://img/x.jpg', 100, ?, ?, 'market')`
        ).bind(`G${i}-1`, `Game Set ${i}`, 100 + i * 50, 100 + i * 50));
      }
      await db.batch(stmts);
    });

    it('serves five deterministic rounds with values withheld', async () => {
      const a = await (await app.fetch(new Request('http://localhost/api/game/daily'), env)).json<any>();
      const b = await (await app.fetch(new Request('http://localhost/api/game/daily'), env)).json<any>();
      expect(a.rounds.length).toBe(5);
      expect(a.rounds.map((r: any) => r.set_num)).toEqual(b.rounds.map((r: any) => r.set_num));
      for (const r of a.rounds) {
        expect(r.value).toBeUndefined();
        expect(r.name).toBeTruthy();
      }
    });

    it('scores a guess within ±20% as correct and records it for members', async () => {
      const daily = await (await app.fetch(new Request('http://localhost/api/game/daily'), env)).json<any>();
      const setNum = daily.rounds[0].set_num;
      const actualRow = await db.prepare('SELECT blended_value AS v FROM lego_sets WHERE set_num=?').bind(setNum).first<{ v: number }>();
      const res = await app.fetch(new Request('http://localhost/api/game/guess', {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ set_num: setNum, guess: actualRow!.v * 1.1 }),
      }), env);
      expect(res.status).toBe(200);
      const out = await res.json<any>();
      expect(out.correct).toBe(true);
      expect(out.actual).toBe(actualRow!.v);
      const n = await db.prepare('SELECT COUNT(*) AS n FROM price_guesses WHERE user_id=?').bind(userId).first<{ n: number }>();
      expect(n!.n).toBe(1);
    });

    it('guests get scored but nothing is recorded', async () => {
      const daily = await (await app.fetch(new Request('http://localhost/api/game/daily'), env)).json<any>();
      const res = await app.fetch(new Request('http://localhost/api/game/guess', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_num: daily.rounds[0].set_num, guess: 10 }),
      }), env);
      expect(res.status).toBe(200);
      const out = await res.json<any>();
      expect(out.correct).toBe(false);
      const n = await db.prepare('SELECT COUNT(*) AS n FROM price_guesses').first<{ n: number }>();
      expect(n!.n).toBe(0);
    });

    it("404s a set that isn't in today's game and 400s junk guesses", async () => {
      const notInGame = await app.fetch(new Request('http://localhost/api/game/guess', {
        method: 'POST', headers: auth(), body: JSON.stringify({ set_num: 'NOPE-1', guess: 100 }),
      }), env);
      expect(notInGame.status).toBe(404);
      const junk = await app.fetch(new Request('http://localhost/api/game/guess', {
        method: 'POST', headers: auth(), body: JSON.stringify({ set_num: 'G1-1', guess: -5 }),
      }), env);
      expect(junk.status).toBe(400);
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
      'DROP TABLE IF EXISTS lego_sets',
      `CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY, name TEXT, retail_price REAL, brickset_msrp REAL, be_retail REAL,
        current_value REAL, valuation_method TEXT DEFAULT 'formula_bulk', lego_availability TEXT
      )`,
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

  it('backfills retail_price from brickset_msrp / be_retail without clobbering a real retail', async () => {
    const db = (env as any).DB as D1Database;
    const { runDbHygiene } = await import('./jobs/db-hygiene');
    await db.batch([
      db.prepare("INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp) VALUES ('A-1', 'From MSRP', NULL, 49.99)"),
      db.prepare("INSERT INTO lego_sets (set_num, name, retail_price, be_retail) VALUES ('B-1', 'From BE retail', 0, 120)"),
      db.prepare("INSERT INTO lego_sets (set_num, name, retail_price, brickset_msrp) VALUES ('C-1', 'Already set', 200, 180)"),
      db.prepare("INSERT INTO lego_sets (set_num, name) VALUES ('D-1', 'No source')"),
    ]);

    const result = await runDbHygiene(env as any);
    expect(result.retailBackfilled).toBe(2);

    const rows = await db.prepare('SELECT set_num, retail_price FROM lego_sets ORDER BY set_num').all<{ set_num: string; retail_price: number | null }>();
    const byNum = Object.fromEntries(rows.results.map(r => [r.set_num, r.retail_price]));
    expect(byNum['A-1']).toBeCloseTo(49.99, 2);
    expect(byNum['B-1']).toBeCloseTo(120, 2);
    expect(byNum['C-1']).toBeCloseTo(200, 2); // not clobbered
    expect(byNum['D-1']).toBeNull();
  });

});

describe('Kids PIN and XP', () => {
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  const userId = 'kids-test-user';
  let token: string;
  let db: D1Database;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = JWT_SECRET;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'supabase-anon-key-mock';
    (env as any).ADMIN_USER_ID = 'admin-user';

    token = await createMockJWT(userId, JWT_SECRET);
    db = (env as any).DB;

    const sqls = [
      'DROP TABLE IF EXISTS kids_badges',
      'DROP TABLE IF EXISTS user_prefs',
      'DROP TABLE IF EXISTS user_collection',
      'DROP TABLE IF EXISTS lego_sets',
      'DROP TABLE IF EXISTS user_wishlist',
      'DROP TABLE IF EXISTS wishlist_alerts',
      'DROP TABLE IF EXISTS user_showcase',
      'DROP TABLE IF EXISTS portfolio_snapshots',
      'DROP TABLE IF EXISTS integration_health',
      'DROP TABLE IF EXISTS import_runs',
      'DROP TABLE IF EXISTS minifigs',
      'DROP TABLE IF EXISTS minifig_value_history',
      'DROP TABLE IF EXISTS lego_sets_fts',
      'DROP TABLE IF EXISTS rate_limits',
      'DROP TABLE IF EXISTS oauth_sessions',
      'DROP TABLE IF EXISTS oauth_states',
      'DROP TABLE IF EXISTS user_minifigs',
      'DROP TABLE IF EXISTS set_value_history',
      'DROP TABLE IF EXISTS set_market_ext',
      `CREATE TABLE user_prefs (
        user_id TEXT PRIMARY KEY, handle TEXT, display_name TEXT, currency TEXT DEFAULT 'USD',
        notify_price_drops INTEGER DEFAULT 1, notify_weekly_digest INTEGER DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
        expose_public_value INTEGER NOT NULL DEFAULT 1,
        google_refresh_token TEXT, google_spreadsheet_id TEXT,
        email TEXT, discord_webhook_url TEXT, brickset_user_hash TEXT,
        is_supporter INTEGER DEFAULT 0, supporter_since TEXT, stripe_customer_id TEXT,
        kids_pin_hash TEXT, kids_xp INTEGER NOT NULL DEFAULT 0, kids_level INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE kids_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, badge_slug TEXT NOT NULL,
        awarded_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, badge_slug)
      )`,
      `CREATE TABLE lego_sets (
        set_num TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, year INTEGER, pieces INTEGER,
        minifigs INTEGER DEFAULT 0, retail_price REAL, current_value REAL,
        blended_value REAL, image_url TEXT, retired INTEGER DEFAULT 0, cached_at TEXT,
        valuation_method TEXT DEFAULT 'formula_bulk', valuation_expires_at TEXT
      )`,
      `CREATE VIRTUAL TABLE lego_sets_fts USING fts5(set_num, name, theme)`,
      `CREATE TABLE user_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, set_num TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1, condition TEXT NOT NULL DEFAULT 'new',
        purchase_price REAL, notes TEXT, added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        purchased_at TEXT, deleted_at TEXT, last_modified TEXT DEFAULT CURRENT_TIMESTAMP,
        storage_location TEXT, acquisition_source TEXT, is_complete INTEGER DEFAULT 1,
        missing_pieces INTEGER DEFAULT 0, spike_alerted_at TEXT, custom_image_url TEXT,
        UNIQUE(user_id, set_num)
      )`,
      `CREATE TABLE rate_limits (
        user_id TEXT NOT NULL, endpoint TEXT NOT NULL, window_start TEXT NOT NULL,
        hit_count INTEGER DEFAULT 0, PRIMARY KEY (user_id, endpoint, window_start)
      )`,
      `CREATE TABLE set_market_ext (
        set_num TEXT PRIMARY KEY, pc_loose_value REAL, pc_sales_volume INTEGER,
        pa_retail_value REAL, pa_lowest_offer REAL, pa_in_stock INTEGER,
        pa_best_merchant TEXT, pa_offer_count INTEGER, pa_market TEXT, pa_cached_at TEXT,
        stockx_ask REAL, stockx_cached_at TEXT, ebay_sold_attempted_at TEXT, ebay_used_attempted_at TEXT,
        bl_nodata_at TEXT
      )`,
      `INSERT INTO lego_sets (set_num, name, theme, current_value, retail_price)
       VALUES ('75192', 'Millennium Falcon', 'Star Wars', 849.99, 799.99)`,
    ];
    for (const sql of sqls) await db.prepare(sql).run();
  });

  it('sets a PIN and stores a 64-char hex hash', async () => {
    const res = await app.fetch(new Request('http://localhost/api/me/kids-pin/set', {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ pin: '1234' }),
    }), env);
    expect(res.status).toBe(200);
    const row = await db.prepare('SELECT kids_pin_hash FROM user_prefs WHERE user_id=?')
      .bind(userId).first<{ kids_pin_hash: string }>();
    expect(row?.kids_pin_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies the correct PIN', async () => {
    await app.fetch(new Request('http://localhost/api/me/kids-pin/set', {
      method: 'POST', headers: auth(), body: JSON.stringify({ pin: '4321' }),
    }), env);
    const res = await app.fetch(new Request('http://localhost/api/me/kids-pin/verify', {
      method: 'POST', headers: auth(), body: JSON.stringify({ pin: '4321' }),
    }), env);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).ok).toBe(true);
  });

  it('rejects an incorrect PIN', async () => {
    await app.fetch(new Request('http://localhost/api/me/kids-pin/set', {
      method: 'POST', headers: auth(), body: JSON.stringify({ pin: '4321' }),
    }), env);
    const res = await app.fetch(new Request('http://localhost/api/me/kids-pin/verify', {
      method: 'POST', headers: auth(), body: JSON.stringify({ pin: '0000' }),
    }), env);
    expect(res.status).toBe(200);
    expect((await res.json<any>()).ok).toBe(false);
  });

  it('adds XP when a set is added and a kids PIN is set', async () => {
    await app.fetch(new Request('http://localhost/api/me/kids-pin/set', {
      method: 'POST', headers: auth(), body: JSON.stringify({ pin: '9999' }),
    }), env);
    const res = await app.fetch(new Request('http://localhost/api/collection', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '75192', quantity: 1 }),
    }), env);
    expect(res.status).toBe(201);
    const data = await res.json<any>();
    expect(data.kids?.xp_gained).toBe(10);
    const row = await db.prepare('SELECT kids_xp FROM user_prefs WHERE user_id=?')
      .bind(userId).first<{ kids_xp: number }>();
    expect(row?.kids_xp).toBe(10);
  });

  it('does not add XP when no kids PIN is set', async () => {
    const res = await app.fetch(new Request('http://localhost/api/collection', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '75192', quantity: 1 }),
    }), env);
    expect(res.status).toBe(201);
    const data = await res.json<any>();
    expect(data.kids).toBeUndefined();
  });

  it('awards first_brick badge on the first set added in kids mode', async () => {
    await app.fetch(new Request('http://localhost/api/me/kids-pin/set', {
      method: 'POST', headers: auth(), body: JSON.stringify({ pin: '1111' }),
    }), env);
    const res = await app.fetch(new Request('http://localhost/api/collection', {
      method: 'POST', headers: auth(), body: JSON.stringify({ set_num: '75192', quantity: 1 }),
    }), env);
    const data = await res.json<any>();
    expect(data.kids?.new_badges).toContain('first_brick');
    const badge = await db.prepare('SELECT badge_slug FROM kids_badges WHERE user_id=?')
      .bind(userId).first<{ badge_slug: string }>();
    expect(badge?.badge_slug).toBe('first_brick');
  });

  describe('GET /api/sets/:setnum (detail)', () => {
    // Gate off the on-demand provider refresh + Rebrickable fallback so the
    // handler resolves synchronously from D1 with no network.
    beforeEach(() => {
      delete (env as any).BRICKLINK_CONSUMER_KEY;
      delete (env as any).REBRICKABLE_API_KEY;
      delete (env as any).BRICKSET_API_KEY;
    });

    it('returns the set with a null entry for an unauthenticated request', async () => {
      const res = await app.fetch(new Request('http://localhost/api/sets/75192'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.set.set_num).toBe('75192');
      expect(data.set.name).toBe('Millennium Falcon');
      expect(data.entry).toBeNull();
      expect(Array.isArray(data.set_minifigs)).toBe(true);
    });

    it('includes the owner collection entry when authenticated', async () => {
      await db.prepare(
        `INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price)
         VALUES (?, '75192', 3, 'sealed', 720)`
      ).bind(userId).run();
      const res = await app.fetch(new Request('http://localhost/api/sets/75192', { headers: auth() }), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.entry).toBeTruthy();
      expect(data.entry.quantity).toBe(3);
      expect(data.entry.condition).toBe('sealed');
    });

    it('falls back to the -1 variant when the bare set number is not found', async () => {
      await db.prepare(
        `INSERT INTO lego_sets (set_num, name, theme, year, pieces, current_value, retail_price, retired)
         VALUES ('4002024-1', 'Employee Holiday Gift', 'Seasonal', 2024, 500, 300, 0, 1)`
      ).run();
      const res = await app.fetch(new Request('http://localhost/api/sets/4002024'), env);
      expect(res.status).toBe(200);
      const data = await res.json<any>();
      expect(data.set.set_num).toBe('4002024-1');
    });

    it('404s for an unknown set when the Rebrickable fallback is unavailable', async () => {
      const res = await app.fetch(new Request('http://localhost/api/sets/00000'), env);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/sets/:setnum/listing-draft', () => {
    it('requires authentication', async () => {
      const res = await app.fetch(new Request('http://localhost/api/sets/75192/listing-draft', { method: 'POST' }), env);
      expect(res.status).toBe(401);
    });

    it('404s for an unknown set', async () => {
      const res = await app.fetch(new Request('http://localhost/api/sets/00000/listing-draft', {
        method: 'POST', headers: auth(),
      }), env);
      expect(res.status).toBe(404);
    });

    it('500s cleanly when no AI provider is configured', async () => {
      delete (env as any).OPENAI_API_KEY;
      const res = await app.fetch(new Request('http://localhost/api/sets/75192/listing-draft', {
        method: 'POST', headers: auth(),
      }), env);
      expect(res.status).toBe(500);
      expect(String((await res.json<any>()).error)).toMatch(/listing/i);
    });

    it('generates a draft via a BYOK Gemini key', async () => {
      const draft = { title: 'LEGO 75192 Millennium Falcon UCS', description: 'Huge sealed set.', suggested_price: 800, price_reasoning: 'Market comps.' };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(draft) }] } }],
      }), { status: 200 })) as any;
      try {
        const res = await app.fetch(new Request('http://localhost/api/sets/75192/listing-draft', {
          method: 'POST', headers: { ...auth(), 'X-Gemini-Key': 'byok-test-key' },
        }), env);
        expect(res.status).toBe(200);
        const data = await res.json<any>();
        expect(data.title).toContain('75192');
        expect(data.suggested_price).toBe(800);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('enforces the daily rate limit on the shared server key', async () => {
      // Pre-seed today's counter at the limit so the next server-key call trips 429
      // (before any AI call — a BYOK header would bypass this path entirely).
      const dws = new Date(); dws.setHours(0, 0, 0, 0);
      await db.prepare(
        `INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
         VALUES (?, 'listing-draft', ?, 30)`
      ).bind(userId, dws.toISOString()).run();
      const res = await app.fetch(new Request('http://localhost/api/sets/75192/listing-draft', {
        method: 'POST', headers: auth(),
      }), env);
      expect(res.status).toBe(429);
    });
  });
});

describe('Account deletion (DELETE /api/me)', () => {
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  const userId = 'del-user-1';
  const otherUserId = 'del-user-2';
  let token: string;
  let otherToken: string;
  let db: D1Database;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

  beforeEach(async () => {
    (env as any).SUPABASE_JWT_SECRET = JWT_SECRET;
    (env as any).SUPABASE_URL = 'https://supabase.mock.io';
    (env as any).SUPABASE_ANON_KEY = 'supabase-anon-key-mock';
    (env as any).ADMIN_USER_ID = 'admin-user';
    delete (env as any).SUPABASE_SERVICE_ROLE_KEY;
    delete (env as any).PHOTO_BUCKET;

    token = await createMockJWT(userId, JWT_SECRET);
    otherToken = await createMockJWT(otherUserId, JWT_SECRET);
    db = (env as any).DB;

    // Recreate every user-scoped table with a uniform minimal shape. This unit
    // tests the deletion MECHANISM (purge by user_id, scoped to the caller); the
    // production DDL of each table is validated by the schema + other route
    // tests, so a generic { user_id, r2_key } shape is sufficient and keeps the
    // seed/assert loop table-agnostic. Iterating USER_SCOPED_TABLES (imported
    // from the route) means adding/removing a table is covered automatically.
    for (const t of USER_SCOPED_TABLES) {
      await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
      await db.prepare(`CREATE TABLE ${t} (user_id TEXT NOT NULL, set_num TEXT, r2_key TEXT, aux TEXT)`).run();
      // One row for the caller and one for a different user, in every table.
      await db.prepare(`INSERT INTO ${t} (user_id, r2_key) VALUES (?, ?)`).bind(userId, `${userId}/1234-1.jpg`).run();
      await db.prepare(`INSERT INTO ${t} (user_id, r2_key) VALUES (?, ?)`).bind(otherUserId, `${otherUserId}/9999-1.jpg`).run();
    }
  });

  async function countRows(uid: string): Promise<number> {
    let total = 0;
    for (const t of USER_SCOPED_TABLES) {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id=?`).bind(uid).first<{ n: number }>();
      total += Number(row?.n ?? 0);
    }
    return total;
  }

  it('rejects an unauthenticated request', async () => {
    const res = await app.fetch(new Request('http://localhost/api/me', { method: 'DELETE' }), env);
    expect(res.status).toBe(401);
  });

  it('requires the typed DELETE confirmation', async () => {
    const res = await app.fetch(new Request('http://localhost/api/me', {
      method: 'DELETE', headers: auth(), body: JSON.stringify({ confirm: 'nope' }),
    }), env);
    expect(res.status).toBe(400);
    // Nothing was deleted.
    expect(await countRows(userId)).toBe(USER_SCOPED_TABLES.length);
  });

  it('purges every user-scoped table for the caller only', async () => {
    expect(await countRows(userId)).toBe(USER_SCOPED_TABLES.length);
    expect(await countRows(otherUserId)).toBe(USER_SCOPED_TABLES.length);

    const res = await app.fetch(new Request('http://localhost/api/me', {
      method: 'DELETE', headers: auth(), body: JSON.stringify({ confirm: 'DELETE' }),
    }), env);
    expect(res.status).toBe(200);
    const json = await res.json<{ ok: boolean; auth_deleted: boolean }>();
    expect(json.ok).toBe(true);

    // The caller's rows are gone from all tables; the other user is untouched.
    expect(await countRows(userId)).toBe(0);
    expect(await countRows(otherUserId)).toBe(USER_SCOPED_TABLES.length);
  });

  it('deletes R2 photos and the auth identity when a service-role key is set', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    (env as any).PHOTO_BUCKET = { delete: del };
    (env as any).SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    try {
      const res = await app.fetch(new Request('http://localhost/api/me', {
        method: 'DELETE', headers: auth(), body: JSON.stringify({ confirm: 'DELETE' }),
      }), env);
      expect(res.status).toBe(200);
      const json = await res.json<{ ok: boolean; auth_deleted: boolean }>();
      expect(json.ok).toBe(true);
      expect(json.auth_deleted).toBe(true);
      // Only the caller's photo key was deleted from R2.
      expect(del).toHaveBeenCalledWith(`${userId}/1234-1.jpg`);
      expect(del).toHaveBeenCalledTimes(1);
      // The Supabase Admin API was called to remove the auth user.
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://supabase.mock.io/auth/v1/admin/users/${userId}`,
        expect.objectContaining({ method: 'DELETE' }),
      );
    } finally {
      fetchSpy.mockRestore();
      delete (env as any).PHOTO_BUCKET;
      delete (env as any).SUPABASE_SERVICE_ROLE_KEY;
    }
  });

  it('reports auth_deleted=false when no service-role key is configured', async () => {
    const res = await app.fetch(new Request('http://localhost/api/me', {
      method: 'DELETE', headers: auth(), body: JSON.stringify({ confirm: 'DELETE' }),
    }), env);
    expect(res.status).toBe(200);
    const json = await res.json<{ ok: boolean; auth_deleted: boolean }>();
    expect(json.auth_deleted).toBe(false);
    expect(await countRows(userId)).toBe(0);
  });
});

describe('RevenueCat webhook', () => {
  const AUTH = 'rc-webhook-secret-123';
  const uid = 'rc-user-1';
  let db: D1Database;

  beforeEach(async () => {
    (env as any).REVENUECAT_WEBHOOK_AUTH = AUTH;
    db = (env as any).DB;
    await db.prepare('DROP TABLE IF EXISTS user_prefs').run();
    await db.prepare(`CREATE TABLE user_prefs (
      user_id TEXT PRIMARY KEY, handle TEXT, display_name TEXT, currency TEXT DEFAULT 'USD',
      notify_price_drops INTEGER DEFAULT 1, notify_weekly_digest INTEGER DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
      expose_public_value INTEGER NOT NULL DEFAULT 1, email TEXT, discord_webhook_url TEXT,
      brickset_user_hash TEXT, is_supporter INTEGER DEFAULT 0, supporter_since TEXT,
      stripe_customer_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();
  });

  const post = (evType: string, auth: string | null = AUTH) =>
    app.fetch(new Request('http://localhost/api/revenuecat/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify({ event: { type: evType, app_user_id: uid } }),
    }), env);

  const supporter = async () => (await db.prepare('SELECT is_supporter FROM user_prefs WHERE user_id=?')
    .bind(uid).first<{ is_supporter: number }>())?.is_supporter;

  it('rejects a wrong/missing auth header', async () => {
    expect((await post('INITIAL_PURCHASE', 'wrong')).status).toBe(401);
    expect((await post('INITIAL_PURCHASE', null)).status).toBe(401);
  });

  it('grants supporter on INITIAL_PURCHASE and keeps it on RENEWAL', async () => {
    expect((await post('INITIAL_PURCHASE')).status).toBe(200);
    expect(await supporter()).toBe(1);
    await post('RENEWAL');
    expect(await supporter()).toBe(1);
  });

  it('grants on the lifetime NON_RENEWING_PURCHASE', async () => {
    await post('NON_RENEWING_PURCHASE');
    expect(await supporter()).toBe(1);
  });

  it('revokes on EXPIRATION but not on CANCELLATION', async () => {
    await post('INITIAL_PURCHASE');
    await post('CANCELLATION');
    expect(await supporter()).toBe(1); // still active until it expires
    await post('EXPIRATION');
    expect(await supporter()).toBe(0);
  });

  it('503s when the webhook secret is not configured', async () => {
    delete (env as any).REVENUECAT_WEBHOOK_AUTH;
    expect((await post('INITIAL_PURCHASE')).status).toBe(503);
  });
});
