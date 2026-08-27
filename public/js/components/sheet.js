import { $, haptic, escapeHtml } from '../utils.js';

let _sheetInvoker = null;
let _sheetCloseCleanup = null;

function finishSheetClose(sheet) {
  if (!sheet?.classList.contains("closing")) return;
  sheet.classList.remove("closing");
  sheet.style.removeProperty("visibility");
  sheet.style.transform = "";
  sheet.style.transition = "";
  _sheetCloseCleanup = null;
}

function scheduleSheetCloseCleanup(sheet) {
  const finish = () => finishSheetClose(sheet);
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (reducedMotion) {
    const cleanup = () => finish();
    _sheetCloseCleanup = cleanup;
    queueMicrotask(() => {
      if (_sheetCloseCleanup === cleanup) cleanup();
    });
    return;
  }
  const onEnd = (event) => {
    if (event.target === sheet && event.propertyName === "transform") finish();
  };
  sheet.addEventListener("transitionend", onEnd, { once: true });
  // A transform can be interrupted by a platform compositor; never leave a
  // semantically hidden sheet visible if transitionend is skipped.
  const timeout = setTimeout(finish, 340);
  _sheetCloseCleanup = () => {
    clearTimeout(timeout);
    sheet.removeEventListener("transitionend", onEnd);
    finish();
  };
}

// Background scroll-lock. `overflow:hidden` on <body> does NOT reliably stop
// touch scroll-chaining in mobile WebViews (the page behind the sheet still
// scrolls). Pinning the body with position:fixed freezes it completely; we
// stash the scroll offset and restore it on close so the page doesn't jump.
let _lockedScrollY = 0;
function lockBodyScroll() {
  _lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
  document.body.style.position = "fixed";
  document.body.style.top = `-${_lockedScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  document.body.style.overflow = "hidden";
}
function unlockBodyScroll() {
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  document.body.style.overflow = "";
  window.scrollTo(0, _lockedScrollY);
}

// Swallow touch drags that start on the dim backdrop so they can't scroll the
// (now position:fixed) page or trigger pull-to-refresh.
function blockBackdropTouch(e) { e.preventDefault(); }

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function sheetKeyHandler(e) {
  if (e.key === "Escape") { hideSheet(); return; }
  // Focus trap: keep Tab cycling within the open sheet.
  if (e.key === "Tab") {
    const sheet = $("#sheet");
    if (!sheet || !sheet.classList.contains("show")) return;
    const focusables = [...sheet.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    } else if (!sheet.contains(document.activeElement)) {
      e.preventDefault(); first.focus();
    }
  }
}

export function showSheet(html) {
  const back = $("#sheetBackdrop");
  const sheet = $("#sheet");
  if (_sheetCloseCleanup) _sheetCloseCleanup();
  _sheetInvoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  sheet.innerHTML = `<div class="sheet-handle"></div>` + html;
  back.classList.add("show");
  sheet.classList.add("show");
  sheet.style.setProperty("visibility", "visible", "important");
  document.body.classList.add("sheet-open");
  lockBodyScroll();
  back.setAttribute("aria-hidden", "false");
  sheet.setAttribute("aria-hidden", "false");
  // Announce the sheet as a modal dialog so screen readers scope to it (it
  // already traps Tab + restores focus on close).
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  haptic("light");
  back.addEventListener("click", hideSheet, { once: true });
  back.addEventListener("touchmove", blockBackdropTouch, { passive: false });
  document.addEventListener("keydown", sheetKeyHandler);
  wireSheetDrag(sheet);
}

/** Swap the open sheet's content for a shimmer while async work runs. */
export function sheetLoading(label = "Working…") {
  const sheet = $("#sheet");
  if (!sheet || !sheet.classList.contains("show")) return;
  sheet.innerHTML = `<div class="sheet-handle"></div>
    <h2 class="u-serif-h" style="margin:0 4px 14px;">${escapeHtml(label)}</h2>
    <div class="skel line" style="width:80%;margin:0 4px 10px;"></div>
    <div class="skel line" style="width:60%;margin:0 4px 10px;"></div>
    <div class="skel" style="height:44px;margin:8px 4px 0;"></div>`;
}

export function hideSheet() {
  const sheet = $("#sheet");
  const backdrop = $("#sheetBackdrop");
  if (!backdrop || !backdrop.classList.contains("show")) return;
  sheet?.dispatchEvent(new CustomEvent("sheet:closing"));
  backdrop.classList.remove("show");
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.removeEventListener("touchmove", blockBackdropTouch, { passive: false });
  document.body.classList.remove("sheet-open");
  unlockBodyScroll();
  if (sheet) {
    sheet.classList.remove("show");
    sheet.classList.add("closing");
    sheet.style.transform = "";
    sheet.setAttribute("aria-hidden", "true");
    scheduleSheetCloseCleanup(sheet);
  }
  document.removeEventListener("keydown", sheetKeyHandler);
  // Restore focus to whatever opened the sheet (a11y: focus must not be lost).
  if (_sheetInvoker && document.contains(_sheetInvoker)) {
    try { _sheetInvoker.focus(); } catch {}
  }
  _sheetInvoker = null;
  haptic("light");
}

export function wireSheetDrag(sheet) {
  let startY = 0, dy = 0, dragging = false, t0 = 0;
  const onStart = (e) => {
    if (sheet.scrollTop > 0) return;
    startY = e.touches[0].clientY; dy = 0; dragging = true; t0 = Date.now();
    sheet.style.transition = "none";
  };
  const onMove = (e) => {
    if (!dragging) return;
    dy = e.touches[0].clientY - startY;
    if (dy < 0) dy = 0;
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "";
    const velocity = dy / Math.max(1, Date.now() - t0);
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.6) hideSheet();
    else sheet.style.transform = "";
  };
  sheet.addEventListener("touchstart", onStart, { passive: true });
  sheet.addEventListener("touchmove", onMove, { passive: true });
  sheet.addEventListener("touchend", onEnd);
}

export function confirmSheet({ title, message = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hideSheet(); resolve(v); };
    showSheet(`
      <h2 class="u-serif-h" style="margin:0 4px 6px;">${escapeHtml(title)}</h2>
      ${message ? `<div style="color:var(--ink-mute);font-size:14px;margin:0 4px 18px;">${escapeHtml(message)}</div>` : `<div style="height:12px;"></div>`}
      <button class="btn-primary ${danger ? "btn-danger" : ""}" id="cfYes">${escapeHtml(confirmLabel)}</button>
      <button class="btn-secondary" id="cfNo" style="margin-top:8px;">Cancel</button>`);
    $("#cfYes").addEventListener("click", () => finish(true));
    $("#cfNo").addEventListener("click", () => finish(false));
    $("#sheetBackdrop").addEventListener("click", () => finish(false), { once: true });
  });
}

export function promptSheet({ title, label = "", value = "", placeholder = "", confirmLabel = "Save" }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hideSheet(); resolve(v); };
    showSheet(`
      <h2 class="u-serif-h" style="margin:0 4px 14px;">${escapeHtml(title)}</h2>
      ${label ? `<label class="field-lbl" for="psInput">${escapeHtml(label)}</label>` : ""}
      <input class="field-input" id="psInput" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      <button class="btn-primary" id="psSave" style="margin-top:14px;">${escapeHtml(confirmLabel)}</button>
      <button class="btn-secondary" id="psCancel" style="margin-top:8px;">Cancel</button>`);
    const input = $("#psInput");
    const _sheetEl = $("#sheet");
    let _psFocused = false;
    const _focusInput = () => { if (_psFocused) return; _psFocused = true; input?.focus(); };
    _sheetEl?.addEventListener("transitionend", _focusInput, { once: true });
    setTimeout(_focusInput, 400);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(input.value.trim()); });
    $("#psSave").addEventListener("click", () => finish(input.value.trim()));
    $("#psCancel").addEventListener("click", () => finish(null));
    $("#sheetBackdrop").addEventListener("click", () => finish(null), { once: true });
  });
}

// NOTE: the alerts sheet lives in views/portfolio.js (its showAlertsSheet also
// handles spike alerts and marks alerts read on view); the never-imported
// duplicate that used to live here was removed by the audit sweep.
