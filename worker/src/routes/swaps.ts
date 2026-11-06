import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { sendPushToUser } from '../jobs/wishlist-alerts';
import { findContactDetails } from '../lib/contact-details';

// Swap matching (mounted at /api/swaps). Collectors who switch swaps on (and
// have a public handle) are matched when one has a set up for swap that the
// other wishlisted. A swap request carries the sets each way and an optional
// note; the two sides then talk in a private in-app chat on that request, so
// nobody has to post an email or phone number. Contact details are refused
// until a swap is accepted, and need an explicit "send anyway" after that.
// Either side can hide a collector from matches, block them (no matches,
// requests or messages either way) or report them (lands in Admin feedback).
//
// GET    /                         my swap status, sets up for swap, matches, requests, hidden people
// POST   /prefs                    { open }  join or leave swap matching
// POST   /trade                    { set_num, for_trade }  offer a vault set, or stop
// POST   /requests                 { to, give, get, message? }  propose a swap
// POST   /requests/:id/respond     { accept, reply?, confirm_contact? }  answer a request sent to me
// POST   /requests/:id/cancel      withdraw a pending request I sent, or call off an accepted swap
// POST   /requests/:id/done        { done }  mark my side of an accepted swap as done
// DELETE /requests/:id             remove a request from my list (withdraws/declines/cancels it first)
// GET    /requests/:id/messages    chat on a request (marks it read)
// POST   /requests/:id/messages    { body, confirm_contact? }  send a chat message
// POST   /people/:handle/hide      stop showing a collector in my matches
// POST   /people/:handle/block     block a collector both ways; ends open swaps with them
// DELETE /people/:handle           undo hide/block
// POST   /people/:handle/report    { reason, details?, request_id? }  report and block
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const MAX_PENDING_OUT = 10;
export const MAX_MATCHES = 20;
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_MESSAGES_PER_SWAP = 500;
export const MESSAGES_PER_HOUR = 60;
export const REPORTS_PER_DAY = 5;

interface Pair { user_id: string; set_num: string }
interface SwapRow {
  id: number; from_user: string; to_user: string; give_sets: string; get_sets: string; message: string | null; reply: string | null;
  status: string; updated_at: string; from_hidden: number | null; to_hidden: number | null; from_done: number | null; to_done: number | null;
  from_read_id: number | null; to_read_id: number | null; last_message_at: string | null; from_handle: string | null; from_name: string | null; to_handle: string | null; to_name: string | null;
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

function notify(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, userId: string, title: string, body: string, url = '#/swaps', tag = 'swap') {
  const task = sendPushToUser(env, userId, JSON.stringify({ title, body, url, tag })).catch(() => {});
  try { ctx?.waitUntil(task); } catch { /* tests without an execution context */ }
}


/** People I hid or blocked, plus people who blocked me: none of them show up or can reach me. */
async function blockedSets(db: D1Database, userId: string): Promise<{ hidden: Set<string>; blockedEither: Set<string> }> {
  const { results } = await db.prepare(
    "SELECT user_id, other_user, kind FROM swap_blocks WHERE user_id = ? OR (other_user = ? AND kind = 'block')",
  ).bind(userId, userId).all<{ user_id: string; other_user: string; kind: string }>();
  const hidden = new Set<string>();
  const blockedEither = new Set<string>();
  for (const r of results) {
    if (r.user_id === userId) {
      hidden.add(r.other_user);
      if (r.kind === 'block') blockedEither.add(r.other_user);
    } else blockedEither.add(r.user_id);
  }
  return { hidden, blockedEither };
}

async function isBlocked(db: D1Database, a: string, b: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT 1 AS x FROM swap_blocks WHERE kind = 'block' AND ((user_id = ? AND other_user = ?) OR (user_id = ? AND other_user = ?))",
  ).bind(a, b, b, a).first();
  return !!row;
}

/** Completed swaps (both sides marked done) per collector: the reputation shown on cards. */
async function doneCounts(db: D1Database, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(userIds)].slice(0, 90);
  if (!ids.length) return out;
  const marks = ids.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT u AS user_id, COUNT(*) AS n FROM (
       SELECT from_user AS u FROM swap_requests WHERE from_done = 1 AND to_done = 1 AND from_user IN (${marks})
       UNION ALL
       SELECT to_user AS u FROM swap_requests WHERE from_done = 1 AND to_done = 1 AND to_user IN (${marks})
     ) GROUP BY u`,
  ).bind(...ids, ...ids).all<{ user_id: string; n: number }>();
  for (const r of results) out.set(r.user_id, r.n);
  return out;
}

const contactError = (kinds: string[], stage: 'pending' | 'accepted') => ({
  error: stage === 'pending'
    ? 'Keep contact details out until the swap is accepted. Use the chat to agree on the swap first.'
    : 'This looks like contact details. Anyone you share them with can reach you outside BricksVault.',
  code: stage === 'pending' ? 'contact_blocked' : 'contact_confirm',
  kinds,
});

/** A request I am part of, with who the other side is. */
async function myRequest(db: D1Database, id: number, userId: string) {
  const row = await db.prepare('SELECT * FROM swap_requests WHERE id = ? AND (from_user = ? OR to_user = ?)')
    .bind(id, userId, userId).first<SwapRow>();
  if (!row) return null;
  const mine = row.from_user === userId ? 'from' : 'to';
  return { row, mine, other: mine === 'from' ? row.to_user : row.from_user } as const;
}

async function personByHandle(db: D1Database, handle: string) {
  return db.prepare('SELECT user_id, handle, display_name FROM user_prefs WHERE handle = ?')
    .bind(handle).first<{ user_id: string; handle: string; display_name: string | null }>();
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const me = await prefs(c.env.DB, userId);
  const open = !!me?.open_to_swaps;
  const { results: trade } = await c.env.DB.prepare(
    'SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL AND for_trade = 1 ORDER BY set_num',
  ).bind(userId).all<{ set_num: string }>();

  const { hidden, blockedEither } = await blockedSets(c.env.DB, userId);
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
    const keep = (p: Pair) => !hidden.has(p.user_id) && !blockedEither.has(p.user_id);
    ranked = rankMatches(have.results.filter(keep), want.results.filter(keep)).slice(0, MAX_MATCHES);
  }

  const { results: requests } = await c.env.DB.prepare(
    `SELECT r.*, pf.handle AS from_handle, pf.display_name AS from_name, pt.handle AS to_handle, pt.display_name AS to_name
     FROM swap_requests r
     LEFT JOIN user_prefs pf ON pf.user_id = r.from_user
     LEFT JOIN user_prefs pt ON pt.user_id = r.to_user
     WHERE ((r.from_user = ? AND COALESCE(r.from_hidden, 0) = 0) OR (r.to_user = ? AND COALESCE(r.to_hidden, 0) = 0))
       AND (r.status IN ('pending', 'accepted') OR r.updated_at > datetime('now', '-90 days'))
     ORDER BY COALESCE(r.last_message_at, r.updated_at) DESC LIMIT 50`,
  ).bind(userId, userId).all<SwapRow>();
  const unread = new Map<number, number>();
  if (requests.length) {
    const ids = requests.map((r) => r.id);
    const { results } = await c.env.DB.prepare(
      `SELECT m.swap_id, COUNT(*) AS n FROM swap_messages m JOIN swap_requests r ON r.id = m.swap_id
       WHERE m.swap_id IN (${ids.map(() => '?').join(',')}) AND m.from_user != ?
         AND m.id > COALESCE(CASE WHEN r.from_user = ? THEN r.from_read_id ELSE r.to_read_id END, 0)
       GROUP BY m.swap_id`,
    ).bind(...ids, userId, userId).all<{ swap_id: number; n: number }>();
    for (const r of results) unread.set(r.swap_id, r.n);
  }
  const { results: hiddenPeople } = await c.env.DB.prepare(
    `SELECT p.handle, p.display_name, b.kind FROM swap_blocks b JOIN user_prefs p ON p.user_id = b.other_user
     WHERE b.user_id = ? AND p.handle IS NOT NULL ORDER BY b.created_at DESC LIMIT 50`,
  ).bind(userId).all<{ handle: string; display_name: string | null; kind: string }>();

  const userIds = ranked.map((m) => m.user_id);
  const people = new Map<string, { handle: string; display_name: string | null }>();
  if (userIds.length) {
    const { results } = await c.env.DB.prepare(`SELECT user_id, handle, display_name FROM user_prefs WHERE user_id IN (${userIds.map(() => '?').join(',')})`)
      .bind(...userIds).all<{ user_id: string; handle: string; display_name: string | null }>();
    for (const r of results) people.set(r.user_id, r);
  }
  const done = await doneCounts(c.env.DB, [...userIds, ...requests.map((r) => (r.to_user === userId ? r.from_user : r.to_user))]);
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
      swaps_done: done.get(m.user_id) || 0,
    })),
    requests: parsed.map((r) => {
      const incoming = r.to_user === userId;
      const other = incoming ? r.from_user : r.to_user;
      const iDone = !!(incoming ? r.to_done : r.from_done);
      const theyDone = !!(incoming ? r.from_done : r.to_done);
      const completed = r.status === 'accepted' && iDone && theyDone;
      return {
        id: r.id,
        direction: incoming ? 'incoming' : 'outgoing',
        status: completed ? 'completed' : r.status,
        with_handle: incoming ? r.from_handle : r.to_handle,
        with_name: (incoming ? r.from_name || r.from_handle : r.to_name || r.to_handle) || null,
        // Always from my side: what I give and what I get.
        i_give: sets(incoming ? r.get : r.give),
        i_get: sets(incoming ? r.give : r.get),
        message: r.message,
        reply: r.status === 'pending' ? null : r.reply,
        updated_at: r.updated_at,
        unread: unread.get(r.id) || 0,
        can_chat: (r.status === 'pending' || r.status === 'accepted') && !blockedEither.has(other),
        i_marked_done: iDone,
        they_marked_done: theyDone,
        with_swaps_done: done.get(other) || 0,
      };
    }),
    hidden: hiddenPeople.map((p) => ({ handle: p.handle, name: p.display_name || p.handle, kind: p.kind })),
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
  const message = String(body.message || '').trim().slice(0, 500) || null;
  if (!give.length && !get.length) return c.json({ error: 'Pick at least one set' }, 400);
  const kinds = findContactDetails(message);
  if (kinds.length) return c.json(contactError(kinds, 'pending'), 400);

  const me = await prefs(c.env.DB, userId);
  if (!me?.open_to_swaps) return c.json({ error: 'Turn on swaps first' }, 400);
  const target = await c.env.DB.prepare('SELECT user_id FROM user_prefs WHERE handle = ? AND open_to_swaps = 1')
    .bind(String(body.to || '')).first<{ user_id: string }>();
  if (!target || target.user_id === userId || await isBlocked(c.env.DB, userId, target.user_id)) {
    return c.json({ error: 'That collector is not open to swaps' }, 404);
  }

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
  const { accept, reply, confirm_contact } = await c.req.json<{ accept?: boolean; reply?: string; confirm_contact?: boolean }>()
    .catch(() => ({} as { accept?: boolean; reply?: string; confirm_contact?: boolean }));
  const text = String(reply || '').trim().slice(0, 500) || null;
  const kinds = findContactDetails(text);
  if (kinds.length && !accept) return c.json(contactError(kinds, 'pending'), 400);
  if (kinds.length && !confirm_contact) return c.json(contactError(kinds, 'accepted'), 400);
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

/** Ends a live request from my side: withdraw (pending, mine), decline (pending, theirs), call off (accepted). */
async function endRequest(c: { env: Env; executionCtx: unknown }, req: NonNullable<Awaited<ReturnType<typeof myRequest>>>, userId: string): Promise<boolean> {
  const { row, mine, other } = req;
  let status: string | null = null;
  if (row.status === 'pending') status = mine === 'from' ? 'cancelled' : 'declined';
  else if (row.status === 'accepted' && !(row.from_done && row.to_done)) status = 'cancelled';
  if (!status) return false;
  const res = await c.env.DB.prepare("UPDATE swap_requests SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = ?")
    .bind(status, row.id, row.status).run();
  if (!res.meta.changes) return false;
  if (row.status === 'accepted' || mine === 'to') {
    const me = await prefs(c.env.DB, userId);
    const who = me?.display_name || me?.handle || 'A collector';
    notify(c.env, c.executionCtx as never, other, row.status === 'accepted' ? 'Swap called off' : 'Swap declined',
      row.status === 'accepted' ? `${who} called off your swap.` : `${who} declined your swap request.`);
  }
  return true;
}

app.post('/requests/:id/cancel', async (c) => {
  const userId = c.get('userId');
  const req = await myRequest(c.env.DB, Number(c.req.param('id')), userId);
  // Only the sender withdraws a pending request; the receiver declines it instead.
  if (!req || (req.row.status === 'pending' && req.mine !== 'from') || !(await endRequest(c, req, userId))) {
    return c.json({ error: 'Request not found' }, 404);
  }
  return c.json({ ok: true });
});

app.post('/requests/:id/done', async (c) => {
  const userId = c.get('userId');
  const { done } = await c.req.json<{ done?: boolean }>().catch(() => ({} as { done?: boolean }));
  const req = await myRequest(c.env.DB, Number(c.req.param('id')), userId);
  if (!req || req.row.status !== 'accepted') return c.json({ error: 'Only an accepted swap can be marked done' }, 404);
  const col = req.mine === 'from' ? 'from_done' : 'to_done';
  await c.env.DB.prepare(`UPDATE swap_requests SET ${col} = ?, updated_at = datetime('now') WHERE id = ?`).bind(done === false ? 0 : 1, req.row.id).run();
  const theirs = req.mine === 'from' ? req.row.to_done : req.row.from_done;
  if (done !== false) {
    const me = await prefs(c.env.DB, userId);
    const who = me?.display_name || me?.handle || 'A collector';
    notify(c.env, c.executionCtx as never, req.other, theirs ? 'Swap complete' : 'Swap marked done',
      theirs ? `Your swap with ${who} is complete.` : `${who} marked your swap as done. Tap Swap done once you have your sets.`);
  }
  return c.json({ ok: true, completed: done !== false && !!theirs });
});

app.delete('/requests/:id', async (c) => {
  const userId = c.get('userId');
  const req = await myRequest(c.env.DB, Number(c.req.param('id')), userId);
  if (!req) return c.json({ error: 'Request not found' }, 404);
  await endRequest(c, req, userId);
  const mineCol = req.mine === 'from' ? 'from_hidden' : 'to_hidden';
  const theirs = req.mine === 'from' ? req.row.to_hidden : req.row.from_hidden;
  if (theirs) {
    // Both sides removed it: nothing left to show anyone, so drop the chat too.
    // Completed swaps stay (hidden) so reputation counts survive.
    if (req.row.from_done && req.row.to_done) {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM swap_messages WHERE swap_id = ?').bind(req.row.id),
        c.env.DB.prepare(`UPDATE swap_requests SET ${mineCol} = 1, message = NULL, reply = NULL WHERE id = ?`).bind(req.row.id),
      ]);
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM swap_messages WHERE swap_id = ?').bind(req.row.id),
        c.env.DB.prepare('DELETE FROM swap_requests WHERE id = ?').bind(req.row.id),
      ]);
    }
  } else {
    await c.env.DB.prepare(`UPDATE swap_requests SET ${mineCol} = 1 WHERE id = ?`).bind(req.row.id).run();
  }
  return c.json({ ok: true });
});

app.get('/requests/:id/messages', async (c) => {
  const userId = c.get('userId');
  const req = await myRequest(c.env.DB, Number(c.req.param('id')), userId);
  if (!req || (req.mine === 'from' ? req.row.from_hidden : req.row.to_hidden)) return c.json({ error: 'Request not found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT id, from_user, body, created_at FROM swap_messages WHERE swap_id = ? ORDER BY id DESC LIMIT 200`,
  ).bind(req.row.id).all<{ id: number; from_user: string; body: string; created_at: string }>();
  const lastId = results[0]?.id || 0;
  if (lastId) {
    await c.env.DB.prepare(`UPDATE swap_requests SET ${req.mine === 'from' ? 'from_read_id' : 'to_read_id'} = ? WHERE id = ?`).bind(lastId, req.row.id).run();
  }
  const blocked = await isBlocked(c.env.DB, userId, req.other);
  const other = await c.env.DB.prepare('SELECT handle, display_name FROM user_prefs WHERE user_id = ?')
    .bind(req.other).first<{ handle: string | null; display_name: string | null }>();
  return c.json({
    id: req.row.id,
    status: req.row.status === 'accepted' && req.row.from_done && req.row.to_done ? 'completed' : req.row.status,
    with_handle: other?.handle || null,
    with_name: other?.display_name || other?.handle || null,
    can_send: (req.row.status === 'pending' || req.row.status === 'accepted') && !blocked,
    blocked,
    messages: results.reverse().map((m) => ({ id: m.id, mine: m.from_user === userId, body: m.body, created_at: m.created_at })),
  });
});

app.post('/requests/:id/messages', async (c) => {
  const userId = c.get('userId');
  const { body, confirm_contact } = await c.req.json<{ body?: string; confirm_contact?: boolean }>()
    .catch(() => ({} as { body?: string; confirm_contact?: boolean }));
  const text = String(body || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!text) return c.json({ error: 'Write a message first' }, 400);
  const req = await myRequest(c.env.DB, Number(c.req.param('id')), userId);
  if (!req || (req.mine === 'from' ? req.row.from_hidden : req.row.to_hidden)) return c.json({ error: 'Request not found' }, 404);
  if (req.row.status !== 'pending' && req.row.status !== 'accepted') return c.json({ error: 'This swap is closed' }, 409);
  if (await isBlocked(c.env.DB, userId, req.other)) return c.json({ error: 'You can no longer message this collector' }, 403);
  const kinds = findContactDetails(text);
  if (kinds.length && req.row.status === 'pending') return c.json(contactError(kinds, 'pending'), 400);
  if (kinds.length && !confirm_contact) return c.json(contactError(kinds, 'accepted'), 400);

  const hour = new Date();
  hour.setMinutes(0, 0, 0);
  const rl = await c.env.DB.prepare(
    `INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES (?, 'swap_messages', ?, 1)
     ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
     RETURNING hit_count`,
  ).bind(userId, hour.toISOString()).first<{ hit_count: number }>();
  if ((rl?.hit_count || 0) > MESSAGES_PER_HOUR) return c.json({ error: 'You are sending messages too fast. Try again later.' }, 429);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM swap_messages WHERE swap_id = ?').bind(req.row.id).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_MESSAGES_PER_SWAP) return c.json({ error: 'This chat is full. Start a new swap request to keep talking.' }, 429);

  const row = await c.env.DB.prepare('INSERT INTO swap_messages (swap_id, from_user, body) VALUES (?, ?, ?) RETURNING id, created_at')
    .bind(req.row.id, userId, text).first<{ id: number; created_at: string }>();
  await c.env.DB.prepare(
    `UPDATE swap_requests SET last_message_at = datetime('now'), ${req.mine === 'from' ? 'from_read_id' : 'to_read_id'} = ? WHERE id = ?`,
  ).bind(row?.id || 0, req.row.id).run();
  const me = await prefs(c.env.DB, userId);
  notify(c.env, c.executionCtx as never, req.other, `Message from ${me?.display_name || me?.handle || 'a collector'}`,
    text.length > 120 ? `${text.slice(0, 117)}...` : text, `#/swaps?chat=${req.row.id}`, `swap-chat-${req.row.id}`);
  return c.json({ ok: true, message: { id: row?.id, mine: true, body: text, created_at: row?.created_at } }, 201);
});

async function setBlock(db: D1Database, userId: string, otherId: string, kind: 'hide' | 'block') {
  // A block never downgrades to a hide.
  await db.prepare(
    `INSERT INTO swap_blocks (user_id, other_user, kind) VALUES (?, ?, ?)
     ON CONFLICT (user_id, other_user) DO UPDATE SET kind = CASE WHEN swap_blocks.kind = 'block' THEN 'block' ELSE excluded.kind END`,
  ).bind(userId, otherId, kind).run();
  if (kind === 'block') {
    await db.prepare(
      `UPDATE swap_requests SET status = 'cancelled', updated_at = datetime('now')
       WHERE status IN ('pending', 'accepted') AND NOT (from_done = 1 AND to_done = 1)
         AND ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?))`,
    ).bind(userId, otherId, otherId, userId).run();
  }
}

app.post('/people/:handle/:action{hide|block}', async (c) => {
  const userId = c.get('userId');
  const other = await personByHandle(c.env.DB, c.req.param('handle'));
  if (!other || other.user_id === userId) return c.json({ error: 'Collector not found' }, 404);
  await setBlock(c.env.DB, userId, other.user_id, c.req.param('action') as 'hide' | 'block');
  return c.json({ ok: true });
});

app.delete('/people/:handle', async (c) => {
  const userId = c.get('userId');
  const other = await personByHandle(c.env.DB, c.req.param('handle'));
  if (!other) return c.json({ error: 'Collector not found' }, 404);
  await c.env.DB.prepare('DELETE FROM swap_blocks WHERE user_id = ? AND other_user = ?').bind(userId, other.user_id).run();
  return c.json({ ok: true });
});

const REPORT_REASONS = ['scam', 'harassment', 'spam', 'no_show', 'other'] as const;

app.post('/people/:handle/report', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ reason?: string; details?: string; request_id?: number }>()
    .catch(() => ({} as { reason?: string; details?: string; request_id?: number }));
  const reason = REPORT_REASONS.includes(body.reason as never) ? body.reason! : 'other';
  const details = String(body.details || '').trim().slice(0, 1000);
  const other = await personByHandle(c.env.DB, c.req.param('handle'));
  if (!other || other.user_id === userId) return c.json({ error: 'Collector not found' }, 404);
  const today = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM app_feedback WHERE user_id = ? AND screen = 'swap-report' AND created_at >= datetime('now', '-1 day')",
  ).bind(userId).first<{ n: number }>();
  if ((today?.n || 0) >= REPORTS_PER_DAY) return c.json({ error: 'Daily report limit reached' }, 429);

  // Attach the last messages from the reported person on that swap, so the
  // report can be checked without anyone opening the chat database.
  let excerpt = '';
  const req = body.request_id ? await myRequest(c.env.DB, Number(body.request_id), userId) : null;
  if (req && req.other === other.user_id) {
    const { results } = await c.env.DB.prepare(
      'SELECT body, created_at FROM swap_messages WHERE swap_id = ? AND from_user = ? ORDER BY id DESC LIMIT 5',
    ).bind(req.row.id, other.user_id).all<{ body: string; created_at: string }>();
    const notes = [req.mine === 'from' ? req.row.reply : req.row.message].filter(Boolean).map((n) => `note: ${n}`);
    excerpt = [...notes, ...results.reverse().map((m) => `${m.created_at}: ${m.body}`)].join('\n').slice(0, 2000);
  }
  const message = [
    `Swap report: @${other.handle} (${other.user_id}), reason: ${reason}`,
    req ? `Swap request #${req.row.id} (${req.row.status})` : '',
    details ? `Details: ${details}` : '',
    excerpt ? `Their recent messages:\n${excerpt}` : '',
  ].filter(Boolean).join('\n');
  await c.env.DB.prepare(
    "INSERT INTO app_feedback (user_id, email, message, screen, user_agent) VALUES (?, ?, ?, 'swap-report', ?)",
  ).bind(userId, c.get('userEmail') ?? null, message, String(c.req.header('User-Agent') || '').slice(0, 300) || null).run();
  await setBlock(c.env.DB, userId, other.user_id, 'block');
  return c.json({ ok: true });
});

export { app as swapsRoute };
