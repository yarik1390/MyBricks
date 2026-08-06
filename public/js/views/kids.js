import { $, escapeHtml, haptic, toast, setHue } from '../utils.js';
import { state } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { go } from '../router.js';
import { setModePref, setSkinPref } from '../theme.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { BADGE_DEFS, levelForXp, xpForLevel } from '../lib/kids-xp.js';
import { t, tPlural } from '../lib/i18n.js';

function renderSetCardKids(set) {
  // Mirror the catalog card image structure so photos hydrate and size correctly:
  // a .set-card-img frame holding a brick-tile placeholder + a .set-photo image
  // (app.js adds .photo-loaded on load to reveal the photo).
  const hasImg = set.image_url && !String(set.image_url).startsWith('data:');
  const h = setHue(set);
  // Non-link: set detail is blocked in kids mode (would bounce to /kids), so the
  // card is display-only — image + name + facts, no price.
  return `
    <div class="set-card kids-set-card">
      <div class="set-card-img${hasImg ? ' has-photo' : ''}">
        <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(set.image_url)}" alt="${escapeHtml(set.name || '')}" loading="lazy" decoding="async">` : ''}
      </div>
      <div class="set-card-body">
        <div class="set-card-name">${escapeHtml(set.name)}</div>
        <div class="set-card-meta">${escapeHtml(set.theme || '')} · ${set.pieces ? tPlural('kids.pcs', set.pieces) : ''}</div>
      </div>
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
  const setCount = me.portfolio_stats?.set_count || 0;

  // XP bar calculation
  const thisLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(Math.min(level + 1, 10));
  const xpProgress = level >= 10
    ? 100
    : Math.round(((xp - thisLevelXp) / (nextLevelXp - thisLevelXp)) * 100);

  // Earned badge shelf (up to 3)
  const earnedDefs = BADGE_DEFS.filter(b => badges.includes(b.slug));
  const badgeShelfHTML = earnedDefs.length > 0
    ? earnedDefs.slice(0, 3).map(b => `
        <div class="badge-card earned">
          <div class="badge-emoji">${b.emoji}</div>
          <div class="badge-label">${escapeHtml(b.label)}</div>
        </div>`).join('')
    : `<div class="badge-card locked"><div class="badge-emoji">🔒</div><div class="badge-label">Add your first set!</div></div>`;

  // Fetch recent sets
  let setGrid = '';
  try {
    const coll = await api('/api/collection?limit=8');
    const items = coll?.items || [];
    if (items.length > 0) {
      setGrid = `
        <div class="kids-section-title">My Collection</div>
        <div class="grid">${items.map(renderSetCardKids).join('')}</div>`;
    }
  } catch {}

  const root = $('#root');
  if (!root) return;
  root.innerHTML = `
    <div class="page">
      <div class="kids-hero">
        <div class="kids-level-orb">
          <span>${level}</span>
          <span style="font-size:11px;font-weight:600;opacity:.6">LVL</span>
        </div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:18px;margin-bottom:4px">
            ${escapeHtml(me.display_name || 'Builder')}
          </div>
          <div class="kids-xp-bar-wrap">
            <div class="kids-xp-bar" style="width:${xpProgress}%"></div>
          </div>
          <div class="kids-xp-label">${t('kids.xp', { n: xp })}${level < 10 ? ` · ${t('kids.xpToLevel', { n: nextLevelXp - xp, level: level + 1 })}` : ` · ${t('kids.maxLevel')}`}</div>
        </div>
      </div>

      <div class="kids-stats">
        <div class="kids-stat">
          <span class="kids-stat-n">${setCount}</span>
          <span class="kids-stat-l">Sets</span>
        </div>
        <div class="kids-stat">
          <span class="kids-stat-n">${badges.length}</span>
          <span class="kids-stat-l">Badges</span>
        </div>
        <div class="kids-stat">
          <span class="kids-stat-n">${level}</span>
          <span class="kids-stat-l">Level</span>
        </div>
      </div>

      <div class="kids-section-title">My Badges</div>
      <div class="kids-badge-shelf">${badgeShelfHTML}</div>
      <div style="text-align:right;margin-top:6px">
        <a href="#/kids/badges" style="font-size:13px;font-weight:700;color:var(--accent-text);text-decoration:underline;text-underline-offset:2px;">View all →</a>
      </div>

      ${setGrid}

      <div style="margin-top:32px;text-align:center">
        <button class="btn-ghost" id="exitKidsBtn" style="color:var(--ink-mute);font-size:14px">
          ${I.gear()} Exit Kids Mode
        </button>
      </div>
    </div>`;

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
    if (isGuestMode() || (state.me && state.me.has_kids_pin === false)) {
      freeExit();
      return;
    }
    showSheet(`
      <h2 class="u-serif-h">Exit Kids Mode</h2>
      <p style="color:var(--ink-mute);margin-bottom:16px">Enter your 4-digit PIN to exit.</p>
      <input id="exitPinInput" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
        placeholder="••••" style="font-size:28px;text-align:center;letter-spacing:8px;width:100%;margin-bottom:12px"
        class="input">
      <div id="exitPinErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
      <button class="btn-primary" id="exitPinConfirm" style="width:100%">Exit</button>
      <button class="btn-ghost" id="exitPinForgot" style="width:100%;margin-top:8px;font-size:13px;color:var(--ink-mute)">Forgot PIN? Sign out to exit</button>
    `);
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
      <div class="badge-card ${earned ? 'earned' : 'locked'}">
        <div class="badge-emoji">${b.emoji}</div>
        <div class="badge-label">${escapeHtml(b.label)}</div>
        <div class="badge-sub">${earned ? '✓ Earned!' : tPlural('kids.setsToGo', needed)}</div>
      </div>`;
  }).join('');

  const root = $('#root');
  if (!root) return;
  root.innerHTML = `
    <div class="page">
      <div class="page-header" style="margin-bottom:20px">
        <h1 style="font-size:22px;font-weight:800">My Badges</h1>
        <p style="color:var(--ink-mute);font-size:14px">${tPlural('kids.earned', earnedSlugs.size, { total: BADGE_DEFS.length })}</p>
      </div>
      <div class="kids-badge-grid">${badgeCards}</div>
      <div style="margin-top:28px;text-align:center">
        <a href="#/kids" style="font-size:14px;font-weight:700;color:var(--accent-text);text-decoration:underline;text-underline-offset:2px;">← Back to Vault</a>
      </div>
    </div>`;
}
