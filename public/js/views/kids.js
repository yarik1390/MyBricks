import { $, escapeHtml, haptic, toast } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { go } from '../router.js';
import { setModePref, setSkinPref } from '../theme.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { BADGE_DEFS, levelForXp, xpForLevel } from '../lib/kids-xp.js';

function renderSetCardKids(set) {
  const img = set.image_url
    ? `<img src="${escapeHtml(set.image_url)}" alt="${escapeHtml(set.name)}" loading="lazy" width="120" height="90" class="set-card-img">`
    : `<div class="set-card-img set-card-img-empty"></div>`;
  return `
    <a href="#/set/${encodeURIComponent(set.set_num)}" class="set-card kids-set-card">
      ${img}
      <div class="set-card-body">
        <div class="set-card-name">${escapeHtml(set.name)}</div>
        <div class="set-card-meta">${escapeHtml(set.theme || '')} · ${set.pieces ? set.pieces + ' pcs' : ''}</div>
      </div>
    </a>`;
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
          <div class="kids-xp-label">${xp} XP${level < 10 ? ` · ${nextLevelXp - xp} XP to Level ${level + 1}` : ' · Max Level!'}</div>
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
        <a href="#/kids/badges" style="font-size:13px;color:var(--accent)">View all →</a>
      </div>

      ${setGrid}

      <div style="margin-top:32px;text-align:center">
        <button class="btn-ghost" id="exitKidsBtn" style="color:var(--ink-mute);font-size:14px">
          ${I.gear()} Exit Kids Mode
        </button>
      </div>
    </div>`;

  $('#exitKidsBtn')?.addEventListener('click', () => {
    showSheet(`
      <h2 class="u-serif-h">Exit Kids Mode</h2>
      <p style="color:var(--ink-mute);margin-bottom:16px">Enter your 4-digit PIN to exit.</p>
      <input id="exitPinInput" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*"
        placeholder="••••" style="font-size:28px;text-align:center;letter-spacing:8px;width:100%;margin-bottom:12px"
        class="input">
      <div id="exitPinErr" style="color:var(--down);font-size:13px;margin-bottom:10px;display:none"></div>
      <button class="btn-primary" id="exitPinConfirm" style="width:100%">Exit</button>
    `);
    setTimeout(() => $('#exitPinInput')?.focus(), 100);
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
          hideSheet();
          setModePref('pro');
          setSkinPref('retro');
          state.me = null;
          go('#/');
        } else {
          const err = $('#exitPinErr');
          if (err) { err.textContent = 'Incorrect PIN. Try again.'; err.style.display = 'block'; }
          haptic('medium');
        }
      } catch {
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
        <div class="badge-sub">${earned ? '✓ Earned!' : needed === 1 ? '1 set to go!' : `${needed} sets to go`}</div>
      </div>`;
  }).join('');

  const root = $('#root');
  if (!root) return;
  root.innerHTML = `
    <div class="page">
      <div class="page-header" style="margin-bottom:20px">
        <h1 style="font-size:22px;font-weight:800">My Badges</h1>
        <p style="color:var(--ink-mute);font-size:14px">${earnedSlugs.size} of ${BADGE_DEFS.length} earned</p>
      </div>
      <div class="kids-badge-grid">${badgeCards}</div>
      <div style="margin-top:28px;text-align:center">
        <a href="#/kids" style="font-size:14px;color:var(--accent)">← Back to Vault</a>
      </div>
    </div>`;
}
