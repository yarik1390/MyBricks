import { $, haptic, escapeHtml, fmtMoney, toast, celebrate, getExchangeRate, CURRENCY_SYMBOLS, setHue, thumbImg } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { t, tPlural, intlLocale } from '../lib/i18n.js';
import { topbar, btn, pill, emptyState, brickSvg, icon } from '../ui/kit.js';
import { RESULT_KEY, STREAK_KEY, loadJSON, scoreRing, timeToNextGame } from '../components/price-it-card.js';

// "Price It!" — the daily price game. Five real sets, guess the market value,
// within ±20% counts. Everyone worldwide plays the same five (server picks
// them deterministically from the UTC date). Streak = consecutive days played,
// tracked locally. Signed-in guesses feed an analytics-only crowd prior.

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
    const mark = res ? icon(res.correct ? 'check' : 'x', { size: 14, stroke: 3 }) : String(i + 1);
    return `<span class="${cls}">${mark}</span>`;
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

// Log-scale slider: equal thumb travel per "times as much", so $40 and $400
// sets are equally easy to dial in. Range is anchored on the retail price.
function sliderRange(round, rate) {
  const retail = Number(round.retail_price) * rate;
  if (retail > 0) return { lo: Math.max(5, retail * 0.25), hi: Math.max(retail * 6, 100) };
  return { lo: 10 * rate, hi: 4000 * rate };
}
const SLIDER_MAX = 1000;
const roundGuess = (v) => (v < 100 ? Math.round(v) : v < 1000 ? Math.round(v / 5) * 5 : Math.round(v / 10) * 10);
const toSlider = (v, { lo, hi }) => Math.round(Math.min(1, Math.max(0, Math.log(v / lo) / Math.log(hi / lo))) * SLIDER_MAX);
const fromSlider = (p, { lo, hi }) => roundGuess(lo * (hi / lo) ** (p / SLIDER_MAX));

function roundHTML(round, idx, daily, results) {
  const hasImg = round.image_url && !String(round.image_url).startsWith("data:");
  const facts = [
    `<span class="bv-game__fact is-num">${escapeHtml(round.set_num)}</span>`,
    round.pieces ? `<span class="bv-game__fact">${escapeHtml(tPlural('card.gamePieces', round.pieces).replace(String(round.pieces), Number(round.pieces).toLocaleString(intlLocale())))}</span>` : '',
    round.retail_price ? `<span class="bv-game__fact">${escapeHtml(t("card.gameRetail", { price: fmtMoney(round.retail_price, { cents: 0 }) }))}</span>` : '',
  ].filter(Boolean).join('');
  const tags = [round.theme, round.year].filter(Boolean).map(x => `<span class="bv-game__tag">${escapeHtml(String(x))}</span>`).join('');
  const rate = getExchangeRate(state.me?.currency || "USD") || 1;
  const start = round.retail_price ? Math.max(10, Math.round((Number(round.retail_price) * rate) / 10) * 10) : '';
  const range = sliderRange(round, rate);
  const steps = [-50, -10, 10, 50].map(d => `<button type="button" class="bv-chip" data-step="${d}">${d < 0 ? '−' : '+'}${Math.abs(d)}</button>`).join('');
  return `${progressHTML(daily, idx, results)}
    <section class="bv-game__set">
      <div class="bv-game__tile" style="--set-hue:${setHue(round)}">
        <div class="bv-game__stage game-set-photo-stage">${brickSvg(`hsl(${setHue(round)} 40% 48%)`)}${hasImg ? `<img class="set-photo game-set-photo" src="${escapeHtml(thumbImg(round.image_url, 600))}" alt="" decoding="async">` : ''}</div>
        ${tags ? `<div class="bv-game__tags">${tags}</div>` : ''}
      </div>
      <h2 class="bv-game__name">${escapeHtml(round.name)}</h2>
      <p class="bv-game__facts">${facts}</p>
    </section>
    <div class="bv-game__ask" id="gameAsk">
      <label class="bv-game__q" for="gameGuess">${escapeHtml(t('bvCommunity.gameQuestion'))}</label>
      <div class="bv-game__guess"><span class="bv-game__cur" aria-hidden="true">${escapeHtml(currencySymbol())}</span><input id="gameGuess" type="number" inputmode="decimal" min="1" step="1" value="${start}" placeholder="${escapeHtml(t('bvCommunity.gameGuessPh'))}" aria-describedby="gameHint"></div>
      <input id="gameRange" class="bv-game__range" type="range" min="0" max="${SLIDER_MAX}" step="1" value="${start ? toSlider(start, range) : SLIDER_MAX / 2}" aria-label="${escapeHtml(t('priceIt.slider'))}" data-lo="${range.lo}" data-hi="${range.hi}">
      <div class="bv-game__steps" role="group" aria-label="${escapeHtml(t('bvCommunity.gameAdjust'))}">${steps}</div>
      <p class="bv-game__hint" id="gameHint">${icon('info', { size: 16 })}<span>${escapeHtml(t('bvCommunity.gameHint'))}</span></p>
      ${btn(t('bvCommunity.gameLockIn'), { id: 'gameLock', full: true, size: 'lg' })}
    </div>
    <div id="gameReveal" class="bv-game__reveal" aria-live="polite"></div>
    <p class="bv-game__foot" id="gameFoot">${escapeHtml(footLine(results))}</p>`;
}

// Guess vs market on one track: the green band is the ±20% "right" zone.
function meterHTML(guess, actual, correct) {
  const max = Math.max(guess, actual * 1.2) * 1.15;
  const pct = (v) => Math.min(100, Math.max(0, (v / max) * 100));
  const pos = (v) => `${pct(v).toFixed(2)}%`;
  // Keep each label inside the track: anchor it left/right near the ends.
  const shift = (v) => `--shift:${pct(v) < 18 ? '-12px' : pct(v) > 82 ? 'calc(-100% + 12px)' : '-50%'}`;
  return `<div class="bv-game__meter" style="--band-l:${pos(actual * 0.8)};--band-r:${pos(actual * 1.2)};--guess:${pos(guess)};--actual:${pos(actual)}" aria-hidden="true">
      <span class="bv-game__band"></span>
      <span class="bv-game__mark is-actual" style="${shift(actual)}"><b>${escapeHtml(t('priceIt.market'))}</b></span>
      <span class="bv-game__mark is-guess ${correct ? 'is-right' : 'is-wrong'}" style="${shift(guess)}"><b>${escapeHtml(t('priceIt.you'))} · ${escapeHtml(fmtMoney(guess, { cents: 0 }))}</b></span>
    </div>`;
}

// Count the market value up from zero (skipped for reduced motion).
function countUp(el, value) {
  if (!el) return;
  const final = fmtMoney(value, { cents: 0 });
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = final; return; }
  const t0 = performance.now();
  const dur = 700;
  const tick = (now) => {
    if (!el.isConnected) return;
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = k < 1 ? fmtMoney(value * (1 - (1 - k) ** 3), { cents: 0 }) : final;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
  const slider = $("#gameRange");
  const range = slider ? { lo: Number(slider.dataset.lo), hi: Number(slider.dataset.hi) } : null;
  const syncSlider = () => { const v = Number(input?.value); if (slider && range && v > 0) slider.value = String(toSlider(v, range)); };
  document.querySelectorAll('.bv-game__steps [data-step]').forEach(b => b.addEventListener('click', () => {
    if (!input || input.disabled) return;
    haptic('light');
    input.value = String(Math.max(1, (Number(input.value) || 0) + Number(b.dataset.step)));
    syncSlider();
  }));
  input?.addEventListener('input', syncSlider);
  let lastTick = -1;
  slider?.addEventListener('input', () => {
    if (!input || input.disabled || !range) return;
    input.value = String(fromSlider(Number(slider.value), range));
    // A light tick every ~5% of travel, so dragging feels like a dial.
    const notch = Math.round(Number(slider.value) / 50);
    if (notch !== lastTick) { lastTick = notch; haptic('light'); }
  });

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
    if (slider) slider.disabled = true;
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
          <span class="bv-game__value"><span class="bv-game__value-label">${escapeHtml(t('priceIt.marketValue'))}</span><span class="bv-game__value-num" id="gameValueNum">${escapeHtml(fmtMoney(0, { cents: 0 }))}</span></span>
          ${meterHTML(guessUsd, Number(out.actual), !!out.correct)}
        </div>
        ${btn(idx + 1 < total ? t('bvCommunity.gameNext') : t('bvCommunity.gameSeeScore'), { id: 'gameNext', full: true, size: 'lg', kind: 'ink' })}`;
      countUp($("#gameValueNum"), out.actual);
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

function tierKey(score, total) {
  if (score >= total - 1) return 'priceIt.tierTop';
  if (score >= Math.ceil(total / 2)) return 'priceIt.tierMid';
  return score > 0 ? 'priceIt.tierLow' : 'priceIt.tierZero';
}

function showSummary(daily, results) {
  const score = results.filter(r => r.correct).length;
  const total = daily.rounds.length;
  const streak = loadJSON(STREAK_KEY) || { streak: 0, best: 0 };
  const sub = $('.bv-game .bv-topbar__sub');
  if (sub) sub.textContent = t('bvCommunity.gameDoneSub');
  const offs = results.map(r => Number(r.pct_off)).filter(Number.isFinite);
  const avgOff = offs.length ? Math.round(offs.reduce((a, b) => a + b, 0) / offs.length) : null;
  const marks = daily.rounds.map(r => { const res = results.find(x => x.set_num === r.set_num); return res ? !!res.correct : null; });
  const rows = daily.rounds.map(r => {
    const res = results.find(x => x.set_num === r.set_num);
    const trail = res ? (res.correct ? pill(t('bvCommunity.gameRight'), 'gain', { icon: 'check' }) : pill(t('bvCommunity.gameOff', { pct: res.pct_off }), 'loss')) : '—';
    const hasImg = r.image_url && !String(r.image_url).startsWith("data:");
    return `<div class="bv-game__row">
        <span class="bv-game__thumb game-set-photo-stage">${brickSvg(`hsl(${setHue(r)} 40% 48%)`)}${hasImg ? `<img class="set-photo" src="${escapeHtml(thumbImg(r.image_url, 120))}" alt="" decoding="async" loading="lazy">` : ''}</span>
        <span class="bv-game__row-text"><span class="bv-game__row-name">${escapeHtml(r.name)}</span><span class="bv-game__row-num">${escapeHtml(r.set_num)}</span></span>${trail}</div>`;
  }).join("");
  const stat = (label, value) => `<div class="bv-game__stat"><span class="bv-game__stat-num">${escapeHtml(String(value))}</span><span class="bv-game__stat-label">${escapeHtml(label)}</span></div>`;
  $("#gameBody").innerHTML = `
    <section class="bv-game__score">
      ${scoreRing(marks, { size: 168, stroke: 14, cls: 'bv-dial--anim', centerHtml: `<span class="bv-dial__score">${score}<small>/${total}</small></span>` })}
      <h2 class="bv-game__tier">${escapeHtml(t(tierKey(score, total)))}</h2>
      <p class="bv-game__next">${icon('clock', { size: 16 })}<span>${escapeHtml(t('priceIt.nextIn', { time: timeToNextGame() }))}</span></p>
      <div class="bv-game__stats">
        ${stat(t('priceIt.statStreak'), streak.streak || 0)}
        ${stat(t('priceIt.statBest'), streak.best || 0)}
        ${stat(t('priceIt.statAvgOff'), avgOff == null ? '—' : `${avgOff}%`)}
      </div>
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
