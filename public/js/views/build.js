import { $, $$, escapeHtml, haptic, toast, debounce, SEARCH_DEBOUNCE_MS, mount } from '../utils.js';
import { api, getSessionUserId, isGuestMode } from '../api.js';
import { t, tPlural, getLocale } from '../lib/i18n.js';
import { vaultNavigation } from '../components/collector-shell.js';
import { icon, card, seg, bar, pill, emptyState, btn, skeletonRows } from '../ui/kit.js';
import { setThumb } from '../ui/set-ui.js';
import { vaultTopbar, vaultSearchRow, openActionSheet } from '../ui/vault-ui.js';

// Vault → Build (#/build) has two views:
//  - Official sets: sets you could build from the COMBINED parts of the sets
//    you own, ranked by completion, with how many parts you're short
//    (powered by set_parts).
//  - Alternate models: Rebrickable MOC alternates of a single owned set, with
//    free instructions.

let _mode = 'sets';   // 'sets' | 'alts'
let _q = '';
let _searchOpen = false;
const _sets = { loaded: false, loading: false, error: "", authRequired: false, builds: [], can_build: 0, near: 0, owned_sets: 0, parts_sets: 0 };
const _alts = { loaded: false, loading: false, error: "", authRequired: false, builds: [], can_build: 0, sets_with_alts: 0, owned_sets: 0, indexing: 0 };
let _cacheIdentity = getSessionUserId();
let _cacheGeneration = 0;

const esc = (v) => escapeHtml(v == null ? '' : String(v));
const onBuild = () => location.hash.split('?')[0] === '#/build';
const fmtInt = (n) => { try { return Number(n).toLocaleString(getLocale()); } catch { return String(n); } };

function resetStore(store) {
  store.loaded = false;
  store.loading = false;
  store.error = "";
  store.authRequired = false;
  store.builds = [];
  store.can_build = 0;
  store.owned_sets = 0;
  if ('near' in store) store.near = 0;
  if ('parts_sets' in store) store.parts_sets = 0;
  if ('sets_with_alts' in store) store.sets_with_alts = 0;
  if ('indexing' in store) store.indexing = 0;
}

function resetForIdentityChange() {
  const identity = getSessionUserId();
  if (identity === _cacheIdentity) return;
  _cacheIdentity = identity;
  _cacheGeneration++;
  resetStore(_sets);
  resetStore(_alts);
  _q = '';
  _searchOpen = false;
}

async function loadSets() {
  if (_sets.loading) return;
  // Build data is account-scoped. Do not knowingly send a protected request
  // for guests only to convert the expected 401 into the sign-in state.
  if (isGuestMode()) {
    _sets.error = "";
    _sets.authRequired = true;
    _sets.loaded = true;
    return;
  }
  const generation = _cacheGeneration;
  const identity = getSessionUserId();
  _sets.loading = true;
  try {
    const r = await api('/api/build/sets?limit=120');
    if (generation !== _cacheGeneration || identity !== getSessionUserId()) return;
    _sets.error = "";
    _sets.authRequired = false;
    _sets.builds = (r && r.builds) || [];
    _sets.can_build = (r && r.can_build) || 0;
    _sets.near = (r && r.near) || 0;
    _sets.owned_sets = (r && r.owned_sets) || 0;
    _sets.parts_sets = (r && r.parts_sets) || 0;
    _sets.loaded = true;
  } catch (e) {
    if (generation !== _cacheGeneration || identity !== getSessionUserId()) return;
    _sets.error = e?.message || t('bvVault.buildLoadFailed');
    // Build needs a synced (authed) collection. Guests — and any 401 ("Unauthorized:
    // no token") — get the friendly sign-in prompt, not a raw error + dead Retry.
    _sets.authRequired = isGuestMode() || /unauthorized|no token|sign in|sync this feature|session expired/i.test(_sets.error);
    _sets.loaded = true;
    if (!_sets.authRequired) toast(t('bvVault.buildLoadFailed'), 'error');
  }
  finally { if (generation === _cacheGeneration) _sets.loading = false; }
}

async function loadAlts() {
  if (_alts.loading) return;
  if (isGuestMode()) {
    _alts.error = "";
    _alts.authRequired = true;
    _alts.loaded = true;
    return;
  }
  const generation = _cacheGeneration;
  const identity = getSessionUserId();
  _alts.loading = true;
  try {
    const r = await api('/api/build?limit=300');
    if (generation !== _cacheGeneration || identity !== getSessionUserId()) return;
    _alts.error = "";
    _alts.authRequired = false;
    _alts.builds = (r && r.builds) || [];
    _alts.can_build = (r && r.can_build) || 0;
    _alts.sets_with_alts = (r && r.sets_with_alts) || 0;
    _alts.owned_sets = (r && r.owned_sets) || 0;
    _alts.indexing = (r && r.indexing) || 0;
    _alts.loaded = true;
  } catch (e) {
    if (generation !== _cacheGeneration || identity !== getSessionUserId()) return;
    _alts.error = e?.message || t('bvVault.buildAltsLoadFailed');
    _alts.authRequired = isGuestMode() || /unauthorized|no token|sign in|sync this feature|session expired/i.test(_alts.error);
    _alts.loaded = true;
    if (!_alts.authRequired) toast(t('bvVault.buildAltsLoadFailed'), 'error');
  }
  finally { if (generation === _cacheGeneration) _alts.loading = false; }
}

function setRow(b) {
  const pct = Math.round(Number(b.pct) || 0);
  const ready = !!b.buildable || pct >= 100;
  const sub = [b.theme, b.pieces ? tPlural('bvVault.buildPieces', Number(b.pieces), { count: fmtInt(b.pieces) }) : '',
    ready ? t('bvVault.buildAllParts') : tPlural('bvVault.buildPartsMissing', Number(b.need) || 0, { count: fmtInt(Number(b.need) || 0) })].filter(Boolean).join(' · ');
  const right = ready ? pill(t('bvVault.buildReady'), 'gain', { icon: 'check' }) : `<span class="bv-num vault-build-row__pct">${pct}%</span>`;
  return `<a class="vault-build-row" href="#/set/${encodeURIComponent(String(b.set_num))}" data-set-num="${esc(b.set_num)}">
    ${setThumb(b)}
    <span class="vault-build-row__body">
      <span class="vault-build-row__head"><span class="vault-build-row__name">${esc(b.name || b.set_num)}</span>${right}</span>
      ${bar(pct, { label: t('bvVault.buildPctLabel', { pct }) }).replace('class="bv-bar"', `class="bv-bar${ready ? ' is-ready' : ''}"`)}
      <span class="vault-build-row__sub">${esc(sub)}</span>
    </span>
  </a>`;
}

function altRow(b) {
  // MOC images are Rebrickable user-generated content; Rebrickable's ToS
  // prohibits reusing or displaying them (incl. hotlinking), so we render a
  // neutral brick glyph instead of moc_img_url. The name / pieces / designer /
  // "Instructions" link out to Rebrickable all remain, so the feature is intact.
  const sub = [
    b.num_parts ? tPlural('bvVault.buildPieces', Number(b.num_parts), { count: fmtInt(b.num_parts) }) : '',
    b.designer ? t('bvVault.buildBy', { designer: String(b.designer) }) : '',
    b.from_set_name ? t('bvVault.buildFrom', { set: String(b.from_set_name) }) : '',
  ].filter(Boolean).join(' · ');
  const url = b.moc_url ? String(b.moc_url) : '#';
  return `<a class="vault-build-row is-alt" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
    <span class="bv-thumb vault-build-row__glyph">${icon('brick', { size: 26, stroke: 1.8 })}</span>
    <span class="vault-build-row__body">
      <span class="vault-build-row__head"><span class="vault-build-row__name">${esc(b.name || t('bvVault.buildUntitled'))}</span><span class="bv-card__link">${esc(t('bvVault.buildInstructions'))}${icon('ext', { size: 16 })}</span></span>
      <span class="vault-build-row__sub">${esc(sub)}</span>
    </span>
  </a>`;
}

function heroHTML() {
  if (_mode === 'alts') {
    if (!_alts.loaded || _alts.authRequired || _alts.error) return '';
    return card(`<span class="vault-hero__label">${esc(tPlural('bvVault.buildAltsFrom', _alts.owned_sets))}</span>
      <span class="vault-build-hero__line"><span class="vault-build-hero__big">${esc(tPlural('bvVault.buildAltModels', _alts.can_build))}</span>${_alts.sets_with_alts ? `<span class="vault-build-hero__rest">${esc(tPlural('bvVault.buildAltsSets', _alts.sets_with_alts))}</span>` : ''}</span>
      <span class="vault-build-hero__note">${icon('info', { size: 18 })}<span>${esc(t('bvVault.buildAltsNote'))}</span></span>`, { cls: 'vault-build-hero' });
  }
  if (!_sets.loaded || _sets.authRequired || _sets.error) return '';
  const more = Math.max(0, (_sets.near || 0));
  return card(`<span class="vault-hero__label">${esc(tPlural('bvVault.buildFromParts', _sets.owned_sets))}</span>
    <span class="vault-build-hero__line"><span class="vault-build-hero__big">${esc(tPlural('bvVault.buildReadyCount', _sets.can_build))}</span>${more ? `<span class="vault-build-hero__rest">${esc(tPlural('bvVault.buildNear', more))}</span>` : ''}</span>
    <span class="vault-build-hero__note">${icon('info', { size: 18 })}<span>${esc(t('bvVault.buildNote'))}</span></span>`, { cls: 'vault-build-hero' });
}

function listHtml() {
  const st = _mode === 'sets' ? _sets : _alts;
  if (st.loading && !st.loaded) return skeletonRows(6);
  if (st.authRequired) {
    return emptyState({
      icon: 'user',
      title: t('bvVault.buildSignInTitle'),
      body: t('bvVault.buildSignInBody'),
      actionsHtml: `${btn(t('bvVault.buildSignIn'), { href: '#/login', icon: 'user', full: true })}${btn(t('bvVault.emptyBrowse'), { href: '#/add', kind: 'tonal', icon: 'search', full: true })}${btn(t('bvVault.buildScan'), { href: '#/pile', kind: 'tonal', icon: 'scan', full: true })}`,
    });
  }
  if (st.error) {
    return emptyState({
      icon: 'alert',
      title: t('bvVault.buildUnavailable'),
      body: st.error,
      actionsHtml: `${btn(t('common.retry'), { id: 'buildRetry', icon: 'refresh', full: true })}${btn(t('bvVault.emptyBrowse'), { href: '#/add', kind: 'tonal', icon: 'search', full: true })}`,
    });
  }
  if (st.loaded && !st.owned_sets) {
    return emptyState({
      icon: 'box',
      title: t('bvVault.buildNothingTitle'),
      body: t('bvVault.buildNothingBody'),
      actionsHtml: `${btn(t('bvVault.emptyBrowse'), { href: '#/add', icon: 'search', full: true })}${btn(t('bvVault.buildScan'), { href: '#/pile', kind: 'tonal', icon: 'scan', full: true })}`,
    });
  }
  let items = st.builds;
  if (_q) {
    const q = _q.toLowerCase();
    items = items.filter((b) => String(b.name || '').toLowerCase().includes(q));
  }
  if (!items.length) {
    if (_mode === 'sets' && _sets.loaded && !_sets.parts_sets) {
      return emptyState({ icon: 'brick', title: t('bvVault.buildIndexingTitle'), body: t('bvVault.buildIndexingBody') });
    }
    if (_mode === 'alts' && _alts.loaded && (_alts.indexing > 0 || (_alts.owned_sets && !_alts.sets_with_alts))) {
      // Alternates are indexed lazily (a few sets per visit + nightly backfill).
      // An empty list usually means "not indexed yet", not "no MOCs exist".
      return emptyState({ icon: 'brick', title: t('bvVault.buildAltsIndexingTitle'), body: t('bvVault.buildAltsIndexingBody') });
    }
    return emptyState({ icon: 'search', title: _q ? t('bvVault.buildNoMatchesFor', { query: _q }) : t('bvVault.buildNoMatches'), body: _q ? t('bvVault.buildTryAnother') : '' });
  }
  return `<div class="vault-build-list">${items.map(_mode === 'sets' ? setRow : altRow).join('')}</div>`;
}

function pageHtml() {
  const altLabel = _alts.loaded && !_alts.authRequired && !_alts.error ? tPlural('bvVault.buildAltsTab', _alts.can_build, { count: fmtInt(_alts.can_build) }) : t('bvVault.buildAltsTabPlain');
  return `<main class="bv-page vault-build build-view" id="buildPage">
    ${vaultTopbar({ searchOpen: _searchOpen, searchLabel: t('bvVault.buildSearch'), searchControls: 'buildSearchRow' })}
    ${_searchOpen ? vaultSearchRow({ id: 'buildSearch', rowId: 'buildSearchRow', name: 'build_search', value: _q, placeholder: t('bvVault.buildSearchPlaceholder'), label: t('bvVault.buildSearch') }) : ''}
    ${_searchOpen ? '' : heroHTML()}
    ${vaultNavigation('build')}
    <div class="vault-build-seg">${seg([
      { label: t('bvVault.buildOfficial'), value: 'sets', current: _mode === 'sets', attrs: { 'data-mode': 'sets' } },
      { label: altLabel, value: 'alts', current: _mode === 'alts', attrs: { 'data-mode': 'alts' } },
    ], { label: t('bvVault.buildViews') })}</div>
    ${(_mode === 'alts' && _alts.indexing) ? `<p class="bv-foot" role="status">${esc(tPlural('build.indexing', _alts.indexing))}</p>` : ''}
    ${listHtml()}
  </main>`;
}

function rerender() {
  resetForIdentityChange();
  if (!onBuild()) return;
  mount($('#root'), pageHtml());
  wire();
}

async function ensureLoaded() {
  resetForIdentityChange();
  if (_mode === 'sets' && !_sets.loaded) await loadSets();
  if (_mode === 'alts' && !_alts.loaded) await loadAlts();
}

function wire() {
  $$('#buildPage [data-mode]').forEach((b) => {
    b.onclick = async () => {
      const m = b.dataset.mode;
      if (m === _mode) return;
      _mode = m;
      haptic('light');
      rerender();
      await ensureLoaded();
      rerender();
    };
  });
  const s = $('#buildSearch');
  if (s) {
    s.oninput = debounce(() => {
      const el = $('#buildSearch');
      _q = el ? el.value.trim() : '';
      rerender();
      const s2 = $('#buildSearch');
      if (s2) { s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }
    }, SEARCH_DEBOUNCE_MS || 250);
  }
  const searchBtn = $('#vaultSearchBtn');
  if (searchBtn) searchBtn.onclick = () => {
    haptic('light');
    _searchOpen = !_searchOpen;
    if (!_searchOpen) _q = '';
    rerender();
    if (_searchOpen) $('#buildSearch')?.focus();
  };
  const more = $('#vaultMoreBtn');
  if (more) more.onclick = () => {
    haptic('light');
    openActionSheet({
      title: t('bvVault.moreOptions'),
      groups: [{ rows: [
        { id: 'buildMoreOfficial', icon: 'brick', label: t('bvVault.buildOfficial'), onClick: () => { $('#buildPage [data-mode="sets"]')?.click(); } },
        { id: 'buildMoreAlts', icon: 'wand', label: t('bvVault.buildAltsTabPlain'), onClick: () => { $('#buildPage [data-mode="alts"]')?.click(); } },
        { id: 'buildMoreChanges', icon: 'bell', label: t('bvVault.whatChanged'), href: '#/changes' },
      ] }],
    });
  };
  const retry = $('#buildRetry');
  if (retry) retry.onclick = async () => {
    const st = _mode === 'sets' ? _sets : _alts;
    st.loaded = false;
    st.error = "";
    st.authRequired = false;
    rerender();
    await ensureLoaded();
    rerender();
  };
}

export async function renderBuild() {
  resetForIdentityChange();
  $('#root').innerHTML = `<main class="bv-page vault-build" aria-busy="true">${vaultTopbar()}${vaultNavigation('build')}${skeletonRows(6)}</main>`;
  await ensureLoaded();
  rerender();
  // The Alternate models count on the switch comes from its own read; fetch it
  // quietly once the official list is on screen.
  if (_mode === 'sets' && !_alts.loaded && !isGuestMode()) loadAlts().then(() => { if (onBuild()) rerender(); }).catch(() => {});
}
