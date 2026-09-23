import { vaultNavigation, setPinnedCollection, setPageFab } from '../components/collector-shell.js';
import { readCollectorPreferences } from '../lib/collector-preferences.js';
import { $, $$, escapeHtml, haptic, toast } from '../utils.js';
import { api, getSessionOwnerSnapshot, getSessionUserId, isGuestMode } from '../api.js';
import { state } from '../state.js';
import { t, tPlural } from '../lib/i18n.js';
import { canonicalSetNum, collectionProgress, collectorInsights, normalizeSubcollection } from '../lib/subcollections.js';
import { recordCompleteness } from '../lib/vault-insights.js';
import { subcollectionRequest } from '../lib/subcollection-storage.js';
import { exportBlob } from '../lib/native-file-export.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { icon, card, bar, pill, btn, banner, emptyState, sheetBody, skeletonRows } from '../ui/kit.js';
import { vaultTopbar, vaultSearchRow, openActionSheet, countRow } from '../ui/vault-ui.js';

// Vault → Lists (#/collections): collection-record gaps, then named lists
// ("Display shelf", "UCS to complete") with progress, pins and a sheet per list.
// Lists live on the account (or on the device for guests) and hold set
// numbers, never holding ids.

const esc = (v) => escapeHtml(v == null ? '' : String(v));
let renderGeneration = 0;
let searchOpen = false;
let query = '';
window.addEventListener('bv:owner-changed', () => {
  renderGeneration++;
  searchOpen = false;
  query = '';
  if (document.querySelector('#subcollectionsPage')) {
    if (document.querySelector('#sheet #collectionEditor, #sheet [data-list-sheet]')) hideSheet();
    $('#root').replaceChildren();
  }
});

export async function renderSubcollections() {
  const generation = ++renderGeneration;
  const owner = getSessionOwnerSnapshot();
  const current = () => {
    const now = getSessionOwnerSnapshot();
    return generation === renderGeneration && owner.userId === now.userId && owner.generation === now.generation
      && location.hash.split('?')[0] === '#/collections';
  };
  $('#root').innerHTML = `<main class="bv-page has-fab vault-lists" id="subcollectionsPage" aria-busy="true">${vaultTopbar()}<p class="bv-sr" role="status">${esc(t('collections.loading'))}</p>${skeletonRows(3)}</main>`;
  const [holdingsResult, listsResult] = await Promise.allSettled([api('/api/collection'), subcollectionRequest()]);
  if (!current()) return;
  const holdingsFresh = holdingsResult.status === 'fulfilled';
  const items = holdingsFresh ? (holdingsResult.value.items || []) : (state.portfolio?.items || []);
  let lists = listsResult.status === 'fulfilled' ? listsResult.value.subcollections : null;
  if (!Array.isArray(lists)) lists = null;
  const insights = collectorInsights(items);
  const records = recordCompleteness(items);
  const names = new Map(items.map(row => [canonicalSetNum(row.set_num), row.name]));
  const wished = new Set((state.wishlist || []).map(row => canonicalSetNum(row.set_num)));
  for (const w of state.wishlist || []) if (w.name && !names.has(canonicalSetNum(w.set_num))) names.set(canonicalSetNum(w.set_num), w.name);
  const busy = () => document.querySelector('#collectionEditor fieldset')?.disabled;
  const message = error => t(error?.status === 409 ? 'collections.conflict' : 'collections.failed');
  const pins = () => readCollectorPreferences(getSessionUserId()).pins;

  setPageFab({ label: t('bvVault.newList'), icon: 'plus', onClick: () => {
    haptic('light');
    if (lists === null) { toast(t('collections.failed'), 'error'); return; }
    if (lists.length >= 50) { toast(t('collections.invalid'), 'error'); return; }
    if (!busy()) edit(null);
  } });

  const recordsCard = () => card(`
    <span class="vault-hero__head"><span class="vault-hero__label">${esc(t('bvVault.recordsTitle'))}</span><span class="bv-label">${esc(tPlural('bvVault.footSets', insights.distinct))}</span></span>
    <span class="vault-records__pct">${esc(t('bvVault.recordsComplete', { pct: records.pct }))}</span>
    <span class="vault-records__rows">
      ${countRow({ label: t('bvVault.recordsMissingPrice'), count: records.missingCost.length, attrs: { 'data-records': 'cost' } })}
      ${countRow({ label: t('bvVault.recordsMissingDate'), count: records.missingDate.length, attrs: { 'data-records': 'date' } })}
      ${records.incomplete.length ? countRow({ label: t('bvVault.recordsIncomplete'), count: records.incomplete.length, attrs: { 'data-records': 'incomplete' } }) : ''}
    </span>`, { cls: 'vault-records', attrs: { 'aria-labelledby': 'recordsTitle' } }).replace('<span class="vault-hero__label">', '<span class="vault-hero__label" id="recordsTitle">');

  const listSub = (list, progress) => {
    if (!progress.total) return t('collections.noTargets');
    const ownedNames = list.set_nums.map(canonicalSetNum).filter(num => !progress.missing.includes(num)).map(num => names.get(num) || num);
    if (progress.complete) return ownedNames.join(', ');
    const onWishlist = progress.missing.filter(num => wished.has(num)).length;
    if (onWishlist) return `${tPlural('bvVault.listWanted', progress.missing.length)} · ${tPlural('bvVault.listOnWishlist', onWishlist)}`;
    if (!ownedNames.length) return tPlural('bvVault.listWanted', progress.missing.length);
    return `${ownedNames.slice(0, 3).join(', ')} · ${tPlural('bvVault.listNotOwned', progress.missing.length)}`;
  };

  const listHTML = list => {
    const progress = collectionProgress(list, items);
    const pinned = pins().includes(list.id);
    const label = tPlural('collections.progress', progress.total, { owned: progress.owned, total: progress.total });
    const right = progress.complete ? pill(t('collections.completed'), 'gain', { icon: 'check' }) : `<span class="bv-num vault-list-card__count" aria-hidden="true">${progress.owned}/${progress.total}</span>`;
    return `<article class="vault-list-card" data-list-id="${esc(list.id)}">
      <div class="vault-list-card__head">
        <button type="button" class="vault-list-card__pin${pinned ? ' is-pinned' : ''}" data-pin="${esc(list.id)}" aria-pressed="${pinned}" aria-label="${esc(t(pinned ? 'collector.unpin' : 'collector.pin'))}">${icon('star', { size: 18 })}</button>
        <h2 class="vault-list-card__name"><button type="button" class="vault-list-card__open" data-open-list="${esc(list.id)}" aria-label="${esc(`${list.name}, ${label}`)}">${esc(list.name)}</button></h2>
        ${right}
      </div>
      ${bar(progress.total ? (progress.owned / progress.total) * 100 : 0, { label, acc: false })}
      <p class="vault-list-card__sub">${esc(listSub(list, progress))}</p>
    </article>`;
  };

  function paint() {
    if (!current()) return;
    const q = query.trim().toLowerCase();
    const shown = lists === null ? null : lists.filter(list => !q || list.name.toLowerCase().includes(q) || list.set_nums.some(num => num.toLowerCase().includes(q) || String(names.get(num) || '').toLowerCase().includes(q)));
    const notices = [
      !holdingsFresh ? banner({ icon: 'cloudOff', kind: 'neutral', text: t('collections.stale') }) : '',
      state.pendingCollectionOperationList?.length ? banner({ icon: 'cloud', kind: 'neutral', text: t('collections.pending') }) : '',
    ].join('');
    $('#root').innerHTML = `<main class="bv-page has-fab vault-lists" id="subcollectionsPage">
      ${vaultTopbar({ searchOpen, searchLabel: t('bvVault.searchLists') })}
      ${searchOpen ? vaultSearchRow({ id: 'listSearch', name: 'list_search', value: query, placeholder: t('bvVault.searchListsPlaceholder'), label: t('bvVault.searchLists') }) : ''}
      ${notices}
      ${searchOpen ? '' : recordsCard()}
      ${vaultNavigation('collections')}
      <div id="collectionLists" class="vault-lists__list">${shown === null
        ? `<div class="bv-empty" role="alert"><p>${esc(t('collections.failed'))}</p>${btn(t('collections.retry'), { kind: 'tonal', id: 'collectionRetry' })}</div>`
        : shown.length ? shown.map(listHTML).join('')
        : lists.length ? `<p class="bv-foot">${esc(t('collector.noResults'))}</p>`
        : emptyState({ icon: 'list', title: t('bvVault.listsEmptyTitle'), body: t('collections.empty') })}</div>
      <p class="bv-foot vault-lists__storage">${esc(t(isGuestMode() ? 'collections.guestStorage' : 'collections.accountStorage'))}</p>
    </main>`;
    wire();
  }

  function wire() {
    $$('[data-pin]').forEach(button => button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (setPinnedCollection(button.dataset.pin, button.getAttribute('aria-pressed') !== 'true')) paint();
    }));
    $$('[data-open-list]').forEach(button => button.addEventListener('click', () => { haptic('light'); openList(lists.find(list => list.id === button.dataset.openList)); }));
    $$('[data-records]').forEach(row => row.addEventListener('click', () => openRecords(row.dataset.records)));
    $('#collectionRetry')?.addEventListener('click', () => renderSubcollections());
    $('#vaultSearchBtn')?.addEventListener('click', () => {
      haptic('light');
      searchOpen = !searchOpen;
      if (!searchOpen) query = '';
      paint();
      if (searchOpen) $('#listSearch')?.focus();
    });
    $('#listSearch')?.addEventListener('input', (e) => {
      query = e.target.value;
      const pos = e.target.selectionStart;
      paint();
      const input = $('#listSearch');
      input?.focus();
      input?.setSelectionRange(pos, pos);
    });
    $('#vaultMoreBtn')?.addEventListener('click', () => {
      haptic('light');
      openActionSheet({
        title: t('bvVault.moreOptions'),
        groups: [{ rows: [
          { id: 'collectionCreateRow', icon: 'plus', label: t('bvVault.newList'), onClick: () => { if (lists !== null && lists.length < 50 && !busy()) edit(null); } },
          lists?.length ? { id: 'collectionExport', icon: 'download', label: t('collections.export'), sub: t('bvVault.exportListsSub'), onClick: exportLists } : null,
          { id: 'listsMoreChanges', icon: 'bell', label: t('bvVault.whatChanged'), href: '#/changes' },
        ] }],
      });
    });
  }

  async function exportLists() {
    if (!current() || !lists) return;
    try {
      await exportBlob(new Blob([JSON.stringify({ version: 1, subcollections: lists }, null, 2)], { type: 'application/json' }), 'bricksvault-subcollections.json', { title: t('collections.export') });
    } catch {
      if (current()) toast(t('collections.failed'), 'error');
    }
  }

  function openRecords(kind) {
    const rows = kind === 'cost' ? records.missingCost : kind === 'date' ? records.missingDate : records.incomplete;
    const title = kind === 'cost' ? t('bvVault.recordsMissingPrice') : kind === 'date' ? t('bvVault.recordsMissingDate') : t('bvVault.recordsIncomplete');
    showSheet(sheetBody({
      title, sub: t('collections.recordsHint'),
      inner: rows.length
        ? `<div class="bv-group__box collection-insights">${rows.map(row => `<a class="bv-row" href="#/set/${encodeURIComponent(row.set_num)}${kind === 'incomplete' ? '' : '/edit'}"><span class="bv-row__text"><span class="bv-row__title">${esc(row.name || row.set_num)}</span><span class="bv-row__sub">${esc(row.set_num)}</span></span><span class="bv-row__trail">${esc(kind === 'incomplete' ? t('bvVault.recordsOpen') : kind === 'date' ? t('bvVault.addDate') : t('bvVault.addPrice'))}${icon('chev', { size: 20 })}</span></a>`).join('')}</div>`
        : `<p class="bv-sheet__sub">${esc(t('bvVault.recordsAllDone'))}</p>`,
    }));
  }

  function openList(list) {
    if (!list) return;
    const progress = collectionProgress(list, items);
    const pinned = pins().includes(list.id);
    const rows = list.set_nums.map(canonicalSetNum).map(num => {
      const owned = !progress.missing.includes(num);
      const status = owned ? t('collections.owned') : wished.has(num) ? t('bvVault.listOnWishlistShort') : t('collections.wanted');
      return `<a class="bv-row collection-set-link" href="#/set/${encodeURIComponent(num)}"><span class="bv-row__text"><span class="bv-row__title">${esc(names.get(num) || num)}</span><span class="bv-row__sub">${esc(num)}</span></span><span class="bv-row__trail">${owned ? pill(status, 'gain', { icon: 'check' }) : esc(status)}${icon('chev', { size: 20 })}</span></a>`;
    }).join('');
    showSheet(sheetBody({
      title: list.name,
      sub: progress.total ? tPlural('collections.progress', progress.total, { owned: progress.owned, total: progress.total }) : t('collections.noTargets'),
      inner: `<div data-list-sheet="${esc(list.id)}" class="vault-list-sheet">${progress.total ? bar((progress.owned / progress.total) * 100) : ''}
        ${rows ? `<div class="bv-group__box vault-list-sheet__rows">${rows}</div>` : ''}
        <div class="bv-btn-row">
          ${btn(t(pinned ? 'collector.unpin' : 'collector.pin'), { kind: 'tonal', icon: 'star', attrs: { 'data-sheet-pin': list.id, 'aria-pressed': String(pinned) } })}
          ${btn(t('common.edit'), { kind: 'tonal', icon: 'edit', attrs: { 'data-edit': list.id } })}
        </div></div>`,
    }));
    $('#sheet [data-sheet-pin]')?.addEventListener('click', () => {
      if (setPinnedCollection(list.id, !pinned)) { hideSheet(); paint(); }
    });
    $('#sheet [data-edit]')?.addEventListener('click', () => { if (!busy()) edit(list); });
  }

  function edit(list) {
    const id = list?.id || crypto.randomUUID();
    const draft = list || { name: '', set_nums: [], revision: 0 };
    const ownedOptions = [...new Map(insights.rows.map(row => [canonicalSetNum(row.set_num), row])).values()]
      .map(row => `<option value="${esc(canonicalSetNum(row.set_num))}">${esc(row.name || row.set_num)} (${esc(row.set_num)})</option>`).join('');
    showSheet(sheetBody({
      title: t(list ? 'bvVault.editList' : 'bvVault.newList'),
      inner: `<div id="collectionEditor"><form class="bv-form" id="collectionForm" novalidate>
        <fieldset class="vault-list-form">
          <legend class="bv-sr">${esc(t(list ? 'collections.edit' : 'collections.create'))}</legend>
          <div class="bv-field"><label for="collectionName">${esc(t('collections.name'))}</label><div class="bv-field__box"><input id="collectionName" maxlength="80" required value="${esc(draft.name)}" autocomplete="off"></div></div>
          <div class="bv-field"><label for="collectionOwnedSet">${esc(t('collections.chooseOwned'))}</label><div class="bv-field__box"><select id="collectionOwnedSet"><option value="">${esc(t('collections.chooseSet'))}</option>${ownedOptions}</select></div></div>
          <div class="bv-field"><label for="collectionTargets">${esc(t('collections.targets'))}</label><div class="bv-field__box"><textarea id="collectionTargets" rows="4" aria-describedby="collectionTargetsHint">${esc(draft.set_nums.join('\n'))}</textarea></div>
            <span class="bv-field__help" id="collectionTargetsHint">${esc(t('collections.targetsHint'))}</span></div>
          ${btn(t('collections.addOwned'), { kind: 'outline', id: 'collectionAddOwned', size: 'sm', icon: 'plus' })}
          <p class="bv-field__error" id="collectionFormError" role="alert"></p>
          <div class="bv-sheet__actions">
            ${btn(t('common.save'), { type: 'submit', full: true, id: 'collectionSave' })}
            ${btn(t('common.cancel'), { kind: 'tonal', full: true, id: 'collectionCancel' })}
            ${list ? btn(t('bvVault.deleteList'), { kind: 'danger', full: true, id: 'collectionDelete', icon: 'trash' }) : ''}
          </div>
          ${list ? `<div id="collectionDeleteConfirm" class="vault-list-form__confirm" hidden><p class="bv-field__help">${esc(t('collections.deleteHint'))}</p>${btn(t('collections.confirmDelete'), { kind: 'danger-fill', full: true, id: 'collectionConfirmDelete' })}</div>` : ''}
        </fieldset></form></div>`,
    }));
    const form = $('#collectionForm');
    const fieldset = form.querySelector('fieldset');
    const valid = () => current() && form.isConnected;
    const targets = () => $('#collectionTargets').value.split(/[\s,;]+/).filter(Boolean);
    $('#collectionCancel').addEventListener('click', () => hideSheet());
    $('#collectionOwnedSet').addEventListener('change', event => {
      const value = event.target.value;
      if (!value) return;
      const next = [...new Set([...targets().map(canonicalSetNum), value])];
      if (next.length > 200) { $('#collectionFormError').textContent = t('collections.invalid'); return; }
      $('#collectionTargets').value = next.join('\n');
      event.target.value = '';
    });
    $('#collectionAddOwned').addEventListener('click', () => {
      const next = [...new Set([...targets().map(canonicalSetNum), ...insights.rows.map(row => canonicalSetNum(row.set_num))])];
      if (next.length > 200) { $('#collectionFormError').textContent = t('collections.invalid'); return; }
      $('#collectionTargets').value = next.join('\n');
    });
    const save = async method => {
      if (!valid() || fieldset.disabled) return;
      let body;
      try { body = method === 'DELETE' ? { revision: draft.revision } : normalizeSubcollection({ name: $('#collectionName').value, set_nums: targets(), revision: draft.revision }); }
      catch { $('#collectionFormError').textContent = t('collections.invalid'); return; }
      fieldset.disabled = true;
      try {
        const result = await subcollectionRequest(id, { method, body });
        if (!valid()) return;
        if (method !== 'DELETE') {
          normalizeSubcollection(result?.subcollection);
          if (result.subcollection.id !== id || result.subcollection.revision !== draft.revision + 1) throw new Error('unconfirmed');
        }
        lists = lists.filter(row => row.id !== id);
        if (method !== 'DELETE') lists.push(result.subcollection);
        hideSheet();
        paint();
        toast(t(method === 'DELETE' ? 'bvVault.listDeleted' : 'bvVault.listSaved'), 'success');
      } catch (error) {
        if (valid()) { $('#collectionFormError').textContent = message(error); fieldset.disabled = false; }
      }
    };
    form.addEventListener('submit', event => { event.preventDefault(); save('PUT'); });
    $('#collectionDelete')?.addEventListener('click', () => { $('#collectionDeleteConfirm').hidden = false; $('#collectionConfirmDelete')?.focus(); });
    $('#collectionConfirmDelete')?.addEventListener('click', () => save('DELETE'));
    if (!list) setTimeout(() => { if (form.isConnected) $('#collectionName')?.focus(); }, 320);
  }
  // A pinned-list deep link (?list=) is highlighted and focused by the shell's
  // scroll restore once this paint lands.
  paint();
}
