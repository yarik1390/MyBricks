import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { hashPin, verifyPin } from '../lib/kids-xp';
import { holdingValueForRollout } from '../lib/market-sources';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ADJECTIVES = ['Cosmic','Neon','Golden','Stellar','Atomic','Crystal','Lunar','Solar','Turbo','Hyper','Electric','Phantom','Vivid','Arctic','Blazing'];
const NOUNS = ['Builder','Architect','Vault','Collector','Master','Ranger','Knight','Scout','Pilot','Explorer','Curator','Engineer','Maker','Wizard','Legend'];

function fnv32(str: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}

function seedName(userId: string) {
  const h1 = fnv32(userId);
  const h2 = fnv32(userId + '|2');
  return ADJECTIVES[h1 % ADJECTIVES.length] + ' ' + NOUNS[h2 % NOUNS.length];
}

app.use('*', requireMember);

app.get('/', async (c) => {
  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const db = c.env.DB;

  const [prefs, holdings, kidsBadgesRows] = await Promise.all([
    // Explicit projection (not SELECT *): only the columns this response reads.
    // Deliberately excludes google_refresh_token / google_spreadsheet_id (OAuth
    // credentials) and other columns the client never needs.
    db.prepare(
      `SELECT display_name, handle, is_public, expose_public_value, currency, retail_market,
              notify_price_drops, notify_weekly_digest, discord_webhook_url, brickset_user_hash, email, is_supporter,
              kids_pin_hash, kids_xp, kids_level
       FROM user_prefs WHERE user_id=?`
    ).bind(userId).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT uc.set_num, uc.condition, uc.quantity, uc.purchase_price,
             s.current_value, s.blended_value, s.used_value,
             s.ebay_used_value, s.bo_used_value, s.pc_new_value, s.pc_complete_value,
             svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      LEFT JOIN set_valuation_state svn ON svn.set_num=s.set_num AND svn.condition='new_sealed'
      LEFT JOIN set_valuation_state svu ON svu.set_num=s.set_num AND svu.condition='used_complete'
      WHERE uc.user_id=? AND uc.deleted_at IS NULL
    `).bind(userId).all<Record<string, unknown>>(),
    db.prepare('SELECT badge_slug FROM kids_badges WHERE user_id=?')
      .bind(userId).all<{ badge_slug: string }>(),
  ]);
  const rolloutPercent = Number(c.env.PRICING_V3_READ_PERCENT || 0);
  const holdingRows = holdings.results || [];
  const stats = holdingRows.reduce<{ set_count: number; total_value: number; total_paid: number }>((total, row) => {
    const quantity = Number(row.quantity || 1);
    total.total_value += holdingValueForRollout(row, rolloutPercent) * quantity;
    total.total_paid += Number(row.purchase_price || 0) * quantity;
    total.set_count += 1;
    return total;
  }, { set_count: 0, total_value: 0, total_paid: 0 });

  // Persist email from JWT claim on first encounter (no-op if already stored)
  if (userEmail && !prefs?.email) {
    c.executionCtx.waitUntil(
      db.prepare(`INSERT INTO user_prefs (user_id, email, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT (user_id) DO UPDATE SET email = COALESCE(user_prefs.email, excluded.email), updated_at = datetime('now')`)
        .bind(userId, userEmail).run().catch(() => {})
    );
  }

  const p = prefs || {};
  const ebayConfigured = !!(
    c.env.EBAY_APP_ID &&
    c.env.EBAY_CLIENT_SECRET &&
    !c.env.EBAY_APP_ID.includes('dummy') &&
    !c.env.EBAY_CLIENT_SECRET.includes('dummy')
  );
  const bricklinkConfigured = !!(
    c.env.BRICKLINK_CONSUMER_KEY &&
    !c.env.BRICKLINK_CONSUMER_KEY.includes('dummy')
  );
  const brickeconomyConfigured = !!(
    c.env.BRICKECONOMY_API_KEY &&
    !c.env.BRICKECONOMY_API_KEY.includes('dummy')
  );
  return c.json({
    display_name: (p.display_name as string) || seedName(userId),
    handle: (p.handle as string | null) ?? null,
    is_public: p.is_public ? true : false,
    expose_public_value: p.expose_public_value !== 0,
    currency: (p.currency as string) || 'USD',
    retail_market: (p.retail_market as string) || 'FR',
    notify_price_drops: p.notify_price_drops !== 0,
    notify_weekly_digest: p.notify_weekly_digest === 1,
    ebay_configured: ebayConfigured,
    bricklink_configured: bricklinkConfigured,
    brickeconomy_configured: brickeconomyConfigured,
    is_admin: userId === c.env.ADMIN_USER_ID,
    discord_webhook_url: (p.discord_webhook_url as string | null) ?? null,
    brickset_connected: !!(p.brickset_user_hash),
    is_supporter: p.is_supporter === 1,
    has_kids_pin: !!(p.kids_pin_hash),
    kids_xp: Number(p.kids_xp ?? 0),
    kids_level: Number(p.kids_level ?? 1),
    kids_badges: (kidsBadgesRows.results ?? []).map(r => r.badge_slug),
    portfolio_stats: {
      set_count: Number(stats?.set_count ?? 0),
      total_value: Number(stats?.total_value ?? 0),
      total_paid: Number(stats?.total_paid ?? 0),
    },
  });
});

app.patch('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    display_name?: string; currency?: string; retail_market?: string; notify_price_drops?: boolean;
    notify_weekly_digest?: boolean;
    handle?: string; is_public?: boolean; expose_public_value?: boolean;
    discord_webhook_url?: string | null;
  }>();
  const { display_name, currency, retail_market, notify_price_drops, notify_weekly_digest, handle, is_public, expose_public_value, discord_webhook_url } = body;
  if (display_name && display_name.length > 40) return c.json({ error: 'display_name max 40 chars' }, 400);
  // Whitelist currency (mirrors CURRENCY_SYMBOLS in public/js/utils.js) — it
  // was previously stored verbatim, so any string could persist unbounded.
  const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];
  if (currency !== undefined && !CURRENCIES.includes(String(currency))) {
    return c.json({ error: `currency must be one of ${CURRENCIES.join(', ')}` }, 400);
  }
  const RETAIL_MARKETS = ['FR', 'US', 'GB', 'DE', 'CA', 'AU', 'NL'];
  if (retail_market !== undefined && !RETAIL_MARKETS.includes(String(retail_market).toUpperCase())) {
    return c.json({ error: `retail_market must be one of ${RETAIL_MARKETS.join(', ')}` }, 400);
  }

  if (handle !== undefined) {
    if (!/^[a-zA-Z0-9-]{3,30}$/.test(handle)) {
      return c.json({ error: 'handle must be 3-30 alphanumeric characters or hyphens' }, 400);
    }
    const existing = await c.env.DB.prepare(
      'SELECT user_id FROM user_prefs WHERE handle=? AND user_id != ?'
    ).bind(handle, userId).first();
    if (existing) return c.json({ error: 'handle already taken' }, 409);
  }

  // Validate Discord webhook URL if provided
  if (discord_webhook_url && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(discord_webhook_url)) {
    return c.json({ error: 'discord_webhook_url must be a valid Discord webhook URL' }, 400);
  }

  const epv = expose_public_value != null ? (expose_public_value ? 1 : 0) : 1;
  await c.env.DB.prepare(`
    INSERT INTO user_prefs (user_id, display_name, currency, retail_market, notify_price_drops, notify_weekly_digest, handle, is_public, expose_public_value, discord_webhook_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = COALESCE(?, user_prefs.display_name),
      currency = COALESCE(?, user_prefs.currency),
      retail_market = COALESCE(?, user_prefs.retail_market),
      notify_price_drops = COALESCE(?, user_prefs.notify_price_drops),
      notify_weekly_digest = COALESCE(?, user_prefs.notify_weekly_digest),
      handle = COALESCE(?, user_prefs.handle),
      is_public = COALESCE(?, user_prefs.is_public),
      expose_public_value = COALESCE(?, user_prefs.expose_public_value),
      discord_webhook_url = CASE WHEN ? IS NOT NULL THEN ? ELSE user_prefs.discord_webhook_url END,
      updated_at = datetime('now')
  `).bind(
    userId,
    display_name ?? null,
    currency ?? 'USD',
    retail_market?.toUpperCase() ?? 'FR',
    notify_price_drops != null ? (notify_price_drops ? 1 : 0) : 1,
    notify_weekly_digest != null ? (notify_weekly_digest ? 1 : 0) : 0,
    handle ?? null,
    is_public != null ? (is_public ? 1 : 0) : 0,
    epv,
    discord_webhook_url !== undefined ? (discord_webhook_url || null) : null,
    display_name ?? null,
    currency ?? null,
    retail_market?.toUpperCase() ?? null,
    notify_price_drops != null ? (notify_price_drops ? 1 : 0) : null,
    notify_weekly_digest != null ? (notify_weekly_digest ? 1 : 0) : null,
    handle ?? null,
    is_public != null ? (is_public ? 1 : 0) : null,
    expose_public_value != null ? (expose_public_value ? 1 : 0) : null,
    discord_webhook_url !== undefined ? 1 : null,
    discord_webhook_url !== undefined ? (discord_webhook_url || null) : null,
  ).run();
  return c.json({ ok: true });
});

// Every D1 table keyed by the authenticated user. Deleting a user wipes each of
// these WHERE user_id = them. Rows they merely *reviewed* (reviewer_id on
// set_photos/set_reviews/set_contributions) belong to other users and are left
// intact. Catalog tables (lego_sets, minifigs, …) and global tables
// (integration_health, *_keys) are never user-scoped, so they're untouched.
export const USER_SCOPED_TABLES = [
  'user_collection',
  'user_minifigs',
  'user_wishlist',
  'wishlist_alerts',
  'user_missing_parts',
  'user_build_cache',
  'user_showcase',
  'kids_badges',
  'portfolio_snapshots',
  'push_subscriptions',
  'native_push_tokens',
  'oauth_sessions',
  'oauth_states',
  'rate_limits',
  'set_photos',
  'set_reviews',
  'set_contributions',
  'user_prefs',
];

// DELETE /api/me — permanently delete the account and everything we hold about
// the user. Required by both stores (Apple App Store Guideline 5.1.1(v) and
// Google Play's account-deletion policy): a signed-in user must be able to
// erase their account + data from inside the app.
//
// Order: (1) delete their uploaded photos from R2, (2) purge every user-scoped
// D1 table in one atomic batch, (3) if a Supabase service-role key is
// configured, delete the auth identity itself. Steps 1 and 3 are best-effort so
// a transient failure there never leaves the D1 data half-deleted.
app.delete('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  // Require an explicit confirmation token so a stray/forged DELETE can't wipe
  // an account. The client sends { confirm: "DELETE" } after the user types it.
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string });
  if (body?.confirm !== 'DELETE') {
    return c.json({ error: 'confirmation required' }, 400);
  }

  // 1) Remove the user's uploaded set photos from R2 (best-effort).
  if (c.env.PHOTO_BUCKET) {
    try {
      const photos = await db
        .prepare('SELECT r2_key FROM set_photos WHERE user_id=?')
        .bind(userId)
        .all<{ r2_key: string }>();
      await Promise.all(
        (photos.results ?? []).map((p) =>
          p.r2_key ? c.env.PHOTO_BUCKET!.delete(p.r2_key).catch(() => {}) : Promise.resolve(),
        ),
      );
    } catch {
      // Non-fatal: proceed with the D1 purge even if photo cleanup fails.
    }
  }

  // 2) Purge every user-scoped table in a single atomic batch.
  await db.batch(
    USER_SCOPED_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(userId)),
  );

  // 3) Delete the Supabase auth identity when a service-role key is available.
  //    Without it the data is gone but the login stub survives; the client still
  //    signs the user out either way.
  let authDeleted = false;
  const serviceKey = c.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && c.env.SUPABASE_URL) {
    try {
      const resp = await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      authDeleted = resp.ok;
    } catch {
      // Non-fatal: data is already purged; the auth stub can be cleaned up later.
    }
  }

  return c.json({ ok: true, auth_deleted: authDeleted });
});

// POST /api/me/kids-pin/set — set or change the 4-digit kids PIN
app.post('/kids-pin/set', async (c) => {
  const { pin, current_pin } = await c.req.json<{ pin: string; current_pin?: string }>();
  if (!pin || !/^\d{4}$/.test(pin)) {
    return c.json({ error: 'PIN must be exactly 4 digits' }, 400);
  }
  const userId = c.get('userId');
  const row = await c.env.DB.prepare(
    'SELECT kids_pin_hash FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ kids_pin_hash: string | null }>();

  if (row?.kids_pin_hash) {
    if (!(await verifyPin(String(current_pin ?? ''), row.kids_pin_hash))) {
      return c.json({ error: 'Current PIN incorrect' }, 403);
    }
  }

  const hash = await hashPin(pin);
  await c.env.DB.prepare(
    `INSERT INTO user_prefs (user_id, kids_pin_hash, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET kids_pin_hash=excluded.kids_pin_hash, updated_at=excluded.updated_at`
  ).bind(userId, hash).run();
  return c.json({ ok: true });
});

// POST /api/me/kids-pin/verify — check PIN, returns { ok }
app.post('/kids-pin/verify', async (c) => {
  const { pin } = await c.req.json<{ pin: string }>();
  const row = await c.env.DB.prepare(
    'SELECT kids_pin_hash FROM user_prefs WHERE user_id=?'
  ).bind(c.get('userId')).first<{ kids_pin_hash: string | null }>();
  if (!row?.kids_pin_hash) return c.json({ ok: false, error: 'no_pin' }, 400);
  return c.json({ ok: await verifyPin(String(pin ?? ''), row.kids_pin_hash) });
});

// DELETE /api/me/kids-pin — remove PIN (requires current_pin)
app.delete('/kids-pin', async (c) => {
  const { pin } = await c.req.json<{ pin: string }>();
  const userId = c.get('userId');
  const row = await c.env.DB.prepare(
    'SELECT kids_pin_hash FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ kids_pin_hash: string | null }>();
  if (!row?.kids_pin_hash) return c.json({ error: 'no_pin' }, 400);
  if (!(await verifyPin(String(pin ?? ''), row.kids_pin_hash))) {
    return c.json({ error: 'PIN incorrect' }, 403);
  }
  await c.env.DB.prepare(
    "UPDATE user_prefs SET kids_pin_hash=NULL, updated_at=datetime('now') WHERE user_id=?"
  ).bind(userId).run();
  return c.json({ ok: true });
});

// --- Insurance report (Pro) --------------------------------------------------
// A printable valuation document for home/contents insurance: every owned set
// with its purchase data and current market value + confidence + as-of date,
// totals, and the methodology reference. Server-composed self-contained HTML;
// the client saves/prints it to PDF. Pro-gated: this is the product's derived
// valuation work, not the user's own entered data (which always exports free).

const escapeHtmlS = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));

app.get('/insurance-report', async (c) => {
  const userId = c.get('userId');
  const pref = await c.env.DB.prepare(
    'SELECT is_supporter, display_name, handle FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ is_supporter: number; display_name: string | null; handle: string | null }>().catch(() => null);
  if (!pref?.is_supporter) return c.json({ error: 'The insurance report is a Pro feature' }, 403);

  const { results } = await c.env.DB.prepare(`
    SELECT uc.set_num, uc.quantity, uc.condition, uc.purchase_price, uc.purchased_at,
           s.name, s.theme, s.year,
           COALESCE(NULLIF(s.blended_value, 0), s.current_value) AS value,
           s.blended_confidence, s.cached_at
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    ORDER BY value DESC NULLS LAST
  `).bind(userId).all<Record<string, unknown>>();
  if (!results.length) return c.json({ error: 'No sets in your vault yet' }, 400);

  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const money = (v: unknown) => `$${num(v).toFixed(2)}`;
  const totalValue = results.reduce((sum, r) => sum + num(r.value) * Math.max(1, num(r.quantity)), 0);
  const totalPaid = results.reduce((sum, r) => sum + num(r.purchase_price) * Math.max(1, num(r.quantity)), 0);
  const today = new Date().toISOString().slice(0, 10);
  const owner = escapeHtmlS(pref.display_name || pref.handle || 'BricksVault collector');
  const conf = (v: unknown) => ({ high: 'Verified market price', medium: 'Market estimate', low: 'Low-confidence estimate' })[String(v || '')] || 'Estimate';

  const rows = results.map((r) => `
    <tr>
      <td class="mono">${escapeHtmlS(r.set_num)}</td>
      <td>${escapeHtmlS(r.name)}<div class="sub">${escapeHtmlS(r.theme || '')}${r.year ? ` · ${escapeHtmlS(r.year)}` : ''}</div></td>
      <td>${escapeHtmlS(String(r.condition || 'new').replace('_', ' '))}</td>
      <td class="num">${Math.max(1, num(r.quantity))}</td>
      <td class="num">${r.purchase_price != null ? money(r.purchase_price) : '—'}</td>
      <td class="num"><strong>${num(r.value) > 0 ? money(r.value) : '—'}</strong><div class="sub">${conf(r.blended_confidence)}</div></td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>BricksVault insurance report — ${today}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #26231d; margin: 32px; }
  h1 { font-family: Georgia, serif; font-size: 24px; margin: 0 0 4px; }
  .meta { color: #6b6455; font-size: 13px; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #e3ddcf; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b6455; }
  td.num, th.num { text-align: right; }
  .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  .sub { color: #6b6455; font-size: 11px; }
  .totals { margin-top: 16px; font-size: 15px; }
  .totals strong { font-size: 18px; }
  footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #e3ddcf; color: #6b6455; font-size: 11px; line-height: 1.5; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>LEGO collection valuation report</h1>
  <div class="meta">Prepared for ${owner} · Generated ${today} · ${results.length} sets · BricksVault</div>
  <table>
    <thead><tr><th>Set</th><th>Name</th><th>Condition</th><th class="num">Qty</th><th class="num">Paid</th><th class="num">Market value</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    Total purchase cost: ${money(totalPaid)}<br>
    Total current market value: <strong>${money(totalValue)}</strong>
  </div>
  <footer>
    Values are USD market valuations computed by BricksVault from verified sold
    prices across independent marketplaces, with per-set confidence as shown.
    Methodology: https://brickvault-5ub.pages.dev/methodology.html · This report
    reflects market conditions on the generation date and is provided for
    insurance documentation purposes; it is not a certified appraisal.
  </footer>
</body></html>`;
  return c.html(html);
});

// --- Collection backups ("never lose a brick") -------------------------------
// Weekly snapshots are written by jobs/collection-backups.ts to R2 under
// backups/{user_id}/{date}.json. These endpoints are strictly scoped to the
// authenticated user: the object key is always built from the session user id,
// never from a client-supplied path.

const BACKUP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.get('/backups', async (c) => {
  const userId = c.get('userId');
  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Backups not configured' }, 503);
  const listing = await c.env.PHOTO_BUCKET.list({ prefix: `backups/${userId}/` }).catch(() => null);
  const dates = (listing?.objects ?? [])
    .map((o) => o.key.slice(o.key.lastIndexOf('/') + 1).replace(/\.json$/, ''))
    .filter((d) => BACKUP_DATE_RE.test(d))
    .sort()
    .reverse();
  return c.json({ backups: dates });
});

app.get('/backups/:date', async (c) => {
  const userId = c.get('userId');
  const date = c.req.param('date');
  if (!BACKUP_DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);
  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Backups not configured' }, 503);
  const obj = await c.env.PHOTO_BUCKET.get(`backups/${userId}/${date}.json`).catch(() => null);
  if (!obj) return c.json({ error: 'Backup not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="bricksvault-backup-${date}.json"`,
    },
  });
});

app.post('/backups/:date/restore', async (c) => {
  const userId = c.get('userId');
  const date = c.req.param('date');
  if (!BACKUP_DATE_RE.test(date)) return c.json({ error: 'bad date' }, 400);
  if (!c.env.PHOTO_BUCKET) return c.json({ error: 'Backups not configured' }, 503);
  const obj = await c.env.PHOTO_BUCKET.get(`backups/${userId}/${date}.json`).catch(() => null);
  if (!obj) return c.json({ error: 'Backup not found' }, 404);
  let snapshot: { rows?: Array<Record<string, unknown>> };
  try { snapshot = JSON.parse(await obj.text()); } catch { return c.json({ error: 'Backup unreadable' }, 500); }
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows.slice(0, 2000) : [];
  if (!rows.length) return c.json({ error: 'Backup empty' }, 400);

  // Merge, never destroy: every snapshot row is upserted to its snapshot state
  // (including deleted_at as it was, so restore can un-delete). Sets added
  // AFTER the snapshot are left untouched.
  const stmts = rows
    .filter((r) => typeof r.set_num === 'string' && r.set_num)
    .map((r) => c.env.DB.prepare(`
      INSERT INTO user_collection (
        user_id, set_num, quantity, condition, purchase_price, notes,
        purchased_at, deleted_at, storage_location, acquisition_source,
        is_complete, missing_pieces, custom_image_url, sold_price, sold_at,
        last_modified
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (user_id, set_num) DO UPDATE SET
        quantity=excluded.quantity, condition=excluded.condition,
        purchase_price=excluded.purchase_price, notes=excluded.notes,
        purchased_at=excluded.purchased_at, deleted_at=excluded.deleted_at,
        storage_location=excluded.storage_location,
        acquisition_source=excluded.acquisition_source,
        is_complete=excluded.is_complete, missing_pieces=excluded.missing_pieces,
        custom_image_url=excluded.custom_image_url,
        sold_price=excluded.sold_price, sold_at=excluded.sold_at,
        last_modified=datetime('now')
    `).bind(
      userId, r.set_num, r.quantity ?? 1, r.condition ?? 'new',
      r.purchase_price ?? null, r.notes ?? null, r.purchased_at ?? null,
      r.deleted_at ?? null, r.storage_location ?? null,
      r.acquisition_source ?? null, r.is_complete ?? 1, r.missing_pieces ?? 0,
      r.custom_image_url ?? null, r.sold_price ?? null, r.sold_at ?? null,
    ));
  for (let i = 0; i < stmts.length; i += 90) await c.env.DB.batch(stmts.slice(i, i + 90));
  return c.json({ ok: true, restored: stmts.length, date });
});

export { app as meRoute };
