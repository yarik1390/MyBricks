import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { holdingValueForRollout, type HoldingValuationRow } from '../lib/market-sources';

// Family vault (mounted at /api/family): a household whose members see one
// combined vault, with who owns what. Joining takes the household's invite
// code; a member belongs to one household at a time.
//
// GET    /                 my household, its members and the combined vault
// POST   /                 { name }  create a household (I become its owner)
// PATCH  /                 { name }  rename (owner)
// POST   /join             { code }  join with an invite code
// POST   /leave            leave; an owner hands the household to the longest
//                          standing member, or it closes when nobody is left
// POST   /code             new invite code (owner); the old one stops working
// DELETE /members/:id      remove a member (owner)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const MAX_MEMBERS = 8;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
const normalizeCode = (code: unknown) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

interface Membership { household_id: number; role: 'owner' | 'member'; name: string; invite_code: string; owner_id: string }

async function membership(db: D1Database, userId: string): Promise<Membership | null> {
  return db.prepare(
    `SELECT m.household_id, m.role, h.name, h.invite_code, h.owner_id
     FROM household_members m JOIN households h ON h.id = m.household_id WHERE m.user_id = ?`,
  ).bind(userId).first<Membership>();
}

/** Take a user out of their household. An owner hands it to the longest
 * standing member, or it closes when nobody is left. Also used by account
 * deletion, so a deleted user never lingers as a member or owner. */
export async function leaveHousehold(db: D1Database, userId: string): Promise<void> {
  const mine = await membership(db, userId);
  if (!mine) return;
  await db.prepare('DELETE FROM household_members WHERE user_id = ?').bind(userId).run();
  if (mine.role !== 'owner') return;
  const next = await db.prepare('SELECT user_id FROM household_members WHERE household_id = ? ORDER BY joined_at ASC, rowid ASC LIMIT 1')
    .bind(mine.household_id).first<{ user_id: string }>();
  if (next) {
    await db.batch([
      db.prepare("UPDATE household_members SET role = 'owner' WHERE user_id = ?").bind(next.user_id),
      db.prepare('UPDATE households SET owner_id = ? WHERE id = ?').bind(next.user_id, mine.household_id),
    ]);
  } else {
    await db.prepare('DELETE FROM households WHERE id = ?').bind(mine.household_id).run();
  }
}

async function familyView(env: Env, userId: string) {
  const mine = await membership(env.DB, userId);
  if (!mine) return { household: null };
  const { results: members } = await env.DB.prepare(
    `SELECT m.rowid AS member_id, m.user_id, m.role, m.joined_at, p.display_name, p.handle
     FROM household_members m LEFT JOIN user_prefs p ON p.user_id = m.user_id
     WHERE m.household_id = ? ORDER BY m.role = 'owner' DESC, m.joined_at ASC`,
  ).bind(mine.household_id).all<{ member_id: number; user_id: string; role: string; joined_at: string; display_name: string | null; handle: string | null }>();
  const names = new Map(members.map((m, i) => [m.user_id, m.user_id === userId ? 'You' : (m.display_name || m.handle || `Member ${i + 1}`)]));
  const ids = members.map((m) => m.user_id);
  const { results: holdings } = await env.DB.prepare(
    `SELECT uc.user_id, uc.set_num, COALESCE(uc.quantity, 1) AS quantity, uc.condition,
       s.name, s.theme, s.year, s.image_url, s.current_value, s.blended_value, s.used_value, s.ebay_used_value,
       s.pc_new_value, s.pc_complete_value, svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair, s.bl_new_value, s.bl_new_qty
     FROM user_collection uc
     JOIN lego_sets s ON s.set_num = uc.set_num
     LEFT JOIN set_valuation_state svn ON svn.set_num = s.set_num AND svn.condition = 'new_sealed'
     LEFT JOIN set_valuation_state svu ON svu.set_num = s.set_num AND svu.condition = 'used_complete'
     WHERE uc.user_id IN (${ids.map(() => '?').join(',')}) AND uc.deleted_at IS NULL`,
  ).bind(...ids).all<Record<string, unknown>>();

  const percent = Number(env.PRICING_V3_READ_PERCENT || 0);
  const perMember = new Map<string, { sets: number; value: number }>();
  const bySet = new Map<string, { set_num: string; name: unknown; theme: unknown; year: unknown; image_url: unknown; quantity: number; value: number; owners: Array<{ name: string; quantity: number }> }>();
  for (const h of holdings) {
    const qty = Math.max(1, Number(h.quantity) || 1);
    const value = holdingValueForRollout(h as HoldingValuationRow, percent) * qty;
    const uid = String(h.user_id);
    const pm = perMember.get(uid) || { sets: 0, value: 0 };
    pm.sets += qty;
    pm.value += value;
    perMember.set(uid, pm);
    const key = String(h.set_num);
    const row = bySet.get(key) || { set_num: key, name: h.name, theme: h.theme, year: h.year, image_url: h.image_url, quantity: 0, value: 0, owners: [] };
    row.quantity += qty;
    row.value += value;
    row.owners.push({ name: names.get(uid) || 'Member', quantity: qty });
    bySet.set(key, row);
  }
  const order = new Map([...names.values()].map((n, i) => [n, i]));
  const sets = [...bySet.values()]
    .map((s) => ({ ...s, owners: s.owners.sort((a, b) => (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99)), value: Math.round(s.value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
  return {
    household: {
      name: mine.name,
      role: mine.role,
      invite_code: mine.invite_code,
      max_members: MAX_MEMBERS,
    },
    members: members.map((m) => ({
      member_id: m.member_id,
      name: names.get(m.user_id),
      role: m.role,
      is_me: m.user_id === userId,
      sets: perMember.get(m.user_id)?.sets || 0,
      value: Math.round((perMember.get(m.user_id)?.value || 0) * 100) / 100,
    })),
    vault: {
      sets,
      total_sets: sets.reduce((n, s) => n + s.quantity, 0),
      total_value: Math.round(sets.reduce((n, s) => n + s.value, 0) * 100) / 100,
      shared: sets.filter((s) => s.owners.length > 1).length,
    },
  };
}

app.get('/', async (c) => c.json(await familyView(c.env, c.get('userId'))));

app.post('/', async (c) => {
  const userId = c.get('userId');
  if (await membership(c.env.DB, userId)) return c.json({ error: 'You are already in a family vault. Leave it first.' }, 409);
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const clean = String(name || '').trim().slice(0, 60) || 'Our family';
  const row = await c.env.DB.prepare('INSERT INTO households (owner_id, name, invite_code) VALUES (?, ?, ?) RETURNING id')
    .bind(userId, clean, newInviteCode()).first<{ id: number }>();
  await c.env.DB.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'owner')").bind(row!.id, userId).run();
  return c.json(await familyView(c.env, userId), 201);
});

app.patch('/', async (c) => {
  const userId = c.get('userId');
  const mine = await membership(c.env.DB, userId);
  if (!mine || mine.role !== 'owner') return c.json({ error: 'Only the owner can rename the family vault' }, 403);
  const { name } = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return c.json({ error: 'Name is required' }, 400);
  await c.env.DB.prepare('UPDATE households SET name = ? WHERE id = ?').bind(clean, mine.household_id).run();
  return c.json(await familyView(c.env, userId));
});

app.post('/join', async (c) => {
  const userId = c.get('userId');
  if (await membership(c.env.DB, userId)) return c.json({ error: 'You are already in a family vault. Leave it first.' }, 409);
  const { code } = await c.req.json<{ code?: string }>().catch(() => ({} as { code?: string }));
  const clean = normalizeCode(code);
  if (clean.length < 6) return c.json({ error: 'Enter the invite code' }, 400);
  const h = await c.env.DB.prepare('SELECT id FROM households WHERE invite_code = ?').bind(clean).first<{ id: number }>();
  if (!h) return c.json({ error: 'That invite code does not match a family vault' }, 404);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM household_members WHERE household_id = ?').bind(h.id).first<{ n: number }>();
  if ((n?.n || 0) >= MAX_MEMBERS) return c.json({ error: `A family vault has room for ${MAX_MEMBERS} members` }, 409);
  await c.env.DB.prepare("INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, 'member')").bind(h.id, userId).run();
  return c.json(await familyView(c.env, userId));
});

app.post('/leave', async (c) => {
  await leaveHousehold(c.env.DB, c.get('userId'));
  return c.json({ household: null });
});

app.post('/code', async (c) => {
  const userId = c.get('userId');
  const mine = await membership(c.env.DB, userId);
  if (!mine || mine.role !== 'owner') return c.json({ error: 'Only the owner can change the invite code' }, 403);
  await c.env.DB.prepare('UPDATE households SET invite_code = ? WHERE id = ?').bind(newInviteCode(), mine.household_id).run();
  return c.json(await familyView(c.env, userId));
});

app.delete('/members/:id', async (c) => {
  const userId = c.get('userId');
  const mine = await membership(c.env.DB, userId);
  if (!mine || mine.role !== 'owner') return c.json({ error: 'Only the owner can remove members' }, 403);
  const res = await c.env.DB.prepare("DELETE FROM household_members WHERE rowid = ? AND household_id = ? AND role != 'owner'")
    .bind(Number(c.req.param('id')), mine.household_id).run();
  if (!res.meta.changes) return c.json({ error: 'Member not found' }, 404);
  return c.json(await familyView(c.env, userId));
});

export { app as familyRoute };
