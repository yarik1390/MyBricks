import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { preserveLegacySale } from '../lib/realized-sales';
import { syncCopiesToQuantity } from '../lib/holding-copies';

// Rebrickable collection sync (mounted at /api/rebrickable).
//
// POST   /login    exchange a Rebrickable username + password for a user token
//                  (server-side; only the token is stored, never the password)
// DELETE /connect  forget the token
// POST   /import   bring sets from the user's Rebrickable set lists into the
//                  vault (new sets only; existing holdings are left as they are)
// POST   /export   add vault sets missing on Rebrickable to their default set
//                  list, a batch per call (Rebrickable allows ~1 request/second)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

const API = 'https://rebrickable.com/api/v3';
export const EXPORT_BATCH = 40;

const keyHeader = (env: Env) => ({ Authorization: `key ${env.REBRICKABLE_API_KEY}`, Accept: 'application/json' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function userToken(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT rebrickable_user_token FROM user_prefs WHERE user_id = ?')
    .bind(userId).first<{ rebrickable_user_token: string | null }>().catch(() => null);
  return row?.rebrickable_user_token || null;
}

/** Every set in every set list, quantities summed per set number. */
export async function fetchRebrickableSets(env: Env, token: string): Promise<Map<string, number> | { error: string; status: number }> {
  const out = new Map<string, number>();
  let url: string | null = `${API}/users/${encodeURIComponent(token)}/sets/?page_size=1000`;
  for (let page = 0; url && page < 20; page++) {
    const resp: Response = await fetch(url, { headers: keyHeader(env) });
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) return { error: 'Rebrickable no longer accepts this connection. Connect again.', status: 401 };
    if (!resp.ok) return { error: `Rebrickable error ${resp.status}`, status: 502 };
    const data = await resp.json() as { next?: string | null; results?: Array<{ quantity?: number; set?: { set_num?: string } }> };
    for (const r of data.results || []) {
      const num = r.set?.set_num;
      if (!num) continue;
      out.set(num, (out.get(num) || 0) + Math.max(1, Number(r.quantity) || 1));
    }
    url = data.next && data.next.startsWith(`${API}/`) ? data.next : null;
  }
  return out;
}

app.post('/login', async (c) => {
  if (!c.env.REBRICKABLE_API_KEY) return c.json({ error: 'Rebrickable is not configured' }, 503);
  const { username, password } = await c.req.json<{ username?: string; password?: string }>().catch(() => ({} as { username?: string; password?: string }));
  if (!username || !password) return c.json({ error: 'Username and password are required' }, 400);
  try {
    const resp = await fetch(`${API}/users/_token/`, {
      method: 'POST',
      headers: { ...keyHeader(c.env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }).toString(),
    });
    const data = await resp.json().catch(() => ({})) as { user_token?: string; detail?: string };
    if (!resp.ok || !data.user_token) {
      return c.json({ error: resp.status === 400 || resp.status === 401 ? 'Login failed. Check your username and password.' : `Rebrickable error ${resp.status}` },
        resp.status === 400 || resp.status === 401 ? 401 : 502);
    }
    await c.env.DB.prepare(
      `INSERT INTO user_prefs (user_id, rebrickable_user_token, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET rebrickable_user_token = excluded.rebrickable_user_token, updated_at = datetime('now')`,
    ).bind(c.get('userId'), data.user_token).run();
    return c.json({ ok: true });
  } catch (e) {
    console.warn('[rebrickable/login] failed:', (e as Error).message);
    return c.json({ error: 'Rebrickable login failed. Try again in a moment.' }, 502);
  }
});

app.delete('/connect', async (c) => {
  await c.env.DB.prepare(`UPDATE user_prefs SET rebrickable_user_token = NULL, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(c.get('userId')).run();
  return c.json({ ok: true });
});

app.post('/import', async (c) => {
  const userId = c.get('userId');
  if (!c.env.REBRICKABLE_API_KEY) return c.json({ error: 'Rebrickable is not configured' }, 503);
  const token = await userToken(c.env, userId);
  if (!token) return c.json({ error: 'Rebrickable account not connected' }, 400);
  const sets = await fetchRebrickableSets(c.env, token);
  if (!(sets instanceof Map)) return c.json({ error: sets.error }, sets.status as 401 | 502);

  const nums = [...sets.keys()];
  const known = new Set<string>();
  for (let i = 0; i < nums.length; i += 100) {
    const chunk = nums.slice(i, i + 100);
    const { results } = await c.env.DB.prepare(`SELECT set_num FROM lego_sets WHERE set_num IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk).all<{ set_num: string }>();
    for (const r of results) known.add(r.set_num);
  }
  const { results: mine } = await c.env.DB.prepare('SELECT set_num, deleted_at FROM user_collection WHERE user_id = ?')
    .bind(userId).all<{ set_num: string; deleted_at: string | null }>();
  const active = new Set(mine.filter((r) => !r.deleted_at).map((r) => r.set_num));
  const removed = new Set(mine.filter((r) => r.deleted_at).map((r) => r.set_num));

  let unknown = 0;
  let already = 0;
  const added: string[] = [];
  for (const num of nums) {
    if (!known.has(num)) { unknown++; continue; }
    if (active.has(num)) { already++; continue; }
    if (removed.has(num)) await preserveLegacySale(c.env.DB, userId, num).catch(() => {});
    await c.env.DB.prepare(
      `INSERT INTO user_collection (user_id, set_num, quantity, acquisition_source, last_modified, added_at)
       VALUES (?, ?, ?, 'rebrickable', datetime('now'), datetime('now'))
       ON CONFLICT (user_id, set_num) DO UPDATE SET deleted_at = NULL, quantity = excluded.quantity,
         acquisition_source = 'rebrickable', sold_price = NULL, sold_at = NULL, sold_fees = NULL, last_modified = datetime('now')
       WHERE user_collection.deleted_at IS NOT NULL`,
    ).bind(userId, num, sets.get(num) || 1).run();
    await syncCopiesToQuantity(c.env.DB, userId, num).catch(() => {});
    added.push(num);
  }
  return c.json({ ok: true, added: added.length, already, unknown, total: nums.length, added_set_nums: added });
});

app.post('/export', async (c) => {
  const userId = c.get('userId');
  if (!c.env.REBRICKABLE_API_KEY) return c.json({ error: 'Rebrickable is not configured' }, 503);
  const token = await userToken(c.env, userId);
  if (!token) return c.json({ error: 'Rebrickable account not connected' }, 400);
  const theirs = await fetchRebrickableSets(c.env, token);
  if (!(theirs instanceof Map)) return c.json({ error: theirs.error }, theirs.status as 401 | 502);

  const { results } = await c.env.DB.prepare(
    'SELECT set_num, COALESCE(quantity, 1) AS quantity FROM user_collection WHERE user_id = ? AND deleted_at IS NULL ORDER BY set_num',
  ).bind(userId).all<{ set_num: string; quantity: number }>();
  const missing = results.filter((r) => !theirs.has(r.set_num));
  let sent = 0;
  let failed = 0;
  let limited = false;
  for (const r of missing.slice(0, EXPORT_BATCH)) {
    if (sent + failed > 0) await sleep(1100);
    const resp = await fetch(`${API}/users/${encodeURIComponent(token)}/sets/`, {
      method: 'POST',
      headers: { ...keyHeader(c.env), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ set_num: r.set_num, quantity: String(Math.max(1, r.quantity)) }).toString(),
    }).catch(() => null);
    if (resp?.status === 429) { limited = true; break; }
    if (resp?.ok) sent++; else failed++;
  }
  return c.json({ ok: true, sent, failed, remaining: Math.max(0, missing.length - sent - failed), limited, total_missing: missing.length });
});

export { app as rebrickableSyncRoute };
