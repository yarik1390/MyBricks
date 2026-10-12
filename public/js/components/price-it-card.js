import { escapeHtml } from '../utils.js';
import { t, tPlural } from '../lib/i18n.js';
import { icon } from '../ui/kit.js';

// Shared "Price It!" pieces: today's local result, the five-segment score ring
// (the Vault Dial motif from the app icon) and the daily card on Discover.
// Kept out of views/game.js so Discover doesn't load the whole game.

export const RESULT_KEY = "bv_game_result";   // { day, results: [{set_num, correct, pct_off}] }
export const STREAK_KEY = "bv_game_streak";   // { last_day, streak, best }
export const ROUNDS = 5;

export function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

export const utcToday = () => new Date().toISOString().slice(0, 10);

// What the player has done today (UTC day, same as the server's game day).
export function todayGame() {
  const r = loadJSON(RESULT_KEY);
  const results = r?.day === utcToday() ? (r.results || []) : [];
  const s = loadJSON(STREAK_KEY) || {};
  // A streak only counts while it's alive: last played today or yesterday.
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const alive = s.last_day === utcToday() || s.last_day === yesterday;
  return {
    played: results.length >= ROUNDS,
    results,
    score: results.filter(x => x.correct).length,
    streak: alive ? (s.streak || 0) : 0,
    best: s.best || 0,
  };
}

// Five arcs around a dial. `marks` holds one entry per round: true (right),
// false (off) or null (not played yet). `now` highlights the current round.
export function scoreRing(marks, { size = 120, stroke = 10, now = -1, centerHtml = '', cls = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const n = marks.length || ROUNDS;
  const seg = c / n;
  const gap = Math.min(10, seg * 0.18);
  const arcs = Array.from({ length: n }, (_, i) => {
    const m = marks[i];
    const state = m === true ? 'is-right' : m === false ? 'is-wrong' : i === now ? 'is-now' : '';
    return `<circle class="bv-dial__seg ${state}" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${(seg - gap).toFixed(2)} ${c.toFixed(2)}" stroke-dashoffset="${(-i * seg - gap / 2).toFixed(2)}" style="--i:${i}"/>`;
  }).join('');
  return `<span class="bv-dial ${cls}" style="--ring:${size}px" aria-hidden="true">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g></svg>
      <span class="bv-dial__center">${centerHtml}</span>
    </span>`;
}

// Hours and minutes until the next UTC midnight, when the next five unlock.
export function timeToNextGame(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const mins = Math.max(1, Math.ceil((next - now) / 60000));
  return t('priceIt.timeHM', { h: Math.floor(mins / 60), m: mins % 60 });
}

// The big daily card at the top of Discover: today's ring, streak and a CTA.
export function priceItCardHTML() {
  const g = todayGame();
  const marks = Array.from({ length: ROUNDS }, (_, i) => (g.results[i] ? !!g.results[i].correct : null));
  const center = g.played
    ? `<span class="bv-dial__score">${g.score}<small>/${ROUNDS}</small></span>`
    : icon('game', { size: 26 });
  const sub = g.played
    ? t('priceIt.nextIn', { time: timeToNextGame() })
    : t('priceIt.cardTodo');
  const streak = g.streak > 0
    ? `<span class="bv-pit-card__streak">${icon('flash', { size: 14 })}${escapeHtml(tPlural('bvVault.gameStreak', g.streak))}</span>`
    : '';
  return `<a class="bv-pit-card${g.played ? ' is-played' : ''}" href="#/game" id="priceItCard">
      ${scoreRing(marks, { size: 64, stroke: 7, now: g.played ? -1 : g.results.length, centerHtml: center })}
      <span class="bv-pit-card__text">
        <span class="bv-pit-card__title">${escapeHtml(t('bvAccount.priceIt'))}</span>
        <span class="bv-pit-card__sub">${escapeHtml(sub)}</span>
        ${streak}
      </span>
      <span class="bv-pit-card__cta">${escapeHtml(g.played ? t('priceIt.seeScore') : t('priceIt.play'))}</span>
    </a>`;
}
