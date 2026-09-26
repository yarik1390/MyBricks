import { $, escapeHtml, haptic, toast } from '../utils.js';
import { state } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { go } from '../router.js';
import { setModePref, setSkinPref } from '../theme.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { BADGE_DEFS, levelForXp, xpForLevel } from '../lib/kids-xp.js';
import { t, tPlural, kidsBadgeLabel, intlLocale } from '../lib/i18n.js';
import { icon, sheetBody } from '../ui/kit.js';
import { setThumb } from '../ui/set-ui.js';

// Kids Mode (#/kids, #/kids/badges) — 2026 redesign. Price-free: level and
// XP, a big "Scan a new set" button, the newest sets as chunky 72dp+ tiles and
// the badge row. The grown-ups button exits behind the parent PIN.

// Badge art: an icon on a bright circle (earned) or a lock (not yet).
const BADGE_ART = {
  first_brick: ['brick', '#ffda47'], junior_builder: ['star', '#9fd3a8'], architect: ['grid', '#a9c9f0'],
  master: ['trophy', '#ffb870'], grand_master: ['trophy', '#f4a3a3'], legend: ['sparkle', '#d3b8f5'],
};

function badgeDot(b, earned, size = 56) {
  const [ico, bg] = BADGE_ART[b.slug] || ['star', '#ffda47'];
  return `<span class="bv-kids__badge${earned ? '' : ' is-locked'}" style="--size:${size}px;${earned ? `--bg:${bg};` : ''}">${icon(earned ? ico : 'lock', { size: Math.round(size * 0.46) })}</span>`;
}

function kidsTile(set) {
  // Display-only: set detail is blocked in kids mode (it shows prices).
  return `<div class="bv-kids__tile">
      ${setThumb(set, { size: 84, radius: 16 })}
      <span class="bv-kids__tilename">${escapeHtml(set.name || set.set_num)}</span>
      ${set.pieces ? `<span class="bv-kids__tilemeta">${escapeHtml(tPlural('kids.pcs', set.pieces).replace(String(set.pieces), Number(set.pieces).toLocaleString(intlLocale())))}</span>` : ''}
    </div>`;
}

export async function renderKidsHome() {
  if (!state.me) {
    state.me = await api('/api/me').catch(() => null);
  }
  const me = state.me || {};
  const xp = me.kids_xp || 0;
  const level = me.kids_level || levelForXp(xp);
  const badges = me.kids_badges || [];

  const thisLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(Math.min(level + 1, 10));
  const xpProgress = level >= 10 ? 100 : Math.round(((xp - thisLevelXp) / (nextLevelXp - thisLevelXp)) * 100);

  let items = [];
  try {
    const coll = await api('/api/collection?limit=8');
    items = coll?.items || [];
  } catch {}

  const root = $('#root');
  if (!root) return;
  const earned = new Set(badges);
  const shelf = BADGE_DEFS.slice(0, 4).map(b => badgeDot(b, earned.has(b.slug))).join('');
  root.innerHTML = `
    <main class="bv-kids">
      <header class="bv-kids__head">
        <span class="bv-kids__who"><span class="bv-kids__level">${escapeHtml(t('bvCommunity.kidsLevel', { level }))}</span><h1 class="bv-kids__title">${escapeHtml(t('bvCommunity.kidsTitle'))}</h1></span>
        <button type="button" class="bv-kids__grownups" id="exitKidsBtn" aria-label="${escapeHtml(t('bvCommunity.kidsExitLabel'))}">${icon('lock', { size: 18 })}<span>${escapeHtml(t('bvCommunity.kidsGrownups'))}</span></button>
      </header>
      <div class="bv-kids__xp">
        <span class="bv-kids__xprow"><span>${escapeHtml(t('kids.xp', { n: xp }))}</span><span>${escapeHtml(level < 10 ? t('kids.xpToLevel', { n: nextLevelXp - xp, level: level + 1 }) : t('kids.maxLevel'))}</span></span>
        <span class="bv-kids__xpbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0, Math.min(100, xpProgress))}" aria-label="${escapeHtml(t('bvCommunity.kidsXpLabel'))}"><span style="width:${Math.max(0, Math.min(100, xpProgress))}%"></span></span>
      </div>
      <a class="bv-kids__scan" href="#/pile" id="kidsScan">${icon('scan', { size: 34, stroke: 2.4 })}<span>${escapeHtml(t('bvCommunity.kidsScan'))}</span></a>
      ${items.length ? `<h2 class="bv-kids__h2">${escapeHtml(t('bvCommunity.kidsMySets'))}</h2><div class="bv-kids__tiles">${items.map(kidsTile).join('')}</div>`
        : `<p class="bv-kids__empty">${escapeHtml(t('bvCommunity.kidsEmpty'))}</p>`}
      <a class="bv-kids__badges" href="#/kids/badges">
        <span class="bv-kids__h2">${escapeHtml(t('bvCommunity.kidsBadges', { n: earned.size, total: BADGE_DEFS.length }))}</span>
        <span class="bv-kids__badgerow">${shelf}</span>
      </a>
    </main>`;

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
        toast('Something went wrong. Try again.', 'error');
      }
    });
  });
}

export async function renderKidsBadges() {
  if (!state.me) {
    state.me = await api('/api/me').catch(() => null);
  }
  const me = state.me || {};
  const earnedSlugs = new Set(me.kids_badges || []);
  const xp = me.kids_xp || 0;
  const setCount = Math.floor(xp / 10);

  const badgeCards = BADGE_DEFS.map(b => {
    const earned = earnedSlugs.has(b.slug);
    const needed = Math.max(0, b.threshold - setCount);
    return `
      <div class="bv-kids__badgecard${earned ? ' is-earned' : ' is-locked'}">
        ${badgeDot(b, earned, 72)}
        <span class="bv-kids__badgename">${escapeHtml(kidsBadgeLabel(b.slug) || b.label)}</span>
        <span class="bv-kids__badgesub">${earned ? '✓ Earned!' : escapeHtml(tPlural('kids.setsToGo', needed))}</span>
      </div>`;
  }).join('');

  const root = $('#root');
  if (!root) return;
  root.innerHTML = `
    <main class="bv-kids bv-kids--badges">
      <header class="bv-kids__head">
        <span class="bv-kids__who"><span class="bv-kids__level">${escapeHtml(tPlural('kids.earned', earnedSlugs.size, { total: BADGE_DEFS.length }))}</span><h1 class="bv-kids__title">My Badges</h1></span>
      </header>
      <div class="bv-kids__badgegrid">${badgeCards}</div>
      <a class="bv-kids__back" href="#/kids">${icon('back', { size: 20 })}<span>${escapeHtml(t('bvCommunity.kidsBack'))}</span></a>
    </main>`;
}
