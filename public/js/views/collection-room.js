import { $, escapeHtml, thumbImg } from '../utils.js';
import { api, getSessionOwnerSnapshot } from '../api.js';
import { state } from '../state.js';
import { t, tPlural } from '../lib/i18n.js';
import { collectionRoomCatalog, collectionRoomPage } from '../lib/collection-room.js';

let generation = 0;
let activeRoom = null;
window.addEventListener('bv:owner-changed', () => {
  generation++;
  activeRoom?.destroy();
  activeRoom = null;
  if ($('#collectionRoomPage')) $('#root').replaceChildren();
});
window.addEventListener('hashchange', () => {
  if (location.hash.split('?')[0] !== '#/room') {
    generation++;
    activeRoom?.destroy();
    activeRoom = null;
  }
});

export async function renderCollectionRoom() {
  const version = ++generation;
  activeRoom?.destroy();
  activeRoom = null;
  const owner = getSessionOwnerSnapshot();
  const current = () => {
    const now = getSessionOwnerSnapshot();
    return version === generation && now.userId === owner.userId && now.generation === owner.generation
      && location.hash.split('?')[0] === '#/room';
  };
  $('#root').innerHTML = `<main class="page collections-page room-page" id="collectionRoomPage"><p role="status">${t('collections.loading')}</p></main>`;
  let data;
  let stale = false;
  try { data = await api('/api/collection'); }
  catch { data = state.portfolio; stale = true; }
  if (!current()) return;
  if (!data || !Array.isArray(data.items)) {
    $('#root').innerHTML = `<main class="page collections-page room-page" id="collectionRoomPage"><a href="#/">${t('collections.back')}</a><h1>${t('room.title')}</h1><p role="alert">${t('collections.failed')}</p><button class="btn-secondary" id="roomRetry">${t('collections.retry')}</button></main>`;
    $('#roomRetry').addEventListener('click', renderCollectionRoom);
    return;
  }
  const catalog = collectionRoomCatalog(data.items);
  const themes = [...new Set(catalog.map(item => item.theme))];
  let theme = null;
  let page = 0;
  let sceneRequest = 0;
  let wants3D = false;

  async function openRoom(shelves) {
    const request = ++sceneRequest;
    const stage = $('#roomStage');
    const status = $('#roomStatus');
    const button = $('#roomToggle');
    const valid = () => current() && request === sceneRequest && stage.isConnected;
    button.disabled = true;
    status.textContent = t('room.loading');
    stage.hidden = false;
    stage.dataset.roomState = 'loading';
    const unavailable = () => {
      if (!valid()) return;
      activeRoom = null;
      wants3D = false;
      stage.hidden = true;
      stage.dataset.roomState = 'unavailable';
      $('#roomControls').hidden = true;
      button.disabled = false;
      button.textContent = t('room.open');
      button.setAttribute('aria-expanded', 'false');
      status.textContent = t('room.unavailable');
    };
    try {
      const { createCollectionRoom } = await import('../components/collection-room-scene.js');
      if (!valid()) return;
      const controller = await createCollectionRoom(stage, shelves.map(shelf => ({
        theme: shelf.theme || t('room.otherTheme'),
        items: shelf.items.map(item => ({ ...item, image_url: item.image_url ? thumbImg(item.image_url, 400) : '' })),
      })), { isCurrent: valid, onUnavailable: unavailable, onSelect: setNum => {
        if (valid()) location.hash = `#/set/${encodeURIComponent(setNum)}`;
      } });
      if (!valid()) { controller?.destroy(); return; }
      if (!controller) { unavailable(); return; }
      activeRoom = controller;
      stage.dataset.roomState = 'ready';
      $('#roomControls').hidden = false;
      button.disabled = false;
      button.textContent = t('room.close');
      button.setAttribute('aria-expanded', 'true');
      status.textContent = t('room.hint');
    } catch { unavailable(); }
  }

  function paint() {
    sceneRequest++;
    activeRoom?.destroy();
    activeRoom = null;
    if (!current()) return;
    const result = collectionRoomPage(catalog, theme, page);
    page = result.page;
    $('#root').innerHTML = `<main class="page collections-page room-page" id="collectionRoomPage">
      <a class="collection-back" href="#/">${t('collections.back')}</a>
      <h1>${t('room.title')}</h1><p>${t('room.description')}</p>
      ${stale ? `<p role="status" class="collection-notice">${t('collections.stale')}</p>` : ''}
      ${state.pendingCollectionOperationList?.length ? `<p class="collection-notice">${t('collections.pending')}</p>` : ''}
      ${!catalog.length ? `<section class="card collection-card"><p>${t('room.empty')}</p><a class="btn-primary" href="#/add">${t('nav.catalog')}</a></section>` : `
        <div class="room-toolbar"><label for="roomTheme">${t('room.theme')}</label>
          <select id="roomTheme"><option value="all">${t('room.allThemes')}</option>${themes.map((name, index) => `<option value="${index}" ${name === theme ? 'selected' : ''}>${escapeHtml(name || t('room.otherTheme'))}</option>`).join('')}</select>
          <button type="button" class="btn-primary" id="roomToggle" aria-expanded="false" aria-controls="roomStage">${t('room.open')}</button>
        </div>
        <p>${escapeHtml(tPlural('room.count', result.count, { count: result.count }))}</p>
        <p id="roomStatus" role="status" aria-live="polite"></p>
        <div class="room-stage" id="roomStage" hidden></div>
        <div class="room-controls" id="roomControls" hidden>
          ${['left', 'right', 'closer', 'farther', 'reset'].map(action => `<button type="button" class="btn-secondary" data-room-action="${action}">${t(`room.${action}`)}</button>`).join('')}
        </div>
        <h2 class="room-shelves-title">${t('room.shelves')}</h2>
        <div id="roomShelves">${result.shelves.map(shelf => `<section class="card room-shelf"><h3>${escapeHtml(shelf.theme || t('room.otherTheme'))}</h3><ul>${shelf.items.map(item => `<li><a class="room-set" href="#/set/${encodeURIComponent(item.set_num)}">
          <img class="set-photo" src="${escapeHtml(item.image_url ? thumbImg(item.image_url, 400) : '/brand-brick-transparent.png')}" alt="" loading="lazy" decoding="async" width="160" height="120">
          <span>${escapeHtml(item.name)}</span><small>${escapeHtml(item.set_num)} <span aria-hidden="true">&times;</span> ${item.quantity}</small>
        </a></li>`).join('')}</ul></section>`).join('')}</div>
        <nav class="room-pagination" aria-label="${t('room.shelves')}">
          <button class="btn-secondary" id="roomPrevious" ${page === 0 ? 'disabled' : ''}>${t('room.previous')}</button>
          <span role="status">${escapeHtml(t('room.page', { page: page + 1, total: result.pages }))}</span>
          <button class="btn-secondary" id="roomNext" ${page === result.pages - 1 ? 'disabled' : ''}>${t('room.next')}</button>
        </nav>`}
    </main>`;
    if (!catalog.length) return;
    $('#roomTheme').addEventListener('change', event => {
      theme = event.target.value === 'all' ? null : themes[Number(event.target.value)];
      page = 0;
      paint();
      $('#roomTheme').focus();
    });
    const turnPage = delta => {
      page += delta;
      paint();
      let focusNext = page === 0;
      if (delta > 0) focusNext = page !== result.pages - 1;
      $(focusNext ? '#roomNext' : '#roomPrevious')?.focus();
    };
    $('#roomPrevious').addEventListener('click', () => turnPage(-1));
    $('#roomNext').addEventListener('click', () => turnPage(1));
    $('#roomToggle').addEventListener('click', () => {
      wants3D = !wants3D;
      if (wants3D) openRoom(result.shelves);
      else {
        sceneRequest++;
        activeRoom?.destroy();
        activeRoom = null;
        $('#roomStage').hidden = true;
        $('#roomControls').hidden = true;
        $('#roomStatus').textContent = '';
        $('#roomToggle').textContent = t('room.open');
        $('#roomToggle').setAttribute('aria-expanded', 'false');
      }
    });
    document.querySelectorAll('[data-room-action]').forEach(button => button.addEventListener('click', () => activeRoom?.move(button.dataset.roomAction)));
    if (wants3D) openRoom(result.shelves);
  }
  paint();
}
