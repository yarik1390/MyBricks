import { $, $$, escapeHtml, haptic, toast, debounce, SEARCH_DEBOUNCE_MS } from '../utils.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { skelPage, skelCardList } from '../components/skeleton.js';

// "What Can I Build?" — alternate builds (MOCs) you can make from the parts in
// the sets you already own, sourced from Rebrickable. You own each set complete,
// so every alternate is buildable; we link out to the free instructions.

const PAGE = 50;
let _state = {
  builds: [], total: 0, can_build: 0, sets_with_alts: 0, owned_sets: 0,
  indexing: 0, offset: 0, hasMore: false, q: '', loading: false,
};

const STYLE = `<style>
.build-view{padding:0 5% 96px;max-width:680px;margin:0 auto}
.build-header{display:flex;align-items:center;gap:8px;padding:14px 0 2px}
.build-header h1{font-size:1.4rem;margin:0}
.build-intro{opacity:.68;font-size:.84rem;line-height:1.45;margin:.4rem 0 1rem}
.build-tiles{display:flex;gap:12px;margin-bottom:14px}
.build-tile{flex:1;background:rgba(127,127,127,.08);border:1px solid rgba(127,127,127,.16);border-radius:14px;padding:14px}
.build-tile-n{font-size:1.7rem;font-weight:700;line-height:1}
.build-tile-l{font-size:.73rem;opacity:.65;margin-top:5px}
.build-search{width:100%;box-sizing:border-box;padding:11px 14px;border-radius:12px;border:1px solid rgba(127,127,127,.22);background:rgba(127,127,127,.06);color:inherit;font-size:.95rem;margin-bottom:12px}
.build-indexing{font-size:.77rem;opacity:.6;margin:-2px 0 10px}
.build-list{display:flex;flex-direction:column;gap:10px}
.build-row{display:flex;align-items:center;gap:12px;padding:10px;border:1px solid rgba(127,127,127,.16);border-radius:14px;text-decoration:none;color:inherit;background:rgba(127,127,127,.04)}
.build-row:active{background:rgba(127,127,127,.1)}
.build-thumb{width:62px;height:62px;border-radius:10px;object-fit:cover;background:rgba(127,127,127,.1);flex:none}
.build-thumb-empty{display:flex;align-items:center;justify-content:center;opacity:.4}
.build-meta{flex:1;min-width:0}
.build-name{font-weight:600;font-size:.95rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.build-sub{font-size:.77rem;opacity:.66;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.build-from{opacity:.5}
.build-side{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none}
.build-badge{background:#138a36;color:#fff;font-size:.64rem;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap}
.build-chevron{opacity:.4;font-size:1.2rem;line-height:1}
.build-more{margin:16px auto 0;display:block}
.build-empty{opacity:.66;text-align:center;padding:40px 18px;line-height:1.5}
.icon-btn{background:none;border:none;color:inherit;cursor:pointer;padding:6px;font-size:1.3rem;line-height:1}
</style>`;

function buildQuery() {
  const p = new URLSearchParams({ limit: String(PAGE), offset: String(_state.offset) });
  if (_state.q) p.set('q', _state.q);
  return p.toString();
}

async function load({ reset = false } = {}) {
  if (_state.loading) return;
  if (reset) { _state.offset = 0; _state.builds = []; _state.hasMore = false; }
  _state.loading = true;
  try {
    const res = await api('/api/build?' + buildQuery());
    const fresh = (res && res.builds) || [];
    _state.builds = reset ? fresh : _state.builds.concat(fresh);
    _state.total = (res && res.total) ?? _state.builds.length;
    _state.can_build = (res && res.can_build) ?? 0;
    _state.sets_with_alts = (res && res.sets_with_alts) ?? 0;
    _state.owned_sets = (res && res.owned_sets) ?? 0;
    _state.indexing = (res && res.indexing) ?? 0;
    _state.offset = _state.builds.length;
    _state.hasMore = !!(res && res.hasMore);
  } catch (e) {
    toast("Couldn't load builds", 'error');
  } finally {
    _state.loading = false;
  }
}

function rowHtml(b) {
  const img = b.moc_img_url
    ? `<img class="build-thumb" src="${escapeHtml(String(b.moc_img_url))}" alt="" loading="lazy">`
    : `<div class="build-thumb build-thumb-empty">${I.figure ? I.figure() : ''}</div>`;
  const parts = b.num_parts ? `${b.num_parts} pieces` : '';
  const designer = b.designer ? `by ${escapeHtml(String(b.designer))}` : '';
  const fromSet = b.from_set_name ? `from ${escapeHtml(String(b.from_set_name))}` : '';
  const url = b.moc_url ? escapeHtml(String(b.moc_url)) : '#';
  return `<a class="build-row" href="${url}" target="_blank" rel="noopener noreferrer">
      ${img}
      <div class="build-meta">
        <div class="build-name">${escapeHtml(String(b.name || 'Untitled build'))}</div>
        <div class="build-sub">${[parts, designer].filter(Boolean).join(' · ')}</div>
        <div class="build-sub build-from">${fromSet}</div>
      </div>
      <div class="build-side">
        <span class="build-badge">Instructions</span>
        <span class="build-chevron">›</span>
      </div>
    </a>`;
}

function pageHtml() {
  const tiles = `<div class="build-tiles">
      <div class="build-tile"><div class="build-tile-n">${_state.can_build}</div><div class="build-tile-l">models you can build</div></div>
      <div class="build-tile"><div class="build-tile-n">${_state.sets_with_alts}</div><div class="build-tile-l">of ${_state.owned_sets} owned sets have alternates</div></div>
    </div>`;
  const search = `<input id="buildSearch" class="build-search" type="search" placeholder="Search builds…" value="${escapeHtml(_state.q)}">`;
  let list;
  if (!_state.owned_sets) {
    list = `<div class="build-empty">Add sets to your vault, then come back to see what you can build from their parts.</div>`;
  } else if (!_state.builds.length) {
    list = `<div class="build-empty">No alternate builds found for your sets${_state.indexing ? ' yet — still indexing, tap refresh in a moment.' : '.'}</div>`;
  } else {
    list = `<div class="build-list">${_state.builds.map(rowHtml).join('')}</div>`
      + (_state.hasMore ? `<button id="buildMore" class="btn-secondary build-more">Load more</button>` : '');
  }
  const indexingNote = _state.indexing
    ? `<div class="build-indexing">Indexing ${_state.indexing} more set(s) in the background…</div>` : '';
  return `${STYLE}<div class="build-view">
      <header class="build-header">
        <button class="icon-btn" id="buildBack" aria-label="Back">‹</button>
        <h1>What Can I Build?</h1>
      </header>
      <p class="build-intro">Alternate models you can build from the parts in sets you already own — with free instructions on Rebrickable. (You'd take the set apart to build these.)</p>
      ${tiles}
      ${search}
      ${indexingNote}
      ${list}
    </div>`;
}

function wire() {
  const back = $('#buildBack');
  if (back) back.onclick = () => { haptic('light'); if (history.length > 1) history.back(); else location.hash = '#/me'; };
  const search = $('#buildSearch');
  if (search) {
    search.oninput = debounce(async (e) => {
      _state.q = e.target.value.trim();
      await load({ reset: true });
      $('#root').innerHTML = pageHtml();
      wire();
      const s = $('#buildSearch');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }, SEARCH_DEBOUNCE_MS || 300);
  }
  const more = $('#buildMore');
  if (more) more.onclick = async () => { await load(); $('#root').innerHTML = pageHtml(); wire(); };
}

export async function renderBuild() {
  $('#root').innerHTML = skelPage(skelCardList(6));
  await load({ reset: true });
  $('#root').innerHTML = pageHtml();
  wire();
}
