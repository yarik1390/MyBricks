import { $, $$, escapeHtml, haptic, toast, debounce, SEARCH_DEBOUNCE_MS, mount } from '../utils.js';
import { api } from '../api.js';
import { skelPage, skelCardList } from '../components/skeleton.js';

// "What Can I Build?" has two tabs:
//  - Buildable sets: official sets you can build from the COMBINED parts of the
//    sets you own, with completion % and "Need N" (powered by set_parts).
//  - Alternate builds: Rebrickable MOC alternates of a single owned set, with
//    free instructions.

let _mode = 'sets';   // 'sets' | 'alts'
let _q = '';
const _sets = { loaded: false, loading: false, builds: [], can_build: 0, near: 0, owned_sets: 0, parts_sets: 0 };
const _alts = { loaded: false, loading: false, builds: [], can_build: 0, sets_with_alts: 0, owned_sets: 0, indexing: 0 };


async function loadSets() {
  if (_sets.loading) return;
  _sets.loading = true;
  try {
    const r = await api('/api/build/sets?limit=120');
    _sets.builds = (r && r.builds) || [];
    _sets.can_build = (r && r.can_build) || 0;
    _sets.near = (r && r.near) || 0;
    _sets.owned_sets = (r && r.owned_sets) || 0;
    _sets.parts_sets = (r && r.parts_sets) || 0;
    _sets.loaded = true;
  } catch (_e) { toast("Couldn't load buildable sets", 'error'); }
  finally { _sets.loading = false; }
}

async function loadAlts() {
  if (_alts.loading) return;
  _alts.loading = true;
  try {
    const r = await api('/api/build?limit=300');
    _alts.builds = (r && r.builds) || [];
    _alts.can_build = (r && r.can_build) || 0;
    _alts.sets_with_alts = (r && r.sets_with_alts) || 0;
    _alts.owned_sets = (r && r.owned_sets) || 0;
    _alts.indexing = (r && r.indexing) || 0;
    _alts.loaded = true;
  } catch (_e) { toast("Couldn't load alternate builds", 'error'); }
  finally { _alts.loading = false; }
}

function setRow(b) {
  const pct = Math.round(Number(b.pct) || 0);
  const img = b.image_url
    ? `<img class="b-thumb" src="${escapeHtml(String(b.image_url))}" alt="${escapeHtml(String(b.name || ''))}" loading="lazy">`
    : `<div class="b-thumb b-thumb-e"></div>`;
  const sub = [b.theme, b.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(' · ');
  const right = b.buildable
    ? `<span class="b-badge b-ok">Buildable</span>`
    : `<span class="b-need">Need ${b.need} more parts</span>`;
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
  const img = b.moc_img_url
    ? `<img class="b-thumb" src="${escapeHtml(String(b.moc_img_url))}" alt="${escapeHtml(String(b.name || ''))}" loading="lazy">`
    : `<div class="b-thumb b-thumb-e"></div>`;
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
    <div class="b-tile"><div class="b-n">${_alts.sets_with_alts}</div><div class="b-l">of ${_alts.owned_sets} owned sets</div></div>
  </div>`;
}

function listHtml() {
  const st = _mode === 'sets' ? _sets : _alts;
  if (st.loading && !st.loaded) return skelCardList(6);
  if (st.loaded && !st.owned_sets) {
    return `<div class="b-empty">Add sets to your vault, then come back to see what you can build from their parts.</div>`;
  }
  let items = st.builds;
  if (_q) {
    const q = _q.toLowerCase();
    items = items.filter((b) => String(b.name || '').toLowerCase().includes(q));
  }
  if (!items.length) {
    if (_mode === 'sets' && _sets.loaded && !_sets.parts_sets) {
      return `<div class="b-empty">We're still indexing the part lists for your sets — check back shortly.</div>`;
    }
    return `<div class="b-empty">No matches${_q ? ' for "' + escapeHtml(_q) + '"' : ' yet'}.</div>`;
  }
  return `<div class="b-list">${items.map(_mode === 'sets' ? setRow : altRow).join('')}</div>`;
}

function pageHtml() {
  const intro = _mode === 'sets'
    ? `Official sets you could build right now from the combined parts of the sets you own — with completion % and how many pieces you're short. (You'd part out your sets to build them.)`
    : `Alternate models you can build from a set you own, each with free building instructions on Rebrickable.`;
  return `<div class="build-view">
    <header class="build-header">
      <button class="icon-btn" id="buildBack" aria-label="Back">‹</button>
      <h1>What Can I Build?</h1>
    </header>
    <div class="b-tabs" role="tablist" aria-label="Build views">
      <button class="b-tab ${_mode === 'sets' ? 'b-tab-on' : ''}" data-mode="sets" aria-pressed="${_mode === 'sets'}">Buildable sets</button>
      <button class="b-tab ${_mode === 'alts' ? 'b-tab-on' : ''}" data-mode="alts" aria-pressed="${_mode === 'alts'}">Alternate builds</button>
    </div>
    <p class="build-intro">${intro}</p>
    ${tiles()}
    <input id="buildSearch" class="build-search" type="search" placeholder="Search…" value="${escapeHtml(_q)}">
    ${(_mode === 'alts' && _alts.indexing) ? `<div class="b-indexing">Indexing ${_alts.indexing} more set(s) in the background…</div>` : ''}
    ${listHtml()}
  </div>`;
}

function rerender() { mount($('#root'), pageHtml()); wire(); }

async function ensureLoaded() {
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
}

export async function renderBuild() {
  $('#root').innerHTML = skelPage(skelCardList(6));
  await ensureLoaded();
  rerender();
}
