import { $, escapeHtml, haptic, advisorEnabled, toast } from '../utils.js';
import { I } from '../icons.js';
import { state } from '../state.js';
import { getSessionUserId, getSessionOwnerSnapshot } from '../api.js';
import { getModePref } from '../theme.js';
import { t } from '../lib/i18n.js';
import { readCollectorPreferences, writeCollectorPreferences } from '../lib/collector-preferences.js';
import { showSheet, hideSheet } from './sheet.js';
import { toggleAdvisor } from './advisor-lazy.js';

export function vaultNavigation(selected = 'sets') {
  if (getModePref() === 'kids') return '';
  return `<nav class="collector-tabs" aria-label="${escapeHtml(t('collector.collectionTabs'))}">
    ${[['sets', '#/', 'sets'], ['minifigs', '#/minifigs?owned=1', 'minifigures'], ['collections', '#/collections', 'collections']].map(([key, href, label]) => `<a href="${href}" ${key === selected ? 'aria-current="page"' : ''}>${t(`collector.${label}`)}</a>`).join('')}
  </nav>`;
}
export function vaultViewSwitch(selected = 'grid') {
  return `<nav class="vault-view-switch" aria-label="${escapeHtml(t('collector.view'))}">
    <a href="#/" data-vault-view="grid" ${selected === 'grid' ? 'aria-current="page"' : ''}>${I.grid()}<span>${t('collector.grid')}</span></a>
    <a href="#/room" data-vault-view="room" ${selected === 'room' ? 'aria-current="page"' : ''}>${I.home()}<span>${t('collector.room')}</span></a>
  </nav>`;
}
export function discoverNavigation(selected = 'sets') {
  return `<nav class="collector-tabs" aria-label="${escapeHtml(t('collector.discover'))}">${[['sets', '#/add', 'sets'], ['minifigs', '#/minifigs?owned=0', 'minifigures'], ['build', '#/build', 'buildIdeas']].map(([key, href, label]) => `<a href="${href}" ${key === selected ? 'aria-current="page"' : ''}>${t(`collector.${label}`)}</a>`).join('')}</nav>`;
}
export function collectorTools() {
  return `<div class="collector-tools"><a href="#/build">${I.brick ? I.brick() : I.grid()}<span>${t('collector.buildIdeas')}</span>${I.chev()}</a>${advisorEnabled() ? `<button type="button" data-collector-advisor>${I.spark ? I.spark() : I.info()}<span>${t('collector.advisor')}</span>${I.chev()}</button>` : ''}</div>`;
}
export function openCollectorAdd() {
  showSheet(`<h2>${t('collector.addTitle')}</h2><p class="collector-hint">${t('collector.addHint')}</p>
    <a class="sheet-action" href="#/pile">${I.scan()}<span>${t('collector.scan')}</span>${I.chev()}</a>
    <a class="sheet-action" href="#/add">${I.search()}<span>${t('collector.searchCatalog')}</span>${I.chev()}</a>
    <button class="sheet-action" id="collectorManual">${I.edit ? I.edit() : I.search()}<span>${t('collector.manual')}</span>${I.chev()}</button>`);
  $('#collectorManual').addEventListener('click', () => {
    showSheet(`<h2>${t('collector.manual')}</h2><form id="collectorLookup"><label for="collectorSetNumber">${t('collector.setNumber')}</label><input class="input" id="collectorSetNumber" name="setNumber" inputmode="numeric" pattern="[0-9]+(-[0-9]+)?" maxlength="30" required autocomplete="off" placeholder="10313"><button class="btn-primary" type="submit">${t('collector.findSet')}</button></form>`);
    $('#collectorLookup').addEventListener('submit', event => {
      event.preventDefault();
      const value = $('#collectorSetNumber').value.trim();
      if (!/^\d+(?:-\d+)?$/.test(value)) return;
      hideSheet();
      location.hash = `#/set/${encodeURIComponent(value.includes('-') ? value : `${value}-1`)}`;
    });
    $('#collectorSetNumber').focus();
  });
}

let installed = false;
export function installCollectorShell() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-collector-add]')) { haptic('light'); openCollectorAdd(); }
    if (target?.closest('[data-collector-advisor]')) { haptic('light'); toggleAdvisor(); }
    const view = target?.closest('[data-vault-view]')?.dataset.vaultView;
    if (view) writeCollectorPreferences(getSessionUserId(), { view });
    const home = target?.closest('#nav [data-route="/"]');
    if (home && getModePref() !== 'kids' && readCollectorPreferences(getSessionUserId()).view === 'room') {
      event.preventDefault(); location.hash = '#/room';
    }
  });
}

export function syncCollectorChrome(meta) {
  installCollectorShell();
  const kids = getModePref() === 'kids';
  document.body.classList.toggle('collector-ui', !kids);
  let add = $('#collectorAdd');
  if (!add) {
    add = document.createElement('button');
    add.id = 'collectorAdd'; add.className = 'collector-add'; add.type = 'button';
    add.setAttribute('data-collector-add', '');
    document.body.appendChild(add);
  }
  add.innerHTML = `${I.plus()}<span>${t('collector.add')}</span>`;
  add.hidden = kids || !['vault', 'catalog', 'minifigs', 'wishlist', 'collections'].includes(meta.key);
  // The advisor remains available contextually; only one floating primary action.
  if (!kids && $('#advisorFab')) $('#advisorFab').style.display = 'none';
  document.querySelectorAll('#nav .nav-tab').forEach(link => {
    if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

export function setPinnedCollection(id, pinned) {
  const owner = getSessionUserId();
  const prefs = readCollectorPreferences(owner);
  const pins = pinned ? [...new Set([...prefs.pins, id])].slice(0, 50) : prefs.pins.filter(x => x !== id);
  if (!writeCollectorPreferences(owner, { pins })) { toast(t('collector.preferenceFailed'), 'error'); return false; }
  haptic('light');
  return true;
}

export function collectionSaveStatus() {
  const pending = state.pendingCollectionOperationList || [];
  if (!pending.length) return '';
  const failed = pending.some(item => item.state === 'failed');
  return `<p class="collector-save-status" role="status">${I.cloud ? I.cloud() : I.info()}${t(failed ? 'collector.saveFailed' : 'collector.savePending')}</p>`;
}

export async function loadPinnedCollections() {
  const host = $('#collectorPinned');
  const owner = getSessionOwnerSnapshot();
  const pins = readCollectorPreferences(owner.userId).pins;
  if (!host || !pins.length) return;
  try {
    const { subcollectionRequest } = await import('../lib/subcollection-storage.js');
    const result = await subcollectionRequest();
    const now = getSessionOwnerSnapshot();
    if (!host.isConnected || now.userId !== owner.userId || now.generation !== owner.generation) return;
    const lists = (result.subcollections || []).filter(list => pins.includes(list.id));
    host.innerHTML = `<nav class="collector-pins" aria-label="${escapeHtml(t('collector.pinned'))}">${lists.map(list => `<a href="#/collections?list=${encodeURIComponent(list.id)}">${escapeHtml(list.name)}</a>`).join('')}</nav>`;
  } catch { /* Pins are optional shortcuts; a failed read never hides the vault. */ }
}

// Navigation state is memory-only and discarded on identity changes. Filters
// already live in the app state; keep each destination's scroll independently.
const scrollPositions = new Map();
let renderedRoute = null;
export function rememberCollectorScroll() {
  if (renderedRoute) scrollPositions.set(renderedRoute, window.scrollY);
}
export function restoreCollectorScroll(hash) {
  renderedRoute = hash;
  const targetList = new URLSearchParams(location.hash.split('?')[1] || '').get('list');
  if (hash === '/collections' && targetList) {
    const card = [...document.querySelectorAll('[data-list-id]')].find(el => el.dataset.listId === targetList);
    if (card) {
      card.dataset.highlighted = 'true';
      card.tabIndex = -1;
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'center', behavior: 'instant' });
      return;
    }
  }
  const top = scrollPositions.get(hash) || 0;
  window.scrollTo({ top, behavior: 'instant' });
}
window.addEventListener('bv:owner-changed', () => { scrollPositions.clear(); renderedRoute = null; });
