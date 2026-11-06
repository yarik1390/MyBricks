// Kids Mode play layer: badges, the daily game and fun facts.
// Pure (no DOM, no state) so node:test can cover it; views/kids.js renders it.
// Badges are computed from what the kid owns and has done, then merged with
// the slugs already stored (kids_badges), so a badge never disappears again
// once earned, even if a set later leaves the vault.

// group → badges in display order. `stat` names a field of computeKidsStats().
export const KIDS_BADGES = [
  { group: 'sets', slug: 'first_brick', stat: 'sets', target: 1, icon: 'brick', bg: '#ffda47' },
  { group: 'sets', slug: 'junior_builder', stat: 'sets', target: 5, icon: 'star', bg: '#9fd3a8' },
  { group: 'sets', slug: 'architect', stat: 'sets', target: 10, icon: 'grid', bg: '#a9c9f0' },
  { group: 'sets', slug: 'master', stat: 'sets', target: 25, icon: 'trophy', bg: '#ffb870' },
  { group: 'sets', slug: 'grand_master', stat: 'sets', target: 50, icon: 'trophy', bg: '#f4a3a3' },
  { group: 'sets', slug: 'legend', stat: 'sets', target: 100, icon: 'sparkle', bg: '#d3b8f5' },
  { group: 'builder', slug: 'built_1', stat: 'built', target: 1, icon: 'hand', bg: '#ffda47' },
  { group: 'builder', slug: 'built_5', stat: 'built', target: 5, icon: 'hand', bg: '#9fd3a8' },
  { group: 'builder', slug: 'built_10', stat: 'built', target: 10, icon: 'hand', bg: '#a9c9f0' },
  { group: 'builder', slug: 'built_25', stat: 'built', target: 25, icon: 'hand', bg: '#ffb870' },
  { group: 'pieces', slug: 'pieces_1k', stat: 'pieces', target: 1000, icon: 'box', bg: '#ffda47' },
  { group: 'pieces', slug: 'pieces_5k', stat: 'pieces', target: 5000, icon: 'box', bg: '#9fd3a8' },
  { group: 'pieces', slug: 'pieces_10k', stat: 'pieces', target: 10000, icon: 'box', bg: '#a9c9f0' },
  { group: 'pieces', slug: 'pieces_25k', stat: 'pieces', target: 25000, icon: 'box', bg: '#d3b8f5' },
  { group: 'pieces', slug: 'figs_10', stat: 'minifigs', target: 10, icon: 'fig', bg: '#ffb870' },
  { group: 'pieces', slug: 'figs_50', stat: 'minifigs', target: 50, icon: 'fig', bg: '#f4a3a3' },
  { group: 'themes', slug: 'explorer_3', stat: 'themes', target: 3, icon: 'globe', bg: '#9fd3a8' },
  { group: 'themes', slug: 'explorer_5', stat: 'themes', target: 5, icon: 'globe', bg: '#a9c9f0' },
  { group: 'themes', slug: 'explorer_10', stat: 'themes', target: 10, icon: 'globe', bg: '#d3b8f5' },
  { group: 'game', slug: 'game_1', stat: 'plays', target: 1, icon: 'game', bg: '#ffda47' },
  { group: 'game', slug: 'quiz_10', stat: 'wins', target: 10, icon: 'check', bg: '#9fd3a8' },
  { group: 'game', slug: 'streak_3', stat: 'bestStreak', target: 3, icon: 'flash', bg: '#ffb870' },
  { group: 'game', slug: 'streak_7', stat: 'bestStreak', target: 7, icon: 'flash', bg: '#f4a3a3' },
];

export const KIDS_BADGE_GROUPS = ['sets', 'builder', 'pieces', 'themes', 'game'];

// A theme "fan" badge for every theme with this many sets.
export const FAN_TARGET = 3;
export const FAN_COLORS = ['#ffda47', '#9fd3a8', '#a9c9f0', '#ffb870', '#f4a3a3', '#d3b8f5'];

export const XP_BUILT = 5;
export const XP_GAME_WIN = 5;
export const XP_GAME_TRY = 2;

export function themeSlug(theme) {
  return String(theme || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

const qty = (it) => Math.max(1, parseInt(String(it?.quantity ?? 1), 10) || 1);
const sameNum = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// Consecutive-day runs over YYYY-MM-DD strings. `current` only counts a run
// that reaches today or yesterday (so it doesn't reset before today's play).
export function streaks(days = [], today = '') {
  const uniq = [...new Set(days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  const toNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86400000);
  let best = 0, run = 0, prev = null;
  for (const d of uniq) {
    const n = toNum(d);
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  let current = 0;
  if (prev !== null && today) {
    const gap = toNum(today) - prev;
    if (gap === 0 || gap === 1) current = run;
  }
  return { current, best };
}

export function computeKidsStats({ items = [], marks = [], plays = [], today = '' } = {}) {
  const owned = items.filter(Boolean);
  const themeCounts = new Map();
  let pieces = 0, minifigs = 0;
  for (const it of owned) {
    pieces += (Number(it.pieces) || 0) * qty(it);
    minifigs += (Number(it.minifigs) || 0) * qty(it);
    const th = String(it.theme || '').trim();
    if (th) themeCounts.set(th, (themeCounts.get(th) || 0) + 1);
  }
  const ownedNums = new Set(owned.map(it => String(it.set_num || '').toLowerCase()));
  const built = marks.filter(m => m && m.built && ownedNums.has(String(m.set_num || '').toLowerCase())).length;
  const { current, best } = streaks(plays.map(p => p.day), today);
  return {
    sets: ownedNums.size,
    pieces,
    minifigs,
    themes: themeCounts.size,
    themeCounts: [...themeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    built,
    plays: plays.length,
    wins: plays.filter(p => p && p.correct).length,
    streak: current,
    bestStreak: best,
  };
}

// Every badge with its progress. `stored` = slugs already saved as earned.
// Theme fans: one per theme at FAN_TARGET sets, plus the closest unearned one
// as a goal so the badges page always shows a theme to work towards.
export function kidsBadges(stats, stored = []) {
  const have = new Set(stored);
  const list = KIDS_BADGES.map(b => {
    const value = Number(stats?.[b.stat]) || 0;
    return { ...b, value, earned: have.has(b.slug) || value >= b.target };
  });
  const fans = [];
  let goal = null;
  (stats?.themeCounts || []).forEach(([theme, n], i) => {
    const slug = `fan_${themeSlug(theme)}`;
    if (slug === 'fan_') return;
    const entry = { group: 'themes', slug, theme, stat: 'theme', target: FAN_TARGET, value: n, icon: 'heart', bg: FAN_COLORS[i % FAN_COLORS.length] };
    if (n >= FAN_TARGET || have.has(slug)) fans.push({ ...entry, earned: true });
    else if (!goal) goal = { ...entry, earned: false };
  });
  // A stored fan badge whose theme left the vault still shows as earned.
  for (const slug of have) {
    if (slug.startsWith('fan_') && !fans.some(f => f.slug === slug)) {
      fans.push({ group: 'themes', slug, theme: '', stat: 'theme', target: FAN_TARGET, value: FAN_TARGET, icon: 'heart', bg: FAN_COLORS[fans.length % FAN_COLORS.length], earned: true });
    }
  }
  if (goal) fans.push(goal);
  return [...list, ...fans];
}

// Slugs earned now that aren't stored yet (to save and celebrate).
export function newlyEarned(badges, stored = []) {
  const have = new Set(stored);
  return badges.filter(b => b.earned && !have.has(b.slug)).map(b => b.slug);
}

// ── Daily game ─────────────────────────────────────────────────────────────
// One question a day from the kid's own sets: which has more pieces, which is
// older, or which has more minifigures. Deterministic from the day and the
// vault, so reloading shows the same question.

export const GAME_KINDS = ['pieces', 'older', 'minifigs'];

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gameValue(kind, set) {
  if (!set) return null;
  if (kind === 'pieces') { const n = Number(set.pieces); return n > 0 ? n : null; }
  if (kind === 'older') { const y = Number(set.year); return y > 1940 ? y : null; }
  if (kind === 'minifigs') { const n = Number(set.minifigs); return Number.isFinite(n) && n >= 0 && set.minifigs != null ? n : null; }
  return null;
}

// The set_num that answers the question (null when it's a tie).
export function gameAnswer(kind, a, b) {
  const va = gameValue(kind, a), vb = gameValue(kind, b);
  if (va == null || vb == null || va === vb) return null;
  if (kind === 'older') return va < vb ? a.set_num : b.set_num;
  return va > vb ? a.set_num : b.set_num;
}

export function pickDailyQuestion(items = [], day = '') {
  const pool = [...new Map(items.filter(it => it?.set_num).map(it => [String(it.set_num).toLowerCase(), it])).values()]
    .sort((x, y) => String(x.set_num).localeCompare(String(y.set_num)));
  if (pool.length < 2) return null;
  const rand = rng(hashStr(`${day}|${pool.map(p => p.set_num).join(',')}`));
  const start = Math.floor(rand() * GAME_KINDS.length);
  for (let k = 0; k < GAME_KINDS.length; k++) {
    const kind = GAME_KINDS[(start + k) % GAME_KINDS.length];
    const eligible = pool.filter(p => gameValue(kind, p) != null);
    if (eligible.length < 2) continue;
    // Fisher-Yates with the seeded generator, then the first pair that differs.
    const order = eligible.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        if (gameValue(kind, order[i]) !== gameValue(kind, order[j])) {
          return { kind, a: order[i].set_num, b: order[j].set_num };
        }
      }
    }
  }
  return null;
}

export function findSet(items, setNum) {
  return items.find(it => sameNum(it?.set_num, setNum)) || null;
}

// ── Fun facts ──────────────────────────────────────────────────────────────
// A LEGO brick is 9.6 mm tall without its stud, so a stack of every piece is
// pieces × 9.6 mm. Picks the tallest thing the tower beats.
export const BRICK_HEIGHT_M = 0.0096;
export const TOWER_THINGS = [
  ['cat', 0.3], ['dog', 0.6], ['kid', 1.3], ['grownup', 1.8], ['elephant', 3.2],
  ['giraffe', 5.5], ['house', 9], ['lighthouse', 30], ['skyscraper', 100],
];

export function towerFact(pieces) {
  const meters = Math.max(0, Number(pieces) || 0) * BRICK_HEIGHT_M;
  let thing = null;
  for (const [name, h] of TOWER_THINGS) if (meters > h) thing = name;
  return { meters, thing };
}

// Home tiles: favourites first, then newest.
export function kidsTileOrder(items = [], marks = []) {
  const fav = new Set(marks.filter(m => m?.favorite).map(m => String(m.set_num).toLowerCase()));
  return items
    .map((it, i) => ({ it, i, f: fav.has(String(it.set_num).toLowerCase()) ? 0 : 1 }))
    .sort((x, y) => x.f - y.f || x.i - y.i)
    .map(x => x.it);
}
