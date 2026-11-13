import { $, $$, escapeHtml, haptic, toast, celebrate } from '../utils.js';
import { state } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { go } from '../router.js';
import { setModePref, setSkinPref } from '../theme.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { levelForXp, xpForLevel } from '../lib/kids-xp.js';
import { t, tPlural, kidsBadgeLabel, intlLocale } from '../lib/i18n.js';
import { icon, sheetBody } from '../ui/kit.js';
import { setThumb } from '../ui/set-ui.js';
import {
  KIDS_BADGE_GROUPS, computeKidsStats, kidsBadges, newlyEarned, pickDailyQuestion,
  gameValue, findSet, towerFact, kidsTileOrder,
} from '../lib/kids-play.js';

// Kids Mode (#/kids, #/kids/badges, #/kids/set/<num>). Price-free: level and
// XP, today's game, a big "Scan a new set" button, the kid's sets as chunky
// tiles that open a kid set page ("I built it!", favourite, tower fact) and
// the badge shelf. The grown-ups button exits behind the parent PIN.

// Badge slugs from before the play layer keep their existing labels.
const LEGACY_BADGES = new Set(['first_brick', 'junior_builder', 'architect', 'master', 'grand_master', 'legend']);

function badgeLabel(b) {
  if (b.slug.startsWith('fan_')) return b.theme ? t('kidsPlay.fan', { theme: b.theme }) : t('kidsPlay.fanAny');
  if (LEGACY_BADGES.has(b.slug)) return kidsBadgeLabel(b.slug);
  return t(`kidsPlay.badge_${b.slug}`);
}

function badgeToGo(b) {
  const n = Math.max(0, b.target - b.value);
  const key = {
    sets: 'kids.setsToGo', built: 'kidsPlay.toGoBuilt', pieces: 'kidsPlay.toGoPieces', minifigs: 'kidsPlay.toGoFigs',
    themes: 'kidsPlay.toGoThemes', plays: 'kidsPlay.toGoPlays', wins: 'kidsPlay.toGoWins', bestStreak: 'kidsPlay.toGoDays',
    theme: 'kidsPlay.toGoFan',
  }[b.stat] || 'kids.setsToGo';
  return tPlural(key, n, { theme: b.theme || '' });
}

function badgeDot(b, earned, size = 56) {
  return `<span class="bv-kids__badge${earned ? '' : ' is-locked'}" style="--size:${size}px;${earned ? `--bg:${b.bg};` : ''}">${icon(earned ? b.icon : 'lock', { size: Math.round(size * 0.46) })}</span>`;
}

const fmtNum = (n) => Number(n || 0).toLocaleString(intlLocale());

// The kid's local calendar day — the game resets at their midnight.
function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtHeight(meters) {
  const loc = intlLocale();
  const feet = /-US$/i.test(loc) || /^en-(LR|MM)$/i.test(loc);
  const v = feet ? meters * 3.281 : meters;
  const unit = feet ? 'foot' : 'meter';
  const digits = v < 10 ? 1 : 0;
  try {
    return new Intl.NumberFormat(loc, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(v);
  } catch { return `${v.toFixed(digits)} ${feet ? 'ft' : 'm'}`; }
}

function towerLine(pieces, whole) {
  if (!(pieces > 0)) return '';
  const { meters, thing } = towerFact(pieces);
  const lead = t(whole ? 'kidsPlay.towerAll' : 'kidsPlay.towerSet', { height: fmtHeight(meters) });
  const tail = thing ? ` ${t('kidsPlay.towerThing', { thing: t(`kidsPlay.thing_${thing}`) })}` : '';
  return `${lead}${tail}`;
}

// ── Data ───────────────────────────────────────────────────────────────────
// One cache for the three kids screens so tapping between them is instant.
let cache = null;

async function loadKids({ fresh = false } = {}) {
  if (cache && !fresh && Date.now() - cache.at < 60_000) return cache;
  const [coll, ks] = await Promise.all([
    api('/api/collection').catch(() => null),
    api('/api/kids/state').catch(() => null),
  ]);
  const me = state.me || {};
  const xp = Number(ks?.xp ?? me.kids_xp ?? 0);
  cache = {
    at: Date.now(),
    items: coll?.items || [],
    xp,
    level: Number(ks?.level) || levelForXp(xp),
    badges: [...(ks?.badges || me.kids_badges || [])],
    marks: ks?.marks || [],
    plays: ks?.plays || [],
    ok: !!ks,
  };
  return cache;
}

function markFor(setNum) {
  return cache?.marks.find(m => String(m.set_num).toLowerCase() === String(setNum).toLowerCase()) || null;
}

function applyXp(res) {
  if (!cache || !res) return;
  if (Number.isFinite(Number(res.xp))) cache.xp = Number(res.xp);
  else cache.xp += Number(res.xp_gained) || 0;
  cache.level = Number(res.level) || levelForXp(cache.xp);
}

function currentBadges() {
  const stats = computeKidsStats({ items: cache.items, marks: cache.marks, plays: cache.plays, today: localDay() });
  return { stats, badges: kidsBadges(stats, cache.badges) };
}

// Save and celebrate badges the kid just reached. `quiet` skips the big
// celebration (used when a level-up celebration is already showing).
async function syncBadges({ quiet = false } = {}) {
  if (!cache?.ok) return;
  const { badges } = currentBadges();
  const fresh = newlyEarned(badges, cache.badges);
  if (!fresh.length) return;
  cache.badges.push(...fresh);
  api('/api/kids/badges', { method: 'POST', body: { slugs: fresh } }).catch(() => {});
  if (quiet) return;
  const first = badges.find(b => b.slug === fresh[0]);
  const more = fresh.length - 1;
  celebrate(t('kids.badgeCelebration', { badge: badgeLabel(first) }), {
    quip: more > 0 ? tPlural('kidsPlay.moreBadges', more) : t('kids.badgeQuip'),
    hue: 85,
  });
}

function rewardToast(res, { right } = {}) {
  if (!res) return;
  if (res.new_level) {
    celebrate(t('kids.levelCelebration', { level: res.new_level }), { quip: t('kids.levelQuip'), hue: 85 });
    return true;
  }
  if (res.xp_gained > 0) toast(t('common.kidsXp', { xp: res.xp_gained, details: '' }), right === false ? 'info' : 'success');
  return false;
}

// ── Home ───────────────────────────────────────────────────────────────────

function kidsTile(set) {
  const m = markFor(set.set_num);
  const flags = `${m?.favorite ? `<span class="bv-kids__flag bv-kids__flag--fav" aria-label="${escapeHtml(t('kidsPlay.favorite'))}">${icon('heartFill', { size: 16 })}</span>` : ''}${m?.built ? `<span class="bv-kids__flag bv-kids__flag--built" aria-label="${escapeHtml(t('kidsPlay.builtDone'))}">${icon('check', { size: 16, stroke: 3 })}</span>` : ''}`;
  return `<a class="bv-kids__tile" href="#/kids/set/${encodeURIComponent(set.set_num)}">
      ${flags ? `<span class="bv-kids__flags">${flags}</span>` : ''}
      ${setThumb(set, { size: 84, radius: 16 })}
      <span class="bv-kids__tilename">${escapeHtml(set.name || set.set_num)}</span>
      ${set.pieces ? `<span class="bv-kids__tilemeta">${escapeHtml(tPlural('kids.pcs', set.pieces).replace(String(set.pieces), fmtNum(set.pieces)))}</span>` : ''}
    </a>`;
}

function gameValueText(kind, set) {
  const v = gameValue(kind, set);
  if (v == null) return '';
  if (kind === 'pieces') return tPlural('kidsPlay.valPieces', v);
  if (kind === 'older') return t('kidsPlay.valYear', { year: v });
  return tPlural('kidsPlay.valFigs', v);
}

function gameCard() {
  const today = localDay();
  const played = cache.plays.find(p => p.day === today);
  const q = played ? { kind: played.kind, a: played.set_a, b: played.set_b } : pickDailyQuestion(cache.items, today);
  const A = q && findSet(cache.items, q.a), B = q && findSet(cache.items, q.b);
  const kicker = `<span class="bv-kids__gamekick">${icon('game', { size: 18 })}<span>${escapeHtml(t('kidsPlay.gameKicker'))}</span></span>`;
  if (!q || !A || !B) {
    if (played) {
      return `<section class="bv-kids__game is-done" id="kidsGame">${kicker}<p class="bv-kids__gameresult">${escapeHtml(t(played.correct ? 'kidsPlay.gameRightShort' : 'kidsPlay.gameWrongShort'))} ${escapeHtml(t('kidsPlay.gameTomorrow'))}</p></section>`;
    }
    return `<section class="bv-kids__game is-locked" id="kidsGame">${kicker}<p class="bv-kids__gameq">${escapeHtml(t('kidsPlay.gameLocked'))}</p></section>`;
  }
  const question = t({ pieces: 'kidsPlay.gameQPieces', older: 'kidsPlay.gameQOlder', minifigs: 'kidsPlay.gameQMinifigs' }[q.kind]);
  const answer = played ? (played.correct ? played.pick : (String(played.pick).toLowerCase() === String(A.set_num).toLowerCase() ? B.set_num : A.set_num)) : null;
  const pick = (set) => {
    const cls = !played ? '' : (String(set.set_num).toLowerCase() === String(answer).toLowerCase() ? ' is-answer' : (String(set.set_num).toLowerCase() === String(played.pick).toLowerCase() ? ' is-wrong' : ''));
    return `<button type="button" class="bv-kids__pick${cls}" data-pick="${escapeHtml(set.set_num)}"${played ? ' disabled' : ''}>
        ${setThumb(set, { size: 72, radius: 14 })}
        <span class="bv-kids__pickname">${escapeHtml(set.name || set.set_num)}</span>
        ${played ? `<span class="bv-kids__pickval">${escapeHtml(gameValueText(q.kind, set))}</span>` : ''}
      </button>`;
  };
  const streak = computeKidsStats({ plays: cache.plays, today }).streak;
  const result = played
    ? `<p class="bv-kids__gameresult">${escapeHtml(t(played.correct ? 'kidsPlay.gameRightShort' : 'kidsPlay.gameWrongShort'))} ${escapeHtml(t('kidsPlay.gameTomorrow'))}</p>
       ${streak > 1 ? `<p class="bv-kids__streak">${icon('flash', { size: 18 })}<span>${escapeHtml(tPlural('kidsPlay.gameStreak', streak))}</span></p>` : ''}`
    : `<p class="bv-kids__gamehint">${escapeHtml(t('kidsPlay.gameHint'))}</p>`;
  return `<section class="bv-kids__game${played ? ' is-done' : ''}${played?.correct ? ' is-right' : ''}" id="kidsGame">
      ${kicker}
      <h2 class="bv-kids__gameq">${escapeHtml(question)}</h2>
      <div class="bv-kids__picks">${pick(A)}<span class="bv-kids__vs" aria-hidden="true">${escapeHtml(t('kidsPlay.or'))}</span>${pick(B)}</div>
      ${result}
    </section>`;
}

function bindGame() {
  $$('#kidsGame .bv-kids__pick:not([disabled])').forEach(btn => btn.addEventListener('click', async () => {
    const today = localDay();
    const q = pickDailyQuestion(cache.items, today);
    if (!q) return;
    $$('#kidsGame .bv-kids__pick').forEach(b => { b.disabled = true; });
    haptic('light');
    const pick = btn.dataset.pick;
    try {
      const res = await api('/api/kids/game', { method: 'POST', body: { day: today, kind: q.kind, set_a: q.a, set_b: q.b, pick } });
      cache.plays.unshift({ day: today, kind: q.kind, set_a: q.a, set_b: q.b, pick, correct: !!res?.correct });
      applyXp(res);
      haptic(res?.correct ? 'heavy' : 'medium');
      paintHome();
      const leveled = rewardToast(res, { right: !!res?.correct });
      setTimeout(() => syncBadges({ quiet: leveled }), leveled ? 0 : 700);
    } catch (e) {
      if (String(e?.message || '').includes('already_played')) { await loadKids({ fresh: true }); paintHome(); return; }
      toast(t('kidsPlay.oops'), 'error');
      $$('#kidsGame .bv-kids__pick').forEach(b => { b.disabled = false; });
    }
  }));
}

function paintHome() {
  const root = $('#root');
  if (!root || !cache) return;
  const { xp, level } = cache;
  const thisLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(Math.min(level + 1, 10));
  const xpProgress = Math.max(0, Math.min(100, level >= 10 ? 100 : Math.round(((xp - thisLevelXp) / (nextLevelXp - thisLevelXp)) * 100)));
  const { stats, badges } = currentBadges();
  const earned = badges.filter(b => b.earned);
  // Shelf: the newest earned badges, topped up with the next ones to earn.
  const shelf = [...earned.slice(-4).reverse(), ...badges.filter(b => !b.earned)].slice(0, 5)
    .map(b => badgeDot(b, b.earned)).join('');
  const tiles = kidsTileOrder(cache.items, cache.marks).slice(0, 8);
  const tower = towerLine(stats.pieces, true);
  root.innerHTML = `
    <main class="bv-kids">
      <header class="bv-kids__head">
        <span class="bv-kids__who"><span class="bv-kids__level">${escapeHtml(t('bvCommunity.kidsLevel', { level }))}</span><h1 class="bv-kids__title">${escapeHtml(t('bvCommunity.kidsTitle'))}</h1></span>
        <button type="button" class="bv-kids__grownups" id="exitKidsBtn" aria-label="${escapeHtml(t('bvCommunity.kidsExitLabel'))}">${icon('lock', { size: 18 })}<span>${escapeHtml(t('bvCommunity.kidsGrownups'))}</span></button>
      </header>
      <div class="bv-kids__xp">
        <span class="bv-kids__xprow"><span>${escapeHtml(t('kids.xp', { n: xp }))}</span><span>${escapeHtml(level < 10 ? t('kids.xpToLevel', { n: nextLevelXp - xp, level: level + 1 }) : t('kids.maxLevel'))}</span></span>
        <span class="bv-kids__xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${xpProgress}" aria-label="${escapeHtml(t('bvCommunity.kidsXpLabel'))}"><span style="width:${xpProgress}%"></span></span>
      </div>
      ${cache.ok ? gameCard() : ''}
      <a class="bv-kids__scan" href="#/pile" id="kidsScan">${icon('scan', { size: 34, stroke: 2.4 })}<span>${escapeHtml(t('bvCommunity.kidsScan'))}</span></a>
      ${tiles.length ? `<h2 class="bv-kids__h2">${escapeHtml(t('bvCommunity.kidsMySets'))}</h2><div class="bv-kids__tiles">${tiles.map(kidsTile).join('')}</div>`
        : `<p class="bv-kids__empty">${escapeHtml(t('bvCommunity.kidsEmpty'))}</p>`}
      ${tower ? `<p class="bv-kids__fact">${icon('brick', { size: 22 })}<span>${escapeHtml(tPlural('kidsPlay.allPieces', stats.pieces).replace(String(stats.pieces), fmtNum(stats.pieces)))} ${escapeHtml(tower)}</span></p>` : ''}
      <a class="bv-kids__badges" href="#/kids/badges">
        <span class="bv-kids__h2">${escapeHtml(t('bvCommunity.kidsBadges', { n: earned.length, total: badges.length }))}</span>
        <span class="bv-kids__badgerow">${shelf}</span>
      </a>
    </main>`;
  bindExit();
  bindGame();
}

export async function renderKidsHome() {
  if (!state.me) state.me = await api('/api/me').catch(() => null);
  await loadKids({ fresh: true });
  paintHome();
  // Badges reached outside the play layer (a set added, pieces piling up).
  setTimeout(() => syncBadges(), 500);
}

function bindExit() {
  $('#exitKidsBtn')?.addEventListener('click', () => {
    // The PIN gate only exists once a parent actually SET a PIN. Guests can't
    // have a server-side PIN at all, and a signed-in user may have entered Kids
    // (e.g. via the setup wizard) without ever setting one — in both cases
    // there is nothing to verify, so exit freely instead of trapping the user
    // behind a PIN prompt that can never succeed.
    const freeExit = () => {
      hideSheet();
      setModePref('pro');
      setSkinPref('retro');
      state.me = null;
      go('#/');
    };
    if (isGuestMode() || state.me?.has_kids_pin === false) {
      freeExit();
      return;
    }
    showSheet(sheetBody({
      title: 'Exit Kids Mode',
      sub: 'Enter your 4-digit PIN to exit.',
      id: 'kidsExitSheet',
      inner: `<div class="bv-kidspin">
        <input id="exitPinInput" class="bv-kidspin__input" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="off" placeholder="••••" aria-label="${escapeHtml(t('bvCommunity.kidsPinLabel'))}">
        <div id="exitPinErr" class="bv-field__error" role="alert" style="display:none"></div>
        <button type="button" class="bv-btn bv-btn--primary bv-btn--full bv-btn--lg" id="exitPinConfirm"><span>Exit</span></button>
        <button type="button" class="bv-btn bv-btn--text bv-btn--full" id="exitPinForgot"><span>Forgot PIN? Sign out to exit</span></button>
      </div>`,
    }));
    setTimeout(() => $('#exitPinInput')?.focus(), 100);
    // PIN recovery: the PIN protects THIS signed-in session, so signing out is
    // a legitimate parent-level escape — the synced vault is untouched, and the
    // PIN can be reset from Settings after signing back in.
    $('#exitPinForgot')?.addEventListener('click', async () => {
      haptic('medium');
      try {
        const { sbSignOut } = await import('../api.js');
        await sbSignOut();
      } catch { /* best effort — local mode reset below still frees the UI */ }
      hideSheet();
      setModePref('pro');
      setSkinPref('retro');
      state.me = null;
      toast('Signed out. Sign back in and reset the PIN from Settings.', 'info');
      go('#/login');
    });
    $('#exitPinConfirm')?.addEventListener('click', async () => {
      const pin = $('#exitPinInput')?.value || '';
      if (!/^\d{4}$/.test(pin)) {
        const err = $('#exitPinErr');
        if (err) { err.textContent = 'Please enter a 4-digit PIN.'; err.style.display = 'block'; }
        return;
      }
      try {
        const res = await api('/api/me/kids-pin/verify', { method: 'POST', body: { pin } });
        if (res?.ok) {
          freeExit();
        } else {
          const err = $('#exitPinErr');
          if (err) { err.textContent = 'Incorrect PIN. Try again.'; err.style.display = 'block'; }
          haptic('medium');
        }
      } catch (e) {
        // Server says no PIN is configured → nothing to verify, exit freely.
        if (String(e?.message || '').includes('no_pin')) {
          toast('No parent PIN is set — add one in Settings to lock Kids Mode.', 'info');
          freeExit();
          return;
        }
        // Too many wrong PINs: the server says how long the lock lasts. Show
        // it in the sheet instead of a generic error, so a parent knows the
        // correct PIN will work again after the wait.
        const err = $('#exitPinErr');
        if (e?.status === 429 && err) {
          err.textContent = e.message || 'Too many wrong PINs. Wait a few minutes, then try again.';
          err.style.display = 'block';
          return;
        }
        toast(navigator.onLine === false ? 'You are offline. Connect to check the PIN.' : 'Something went wrong. Try again.', 'error');
      }
    });
  });}

// ── Badges ─────────────────────────────────────────────────────────────────

export async function renderKidsBadges() {
  if (!state.me) state.me = await api('/api/me').catch(() => null);
  await loadKids();
  const { badges } = currentBadges();
  const earnedCount = badges.filter(b => b.earned).length;
  const card = (b) => `
      <div class="bv-kids__badgecard${b.earned ? ' is-earned' : ' is-locked'}">
        ${badgeDot(b, b.earned, 72)}
        <span class="bv-kids__badgename">${escapeHtml(badgeLabel(b))}</span>
        <span class="bv-kids__badgesub">${b.earned ? `✓ ${escapeHtml(t('kidsPlay.earned'))}` : escapeHtml(badgeToGo(b))}</span>
      </div>`;
  const sections = KIDS_BADGE_GROUPS.map(g => {
    const list = badges.filter(b => b.group === g);
    if (!list.length) return '';
    return `<h2 class="bv-kids__h2">${escapeHtml(t(`kidsPlay.group_${g}`))}</h2><div class="bv-kids__badgegrid">${list.map(card).join('')}</div>`;
  }).join('');

  const root = $('#root');
  if (!root) return;
  root.innerHTML = `
    <main class="bv-kids bv-kids--badges">
      <header class="bv-kids__head">
        <span class="bv-kids__who"><span class="bv-kids__level">${escapeHtml(tPlural('kids.earned', earnedCount, { total: badges.length }))}</span><h1 class="bv-kids__title">${escapeHtml(t('kidsPlay.myBadges'))}</h1></span>
      </header>
      ${sections}
      <a class="bv-kids__back" href="#/kids">${icon('back', { size: 20 })}<span>${escapeHtml(t('bvCommunity.kidsBack'))}</span></a>
    </main>`;
  syncBadges();
}

// ── Kid set page ───────────────────────────────────────────────────────────

function paintSet(set) {
  const root = $('#root');
  if (!root) return;
  const m = markFor(set.set_num) || {};
  const meta = [set.theme, set.year].filter(Boolean).map(String).join(' · ');
  const chips = [
    set.pieces ? `<span class="bv-kids__chip">${icon('brick', { size: 18 })}<span>${escapeHtml(tPlural('kidsPlay.valPieces', Number(set.pieces)))}</span></span>` : '',
    Number(set.minifigs) > 0 ? `<span class="bv-kids__chip">${icon('fig', { size: 18 })}<span>${escapeHtml(tPlural('kidsPlay.valFigs', Number(set.minifigs)))}</span></span>` : '',
    Number(set.quantity) > 1 ? `<span class="bv-kids__chip">${icon('box', { size: 18 })}<span>${escapeHtml(tPlural('kidsPlay.copies', Number(set.quantity)))}</span></span>` : '',
  ].join('');
  const tower = towerLine(Number(set.pieces) || 0, false);
  root.innerHTML = `
    <main class="bv-kids bv-kids--set">
      <div class="bv-kids__sethero">
        ${setThumb(set, { size: 200, radius: 28 })}
        <h1 class="bv-kids__setname">${escapeHtml(set.name || set.set_num)}</h1>
        ${meta ? `<span class="bv-kids__setmeta">${escapeHtml(meta)}</span>` : ''}
      </div>
      ${chips ? `<div class="bv-kids__chips">${chips}</div>` : ''}
      <div class="bv-kids__actions">
        <button type="button" class="bv-kids__built${m.built ? ' is-on' : ''}" id="kidsBuiltBtn" aria-pressed="${m.built ? 'true' : 'false'}">
          ${icon(m.built ? 'check' : 'hand', { size: 28, stroke: 2.6 })}<span>${escapeHtml(t(m.built ? 'kidsPlay.builtDone' : 'kidsPlay.built'))}</span>
        </button>
        <button type="button" class="bv-kids__fav${m.favorite ? ' is-on' : ''}" id="kidsFavBtn" aria-pressed="${m.favorite ? 'true' : 'false'}" aria-label="${escapeHtml(t('kidsPlay.favorite'))}">
          ${icon(m.favorite ? 'heartFill' : 'heart', { size: 30 })}
        </button>
      </div>
      ${m.built ? '' : `<p class="bv-kids__hint">${escapeHtml(t('kidsPlay.builtHint'))}</p>`}
      ${tower ? `<p class="bv-kids__fact">${icon('sparkle', { size: 22 })}<span>${escapeHtml(tower)}</span></p>` : ''}
      <a class="bv-kids__back" href="#/kids">${icon('back', { size: 20 })}<span>${escapeHtml(t('bvCommunity.kidsBack'))}</span></a>
    </main>`;

  const mark = async (patch) => {
    const btns = [$('#kidsBuiltBtn'), $('#kidsFavBtn')];
    btns.forEach(b => b && (b.disabled = true));
    try {
      const res = await api('/api/kids/mark', { method: 'POST', body: { set_num: set.set_num, ...patch } });
      const i = cache.marks.findIndex(x => String(x.set_num).toLowerCase() === String(set.set_num).toLowerCase());
      const next = { set_num: set.set_num, built: !!res?.built, favorite: !!res?.favorite };
      if (i >= 0) cache.marks[i] = next; else cache.marks.push(next);
      applyXp(res);
      paintSet(set);
      return res;
    } catch {
      toast(t('kidsPlay.oops'), 'error');
      btns.forEach(b => b && (b.disabled = false));
      return null;
    }
  };
  $('#kidsBuiltBtn')?.addEventListener('click', async () => {
    haptic('medium');
    const res = await mark({ built: !m.built });
    if (res?.built) {
      const leveled = rewardToast(res);
      setTimeout(() => syncBadges({ quiet: leveled }), leveled ? 0 : 600);
    }
  });
  $('#kidsFavBtn')?.addEventListener('click', () => { haptic('light'); mark({ favorite: !m.favorite }); });
}

export async function renderKidsSet(setNum) {
  if (!state.me) state.me = await api('/api/me').catch(() => null);
  await loadKids();
  let set = findSet(cache.items, setNum);
  if (!set) { await loadKids({ fresh: true }); set = findSet(cache.items, setNum); }
  if (!set) {
    const root = $('#root');
    if (root) root.innerHTML = `<main class="bv-kids"><p class="bv-kids__empty">${escapeHtml(t('kidsPlay.setNotFound'))}</p><a class="bv-kids__back" href="#/kids">${icon('back', { size: 20 })}<span>${escapeHtml(t('bvCommunity.kidsBack'))}</span></a></main>`;
    return;
  }
  paintSet(set);
}
