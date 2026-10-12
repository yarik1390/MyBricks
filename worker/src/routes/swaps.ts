import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { sendPushToUser } from '../jobs/wishlist-alerts';

// Swap matching (mounted at /api/swaps). Collectors who switch swaps on (and
// have a public handle) are matched when one has a set up for swap that the
// other wishlisted. A swap request carries the sets each way and a note (how to
// reach the sender); the reply comes back the same way. Nothing else about a
// member is shared.
//
// GET  /                       my swap status, sets up for swap, matches and requests
// POST /prefs                  { open }  join or leave swap matching
// POST /trade                  { set_num, for_trade }  offer a vault set, or stop
// POST /requests               { to, give, get, message }  propose a swap
// POST /requests/:id/respond   { accept, reply }  answer a request sent to me
// POST /requests/:id/cancel    withdraw a request I sent
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const MAX_PENDING_OUT = 10;
export const MAX_MATCHES = 20;

interface Pair { user_id: string; set_num: string }
interface SwapRow {
  id: number; from_user: string; to_user: string; give_sets: string; get_sets: string; message: string | null; reply: string | null;
  status: string; updated_at: string; from_handle: string | null; from_name: string | null; to_handle: string | null; to_name: string | null;
}

/** Group "they have what I want" and "they want what I have" by collector; both ways first. */
export function rankMatches(theyHave: Pair[], theyWant: Pair[]): Array<{ user_id: string; they_have: string[]; they_want: string[] }> {
  const by = new Map<string, { user_id: string; they_have: string[]; they_want: string[] }>();
  const get = (id: string) => by.get(id) || by.set(id, { user_id: id, they_have: [], they_want: [] }).get(id)!;
  for (const p of theyHave) if (!get(p.user_id).they_have.includes(p.set_num)) get(p.user_id).they_have.push(p.set_num);
  for (const p of theyWant) if (!get(p.user_id).they_want.includes(p.set_num)) get(p.user_id).they_want.push(p.set_num);
  return [...by.values()].sort((a, b) => {
    const mutual = Number(b.they_have.length > 0 && b.they_want.length > 0) - Number(a.they_have.length > 0 && a.they_want.length > 0);
    return mutual || (b.they_have.length + b.they_want.length) - (a.they_have.length + a.they_want.length) || a.user_id.localeCompare(b.user_id);
  });
}

const safeJson = (v: string | null): unknown => { try { return JSON.parse(v || '[]'); } catch { return []; } };
const setList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length <= 20).slice(0, 20);

async function setInfo(db: D1Database, nums: string[]): Promise<Map<string, { set_num: string; name: string; image_url: string | null; year: number | null }>> {
  const unique = [...new Set(nums)];
  const out = new Map<string, { set_num: string; name: string; image_url: string | null; year: number | null }>();
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT set_num, name, image_url, year FROM lego_sets WHERE set_num IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk).all<{ set_num: string; name: string; image_url: string | null; year: number | null }>();
    for (const r of results) out.set(r.set_num, r);
  }
  return out;
}

async function prefs(db: D1Database, userId: string) {
  return db.prepare('SELECT handle, display_name, open_to_swaps FROM user_prefs WHERE user_id = ?')
    .bind(userId).first<{ handle: string | null; display_name: string | null; open_to_swaps: number | null }>();
}

function notify(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, userId: string, title: string, body: string) {
  const task = sendPushToUser(env, userId, JSON.stringify({ title, body, url: '#/swaps', tag: 'swap' })).catch(() => {});
  try { ctx?.waitUntil(task); } catch { /* tests without an execution context */ }
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const me = await prefs(c.env.DB, userId);
  const open = !!me?.open_to_swaps;
  const { results: trade } = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL AND for_trade = 1 ORDER BY set_num',
  ).bind(userId).all<{ set_num: string }>();

  let ranked: ReturnType<typeof rankMatches> = [];
  if (open) {
    const [have, want] = await Promise.all([
      c.env.DB.prepare(
        `SELECT uc.user_id, uc.set_num FROM user_collection uc
         JOIN user_prefs p ON p.user_id = uc.user_id AND p.open_to_swaps = 1 AND p.handle IS NOT NULL
         WHERE uc.for_trade = 1 AND uc.deleted_at IS NULL AND uc.user_id != ?
           AND uc.set_num IN (SELECT set_num FROM user_wishlist WHERE user_id = ?)
         LIMIT 500`,
      ).bind(userId, userId).all<Pair>(),
      c.env.DB.prepare(
        `SELECT w.user_id, w.set_num FROM user_wishlist w
         JOIN user_prefs p ON p.user_id = w.user_id AND p.open_to_swaps = 1 AND p.handle IS NOT NULL
         WHERE w.user_id != ?
           AND w.set_num IN (SELECT set_num FROM user_collection WHERE user_id = ? AND for_trade = 1 AND deleted_at IS NULL)
         LIMIT 500`,
      ).bind(userId, userId).all<Pair>(),
    ]);
    ranked = rankMatches(have.results, want.results).slice(0, MAX_MATCHES);
  }

  const { results: requests } = await c.env.DB.prepare(
    `SELECT r.*, pf.handle AS from_handle, pf.display_name AS from_name, pt.handle AS to_handle, pt.display_name AS to_name
     FROM swap_requests r
     LEFT JOIN user_prefs pf ON pf.user_id = r.from_user
     LEFT JOIN user_prefs pt ON pt.user_id = r.to_user
     WHERE (r.from_user = ? OR r.to_user = ?) AND (r.status = 'pending' OR r.updated_at > datetime('now', '-30 days'))
     ORDER BY r.updated_at DESC LIMIT 50`,
  ).bind(userId, userId).all<SwapRow>();

  const userIds = ranked.map((m) => m.user_id);
  const people = new Map<string, { handle: string; display_name: string | null }>();
  if (userIds.length) {
    const { results } = await c.env.DB.prepare(`SELECT user_id, handle, display_name FROM user_prefs WHERE user_id IN (${userIds.map(() => '?').join(',')})`)
      .bind(...userIds).all<{ user_id: string; handle: string; display_name: string | null }>();
    for (const r of results) people.set(r.user_id, r);
  }
  const parsed = requests.map((r) => ({ ...r, give: setList(safeJson(r.give_sets)), get: setList(safeJson(r.get_sets)) }));
  const info = await setInfo(c.env.DB, [
    ...trade.map((t) => t.set_num),
    ...ranked.flatMap((m) => [...m.they_have, ...m.they_want]),
    ...parsed.flatMap((r) => [...r.give, ...r.get]),
  ]);
  const sets = (nums: string[]) => nums.map((n) => info.get(n) || { set_num: n, name: n, image_url: null, year: null });

  return c.json({
    open,
    has_handle: !!me?.handle,
    for_trade: sets(trade.map((t) => t.set_num)),
    matches: ranked.map((m) => ({
      handle: people.get(m.user_id)?.handle,
      name: people.get(m.user_id)?.display_name || people.get(m.user_id)?.handle,
      they_have: sets(m.they_have),
      they_want: sets(m.they_want),
    })),
    requests: parsed.map((r) => {
      const incoming = r.to_user === userId;
      return {
        id: r.id,
        direction: incoming ? 'incoming' : 'outgoing',
        status: r.status,
        with_handle: incoming ? r.from_handle : r.to_handle,
        with_name: (incoming ? r.from_name || r.from_handle : r.to_name || r.to_handle) || null,
        // Always from my side: what I give and what I get.
        i_give: sets(incoming ? r.get : r.give),
        i_get: sets(incoming ? r.give : r.get),
        message: r.message,
        reply: r.status === 'pending' ? null : r.reply,
        updated_at: r.updated_at,
      };
    }),
  });
});

app.post('/prefs', async (c) => {
  const userId = c.get('userId');
  const { open } = await c.req.json<{ open?: boolean }>().catch(() => ({} as { open?: boolean }));
  if (open) {
    const me = await prefs(c.env.DB, userId);
    if (!me?.handle) return c.json({ error: 'Pick a public handle in your profile first, so other collectors can find your offer.', code: 'needs_handle' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO user_prefs (user_id, open_to_swaps, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET open_to_swaps = excluded.open_to_swaps, updated_at = datetime('now')`,
  ).bind(userId, open ? 1 : 0).run();
  return c.json({ ok: true, open: !!open });
});

app.post('/trade', async (c) => {
  const userId = c.get('userId');
  const { set_num, for_trade } = await c.req.json<{ set_num?: string; for_trade?: boolean }>().catch(() => ({} as { set_num?: string; for_trade?: boolean }));
  if (!set_num) return c.json({ error: 'set_num is required' }, 400);
  const res = await c.env.DB.prepare('UPDATE user_collection SET for_trade = ?, last_modified = datetime(\'now\') WHERE user_id = ? AND set_num = ? AND deleted_at IS NULL')
    .bind(for_trade ? 1 : 0, userId, set_num).run();
  if (!res.meta.changes) return c.json({ error: 'That set is not in your vault' }, 404);
  return c.json({ ok: true, set_num, for_trade: !!for_trade });
});

app.post('/requests', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ to?: string; give?: string[]; get?: string[]; message?: string }>()
    .catch(() => ({} as { to?: string; give?: string[]; get?: string[]; message?: string }));
  const give = [...new Set(setList(body.give))];
  const get = [...new Set(setList(body.get))];
  const message = String(body.message || '').trim().slice(0, 500);
  if (!give.length && !get.length) return c.json({ error: 'Pick at least one set' }, 400);
  if (!message) return c.json({ error: 'Add a note with how to reach you' }, 400);

  const me = await prefs(c.env.DB, userId);
  if (!me?.open_to_swaps) return c.json({ error: 'Turn on swaps first' }, 400);
  const target = await c.env.DB.prepare('SELECT user_id FROM user_prefs WHERE handle = ? AND open_to_swaps = 1')
    .bind(String(body.to || '')).first<{ user_id: string }>();
  if (!target || target.user_id === userId) return c.json({ error: 'That collector is not open to swaps' }, 404);

  const owned = async (uid: string, nums: string[]) => {
    if (!nums.length) return true;
    const r = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_collection WHERE user_id = ? AND for_trade = 1 AND deleted_at IS NULL AND set_num IN (${nums.map(() => '?').join(',')})`,
    ).bind(uid, ...nums).first<{ n: number }>();
    return (r?.n || 0) === nums.length;
  };
  if (!(await owned(userId, give))) return c.json({ error: 'Offer only sets you have up for swap' }, 400);
  if (!(await owned(target.user_id, get))) return c.json({ error: 'Ask only for sets they have up for swap' }, 400);

  const pending = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM swap_requests WHERE from_user = ? AND status = 'pending'").bind(userId).first<{ n: number }>();
  if ((pending?.n || 0) >= MAX_PENDING_OUT) return c.json({ error: `You have ${MAX_PENDING_OUT} open requests. Wait for answers or withdraw one.` }, 429);
  const dup = await c.env.DB.prepare("SELECT id FROM swap_requests WHERE from_user = ? AND to_user = ? AND status = 'pending'").bind(userId, target.user_id).first();
  if (dup) return c.json({ error: 'You already have an open request with this collector' }, 409);

  const row = await c.env.DB.prepare('INSERT INTO swap_requests (from_user, to_user, give_sets, get_sets, message) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(userId, target.user_id, JSON.stringify(give), JSON.stringify(get), message).first<{ id: number }>();
  notify(c.env, c.executionCtx as never, target.user_id, 'New swap request', `${me.display_name || me.handle} wants to swap sets with you.`);
  return c.json({ ok: true, id: row?.id }, 201);
});

app.post('/requests/:id/respond', async (c) => {
  const userId = c.get('userId');
  const { accept, reply } = await c.req.json<{ accept?: boolean; reply?: string }>().catch(() => ({} as { accept?: boolean; reply?: string }));
  const text = String(reply || '').trim().slice(0, 500) || null;
  if (accept && !text) return c.json({ error: 'Add a note with how to reach you' }, 400);
  const row = await c.env.DB.prepare(
    `UPDATE swap_requests SET status = ?, reply = ?, updated_at = datetime('now')
     WHERE id = ? AND to_user = ? AND status = 'pending' RETURNING from_user`,
  ).bind(accept ? 'accepted' : 'declined', text, Number(c.req.param('id')), userId).first<{ from_user: string }>();
  if (!row) return c.json({ error: 'Request not found or already answered' }, 404);
  const me = await prefs(c.env.DB, userId);
  notify(c.env, c.executionCtx as never, row.from_user, accept ? 'Swap accepted' : 'Swap declined',
    `${me?.display_name || me?.handle || 'A collector'} ${accept ? 'accepted' : 'declined'} your swap request.`);
  return c.json({ ok: true });
});

app.post('/requests/:id/cancel', async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE swap_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND from_user = ? AND status = 'pending'`,
  ).bind(Number(c.req.param('id')), c.get('userId')).run();
  if (!res.meta.changes) return c.json({ error: 'Request not found' }, 404);
  return c.json({ ok: true });
});

export { app as swapsRoute };
