// Leaderboard (#/leaderboard) and public profiles (#/u/:handle) — 2026
// redesign. The leaderboard ranks opted-in public collections by value, by
// set count or by 30-day change; a private collector sees where they would
// land. A public profile shows only what its owner exposes; the owner can
// preview it before going public.
import { $, $$, escapeHtml, haptic, toast, publicOrigin, themeHue, THEME_COLORS, fmtMoneyShort } from '../utils.js';
import { state } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { t, tPlural, intlLocale } from '../lib/i18n.js';
import { topbar, seg, iconBtn, btn, banner, bar, emptyState, skeletonRows, icon, sectionTitle, pill, delta } from '../ui/kit.js';
import { setThumb, money0 } from '../ui/set-ui.js';
import { displayValueOf } from '../lib/pure.js';

const CACHE_PREFIX = 'bv_leaderboard_cache_v2:';
const CACHE_MS = 5 * 60 * 1000;
const SORTS = ['value', 'sets', 'rising'];
const SORT_LABEL = { value: 'bvCommunity.byValue', sets: 'bvCommunity.bySets', rising: 'bvCommunity.byRising' };
const onLeaderboard = () => location.hash.split('?')[0] === '#/leaderboard';

const num = (n) => Number(n || 0).toLocaleString(intlLocale());
function compact(n) {
  try { return new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0); }
  catch { return num(n); }
}
function initial(name) {
  const ch = String(name || '?').trim().replace(/^@/, '').charAt(0);
  return (ch || '?').toUpperCase();
}
function back() { if (history.length > 1) history.back(); else location.hash = '#/me'; }

function readCache(sort) {
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + sort) || 'null');
    return c?.ts && Date.now() - c.ts < CACHE_MS && Array.isArray(c.data?.leaders) ? c.data : null;
  } catch { return null; }
}
function writeCache(sort, data) {
  try { sessionStorage.setItem(CACHE_PREFIX + sort, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

/* ============================================================
   Leaderboard
   ============================================================ */

// Who is looking: a guest, a private collector (or one hiding their value),
// or someone already on the board.
function viewer() {
  const me = state.me || {};
  if (isGuestMode() || me.is_guest) return { kind: 'guest' };
  const stats = me.portfolio_stats || {};
  const listed = !!(me.is_public && me.expose_public_value !== false && me.handle);
  return { kind: listed ? 'listed' : 'private', handle: me.handle || null, value: Number(stats.total_value) || 0, sets: Number(stats.set_count) || 0 };
}

function leaderboardURL(sort, who) {
  const q = new URLSearchParams({ sort });
  if (who.kind === 'private') {
    if (sort === 'value' && who.value > 0) q.set('value', String(Math.round(who.value)));
    if (sort === 'sets' && who.sets > 0) q.set('sets', String(who.sets));
  }
  return `/api/users/leaderboard?${q}`;
}

function leaderRow(l, sort, mine) {
  const top = l.rank <= 3;
  const sets = tPlural('bvCommunity.sets', l.set_count, { count: num(l.set_count) });
  const value = money0(l.total_value);
  const sub = sort === 'value' ? sets : sort === 'sets' ? value : `${value} · ${sets}`;
  const trail = sort === 'rising'
    ? delta(l.change_30d_pct, { srUp: t('bvCommon.upPct', { pct: Math.abs(l.change_30d_pct ?? 0).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(l.change_30d_pct ?? 0).toFixed(1) }) })
    : `<span class="bv-lbrow__val">${escapeHtml(sort === 'sets' ? num(l.set_count) : value)}</span>`;
  const star = l.is_supporter ? `<span class="bv-lbrow__pro" title="${escapeHtml(t('bvCommunity.pro'))}">${icon('star', { size: 14, stroke: 2.4 })}<span class="bv-sr">${escapeHtml(t('bvCommunity.pro'))}</span></span>` : '';
  return `<a class="bv-lbrow lb-row${mine ? ' is-me' : ''}" href="#/u/${encodeURIComponent(l.handle)}">
    <span class="bv-lbrow__rank${top ? ' is-top' : ''}">${l.rank}</span>
    <span class="bv-avatar" aria-hidden="true">${escapeHtml(initial(l.handle))}</span>
    <span class="bv-lbrow__text"><span class="bv-lbrow__handle">@${escapeHtml(l.handle)}${star}${mine ? ` ${pill(t('bvCommunity.you'), 'acc')}` : ''}</span><span class="bv-lbrow__sub">${escapeHtml(sub)}</span></span>
    ${trail}
  </a>`;
}

function boardHTML(data, sort, who) {
  const leaders = data?.leaders || [];
  if (!leaders.length) {
    return emptyState({
      icon: sort === 'rising' ? 'trend' : 'trophy',
      title: t(sort === 'rising' ? 'bvCommunity.risingEmptyTitle' : 'bvCommunity.emptyTitle'),
      body: t(sort === 'rising' ? 'bvCommunity.risingEmptyBody' : 'bvCommunity.emptyBody'),
    });
  }
  const rows = leaders.map((l) => leaderRow(l, sort, who.kind === 'listed' && l.handle === who.handle)).join('');
  const more = data.total > leaders.length ? `<p class="bv-lb__more">${escapeHtml(t('bvCommunity.topOf', { shown: num(leaders.length), total: num(data.total) }))}</p>` : '';
  return `<div class="bv-lb__list">${rows}</div>${more}`;
}

function joinBarHTML(data, sort, who) {
  if (who.kind === 'listed') return '';
  if (who.kind === 'guest') {
    return `<div class="bv-lbbar" id="lbJoinBar"><span class="bv-lbbar__text"><span class="bv-lbbar__title">${escapeHtml(t('bvCommunity.joinTitle'))}</span><span class="bv-lbbar__sub">${escapeHtml(t('bvCommunity.joinGuest'))}</span></span>${btn(t('bvCommunity.signIn'), { href: '#/login', id: 'lbSignIn' })}</div>`;
  }
  const title = data?.would_rank && data?.total != null && sort !== 'rising'
    ? t('bvCommunity.wouldBe', { rank: num(data.would_rank), total: num(data.total + 1) })
    : t('bvCommunity.joinTitle');
  const me = state.me || {};
  const sub = !me.handle ? t('bvCommunity.noHandle') : me.is_public ? t('bvCommunity.valueHidden') : t('bvCommunity.private');
  return `<div class="bv-lbbar" id="lbJoinBar"><span class="bv-lbbar__text"><span class="bv-lbbar__title">${escapeHtml(title)}</span><span class="bv-lbbar__sub">${escapeHtml(sub)}</span></span>${btn(t('bvCommunity.goPublic'), { href: '#/me?sheet=public', id: 'lbGoPublic' })}</div>`;
}

function sortFromHash() {
  const s = new URLSearchParams(location.hash.split('?')[1] || '').get('sort');
  return SORTS.includes(s) ? s : 'value';
}

export async function renderLeaderboard() {
  let sort = sortFromHash();
  const who = viewer();
  const subKey = { value: 'bvCommunity.subValue', sets: 'bvCommunity.subSets', rising: 'bvCommunity.subRising' };

  const paint = (data, loading = false) => {
    const root = $('#root');
    if (!root || !onLeaderboard()) return;
    root.innerHTML = `<main class="bv-page bv-lb${who.kind !== 'listed' ? ' has-lbbar' : ''}">
      ${topbar({ title: t('bvCommunity.leaderboard'), sub: t(subKey[sort]), back: 'history' })}
      <div class="bv-lb__seg">${seg(SORTS.map((s) => ({ label: t(SORT_LABEL[s]), value: s, current: s === sort, attrs: { 'data-lb-sort': s } })), { label: t('bvCommunity.rankBy'), id: 'lbSort' })}</div>
      <div id="lbBody" aria-busy="${loading ? 'true' : 'false'}">${loading ? `<div class="bv-lb__list">${skeletonRows(6)}</div>` : boardHTML(data, sort, who)}</div>
      ${loading ? '' : joinBarHTML(data, sort, who)}
    </main>`;
    $('[data-bv-back]')?.addEventListener('click', back);
    $$('[data-lb-sort]').forEach((b) => b.addEventListener('click', () => {
      const next = b.dataset.lbSort;
      if (next === sort) return;
      haptic('light');
      sort = next;
      history.replaceState(null, '', next === 'value' ? '#/leaderboard' : `#/leaderboard?sort=${next}`);
      load();
    }));
  };

  const load = async () => {
    // A tab switch mid-fetch changes `sort`; a late answer for the old tab
    // still fills its own cache but never paints under the new tab.
    const want = sort;
    const cached = readCache(want);
    paint(cached, !cached);
    try {
      const url = (window.WORKER_BASE || '') + leaderboardURL(want, who);
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      writeCache(want, data);
      if (want === sort) paint(data);
    } catch {
      if (cached || want !== sort) return;
      const body = $('#lbBody');
      if (!body || !onLeaderboard()) return;
      body.setAttribute('aria-busy', 'false');
      body.innerHTML = emptyState({ icon: 'cloudOff', title: t('bvCommunity.loadFailedTitle'), body: t('bvCommunity.loadFailedBody'), actionsHtml: btn(t('bvCommunity.retry'), { kind: 'tonal', id: 'lbRetry' }), role: 'alert' });
      $('#lbRetry')?.addEventListener('click', load);
    }
  };
  await load();
}

/* ============================================================
   Public collection profile
   ============================================================ */

async function fetchProfile(handle) {
  const own = !isGuestMode() && state.me?.handle && state.me.handle.toLowerCase() === String(handle).toLowerCase();
  // The owner asks with their session so a private profile comes back as a
  // preview; everyone else gets the anonymous, cacheable response.
  if (own) {
    try { return await api(`/api/users/${encodeURIComponent(handle)}/profile`); } catch { /* fall through */ }
  }
  const r = await fetch((window.WORKER_BASE || '') + `/api/users/${encodeURIComponent(handle)}/profile`);
  if (r.status === 404) { const e = new Error('not-found'); e.code = 404; throw e; }
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

function identityHTML(p) {
  const showVal = p.expose_public_value !== false && p.total_value != null;
  const meta = [
    p.approved_contributions > 0 ? `${icon('star', { size: 14, stroke: 2.4 })}${escapeHtml(t('bvCommunity.contributor'))}` : '',
    p.is_supporter ? escapeHtml(t('bvCommunity.pro')) : '',
    p.collecting_since ? escapeHtml(t('bvCommunity.since', { year: p.collecting_since })) : '',
  ].filter(Boolean).join(' · ');
  const valueLabel = p.is_owner ? t(showVal ? 'bvCommunity.valueShown' : 'bvCommunity.valueHiddenShort') : t('bvCommunity.value');
  return `<section class="bv-card bv-pubcard">
    <div class="bv-pubcard__who">
      <span class="bv-avatar bv-avatar--lg" aria-hidden="true">${escapeHtml(initial(p.display_name || p.handle))}</span>
      <span class="bv-pubcard__text"><span class="bv-pubcard__name">${escapeHtml(p.display_name || p.handle)}</span>${meta ? `<span class="bv-pubcard__meta">${meta}</span>` : ''}</span>
    </div>
    <div class="bv-pubstats">
      <span class="bv-pubstat"><span class="bv-pubstat__num">${escapeHtml(num(p.set_count))}</span><span class="bv-pubstat__lbl">${escapeHtml(tPlural('bvCommunity.setsLabel', p.set_count))}</span></span>
      <span class="bv-pubstat"><span class="bv-pubstat__num">${showVal ? escapeHtml(Number(p.total_value) >= 10000 ? fmtMoneyShort(p.total_value) : money0(p.total_value)) : '—'}</span><span class="bv-pubstat__lbl">${escapeHtml(valueLabel)}</span></span>
      <span class="bv-pubstat"><span class="bv-pubstat__num">${escapeHtml(p.piece_count != null ? compact(p.piece_count) : '—')}</span><span class="bv-pubstat__lbl">${escapeHtml(t('bvCommunity.pieces'))}</span></span>
    </div>
  </section>`;
}

function shelfHTML(p) {
  const sets = p.showcase || [];
  const showVal = p.expose_public_value !== false;
  if (!sets.length && !p.is_owner) {
    return `${sectionTitle(t('bvCommunity.shelf'))}<p class="bv-pub__note public-showcase-empty">${escapeHtml(t('bvCommunity.shelfEmpty'))}</p>`;
  }
  const tiles = sets.map((s) => `<a class="bv-trophy trophy-card" href="#/set/${encodeURIComponent(s.set_num)}">
      ${setThumb(s, { size: 56, radius: 12 })}
      <span class="bv-trophy__name">${escapeHtml(s.name || s.set_num)}</span>
      ${showVal ? `<span class="bv-trophy__val">${escapeHtml(money0(displayValueOf(s)))}</span>` : ''}
    </a>`);
  if (p.is_owner) {
    for (let i = sets.length; i < 6; i++) tiles.push(`<a class="bv-trophy bv-trophy--add" href="#/me?sheet=public" aria-label="${escapeHtml(t('bvCommunity.addToShelf'))}">${icon('plus')}</a>`);
  }
  return `${sectionTitle(t('bvCommunity.shelfCount', { count: sets.length, max: 6 }))}<div class="bv-trophies">${tiles.join('')}</div>`;
}

function themesHTML(p) {
  const themes = (p.top_themes || []).filter((x) => x.value != null);
  if (p.expose_public_value === false || themes.length < 2) return '';
  const total = themes.reduce((s, x) => s + (Number(x.value) || 0), 0) || 1;
  const rows = themes.map((x) => {
    const pct = Math.round((Number(x.value) || 0) / total * 100);
    const color = THEME_COLORS[x.theme] || `oklch(0.6 0.16 ${themeHue(x.theme || '')})`;
    return `<div class="bv-themebar"><span class="bv-themebar__name">${escapeHtml(x.theme || t('bvCommunity.otherTheme'))}</span><span class="bv-themebar__pct">${pct}%</span><span class="bv-themebar__bar" style="--c:${escapeHtml(color)}">${bar(pct, { label: `${x.theme || ''} ${pct}%` })}</span></div>`;
  }).join('');
  return `${sectionTitle(t('bvCommunity.topThemes'))}<section class="bv-card bv-themebars">${rows}</section>`;
}

export async function renderPublicProfile(handle) {
  const root = $('#root');
  if (!root) return;
  const onProfile = () => location.hash.split('?')[0] === `#/u/${handle}`;
  let p;
  try {
    p = await fetchProfile(handle);
  } catch (err) {
    if (!onProfile()) return;
    const missing = err?.code === 404;
    root.innerHTML = `<main class="bv-page bv-pub">
      ${topbar({ title: `@${handle}`, back: 'history' })}
      ${emptyState({ icon: missing ? 'lock' : 'cloudOff', title: t(missing ? 'bvCommunity.notFoundTitle' : 'bvCommunity.loadFailedTitle'), body: t(missing ? 'bvCommunity.notFoundBody' : 'bvCommunity.loadFailedBody'), actionsHtml: btn(t('bvCommunity.leaderboard'), { href: '#/leaderboard', kind: 'tonal' }) })}
    </main>`;
    $('[data-bv-back]')?.addEventListener('click', back);
    return;
  }
  if (!onProfile()) return;
  const canShare = p.is_public !== false;
  const sub = p.is_owner ? t(p.is_public === false ? 'bvCommunity.previewSub' : 'bvCommunity.yourProfileSub') : t('bvCommunity.publicProfile');
  root.innerHTML = `<main class="bv-page bv-pub">
    ${topbar({ title: `@${p.handle || handle}`, sub, back: 'history', actionsHtml: canShare ? iconBtn({ icon: 'share', label: t('bvCommunity.shareLink'), id: 'pubShare' }) : '' })}
    ${p.is_owner && p.is_public === false ? banner({ icon: 'globe', kind: 'info', text: t('bvCommunity.previewBanner'), action: t('bvCommunity.turnOn'), actionHref: '#/me?sheet=public', id: 'pubPreviewBanner' }) : ''}
    ${identityHTML(p)}
    ${shelfHTML(p)}
    ${themesHTML(p)}
  </main>`;
  $('[data-bv-back]')?.addEventListener('click', back);
  $('#pubShare')?.addEventListener('click', async () => {
    haptic('light');
    const url = `${publicOrigin()}/#/u/${encodeURIComponent(p.handle || handle)}`;
    const { shareContent } = await import('../lib/native-share.js');
    const res = await shareContent({ title: t('bvCommunity.shareTitle', { name: p.display_name || p.handle }), url });
    if (res === 'unsupported') {
      try { await navigator.clipboard.writeText(url); toast(t('bvCommunity.linkCopied'), 'success'); } catch { /* nothing else to try */ }
    }
  });
}
