import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

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
  const db = c.env.DB;

  const [prefs, stats] = await Promise.all([
    db.prepare('SELECT * FROM user_prefs WHERE user_id=?').bind(userId).first<Record<string, unknown>>(),
    db.prepare(`
      SELECT COUNT(*) as set_count,
        COALESCE(SUM(s.current_value * uc.quantity), 0) as total_value,
        COALESCE(SUM(COALESCE(uc.purchase_price,0) * uc.quantity), 0) as total_paid
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id=? AND uc.deleted_at IS NULL
    `).bind(userId).first<{ set_count: number; total_value: number; total_paid: number }>(),
  ]);

  const p = prefs || {};
  const ebayConfigured = !!(c.env.EBAY_APP_ID && !c.env.EBAY_APP_ID.includes('dummy'));
  return c.json({
    display_name: (p.display_name as string) || seedName(userId),
    handle: (p.handle as string | null) ?? null,
    is_public: p.is_public ? true : false,
    currency: (p.currency as string) || 'USD',
    notify_price_drops: p.notify_price_drops !== 0,
    ebay_configured: ebayConfigured,
    is_admin: userId === c.env.ADMIN_USER_ID,
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
    display_name?: string; currency?: string; notify_price_drops?: boolean;
    handle?: string; is_public?: boolean;
  }>();
  const { display_name, currency, notify_price_drops, handle, is_public } = body;
  if (display_name && display_name.length > 40) return c.json({ error: 'display_name max 40 chars' }, 400);

  if (handle !== undefined) {
    if (!/^[a-zA-Z0-9-]{3,30}$/.test(handle)) {
      return c.json({ error: 'handle must be 3-30 alphanumeric characters or hyphens' }, 400);
    }
    const existing = await c.env.DB.prepare(
      'SELECT user_id FROM user_prefs WHERE handle=? AND user_id != ?'
    ).bind(handle, userId).first();
    if (existing) return c.json({ error: 'handle already taken' }, 409);
  }

  await c.env.DB.prepare(`
    INSERT INTO user_prefs (user_id, display_name, currency, notify_price_drops, handle, is_public, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = COALESCE(?, user_prefs.display_name),
      currency = COALESCE(?, user_prefs.currency),
      notify_price_drops = COALESCE(?, user_prefs.notify_price_drops),
      handle = COALESCE(?, user_prefs.handle),
      is_public = COALESCE(?, user_prefs.is_public),
      updated_at = datetime('now')
  `).bind(
    userId,
    display_name ?? null, currency ?? null,
    notify_price_drops != null ? (notify_price_drops ? 1 : 0) : null,
    handle ?? null,
    is_public != null ? (is_public ? 1 : 0) : null,
    display_name ?? null, currency ?? null,
    notify_price_drops != null ? (notify_price_drops ? 1 : 0) : null,
    handle ?? null,
    is_public != null ? (is_public ? 1 : 0) : null,
  ).run();
  return c.json({ ok: true });
});

export { app as meRoute };
