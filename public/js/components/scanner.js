import { $, $$, haptic, escapeHtml, fmtMoney, toast, setBtnLoading, readFileAsDataURL, resizeImage, setHue, getExchangeRate, CURRENCY_SYMBOLS, activateFocusTrap, FOCUSABLE_SEL, getCachedSetDetail, track } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, outboxEnqueue, getSessionUserId, photoScanNeedsSetup } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet } from './sheet.js';
import { computeDealScore as computeDealScorePure, computeStoreVerdict, marketValueForCondition, flipEconomics, classifyScanFailure, manualScanTarget, scanResultHeading } from '../lib/pure.js';
import { checkGemma3Downloaded, runLocalVisionScan, isWebGpuAvailable } from '../lib/local-ai.js';
import { flipCalcHTML } from './flip-calc.js';
import { isNativeCapacitor } from '../lib/native-auth.js';
import { amazonSlotHTML, hydrateAmazonSlots } from '../lib/amazon-affiliate.js';
import { t, tPlural, kidsXpMessage, kidsBadgeLabel } from '../lib/i18n.js';

let _scanTrapRelease = null;
let _scanPending = false;
let _scanController = null;
let _scanGeneration = 0;

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
  const wrap = document.querySelector(".scan-video-wrap");
  const capture = $("#scanCapture");
  const gallery = $("#scanGalleryBtn");
  wrap?.classList.toggle("scan-busy", _scanPending);
  if (capture) {
    capture.disabled = _scanPending || wrap?.classList.contains("camera-unavailable");
    capture.setAttribute("aria-busy", _scanPending ? "true" : "false");
  }
  if (gallery) gallery.disabled = _scanPending;
}

function clearScanResult({ restartBarcode = false } = {}) {
  const el = $("#scanResult");
  if (el) {
    el.classList.remove("show", "loading");
    el.innerHTML = "";
  }
  document.querySelector(".scan-video-wrap")?.classList.remove("has-result");
  setScanPending(false);
  const hint = $("#scanHint");
  if (hint) hint.textContent = state.camera.mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify";
  if (restartBarcode && state.camera.mode === "barcode" && state.camera.detector) {
    state.camera.scanning = true;
    clearInterval(state.camera.timer);
    state.camera.timer = setInterval(scanBarcode, 400);
  }
}

function showScanLoading(label = "Identifying...", detail = "This can take up to 30 seconds.") {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show", "loading");
  document.querySelector(".scan-video-wrap")?.classList.add("has-result");
  el.innerHTML = `
    <div class="scan-loading">
      <div class="spinner" aria-hidden="true"></div>
      <div class="scan-loading-copy">
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
    </div>`;
}

export function openScan(mode = "barcode", { deferStart = false, shelf = false } = {}) {
  // Check access before mounting the full-screen camera. Guests without a BYOK
  // key get a small setup sheet while barcode/manual lookup remain available.
  if (mode === "image" && photoScanNeedsSetup()) {
    showPhotoScanSetupSheet();
    return;
  }

  invalidateScanSession();

  state.camera.mode = mode;
  // Shelf Snap: photo mode variant — one wide photo, every set on the shelf.
  state.camera.shelf = mode === "image" && !!shelf;
  const ov = $("#scanOverlay");
  ov.classList.remove("native-handoff");
  ov.innerHTML = scanOverlayHTML(mode, state.camera.shelf);
  ov.classList.add("open");
  document.body.classList.add("scan-active");
  $("#scanCloseBtn")?.addEventListener("click", closeScan);
  _scanTrapRelease?.();
  _scanTrapRelease = activateFocusTrap(ov, closeScan);
  ov.querySelector(FOCUSABLE_SEL)?.focus();


  
  // Swipe horizontally to close camera overlay
  let touchstartX = 0;
  let touchstartY = 0;
  ov.addEventListener('touchstart', e => {
    touchstartX = e.changedTouches[0].screenX;
    touchstartY = e.changedTouches[0].screenY;
  }, { passive: true });
  ov.addEventListener('touchend', e => {
    const touchendX = e.changedTouches[0].screenX;
    const touchendY = e.changedTouches[0].screenY;
    const dx = touchendX - touchstartX;
    const dy = touchendY - touchstartY;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 50) {
      closeScan();
      haptic("medium");
    }
  }, { passive: true });

  $$(".scan-mode-toggle button").forEach(b => b.addEventListener("click", () => {
    stopCamera();
    openScan(b.dataset.mode);
  }));
  $("#scanCapture")?.addEventListener("click", capturePhoto);

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
          sendScanToAPI({ mode: "shelf", image: resized });
          return;
        }
        processBulkScanQueue(files);
      });
    }
    // One set vs whole shelf — flips the capture between the single-set
    // identify and the exhaustive Shelf Snap prompt.
    $$(".scan-shelf-opt").forEach(btn => btn.addEventListener("click", () => {
      state.camera.shelf = btn.dataset.shelf === "1";
      haptic("light");
      $$(".scan-shelf-opt").forEach(b => {
        const on = b === btn;
        b.style.background = on ? "var(--accent)" : "transparent";
        b.style.color = on ? "#fff" : "#fff9";
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.shelf
        ? "Fit the whole shelf in frame — good light helps"
        : "Frame the set and tap to identify";
    }));
  }

  if (!deferStart) startCamera();
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

export function closeScan() {
  invalidateScanSession();
  stopCamera();
  _scanTrapRelease?.();
  _scanTrapRelease = null;
  document.body.classList.remove("scan-active");
  $("#scanOverlay").classList.remove("open", "native-handoff");
  $("#scanOverlay").innerHTML = "";
  _scanPending = false;
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

export function stopCamera() {
  clearInterval(state.camera.timer);
  state.camera.timer = null;
  if (state.camera.stream) {
    state.camera.stream.getTracks().forEach(t => t.stop());
    state.camera.stream = null;
  }
  state.camera.scanning = false;
}

export async function startCamera() {
  track("scan_attempt", state.camera.mode || "barcode");
  // On the installed app, barcode / blind-box modes use the native ML Kit
  // scanner — NEVER the getUserMedia path. The overlay is rendered in
  // "native-scan" mode (video hidden), so a getUserMedia fallback would show a
  // black screen. If ML Kit isn't usable, offer manual entry instead.
  if (state.camera.mode !== "image" && isNativeCapacitor()) {
    let supported = false;
    try {
      const { nativeBarcodeSupported } = await import("../lib/native-barcode.js");
      supported = await nativeBarcodeSupported(window);
    } catch { /* import/plugin failure → manual entry below */ }
    if (supported) { runNativeBarcodeScan(); return; }
    const hint = $("#scanHint");
    if (hint) hint.textContent = "Type the barcode or set number below";
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

    if (state.camera.mode !== "image" && "BarcodeDetector" in window) {
      state.camera.detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"] });
      state.camera.scanning = true;
      state.camera.timer = setInterval(scanBarcode, 400);
    } else if (state.camera.mode !== "image") {
      const hint = $("#scanHint");
      if (hint) hint.textContent = "Live barcode scanning isn't supported on this browser — type the digits instead";
      showManualBarcodeEntry();
    }
  } catch (err) {
    const hint = $("#scanHint");
    const isDenied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
    document.querySelector(".scan-video-wrap")?.classList.add("camera-unavailable");
    // The fallback differs by mode: Photo mode can still identify from a
    // gallery image; Barcode mode falls back to typing the digits.
    const photoMode = state.camera.mode === 'image';
    if (hint) hint.textContent = isDenied
      ? (photoMode
        ? "Camera permission denied — grant access in browser/system settings, or pick a photo from your gallery instead."
        : "Camera permission denied — grant access in browser/system settings, or type a set number below.")
      : "Camera not available — check permissions or try a different browser.";
    const capture = $("#scanCapture");
    if (capture) {
      capture.disabled = true;
      capture.setAttribute("aria-disabled", "true");
    }
    showManualBarcodeEntry();
  }
}

// Native ML Kit barcode flow (installed app). Launches the full-screen native
// scanner and routes the result through the same lookup path as the web
// detector. Cancelling returns to the Scan route's method picker. No
// getUserMedia loop — ML Kit owns the camera.
async function runNativeBarcodeScan() {
  // Release any getUserMedia stream first (e.g. after switching from Photo
  // mode) so ML Kit's scanner can acquire the camera — otherwise scan() fails
  // and drops to the "camera unavailable" manual-entry fallback.
  stopCamera();
  $("#nativeRescanBtn")?.remove();
  document.querySelector(".scan-video-wrap")?.classList.add("native-scan");
  const hint = $("#scanHint");
  if (hint) hint.textContent = "Opening scanner…";
  const overlay = $("#scanOverlay");
  // Once control passes to ML Kit, reveal the route's method picker underneath.
  // Android can take a moment to settle the cancelled scan promise after Back;
  // keeping this WebView overlay hidden prevents the redundant scanner flash.
  overlay?.classList.add("native-handoff");
  _scanTrapRelease?.();
  _scanTrapRelease = null;
  // Give the OS a moment to fully release the camera before ML Kit grabs it.
  await new Promise((r) => setTimeout(r, 200));
  let code = null;
  try {
    const { scanBarcodeNative } = await import("../lib/native-barcode.js");
    code = await scanBarcodeNative(window);
  } catch { code = null; }
  // The overlay may have been dismissed (back button / swipe) mid-scan.
  if (!overlay?.classList.contains("open")) return;
  if (code) {
    overlay.classList.remove("native-handoff");
    _scanTrapRelease = activateFocusTrap(overlay, closeScan);
    haptic("medium");
    if (hint) hint.textContent = state.camera.mode === "blindbox" ? "Finding the series…" : "Looking up barcode…";
    routeScannedCode(code);
    return;
  }
  // Cancellation is navigation, not an error state. Return to the Scan route's
  // method picker instead of revealing a second, redundant scanner screen.
  closeScan();
  requestAnimationFrame(() => $("#pileScanBarcode")?.focus());
}

function ensureNativeRescanButton() {
  if ($("#nativeRescanBtn")) return;
  const wrap = document.querySelector(".scan-video-wrap");
  if (!wrap) return;
  const btn = document.createElement("button");
  btn.id = "nativeRescanBtn";
  btn.className = "scan-native-cta";
  btn.type = "button";
  btn.textContent = "Scan barcode";
  btn.addEventListener("click", () => {
    $("#nativeRescanBtn")?.remove();
    $("#manualBarcodeRow")?.remove();
    runNativeBarcodeScan();
  });
  wrap.appendChild(btn);
}

// Fallback for browsers without the BarcodeDetector API (e.g. desktop
// Firefox): a manual digit-entry field wired to the same barcode lookup.
function showManualBarcodeEntry() {
  track("scan_fallback", state.camera.mode || "barcode");
  const hint = $("#scanHint");
  if (!hint || $("#manualBarcodeRow")) return;
  const el = $("#scanResult");
  if (el) {
    document.querySelector(".scan-video-wrap")?.classList.add("has-result");
    el.classList.add("show", "manual");
    el.classList.remove("loading");
    el.innerHTML = `
      <div id="manualBarcodeRow" class="scan-manual-card">
        <div class="scan-result-head">
          <span class="badge">${I.search({ w: 12 })}LOOKUP</span>
          <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">Barcode or set number</span>
        </div>
        <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;line-height:1.45;">Prefer to type it in? Enter the UPC from the box or a set number such as 71043-1.</p>
        <div class="scan-manual-row">
          <input type="text" id="manualBarcodeInput" inputmode="text"
            placeholder="Barcode or set number" autocomplete="off" spellcheck="false">
          <button class="btn-primary" id="manualBarcodeGo">${I.search({ w: 16 })}<span>Find set</span></button>
        </div>
        ${state.camera.mode === "image" ? `<button class="btn-secondary scan-manual-gallery" id="manualGalleryGo">${I.layers({ w: 16, h: 16 })}<span>Choose photo instead</span></button>` : ""}
      </div>`;
    const submit = async () => {
      const raw = ($("#manualBarcodeInput")?.value || "").trim();
      if (raw.length < 3) {
        hint.textContent = "Type a barcode or LEGO set number first";
        return;
      }
      haptic("medium");
      hint.textContent = "Looking up catalog...";
      const target = manualScanTarget(raw);
      if (target.kind === "set") await sendManualSetLookup(target.value);
      else if (target.kind === "barcode") routeScannedCode(target.value);
      else hint.textContent = "Use a set number like 71043-1, or a barcode with at least 8 digits";
    };
    $("#manualBarcodeGo")?.addEventListener("click", submit);
    $("#manualBarcodeInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    $("#manualGalleryGo")?.addEventListener("click", () => $("#scanGalleryInput")?.click());
    // No auto-focus: it pops the Android keyboard over the camera view the
    // moment the scanner opens. The field is one tap away when wanted.
    return;
  }
  const row = document.createElement("div");
  row.id = "manualBarcodeRow";
  row.style.cssText = "display:flex;gap:8px;margin:10px 16px 0;";
  row.innerHTML = `
    <input type="text" id="manualBarcodeInput" inputmode="numeric" pattern="[0-9]*"
      placeholder="Type barcode digits…" autocomplete="off"
      style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-family:var(--mono);font-size:15px;">
    <button class="btn-primary" id="manualBarcodeGo" style="padding:10px 16px;">Look up</button>`;
  hint.insertAdjacentElement("afterend", row);
  const submit = () => {
    const digits = ($("#manualBarcodeInput")?.value || "").replace(/\D/g, "");
    if (digits.length < 8) {
      hint.textContent = "Barcodes are at least 8 digits — check the number under the bars";
      return;
    }
    haptic("medium");
    hint.textContent = state.camera.mode === "blindbox" ? "Finding the series…" : "Looking up barcode…";
    routeScannedCode(digits);
  };
  $("#manualBarcodeGo")?.addEventListener("click", submit);
  $("#manualBarcodeInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
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
    throw new Error("Enter a set number such as 71043-1, or a barcode with at least 8 digits.");
  }
  if (target.kind === "set") {
    location.hash = `#/set/${encodeURIComponent(target.value)}`;
    return target;
  }

  openScan("barcode", { deferStart: true });
  const hint = $("#scanHint");
  if (hint) hint.textContent = "Looking up barcode...";
  await routeScannedCode(target.value);
  return target;
}

async function scanBarcode() {
  if (!state.camera.scanning) return;
  const vid = $("#scanVideo");
  if (!vid || vid.readyState < 2) return;
  try {
    const codes = await state.camera.detector.detect(vid);
    if (codes.length > 0) {
      state.camera.scanning = false;
      clearInterval(state.camera.timer);
      haptic("medium");
      const barcode = codes[0].rawValue;
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.mode === "blindbox" ? "Finding the series…" : "Looking up barcode…";
      routeScannedCode(barcode);
    }
  } catch {}
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
  sendScanToAPI({ mode: state.camera.shelf ? "shelf" : "image", image: dataUrl });
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

async function cloudScanIdentify(payload, signal) {
  const geminiKey = localStorage.getItem('bv_gemini_key');
  const openaiKey = localStorage.getItem('bv_openai_key');
  const extraHeaders = {};
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
  }
  const _t = performance.now();
  const res = await api("/api/scan/identify", { method: "POST", body: payload, signal, headers: extraHeaders });
  scanTime(payload.mode === 'barcode' ? 'barcode lookup' : 'cloud identify round-trip', _t);
  return res;
}

async function sendScanToAPI(payload) {
  const { controller, generation } = beginScanRequest();
  const stale = () => generation !== _scanGeneration || controller.signal.aborted;
  _scanStartMs = performance.now();
  setScanPending(true);
  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
    el.innerHTML = `<div class="scan-loading"><div class="spinner"></div><span>Identifying…</span></div>`;
  }
  showScanLoading(
    payload.mode === "barcode" ? "Looking up barcode..." : payload.mode === "shelf" ? "Reading your shelf..." : "Identifying...",
    payload.mode === "barcode" ? "Checking the catalog and saved barcode data."
      : payload.mode === "shelf" ? "Finding every set in the photo — up to 30 seconds."
      : "This can take up to 30 seconds."
  );
  const frame = document.querySelector(".scan-frame");
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

  // On-device (Gemma) vision is best-effort: only attempt it when the user
  // prefers local, it's an image scan, and the device can actually run it
  // (WebGPU + model downloaded). The cloud path is the primary, more-accurate
  // route and the fallback whenever local can't run or can't identify.
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
        });
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
    const res = await cloudScanIdentify(payload, controller.signal);
    if (stale()) return;
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
  document.querySelector(".scan-video-wrap")?.classList.add("has-result");
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
  el.classList.remove("loading");
  document.querySelector(".scan-video-wrap")?.classList.add("has-result");
  if (!res.identified) {
    const reason = res.reasoning || "Couldn't identify the set. Try a clearer photo.";
    const noKey = !localStorage.getItem("bv_gemini_key") && !localStorage.getItem("bv_openai_key");
    const needsAccount = photoScanNeedsSetup();
    const failure = classifyScanFailure(reason);
    const rateLimited = failure.kind === "limit";
    const setupNeeded = failure.kind === "setup";
    const badgeLabel = setupNeeded ? "SETUP NEEDED" : rateLimited ? "LIMIT REACHED" : failure.kind === "timeout" ? "TIMED OUT" : "NO MATCH";
    const badgeIcon = setupNeeded ? I.gear() : rateLimited ? I.alert() : I.close();
    const headLabel = failure.label;
    // Rate-limited: say WHEN it resets instead of offering a retry that will
    // just fail again (free = daily UTC window, supporters = hourly bursts).
    const resetHint = rateLimited
      ? `<p style="font-size:11px;color:var(--ink-mute);margin:0 0 10px;">${/per hour/i.test(reason) ? "Your hourly window resets within the hour." : "The daily limit resets at midnight UTC."}</p>`
      : "";
    // BYOK nudge: keyless users share the server's free scan quota. A personal
    // Gemini key (free tier ~1500/day) makes photo scans effectively unlimited
    // and offloads the cost from the shared server quota — emphasized when the
    // miss looks quota-driven rather than a genuine no-match.
    const nudge = noKey && (setupNeeded || rateLimited) ? `
      <div class="chat-gemini-card" style="margin:0 0 10px;">
        <div style="font-weight:600; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          ${I.flash({ w: 16 })}<span>${rateLimited ? "Shared scan limit reached" : "Enable photo scanning"}</span>
        </div>
        <div style="font-size:11px; color:var(--ink-mute); line-height:1.45;">
          ${needsAccount
            ? "Sign in to use the shared service, or add a free personal key in <strong>Me &gt; Integrations</strong>."
            : "Your account is still signed in. Try again, or add a free personal key in <strong>Me &gt; Integrations</strong> for scans on your own quota."}
        </div>
      </div>` : "";
    const setupActions = needsAccount
      ? `<div class="btn-row"><button class="btn-primary" id="scanSignIn">Sign in</button><button class="btn-secondary" id="scanSetup">Add AI key</button></div>`
      : `<div class="btn-row"><button class="btn-primary" id="scanRetry">Try again</button><button class="btn-secondary" id="scanSetup">Add AI key</button></div>`;
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${badgeIcon}${badgeLabel}</span>
        ${headLabel.toUpperCase() === badgeLabel.toUpperCase() ? "" : `<span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${headLabel}</span>`}
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">${escapeHtml(reason)}</p>
      ${resetHint}
      ${nudge}
      ${setupNeeded ? setupActions
        : `<button class="btn-secondary" id="scanRetry">${rateLimited ? "Close" : "Try again"}</button>`}`;
    $("#scanRetry")?.addEventListener("click", () => clearScanResult({ restartBarcode: true }));
    $("#scanSignIn")?.addEventListener("click", () => { location.hash = "#/login"; });
    $("#scanSetup")?.addEventListener("click", () => { location.hash = "#/me/integrations"; });
    return;
  }
  const sets = res.sets || (res.set ? [res.set] : []);
  const minifigs = res.minifigs || [];
  if (!sets.length && !minifigs.length) {
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${I.close()}NO MATCH</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">Nothing found</span>
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">Matches weren't found in the local catalog.</p>
      <button class="btn-secondary" id="scanRetry">Try again</button>`;
    $("#scanRetry")?.addEventListener("click", () => {
      clearScanResult({ restartBarcode: true });
    });
    return;
  }
  const confidence = String(res.confidence || 'high').toLowerCase();
  const confidenceLabel = t({ high: 'scanner.confidenceHigh', medium: 'scanner.confidenceMedium', low: 'scanner.confidenceLow' }[confidence] || 'scanner.confidenceUnknown');
  const matchLabel = (value) => {
    const level = String(value || '').toLowerCase();
    return t({ high: 'scanner.matchHigh', medium: 'scanner.matchMedium', low: 'scanner.matchLow' }[level] || 'scanner.match');
  };
  const heading = scanResultHeading(sets.length, minifigs.length);
  const headingLabel = heading.key === 'setsFound'
    ? tPlural('scanner.setsFound', heading.count)
    : heading.key === 'minifigsFound'
      ? tPlural('scanner.minifigsFound', heading.count)
      : tPlural('scanner.mixedResultsFound', heading.count);
  let headHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()}${headingLabel}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(confidenceLabel)}</span>
    </div>`;
  let listHTML = "";
  if (sets.length) {
    listHTML += `<div style="display:flex;flex-direction:column;gap:10px;margin:8px 0 16px;max-height:40vh;overflow-y:auto;padding-right:4px;">`;
    sets.forEach((set, idx) => {
      const h = setHue(set);
      const hasImg = set.image_url && !set.image_url.startsWith("data:");
      // Show both new and used market value when they differ (real used data);
      // otherwise just the single value (formula sets have no separate used price).
      const newVal = Number(marketValueForCondition(set, 'new')) || 0;
      const usedVal = Number(marketValueForCondition(set, 'used_good')) || 0;
      const valLine = (usedVal > 0 && Math.abs(usedVal - newVal) > 0.5)
        ? `${fmtMoney(newVal)} <span style="color:var(--ink-mute);font-weight:500;">new</span> &nbsp;·&nbsp; ${fmtMoney(usedVal)} <span style="color:var(--ink-mute);font-weight:500;">used</span>`
        : fmtMoney(newVal);
      listHTML += `
        <div class="scan-result-row" style="align-items:center;background:var(--surface-2);padding:8px;border-radius:var(--r-2);border:1.5px solid var(--line-soft);margin-bottom:6px;">
          <input type="checkbox" class="scan-select-check" data-setnum="${escapeHtml(set.set_num)}" data-idx="${idx}" checked style="width:18px;height:18px;margin-right:10px;cursor:pointer;">
          <div class="si${hasImg ? " has-photo" : ""}" style="width:48px;height:48px;border-radius:var(--r-1);background:linear-gradient(135deg, var(--surface-2), var(--surface-3));flex-shrink:0;position:relative;">
            <div class="brick-tile" style="--h:${h};width:100%;height:100%;border-radius:var(--r-1);"></div>
            ${hasImg ? `<img src="${escapeHtml(set.image_url)}" alt="" style="position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;mix-blend-mode:multiply;">` : ""}
          </div>
          <div class="sx" style="margin-left:10px;flex:1;min-width:0;text-align:left;">
            <div class="sx-name" style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(set.name)}</div>
            <div class="sx-meta" style="font-size:10px;color:var(--ink-mute);">${escapeHtml(set.theme||"")} · #${escapeHtml(set.set_num)}${sets.length > 1 && set.match_confidence && set.match_confidence !== "high" ? ` · <span style="color:${set.match_confidence === "low" ? "var(--down)" : "var(--accent)"};font-weight:700;">${escapeHtml(matchLabel(set.match_confidence))}</span>` : ""}</div>
            <div class="sx-val" style="font-weight:600;font-size:12px;color:var(--up);">${valLine}</div>
          </div>
        </div>`;
    });
    listHTML += `</div>`;
  }
  if (minifigs.length) {
    listHTML += `<div style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;margin:2px 0 6px;">Minifigures</div>`;
    listHTML += `<div style="display:flex;flex-direction:column;gap:10px;margin:0 0 16px;max-height:40vh;overflow-y:auto;padding-right:4px;">`;
    minifigs.forEach((fig, idx) => {
      const hasImg = fig.image_url && !String(fig.image_url).startsWith("data:");
      const minifigLabel = t("scanner.minifig");
      const rarityKeys = {
        common: "minifigs.filterSummaryRarityCommon",
        uncommon: "minifigs.filterSummaryRarityUncommon",
        rare: "minifigs.filterSummaryRarityRare",
        legendary: "minifigs.filterSummaryRarityLegendary",
      };
      const minifigMetadata = fig.series
        ? t("scanner.minifigWithSeries", { minifig: minifigLabel, series: String(fig.series) })
        : fig.rarity
          ? t("scanner.minifigWithRarity", {
            minifig: minifigLabel,
            rarity: t(rarityKeys[String(fig.rarity).toLowerCase()] || "scanner.rarityUnknown"),
          })
          : minifigLabel;
      listHTML += `
        <div class="scan-result-row" style="align-items:center;background:var(--surface-2);padding:8px;border-radius:var(--r-2);border:1.5px solid var(--line-soft);margin-bottom:6px;">
          <input type="checkbox" class="scan-fig-check" data-fignum="${escapeHtml(fig.fig_num)}" data-idx="${idx}" checked style="width:18px;height:18px;margin-right:10px;cursor:pointer;">
          <div class="si${hasImg ? " has-photo" : ""}" style="width:48px;height:48px;border-radius:var(--r-1);background:linear-gradient(135deg, var(--surface-2), var(--surface-3));flex-shrink:0;position:relative;">
            ${hasImg ? `<img src="${escapeHtml(fig.image_url)}" alt="" style="position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;">` : ""}
          </div>
          <div class="sx" style="margin-left:10px;flex:1;min-width:0;text-align:left;">
            <div class="sx-name" style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fig.name)}</div>
            <div class="sx-meta" style="font-size:10px;color:var(--ink-mute);">${escapeHtml(minifigMetadata)}</div>
            ${fig.current_value != null ? `<div class="sx-val" style="font-weight:600;font-size:12px;color:var(--up);">${fmtMoney(fig.current_value)}</div>` : ""}
          </div>
        </div>`;
    });
    listHTML += `</div>`;
  }

  let dealHTML = "";
  if (sets.length === 1) {
    dealHTML = `
      <div style="margin: 0 0 12px 0;">
        ${dealScoreHTML(sets[0])}
        <div id="scanFlipCalcContainer">${flipCalcHTML(sets[0], null)}</div>
        ${amazonSlotHTML(sets[0].set_num, { compact: true })}
      </div>`;
  }

  // Condition toggle (sets only): adds the selected sets as New or Used, which
  // records the condition and values the holding at the matching market price.
  const condToggleHTML = sets.length ? `
    <div class="scan-cond-row" style="display:flex;align-items:center;gap:8px;margin-top:12px;">
      <span style="font-size:11px;color:var(--ink-mute);font-family:var(--mono);font-weight:600;letter-spacing:.06em;">CONDITION</span>
      <div class="scan-cond-seg" style="display:inline-flex;border:1.5px solid var(--line);border-radius:10px;overflow:hidden;">
        <button type="button" class="scan-cond-opt" data-cond="new" style="border:none;background:var(--accent);color:#fff;font-size:12px;font-weight:700;padding:6px 16px;cursor:pointer;">New</button>
        <button type="button" class="scan-cond-opt" data-cond="used_good" style="border:none;background:transparent;color:var(--ink);font-size:12px;font-weight:700;padding:6px 16px;cursor:pointer;">Used</button>
      </div>
    </div>` : "";
  let actionsHTML = condToggleHTML + `
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn-secondary" id="scanDetails" ${sets.length !== 1 ? 'disabled style="opacity:0.5;"' : ""}>Details</button>
      <button class="btn-primary" id="scanAdd">${I.plus()}<span>Add selected</span></button>
    </div>`;
  el.innerHTML = headHTML + listHTML + dealHTML + actionsHTML;
  hydrateAmazonSlots(el, state.me?.retail_market || 'FR');

  // Condition selection drives the stored condition + the value the set is added at.
  let scanCondition = 'new';
  $$(".scan-cond-opt").forEach(btn => btn.addEventListener("click", () => {
    scanCondition = btn.dataset.cond;
    haptic("light");
    $$(".scan-cond-opt").forEach(b => {
      const on = b.dataset.cond === scanCondition;
      b.style.background = on ? "var(--accent)" : "transparent";
      b.style.color = on ? "#fff" : "var(--ink)";
    });
  }));

  if (sets.length === 1) {
    const dpi = $("#dealPriceInput");
    if (dpi) {
      let debounceTid;
      dpi.addEventListener("input", (e) => {
        const val = e.target.value;
        clearTimeout(debounceTid);
        debounceTid = setTimeout(() => {
          updateDealBadge(sets[0], val);
          updateFlipCalc(sets[0], null, val);
        }, 150);
      });
    }
  }

  $("#scanDetails")?.addEventListener("click", () => {
    if (sets.length === 1) {
      closeScan();
      location.hash = "#/set/" + encodeURIComponent(sets[0].set_num);
    }
  });
  $("#scanAdd")?.addEventListener("click", async () => {
    haptic("heavy");
    const checkedBoxes = $$(".scan-select-check:checked");
    const checkedFigs = $$(".scan-fig-check:checked");
    if (!checkedBoxes.length && !checkedFigs.length) { toast("Nothing selected", "info"); return; }

    // Warn if any selected set is already in the collection.
    const ownedNums = new Set((state.portfolio?.items || []).map(i => i.set_num));
    const duplicates = Array.from(checkedBoxes)
      .map(b => ({ setnum: b.dataset.setnum, s: sets[parseInt(b.dataset.idx, 10)] }))
      .filter(({ setnum }) => ownedNums.has(setnum));
    if (duplicates.length) {
      const names = duplicates.map(d => d.s?.name || d.setnum).join(', ');
      const { confirmSheet } = await import('./sheet.js');
      const ok = await confirmSheet({
        title: t('scanner.duplicateConfirmTitle'),
        message: t('scanner.duplicateConfirmMessage', { names }),
        confirmLabel: t('scanner.duplicateConfirmAction'),
      });
      if (!ok) return;
    }

    setBtnLoading($("#scanAdd"), true);
    let addedCount = 0;
    let kidsXp = 0;
    let kidsBadge = null;
    let kidsLevel = null;
    for (const box of checkedBoxes) {
      const setnum = box.dataset.setnum;
      const targetSet = sets[parseInt(box.dataset.idx, 10)];
      const condValue = Number(marketValueForCondition(targetSet, scanCondition)) || Number(targetSet.current_value) || null;
      const body = { set_num: setnum, quantity: 1, condition: scanCondition, purchase_price: condValue };
      try {
        const result = await api("/api/collection", { method: "POST", body });
        addedCount++;
        if (result?.kids?.xp_gained > 0) {
          kidsXp += result.kids.xp_gained;
          if (result.kids.new_level) kidsLevel = result.kids.new_level;
          if (result.kids.new_badges?.[0] && !kidsBadge) kidsBadge = result.kids.new_badges[0];
        }
      } catch (e) {
        if (!navigator.onLine) {
          outboxEnqueue({ path: '/api/collection', method: 'POST', body });
          addedCount++;
        } else {
          toast(t('scanner.addItemFailed', { name: targetSet.name, error: e.message || e }), "error");
        }
      }
    }
    for (const box of checkedFigs) {
      const fignum = box.dataset.fignum;
      const targetFig = minifigs[parseInt(box.dataset.idx, 10)];
      const path = `/api/minifigs/${encodeURIComponent(fignum)}`;
      try {
        await api(path, { method: "PUT", body: { quantity: 1 } });
        addedCount++;
      } catch (e) {
        if (!navigator.onLine) {
          outboxEnqueue({ path, method: 'PUT', body: { quantity: 1 } });
          addedCount++;
        } else {
          toast(t('scanner.addItemFailed', { name: targetFig?.name || t('scanner.minifig'), error: e.message || e }), "error");
        }
      }
    }
    invalidatePortfolio(); state.catalog.items = [];
    closeScan();
    if (addedCount > 0) {
      toast(tPlural(navigator.onLine ? 'scanner.itemsAdded' : 'scanner.itemsSavedOffline', addedCount), "success");
    }
    // Kids mode: surface the XP reward and refresh state.me so the kids home
    // reflects the new XP/level/badge.
    if (kidsXp > 0) {
      const badge = kidsBadge ? kidsBadgeLabel(kidsBadge) : '';
      setTimeout(() => toast(kidsXpMessage(kidsXp, { level: kidsLevel, badge }), "success"), 500);
      state.me = null;
    }
    location.hash = "#/";
  });
}

function scanOverlayHTML(mode, shelf = false) {
  // On the native app, barcode / blind-box modes hand off to ML Kit's own
  // full-screen scanner — so render a clean loading state from the start (class
  // native-scan) instead of the web camera chrome (video + laser frame), which
  // otherwise flashes before ML Kit opens and again after a scan returns.
  const nativeBarcode = mode !== "image" && isNativeCapacitor();
  return `
    <div class="scan-video-wrap${nativeBarcode ? " native-scan" : ""}">
      <video class="scan-video" id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-top" style="justify-content: space-between;">
        <button id="scanCloseBtn" aria-label="Close">${I.close()}</button>
        <div class="scan-mode-toggle" role="group" aria-label="Scan mode" style="display: flex; align-items: center;">
          <button data-mode="barcode" aria-pressed="${mode === "barcode"}" class="${mode === "barcode" ? "active" : ""}">Barcode</button>
          <button data-mode="image" aria-pressed="${mode === "image"}" class="${mode === "image" ? "active" : ""}">Photo</button>
        </div>
        <div style="width:42px;"></div>
      </div>
      ${nativeBarcode ? `<div class="scan-native-loading"><span class="spinner"></span></div>` : `
      <div class="scan-frame ${mode !== "image" ? "barcode" : ""}">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
        ${mode !== "image" ? `<span class="laser"></span>` : ""}
      </div>`}
      ${mode === "image" && !nativeBarcode ? `
        <div class="scan-shelf-row scan-top-stack" role="group" aria-label="Photo scope" style="position:absolute;left:0;right:0;display:flex;justify-content:center;z-index:3;">
          <div style="display:inline-flex;border:1.5px solid #fff5;border-radius:999px;overflow:hidden;backdrop-filter:blur(6px);background:#0006;">
            <button type="button" class="scan-shelf-opt" data-shelf="0" aria-pressed="${shelf ? "false" : "true"}" style="border:none;background:${shelf ? "transparent" : "var(--accent)"};color:${shelf ? "#fff9" : "#fff"};font-size:12px;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap;">One set</button>
            <button type="button" class="scan-shelf-opt" data-shelf="1" aria-pressed="${shelf ? "true" : "false"}" style="border:none;background:${shelf ? "var(--accent)" : "transparent"};color:${shelf ? "#fff" : "#fff9"};font-size:12px;font-weight:700;padding:7px 14px;cursor:pointer;white-space:nowrap;">Whole shelf</button>
          </div>
        </div>` : ""}
      <div class="scan-hint" id="scanHint">${nativeBarcode ? "Opening scanner…" : mode === "blindbox" ? "Scan the blind bag or box barcode" : mode === "barcode" ? "Align barcode within the frame" : shelf ? "Fit the whole shelf in frame — good light helps" : "Frame the set and tap to identify"}</div>
      ${mode === "image" ? `
        <div class="scan-bottom">
          <button class="btn-secondary scan-gallery-btn" id="scanGalleryBtn">
            ${I.layers({w:16, h:16})} <span>Gallery</span>
          </button>
          <button class="scan-capture-btn" id="scanCapture" aria-label="Capture"></button>
          <input type="file" id="scanGalleryInput" accept="image/*" multiple style="display:none;">
          <span class="scan-bottom-spacer" aria-hidden="true"></span>
        </div>` : ""}
      <div class="scan-result" id="scanResult" role="status" aria-live="polite"></div>
    </div>`;
}

async function processBulkScanQueue(files) {
  const { controller, generation } = beginScanRequest();
  const stale = () => generation !== _scanGeneration || controller.signal.aborted;
  stopCamera();
  setScanPending(true);

  const el = $("#scanResult");
  if (el) {
    el.classList.add("show", "loading");
    document.querySelector(".scan-video-wrap")?.classList.add("has-result");
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
  document.querySelector(".scan-video-wrap")?.classList.add("has-result");
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

