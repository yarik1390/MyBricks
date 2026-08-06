import { $, haptic, escapeHtml, fmtMoney, toast, celebrate, getExchangeRate, CURRENCY_SYMBOLS } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { t, tPlural } from '../lib/i18n.js';

// "Price It!" — the daily price game. Five real sets, guess the market value,
// within ±20% counts. Everyone worldwide plays the same five (server picks
// them deterministically from the UTC date). Streak = consecutive days played,
// tracked locally. Signed-in guesses feed an analytics-only crowd prior.

const RESULT_KEY = "bv_game_result";   // { day, results: [{set_num, correct, pct_off}] }
const STREAK_KEY = "bv_game_streak";   // { last_day, streak, best }

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Playing on consecutive UTC days extends the streak; a gap resets it. Called
// once when today's game completes.
export function bumpStreak(today) {
  const s = loadJSON(STREAK_KEY) || { last_day: null, streak: 0, best: 0 };
  if (s.last_day === today) return s;
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  s.streak = s.last_day === yesterday ? s.streak + 1 : 1;
  s.best = Math.max(s.best, s.streak);
  s.last_day = today;
  saveJSON(STREAK_KEY, s);
  return s;
}

export async function renderGame() {
  const root = $("#root");
  root.innerHTML = `
    <div class="page">
      <div class="topbar">
        <a class="icon-btn" href="#/" aria-label="Back to vault" style="margin-top:2px;margin-right:8px;">${I.chevL()}</a>
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Daily challenge</div>
          <h1 class="topbar-title">Price It!</h1>
        </div>
      </div>
      <div id="gameBody" style="max-width:520px;margin:0 auto;">
        <div style="text-align:center;padding:40px 0;color:var(--ink-mute);"><div class="spinner" style="margin:0 auto 10px;"></div>Setting up today's five…</div>
      </div>
    </div>`;

  let daily;
  try { daily = await api("/api/game/daily"); }
  catch (e) {
    $("#gameBody").innerHTML = `<p style="color:var(--down);font-size:13px;text-align:center;padding:30px 0;">${t('game.loadFailed', { error: escapeHtml(e.message) })}</p>`;
    return;
  }
  if (!daily.rounds?.length) {
    $("#gameBody").innerHTML = `<p style="color:var(--ink-mute);font-size:13px;text-align:center;padding:30px 0;">Today's game isn't ready yet — check back soon.</p>`;
    return;
  }

  const done = loadJSON(RESULT_KEY);
  if (done?.day === daily.day && done.results?.length >= daily.rounds.length) {
    showSummary(daily, done.results);
    return;
  }

  const results = [];
  playRound(daily, 0, results);
}

function roundHTML(round, idx, total) {
  const userCurrency = state.me?.currency || "USD";
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  const hasImg = round.image_url && !String(round.image_url).startsWith("data:");
  return `
    <div class="card" style="padding:16px;text-align:center;">
      <div class="u-mono-label" style="margin-bottom:8px;">${t("game.roundOf", { n: idx + 1, total })}</div>
      <div class="game-set-photo-stage" style="height:180px;display:flex;align-items:center;justify-content:center;background:var(--surface-2);border-radius:var(--r-2);margin-bottom:12px;">
        ${hasImg ? `<img class="game-set-photo" src="${escapeHtml(round.image_url)}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;mix-blend-mode:multiply;">` : `<div style="font-size:40px;">🧱</div>`}
      </div>
      <div style="font-family:var(--serif);font-size:19px;font-weight:600;">${escapeHtml(round.name)}</div>
      <div style="font-size:12px;color:var(--ink-mute);margin:4px 0 12px;">
        ${escapeHtml(round.theme || "")}${round.year ? ` · ${round.year}` : ""}${round.pieces ? ` · ${tPlural('card.gamePieces', round.pieces)}` : ""}${round.retail_price ? ` · ${t("card.gameRetail", { price: fmtMoney(round.retail_price, { cents: 0 }) })}` : ""}
      </div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">What's it worth on the market today?</div>
      <div style="display:flex;gap:8px;justify-content:center;align-items:center;">
        <span style="font-size:16px;font-weight:700;">${symbol}</span>
        <input id="gameGuess" type="number" inputmode="decimal" min="1" placeholder="Your guess"
          style="width:140px;font-size:18px;font-weight:700;text-align:center;padding:10px;border:2px solid var(--line);border-radius:var(--r-2);background:var(--surface);color:var(--ink);">
        <button class="btn-primary" id="gameLock" style="padding:10px 18px;">Lock in</button>
      </div>
      <div id="gameReveal" style="margin-top:14px;"></div>
    </div>`;
}

function playRound(daily, idx, results) {
  const round = daily.rounds[idx];
  // Plain innerHTML (not morphdom mount): each round is a full-screen swap, so
  // fresh DOM nodes are correct — and crucially they prevent click listeners
  // from stacking on a reused #gameLock/#gameNext across rounds (which caused
  // one tap to fire multiple times → duplicate results and racing re-renders).
  $("#gameBody").innerHTML = roundHTML(round, idx, daily.rounds.length);
  const input = $("#gameGuess");
  input?.focus();

  let locked = false;   // this round has already been answered
  const lock = async () => {
    if (locked) return;
    // A round is answered exactly once (defends against a double-tap landing
    // before the button disables, and against any stray duplicate listener).
    if (results.some(r => r.set_num === round.set_num)) return;
    const userCurrency = state.me?.currency || "USD";
    const rate = getExchangeRate(userCurrency);
    const raw = Number(input?.value);
    if (!Number.isFinite(raw) || raw <= 0) { toast("Enter your guess first", "info"); return; }
    locked = true;
    const guessUsd = raw / (rate || 1);
    haptic("medium");
    const btn = $("#gameLock");
    if (btn) btn.disabled = true;
    let out;
    try {
      out = await api("/api/game/guess", { method: "POST", body: { set_num: round.set_num, guess: guessUsd } });
    } catch (e) {
      toast(t('game.checkGuessFailed', { error: e.message || e }), "error");
      locked = false;
      if (btn) btn.disabled = false;
      return;
    }
    results.push({ set_num: round.set_num, correct: !!out.correct, pct_off: out.pct_off });
    const reveal = $("#gameReveal");
    if (reveal) {
      reveal.innerHTML = `
        <div style="padding:12px;border-radius:var(--r-2);background:${out.correct ? "var(--up)" : "var(--surface-2)"};color:${out.correct ? "#fff" : "var(--ink)"};">
          <div style="font-weight:800;font-size:15px;">${t(out.correct ? 'game.revealCorrect' : 'game.revealIncorrect', { value: fmtMoney(out.actual) })}</div>
          <div style="font-size:12px;opacity:.9;margin-top:2px;">${t("game.pctOff", { pct: out.pct_off })}</div>
        </div>
        <button class="btn-primary" id="gameNext" style="margin-top:12px;width:100%;">${idx + 1 < daily.rounds.length ? "Next set" : "See my score"}</button>`;
      // once:true — a single Next tap advances exactly one round.
      $("#gameNext")?.addEventListener("click", () => {
        haptic("light");
        if (idx + 1 < daily.rounds.length) playRound(daily, idx + 1, results);
        else finish(daily, results);
      }, { once: true });
    }
    if (out.correct) haptic("heavy");
  };
  $("#gameLock")?.addEventListener("click", lock);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") lock(); });
}

function finish(daily, results) {
  saveJSON(RESULT_KEY, { day: daily.day, results });
  const streak = bumpStreak(daily.day);
  const score = results.filter(r => r.correct).length;
  if (score >= 4) setTimeout(() => celebrate(t('game.marketGenius', { score }), { quip: tPlural('game.streakQuip', streak.streak), hue: 45 }), 400);
  showSummary(daily, results);
}

function showSummary(daily, results) {
  const score = results.filter(r => r.correct).length;
  const streak = loadJSON(STREAK_KEY) || { streak: 0, best: 0 };
  const rows = daily.rounds.map(r => {
    const res = results.find(x => x.set_num === r.set_num);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:8px 0;border-bottom:1px solid var(--line-soft);">
        <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.name)}</span>
        <span style="font-weight:700;color:${res?.correct ? "var(--up)" : "var(--down)"};margin-left:8px;">${res ? (res.correct ? "🎯" : `${res.pct_off}% off`) : "—"}</span>
      </div>`;
  }).join("");
  $("#gameBody").innerHTML = `
    <div class="card" style="padding:18px;text-align:center;">
      <div style="font-family:var(--serif);font-size:26px;font-weight:600;">${score}/5</div>
      <div style="font-size:12px;color:var(--ink-mute);margin:2px 0 12px;">${t("game.streakLine", { day: escapeHtml(daily.day), streak: streak.streak, best: streak.best })}</div>
      <div style="text-align:left;">${rows}</div>
      <div class="btn-row" style="margin-top:14px;">
        <a href="#/" class="btn-secondary" style="text-decoration:none;">Back to vault</a>
        <button class="btn-primary" id="gameShare">${I.share ? I.share() : ""}<span>Share</span></button>
      </div>
      <div style="font-size:11px;color:var(--ink-faint);margin-top:12px;">New sets every day at midnight UTC. Values are BricksVault market prices.</div>
    </div>`;
  $("#gameShare")?.addEventListener("click", async () => {
    haptic("medium");
    const squares = daily.rounds.map(r => (results.find(x => x.set_num === r.set_num)?.correct ? "🟩" : "🟥")).join("");
    const { shareContent } = await import("../lib/native-share.js");
    shareContent({ title: t('share.gameTitle'), text: t('share.gameText', { day: daily.day, tiles: squares, score, streak: streak.streak }) });
  });
}
