import { $, escapeHtml } from '../utils.js';
import { api, getSessionOwnerSnapshot, isGuestMode } from '../api.js';
import { state } from '../state.js';
import { t, tPlural } from '../lib/i18n.js';
import { canonicalSetNum, collectionProgress, collectorInsights, normalizeSubcollection } from '../lib/subcollections.js';
import { subcollectionRequest } from '../lib/subcollection-storage.js';
import { exportBlob } from '../lib/native-file-export.js';

let renderGeneration = 0;
window.addEventListener('bv:owner-changed', () => {
  renderGeneration++;
  if (document.querySelector('#subcollectionsPage')) $('#root').replaceChildren();
});

export async function renderSubcollections() {
  const generation = ++renderGeneration;
  const owner = getSessionOwnerSnapshot();
  const current = () => {
    const now = getSessionOwnerSnapshot();
    return generation === renderGeneration && owner.userId === now.userId && owner.generation === now.generation
      && location.hash.split('?')[0] === '#/collections';
  };
  $('#root').innerHTML = `<main class="page collections-page" id="subcollectionsPage"><p role="status">${t('collections.loading')}</p></main>`;
  const [holdingsResult, listsResult] = await Promise.allSettled([api('/api/collection'), subcollectionRequest()]);
  if (!current()) return;
  const holdingsFresh = holdingsResult.status === 'fulfilled';
  const items = holdingsFresh ? (holdingsResult.value.items || []) : (state.portfolio?.items || []);
  let lists = listsResult.status === 'fulfilled' ? listsResult.value.subcollections : null;
  if (!Array.isArray(lists)) lists = null;
  const insights = collectorInsights(items);
  const busy = () => document.querySelector('#collectionEditor fieldset')?.disabled;
  const message = error => t(error?.status === 409 ? 'collections.conflict' : 'collections.failed');

  const setLinks = rows => rows.map(row => `<a class="collection-set-link" href="#/set/${encodeURIComponent(row.set_num)}"><span>${escapeHtml(row.name || row.set_num)}</span><small>${escapeHtml(row.set_num)}</small></a>`).join('');
  const listHTML = list => {
    const progress = collectionProgress(list, items);
    const names = new Map(items.map(row => [canonicalSetNum(row.set_num), row.name]));
    return `<article class="card collection-card" data-list-id="${escapeHtml(list.id)}">
      <h2>${escapeHtml(list.name)}</h2>
      <p>${escapeHtml(tPlural('collections.progress', progress.total, { owned: progress.owned, total: progress.total }))}${progress.complete ? ` · ${t('collections.completed')}` : ''}</p>
      <progress max="${progress.total || 1}" value="${progress.owned}" aria-label="${escapeHtml(tPlural('collections.progress', progress.total, { owned: progress.owned, total: progress.total }))}"></progress>
      ${!progress.total ? `<p>${t('collections.noTargets')}</p>` : `<details><summary>${t('collections.showSets')}</summary>${list.set_nums.map(num => `<a class="collection-set-link" href="#/set/${encodeURIComponent(num)}"><span>${escapeHtml(names.get(num) || num)}</span><small>${progress.missing.includes(num) ? t('collections.wanted') : t('collections.owned')}</small></a>`).join('')}</details>`}
      <div class="collection-actions"><button class="btn-secondary" data-edit="${escapeHtml(list.id)}">${t('common.edit')}</button></div>
    </article>`;
  };
  function paint() {
    if (!current()) return;
    $('#root').innerHTML = `<main class="page collections-page" id="subcollectionsPage">
      <a class="collection-back" href="#/">${t('collections.back')}</a>
      <h1>${t('collections.title')}</h1><p>${t('collections.description')}</p>
      ${!holdingsFresh ? `<p role="status" class="collection-notice">${t('collections.stale')}</p>` : ''}
      ${state.pendingCollectionOperationList?.length ? `<p role="status" class="collection-notice">${t('collections.pending')}</p>` : ''}
      <section class="card collection-card" aria-labelledby="collectorInsightsTitle">
        <h2 id="collectorInsightsTitle">${t('collections.insights')}</h2>
        <p>${escapeHtml(tPlural('collections.distinct', insights.distinct))}</p>
        <div class="collection-insights">
          <details><summary>${escapeHtml(tPlural('collections.missingCost', insights.missingCost.length))}</summary>${setLinks(insights.missingCost)}</details>
          <details><summary>${escapeHtml(tPlural('collections.missingDate', insights.missingDate.length))}</summary>${setLinks(insights.missingDate)}</details>
          <details><summary>${escapeHtml(tPlural('collections.completeHoldings', insights.complete.length))}</summary>${setLinks(insights.complete)}</details>
          <details><summary>${escapeHtml(tPlural('collections.incompleteHoldings', insights.incomplete.length))}</summary>${setLinks(insights.incomplete)}</details>
        </div><p class="collection-hint">${t('collections.recordsHint')}</p>
      </section>
      <div class="collection-heading"><h2>${t('collections.lists')}</h2><div class="collection-actions">
        <button class="btn-primary" id="collectionCreate" ${lists === null || lists.length >= 50 ? 'disabled' : ''}>${t('collections.create')}</button>
        <button class="btn-secondary" id="collectionExport" ${!lists?.length ? 'disabled' : ''}>${t('collections.export')}</button>
      </div></div>
      <p class="collection-hint">${t(isGuestMode() ? 'collections.guestStorage' : 'collections.accountStorage')}</p>
      <p id="collectionExportError" role="alert"></p>
      <div id="collectionEditor"></div>
      <div id="collectionLists">${lists === null ? `<p role="alert">${t('collections.failed')}</p><button class="btn-secondary" id="collectionRetry">${t('collections.retry')}</button>` : lists.length ? lists.map(listHTML).join('') : `<p>${t('collections.empty')}</p>`}</div>
    </main>`;
    $('#collectionCreate').addEventListener('click', () => { if (!busy()) edit(null); });
    $('#collectionRetry')?.addEventListener('click', () => renderSubcollections());
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
      if (!busy()) edit(lists.find(list => list.id === button.dataset.edit));
    }));
    $('#collectionExport').addEventListener('click', async () => {
      if (!current() || !lists) return;
      try {
        await exportBlob(new Blob([JSON.stringify({ version: 1, subcollections: lists }, null, 2)], { type: 'application/json' }), 'bricksvault-subcollections.json', { title: t('collections.export') });
      } catch {
        if (current()) $('#collectionExportError').textContent = t('collections.failed');
      }
    });
  }
  function edit(list) {
    const id = list?.id || crypto.randomUUID();
    const draft = list || { name: '', set_nums: [], revision: 0 };
    const editor = $('#collectionEditor');
    editor.innerHTML = `<form class="card collection-card" id="collectionForm">
      <fieldset><legend>${t(list ? 'collections.edit' : 'collections.create')}</legend>
      <label for="collectionName">${t('collections.name')}</label>
      <input class="input" id="collectionName" maxlength="80" required value="${escapeHtml(draft.name)}">
      <label for="collectionOwnedSet">${t('collections.chooseOwned')}</label>
      <select class="input" id="collectionOwnedSet"><option value="">${t('collections.chooseSet')}</option>${[...new Map(insights.rows.map(row => [canonicalSetNum(row.set_num), row])).values()].map(row => `<option value="${escapeHtml(canonicalSetNum(row.set_num))}">${escapeHtml(row.name || row.set_num)} (${escapeHtml(row.set_num)})</option>`).join('')}</select>
      <label for="collectionTargets">${t('collections.targets')}</label>
      <textarea class="input" id="collectionTargets" rows="4" aria-describedby="collectionTargetsHint">${escapeHtml(draft.set_nums.join('\n'))}</textarea>
      <p id="collectionTargetsHint" class="collection-hint">${t('collections.targetsHint')}</p>
      <button type="button" class="btn-secondary" id="collectionAddOwned">${t('collections.addOwned')}</button>
      <p id="collectionFormError" role="alert"></p>
      <div class="collection-actions"><button type="submit" class="btn-primary">${t('common.save')}</button><button type="button" class="btn-secondary" id="collectionCancel">${t('common.cancel')}</button>
      ${list ? `<button type="button" class="btn-secondary" id="collectionDelete">${t('common.delete')}</button>` : ''}</div>
      ${list ? `<div id="collectionDeleteConfirm" hidden><p>${t('collections.deleteHint')}</p><button type="button" class="btn-secondary" id="collectionConfirmDelete">${t('collections.confirmDelete')}</button></div>` : ''}
      </fieldset></form>`;
    editor.scrollIntoView({ block: 'nearest' });
    $('#collectionName').focus();
    const form = $('#collectionForm');
    const fieldset = form.querySelector('fieldset');
    const valid = () => current() && form.isConnected;
    const targets = () => $('#collectionTargets').value.split(/[\s,;]+/).filter(Boolean);
    $('#collectionCancel').addEventListener('click', () => editor.replaceChildren());
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
        paint();
      } catch (error) {
        if (valid()) { $('#collectionFormError').textContent = message(error); fieldset.disabled = false; }
      }
    };
    form.addEventListener('submit', event => { event.preventDefault(); save('PUT'); });
    $('#collectionDelete')?.addEventListener('click', () => { $('#collectionDeleteConfirm').hidden = false; });
    $('#collectionConfirmDelete')?.addEventListener('click', () => save('DELETE'));
  }
  paint();
}
