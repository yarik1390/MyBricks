import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { awardKidsXp, levelForXp, XP_BUILT, XP_GAME_TRY, XP_GAME_WIN } from '../lib/kids-xp';

// Kids Mode play layer (mounted at /api/kids). Price-free by construction:
// nothing here reads or returns a value, price or valuation.
//
// GET  /api/kids/state   XP, level, stored badges, per-set marks, recent game plays
// POST /api/kids/mark    { set_num, built?, favorite? }  first "built" gives +5 XP
// POST /api/kids/game    { day, kind, set_a, set_b, pick } once per day, +5 right / +2 try
// POST /api/kids/badges  { slugs: [] } store badges the app computed as earned
//
// Badges are computed in the app (public/js/lib/kids-play.js) from the vault,
// so this only stores slugs; a kid could only "cheat" a badge on their own
// account, which is harmless.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const GAME_KINDS = ['pieces', 'older', 'minifigs'] as const;
type GameKind = typeof GAME_KINDS[number];
const SLUG_RE = /^[a-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SET_RE = /^[A-Za-z0-9._-]{1,32}$/;

// The kid's local day may be a day ahead/behind UTC.
export function dayIsCurrent(day: string, now = Date.now()): boolean {
  if (!DAY_RE.test(day)) return false;
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const todayUtc = Math.floor(now / 86400000) * 86400000;
  return Math.abs(t - todayUtc) <= 86400000;
}

type SetFacts = { set_num: string; pieces: number | null; year: number | null; minifigs: number | null };

export function gameValue(kind: GameKind, s: SetFacts | null | undefined): number | null {
  if (!s) return null;
  if (kind === 'pieces') { const n = Number(s.pieces); return n > 0 ? n : null; }
  if (kind === 'older') { const y = Number(s.year); return y > 1940 ? y : null; }
  if (s.minifigs == null) return null;
  const n = Number(s.minifigs);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function gameAnswer(kind: GameKind, a: SetFacts, b: SetFacts): string | null {
  const va = gameValue(kind, a), vb = gameValue(kind, b);
  if (va == null || vb == null || va === vb) return null;
  if (kind === 'older') return va < vb ? a.set_num : b.set_num;
  return va > vb ? a.set_num : b.set_num;
}

async function ownedSets(db: D1Database, userId: string, nums: string[]) {
  const rows = await db.prepare(
    `SELECT DISTINCT s.set_num, s.pieces, s.year, s.minifigs
       FROM user_collection uc JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL AND uc.set_num IN (${nums.map(() => '?').join(',')})`
  ).bind(userId, ...nums).all<SetFacts>();
  return rows.results ?? [];
}

app.get('/state', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const [prefs, badges, marks, plays] = await Promise.all([
    db.prepare('SELECT kids_xp, kids_level FROM user_prefs WHERE user_id=?').bind(userId)
      .first<{ kids_xp: number | null; kids_level: number | null }>(),
    db.prepare('SELECT badge_slug FROM kids_badges WHERE user_id=?').bind(userId).all<{ badge_slug: string }>(),
    db.prepare('SELECT set_num, built, favorite FROM kids_set_marks WHERE user_id=?').bind(userId)
      .all<{ set_num: string; built: number; favorite: number }>(),
    db.prepare(
      `SELECT day, kind, set_a, set_b, pick, correct FROM kids_game_plays
        WHERE user_id=? ORDER BY day DESC LIMIT 400`
    ).bind(userId).all<{ day: string; kind: string; set_a: string; set_b: string; pick: string; correct: number }>(),
  ]);
  const xp = Number(prefs?.kids_xp ?? 0);
  return c.json({
    xp,
    level: Number(prefs?.kids_level ?? 0) || levelForXp(xp),
    badges: (badges.results ?? []).map(r => r.badge_slug),
    marks: (marks.results ?? []).map(m => ({ set_num: m.set_num, built: !!m.built, favorite: !!m.favorite })),
    plays: (plays.results ?? []).map(p => ({ ...p, correct: !!p.correct })),
  });
});

app.post('/mark', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const setNum = typeof body.set_num === 'string' ? body.set_num.trim() : '';
  if (!SET_RE.test(setNum)) return c.json({ error: 'set_num required' }, 400);
  const hasBuilt = typeof body.built === 'boolean';
  const hasFav = typeof body.favorite === 'boolean';
  if (!hasBuilt && !hasFav) return c.json({ error: 'built or favorite required' }, 400);
  const owned = await ownedSets(db, userId, [setNum]);
  if (!owned.length) return c.json({ error: 'not_owned' }, 404);
  const canonical = owned[0].set_num;

  const prev = await db.prepare('SELECT built, favorite, built_xp FROM kids_set_marks WHERE user_id=? AND set_num=?')
    .bind(userId, canonical).first<{ built: number; favorite: number; built_xp: number }>();
  const built = hasBuilt ? (body.built as boolean) : !!prev?.built;
  const favorite = hasFav ? (body.favorite as boolean) : !!prev?.favorite;
  // XP once per set, so tapping built on and off can't farm points.
  const giveXp = built && !prev?.built_xp;
  await db.prepare(
    `INSERT INTO kids_set_marks (user_id, set_num, built, favorite, built_xp, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, set_num) DO UPDATE SET built=excluded.built, favorite=excluded.favorite,
       built_xp=MAX(kids_set_marks.built_xp, excluded.built_xp), updated_at=excluded.updated_at`
  ).bind(userId, canonical, built ? 1 : 0, favorite ? 1 : 0, giveXp ? 1 : 0).run();
  const award = giveXp ? await awardKidsXp(db, userId, XP_BUILT) : null;
  return c.json({ ok: true, set_num: canonical, built, favorite, ...(award ?? { xp_gained: 0, new_level: null }) });
});

app.post('/game', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const day = String(body.day ?? '');
  const kind = String(body.kind ?? '') as GameKind;
  const a = String(body.set_a ?? ''), b = String(body.set_b ?? ''), pick = String(body.pick ?? '');
  if (!dayIsCurrent(day)) return c.json({ error: 'bad_day' }, 400);
  if (!GAME_KINDS.includes(kind)) return c.json({ error: 'bad_kind' }, 400);
  if (!SET_RE.test(a) || !SET_RE.test(b) || a.toLowerCase() === b.toLowerCase()) return c.json({ error: 'bad_sets' }, 400);
  if (pick.toLowerCase() !== a.toLowerCase() && pick.toLowerCase() !== b.toLowerCase()) return c.json({ error: 'bad_pick' }, 400);

  const owned = await ownedSets(db, userId, [a, b]);
  const find = (n: string) => owned.find(s => s.set_num.toLowerCase() === n.toLowerCase());
  const sa = find(a), sb = find(b);
  if (!sa || !sb) return c.json({ error: 'not_owned' }, 404);
  const answer = gameAnswer(kind, sa, sb);
  if (!answer) return c.json({ error: 'no_answer' }, 400);
  const correct = answer.toLowerCase() === pick.toLowerCase();

  const ins = await db.prepare(
    `INSERT OR IGNORE INTO kids_game_plays (user_id, day, kind, set_a, set_b, pick, correct)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(userId, day, kind, sa.set_num, sb.set_num, pick.toLowerCase() === a.toLowerCase() ? sa.set_num : sb.set_num, correct ? 1 : 0).run();
  if (!ins.meta?.changes) return c.json({ error: 'already_played' }, 409);
  const award = await awardKidsXp(db, userId, correct ? XP_GAME_WIN : XP_GAME_TRY);
  return c.json({
    correct, answer,
    values: { [sa.set_num]: gameValue(kind, sa), [sb.set_num]: gameValue(kind, sb) },
    ...award,
  });
});

app.post('/badges', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const slugs = Array.isArray(body.slugs)
    ? [...new Set(body.slugs.filter((s): s is string => typeof s === 'string' && SLUG_RE.test(s)))].slice(0, 40)
    : [];
  if (!slugs.length) return c.json({ ok: true, saved: 0 });
  await c.env.DB.batch(slugs.map(slug =>
    c.env.DB.prepare('INSERT OR IGNORE INTO kids_badges (user_id, badge_slug) VALUES (?, ?)').bind(userId, slug)
  ));
  return c.json({ ok: true, saved: slugs.length });
});

export { app as kidsRoute };
