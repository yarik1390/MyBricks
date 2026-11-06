// Guest (signed-out) twin of worker/src/routes/kids.ts: the same responses,
// stored in localStorage. Set-add XP is 10 per set in the vault, the rest
// (builds, daily game) is a stored bonus.
import { gameAnswer, gameValue, findSet, XP_BUILT, XP_GAME_TRY, XP_GAME_WIN } from './kids-play.js';
import { levelForXp, XP_PER_SET } from './kids-xp.js';

const KEY = 'bv_guest_kids';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { bonus: Number(v.bonus) || 0, badges: Array.isArray(v.badges) ? v.badges : [], marks: v.marks && typeof v.marks === 'object' ? v.marks : {}, plays: Array.isArray(v.plays) ? v.plays : [] };
  } catch { return { bonus: 0, badges: [], marks: {}, plays: [] }; }
}
function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: play still works this session */ } }

const xpOf = (s, items) => s.bonus + new Set(items.map(i => String(i.set_num).toLowerCase())).size * XP_PER_SET;

function award(s, items, amount) {
  const before = xpOf(s, items);
  s.bonus += amount;
  write(s);
  const xp = xpOf(s, items);
  const level = levelForXp(xp);
  return { xp_gained: amount, xp, level, new_level: level > levelForXp(before) ? level : null };
}

function fail(code) { return Object.assign(new Error(code), { status: 400 }); }

export function guestKids(pathname, method, body = {}, items = []) {
  const s = read();
  if (pathname === '/api/kids/state' && method === 'GET') {
    const xp = xpOf(s, items);
    return {
      xp, level: levelForXp(xp), badges: s.badges,
      marks: Object.entries(s.marks).map(([set_num, m]) => ({ set_num, built: !!m.built, favorite: !!m.favorite })),
      plays: s.plays.slice(-400),
    };
  }
  if (pathname === '/api/kids/mark' && method === 'POST') {
    const set = findSet(items, body.set_num);
    if (!set) throw fail('not_owned');
    const prev = s.marks[set.set_num] || {};
    const next = {
      built: typeof body.built === 'boolean' ? body.built : !!prev.built,
      favorite: typeof body.favorite === 'boolean' ? body.favorite : !!prev.favorite,
      built_xp: !!prev.built_xp,
    };
    const giveXp = next.built && !next.built_xp;
    if (giveXp) next.built_xp = true;
    s.marks[set.set_num] = next;
    const res = { ok: true, set_num: set.set_num, built: next.built, favorite: next.favorite };
    if (giveXp) return { ...res, ...award(s, items, XP_BUILT) };
    write(s);
    return { ...res, xp_gained: 0, new_level: null };
  }
  if (pathname === '/api/kids/game' && method === 'POST') {
    const a = findSet(items, body.set_a), b = findSet(items, body.set_b);
    if (!a || !b || a === b) throw fail('bad_sets');
    if (s.plays.some(p => p.day === body.day)) throw Object.assign(new Error('already_played'), { status: 409 });
    const answer = gameAnswer(body.kind, a, b);
    if (!answer) throw fail('no_answer');
    const pick = String(body.pick || '').toLowerCase() === String(a.set_num).toLowerCase() ? a.set_num : b.set_num;
    const correct = pick === answer;
    s.plays.push({ day: String(body.day), kind: body.kind, set_a: a.set_num, set_b: b.set_num, pick, correct });
    return {
      correct, answer,
      values: { [a.set_num]: gameValue(body.kind, a), [b.set_num]: gameValue(body.kind, b) },
      ...award(s, items, correct ? XP_GAME_WIN : XP_GAME_TRY),
    };
  }
  if (pathname === '/api/kids/badges' && method === 'POST') {
    const slugs = (Array.isArray(body.slugs) ? body.slugs : []).filter(x => typeof x === 'string' && /^[a-z0-9_-]{1,64}$/.test(x));
    s.badges = [...new Set([...s.badges, ...slugs])];
    write(s);
    return { ok: true, saved: slugs.length };
  }
  throw Object.assign(new Error('not_found'), { status: 404 });
}
