import { $, $$, escapeHtml, haptic, toast, debounce, SEARCH_DEBOUNCE_MS, mount, emptyState } from '../utils.js';
import { api, getSessionUserId, isGuestMode } from '../api.js';
import { skelPage, skelCardList } from '../components/skeleton.js';
import { I } from '../icons.js';
import { tPlural } from '../lib/i18n.js';

// "What Can I Build?" has two tabs:
//  - Buildable sets: official sets you can build from the COMBINED parts of the
//    sets you own, with completion % and "Need N" (powered by set_parts).
//  - Alternate builds: Rebrickable MOC alternates of a single owned set, with
//    free instructions.

let _mode = 'sets';   // 'sets' | 'alts'
let _q = '';
const _sets = { loaded: false, loading: false, error: "", authRequired: false, builds: [], can_build: 0, near: 0, owned_sets: 0, parts_sets: 0 };
const _alts = { loaded: false, loading: false, error: "", authRequired: false, builds: [], can_build: 0, sets_with_alts: 0, owned_sets: 0, indexing: 0 };
let _cacheIdentity = getSessionUserId();
let _cacheGeneration = 0;

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
    _sets.error = e?.message || "Couldn't load buildable sets";
    // Build needs a synced (authed) collection. Guests — and any 401 ("Unauthorized:
    // no token") — get the friendly sign-in prompt, not a raw error + dead Retry.
    _sets.authRequired = isGuestMode() || /unauthorized|no token|sign in|sync this feature|session expired/i.test(_sets.error);
    _sets.loaded = true;
    if (!_sets.authRequired) toast("Couldn't load buildable sets", 'error');
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
    _alts.error = e?.message || "Couldn't load alternate builds";
    _alts.authRequired = isGuestMode() || /unauthorized|no token|sign in|sync this feature|session expired/i.test(_alts.error);
    _alts.loaded = true;
    if (!_alts.authRequired) toast("Couldn't load alternate builds", 'error');
  }
  finally { if (generation === _cacheGeneration) _alts.loading = false; }
}

function setRow(b) {
  const pct = Math.round(Number(b.pct) || 0);
  const img = b.image_url
    ? `<img class="b-thumb" src="${escapeHtml(String(b.image_url))}" alt="${escapeHtml(String(b.name || ''))}" loading="lazy">`
    : `<div class="b-thumb b-thumb-e"></div>`;
  const sub = [b.theme, b.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(' · ');
  const right = b.buildable
    ? `<span class="b-badge b-ok">Buildable</span>`
    : `<span class="b-need">${tPlural('build.needParts', b.need)}</span>`;
  return `<a class="b-row" href="#/set/${encodeURIComponent(String(b.set_num))}">
    ${img}
    <div class="b-meta">
      <div class="b-name">${escapeHtml(String(b.name || b.set_num))}</div>
      <div class="b-sub">${sub}${b.pieces ? ' · ' + b.pieces + ' pcs' : ''}</div>
      <div class="b-barwrap"><div class="b-bar ${b.buildable ? 'b-bar-ok' : 'b-bar-mid'}" style="width:${pct}%"></div></div>
    </div>
    <div class="b-side"><span class="b-pct">${pct}%</span>${right}</div>
  </a>`;
}

function altRow(b) {
  // MOC images are Rebrickable user-generated content; Rebrickable's ToS
  // prohibits reusing or displaying them (incl. hotlinking), so we render a
  // neutral brick glyph instead of moc_img_url. The name / pieces / designer /
  // "Instructions" link out to Rebrickable all remain, so the feature is intact.
  const img = `<div class="b-thumb b-thumb-e"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="9" width="18" height="11" rx="1.5"/><path d="M7 9V7.5a2 2 0 0 1 4 0V9M13 9V7.5a2 2 0 0 1 4 0V9"/></svg></div>`;
  const parts = b.num_parts ? `${b.num_parts} pieces` : '';
  const designer = b.designer ? `by ${escapeHtml(String(b.designer))}` : '';
  const fromSet = b.from_set_name ? `from ${escapeHtml(String(b.from_set_name))}` : '';
  const url = b.moc_url ? escapeHtml(String(b.moc_url)) : '#';
  return `<a class="b-row" href="${url}" target="_blank" rel="noopener noreferrer">
    ${img}
    <div class="b-meta">
      <div class="b-name">${escapeHtml(String(b.name || 'Untitled build'))}</div>
      <div class="b-sub">${[parts, designer].filter(Boolean).join(' · ')}</div>
      <div class="b-sub" style="opacity:.5">${fromSet}</div>
    </div>
    <div class="b-side"><span class="b-badge b-ok">Instructions</span><span class="b-chevron">›</span></div>
  </a>`;
}

function tiles() {
  if (_mode === 'sets') {
    return `<div class="b-tiles">
      <div class="b-tile"><div class="b-n">${_sets.can_build}</div><div class="b-l">sets you can build</div></div>
      <div class="b-tile"><div class="b-n">${_sets.near}</div><div class="b-l">almost (≥80%)</div></div>
    </div>`;
  }
  return `<div class="b-tiles">
    <div class="b-tile"><div class="b-n">${_alts.can_build}</div><div class="b-l">alternate models</div></div>
    <div class="b-tile"><div class="b-n">${_alts.sets_with_alts}</div><div class="b-l">${tPlural('build.ofOwnedSets', _alts.owned_sets)}</div></div>
  </div>`;
}

function listHtml() {
  const st = _mode === 'sets' ? _sets : _alts;
  if (st.loading && !st.loaded) return skelCardList(6);
  if (st.authRequired) {
    return emptyState({
      icon: I.layers(),
      title: 'Sign in to build from your vault',
      body: 'Build tools need your synced collection and parts data. You can still browse the catalog or scan sets as a guest.',
      action: `<div class="empty-actions"><a class="btn-primary" href="#/login">${I.user()}<span>Sign in</span></a><a class="btn-secondary" href="#/add">${I.search()}<span>Browse catalog</span></a><a class="btn-secondary" href="#/pile">${I.scan()}<span>Scan a set</span></a></div>`,
    });
  }
  if (st.error) {
    return emptyState({
      icon: I.info(),
      title: 'Build tools are unavailable',
      body: st.error,
      action: `<div class="empty-actions"><button class="btn-primary" id="buildRetry">${I.refresh()}<span>Retry</span></button><a class="btn-secondary" href="#/add">${I.search()}<span>Browse catalog</span></a></div>`,
    });
  }
  if (st.loaded && !st.owned_sets) {
    return emptyState({
      icon: I.box(),
      title: 'Nothing to build yet',
      body: 'Add sets to your vault, then come back to see what you can build from their parts.',
      action: `<div class="empty-actions"><a class="btn-primary" href="#/add">${I.search()}<span>Browse catalog</span></a><a class="btn-secondary" href="#/pile">${I.scan()}<span>Scan a set</span></a></div>`,
    });
  }
  let items = st.builds;
  if (_q) {
    const q = _q.toLowerCase();
    items = items.filter((b) => String(b.name || '').toLowerCase().includes(q));
  }
  if (!items.length) {
    if (_mode === 'sets' && _sets.loaded && !_sets.parts_sets) {
      return emptyState({ icon: I.layers(), title: 'Indexing parts', body: "We're still indexing the part lists for your sets — check back shortly." });
    }
    if (_mode === 'alts' && _alts.loaded && (_alts.indexing > 0 || (_alts.owned_sets && !_alts.sets_with_alts))) {
      // Alternates are indexed lazily (a few sets per visit + nightly backfill).
      // An empty list usually means "not indexed yet", not "no MOCs exist".
      return emptyState({ icon: I.layers(), title: 'Indexing your sets', body: 'We\u2019re looking up alternate builds for the sets in your vault \u2014 this fills in automatically. Check back soon.' });
    }
    return emptyState({ icon: I.search(), title: _q ? `No matches for "${escapeHtml(_q)}"` : 'No matches yet', body: _q ? 'Try a different search term.' : '' });
  }
  return `<div class="b-list">${items.map(_mode === 'sets' ? setRow : altRow).join('')}</div>`;
}

function pageHtml() {
  const _intro = _mode === 'sets'
    ? `Official sets you could build right now from the combined parts of the sets you own — with completion % and how many pieces you're short. (You'd part out your sets to build them.)`
    : `Alternate models you can build from a set you own, each with free building instructions.`;
  return `<div class="page build-view">
    <div class="topbar">
      <button class="icon-btn" id="buildBack" aria-label="Back">${I.chevL()}</button>
      <div class="topbar-heading">
        <div class="topbar-eyebrow">Vault tools</div>
        <h1 class="topbar-title">Build</h1>
      </div>
    </div>
    <div class="b-tabs" role="tablist" aria-label="Build views">
      <button class="b-tab ${_mode === 'sets' ? 'b-tab-on' : ''}" data-mode="sets" role="tab" aria-selected="${_mode === 'sets'}">Buildable sets</button>
      <button class="b-tab ${_mode === 'alts' ? 'b-tab-on' : ''}" data-mode="alts" role="tab" aria-selected="${_mode === 'alts'}">Alternate builds</button>
    </div>
    <p class="build-intro">${_mode === 'sets' ? 'Official sets you can build from owned parts, ranked by completion.' : 'Alternate models from sets you own, with instruction links.'}</p>
    ${tiles()}
    <input id="buildSearch" class="build-search" type="search" placeholder="Search…" value="${escapeHtml(_q)}">
    ${(_mode === 'alts' && _alts.indexing) ? `<div class="b-indexing">${tPlural('build.indexing', _alts.indexing)}</div>` : ''}
    ${listHtml()}
  </div>`;
}

function rerender() {
  resetForIdentityChange();
  mount($('#root'), pageHtml());
  wire();
}

async function ensureLoaded() {
  resetForIdentityChange();
  if (_mode === 'sets' && !_sets.loaded) await loadSets();
  if (_mode === 'alts' && !_alts.loaded) await loadAlts();
}

function wire() {
  const back = $('#buildBack');
  if (back) back.onclick = () => { haptic('light'); if (history.length > 1) history.back(); else location.hash = '#/me'; };
  $$('.b-tab').forEach((t) => {
    t.onclick = async () => {
      const m = t.dataset.mode;
      if (m === _mode) return;
      _mode = m; _q = '';
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
  $('#buildRetry')?.addEventListener('click', async () => {
    const st = _mode === 'sets' ? _sets : _alts;
    st.loaded = false;
    st.error = "";
    st.authRequired = false;
    rerender();
    await ensureLoaded();
    rerender();
  });
}

export async function renderBuild() {
  $('#root').innerHTML = skelPage(skelCardList(6));
  await ensureLoaded();
  rerender();
}
