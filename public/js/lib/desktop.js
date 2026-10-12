// Desktop web (≥1024 px wide): the navigation rail grows into a labelled
// sidebar with a search entry and an Explore group, and the keyboard gets
// shortcuts. Everything here is inert on phones: the extra sidebar markup is
// hidden below the breakpoint by desktop.css and shortcuts need a keyboard.
import { t, onLocaleChange } from './i18n.js';
import { icon } from '../ui/kit.js';
import { showSheet } from '../components/sheet.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Explore: pages that sit one level down on the phone, one click away here.
const EXPLORE = [
  { href: '#/insights', key: 'bvVault.insights', icon: 'pie' },
  { href: '#/retiring', key: 'bvAdd.retiringSoon', icon: 'clock' },
  { href: '#/upcoming', key: 'bvCommon.comingSoon', icon: 'cal' },
  { href: '#/game', key: 'bvCommunity.gameTitle', icon: 'game' },
  { href: '#/advisor', key: 'bvCommunity.advTitle', icon: 'chat' },
];

// "g" then a letter jumps to a destination.
const GO = { v: '#/', d: '#/add', w: '#/wishlist', p: '#/me', i: '#/insights', r: '#/retiring', c: '#/upcoming' };
const GO_LABEL = { v: 'nav.vault', d: 'collector.discover', w: 'bvAdd.tabWishlist', p: 'bvAccount.profile', i: 'bvVault.insights', r: 'bvAdd.retiringSoon', c: 'bvCommon.comingSoon' };

function sidebarHTML() {
  return {
    head: `<a class="bv-side__brand" href="#/" aria-label="${esc(t('nav.vault'))}"><img src="/icon-192.png" alt="" width="32" height="32"><span>BricksVault</span></a>`
      + `<button type="button" class="bv-side__search" data-bv-side-search><span class="bv-side__search-ico">${icon('search', { size: 18 })}</span><span class="bv-side__search-text">${esc(t('desktop.search'))}</span><kbd>/</kbd></button>`,
    explore: `<span class="bv-side__label">${esc(t('desktop.explore'))}</span>`
      + EXPLORE.map((x) => `<a class="bv-side__link" href="${x.href}" data-bv-side="${x.href}">${icon(x.icon, { size: 20 })}<span>${esc(t(x.key))}</span></a>`).join('')
      + `<button type="button" class="bv-side__link" data-bv-shortcuts>${icon('kbd', { size: 20 })}<span>${esc(t('desktop.shortcuts'))}</span><kbd>?</kbd></button>`,
  };
}

function paintSidebar() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.querySelectorAll('.bv-side').forEach((el) => el.remove());
  const html = sidebarHTML();
  nav.insertAdjacentHTML('afterbegin', `<div class="bv-side bv-side--head">${html.head}</div>`);
  nav.insertAdjacentHTML('beforeend', `<div class="bv-side bv-side--explore">${html.explore}</div>`);
  markCurrent();
}

function markCurrent() {
  const hash = (location.hash || '#/').split('?')[0];
  document.querySelectorAll('#nav [data-bv-side]').forEach((a) => {
    if (a.dataset.bvSide === hash) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

const isTyping = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Focus the search box on this page; with none, open Discover and focus its search. */
export function focusSearch() {
  const field = document.querySelector('#root .bv-search input, #root input[type="search"]');
  if (field) { field.focus(); field.select?.(); return; }
  location.hash = '#/add';
  let tries = 0;
  const wait = () => {
    const input = document.getElementById('catalogSearch');
    if (input) { input.focus(); return; }
    if (++tries < 40) setTimeout(wait, 50);
  };
  wait();
}

export function openShortcuts() {
  const row = (keys, label) => `<div class="bv-keys__row"><span>${esc(label)}</span><span class="bv-keys__k">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span></div>`;
  const go = Object.keys(GO).map((k) => row(['g', k], t('desktop.goTo', { place: t(GO_LABEL[k]) }))).join('');
  showSheet(`<div class="bv-sheet bv-keys"><div class="bv-sheet__head"><h2>${esc(t('desktop.shortcuts'))}</h2></div>
    <div class="bv-keys__list">${row(['/'], t('desktop.kSearch'))}${go}${row(['?'], t('desktop.kHelp'))}${row(['Esc'], t('desktop.kClose'))}</div></div>`);
}

let pendingG = 0;
function onKey(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isTyping(document.activeElement)) return;
  if (!document.body.classList.contains('collector-ui')) return; // Kids Mode keeps its own shell
  if (document.body.classList.contains('scan-active')) return;
  const k = e.key;
  if (pendingG && Date.now() - pendingG < 1200) {
    pendingG = 0;
    const target = GO[k.toLowerCase()];
    if (target) { e.preventDefault(); location.hash = target; }
    return;
  }
  pendingG = 0;
  if (document.body.classList.contains('sheet-open')) return;
  if (k === '/') { e.preventDefault(); focusSearch(); }
  else if (k === '?') { e.preventDefault(); openShortcuts(); }
  else if (k === 'g') pendingG = Date.now();
}

let installed = false;
export function installDesktop() {
  if (installed) return;
  installed = true;
  paintSidebar();
  onLocaleChange(paintSidebar);
  window.addEventListener('hashchange', markCurrent);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-bv-side-search]')) { e.preventDefault(); focusSearch(); }
    if (target?.closest('[data-bv-shortcuts]')) { e.preventDefault(); openShortcuts(); }
  });
}
