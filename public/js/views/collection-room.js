import { $, escapeHtml, thumbImg } from '../utils.js';
import { api, getSessionOwnerSnapshot } from '../api.js';
import { state } from '../state.js';
import { t, tPlural } from '../lib/i18n.js';
import { collectionRoomCatalog } from '../lib/collection-room.js';
import { showSheet, hideSheet } from '../components/sheet.js';

let generation = 0;
let activeRoom = null;
let rememberedPose = null;
let roomSheet = false;
const inRoom = () => location.hash.split('?')[0] === '#/room';
function releaseRoom(remember = true) {
  if (remember && activeRoom) rememberedPose = { owner: getSessionOwnerSnapshot(), pose: activeRoom.getPose() };
  activeRoom?.destroy();
  activeRoom = null;
}
window.addEventListener('bv:owner-changed', () => {
  generation++;
  rememberedPose = null;
  releaseRoom(false);
  if (roomSheet) hideSheet();
  if ($('#collectionRoomPage')) $('#root').replaceChildren();
});
window.addEventListener('hashchange', () => {
  if (!inRoom()) { generation++; releaseRoom(); }
});
// go() can use pushState instead of hashchange; release on root removal too.
new MutationObserver(() => {
  if (activeRoom && !$('#collectionRoomPage')) releaseRoom();
}).observe(document.getElementById('root'), { childList: true });

export async function renderCollectionRoom() {
  const version = ++generation;
  releaseRoom();
  const owner = getSessionOwnerSnapshot();
  const current = () => {
    const now = getSessionOwnerSnapshot();
    return version === generation && now.userId === owner.userId && now.generation === owner.generation && inRoom();
  };
  $('#root').innerHTML = `<main id="collectionRoomPage" class="showroom"><a class="showroom-exit" href="#/">${t('room.exit')}</a><p class="showroom-loading" role="status">${t('room.loading')}</p></main>`;
  let data;
  let stale = false;
  try { data = await api('/api/collection'); }
  catch { data = state.portfolio; stale = true; }
  if (!current()) return;
  if (!data || !Array.isArray(data.items)) {
    $('#root').innerHTML = `<main class="showroom showroom-fallback" id="collectionRoomPage"><a href="#/">${t('room.exit')}</a><h1>${t('room.title')}</h1><p role="alert">${t('collections.failed')}</p><button class="btn-secondary" id="roomRetry">${t('collections.retry')}</button></main>`;
    $('#roomRetry').addEventListener('click', renderCollectionRoom);
    return;
  }
  const catalog = collectionRoomCatalog(data.items);
  const themeName = item => item.theme || t('room.otherTheme');
  let failed = false;
  const initialPose = rememberedPose?.owner.userId === owner.userId && rememberedPose.owner.generation === owner.generation ? rememberedPose.pose : undefined;
  $('#root').innerHTML = `<main id="collectionRoomPage" class="showroom" aria-label="${escapeHtml(t('room.title'))}">
    <div id="roomStage" class="showroom-stage" tabindex="0" aria-label="${escapeHtml(t('room.walkInstructions'))}" data-room-state="loading"></div>
    <header class="showroom-bar"><a href="#/" class="showroom-exit">${t('room.exit')}</a><div class="showroom-heading"><h1>${t('room.title')}</h1><span>${escapeHtml(tPlural('room.count', catalog.length, { count: catalog.length }))}</span></div>
      <button type="button" id="roomFind">${t('room.find')}</button><button type="button" id="roomList">${t('room.accessibleList')}</button></header>
    <div class="showroom-notices"><p id="roomStatus" role="status" aria-live="polite">${t('room.loading')}</p>${stale ? `<p>${t('collections.stale')}</p>` : ''}${state.pendingCollectionOperationList?.length ? `<p>${t('collections.pending')}</p>` : ''}</div>
    <div class="showroom-crosshair" aria-hidden="true"></div>
    <div id="roomJoystick" class="showroom-stick" role="group" aria-label="${escapeHtml(t('room.joystick'))}"><span class="showroom-stick-knob"></span></div>
    <footer class="showroom-controls"><button type="button" id="roomReset">${t('room.resetPosition')}</button><button type="button" id="roomMouse">${t('room.captureMouse')}</button><button type="button" id="roomHelp">${t('room.controls')}</button></footer>
    <div id="roomFallback" class="showroom-fallback-content" hidden></div>
  </main>`;
  const stage = $('#roomStage');
  const status = $('#roomStatus');
  const imageUrl = item => escapeHtml(item.image_url ? thumbImg(item.image_url, 400) : '/brand-brick-transparent.png');
  function modal(html, invoker) {
    if (!current()) return;
    activeRoom?.setPaused(true);
    invoker?.focus({ preventScroll: true });
    showSheet(`<div class="showroom-sheet">${html}<button type="button" class="btn-secondary" id="roomSheetClose">${t('room.backToRoom')}</button></div>`);
    roomSheet = true;
    $('#sheet').setAttribute('aria-labelledby', 'roomSheetTitle');
    $('#sheet').addEventListener('sheet:closing', () => {
      roomSheet = false;
      if (current()) { activeRoom?.setPaused(false); stage.focus({ preventScroll: true }); }
    }, { once: true });
    $('#roomSheetClose').addEventListener('click', hideSheet);
    $('#sheet').querySelector('input, button, a')?.focus({ preventScroll: true });
  }
  function details(setNum) {
    if (!current()) return;
    const item = catalog.find(row => row.set_num === setNum);
    if (!item) return;
    if (roomSheet) hideSheet();
    modal(`<h2 id="roomSheetTitle">${escapeHtml(item.name)}</h2><img class="showroom-detail-image" src="${imageUrl(item)}" alt=""><p>${escapeHtml(item.set_num)} · ${escapeHtml(themeName(item))}</p><p>${escapeHtml(tPlural('room.copies', item.quantity, { quantity: item.quantity }))}</p><a class="btn-primary" id="roomFullDetails" href="#/set/${encodeURIComponent(item.set_num)}">${t('room.fullDetails')}</a>`, stage);
    $('#roomFullDetails').addEventListener('click', () => {
      if (activeRoom) rememberedPose = { owner, pose: activeRoom.getPose() };
      hideSheet();
    });
  }
  function browse(find = false) {
    if (!current()) return;
    const themes = [...new Set(catalog.map(item => item.theme))];
    modal(`<h2 id="roomSheetTitle">${t(find ? 'room.find' : 'room.accessibleList')}</h2><label for="roomSearch">${t('room.search')}</label><input class="input" id="roomSearch" type="search" autocomplete="off"><label for="roomTheme">${t('room.theme')}</label><select id="roomTheme"><option value="all">${t('room.allThemes')}</option>${themes.map((theme, index) => `<option value="${index}">${escapeHtml(theme || t('room.otherTheme'))}</option>`).join('')}</select><p id="roomResults" role="status"></p><ul class="showroom-results" id="roomSetList"></ul><button class="btn-secondary" id="roomMore">${t('room.more')}</button>`, $(find ? '#roomFind' : '#roomList'));
    let limit = 40;
    function filter() {
      const query = $('#roomSearch').value.trim().toLocaleLowerCase();
      const selected = $('#roomTheme').value;
      const rows = catalog.filter(item => (selected === 'all' || item.theme === themes[Number(selected)]) && `${item.name} ${item.set_num} ${item.theme}`.toLocaleLowerCase().includes(query));
      $('#roomSetList').innerHTML = rows.slice(0, limit).map(item => `<li><button type="button" data-room-set="${escapeHtml(item.set_num)}"><img src="${imageUrl(item)}" alt="" loading="lazy" width="64" height="54"><span>${escapeHtml(item.name)}<small>${escapeHtml(item.set_num)} · ${escapeHtml(themeName(item))}</small></span></button></li>`).join('');
      $('#roomResults').textContent = tPlural('room.count', rows.length, { count: rows.length });
      $('#roomMore').hidden = limit >= rows.length;
      $('#roomSetList').querySelectorAll('[data-room-set]').forEach(button => button.addEventListener('click', () => {
        if (find && activeRoom) {
          const selectedSet = button.dataset.roomSet;
          hideSheet();
          if (activeRoom?.teleportToSet(selectedSet)) status.textContent = t('room.arrived');
          stage.focus({ preventScroll: true });
        } else details(button.dataset.roomSet);
      }));
    }
    $('#roomSearch').addEventListener('input', () => { limit = 40; filter(); });
    $('#roomTheme').addEventListener('change', () => { limit = 40; filter(); });
    $('#roomMore').addEventListener('click', () => { limit += 40; filter(); });
    filter();
  }
  $('#roomFind').addEventListener('click', () => browse(true));
  $('#roomList').addEventListener('click', () => browse());
  $('#roomReset').addEventListener('click', () => { activeRoom?.reset(); stage.focus({ preventScroll: true }); });
  $('#roomMouse').addEventListener('click', async () => {
    try { await activeRoom?.capturePointer(); }
    catch { if (current()) status.textContent = t('room.mouseUnavailable'); }
  });
  $('#roomHelp').addEventListener('click', () => modal(`<h2 id="roomSheetTitle">${t('room.controls')}</h2><p>${t('room.walkInstructions')}</p><p>${t('room.touchInstructions')}</p><p>${t('room.escapeInstructions')}</p>`, $('#roomHelp')));
  const unavailable = () => {
    if (!current() || !stage.isConnected) return;
    failed = true;
    releaseRoom();
    stage.dataset.roomState = 'unavailable';
    $('#collectionRoomPage').classList.add('showroom-fallback');
    status.textContent = t('room.unavailable');
    $('#roomFallback').hidden = false;
    $('#roomFallback').innerHTML = `<p>${t('room.listHint')}</p><button type="button" class="btn-primary" id="roomFallbackList">${t('room.accessibleList')}</button><button type="button" class="btn-secondary" id="roomRetry3D">${t('room.retry3D')}</button>`;
    $('#roomFallbackList').addEventListener('click', () => browse());
    $('#roomRetry3D').addEventListener('click', renderCollectionRoom);
  };
  try {
    const { createCollectionRoom } = await import('../components/collection-room-scene.js');
    if (!current() || !stage.isConnected) return;
    const controller = await createCollectionRoom(stage, catalog.map(item => ({ ...item, theme: themeName(item), image_url: item.image_url ? thumbImg(item.image_url, 400) : '' })), {
      isCurrent: () => current() && stage.isConnected,
      onSelect: details, onUnavailable: unavailable, joystick: $('#roomJoystick'), initialPose,
    });
    if (!current() || !stage.isConnected || failed) { controller?.destroy(); return; }
    if (!controller) { unavailable(); return; }
    activeRoom = controller;
    controller.setPaused(roomSheet);
    stage.dataset.roomState = 'ready';
    status.textContent = catalog.length ? t('room.walkHint') : t('room.empty');
    if (!roomSheet) stage.focus({ preventScroll: true });
  } catch { unavailable(); }
}
