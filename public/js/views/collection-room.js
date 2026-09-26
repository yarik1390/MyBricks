import { icon } from '../ui/kit.js';
import { $, escapeHtml, thumbImg, proxyImg } from '../utils.js';
import { api, getSessionOwnerSnapshot } from '../api.js';
import { state } from '../state.js';
import { t, tPlural } from '../lib/i18n.js';
import {
  boxArtworkPresentation,
  collectionRoomCatalog,
  displayCartonDimensions,
  getBoxFrontQuad,
  resolveBoxBackImageUrl,
  unwarpQuadToCanvas,
} from '../lib/collection-room.js';
import { showSheet, hideSheet } from '../components/sheet.js';

let generation = 0;
let activeRoom = null;
let activeIntro = null;
let rememberedPose = null;
let roomSheet = false;
const inRoom = () => location.hash.split('?')[0] === '#/room';
function releaseRoom(remember = true) {
  activeIntro?.destroy();
  activeIntro = null;
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
  if (!inRoom()) {
    generation++;
    releaseRoom(false);
  }
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
  $('#root').innerHTML = `<main id="collectionRoomPage" class="showroom"><a class="showroom-exit" data-vault-view="grid" href="#/">${t('room.exit')}</a><p class="showroom-loading" role="status">${t('room.loading')}</p></main>`;
  let data;
  let stale = false;
  try { data = await api('/api/collection'); }
  catch { data = state.portfolio; stale = true; }
  if (!current()) return;
  if (!data || !Array.isArray(data.items)) {
    $('#root').innerHTML = `<main class="showroom showroom-fallback" id="collectionRoomPage"><a class="showroom-exit" data-vault-view="grid" href="#/">${t('room.exit')}</a><h1>${t('room.title')}</h1><p role="alert">${t('collections.failed')}</p><button class="btn-secondary" id="roomRetry">${t('collections.retry')}</button></main>`;
    $('#roomRetry').addEventListener('click', renderCollectionRoom);
    return;
  }
  const catalog = collectionRoomCatalog(data.items).map(item => ({
    ...item,
    image_url: proxyImg(item.image_url),
    box_image_url: proxyImg(item.box_image_url),
  }));
  const themeName = item => item.theme || t('room.otherTheme');
  let failed = false;
  const initialPose = rememberedPose?.owner.userId === owner.userId && rememberedPose.owner.generation === owner.generation ? rememberedPose.pose : undefined;
  const shelves = [...new Set(catalog.map(themeName))];
  const roomBtn = (id, name, label) => `<button type="button" class="bv-iconbtn bv-room-btn" id="${id}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(name)}</button>`;
  $('#root').innerHTML = `<main id="collectionRoomPage" class="showroom bv-room is-walk" aria-label="${escapeHtml(t('room.title'))}">
    <div id="roomStage" class="showroom-stage" tabindex="0" aria-label="${escapeHtml(t('room.walkInstructions'))}" data-room-state="loading"></div>
    <div class="showroom-chrome-top">
      <header class="bv-room-bar">
        <a class="bv-iconbtn bv-room-btn" href="#/" data-vault-view="grid" aria-label="${escapeHtml(t('bvVault.roomBack'))}">${icon('back')}</a>
        <div class="bv-room-heading"><h1>${escapeHtml(t('bvVault.roomTitle'))}</h1><span>${escapeHtml(tPlural('room.count', catalog.length, { count: catalog.length }))}</span></div>
        ${roomBtn('roomFind', 'search', t('room.find'))}${roomBtn('roomList', 'list', t('room.accessibleList'))}
      </header>
    </div>
    <div class="showroom-crosshair" aria-hidden="true"></div>
    <div class="bv-room-bottom">
      <div class="showroom-notices"><p id="roomStatus" role="status" aria-live="polite">${t('room.loading')}</p>${stale ? `<p>${t('collections.stale')}</p>` : ''}${state.pendingCollectionOperationList?.length ? `<p>${t('collections.pending')}</p>` : ''}</div>
      <div id="roomJoystick" class="showroom-stick" role="group" aria-label="${escapeHtml(t('room.joystick'))}"><span class="showroom-stick-knob"></span></div>
      ${shelves.length > 1 ? `<nav class="bv-room-shelves" aria-label="${escapeHtml(t('bvVault.roomShelves'))}">${shelves.map((name, index) => `<button type="button" class="bv-chip" data-room-shelf="${index}">${escapeHtml(name)}</button>`).join('')}</nav>` : ''}
      <footer class="showroom-controls">${roomBtn('roomReset', 'refresh', t('room.resetPosition'))}${roomBtn('roomMouse', 'eye', t('room.captureMouse'))}${roomBtn('roomHelp', 'info', t('room.controls'))}
        <button type="button" class="bv-btn bv-btn--tonal bv-room-walk" id="roomWalk" aria-pressed="true">${icon('walk', { size: 20 })}<span>${escapeHtml(t('bvVault.roomFreeWalk'))}</span></button></footer>
    </div>
    <div id="roomFallback" class="showroom-fallback-content" hidden></div>
  </main>`;
  const stage = $('#roomStage');
  const status = $('#roomStatus');
  const imageUrl = item => {
    const artwork = boxArtworkPresentation(item);
    return escapeHtml(artwork.url ? thumbImg(artwork.url, 400) : '/brand-brick-transparent.png');
  };
  function modal(html, invoker, { preservePickup = false } = {}) {
    if (!current()) return;
    if (!preservePickup) activeRoom?.beginModalTransition();
    activeRoom?.setPaused(true);
    invoker?.focus({ preventScroll: true });
    showSheet(`<div class="showroom-sheet">${html}<button type="button" class="btn-secondary" id="roomSheetClose">${t('room.backToRoom')}</button></div>`);
    roomSheet = true;
    $('#sheet').setAttribute('aria-labelledby', 'roomSheetTitle');
    $('#sheet').addEventListener('sheet:closing', () => {
      roomSheet = false;
      activeRoom?.setInspecting(false);
      if (current()) {
        // Reconcile the destination after the sheet has completed its close and
        // focus handoff. Scheduling on the next frame keeps the click task and
        // accessibility tree responsive even under software WebGL.
        // Restore the room after showSheet's generic focus restoration has run,
        // but before deferred WebGL drawing can monopolize the main thread.
        queueMicrotask(() => {
          if (!current() || roomSheet) return;
          stage.focus({ preventScroll: true });
          activeRoom?.resumeAfterModal();
        });
      }
    }, { once: true });
    $('#roomSheetClose').addEventListener('click', hideSheet);
    $('#sheet').querySelector('input, button, a')?.focus({ preventScroll: true });
  }
  function details(setNum) {
    if (!current()) return;
    const item = catalog.find(row => row.set_num === setNum);
    if (!item) return;
    if (roomSheet) {
      roomSheet = false;
      activeRoom?.setInspecting(false);
      hideSheet();
    }
    const dims = displayCartonDimensions(item);
    const aspect = (dims && dims.boxHeight > 0) ? (dims.boxWidth / dims.boxHeight) : 1.35;
    const depthRatio = (dims && dims.boxWidth > 0) ? (dims.boxDepth / dims.boxWidth) : 0.28;
    const backUrl = item.box_back_url || resolveBoxBackImageUrl(item);

    const artwork = boxArtworkPresentation(item);
    const quad = getBoxFrontQuad(item.set_num);
    const faceClass = (artwork.kind === 'flat-package-face' || quad) ? 'is-flat-package-face' : 'is-source-photo';
    // Fallback classification pattern for compatibility:
    // artwork.kind === 'flat-package-face' ? 'is-flat-package-face' : 'is-source-photo'
    const frontFace = `<div class="showroom-inspect-face showroom-inspect-front ${faceClass}"><canvas class="showroom-inspect-canvas" id="roomInspectCanvas" hidden></canvas><img id="roomInspectImg" src="${imageUrl(item)}" alt="${escapeHtml(item.name)}"></div>`;
    const backFace = `<div class=\"showroom-inspect-face showroom-inspect-back\">${backUrl ? `<img src=\"${proxyImg(backUrl)}\" alt=\"\">` : ''}</div>`;
    const neutralSide = '<div class="showroom-inspect-face showroom-inspect-side"></div>';

    modal(`<section class="showroom-inspect" aria-describedby="roomInspectHelp"><h2 id="roomSheetTitle">${escapeHtml(item.name)}</h2><p class="showroom-inspect-kicker">${t('room.inspecting')}</p><div class="showroom-inspect-turntable" id="roomTurntable" tabindex="0" role="img" aria-label="${escapeHtml(t('room.inspectLabel', { name: item.name }))}"><div class="showroom-inspect-box" id="roomInspectBox" style="--inspect-width:min(64vw, 320px); --inspect-height:calc(var(--inspect-width) / ${aspect.toFixed(3)}); --inspect-depth:calc(var(--inspect-width) * ${depthRatio.toFixed(3)});">${frontFace}${backFace}${neutralSide.replace('showroom-inspect-side', 'showroom-inspect-left')}${neutralSide.replace('showroom-inspect-side', 'showroom-inspect-right')}${neutralSide.replace('showroom-inspect-side', 'showroom-inspect-top')}${neutralSide.replace('showroom-inspect-side', 'showroom-inspect-bottom')}</div></div><p id="roomInspectHelp" class="showroom-inspect-help">${t('room.rotateHint')}</p><div class="showroom-inspect-rotate" aria-label="${escapeHtml(t('room.rotateControls'))}"><button type="button" id="roomRotateLeft" aria-label="${escapeHtml(t('room.rotateLeft'))}">↶</button><button type="button" id="roomRotateRight" aria-label="${escapeHtml(t('room.rotateRight'))}">↷</button></div><dl class="showroom-inspect-facts"><div><dt>${t('room.setNumber')}</dt><dd>${escapeHtml(item.set_num)}</dd></div><div><dt>${t('room.theme')}</dt><dd>${escapeHtml(themeName(item))}</dd></div><div><dt>${t('room.owned')}</dt><dd>${escapeHtml(tPlural('room.copies', item.quantity, { quantity: item.quantity }))}</dd></div></dl><a class="btn-primary" id="roomFullDetails" href="#/set/${encodeURIComponent(item.set_num)}">${t('room.fullDetails')}</a></section>`, null, { preservePickup: true });
    let rotation = 0;
    const turntable = $('#roomTurntable');
    const box = $('#roomInspectBox');
    const rotate = amount => {
      rotation = (rotation + amount) % 360;
      box.style.setProperty('--inspect-turn', `${rotation}deg`);
      activeRoom?.rotateInspection(amount);
    };
    $('#roomRotateLeft').addEventListener('click', () => rotate(-20));
    $('#roomRotateRight').addEventListener('click', () => rotate(20));
    turntable.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      rotate(event.key === 'ArrowLeft' ? -20 : 20);
    });
    let pointer = null;
    turntable.addEventListener('pointerdown', event => {
      pointer = event.clientX;
      try { turntable.setPointerCapture?.(event.pointerId); } catch {}
    });
    turntable.addEventListener('pointermove', event => {
      if (pointer == null) return;
      if (event.pointerType !== 'touch' && !(event.buttons & 1)) return;
      const delta = event.clientX - pointer;
      if (Math.abs(delta) < 2) return;
      pointer = event.clientX;
      rotate(delta * 0.65);
    });
    const releaseTurntable = () => { pointer = null; };
    turntable.addEventListener('pointerup', releaseTurntable);
    turntable.addEventListener('pointercancel', releaseTurntable);
    $('#roomFullDetails').addEventListener('click', () => {
      if (activeRoom) rememberedPose = { owner, pose: activeRoom.getPose() };
      hideSheet();
    });
    const imgEl = $('#roomInspectImg');
    const canvasEl = $('#roomInspectCanvas');
    if (quad && imgEl && canvasEl) {
      const applyUnwarp = () => {
        if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
        const targetW = 512;
        const targetH = Math.round(targetW / Math.max(0.2, aspect));
        canvasEl.width = targetW;
        canvasEl.height = targetH;
        if (unwarpQuadToCanvas(imgEl, quad, canvasEl)) {
          canvasEl.hidden = false;
          imgEl.hidden = true;
        }
      };
      if (imgEl.complete && imgEl.naturalWidth) applyUnwarp();
      else imgEl.addEventListener('load', applyUnwarp, { once: true });
    }

    activeRoom?.setInspecting(true);
  }
  function browse(find = false) {
    if (!current()) return;
    if (roomSheet) {
      roomSheet = false;
      activeRoom?.setInspecting(false);
      hideSheet();
    }
    const themes = [...new Set(catalog.map(item => item.theme))];
    modal(`<h2 id="roomSheetTitle">${t(find ? 'room.find' : 'room.accessibleList')}</h2><label for="roomSearch">${t('room.search')}</label><input class="input" id="roomSearch" type="search" autocomplete="off"><label for="roomTheme">${t('room.theme')}</label><select id="roomTheme"><option value="all">${t('room.allThemes')}</option>${themes.map((theme, index) => `<option value="${index}">${escapeHtml(theme || t('room.otherTheme'))}</option>`).join('')}</select><p id="roomResults" role="status"></p><ul class="showroom-results" id="roomSetList"></ul><button class="btn-secondary" id="roomMore">${t('room.more')}</button>`, $(find ? '#roomFind' : '#roomList'));
    const search = $('#roomSearch');
    const theme = $('#roomTheme');
    const results = $('#roomResults');
    const setList = $('#roomSetList');
    const more = $('#roomMore');
    let limit = 40;
    $('#roomSearch').value = state.filter.q || '';
    function filter() {
      const query = search.value.trim().toLocaleLowerCase();
      const selected = theme.value;
      const rows = catalog.filter(item => (selected === 'all' || item.theme === themes[Number(selected)]) && `${item.name} ${item.set_num} ${item.theme}`.toLocaleLowerCase().includes(query));
      setList.innerHTML = rows.slice(0, limit).map(item => `<li><button type="button" data-room-set="${escapeHtml(item.set_num)}"><img src="${imageUrl(item)}" alt="" loading="lazy" width="64" height="54"><span>${escapeHtml(item.name)}<small>${escapeHtml(item.set_num)} · ${escapeHtml(themeName(item))}</small></span></button></li>`).join('');
      results.textContent = tPlural('room.count', rows.length, { count: rows.length });
      more.hidden = limit >= rows.length;
      setList.querySelectorAll('[data-room-set]').forEach(button => button.addEventListener('click', () => {
        if (find && activeRoom) {
          const selectedSet = button.dataset.roomSet;
          // Move the camera while the room is paused, then close the sheet. Its
          // closing handler resumes and renders once at the destination instead
          // of rendering the old pose before an immediate second WebGL render.
          const arrived = activeRoom.teleportToSet(selectedSet);
          hideSheet();
          if (arrived) status.textContent = t('room.arrived');
        } else details(button.dataset.roomSet);
      }));
    }
    search.addEventListener('input', () => { state.filter.q = search.value; limit = 40; filter(); });
    theme.addEventListener('change', () => { limit = 40; filter(); });
    more.addEventListener('click', () => { limit += 40; filter(); });
    filter();
  }
  $('#roomFind').addEventListener('click', () => browse(true));
  // Shelf buttons: jump to the first box of a theme (the visible twin of walking there).
  document.querySelectorAll('[data-room-shelf]').forEach(button => button.addEventListener('click', () => {
    const name = shelves[Number(button.dataset.roomShelf)];
    const first = catalog.find(item => themeName(item) === name);
    document.querySelectorAll('[data-room-shelf]').forEach(b => b.classList.toggle('is-on', b === button));
    if (first && activeRoom?.teleportToSet(first.set_num)) status.textContent = t('room.arrived');
    stage.focus({ preventScroll: true });
  }));
  // Free walk shows or hides the movement joystick; looking and tapping boxes always work.
  $('#roomWalk').addEventListener('click', () => {
    const on = $('#collectionRoomPage').classList.toggle('is-walk');
    $('#roomWalk').setAttribute('aria-pressed', String(on));
  });
  $('#roomList').addEventListener('click', () => browse());
  $('#roomReset').addEventListener('click', () => { activeRoom?.reset(); stage.focus({ preventScroll: true }); });
  $('#roomMouse').addEventListener('click', () => {
    // requestPointerLock must run in the synchronous user-activation task.
    // Observing its optional promise here is unnecessary and can make engines
    // treat an awaited capture as detached from the activating click.
    try {
      const capture = activeRoom?.capturePointer();
      capture?.catch?.(() => { if (current()) status.textContent = t('room.mouseUnavailable'); });
    } catch { if (current()) status.textContent = t('room.mouseUnavailable'); }
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
    const { shouldUseRoomVideoIntro, startRoomVideoIntro } = await import('../components/collection-room-video-intro.js');
    if (!current() || !stage.isConnected) return;
    const useVideoIntro = shouldUseRoomVideoIntro();
    const controller = await createCollectionRoom(stage, catalog.map(item => ({
      ...item,
      theme: themeName(item),
      image_url: item.image_url ? thumbImg(item.image_url, 400) : '',
      box_image_url: item.box_image_url ? proxyImg(item.box_image_url) : '',
    })), {
      isCurrent: () => current() && stage.isConnected,
      onSelect: details, onUnavailable: unavailable, joystick: $('#roomJoystick'), initialPose,
      doorIntroMode: useVideoIntro ? 'deferred' : 'native',
    });
    if (!current() || !stage.isConnected || failed) { controller?.destroy(); return; }
    if (!controller) { unavailable(); return; }
    activeRoom = controller;
    controller.setPaused(roomSheet);
    stage.dataset.roomState = 'ready';
    status.textContent = catalog.length ? t('bvVault.roomHint') : t('room.empty');
    if (useVideoIntro && !roomSheet) {
      activeIntro = startRoomVideoIntro(stage, {
        isCurrent: () => current() && stage.isConnected && activeRoom === controller,
        skipLabel: t('room.skipIntro'),
        onComplete: () => {
          activeIntro = null;
          controller.finishDoorIntro();
          if (current() && !roomSheet) stage.focus({ preventScroll: true });
        },
        onFallback: () => {
          activeIntro = null;
          controller.playDoorIntro();
        },
      });
    }
    if (!activeIntro && !roomSheet) stage.focus({ preventScroll: true });
  } catch {
    unavailable();
  }
}
