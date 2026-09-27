import { $, $$, haptic, escapeHtml, fmtMoney, toast, setBtnLoading, readFileAsDataURL, resizeImage, setHue, getExchangeRate, CURRENCY_SYMBOLS, activateFocusTrap, FOCUSABLE_SEL, getCachedSetDetail, track, capturedMoneyContext } from '../utils.js';
import { icon as kitIcon, iconBtn as kitIconBtn, field as kitField, seg as kitSeg, pill as kitPill, sheetBody as kitSheetBody, thumb as kitThumb } from '../ui/kit.js';
import { quadToViewRect, screenQuadToViewRect, cornerOffsets, defaultFrame } from '../lib/scan-geometry.js';
import { liveScanOptIn } from '../lib/native-barcode.js';
import { localMoneyToUsd } from '../lib/money-input.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, outboxEnqueue, getSessionUserId, photoScanNeedsSetup, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from './sheet.js';
import { computeDealScore as computeDealScorePure, computeStoreVerdict, marketValueForCondition, flipEconomics, classifyScanFailure, manualScanTarget, displayValueOf, estMark } from '../lib/pure.js';
import { checkGemma3Downloaded, runLocalVisionScan, isWebGpuAvailable } from '../lib/local-ai.js';
import { flipCalcHTML } from './flip-calc.js';
import { isNativeCapacitor } from '../lib/native-auth.js';
import { collectOcrCandidates } from '../lib/scan-ocr.js';
import { amazonSlotHTML, hydrateAmazonSlots } from '../lib/amazon-affiliate.js';
import { t, tPlural, kidsXpMessage, kidsBadgeLabel } from '../lib/i18n.js';
import { getModePref } from '../theme.js';
import { getProviderCredential } from '../lib/provider-credentials.js';

let _scanTrapRelease = null;
let _scanPending = false;
let _scanController = null;
let _scanGeneration = 0;
let _lastRetryableScan = null;

// ---------------------------------------------------------------------------
// 2026 scanner chrome: live camera with breathing brackets that snap onto the
// barcode, a "Done · N" batch counter, Barcode | Photo | Shelf modes, torch,
// type-a-number, and a result sheet that rises over the camera. The scan logic
// (catalog lookup, OCR, on-device AI, Turnstile, blind boxes) is unchanged.
// ---------------------------------------------------------------------------
let _session = [];           // sets added in this scanner session (Done · N)
let _lastBarcode = null;     // last decoded / typed barcode (unknown-code card)
let _moveCloserTimer = null; // "Move closer" + zoom step after 2.5 s
let _liveStop = null;        // stop() for the opt-in native live scanner
let _frameRect = null;       // current searching frame (CSS px)
let _torchOn = false;
const MOVE_CLOSER_MS = 2500;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function scanHintText(mode, shelf) {
  if (mode === "blindbox") return t("bvAdd.hintBlindBox");
  if (mode === "barcode") return t("bvAdd.hintBarcode");
  return shelf ? t("bvAdd.hintShelf") : t("bvAdd.hintPhoto");
}

function closeLabelHTML() {
  const n = _session.length;
  return n
    ? `${kitIcon("check", { size: 18, stroke: 2.4 })}<span>${escapeHtml(t("bvAdd.doneCount", { count: n }))}</span>`
    : `${kitIcon("x", { size: 18, stroke: 2.4 })}<span>${escapeHtml(t("common.close"))}</span>`;
}

function paintCloseButton() {
  const b = $("#scanCloseBtn");
  if (!b) return;
  b.innerHTML = closeLabelHTML();
  b.setAttribute("aria-label", _session.length ? tPlural("bvAdd.doneAria", _session.length, { count: _session.length }) : t("common.close"));
}

function scanOverlayHTML(mode, shelf = false) {
  // Installed app, barcode / blind-box: ML Kit's own Activity owns the camera
  // unless the opt-in live scanner runs behind a transparent WebView.
  const nativeHandoff = mode !== "image" && isNativeCapacitor() && !_liveNativeWanted;
  const segMode = mode === "image" ? (shelf ? "shelf" : "image") : mode;
  const modes = [["barcode", "bvAdd.modeBarcode"], ["image", "bvAdd.modePhoto"], ["shelf", "bvAdd.modeShelf"]];
  const corner = (c) => `<span class="bv-scan__corner" data-c="${c}"></span>`;
  return `
    <div class="bv-scan${nativeHandoff ? " is-native" : ""}${mode === "image" ? " is-photo" : ""}" data-mode="${escapeHtml(segMode)}">
      <video class="bv-scan__video" id="scanVideo" autoplay playsinline muted></video>
      <img class="bv-scan__photo" id="scanPhotoPreview" alt="${escapeHtml(t("bvAdd.capturedPhoto"))}" hidden>
      <div class="bv-scan__vignette" aria-hidden="true"></div>
      <div class="bv-scan__top">
        <button type="button" class="bv-scan__pill" id="scanCloseBtn" aria-label="${escapeHtml(t("common.close"))}">${closeLabelHTML()}</button>
        ${mode === "blindbox"
          ? `<span class="bv-scan__title">${escapeHtml(t("bvAdd.blindBox"))}</span>`
          : `<div class="bv-scan__seg scan-mode-toggle" role="group" aria-label="${escapeHtml(t("bvAdd.scanMode"))}">${modes.map(([m, k]) => `<button type="button" data-mode="${m}" aria-pressed="${segMode === m}">${escapeHtml(t(k))}</button>`).join("")}</div>`}
        <button type="button" class="bv-scan__round" id="scanTorchBtn" aria-label="${escapeHtml(t("bvAdd.torch"))}" aria-pressed="false" hidden>${kitIcon("flash")}</button>
      </div>
      <div class="bv-scan__chip" id="scanChip" hidden></div>
      <div class="bv-scan__frame" id="scanFrame" aria-hidden="true">${["tl", "tr", "bl", "br"].map(corner).join("")}<span class="bv-scan__sweep"></span></div>
      ${nativeHandoff ? `<div class="bv-scan__native" aria-hidden="true"><span class="bv-scan__spinner"></span></div>` : ""}
      <div class="bv-scan__hint" id="scanHint" role="status" aria-live="polite">${escapeHtml(nativeHandoff ? t("bvAdd.opening") : scanHintText(mode, shelf))}</div>
      <div class="bv-scan__bottom">
        ${mode === "image" ? `
          <button type="button" class="bv-scan__round" id="scanGalleryBtn" aria-label="${escapeHtml(t("bvAdd.gallery"))}">${kitIcon("photo")}</button>
          <button type="button" class="bv-scan__shutter" id="scanCapture" aria-label="${escapeHtml(t(shelf ? "bvAdd.captureShelf" : "bvAdd.capture"))}"></button>
          <input type="file" id="scanGalleryInput" accept="image/*"${shelf ? "" : " multiple"} hidden>`
        : `<span class="bv-scan__spacer"></span><span class="bv-scan__spacer bv-scan__spacer--wide"></span>`}
        <button type="button" class="bv-scan__round" id="scanTypeBtn" aria-label="${escapeHtml(t("bvAdd.typeNumber"))}">${kitIcon("kbd")}</button>
      </div>
      <div class="bv-scan__fly" id="scanFly" aria-hidden="true"></div>
      <div class="bv-scan__sheet" id="scanResult" role="status" aria-live="polite"></div>
    </div>`;
}

// --- Searching / lock choreography -----------------------------------------
function scanView() {
  const wrap = document.querySelector(".bv-scan");
  return wrap ? { w: wrap.clientWidth || innerWidth, h: wrap.clientHeight || innerHeight } : { w: innerWidth, h: innerHeight };
}

function placeFrame() {
  const frame = $("#scanFrame");
  if (!frame) return;
  const { w, h } = scanView();
  const mode = state.camera.mode === "image" ? "image" : "barcode";
  _frameRect = state.camera.shelf ? { left: 16, top: Math.round(h * 0.16), width: w - 32, height: Math.round(h * 0.42) } : defaultFrame(w, h, mode);
  frame.style.left = `${_frameRect.left}px`;
  frame.style.top = `${_frameRect.top}px`;
  frame.style.width = `${_frameRect.width}px`;
  frame.style.height = `${_frameRect.height}px`;
  const hint = $("#scanHint");
  if (hint) hint.style.top = `${_frameRect.top + _frameRect.height + 20}px`;
  resetLock();
}

function resetLock() {
  const frame = $("#scanFrame");
  if (!frame) return;
  frame.classList.remove("is-lock");
  frame.querySelectorAll(".bv-scan__corner").forEach((c) => { c.style.transform = ""; });
}

// Snap the brackets onto the barcode (view-space rect) and flash the chip.
function lockFrame(rect, chipText) {
  const frame = $("#scanFrame");
  if (frame && rect && _frameRect) {
    const off = cornerOffsets(_frameRect, rect);
    frame.querySelectorAll(".bv-scan__corner").forEach((c) => {
      const o = off[c.dataset.c];
      c.style.transform = `translate(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px)`;
    });
  }
  frame?.classList.add("is-lock");
  showChip(chipText, "lock");
}

function showChip(text, tone = "") {
  const chip = $("#scanChip");
  if (!chip) return;
  if (!text) { chip.hidden = true; return; }
  chip.className = `bv-scan__chip${tone ? ` is-${tone}` : ""}`;
  chip.innerHTML = `${tone === "lock" ? kitIcon("check", { size: 16, stroke: 2.6 }) : ""}<span>${escapeHtml(text)}</span>`;
  chip.hidden = false;
}

function armMoveCloser() {
  clearTimeout(_moveCloserTimer);
  if (state.camera.mode !== "barcode") return;
  _moveCloserTimer = setTimeout(async () => {
    if (!state.camera.scanning && !_liveStop) return;
    showChip(t("bvAdd.moveCloser"));
    const hint = $("#scanHint");
    if (hint) hint.textContent = t("bvAdd.hintCloser");
    // One zoom step helps small barcodes resolve; the camera keeps scanning.
    if (_liveStop) {
      const { setNativeZoom } = await import("../lib/native-barcode.js");
      setNativeZoom(window, 2);
    } else {
      const track = state.camera.stream?.getVideoTracks?.()?.[0];
      const caps = track?.getCapabilities?.();
      if (caps?.zoom) track.applyConstraints({ advanced: [{ zoom: Math.min(caps.zoom.max, Math.max(caps.zoom.min, 2)) }] }).catch(() => {});
    }
  }, MOVE_CLOSER_MS);
}

function wireTorch() {
  const btn = $("#scanTorchBtn");
  if (!btn) return;
  const track = state.camera.stream?.getVideoTracks?.()?.[0];
  const web = !!track?.getCapabilities?.()?.torch;
  if (!web && !_liveStop) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.onclick = async () => {
    _torchOn = !_torchOn;
    haptic("light");
    btn.setAttribute("aria-pressed", String(_torchOn));
    if (_liveStop) {
      const { setNativeTorch } = await import("../lib/native-barcode.js");
      setNativeTorch(window, _torchOn);
    } else {
      track?.applyConstraints({ advanced: [{ torch: _torchOn }] }).catch(() => {});
    }
  };
}

// Result sheet: skeleton while the lookup runs (motion: rises in 380 ms).
function showScanLoading(label = t("bvAdd.identifying"), detail = "") {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show", "loading");
  document.querySelector(".bv-scan")?.classList.add("has-result");
  el.innerHTML = `
    <div class="bv-scan__handle" aria-hidden="true"></div>
    <div class="bv-scanres bv-scanres--skel">
      <div class="bv-scanres__set"><span class="bv-thumb bv-skel" style="--size:56px"></span><span class="bv-scanres__text"><span class="bv-skel" style="height:18px;width:70%"></span><span class="bv-skel" style="height:13px;width:45%;margin-top:8px"></span></span></div>
      <span class="bv-skel" style="height:40px"></span>
      <span class="bv-skel" style="height:40px"></span>
      <span class="bv-skel" style="height:48px;border-radius:24px"></span>
    </div>
    <div class="scan-loading-copy bv-sr"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></div>`;
  const hint = $("#scanHint");
  if (hint) hint.textContent = label;
}

// Arc a thumbnail from the result sheet into the Done counter, then bump it.
function flyToDone(set) {
  const fly = $("#scanFly");
  const target = $("#scanCloseBtn");
  const from = document.querySelector("#scanResult .bv-scanres__set .bv-thumb");
  if (!fly || !target || !from || reducedMotion()) { paintCloseButton(); return; }
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  fly.innerHTML = from.outerHTML;
  fly.style.cssText = `left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;`;
  fly.classList.remove("is-flying");
  void fly.offsetWidth;
  fly.style.setProperty("--dx", `${b.left + 16 - a.left}px`);
  fly.style.setProperty("--dy", `${b.top + b.height / 2 - a.top - a.height / 2}px`);
  fly.classList.add("is-flying");
  setTimeout(() => { fly.classList.remove("is-flying"); fly.innerHTML = ""; paintCloseButton(); target.classList.add("is-bump"); setTimeout(() => target.classList.remove("is-bump"), 260); }, 480);
  void set;
}

// Owned copy for a scanned set: the vault list when loaded, else the set API.
async function ownedEntryFor(setNum) {
  const local = state.portfolio?.items?.find((i) => i.set_num === setNum);
  if (local) return local;
  if (!state.portfolio?.items) {
    try { const r = await api(`/api/sets/${encodeURIComponent(setNum)}`); return r?.entry || null; } catch { return null; }
  }
  return null;
}

// Add one set (or one more copy). Price paid stays EMPTY unless the user
// picked one — the old flow stored the market value as the purchase price.
async function addScannedSet(set, { priceUsd = null, condition = "new" } = {}) {
  const entry = await ownedEntryFor(set.set_num);
  const record = { set_num: set.set_num, name: set.name, image_url: set.image_url, theme: set.theme };
  try {
    if (entry?.id) {
      const qty = (Number(entry.quantity) || 1) + 1;
      const body = { quantity: qty };
      if (priceUsd != null && !(Number(entry.purchase_price) > 0)) body.purchase_price = priceUsd;
      await api(`/api/collection/${encodeURIComponent(entry.id)}`, { method: "PATCH", body });
      Object.assign(entry, body);
      _session.push({ ...record, kind: "qty", id: entry.id, prevQty: qty - 1 });
    } else {
      const body = { set_num: set.set_num, quantity: 1, condition };
      if (priceUsd != null) body.purchase_price = priceUsd;
      const result = await api("/api/collection", { method: "POST", body });
      _session.push({ ...record, kind: "post", id: result?.item?.id ?? null });
      if (getModePref() === "kids" && result?.kids?.xp_gained > 0) {
        const badge = result.kids.new_badges?.[0] ? kidsBadgeLabel(result.kids.new_badges[0]) : "";
        toast(kidsXpMessage(result.kids.xp_gained, { level: result.kids.new_level, badge }), "success");
        state.me = null;
      }
    }
  } catch (e) {
    if (navigator.onLine) throw e;
    const body = entry?.id ? { quantity: (Number(entry.quantity) || 1) + 1 } : { set_num: set.set_num, quantity: 1, condition, ...(priceUsd != null ? { purchase_price: priceUsd } : {}) };
    outboxEnqueue(entry?.id ? { path: `/api/collection/${encodeURIComponent(entry.id)}`, method: "PATCH", body } : { path: "/api/collection", method: "POST", body });
    _session.push({ ...record, kind: "offline", id: null });
  }
  state.ownedSetNums?.add?.(set.set_num);
  invalidatePortfolio();
  state.catalog.items = [];
}

// After an add: the sheet drops, the counter bumps and the camera resumes for
// the next box (the native Activity relaunches itself).
function resumeAfterAdd(set) {
  flyToDone(set);
  const el = $("#scanResult");
  el?.classList.add("is-leaving");
  setTimeout(() => {
    el?.classList.remove("is-leaving");
    clearScanResult({ restartCamera: true });
    const hint = $("#scanHint");
    if (hint) hint.textContent = state.camera.mode === "barcode" ? t("bvAdd.hintNext") : scanHintText(state.camera.mode, state.camera.shelf);
    if (state.camera.mode !== "image" && isNativeCapacitor() && !_liveStop) setTimeout(() => { if ($("#scanOverlay")?.classList.contains("open")) runNativeBarcodeScan(); }, 450);
  }, reducedMotion() ? 150 : 320);
}

// Done · N → close the camera and list this session's adds, each with Undo.
function finishSession() {
  const added = _session.slice();
  closeScan();
  if (!added.length) return;
  const rows = added.map((s, i) => `
    <div class="bv-setrow bv-scansession__row" data-i="${i}">
      ${setThumbHTML(s, 48)}
      <span class="bv-setrow__body"><span class="bv-setrow__name">${escapeHtml(s.name || s.set_num)}</span><span class="bv-setrow__meta"><span class="bv-num">${escapeHtml(s.set_num)}</span>${s.kind === "qty" ? ` · ${escapeHtml(t("bvAdd.extraCopy"))}` : s.kind === "offline" ? ` · ${escapeHtml(t("bvAdd.savedOffline"))}` : ""}</span></span>
      ${s.kind === "offline" ? "" : `<button type="button" class="bv-btn bv-btn--text bv-btn--sm" data-undo="${i}">${escapeHtml(t("common.undo"))}</button>`}
    </div>`).join("");
  showSheet(kitSheetBody({
    title: tPlural("bvAdd.sessionTitle", added.length, { count: added.length }),
    sub: t("bvAdd.sessionSub"),
    inner: `<div class="bv-scansession">${rows}</div>
      <a class="bv-btn bv-btn--primary bv-btn--full" href="#/" id="scanSessionVault">${escapeHtml(t("bvAdd.seeVault"))}</a>`,
  }));
  $("#scanSessionVault")?.addEventListener("click", () => hideSheet());
  // Each Undo takes back exactly one copy. A set scanned twice has two rows,
  // so undo counts down from the holding's current quantity (restoring a
  // remembered absolute quantity would also drop the other row's copy); the
  // holding is deleted only when its last copy goes.
  const qtyNow = new Map();
  for (const s of added) {
    if (s.id == null) continue;
    const after = s.kind === "qty" ? s.prevQty + 1 : 1;
    qtyNow.set(String(s.id), Math.max(qtyNow.get(String(s.id)) || 0, after));
  }
  $$("#sheet [data-undo]").forEach((btn) => btn.addEventListener("click", async () => {
    const s = added[Number(btn.dataset.undo)];
    const key = String(s.id);
    const current = qtyNow.get(key) || 1;
    btn.disabled = true;
    try {
      if (s.id == null) throw new Error(t("bvAdd.undoUnavailable"));
      // Count down before the request so a second Undo tapped meanwhile sees it.
      qtyNow.set(key, current - 1);
      if (current > 1) await api(`/api/collection/${encodeURIComponent(s.id)}`, { method: "PATCH", body: { quantity: current - 1 } });
      else await api(`/api/collection/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      invalidatePortfolio();
      state.catalog.items = [];
      if (current <= 1) state.ownedSetNums?.delete?.(s.set_num);
      btn.closest(".bv-scansession__row")?.classList.add("is-undone");
      btn.replaceWith(Object.assign(document.createElement("span"), { className: "bv-label", textContent: t("bvAdd.undone") }));
      haptic("light");
    } catch (e) {
      if (s.id != null) qtyNow.set(key, (qtyNow.get(key) ?? current - 1) + 1);
      btn.disabled = false;
      toast(t("common.errorWithDetails", { error: e.message || e }), "error");
    }
  }));
}

function setThumbHTML(set, size = 56) {
  const img = set.image_url && !String(set.image_url).startsWith("data:") ? `<img class="set-photo" src="${escapeHtml(set.image_url)}" alt="" loading="lazy" decoding="async">` : "";
  return kitThumb({ color: `hsl(${setHue(set)} 55% 58%)`, imgHtml: img, size });
}


// --- Per-scan latency instrumentation (opt-in) -----------------------------
// Set localStorage bv_scan_debug='1' to log each stage's timing to the console,
// so real per-photo latency can be measured on an actual device (which path,
// on-device inference vs cloud round-trip, and the total).
let _scanStartMs = 0;
const _scanDbg = () => { try { return localStorage.getItem('bv_scan_debug') === '1'; } catch { return false; } };
function scanTime(label, since) {
  if (_scanDbg()) console.debug(`[scan-timing] ${label}: ${Math.round(performance.now() - (since ?? _scanStartMs))}ms`);
}

// --- Playful "analyzing" phrases -------------------------------------------
// Rotate a few LEGO-flavored messages on the loading card while an image scan is
// in flight, so the wait feels alive instead of a static "Identifying…". Image/AI
// path only (barcode is instant). Stops on done(); the crossfade honors
// prefers-reduced-motion (text still rotates, just without the fade).
const SCAN_PHRASES = [
  'Counting the studs…',
  'Consulting the brick oracle…',
  'Summoning the minifigs…',
  'Sorting the 1×1 plates…',
  'Rummaging the parts bin…',
  'Matching the box art…',
  'Asking the master builder…',
  'Searching 20,000 sets…',
  'Dusting off the instructions…',
];
let _scanPhraseTimer = null;
function startScanPhrases() {
  stopScanPhrases();
  const queue = [...SCAN_PHRASES].sort(() => Math.random() - 0.5); // fresh order each scan
  let i = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  _scanPhraseTimer = setInterval(() => {
    const strong = document.querySelector('#scanResult .scan-loading-copy strong');
    if (!strong) return;
    const next = queue[i++ % queue.length];
    if (reduce) { strong.textContent = next; return; }
    strong.style.transition = 'opacity .18s ease';
    strong.style.opacity = '0';
    setTimeout(() => { strong.textContent = next; strong.style.opacity = '1'; }, 180);
  }, 2200);
}
function stopScanPhrases() {
  if (_scanPhraseTimer) { clearInterval(_scanPhraseTimer); _scanPhraseTimer = null; }
}

// NOTE: a Turnstile token pre-warm was tried here to hide the token fetch behind
// framing time, but holding a token until capture triggered server-side
// "could not verify" rejections (tokens are single-use + short-lived). The token
// is now always minted inline, immediately before the scan request (see
// cloudScanIdentify). Any future pre-warm must re-mint per request, not cache.

function setScanPending(on) {
  _scanPending = !!on;
  const wrap = document.querySelector(".bv-scan");
  const capture = $("#scanCapture");
  const gallery = $("#scanGalleryBtn");
  wrap?.classList.toggle("scan-busy", _scanPending);
  if (capture) {
    capture.disabled = _scanPending || wrap?.classList.contains("camera-unavailable");
    capture.setAttribute("aria-busy", _scanPending ? "true" : "false");
  }
  if (gallery) gallery.disabled = _scanPending;
}



let _liveNativeWanted = false;

export function openScan(mode = "barcode", { deferStart = false, shelf = false } = {}) {
  // Check access before mounting the full-screen camera. Guests without a BYOK
  // key get a small setup sheet while barcode/manual lookup remain available.
  if (mode === "image" && photoScanNeedsSetup()) {
    showPhotoScanSetupSheet();
    return;
  }

  const ov = $("#scanOverlay");
  const fresh = !ov.classList.contains("open");
  invalidateScanSession();
  if (fresh) { _session = []; _torchOn = false; }
  stopCamera();

  state.camera.mode = mode;
  // Shelf Snap: photo mode variant — one wide photo, every set on the shelf.
  state.camera.shelf = mode === "image" && !!shelf;
  _liveNativeWanted = mode !== "image" && isNativeCapacitor() && liveScanOptIn();
  ov.classList.remove("native-handoff");
  ov.innerHTML = scanOverlayHTML(mode, state.camera.shelf);
  ov.classList.add("open");
  document.body.classList.add("scan-active");
  $("#scanCloseBtn")?.addEventListener("click", () => { haptic("light"); finishSession(); });
  _scanTrapRelease?.();
  _scanTrapRelease = activateFocusTrap(ov, closeScan);
  if (fresh) ov.querySelector(FOCUSABLE_SEL)?.focus();
  placeFrame();

  // Swipe sideways to close — the Close / Done pill is the visible twin.
  let touchstartX = 0;
  let touchstartY = 0;
  ov.ontouchstart = (e) => { touchstartX = e.changedTouches[0].screenX; touchstartY = e.changedTouches[0].screenY; };
  ov.ontouchend = (e) => {
    const dx = e.changedTouches[0].screenX - touchstartX;
    const dy = e.changedTouches[0].screenY - touchstartY;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 50 && !e.target.closest?.("#scanResult")) { haptic("medium"); finishSession(); }
  };

  $$(".bv-scan__seg [data-mode]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.mode;
    if (b.getAttribute("aria-pressed") === "true") return;
    haptic("light");
    openScan(m === "shelf" ? "image" : m, { shelf: m === "shelf" });
  }));
  $("#scanCapture")?.addEventListener("click", capturePhoto);
  $("#scanTypeBtn")?.addEventListener("click", () => { haptic("light"); showManualBarcodeEntry({ focus: true }); });

  if (mode === "image") {
    const galleryBtn = $("#scanGalleryBtn");
    const galleryInp = $("#scanGalleryInput");
    if (galleryBtn && galleryInp) {
      galleryBtn.addEventListener("click", () => galleryInp.click());
      galleryInp.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []).slice(0, 10);
        if (!files.length) return;
        // Shelf mode: ONE wide photo -> many sets in a single identify call.
        if (state.camera.shelf) {
          stopCamera();
          const dataUrl = await readFileAsDataURL(files[0]);
          const resized = await resizeImage(dataUrl, 1280);
          const preview = $("#scanPhotoPreview");
          if (preview) { preview.src = resized; preview.hidden = false; }
          document.querySelector(".bv-scan")?.classList.add("has-captured-photo");
          sendScanToAPI({ mode: "shelf", image: resized });
          return;
        }
        processBulkScanQueue(files);
      });
    }
  }

  if (!deferStart) startCamera();
}

export function closeScan() {
  invalidateScanSession();
  stopCamera();
  // Keep native-scanner cleanup idempotent when Close, Android Back, or routing
  // dismisses this sheet while a handoff is in progress.
  void import("../lib/native-barcode.js")
    .then(({ cancelBarcodeNative }) => cancelBarcodeNative())
    .catch(() => {});
  _scanTrapRelease?.();
  _scanTrapRelease = null;
  document.body.classList.remove("scan-active");
  document.documentElement.classList.remove("bv-scan-native-live");
  const ov = $("#scanOverlay");
  ov.classList.remove("open", "native-handoff");
  ov.innerHTML = "";
  ov.ontouchstart = null;
  ov.ontouchend = null;
  _scanPending = false;
  _session = [];
}

export function stopCamera() {
  clearInterval(state.camera.timer);
  clearTimeout(_moveCloserTimer);
  state.camera.timer = null;
  if (state.camera.stream) {
    state.camera.stream.getTracks().forEach(t => t.stop());
    state.camera.stream = null;
  }
  if (_liveStop) {
    const stop = _liveStop;
    _liveStop = null;
    stop().catch(() => {});
    document.documentElement.classList.remove("bv-scan-native-live");
  }
  state.camera.scanning = false;
}

export async function startCamera() {
  track("scan_attempt", state.camera.mode || "barcode");
  resetLock();
  showChip("");
  // On the installed app, barcode / blind-box modes use the native ML Kit
  // scanner — NEVER the getUserMedia path. By default ML Kit's own Activity
  // owns the preview; the opt-in live scanner keeps our chrome on screen.
  if (state.camera.mode !== "image" && isNativeCapacitor()) {
    if (_liveNativeWanted && await startLiveNativeScan()) return;
    document.querySelector(".bv-scan")?.classList.add("is-native");
    let supported = false;
    try {
      const { nativeBarcodeSupported } = await import("../lib/native-barcode.js");
      supported = await nativeBarcodeSupported(window);
    } catch { /* import/plugin failure → manual entry below */ }
    if (supported) { runNativeBarcodeScan(); return; }
    const hint = $("#scanHint");
    if (hint) hint.textContent = t("bvAdd.typeInstead");
    ensureNativeRescanButton();
    showManualBarcodeEntry();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 } }
    });
    state.camera.stream = stream;
    const vid = $("#scanVideo");
    if (vid) { vid.srcObject = stream; await vid.play().catch(() => {}); }
    wireTorch();

    if (state.camera.mode !== "image" && "BarcodeDetector" in window) {
      state.camera.detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"] });
      state.camera.scanning = true;
      state.camera.timer = setInterval(scanBarcode, 300);
      armMoveCloser();
    } else if (state.camera.mode !== "image") {
      const hint = $("#scanHint");
      if (hint) hint.textContent = t("bvAdd.noLiveBarcode");
      showManualBarcodeEntry();
    }
  } catch (err) {
    const hint = $("#scanHint");
    const isDenied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
    document.querySelector(".bv-scan")?.classList.add("camera-unavailable");
    // The fallback differs by mode: Photo mode can still identify from a
    // gallery image; Barcode mode falls back to typing the digits.
    const photoMode = state.camera.mode === 'image';
    if (hint) hint.textContent = isDenied
      ? t(photoMode ? "bvAdd.deniedPhoto" : "bvAdd.deniedBarcode")
      : t("bvAdd.cameraUnavailable");
    const capture = $("#scanCapture");
    if (capture) {
      capture.disabled = true;
      capture.setAttribute("aria-disabled", "true");
    }
    showManualBarcodeEntry();
  }
}

// Opt-in live native scanner: CameraX behind a transparent WebView, our
// brackets on top. Returns false when it can't run (caller uses the Activity).
async function startLiveNativeScan() {
  try {
    const mod = await import("../lib/native-barcode.js");
    if (!(await mod.nativeLiveScanSupported(window))) return false;
    document.documentElement.classList.add("bv-scan-native-live");
    state.camera.scanning = true;
    _liveStop = await mod.startNativeLiveScan(window, {
      onBarcodes: (barcodes) => {
        if (!state.camera.scanning || _scanPending || $("#scanResult")?.classList.contains("show")) return;
        const b = barcodes.find((x) => x?.rawValue || x?.displayValue);
        if (!b) return;
        state.camera.scanning = false;
        clearTimeout(_moveCloserTimer);
        const { w, h } = scanView();
        const rect = screenQuadToViewRect(mod.normalizeCornerPoints(b.cornerPoints), w, h, window.devicePixelRatio || 1);
        haptic("success");
        lockFrame(rect, t("bvAdd.reading"));
        routeScannedCode(b.rawValue || b.displayValue);
      },
    });
    wireTorch();
    armMoveCloser();
    return true;
  } catch {
    document.documentElement.classList.remove("bv-scan-native-live");
    _liveStop = null;
    _liveNativeWanted = false;
    return false;
  }
}

// Native ML Kit barcode flow (installed app). The native scanner Activity owns
// its camera surface; hiding our WebView sheet during the handoff prevents the
// stale Scan page from covering the preview and avoids a duplicate flash on Back.
async function runNativeBarcodeScan() {
  // Release any getUserMedia stream first (e.g. after switching from Photo
  // mode) so ML Kit's scanner can acquire the camera.
  stopCamera();
  $("#nativeRescanBtn")?.remove();
  const hint = $("#scanHint");
  if (hint) hint.textContent = t("bvAdd.opening");
  const overlay = $("#scanOverlay");
  overlay?.classList.add("native-handoff");
  _scanTrapRelease?.();
  _scanTrapRelease = null;
  // Give the OS a moment to fully release the camera before ML Kit grabs it.
  await new Promise((r) => setTimeout(r, 200));
  let code = null;
  let scanError = null;
  try {
    const { scanBarcodeNative } = await import("../lib/native-barcode.js");
    code = await scanBarcodeNative(window);
  } catch (error) { scanError = error; }
  // The overlay may have been dismissed (back button / swipe) mid-scan.
  if (!overlay?.classList.contains("open")) return;
  if (code) {
    overlay.classList.remove("native-handoff");
    _scanTrapRelease = activateFocusTrap(overlay, closeScan);
    haptic("success");
    showChip(t("bvAdd.reading"), "lock");
    if (hint) hint.textContent = state.camera.mode === "blindbox" ? t("bvAdd.findingSeries") : t("bvAdd.lookingUp");
    routeScannedCode(code);
    return;
  }
  if (scanError) {
    overlay.classList.remove("native-handoff");
    _scanTrapRelease = activateFocusTrap(overlay, closeScan);
    if (hint) hint.textContent = t("bvAdd.scannerFailed");
    ensureNativeRescanButton();
    showManualBarcodeEntry();
    $("#manualBarcodeInput")?.focus();
    return;
  }
  // Back out of the Activity: with sets added this session show what was
  // added; otherwise return to where the scan started.
  if (_session.length) { finishSession(); return; }
  closeScan({ restoreFocus: false });
  $("#pileScanBarcode")?.focus();
}

function ensureNativeRescanButton() {
  if ($("#nativeRescanBtn")) return;
  const wrap = document.querySelector(".bv-scan");
  if (!wrap) return;
  const btn = document.createElement("button");
  btn.id = "nativeRescanBtn";
  btn.className = "bv-btn bv-btn--primary bv-scan__cta";
  btn.type = "button";
  btn.innerHTML = `${kitIcon("scan", { size: 20 })}<span>${escapeHtml(t("bvAdd.scanBarcode"))}</span>`;
  btn.addEventListener("click", () => {
    $("#nativeRescanBtn")?.remove();
    clearScanResult();
    runNativeBarcodeScan();
  });
  wrap.appendChild(btn);
}

// Type a set number or barcode — inside the scanner, one tap from the camera.
function showManualBarcodeEntry({ focus = false } = {}) {
  track("scan_fallback", state.camera.mode || "barcode");
  const el = $("#scanResult");
  if (!el) return;
  if ($("#manualBarcodeRow")) { if (focus) $("#manualBarcodeInput")?.focus(); return; }
  document.querySelector(".bv-scan")?.classList.add("has-result");
  el.classList.add("show", "manual");
  el.classList.remove("loading");
  el.innerHTML = `
    <div class="bv-scan__handle" aria-hidden="true"></div>
    <form id="manualBarcodeRow" class="bv-scanres" novalidate>
      <div class="bv-scanres__head"><h2>${escapeHtml(t("bvAdd.typeTitle"))}</h2>${kitIconBtn({ icon: "x", label: t("common.close"), id: "manualClose" })}</div>
      ${kitField({ id: "manualBarcodeInput", label: t("bvAdd.typeLabel"), placeholder: t("bvAdd.typePlaceholder"), mono: true, inputmode: "text", autocomplete: "off", attrs: { spellcheck: "false", enterkeyhint: "search" } })}
      <p class="bv-field__help" id="manualBarcodeError" role="status" aria-live="polite"></p>
      <div class="bv-btn-row">
        ${state.camera.mode === "image" ? `<button type="button" class="bv-btn bv-btn--outline" id="manualGalleryGo">${kitIcon("photo", { size: 20 })}<span>${escapeHtml(t("bvAdd.choosePhoto"))}</span></button>` : ""}
        <button type="submit" class="bv-btn bv-btn--primary" id="manualBarcodeGo">${kitIcon("search", { size: 20 })}<span>${escapeHtml(t("bvAdd.findSet"))}</span></button>
      </div>
    </form>`;
  const err = (msg) => { const e = $("#manualBarcodeError"); if (e) e.textContent = msg; };
  $("#manualBarcodeRow")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = ($("#manualBarcodeInput")?.value || "").trim();
    if (raw.length < 3) { err(t("bvAdd.typeFirst")); return; }
    haptic("medium");
    const target = manualScanTarget(raw);
    if (target.kind === "set") await sendManualSetLookup(target.value);
    else if (target.kind === "barcode") routeScannedCode(target.value);
    else err(t("bvAdd.typeInvalid"));
  });
  $("#manualClose")?.addEventListener("click", () => clearScanResult({ restartCamera: true }));
  $("#manualGalleryGo")?.addEventListener("click", () => $("#scanGalleryInput")?.click());
  // No auto-focus when the camera opened it (it would pop the keyboard over the
  // preview); the keyboard button focuses it on purpose.
  if (focus) $("#manualBarcodeInput")?.focus();
}

async function scanBarcode() {
  if (!state.camera.scanning) return;
  const vid = $("#scanVideo");
  if (!vid || vid.readyState < 2) return;
  try {
    const codes = await state.camera.detector.detect(vid);
    if (codes.length > 0 && state.camera.scanning) {
      state.camera.scanning = false;
      clearInterval(state.camera.timer);
      clearTimeout(_moveCloserTimer);
      const code = codes[0];
      const { w, h } = scanView();
      const rect = quadToViewRect(code.cornerPoints || (code.boundingBox ? [
        { x: code.boundingBox.x, y: code.boundingBox.y },
        { x: code.boundingBox.x + code.boundingBox.width, y: code.boundingBox.y + code.boundingBox.height },
      ] : []), vid.videoWidth, vid.videoHeight, w, h);
      haptic("success");
      lockFrame(rect, t("bvAdd.reading"));
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.mode === "blindbox" ? t("bvAdd.findingSeries") : t("bvAdd.lookingUp");
      routeScannedCode(code.rawValue);
    }
  } catch {}
}

function clearScanResult({ restartCamera = false } = {}) {
  const el = $("#scanResult");
  if (el) {
    el.classList.remove("show", "loading", "manual");
    el.innerHTML = "";
  }
  const wrap = document.querySelector(".bv-scan");
  wrap?.classList.remove("has-result", "has-captured-photo");
  const preview = $("#scanPhotoPreview");
  if (preview) {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
  setScanPending(false);
  resetLock();
  showChip("");
  const hint = $("#scanHint");
  if (hint) hint.textContent = scanHintText(state.camera.mode, state.camera.shelf);
  if (restartCamera && state.camera.mode === "image") {
    void startCamera();
  } else if (restartCamera && _liveStop) {
    state.camera.scanning = true;
    armMoveCloser();
  } else if (restartCamera && state.camera.mode !== "image" && state.camera.detector && state.camera.stream) {
    state.camera.scanning = true;
    clearInterval(state.camera.timer);
    state.camera.timer = setInterval(scanBarcode, 300);
    armMoveCloser();
  }
}

function showPhotoScanSetupSheet() {
  showSheet(`
    <div class="photo-scan-setup">
      <div class="sheet-title-row">
        <div>
          <div class="u-mono-label">Photo identification</div>
          <h2 class="u-serif-h" style="margin:2px 0 0;">Set up photo scanning</h2>
        </div>
        <button type="button" class="icon-btn" id="photoScanSetupClose" aria-label="Close">${I.close()}</button>
      </div>
      <p class="u-mute" style="margin:0 4px 14px;">Sign in to use the shared scan service, or add your own Gemini/OpenAI key. Barcode and manual lookup stay free for guests.</p>
      <div class="btn-row">
        <button class="btn-primary" id="scanSignIn">Sign in</button>
        <button class="btn-secondary" id="scanSetup">Add AI key</button>
      </div>
    </div>`);
  $("#photoScanSetupClose")?.addEventListener("click", hideSheet);
  $("#scanSignIn")?.addEventListener("click", () => { hideSheet(); location.hash = "#/login"; });
  $("#scanSetup")?.addEventListener("click", () => { hideSheet(); location.hash = "#/me/integrations"; });
}


function invalidateScanSession() {
  _scanGeneration += 1;
  _scanController?.abort();
  _scanController = null;
  stopScanPhrases();
  _scanPending = false;
}

function beginScanRequest() {
  invalidateScanSession();
  const controller = new AbortController();
  _scanController = controller;
  return { controller, generation: _scanGeneration };
}






async function sendManualSetLookup(setNum) {
  setScanPending(true);
  showScanLoading(t('scanner.findingSet'), t('scanner.lookingUpSet', { setNum }));
  try {
    const data = await api(`/api/sets/${encodeURIComponent(setNum)}`);
    const set = data?.set || data;
    if (set?.set_num) {
      showScanResult({ identified: true, confidence: "high", reasoning: t('scanner.setNumberMatched'), set });
    } else {
      showScanResult({ identified: false, reasoning: t('scanner.setNotFound', { setNum }) });
    }
  } catch (e) {
    showScanResult({ identified: false, reasoning: e.message || t('scanner.setNotFound', { setNum }) });
  } finally {
    setScanPending(false);
  }
}

export async function lookupScanInput(value) {
  const target = manualScanTarget(value);
  if (target.kind === "invalid") {
    throw new Error("Enter a set number like 71043-1 or a longer barcode.");
  }
  if (target.kind === "set") {
    location.hash = `#/set/${encodeURIComponent(target.value)}`;
    return target;
  }

  openScan("barcode", { deferStart: true });
  const hint = $("#scanHint");
  if (hint) hint.textContent = t("bvAdd.lookingUp");
  await routeScannedCode(target.value);
  return target;
}


export function finishPhotoCapture(dataUrl) {
  // Recognition uses this still frame. Release the live stream before starting
  // the request so moving the phone afterwards cannot change the submitted scan
  // and the camera is not kept active behind the result card.
  const preview = $("#scanPhotoPreview");
  if (preview) {
    preview.src = dataUrl;
    preview.hidden = false;
  }
  document.querySelector(".bv-scan")?.classList.add("has-captured-photo");
  stopCamera();
  const frame = document.querySelector(".bv-scan__frame");
  if (frame) frame.classList.add("scan-pending");
  return sendScanToAPI({ mode: state.camera.shelf ? "shelf" : "image", image: dataUrl });
}

export async function capturePhoto() {
  if (_scanPending) return;
  const btn = $("#scanCapture");
  if (btn?.disabled) {
    const hint = $("#scanHint");
    if (hint) hint.textContent = "Camera is unavailable. Use Gallery or type a barcode.";
    return;
  }
  haptic("heavy");
  if (btn) { btn.style.transform = "scale(0.85)"; setTimeout(() => btn.style.transform = "", 200); }
  const hint = $("#scanHint");
  if (hint) hint.textContent = "Identifying…";

  const vid = $("#scanVideo");
  if (!vid) return;
  const canvas = document.createElement("canvas");
  // Shelf shots keep more resolution — the model has to read many small boxes.
  const maxSide = state.camera.shelf ? 1280 : 1024;
  const w = vid.videoWidth || 640; const h = vid.videoHeight || 480;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = w * scale; canvas.height = h * scale;
  canvas.getContext("2d").drawImage(vid, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  finishPhotoCapture(dataUrl);
}

// data: URL -> ImageBitmap, the canonical input MediaPipe accepts (avoids
// handing it an undecoded HTMLImageElement). fetch on a data URL is local, so
// it works offline.
async function imageBitmapFromDataUrl(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

// --- Turnstile (bot protection for shared server-key scans) ----------------
// Lazy-loaded invisible widget. Only used when the server advertises a site key
// (state.config.turnstile_site_key) AND the user has no BYOK key. A fresh widget
// is rendered per token request into a RENDERABLE off-screen host (Turnstile will
// NOT execute inside a display:none element), auto-runs on render, then cleans up.
let _tsReady = null;
let _tsReason = ""; // last getTurnstileToken outcome — drives the one-retry decision in cloudScanIdentify
function loadTurnstileScript() {
  if (_tsReady) return _tsReady;
  _tsReady = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return _tsReady;
}
async function getTurnstileToken() {
  const siteKey = state.config && state.config.turnstile_site_key;
  if (!siteKey) { _tsReason = "no-config"; return null; } // not configured — scan proceeds without a token
  try {
    await loadTurnstileScript();
    if (!window.turnstile) { _tsReason = "no-global"; return null; }
    return await new Promise((resolve) => {
      let done = false;
      let widgetId = null;
      // Off-screen but with REAL dimensions (not display:none or 0×0 — either can
      // stop the invisible widget's iframe from initializing/executing). If an
      // interactive challenge is needed, Turnstile shows its own centered overlay.
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:300px;height:70px;overflow:hidden;";
      document.body.appendChild(host);
      const cleanup = () => {
        try { if (widgetId != null) window.turnstile.remove(widgetId); } catch {}
        try { host.remove(); } catch {}
      };
      const finish = (tok, reason) => {
        if (done) return;
        done = true;
        _tsReason = reason;
        clearTimeout(timer);
        cleanup();
        resolve(tok || null);
      };
      // Safety timeout: a stuck/blocked challenge must never hang the scan.
      const timer = setTimeout(() => finish(null, "timeout"), 12000);
      try {
        widgetId = window.turnstile.render(host, {
          sitekey: siteKey,
          size: "invisible", // auto-executes on render; token arrives via callback
          callback: (tok) => finish(tok, tok ? "ok" : "empty"),
          "error-callback": (e) => finish(null, "error" + (e ? ":" + e : "")),
          "timeout-callback": () => finish(null, "challenge-timeout"),
          "expired-callback": () => finish(null, "expired"),
        });
      } catch (_e) {
        finish(null, "render-threw");
      }
    });
  } catch {
    _tsReason = "script-fail";
    return null;
  }
}

async function cloudScanIdentify(payload, signal, idempotencyKey) {
  const geminiKey = getProviderCredential('gemini');
  const openaiKey = getProviderCredential('openai');
  const extraHeaders = {};
  extraHeaders['Idempotency-Key'] = idempotencyKey;
  if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
  if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;
  // Shared server-key image scans (no BYOK key) carry a Turnstile token for bot
  // protection when configured; BYOK and barcode scans skip it.
  if (!geminiKey && !openaiKey && (payload.mode === 'image' || payload.mode === 'shelf')) {
    // Fetch a FRESH token immediately before the request. Turnstile tokens are
    // single-use and short-lived, so they must be minted right before siteverify —
    // holding a pre-warmed one caused server-side "could not verify" rejections.
    let token = await getTurnstileToken();
    // One retry on a transient miss (occasional invisible-challenge timeout on
    // rapid successive scans); a genuine config/script failure won't recover, so
    // only retry the transient outcomes.
    if (!token && /timeout|empty|error/.test(_tsReason)) token = await getTurnstileToken();
    if (token) extraHeaders['cf-turnstile-token'] = token;
    // Report WHY no token was produced. Without this the server sees only an
    // absent header and cannot tell a blocked script from a hostname the
    // Turnstile widget does not allow — which is the failure that survives
    // every "refresh and try again".
    else if (_tsReason) extraHeaders['X-Turnstile-Reason'] = _tsReason;
  }
  const _t = performance.now();
  const res = await api("/api/scan/identify", {
    method: "POST",
    body: payload,
    signal,
    headers: extraHeaders,
    // Do not replay a paid/quota-consuming operation after an ambiguous network
    // failure. The idempotency key makes explicit user retries safe server-side.
    retry: false,
  });
  scanTime(payload.mode === 'barcode' ? 'barcode lookup' : 'cloud identify round-trip', _t);
  return res;
}

async function sendScanToAPI(payload) {
  const { controller, generation } = beginScanRequest();
  // The key belongs to one captured-photo submission and its lower-level
  // request replay. A user-visible "Try again" now returns to the camera, so the
  // next photo gets a fresh key instead of replaying this payload.
  const idempotencyKey = payload.idempotencyKey
    || globalThis.crypto?.randomUUID?.()
    || `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  payload = { ...payload, idempotencyKey };
  _lastRetryableScan = payload;
  const stale = () => generation !== _scanGeneration || controller.signal.aborted;
  _scanStartMs = performance.now();
  setScanPending(true);
  showScanLoading(
    t(payload.mode === "barcode" ? "bvAdd.lookingUp" : payload.mode === "shelf" ? "bvAdd.readingShelf" : "bvAdd.identifying"),
    t(payload.mode === "barcode" ? "bvAdd.detailBarcode" : payload.mode === "shelf" ? "bvAdd.detailShelf" : "bvAdd.detailPhoto"),
  );
  const frame = document.querySelector(".bv-scan__frame");
  if (frame) frame.classList.add("scan-pending");
  // Playful rotating copy for the (slower) image/AI path; barcode is instant.
  if (payload.mode !== "barcode") startScanPhrases();
  const done = () => {
    if (generation !== _scanGeneration) return;
    stopScanPhrases();
    scanTime('total');
    if (frame) frame.classList.remove("scan-pending");
    setScanPending(false);
    if (_scanController === controller) _scanController = null;
  };

  const scanEngine = localStorage.getItem('bv_ai_engine') || 'cloud';
  const online = navigator.onLine;

  // OCR runs against the captured still on the device. Only bounded, explicit
  // set-number candidates leave the phone; failures are silent and preserve the
  // current Brickognize/AI route. Shelf Snap remains cloud multi-object vision.
  if (payload.mode === 'image' && payload.image && !payload.ocr_candidates) {
    const ocrStarted = performance.now();
    try {
      const candidates = await collectOcrCandidates(payload.image);
      if (stale()) return;
      if (candidates.length) payload = { ...payload, ocr_candidates: candidates };
      scanTime('OCR', ocrStarted);
    } catch { /* best-effort local optimization */ }
  }

  // On-device (Gemma) vision is best-effort: only attempt it when the user
  // prefers local, it's an image scan, and the device can actually run it
  // (WebGPU + model downloaded). The cloud path is the primary, more-accurate
  // route and the fallback whenever local can't run or can't identify. OCR
  // candidates never suppress this path — a label must not override an explicit
  // on-device/privacy preference; they ride along for the cloud fallback only.
  if (payload.mode === 'image' && scanEngine === 'local') {
    const hasGpu = isWebGpuAvailable();
    const ready = hasGpu && await checkGemma3Downloaded();
    if (stale()) return;
    if (ready) {
      try {
        const bitmap = await imageBitmapFromDataUrl(payload.image);
        if (stale()) return;
        const _tLocal = performance.now();
        const localResult = await runLocalVisionScan(bitmap, (statusText) => {
          const hint = $("#scanHint");
          if (hint) hint.textContent = statusText;
        }, { signal: controller.signal, timeoutMs: 15_000 });
        if (stale()) return;
        scanTime('on-device inference', _tLocal);
        if (localResult.identified) {
          const setNum = localResult.set_num;
          let setResponse = await api(`/api/sets/${encodeURIComponent(setNum)}`, { signal: controller.signal }).catch(() => null);
          if (stale()) return;
          // Offline: the enrichment fetch fails, so pull value/details from the
          // set-detail cache when available instead of showing $0.
          if (!setResponse) {
            const cached = await getCachedSetDetail(setNum, getSessionUserId());
            if (cached?.set) setResponse = { set: cached.set, entry: cached.entry };
          }
          const set = setResponse?.set || setResponse || {
            set_num: setNum,
            name: localResult.name || "Unknown Set",
            current_value: 0,
            theme: "Local AI"
          };
          showScanResult({ identified: true, confidence: localResult.confidence, reasoning: localResult.reasoning, sets: [set] });
          done();
          return;
        }
        // On-device ran but couldn't identify — try cloud when online.
        if (!online) {
          showScanResult({ identified: false, reasoning: localResult.reasoning || "Couldn't identify the set on-device. Try a clearer photo." });
          done();
          return;
        }
        toast("On-device AI couldn't identify it — trying cloud…", "info");
      } catch (err) {
        if (stale()) return;
        if (!online) {
          showScanResult({ identified: false, reasoning: t('scanner.localAiOfflineFailed', { error: err.message || err }) });
          done();
          return;
        }
        toast("On-device AI unavailable — using cloud scan.", "info");
        // fall through to cloud
      }
    } else if (!online) {
      showScanResult({ identified: false, reasoning: hasGpu
        ? "You're offline and the on-device model isn't downloaded yet (Settings → On-Device AI)."
        : "You're offline and this device can't run on-device AI (no WebGPU)." });
      done();
      return;
    } else {
      toast(hasGpu ? "On-device model not downloaded — using cloud scan." : "On-device AI needs WebGPU — using cloud scan.", "info");
    }
  }

  // Cloud path — primary when online, and the fallback for every case above.
  if ((payload.mode === 'image' || payload.mode === 'shelf') && !online) {
    showScanResult({ identified: false, reasoning: "You're offline. Reconnect to identify by photo, or set up on-device AI in Settings." });
    done();
    return;
  }
  let timedOut = false;
  const tid = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 30_000);
  try {
    const { idempotencyKey: _retryKey, ...requestPayload } = payload;
    const res = await cloudScanIdentify(requestPayload, controller.signal, idempotencyKey);
    if (stale()) return;
    // Server-side step timings, when the scan did not match. Logged rather than
    // shown: it is operator detail, but without it a slow scan is unfalsifiable
    // from the outside.
    if (res?.diag) {
      const steps = (res.diag.timings || []).map(t => `${t.provider}/${t.model} ${t.ms}ms ${t.outcome}`).join(' | ');
      console.warn(`[scan] ${res.diag.total_ms}ms total, image ${res.diag.image_kb}KB :: ${steps || 'no steps ran'}`);
    }
    showScanResult(res);
  } catch (e) {
    if (generation !== _scanGeneration || (controller.signal.aborted && !timedOut)) return;
    const localizedMsg = timedOut
      ? t('scanner.timedOut')
      : t('scanner.scanFailed', { error: e.message || e });
    const msg = timedOut ? "Took too long — try again." : e.message;
    const displayMsg = timedOut ? localizedMsg : t('scanner.scanFailed', { error: msg || e });
    const hint = $("#scanHint");
    if (hint) hint.textContent = timedOut
      ? t('scanner.timedOutShort')
      : t('scanner.scanFailed', { error: e.message || e });
    showScanResult({ identified: false, reasoning: displayMsg });
  } finally {
    clearTimeout(tid);
    done();
  }
}

// Route a scanned/typed barcode to the right handler for the active mode.
function routeScannedCode(code) {
  track("scan_success", state.camera.mode || "barcode");
  _lastBarcode = code;
  if (state.camera.mode === "blindbox") return sendBlindBoxLookup(code);
  return sendScanToAPI({ mode: "barcode", barcode: code });
}

// Blind-box: resolve a Collectible Minifigures bag/box barcode to its series
// roster, then let the user tap the fig they pulled (adds to their minifigs).
async function sendBlindBoxLookup(code) {
  setScanPending(true);
  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
    el.innerHTML = `<div class="scan-loading"><div class="spinner"></div><span>Finding the series…</span></div>`;
  }
  showScanLoading("Finding the series...", "Matching the barcode against blind-box data.");
  try {
    const res = await api(`/api/minifigs/blindbox?code=${encodeURIComponent(code)}`);
    showBlindBoxResult(res);
  } catch (e) {
    showBlindBoxResult({ error: e.message || "Couldn't look that up." });
  } finally {
    setScanPending(false);
  }
}

function showBlindBoxResult(res) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");
  el.classList.remove("loading");
  document.querySelector(".bv-scan")?.classList.add("has-result");
  if (res.error || !res.figs || !res.figs.length) {
    el.innerHTML = `
      <div class="scan-result-head"><span class="badge" style="background:var(--ink-mute);">${I.info()} NO MATCH</span></div>
      <p style="font-size:13px;color:var(--ink-soft);margin:8px 0 12px;line-height:1.5;">${escapeHtml(res.error || "Couldn't match that barcode to a Collectible Minifigures series. Try the series number (e.g. 71045).")}</p>
      <div class="btn-row"><button class="btn-secondary" id="bbRetry">Try again</button></div>`;
    $("#bbRetry")?.addEventListener("click", () => openScan("blindbox"));
    return;
  }
  const figsHTML = res.figs.map(f => {
    const owned = state.ownedFigs.has(f.fig_num);
    const hasImg = f.image_url && !String(f.image_url).startsWith("data:");
    return `
      <button class="bb-fig" data-fig="${escapeHtml(f.fig_num)}" aria-label="${escapeHtml(f.name)}"
        style="display:flex;flex-direction:column;align-items:center;gap:5px;background:var(--surface-2);border:1.5px solid ${owned ? "var(--up)" : "var(--line-soft)"};border-radius:var(--r-2);padding:8px 6px;cursor:pointer;">
        <div style="width:100%;aspect-ratio:1;border-radius:var(--r-1);overflow:hidden;position:relative;background:var(--surface-3);">
          ${hasImg ? `<img src="${escapeHtml(f.image_url)}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain;">` : ""}
          <span class="bb-check" style="position:absolute;top:3px;right:3px;color:var(--up);display:${owned ? "block" : "none"};">${I.check({ w: 16 })}</span>
        </div>
        <div style="font-size:11px;font-weight:600;line-height:1.2;text-align:center;max-height:28px;overflow:hidden;">${escapeHtml(f.name)}</div>
      </button>`;
  }).join("");
  el.innerHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()} ${escapeHtml(res.series || "Series")}</span>
      <span style="font-size:11px;color:var(--ink-mute);">${escapeHtml(tPlural('counts.figs', res.figs.length))}</span>
    </div>
    <p style="font-size:12px;color:var(--ink-mute);margin:6px 0 10px;">Tap the minifig you pulled to add it to your collection.</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-height:44vh;overflow-y:auto;padding-right:2px;">${figsHTML}</div>
    <div class="btn-row" style="margin-top:12px;"><button class="btn-secondary" id="bbAnother">Scan another</button></div>`;
  $("#bbAnother")?.addEventListener("click", () => openScan("blindbox"));
  el.querySelectorAll(".bb-fig").forEach(btn => btn.addEventListener("click", async () => {
    const fignum = btn.dataset.fig;
    const willOwn = !state.ownedFigs.has(fignum);
    haptic("medium");
    if (willOwn) state.ownedFigs.add(fignum); else state.ownedFigs.delete(fignum);
    try { localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs])); } catch {}
    btn.style.borderColor = willOwn ? "var(--up)" : "var(--line-soft)";
    const chk = btn.querySelector(".bb-check");
    if (chk) chk.style.display = willOwn ? "block" : "none";
    try {
      await api("/api/minifigs/" + encodeURIComponent(fignum), { method: willOwn ? "PUT" : "DELETE" });
      invalidatePortfolio();
      toast(willOwn ? "Added to your minifigs" : "Removed", "success");
    } catch (_e) {
      if (willOwn) state.ownedFigs.delete(fignum); else state.ownedFigs.add(fignum);
      try { localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs])); } catch {}
      btn.style.borderColor = !willOwn ? "var(--up)" : "var(--line-soft)";
      if (chk) chk.style.display = !willOwn ? "block" : "none";
      toast("Couldn't save — try again", "error");
    }
  }));
}


export function showScanResult(res) {
  const el = $("#scanResult");
  if (!el) return;
  // Photo scans never reported success: scan_success was emitted only from
  // routeScannedCode (the barcode path), so every identified PHOTO counted as an
  // attempt with no matching success and the admin SLO sat at 0% with image
  // scans making up most of the traffic. Barcode scans still report at decode
  // time, so guard on mode to avoid double-counting the barcode->API round trip.
  if (res?.identified && state.camera.mode !== "barcode") {
    track("scan_success", state.camera.mode || "image");
  }
  el.classList.add("show");
  el.classList.remove("loading", "manual");
  document.querySelector(".bv-scan")?.classList.add("has-result");
  if (!res?.identified) { showScanMiss(el, res || {}); return; }
  const sets = res.sets || (res.set ? [res.set] : []);
  const minifigs = res.minifigs || [];
  if (!sets.length && !minifigs.length) { showScanMiss(el, { reasoning: t("bvAdd.nothingFound") }); return; }
  if (state.camera.shelf) { showShelfChecklist(el, sets, minifigs); return; }
  if (sets.length === 1 && !minifigs.length) { showSingleSet(el, sets[0]); return; }
  showCandidates(el, sets, minifigs, res);
}

const sheetTop = () => `<div class="bv-scan__handle" aria-hidden="true"></div>`;

function setMetaLine(set) {
  return [set.set_num, set.theme, set.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
}

function formatBarcode(code) {
  const d = String(code || "").replace(/\D/g, "");
  if (d.length === 13) return `${d[0]} ${d.slice(1, 7)} ${d.slice(7, 12)} ${d[12]} · EAN-13`;
  if (d.length === 12) return `${d[0]} ${d.slice(1, 6)} ${d.slice(6, 11)} ${d[11]} · UPC-A`;
  if (d.length === 8) return `${d.slice(0, 4)} ${d.slice(4)} · EAN-8`;
  return String(code || "");
}

// Unknown barcode, no match, not LEGO, limits and setup — one card each,
// every one with a way forward (the camera stays open behind it).
function showScanMiss(el, res) {
  const reason = res.reasoning || t("bvAdd.nothingFound");
  const unknownCode = state.camera.mode === "barcode" && _lastBarcode && /not in (our |the )?catalog/i.test(reason);
  if (unknownCode) {
    haptic("error");
    showChip("");
    el.innerHTML = `${sheetTop()}
      <div class="bv-scanres">
        <div class="bv-scanres__miss">${kitIcon("alert", { size: 22 })}<div><h2>${escapeHtml(t("bvAdd.unknownTitle"))}</h2><p class="bv-num">${escapeHtml(formatBarcode(_lastBarcode))}</p></div></div>
        <p class="bv-scanres__body">${escapeHtml(t("bvAdd.unknownBody"))}</p>
        <button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="scanTryPhoto">${kitIcon("camera", { size: 20 })}<span>${escapeHtml(t("bvAdd.tryPhoto"))}</span></button>
        <button type="button" class="bv-btn bv-btn--outline bv-btn--full" id="scanTypeSet">${kitIcon("kbd", { size: 20 })}<span>${escapeHtml(t("bvAdd.typeSetNumber"))}</span></button>
        <button type="button" class="bv-btn bv-btn--text bv-btn--full" id="scanTeach">${kitIcon("plus", { size: 20 })}<span>${escapeHtml(t("bvAdd.teachBarcode"))}</span></button>
      </div>`;
    $("#scanTryPhoto")?.addEventListener("click", () => openScan("image"));
    $("#scanTypeSet")?.addEventListener("click", () => { clearScanResult(); showManualBarcodeEntry({ focus: true }); });
    $("#scanTeach")?.addEventListener("click", () => showTeachBarcode(el, _lastBarcode));
    return;
  }
  const noKey = !localStorage.getItem("bv_gemini_key") && !localStorage.getItem("bv_openai_key");
  const needsAccount = photoScanNeedsSetup();
  const failure = res.reason === 'not_lego'
    ? { kind: 'notlego', label: t("bvAdd.notLego"), retryable: true }
    : classifyScanFailure(reason);
  const rateLimited = failure.kind === "limit";
  const setupNeeded = failure.kind === "setup";
  const title = setupNeeded ? t("bvAdd.missSetup") : rateLimited ? t("bvAdd.missLimit") : failure.kind === "timeout" ? t("bvAdd.missTimeout") : failure.kind === "notlego" ? t("bvAdd.notLego") : t("bvAdd.missNoMatch");
  // Rate-limited: say WHEN it resets instead of offering a retry that will
  // just fail again (free = daily UTC window, supporters = hourly bursts).
  const resetHint = rateLimited ? `<p class="bv-field__help">${escapeHtml(t(/per hour/i.test(reason) ? "bvAdd.resetHourly" : "bvAdd.resetDaily"))}</p>` : "";
  // BYOK nudge: keyless users share the server's free scan quota.
  const nudge = noKey && (setupNeeded || rateLimited)
    ? `<div class="bv-banner bv-banner--neutral bv-banner--tight">${kitIcon("flash", { size: 20 })}<span class="bv-banner__text">${escapeHtml(t(needsAccount ? "bvAdd.nudgeSignIn" : "bvAdd.nudgeKey"))}</span></div>` : "";
  const actions = setupNeeded
    ? (needsAccount
      ? `<div class="bv-btn-row"><button type="button" class="bv-btn bv-btn--primary" id="scanSignIn">${escapeHtml(t("bvAdd.signIn"))}</button><button type="button" class="bv-btn bv-btn--outline" id="scanSetup">${escapeHtml(t("bvAdd.addKey"))}</button></div>`
      : `<div class="bv-btn-row"><button type="button" class="bv-btn bv-btn--primary" id="scanRetry">${escapeHtml(t("bvAdd.tryAgain"))}</button><button type="button" class="bv-btn bv-btn--outline" id="scanSetup">${escapeHtml(t("bvAdd.addKey"))}</button></div>`)
    : `<div class="bv-btn-row"><button type="button" class="bv-btn bv-btn--primary" id="scanRetry">${escapeHtml(t(rateLimited ? "common.close" : "bvAdd.tryAgain"))}</button>${state.camera.mode === "barcode" ? `<button type="button" class="bv-btn bv-btn--outline" id="scanTryPhoto">${kitIcon("camera", { size: 20 })}<span>${escapeHtml(t("bvAdd.tryPhotoShort"))}</span></button>` : ""}</div>`;
  if (failure.kind !== "setup") haptic("error");
  showChip("");
  el.innerHTML = `${sheetTop()}
    <div class="bv-scanres">
      <div class="bv-scanres__miss">${kitIcon(setupNeeded ? "gear" : rateLimited ? "clock" : "alert", { size: 22 })}<div><h2>${escapeHtml(title)}</h2></div></div>
      <p class="bv-scanres__body">${escapeHtml(reason)}</p>
      ${resetHint}${nudge}${actions}
    </div>`;
  $("#scanRetry")?.addEventListener("click", () => {
    if (rateLimited) closeScan();
    else clearScanResult({ restartCamera: true });
  });
  $("#scanTryPhoto")?.addEventListener("click", () => openScan("image"));
  $("#scanSignIn")?.addEventListener("click", () => { closeScan(); location.hash = "#/login"; });
  $("#scanSetup")?.addEventListener("click", () => { closeScan(); location.hash = "#/me/integrations"; });
}

// "Teach us this barcode": link the code to a set number for review (the
// contributions API; approved barcodes auto-apply to the catalog).
function showTeachBarcode(el, code) {
  if (isGuestMode()) {
    toast(t("bvAdd.teachSignIn"), "info");
    return;
  }
  el.innerHTML = `${sheetTop()}
    <form class="bv-scanres" id="teachForm" novalidate>
      <div class="bv-scanres__head"><h2>${escapeHtml(t("bvAdd.teachTitle"))}</h2>${kitIconBtn({ icon: "x", label: t("common.close"), id: "teachClose" })}</div>
      <p class="bv-scanres__body"><span class="bv-num">${escapeHtml(formatBarcode(code))}</span></p>
      ${kitField({ id: "teachSetNum", label: t("bvAdd.teachLabel"), placeholder: "10497", mono: true, inputmode: "text", autocomplete: "off" })}
      <button type="submit" class="bv-btn bv-btn--primary bv-btn--full" id="teachSubmit">${escapeHtml(t("bvAdd.teachSubmit"))}</button>
    </form>`;
  $("#teachClose")?.addEventListener("click", () => clearScanResult({ restartCamera: true }));
  $("#teachSetNum")?.focus();
  $("#teachForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const target = manualScanTarget($("#teachSetNum").value || "");
    if (target.kind !== "set") { toast(t("bvAdd.typeInvalid"), "error"); return; }
    const btn = $("#teachSubmit");
    setBtnLoading(btn, true);
    try {
      await api("/api/contributions/data", { method: "POST", body: { set_num: target.value, kind: "barcode", payload: { upc: String(code).replace(/\D/g, "") } } });
      toast(t("bvAdd.teachThanks"), "success");
      clearScanResult({ restartCamera: true });
    } catch (err) {
      setBtnLoading(btn, false);
      toast(t("common.errorWithDetails", { error: err.message || err }), "error");
    }
  });
}

function priceChipsHTML(set) {
  const rrp = Number(set.retail_price) || 0;
  const market = Number(displayValueOf(set)) || 0;
  const chips = [
    rrp > 0 ? `<button type="button" class="bv-chip" data-price="${rrp}" aria-pressed="false">${escapeHtml(t("bvAdd.chipRrp", { price: fmtMoney(rrp) }))}</button>` : "",
    market > 0 ? `<button type="button" class="bv-chip" data-price="${market}" aria-pressed="false">${escapeHtml(t("bvAdd.chipMarket", { price: fmtMoney(Math.round(market), { cents: 0 }) }))}</button>` : "",
    `<button type="button" class="bv-chip" data-price="other" aria-pressed="false">${escapeHtml(t("bvAdd.chipOther"))}</button>`,
  ].join("");
  const ctx = capturedMoneyContext();
  return `<div class="bv-scanres__price">
      <span class="bv-label"><strong>${escapeHtml(t("bvAdd.pricePaid"))}</strong> · ${escapeHtml(t("bvAdd.optional"))}</span>
      <div class="bv-chips bv-chips--wrap" id="scanPriceChips">${chips}</div>
      <div id="scanOtherWrap" hidden>${kitField({ id: "scanOtherPrice", label: t("bvAdd.pricePaid"), placeholder: "0.00", mono: true, prefix: CURRENCY_SYMBOLS[ctx.currency] || "$", inputmode: "decimal", autocomplete: "off" })}</div>
    </div>`;
}

// Reads the picked price chip / typed price → USD, or null (not chosen).
function readPickedPrice() {
  const on = document.querySelector("#scanPriceChips [aria-pressed='true']");
  if (!on) return { ok: true, usd: null };
  if (on.dataset.price !== "other") return { ok: true, usd: Math.round(Number(on.dataset.price) * 100) / 100 };
  const parsed = localMoneyToUsd($("#scanOtherPrice")?.value, capturedMoneyContext());
  if (!parsed.valid) return { ok: false };
  return { ok: true, usd: parsed.blank ? null : Math.round(parsed.usd * 100) / 100 };
}

function wirePriceChips() {
  $$("#scanPriceChips [data-price]").forEach((b) => b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    $$("#scanPriceChips [data-price]").forEach((x) => x.setAttribute("aria-pressed", String(x === b && on)));
    const other = $("#scanOtherWrap");
    if (other) other.hidden = !(on && b.dataset.price === "other");
    if (on && b.dataset.price === "other") $("#scanOtherPrice")?.focus();
    haptic("light");
  }));
}

function showSingleSet(el, set) {
  showChip(set.set_num, "lock");
  const value = Number(displayValueOf(set)) || 0;
  el.innerHTML = `${sheetTop()}
    <div class="bv-scanres">
      <button type="button" class="bv-scanres__set" id="scanDetails" aria-label="${escapeHtml(t("bvAdd.openSet", { name: set.name || set.set_num }))}">
        ${setThumbHTML(set)}
        <span class="bv-scanres__text"><span class="bv-scanres__name">${escapeHtml(set.name || set.set_num)}</span><span class="bv-scanres__meta">${setMetaLine(set)}</span></span>
        <span class="bv-scanres__value"><span class="bv-num" data-countup="${value}">${value > 0 ? `${estMark(set)}${escapeHtml(fmtMoney(Math.round(value), { cents: 0 }))}` : "—"}</span><small>${escapeHtml(t("bvAdd.market"))}</small></span>
      </button>
      <div id="scanOwned">${wishlistNoteHTML(set)}</div>
      ${priceChipsHTML(set)}
      <details class="bv-scanres__more">
        <summary>${escapeHtml(t("bvAdd.moreOptions"))}${kitIcon("down", { size: 18 })}</summary>
        <div class="bv-field"><span class="bv-field__label">${escapeHtml(t("bvAdd.condition"))}</span>
          ${kitSeg([{ label: t("bvAdd.condNew"), value: "new", current: true }, { label: t("bvAdd.condUsed"), value: "used_good" }], { label: t("bvAdd.condition"), id: "scanCond" })}</div>
        ${dealScoreHTML(set)}
        <div id="scanFlipCalcContainer">${flipCalcHTML(set, null)}</div>
        ${amazonSlotHTML(set.set_num, { compact: true })}
      </details>
      <div class="bv-scanres__actions">
        <button type="button" class="bv-btn bv-btn--primary" id="scanAdd">${kitIcon("plus", { size: 20, stroke: 2.2 })}<span>${escapeHtml(t("bvAdd.addToVault"))}</span></button>
        <button type="button" class="bv-iconbtn bv-scanres__dismiss" id="scanDismiss" aria-label="${escapeHtml(t("bvAdd.notThisOne"))}">${kitIcon("x")}</button>
      </div>
    </div>`;
  hydrateAmazonSlots(el, state.me?.retail_market || 'FR');
  wirePriceChips();
  countUpValue(el.querySelector("[data-countup]"), value, set);
  ownedEntryFor(set.set_num).then((entry) => {
    const box = $("#scanOwned");
    if (!box || !entry || !document.contains(box)) return;
    const qty = Number(entry.quantity) || 1;
    box.innerHTML = `<div class="bv-banner bv-banner--neutral bv-banner--tight" role="note">${kitIcon("copy", { size: 20 })}<span class="bv-banner__text">${escapeHtml(tPlural("bvAdd.ownCopies", qty, { count: qty, next: qty + 1 }))}</span></div>${wishlistNoteHTML(set)}`;
  });
  $$("#scanCond [data-value]").forEach((b) => b.addEventListener("click", () => {
    $$("#scanCond [data-value]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    haptic("light");
  }));
  const dpi = $("#dealPriceInput");
  if (dpi) {
    let debounceTid;
    dpi.addEventListener("input", (e) => {
      const val = e.target.value;
      clearTimeout(debounceTid);
      debounceTid = setTimeout(() => { updateDealBadge(set, val); updateFlipCalc(set, null, val); }, 150);
    });
  }
  $("#scanDetails")?.addEventListener("click", () => { closeScan(); location.hash = "#/set/" + encodeURIComponent(set.set_num); });
  $("#scanDismiss")?.addEventListener("click", () => { haptic("light"); clearScanResult({ restartCamera: true }); if (state.camera.mode !== "image" && isNativeCapacitor() && !_liveStop) runNativeBarcodeScan(); });
  $("#scanAdd")?.addEventListener("click", async () => {
    const price = readPickedPrice();
    if (!price.ok) { toast(t("bvAdd.priceInvalid"), "error"); $("#scanOtherPrice")?.focus(); return; }
    const condition = $("#scanCond [aria-pressed='true']")?.dataset.value || "new";
    haptic("heavy");
    setBtnLoading($("#scanAdd"), true);
    try {
      await addScannedSet(set, { priceUsd: price.usd, condition });
      resumeAfterAdd(set);
    } catch (e) {
      setBtnLoading($("#scanAdd"), false);
      toast(t('scanner.addItemFailed', { name: set.name, error: e.message || e }), "error");
    }
  });
}

// On your wishlist? Say so (with the target) — adding it here is the moment
// that wish comes true.
function wishlistNoteHTML(set) {
  const wanted = (state.wishlist || []).find((w) => w.set_num === set.set_num);
  if (!wanted) return "";
  const target = Number(wanted.target_price) > 0 ? t("bvAdd.wishTarget", { price: fmtMoney(Number(wanted.target_price)) }) : "";
  return `<div class="bv-banner bv-banner--acc bv-banner--tight" role="note">${kitIcon("heart", { size: 20 })}<span class="bv-banner__text">${escapeHtml(t("bvAdd.onWishlist"))}${target ? ` · ${escapeHtml(target)}` : ""}</span></div>`;
}

// The value counts up once when the result fills (reduced motion: instant).
function countUpValue(node, value, set) {
  if (!node || !(value > 0) || reducedMotion()) return;
  const start = performance.now();
  const dur = 420;
  const tick = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = estMark(set) + fmtMoney(Math.round(value * eased), { cents: 0 });
    if (k < 1 && node.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const FIG_RARITY_KEYS = {
  common: "minifigs.filterSummaryRarityCommon",
  uncommon: "minifigs.filterSummaryRarityUncommon",
  rare: "minifigs.filterSummaryRarityRare",
  legendary: "minifigs.filterSummaryRarityLegendary",
};
function figRowHTML(fig, idx) {
  const img = fig.image_url && !String(fig.image_url).startsWith("data:") ? `<img class="fig-photo" src="${escapeHtml(fig.image_url)}" alt="" loading="lazy">` : "";
  const minifigLabel = t("scanner.minifig");
  const rarityKeys = FIG_RARITY_KEYS;
  const minifigMetadata = fig.series
    ? t("scanner.minifigWithSeries", { minifig: minifigLabel, series: String(fig.series) })
    : fig.rarity
      ? t("scanner.minifigWithRarity", {
        minifig: minifigLabel,
        rarity: t(rarityKeys[String(fig.rarity).toLowerCase()] || "scanner.rarityUnknown"),
      })
      : minifigLabel;
  return `<label class="bv-scanres__row">
      <input type="checkbox" class="scan-fig-check" data-fignum="${escapeHtml(fig.fig_num)}" data-idx="${idx}" checked>
      ${kitThumb({ color: "#c9c4b3", imgHtml: img, size: 44 })}
      <span class="bv-scanres__text"><span class="bv-scanres__name">${escapeHtml(fig.name)}</span><span class="bv-scanres__meta">${escapeHtml(minifigMetadata)}</span></span>
      ${fig.current_value != null ? `<span class="bv-num">${escapeHtml(fmtMoney(fig.current_value))}</span>` : ""}
    </label>`;
}

async function addCheckedFigs(minifigs) {
  let added = 0;
  for (const box of $$(".scan-fig-check:checked")) {
    const fig = minifigs[Number(box.dataset.idx)];
    const path = `/api/minifigs/${encodeURIComponent(box.dataset.fignum)}`;
    try { await api(path, { method: "PUT", body: { quantity: 1 } }); added++; }
    catch (e) {
      if (!navigator.onLine) { outboxEnqueue({ path, method: 'PUT', body: { quantity: 1 } }); added++; }
      else toast(t('scanner.addItemFailed', { name: fig?.name || t('scanner.minifig'), error: e.message || e }), "error");
    }
  }
  if (added) invalidatePortfolio();
  return added;
}

// Photo ID: best matches with a confidence label; pick one (and any figs).
function showCandidates(el, sets, minifigs, res) {
  const confidence = String(res.confidence || 'high').toLowerCase();
  const matchLabel = (value) => t({ high: 'scanner.matchHigh', medium: 'scanner.matchMedium', low: 'scanner.matchLow' }[String(value || '').toLowerCase()] || 'scanner.match');
  const matchTone = (value) => ({ high: "gain", low: "loss" }[String(value || "").toLowerCase()] || "neutral");
  el.innerHTML = `${sheetTop()}
    <div class="bv-scanres">
      <div class="bv-scanres__head"><h2>${escapeHtml(sets.length ? t("bvAdd.bestMatches") : tPlural("scanner.minifigsFound", minifigs.length))}</h2><span class="bv-label">${escapeHtml(t({ high: 'scanner.confidenceHigh', medium: 'scanner.confidenceMedium', low: 'scanner.confidenceLow' }[confidence] || 'scanner.confidenceUnknown'))}</span></div>
      ${sets.length ? `<div class="bv-scanres__list" role="radiogroup" aria-label="${escapeHtml(t("bvAdd.bestMatches"))}">${sets.map((set, idx) => `
        <label class="bv-scanres__row">
          <input type="radio" name="scanPick" value="${idx}"${idx === 0 ? " checked" : ""}>
          ${setThumbHTML(set, 44)}
          <span class="bv-scanres__text"><span class="bv-scanres__name">${escapeHtml(set.name)}</span><span class="bv-scanres__meta">${setMetaLine(set)}</span></span>
          ${kitPill(matchLabel(set.match_confidence || (idx === 0 ? confidence : "low")), matchTone(set.match_confidence || (idx === 0 ? confidence : "low")))}
        </label>`).join("")}</div>` : ""}
      ${minifigs.length ? `<h3 class="bv-scanres__sub">${escapeHtml(t("bvAdd.minifigures"))}</h3><div class="bv-scanres__list">${minifigs.map(figRowHTML).join("")}</div>` : ""}
      <div class="bv-btn-row">
        <button type="button" class="bv-btn bv-btn--outline" id="scanRetake">${kitIcon("camera", { size: 20 })}<span>${escapeHtml(t("bvAdd.retake"))}</span></button>
        <button type="button" class="bv-btn bv-btn--primary" id="scanAdd">${kitIcon("plus", { size: 20, stroke: 2.2 })}<span>${escapeHtml(sets.length ? t("bvAdd.addThisSet") : t("bvAdd.addSelected"))}</span></button>
      </div>
    </div>`;
  $("#scanRetake")?.addEventListener("click", () => clearScanResult({ restartCamera: true }));
  $("#scanAdd")?.addEventListener("click", async () => {
    haptic("heavy");
    setBtnLoading($("#scanAdd"), true);
    const pick = sets[Number(document.querySelector("input[name='scanPick']:checked")?.value)];
    try {
      if (pick) await addScannedSet(pick);
      const figs = await addCheckedFigs(minifigs);
      if (!pick && !figs) { setBtnLoading($("#scanAdd"), false); toast(t("bvAdd.nothingSelected"), "info"); return; }
      if (!pick && figs) toast(tPlural('scanner.itemsAdded', figs), "success");
      resumeAfterAdd(pick || {});
    } catch (e) {
      setBtnLoading($("#scanAdd"), false);
      toast(t('scanner.addItemFailed', { name: pick?.name || "", error: e.message || e }), "error");
    }
  });
}

// Shelf Snap: every set the photo shows, numbered, pre-checked unless you
// already own it. The service returns sets without positions in the photo,
// so the numbers live on the checklist.
function showShelfChecklist(el, sets, minifigs) {
  const owned = new Set([...(state.portfolio?.items || []).map((i) => i.set_num), ...(state.ownedSetNums || [])]);
  const rows = sets.map((set, idx) => {
    const isOwned = owned.has(set.set_num);
    const value = Number(displayValueOf(set)) || 0;
    return `<label class="bv-scanres__row">
        <span class="bv-scanres__num">${idx + 1}</span>
        <span class="bv-scanres__text"><span class="bv-scanres__name">${escapeHtml(set.name)}</span><span class="bv-scanres__meta"><span class="bv-num">${escapeHtml(set.set_num)}</span>${isOwned ? ` · ${escapeHtml(t("bvAdd.alreadyOwned"))}` : ""}</span></span>
        ${value > 0 ? `<span class="bv-num">${escapeHtml(fmtMoney(Math.round(value), { cents: 0 }))}</span>` : ""}
        <input type="checkbox" class="scan-select-check" data-idx="${idx}" data-value="${value}"${isOwned ? "" : " checked"}>
      </label>`;
  }).join("");
  el.innerHTML = `${sheetTop()}
    <div class="bv-scanres">
      <div class="bv-scanres__head"><h2>${escapeHtml(tPlural("bvAdd.shelfFound", sets.length, { count: sets.length }))}</h2><span class="bv-label" id="shelfSummary"></span></div>
      <div class="bv-scanres__list">${rows}</div>
      ${minifigs.length ? `<h3 class="bv-scanres__sub">${escapeHtml(t("bvAdd.minifigures"))}</h3><div class="bv-scanres__list">${minifigs.map(figRowHTML).join("")}</div>` : ""}
      <div class="bv-btn-row">
        <button type="button" class="bv-btn bv-btn--outline" id="scanRetake">${kitIcon("camera", { size: 20 })}<span>${escapeHtml(t("bvAdd.retake"))}</span></button>
        <button type="button" class="bv-btn bv-btn--primary" id="scanAdd">${kitIcon("plus", { size: 20, stroke: 2.2 })}<span id="shelfAddLabel"></span></button>
      </div>
    </div>`;
  const summarize = () => {
    const checked = $$(".scan-select-check:checked");
    const total = checked.reduce((a, b) => a + (Number(b.dataset.value) || 0), 0);
    const s = $("#shelfSummary");
    if (s) s.textContent = t("bvAdd.shelfSelected", { count: checked.length, total: fmtMoney(Math.round(total), { cents: 0 }) });
    const l = $("#shelfAddLabel");
    if (l) l.textContent = tPlural("bvAdd.addSets", checked.length, { count: checked.length });
  };
  summarize();
  $$(".scan-select-check").forEach((c) => c.addEventListener("change", summarize));
  $("#scanRetake")?.addEventListener("click", () => clearScanResult({ restartCamera: true }));
  $("#scanAdd")?.addEventListener("click", async () => {
    const checked = $$(".scan-select-check:checked").map((c) => sets[Number(c.dataset.idx)]);
    haptic("heavy");
    setBtnLoading($("#scanAdd"), true);
    let failed = 0;
    for (const set of checked) {
      try { await addScannedSet(set); } catch { failed++; }
    }
    const figs = await addCheckedFigs(minifigs);
    if (!checked.length && !figs) { setBtnLoading($("#scanAdd"), false); toast(t("bvAdd.nothingSelected"), "info"); return; }
    if (failed) toast(tPlural('scanner.bulkPartial', failed, { added: checked.length - failed, total: checked.length, failed }), "error");
    paintCloseButton();
    clearScanResult({ restartCamera: true });
  });
}


async function processBulkScanQueue(files) {
  const { controller, generation } = beginScanRequest();
  const stale = () => generation !== _scanGeneration || controller.signal.aborted;
  stopCamera();
  setScanPending(true);

  const el = $("#scanResult");
  if (el) {
    el.classList.add("show", "loading");
    document.querySelector(".bv-scan")?.classList.add("has-result");
    el.innerHTML = `
      <div class="scan-loading" style="padding:24px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;">
        <div class="spinner"></div>
        <div id="bulkScanProgressText" style="font-weight:600;font-size:15px;color:var(--ink);">Processing queue...</div>
        <div style="background:var(--line-soft);border-radius:4px;height:6px;width:100%;max-width:260px;overflow:hidden;margin-top:6px;">
          <div id="bulkScanProgressBar" style="background:var(--up);height:100%;width:0%;transition:width 0.25s ease;"></div>
        </div>
      </div>`;
  }

  const results = [];
  const progressText = document.getElementById("bulkScanProgressText");
  const progressBar = document.getElementById("bulkScanProgressBar");

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
if (progressText) progressText.textContent = t('downloads.scanProgress', { current: i + 1, total: files.length });
    if (progressBar) progressBar.style.width = `${((i) / files.length) * 100}%`;

    let dataUrl = "";
    try {
      // Guard: a very large file is read fully into memory before resize and can
      // crash the tab. Reject up front; the catch below records it as a skip.
      if (file && file.size > 20 * 1024 * 1024) throw new Error("Image too large (max 20 MB) — skipped");
      dataUrl = await readFileAsDataURL(file);
      if (stale()) return;
      const resized = await resizeImage(dataUrl, 1024);
      if (stale()) return;

      let apiRes;
      const scanEngine = localStorage.getItem('bv_ai_engine') || 'cloud';
      const localReady = scanEngine === 'local' && isWebGpuAvailable() && await checkGemma3Downloaded();
      if (stale()) return;
      const cloudScan = () => cloudScanIdentify({ mode: "image", image: resized }, controller.signal);
      if (localReady) {
        try {
          const bitmap = await imageBitmapFromDataUrl(resized);
          if (stale()) return;
          const localResult = await runLocalVisionScan(bitmap);
          if (stale()) return;
          if (localResult.identified) {
            const setNum = localResult.set_num;
            let setResponse = await api(`/api/sets/${encodeURIComponent(setNum)}`, { signal: controller.signal }).catch(() => null);
            if (stale()) return;
            if (!setResponse) {
              const cached = await getCachedSetDetail(setNum, getSessionUserId());
              if (cached?.set) setResponse = { set: cached.set, entry: cached.entry };
            }
            const set = setResponse?.set || setResponse || {
              set_num: setNum,
              name: localResult.name || "Unknown Set",
              current_value: 0,
              theme: "Local AI"
            };
            apiRes = { identified: true, sets: [set], confidence: localResult.confidence, reasoning: localResult.reasoning };
          } else {
            // On-device couldn't identify — let the cloud try this image.
            apiRes = await cloudScan();
          }
        } catch {
          apiRes = await cloudScan();
        }
      } else {
        apiRes = await cloudScan();
      }

      results.push({
        success: apiRes.identified,
        sets: apiRes.sets || (apiRes.set ? [apiRes.set] : []),
        error: apiRes.reasoning,
        thumbnail: resized
      });
    } catch (err) {
      if (stale()) return;
      results.push({
        success: false,
        error: err.message,
        thumbnail: dataUrl || ""
      });
    }
  }

  if (progressBar) progressBar.style.width = "100%";
  if (progressText) progressText.textContent = "Done!";

  setTimeout(() => {
    if (generation !== _scanGeneration) return;
    if (_scanController === controller) _scanController = null;
    showBulkScanResults(results);
  }, 300);
}

function showBulkScanResults(results) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");
  el.classList.remove("loading");
  document.querySelector(".bv-scan")?.classList.add("has-result");
  setScanPending(false);

  let rowsHTML = `<div style="display:flex;flex-direction:column;gap:12px;margin:8px 0 16px;max-height:55vh;overflow-y:auto;padding-right:4px;">`;

  results.forEach((res, idx) => {
    const thumb = res.thumbnail;
    if (!res.success || !res.sets || !res.sets.length) {
      rowsHTML += `
        <div class="scan-result-row" style="display:flex;align-items:center;background:var(--surface-2);padding:10px;border-radius:var(--r-2);border:1.5px solid var(--line-soft);margin-bottom:8px;">
          <img src="${thumb}" style="width:48px;height:48px;border-radius:var(--r-1);object-fit:cover;flex-shrink:0;">
          <div style="margin-left:12px;flex:1;text-align:left;">
            <div style="font-size:11px;font-family:var(--mono);color:var(--down);font-weight:700;">Could not identify</div>
            <div style="font-size:12px;color:var(--ink-mute);margin-top:2px;">${escapeHtml(res.error || "No match found")}</div>
          </div>
          <button class="btn-secondary" style="padding:6px 10px;font-size:11px;width:auto;" id="bulkSearchBtn_${idx}">Search</button>
        </div>`;
      setTimeout(() => {
        $(`#bulkSearchBtn_${idx}`)?.addEventListener("click", () => {
          closeScan();
          location.hash = '#/add';
        });
      }, 50);
      return;
    }

    const set = res.sets[0];
    const isOwned = state.portfolio?.items?.some(i => i.set_num === set.set_num);
    const ownedEntry = state.portfolio?.items?.find(i => i.set_num === set.set_num);

    const h = setHue(set);
    const hasImg = set.image_url && !set.image_url.startsWith("data:");

    let controlHTML = "";
    if (isOwned) {
      controlHTML = `
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          <span style="font-size:10px;font-family:var(--mono);color:var(--ink-soft);font-weight:700;">ALREADY OWNED</span>
          <label style="font-size:11px;color:var(--ink);display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" class="bulk-qty-check" data-owned-id="${ownedEntry.id}" data-owned-qty="${ownedEntry.quantity || 1}" checked style="width:16px;height:16px;">
            +1 Qty
          </label>
        </div>`;
    } else {
      controlHTML = `
        <input type="checkbox" class="bulk-add-check" data-setnum="${escapeHtml(set.set_num)}" data-price="${set.current_value || 0}" checked style="width:18px;height:18px;cursor:pointer;">`;
    }

    rowsHTML += `
      <div class="scan-result-row" style="display:flex;align-items:center;background:var(--surface-2);padding:10px;border-radius:var(--r-2);border:1.5px solid var(--line-soft);margin-bottom:8px;">
        <img src="${thumb}" style="width:48px;height:48px;border-radius:var(--r-1);object-fit:cover;flex-shrink:0;margin-right:12px;">
        <div class="si${hasImg ? " has-photo" : ""}" style="width:36px;height:36px;border-radius:var(--r-1);background:linear-gradient(135deg, var(--surface-2), var(--surface-3));flex-shrink:0;position:relative;margin-right:8px;">
          <div class="brick-tile" style="--h:${h};width:100%;height:100%;border-radius:var(--r-1);"></div>
          ${hasImg ? `<img src="${escapeHtml(set.image_url)}" alt="" style="position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;mix-blend-mode:multiply;">` : ""}
        </div>
        <div style="flex:1;min-width:0;text-align:left;margin-right:8px;">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(set.name)}</div>
          <div style="font-size:10px;color:var(--ink-mute);">${escapeHtml(set.theme || "")} · #${escapeHtml(set.set_num)}</div>
        </div>
        ${controlHTML}
      </div>`;
  });

  rowsHTML += `</div>`;

  const actionsHTML = `
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn-secondary" id="bulkCancel">Cancel</button>
      <button class="btn-primary" id="bulkAddBtn">${I.plus()}<span>Add selected</span></button>
    </div>`;

  el.innerHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()}BATCH RESULTS</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${tPlural('scanner.bulkMatched', results.filter(r => r.success).length, { total: results.length })}</span>
    </div>
    ${rowsHTML}
    ${actionsHTML}
  `;

  document.getElementById("bulkCancel").addEventListener("click", () => {
    clearScanResult();
    state.camera.scanning = true;
    startCamera();
  });

  document.getElementById("bulkAddBtn").addEventListener("click", async () => {
    haptic("heavy");
    setBtnLoading($("#bulkAddBtn"), true);

    const adds = Array.from(el.querySelectorAll(".bulk-add-check:checked"));
    const qtys = Array.from(el.querySelectorAll(".bulk-qty-check:checked"));

    if (!adds.length && !qtys.length) {
      toast("No sets selected to add", "info");
      setBtnLoading($("#bulkAddBtn"), false);
      return;
    }

    try {
      // Offline: queue everything in the outbox in one pass (mirrors the
      // single-add path) — one clear toast instead of N "Saved offline" toasts
      // and a misleading "updated successfully".
      if (!navigator.onLine) {
        for (const chk of adds) {
          outboxEnqueue({ path: "/api/collection", method: "POST", body: { set_num: chk.dataset.setnum, quantity: 1, purchase_price: parseFloat(chk.dataset.price) || 0 } });
        }
        for (const chk of qtys) {
          outboxEnqueue({ path: "/api/collection/" + chk.dataset.ownedId, method: "PATCH", body: { quantity: parseInt(chk.dataset.ownedQty, 10) + 1 } });
        }
        invalidatePortfolio();
        toast(tPlural('scanner.setsSavedOffline', adds.length + qtys.length), "info");
        closeScan();
        location.hash = "#/";
        return;
      }

      const addPromises = adds.map(chk => {
        const setNum = chk.dataset.setnum;
        const price = parseFloat(chk.dataset.price) || 0;
        return api("/api/collection", {
          method: "POST",
          body: { set_num: setNum, quantity: 1, purchase_price: price }
        });
      });

      const qtyPromises = qtys.map(chk => {
        const id = chk.dataset.ownedId;
        const currentQty = parseInt(chk.dataset.ownedQty, 10);
        return api("/api/collection/" + id, {
          method: "PATCH",
          body: { quantity: currentQty + 1 }
        });
      });

      const results = await Promise.allSettled([...addPromises, ...qtyPromises]);
      const failed = results.filter(r => r.status === "rejected").length;
      invalidatePortfolio();
      if (failed === 0) toast("Vault updated", "success");
      else toast(tPlural('scanner.bulkPartial', failed, { added: results.length - failed, total: results.length, failed }), "error");
      closeScan();
      // Wait, renderPortfolio can be imported or we navigate
      location.hash = "#/";
    } catch (err) {
      toast(t('scanner.addSetsFailed', { error: err.message || err }), "error");
      setBtnLoading($("#bulkAddBtn"), false);
    }
  });
}

// The loud in-store answer. Without a typed price it coaches ("grab under
// $X"); with one it renders the GRAB IT / FAIR PRICE / WALK AWAY banner.
function storeVerdictHTML(set, price) {
  const v = computeStoreVerdict(set, price);
  if (!v) return "";
  const estimated = v.estimated ? ` ${t('scanner.estimatedValue')}` : "";
  if (v.verdict === "guide") {
    return `<div style="font-size:12px;color:var(--ink-mute);margin-top:6px;">${escapeHtml(t('scanner.marketGrabThreshold', { market: fmtMoney(v.market), price: fmtMoney(v.grabUnder), estimated }))}</div>`;
  }
  const styles = {
    grab: { bg: "var(--up)", label: "GRAB IT", sub: t('scanner.underMarket', { amount: fmtMoney(Math.abs(v.deltaUsd)), estimated }) },
    fair: { bg: "var(--accent)", label: "FAIR PRICE", sub: t('scanner.withinMarket', { pct: Math.round(Math.abs(v.deltaPct) * 100), estimated }) },
    walk: { bg: "var(--down)", label: "WALK AWAY", sub: t('scanner.overMarket', { amount: fmtMoney(Math.abs(v.deltaUsd)), estimated }) },
  }[v.verdict];
  return `
    <div class="store-verdict ${v.verdict}" style="display:flex;align-items:baseline;gap:10px;margin-top:8px;padding:10px 14px;border-radius:var(--r-2);background:${styles.bg};color:#fff;">
      <span style="font-family:var(--mono);font-weight:800;font-size:16px;letter-spacing:.05em;">${styles.label}</span>
      <span style="font-size:12px;opacity:.95;">${escapeHtml(styles.sub)}</span>
    </div>`;
}

function dealScoreHTML(set) {
  return `
    <div class="deal-score-wrap" id="dealScoreWrap">
      <div class="deal-score-lbl">In-store price check</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" class="deal-price-input" id="dealPriceInput" placeholder="Enter store price…" min="0" step="0.01">
        <div class="deal-badge" id="dealBadge"></div>
      </div>
      <div id="storeVerdictSlot">${storeVerdictHTML(set)}</div>
    </div>`;
}

function updateDealBadge(set, priceStr) {
  const badge = document.getElementById("dealBadge");
  if (!badge) return;
  const price = parseFloat(priceStr);
  const slot = document.getElementById("storeVerdictSlot");
  if (slot) slot.innerHTML = storeVerdictHTML(set, price);
  if (!price || price <= 0) { badge.textContent = ""; badge.className = "deal-badge"; return; }
  const score = computeDealScorePure(set, price);
  if (!score) return;
  badge.className = `deal-badge ${score.verdict}`;
  const labels = { great: "GREAT DEAL", fair: "FAIR PRICE", over: "OVERPRICED" };
  badge.textContent = labels[score.verdict];
  badge.title = score.label;

  badge.style.cursor = "pointer";
  badge.onclick = () => {
    haptic("light");
    openDealBreakdownSheet(set, price);
  };
}

function openDealBreakdownSheet(set, storePrice) {
  const market = parseFloat(marketValueForCondition(set, set?.condition || 'new') || 0);
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  
  const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const tax = parseFloat(localStorage.getItem("bv_flip_tax") ?? "0.00");

  const calc = flipEconomics({ marketUsd: market, rate, feePct, paymentPct, shipping, tax });
  if (!calc) return;
  const { marketplaceFee: ebayFee, paymentFee: paypalFee, net } = calc;
  const profit = net - storePrice;
  const roi = storePrice > 0 ? (profit / storePrice) * 100 : 0;

  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Deal Score Breakdown</div>
    <div class="deal-breakdown-details" style="display:flex;flex-direction:column;gap:10px;font-size:14px;padding:4px;">
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Market Value</span>
        <strong>${fmtMoney(market)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Your Store Price</span>
        <strong>${symbol}${storePrice.toFixed(2)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">${t("fees.marketplace", { pct: feePct })}</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${ebayFee.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">${t("fees.payment", { pct: paymentPct })}</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${paypalFee.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Shipping Cost</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${shipping.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Tax / VAT</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${tax.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1.5px solid var(--line);padding-bottom:8px;font-size:16px;">
        <span>Estimated Net Profit</span>
        <strong style="color:${profit >= 0 ? "var(--up)" : "var(--bv-red)"};">${profit >= 0 ? "+" : ""}${symbol}${profit.toFixed(2)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:16px;">
        <span>Est. Return on Investment</span>
        <strong style="color:${profit >= 0 ? "var(--up)" : "var(--bv-red)"};">${profit >= 0 ? "+" : ""}${roi.toFixed(1)}% ROI</strong>
      </div>
    </div>
    <button class="btn-primary" id="dbClose" style="margin-top:16px;">Done</button>
  `);
  $("#dbClose").addEventListener("click", hideSheet);
}


export function updateFlipCalc(set, entry, storePrice) {
  const container = document.querySelector(".flip-calc-wrap");
  if (!container) return;
  const price = parseFloat(storePrice) || 0;
  const condition = entry?.condition || 'new';
  const market = parseFloat(marketValueForCondition(set, condition) || 0);
  if (market <= 0) return;

  let estPriceUsd = market;
  if (condition.startsWith('used') && !set.ebay_used_value) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPriceUsd = market * ratio;
  }
  // Same shared math (and the same exchange-rate conversion) as the deal
  // breakdown sheet — the user-entered store price is in THEIR currency, so
  // the net must be too, or the ROI is nonsense for non-USD users.
  const rate2 = getExchangeRate(state.me?.currency || "USD");
  const feePct2 = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct2 = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping2 = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const tax2 = parseFloat(localStorage.getItem("bv_flip_tax") ?? "0.00");
  const calc2 = flipEconomics({ marketUsd: estPriceUsd, rate: rate2, feePct: feePct2, paymentPct: paymentPct2, shipping: shipping2, tax: tax2 });
  if (!calc2) return;
  const net = calc2.net;

  const resultEl = container.querySelector(".flip-result");
  if (resultEl) {
    if (price > 0) {
      const netRoi = ((net - price) / price) * 100;
      const roiColor = netRoi >= 0 ? 'var(--up)' : 'var(--bv-red)';
      resultEl.innerHTML = `<div style="font-size:11px;margin-top:4px;">Net ROI: <strong style="color:${roiColor};">${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(1)}%</strong></div>`;
    } else {
      resultEl.innerHTML = '';
    }
  }
}

