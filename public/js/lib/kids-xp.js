export const BADGE_DEFS = [
  { slug: 'first_brick',    threshold: 1,   label: 'First Brick!',   emoji: '🧱' },
  { slug: 'junior_builder', threshold: 5,   label: 'Junior Builder', emoji: '🏗️' },
  { slug: 'architect',      threshold: 10,  label: 'Architect',      emoji: '📐' },
  { slug: 'master',         threshold: 25,  label: 'Master Builder', emoji: '⭐' },
  { slug: 'grand_master',   threshold: 50,  label: 'Grand Master',   emoji: '🏆' },
  { slug: 'legend',         threshold: 100, label: 'Legendary!',     emoji: '🌟' },
];

export const XP_PER_SET = 10;

// level = min(10, floor(sqrt(xp/10)) + 1)
export function levelForXp(xp) {
  return Math.min(10, Math.floor(Math.sqrt(xp / 10)) + 1);
}

// Inverse: minimum XP needed to reach a given level
export function xpForLevel(level) {
  return (level - 1) * (level - 1) * 10;
}
