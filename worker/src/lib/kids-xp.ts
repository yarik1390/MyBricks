export const BADGE_DEFS = [
  { slug: 'first_brick',    threshold: 1,   label: 'First Brick!',   emoji: '🧱' },
  { slug: 'junior_builder', threshold: 5,   label: 'Junior Builder', emoji: '🏗️' },
  { slug: 'architect',      threshold: 10,  label: 'Architect',      emoji: '📐' },
  { slug: 'master',         threshold: 25,  label: 'Master Builder', emoji: '⭐' },
  { slug: 'grand_master',   threshold: 50,  label: 'Grand Master',   emoji: '🏆' },
  { slug: 'legend',         threshold: 100, label: 'Legendary!',     emoji: '🌟' },
] as const;

export const XP_PER_SET = 10;

// level = min(10, floor(sqrt(xp/10)) + 1)
export function levelForXp(xp: number): number {
  return Math.min(10, Math.floor(Math.sqrt(xp / 10)) + 1);
}

// Badge slugs newly earned when XP changes from oldXp to newXp
export function newBadgesForXpChange(oldXp: number, newXp: number): string[] {
  const oldCount = Math.floor(oldXp / XP_PER_SET);
  const newCount = Math.floor(newXp / XP_PER_SET);
  return BADGE_DEFS
    .filter(b => newCount >= b.threshold && oldCount < b.threshold)
    .map(b => b.slug);
}

// SHA-256 via SubtleCrypto (available in Workers + Vitest cloudflare pool)
export async function hashPin(pin: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('brickvault:kids:' + pin),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return (await hashPin(pin)) === hash;
}

// Award XP after a set is added. No-op when the user has no kids PIN.
// Returns { xp_gained, new_level, new_badges }.
export async function awardXpForAdd(db: D1Database, userId: string) {
  const prefs = await db
    .prepare('SELECT kids_xp, kids_level, kids_pin_hash FROM user_prefs WHERE user_id=?')
    .bind(userId)
    .first<{ kids_xp: number; kids_level: number; kids_pin_hash: string | null }>();

  if (!prefs?.kids_pin_hash) {
    return { xp_gained: 0, new_level: null, new_badges: [] as string[] };
  }

  const oldXp = prefs.kids_xp ?? 0;
  const newXp = oldXp + XP_PER_SET;
  const newLevel = levelForXp(newXp);
  const slugs = newBadgesForXpChange(oldXp, newXp);

  await db.batch([
    db.prepare(
      "UPDATE user_prefs SET kids_xp=?, kids_level=?, updated_at=datetime('now') WHERE user_id=?"
    ).bind(newXp, newLevel, userId),
    ...slugs.map(slug =>
      db.prepare(
        'INSERT OR IGNORE INTO kids_badges (user_id, badge_slug) VALUES (?, ?)'
      ).bind(userId, slug)
    ),
  ]);

  return {
    xp_gained: XP_PER_SET,
    new_level: newLevel !== prefs.kids_level ? newLevel : null,
    new_badges: slugs,
  };
}

// Kids Mode play layer (routes/kids.ts): XP for "I built it!" and the daily
// game. Mirrors public/js/lib/kids-play.js.
export const XP_BUILT = 5;
export const XP_GAME_WIN = 5;
export const XP_GAME_TRY = 2;

// Add XP to a kid's total (creates the prefs row if needed). Unlike set adds,
// these actions only exist inside Kids Mode, so no PIN is required.
export async function awardKidsXp(db: D1Database, userId: string, amount: number) {
  const prev = await db
    .prepare('SELECT kids_xp, kids_level FROM user_prefs WHERE user_id=?')
    .bind(userId)
    .first<{ kids_xp: number | null; kids_level: number | null }>();
  const oldXp = Number(prev?.kids_xp ?? 0);
  const oldLevel = Number(prev?.kids_level ?? levelForXp(oldXp));
  const xp = oldXp + Math.max(0, Math.floor(amount));
  const level = levelForXp(xp);
  await db.prepare(
    `INSERT INTO user_prefs (user_id, kids_xp, kids_level, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET kids_xp=excluded.kids_xp, kids_level=excluded.kids_level, updated_at=excluded.updated_at`
  ).bind(userId, xp, level).run();
  return { xp_gained: xp - oldXp, xp, level, new_level: level > oldLevel ? level : null };
}
