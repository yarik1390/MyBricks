import { $, escapeHtml, haptic, advisorEnabled, toast } from '../utils.js';
import { I } from '../icons.js';
import { state } from '../state.js';
import { getSessionUserId, getSessionOwnerSnapshot } from '../api.js';
import { getModePref } from '../theme.js';
import { t, tPlural } from '../lib/i18n.js';
import { readCollectorPreferences, writeCollectorPreferences } from '../lib/collector-preferences.js';
import { showSheet, hideSheet } from './sheet.js';
import { toggleAdvisor } from './advisor-lazy.js';
import { openScan } from './scanner-lazy.js';
import { icon, tabs as kitTabs, seg as kitSeg } from '../ui/kit.js';

// Vault sections: Sets · Minifigs · Lists · Build. "What can I build" lives
// with the collection it is computed from, not under Discover.
export function vaultNavigation(selected = 'sets') {
  if (getModePref() === 'kids') return '';
  const items = [
    ['sets', '#/', 'shell.tabSets'],
    ['minifigs', '#/minifigs?owned=1', 'shell.tabMinifigs'],
    ['collections', '#/collections', 'shell.tabLists'],
    ['build', '#/build', 'shell.tabBuild'],
  ];
  return kitTabs(items.map(([key, href, label]) => ({ label: t(label), href, selected: key === selected })),
    { label: t('collector.collectionTabs'), cls: 'collector-tabs' });
}
export function vaultViewSwitch(selected = 'grid') {
  return `<nav class="vault-view-switch" aria-label="${escapeHtml(t('collector.view'))}">
    <a href="#/" data-vault-view="grid" ${selected === 'grid' ? 'aria-current="page"' : ''}>${I.grid()}<span>${t('collector.grid')}</span></a>
    <a href="#/room" data-vault-view="room" ${selected === 'room' ? 'aria-current="page"' : ''}>${I.home()}<span>${t('collector.room')}</span></a>
  </nav>`;
}
// Discover scope: the whole catalog of sets, or minifigures.
export function discoverNavigation(selected = 'sets') {
  return `<div class="bv-discover-scope">${kitSeg([
    { label: t('shell.tabSets'), href: '#/add', current: selected === 'sets' },
    { label: t('shell.tabMinifigs'), href: '#/minifigs?owned=0', current: selected === 'minifigs' },
  ], { label: t('collector.discover') })}</div>`;
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
    if (home) writeCollectorPreferences(getSessionUserId(), { view: 'grid' });
    // Top-bar back arrows rendered as buttons step back through the SPA; a
    // cold deep link (nothing to go back to) lands on the Vault instead.
    const back = target?.closest('button[data-bv-back]');
    if (back) {
      event.preventDefault();
      if (history.length > 1) history.back();
      else location.hash = back.dataset.bvBackFallback || '#/';
    }
    if (target?.closest('[data-bv-sheet-close]')) { event.preventDefault(); hideSheet(); }
  });
  installFabScroll();
}

// ---------------------------------------------------------------- Scan FAB
// One floating primary action per screen. Routes opt in through route-meta
// (`scanFab`); a view can replace it for its own screen with setPageFab() (the
// Lists tab shows "New list", the Wishlist "Add"). The router resets it on
// every navigation, before the next view renders.
let pageFab = null;
function defaultFab() {
  return { label: t('shell.scanToAdd'), icon: 'scan', onClick: () => { haptic('light'); openScan('barcode'); } };
}
function fabEl() {
  let el = document.getElementById('bvFab');
  if (!el) {
    el = document.createElement('button');
    el.id = 'bvFab';
    el.type = 'button';
    el.className = 'bv-fab';
    el.hidden = true;
    el.addEventListener('click', event => {
      const cfg = el._bvFab;
      if (!cfg) return;
      if (cfg.href) { location.hash = cfg.href; return; }
      cfg.onClick?.(event);
    });
    document.body.appendChild(el);
  }
  return el;
}
function paintFab(cfg) {
  const el = fabEl();
  el._bvFab = cfg;
  if (!cfg) { el.hidden = true; document.body.classList.remove('bv-fab-on'); syncAdvisorFab(); return; }
  el.innerHTML = `${icon(cfg.icon || 'scan')}<span class="bv-fab__label">${escapeHtml(cfg.label)}</span>`;
  el.setAttribute('aria-label', cfg.label);
  el.classList.remove('is-compact');
  el.hidden = false;
  document.body.classList.add('bv-fab-on');
  syncAdvisorFab();
}

// Only one floating action at a time: the advisor button steps aside while the
// screen shows a primary FAB (Scan, Add, New list) and comes back when it
// doesn't, on every route that offers the advisor (route meta `fab`).
let advisorWanted = false;
function syncAdvisorFab() {
  const adv = document.getElementById('advisorFab');
  if (!adv || getModePref() === 'kids') return;
  const primaryShown = document.getElementById('bvFab')?.hidden === false;
  adv.style.display = advisorWanted && advisorEnabled() && !primaryShown ? 'flex' : 'none';
}
/** Replace this screen's FAB ({ label, icon, href | onClick }), or hide it with null. */
export function setPageFab(cfg) {
  pageFab = cfg === null ? { hidden: true } : cfg;
  paintFab(cfg === null ? null : cfg);
}
/** Called by the router before each view renders. */
export function resetPageFab() { pageFab = null; }

function installFabScroll() {
  let lastY = window.scrollY;
  let ticking = false;
  const update = () => {
    ticking = false;
    const el = document.getElementById('bvFab');
    const y = window.scrollY;
    const dy = y - lastY;
    if (!el) return;
    if (y < 80) { el.classList.remove('is-compact'); lastY = y; return; }
    if (Math.abs(dy) < 12) return;
    el.classList.toggle('is-compact', dy > 0);
    lastY = y;
  };
  document.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
}

// ---------------------------------------------------------------- nav badges
const navBadges = new Map();
/** Count badge on a bottom-nav destination (e.g. unread wishlist alerts). */
export function setNavBadge(route, count) {
  navBadges.set(route, Number(count) || 0);
  paintNavBadges();
}
export function paintNavBadges() {
  navBadges.forEach((count, route) => {
    const tab = document.querySelector(`#nav .nav-tab[data-route="${route}"]`);
    const host = tab?.querySelector('.nav-icon');
    if (!host) return;
    let badge = host.querySelector('.nav-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.setAttribute('aria-hidden', 'true');
      host.appendChild(badge);
    }
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    const label = tab.querySelector('.nav-label')?.textContent || '';
    tab.setAttribute('aria-label', count > 0 ? `${label}, ${tPlural('shell.alerts', count)}` : label);
  });
}

export function syncCollectorChrome(meta) {
  installCollectorShell();
  const kids = getModePref() === 'kids';
  document.body.classList.toggle('collector-ui', !kids);
  // Details, the scanner and full-screen views hide the bottom bar.
  document.body.classList.toggle('bv-nav-off', !kids && (!!meta.fullscreen || !!meta.navOff));
  // The legacy "+ Add" nav button is superseded by the Scan FAB.
  $('#collectorAdd')?.remove();
  advisorWanted = !!meta.fab;
  if (kids) paintFab(null);
  else if (pageFab) paintFab(pageFab.hidden ? null : pageFab);
  else paintFab(meta.scanFab && !meta.fullscreen ? defaultFab() : null);
  document.querySelectorAll('#nav .nav-tab').forEach(link => {
    if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  paintNavBadges();
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
