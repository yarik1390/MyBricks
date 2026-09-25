import { $, haptic, escapeHtml, fmtMoney, toast, celebrate, getExchangeRate, CURRENCY_SYMBOLS, setHue, thumbImg } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t, tPlural, intlLocale } from '../lib/i18n.js';
import { topbar, btn, pill, emptyState, brickSvg } from '../ui/kit.js';

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

const onScreen = () => location.hash.split('?')[0] === '#/game';
let roundState = null;

function shell(inner, sub) {
  return `<main class="bv-page bv-game">
      ${topbar({ title: t('bvCommunity.gameTitle'), sub, back: '#/', backLabel: t('bvCommunity.backVault') })}
      <div id="gameBody" class="bv-game__body">${inner}</div>
    </main>`;
}

export async function renderGame() {
  const root = $("#root");
  if (!root) return;
  root.innerHTML = shell(`<div class="bv-game__loading" role="status"><span class="bv-skel" style="height:220px;border-radius:24px"></span><span class="bv-sr">${escapeHtml(t('bvCommunity.gameLoading'))}</span></div>`, t('bvCommunity.gameDaily'));

  let daily;
  try { daily = await api("/api/game/daily"); }
  catch (e) {
    if (!onScreen()) return;
    $("#gameBody").innerHTML = emptyState({ icon: 'cloudOff', title: t('bvCommunity.gameLoadFailedTitle'), body: t('game.loadFailed', { error: e.message || e }), actionsHtml: btn(t('bvCommunity.retry'), { kind: 'tonal', id: 'gameRetry' }), role: 'alert' });
    $("#gameRetry")?.addEventListener("click", renderGame);
    return;
  }
  if (!onScreen()) return;
  if (!daily.rounds?.length) {
    $("#gameBody").innerHTML = emptyState({ icon: 'clock', title: t('bvCommunity.gameNotReadyTitle'), body: t('bvCommunity.gameNotReadyBody') });
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

function currencySymbol() {
  return CURRENCY_SYMBOLS[state.me?.currency || "USD"] || "$";
}

// One segment per round: green = right, red = off, ink = this round.
function progressHTML(daily, idx, results) {
  return `<div class="bv-game__prog" aria-hidden="true">${daily.rounds.map((r, i) => {
    const res = results.find(x => x.set_num === r.set_num);
    const cls = res ? (res.correct ? 'is-right' : 'is-wrong') : i === idx ? 'is-now' : '';
    return `<span class="${cls}"></span>`;
  }).join('')}</div>`;
}

function footLine(results) {
  const streak = loadJSON(STREAK_KEY) || { streak: 0, best: 0 };
  const right = results.filter(r => r.correct).length;
  const parts = [];
  if (streak.streak) parts.push(tPlural('bvCommunity.gameStreak', streak.streak, { count: streak.streak }));
  if (streak.best) parts.push(t('bvCommunity.gameBest', { best: streak.best }));
  if (results.length) parts.push(t('bvCommunity.gameSoFar', { right, done: results.length }));
  return parts.join(' · ');
}

function roundHTML(round, idx, daily, results) {
  const hasImg = round.image_url && !String(round.image_url).startsWith("data:");
  const meta = [round.set_num, round.pieces ? tPlural('card.gamePieces', round.pieces).replace(String(round.pieces), Number(round.pieces).toLocaleString(intlLocale())) : '', round.retail_price ? t("card.gameRetail", { price: fmtMoney(round.retail_price, { cents: 0 }) }) : ''].filter(Boolean).join(' · ');
  const rate = getExchangeRate(state.me?.currency || "USD") || 1;
  const start = round.retail_price ? Math.max(10, Math.round((Number(round.retail_price) * rate) / 10) * 10) : '';
  const steps = [-50, -10, 10, 50].map(d => `<button type="button" class="bv-chip" data-step="${d}">${d < 0 ? '−' : '+'}${Math.abs(d)}</button>`).join('');
  return `${progressHTML(daily, idx, results)}
    <section class="bv-card bv-game__set">
      <div class="bv-game__stage game-set-photo-stage">${brickSvg(`hsl(${setHue(round)} 40% 48%)`)}${hasImg ? `<img class="set-photo game-set-photo" src="${escapeHtml(thumbImg(round.image_url, 600))}" alt="" decoding="async">` : ''}</div>
      <h2 class="bv-game__name">${escapeHtml(round.name)}</h2>
      <p class="bv-game__meta">${escapeHtml(meta)}</p>
    </section>
    <div class="bv-game__ask" id="gameAsk">
      <label class="bv-game__q" for="gameGuess">${escapeHtml(t('bvCommunity.gameQuestion'))}</label>
      <div class="bv-game__guess"><span class="bv-game__cur" aria-hidden="true">${escapeHtml(currencySymbol())}</span><input id="gameGuess" type="number" inputmode="decimal" min="1" step="1" value="${start}" placeholder="${escapeHtml(t('bvCommunity.gameGuessPh'))}" aria-describedby="gameHint"></div>
      <div class="bv-game__steps" role="group" aria-label="${escapeHtml(t('bvCommunity.gameAdjust'))}">${steps}</div>
      <span class="bv-sr" id="gameHint">${escapeHtml(t('bvCommunity.gameHint'))}</span>
      ${btn(t('bvCommunity.gameLockIn'), { id: 'gameLock', full: true, size: 'lg' })}
    </div>
    <div id="gameReveal" class="bv-game__reveal" aria-live="polite"></div>
    <p class="bv-game__foot" id="gameFoot">${escapeHtml(footLine(results))}</p>`;
}

function playRound(daily, idx, results) {
  const round = daily.rounds[idx];
  const total = daily.rounds.length;
  roundState = { daily, idx, results };
  const sub = $('.bv-game .bv-topbar__sub');
  if (sub) sub.textContent = t('bvCommunity.gameRound', { n: idx + 1, total });
  // Plain innerHTML (not morphdom mount): each round is a full-screen swap, so
  // fresh DOM nodes are correct — and crucially they prevent click listeners
  // from stacking on a reused #gameLock/#gameNext across rounds (which caused
  // one tap to fire multiple times → duplicate results and racing re-renders).
  $("#gameBody").innerHTML = roundHTML(round, idx, daily, results);
  const input = $("#gameGuess");
  document.querySelectorAll('.bv-game__steps [data-step]').forEach(b => b.addEventListener('click', () => {
    if (!input || input.disabled) return;
    haptic('light');
    input.value = String(Math.max(1, (Number(input.value) || 0) + Number(b.dataset.step)));
  }));

  let locked = false;   // this round has already been answered
  const lock = async () => {
    if (locked) return;
    // A round is answered exactly once (defends against a double-tap landing
    // before the button disables, and against any stray duplicate listener).
    if (results.some(r => r.set_num === round.set_num)) return;
    const userCurrency = state.me?.currency || "USD";
    const rate = getExchangeRate(userCurrency);
    const raw = Number(input?.value);
    if (!Number.isFinite(raw) || raw <= 0) { toast(t('bvCommunity.gameEnterGuess'), "info"); input?.focus(); return; }
    locked = true;
    const guessUsd = raw / (rate || 1);
    haptic("medium");
    const lockBtn = $("#gameLock");
    if (lockBtn) lockBtn.disabled = true;
    let out;
    try {
      out = await api("/api/game/guess", { method: "POST", body: { set_num: round.set_num, guess: guessUsd } });
    } catch (e) {
      toast(t('game.checkGuessFailed', { error: e.message || e }), "error");
      locked = false;
      if (lockBtn) lockBtn.disabled = false;
      return;
    }
    results.push({ set_num: round.set_num, correct: !!out.correct, pct_off: out.pct_off });
    if (!onScreen() || roundState?.idx !== idx) return;
    if (input) input.disabled = true;
    $("#gameAsk")?.classList.add('is-locked');
    const prog = $('.bv-game__prog');
    if (prog) prog.outerHTML = progressHTML(daily, idx, results);
    const foot = $("#gameFoot");
    if (foot) foot.textContent = footLine(results);
    const reveal = $("#gameReveal");
    if (reveal) {
      reveal.innerHTML = `
        <div class="bv-game__verdict ${out.correct ? 'is-right' : 'is-wrong'}">
          <span class="bv-game__verdict-title">${escapeHtml(t(out.correct ? 'game.revealCorrect' : 'game.revealIncorrect', { value: fmtMoney(out.actual) }))}</span>
          <span class="bv-game__verdict-sub">${escapeHtml(t("game.pctOff", { pct: out.pct_off }))}</span>
        </div>
        ${btn(idx + 1 < total ? t('bvCommunity.gameNext') : t('bvCommunity.gameSeeScore'), { id: 'gameNext', full: true, size: 'lg', kind: 'ink' })}`;
      $("#gameLock")?.setAttribute('hidden', '');
      // once:true — a single Next tap advances exactly one round.
      $("#gameNext")?.addEventListener("click", () => {
        haptic("light");
        if (idx + 1 < total) playRound(daily, idx + 1, results);
        else finish(daily, results);
      }, { once: true });
      $("#gameNext")?.focus();
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
  const sub = $('.bv-game .bv-topbar__sub');
  if (sub) sub.textContent = t('bvCommunity.gameDoneSub');
  const rows = daily.rounds.map(r => {
    const res = results.find(x => x.set_num === r.set_num);
    const trail = res ? (res.correct ? pill(t('bvCommunity.gameRight'), 'gain', { icon: 'check' }) : pill(t('bvCommunity.gameOff', { pct: res.pct_off }), 'loss')) : '—';
    return `<div class="bv-game__row"><span class="bv-game__row-name">${escapeHtml(r.name)}</span>${trail}</div>`;
  }).join("");
  $("#gameBody").innerHTML = `
    ${progressHTML(daily, -1, results)}
    <section class="bv-card bv-game__score">
      <span class="bv-game__big">${score}/${daily.rounds.length}</span>
      <span class="bv-game__meta">${escapeHtml(t("game.streakLine", { day: daily.day, streak: streak.streak, best: streak.best }))}</span>
    </section>
    <section class="bv-card bv-game__rows">${rows}</section>
    <div class="bv-game__actions">${btn(t('bvCommunity.backVault'), { href: '#/', kind: 'outline' })}${btn(t('bvCommunity.gameShare'), { id: 'gameShare', icon: 'share' })}</div>
    <p class="bv-game__foot">${escapeHtml(t('bvCommunity.gameFootnote'))}</p>`;
  $("#gameShare")?.addEventListener("click", async () => {
    haptic("medium");
    const squares = daily.rounds.map(r => (results.find(x => x.set_num === r.set_num)?.correct ? "🟩" : "🟥")).join("");
    const { shareContent } = await import("../lib/native-share.js");
    shareContent({ title: t('share.gameTitle'), text: t('share.gameText', { day: daily.day, tiles: squares, score, streak: streak.streak }) });
  });
}
