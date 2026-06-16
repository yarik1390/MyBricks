import { $, $$, haptic, escapeHtml, fmtMoney, toast, setBtnLoading, readFileAsDataURL, resizeImage, setHue, getExchangeRate, CURRENCY_SYMBOLS, activateFocusTrap, FOCUSABLE_SEL } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, outboxEnqueue } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet, showSheet, hideSheet } from './sheet.js';
import { computeDealScore as computeDealScorePure, marketValueForCondition } from '../lib/pure.js';
import { checkGemma3Downloaded, runLocalVisionScan, isWebGpuAvailable } from '../lib/local-ai.js';

let _scanTrapRelease = null;

export function openScan(mode = "barcode") {
  state.camera.mode = mode;
  const ov = $("#scanOverlay");
  ov.innerHTML = scanOverlayHTML(mode);
  ov.classList.add("open");
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
      galleryInp.addEventListener("change", (e) => {
        const files = Array.from(e.target.files || []).slice(0, 10);
        if (files.length) {
          processBulkScanQueue(files);
        }
      });
    }
  }

  startCamera();
}

export function closeScan() {
  stopCamera();
  _scanTrapRelease?.();
  _scanTrapRelease = null;
  $("#scanOverlay").classList.remove("open");
  $("#scanOverlay").innerHTML = "";
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
  } catch (e) {
    const hint = $("#scanHint");
    if (hint) hint.textContent = "Camera not available — check permissions";
  }
}

// Fallback for browsers without the BarcodeDetector API (e.g. desktop
// Firefox): a manual digit-entry field wired to the same barcode lookup.
function showManualBarcodeEntry() {
  const hint = $("#scanHint");
  if (!hint || $("#manualBarcodeRow")) return;
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
  haptic("heavy");
  const btn = $("#scanCapture");
  if (btn) { btn.style.transform = "scale(0.85)"; setTimeout(() => btn.style.transform = "", 200); }
  const hint = $("#scanHint");
  if (hint) hint.textContent = "Identifying…";

  const vid = $("#scanVideo");
  if (!vid) return;
  const canvas = document.createElement("canvas");
  const maxSide = 1024;
  const w = vid.videoWidth || 640; const h = vid.videoHeight || 480;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  canvas.width = w * scale; canvas.height = h * scale;
  canvas.getContext("2d").drawImage(vid, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  sendScanToAPI({ mode: "image", image: dataUrl });
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
      } catch (e) {
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
  if (!geminiKey && !openaiKey && payload.mode === 'image') {
    let token = await getTurnstileToken();
    // One retry on a transient miss (occasional invisible-challenge timeout on
    // rapid successive scans); a genuine config/script failure won't recover, so
    // only retry the transient outcomes.
    if (!token && /timeout|empty|error/.test(_tsReason)) token = await getTurnstileToken();
    if (token) extraHeaders['cf-turnstile-token'] = token;
  }
  return api("/api/scan/identify", { method: "POST", body: payload, signal, headers: extraHeaders });
}

async function sendScanToAPI(payload) {
  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
    el.innerHTML = `<div class="scan-loading"><div class="spinner"></div><span>Identifying…</span></div>`;
  }
  const frame = document.querySelector(".scan-frame");
  if (frame) frame.classList.add("scan-pending");
  const done = () => { if (frame) frame.classList.remove("scan-pending"); };

  const scanEngine = localStorage.getItem('bv_ai_engine') || 'cloud';
  const online = navigator.onLine;

  // On-device (Gemma) vision is best-effort: only attempt it when the user
  // prefers local, it's an image scan, and the device can actually run it
  // (WebGPU + model downloaded). The cloud path is the primary, more-accurate
  // route and the fallback whenever local can't run or can't identify.
  if (payload.mode === 'image' && scanEngine === 'local') {
    const hasGpu = isWebGpuAvailable();
    const ready = hasGpu && await checkGemma3Downloaded();
    if (ready) {
      try {
        const bitmap = await imageBitmapFromDataUrl(payload.image);
        const localResult = await runLocalVisionScan(bitmap, (statusText) => {
          const hint = $("#scanHint");
          if (hint) hint.textContent = statusText;
        });
        if (localResult.identified) {
          const setNum = localResult.set_num;
          const setResponse = await api(`/api/sets/${encodeURIComponent(setNum)}`).catch(() => null);
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
        if (!online) {
          showScanResult({ identified: false, reasoning: `On-device AI failed and you're offline: ${err.message}` });
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
  if (payload.mode === 'image' && !online) {
    showScanResult({ identified: false, reasoning: "You're offline. Reconnect to identify by photo, or set up on-device AI in Settings." });
    done();
    return;
  }
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 30_000);
  try {
    const res = await cloudScanIdentify(payload, ac.signal);
    showScanResult(res);
  } catch (e) {
    const msg = ac.signal.aborted ? "Took too long — try again." : e.message;
    const hint = $("#scanHint");
    if (hint) hint.textContent = ac.signal.aborted ? "Timed out" : "Error: " + e.message;
    showScanResult({ identified: false, reasoning: msg });
  } finally {
    clearTimeout(tid);
    done();
  }
}

// Route a scanned/typed barcode to the right handler for the active mode.
function routeScannedCode(code) {
  if (state.camera.mode === "blindbox") return sendBlindBoxLookup(code);
  return sendScanToAPI({ mode: "barcode", barcode: code });
}

// Blind-box: resolve a Collectible Minifigures bag/box barcode to its series
// roster, then let the user tap the fig they pulled (adds to their minifigs).
async function sendBlindBoxLookup(code) {
  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
    el.innerHTML = `<div class="scan-loading"><div class="spinner"></div><span>Finding the series…</span></div>`;
  }
  try {
    const res = await api(`/api/minifigs/blindbox?code=${encodeURIComponent(code)}`);
    showBlindBoxResult(res);
  } catch (e) {
    showBlindBoxResult({ error: e.message || "Couldn't look that up." });
  }
}

function showBlindBoxResult(res) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");
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
      <span style="font-size:11px;color:var(--ink-mute);">${res.figs.length} figs</span>
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
    } catch (e) {
      if (willOwn) state.ownedFigs.delete(fignum); else state.ownedFigs.add(fignum);
      try { localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs])); } catch {}
      btn.style.borderColor = !willOwn ? "var(--up)" : "var(--line-soft)";
      if (chk) chk.style.display = !willOwn ? "block" : "none";
      toast("Couldn't save — try again", "error");
    }
  }));
}

function showScanResult(res) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");
  if (!res.identified) {
    const reason = res.reasoning || "Couldn't identify the set. Try a clearer photo.";
    const noKey = !localStorage.getItem("bv_gemini_key") && !localStorage.getItem("bv_openai_key");
    const rateLimited = /rate.?limit|unlimited|api key|quota|limit reached|too many|429/i.test(reason);
    const headLabel = rateLimited ? "Limit reached" : "Not found";
    // BYOK nudge: keyless users share the server's free scan quota. A personal
    // Gemini key (free tier ~1500/day) makes photo scans effectively unlimited
    // and offloads the cost from the shared server quota — emphasized when the
    // miss looks quota-driven rather than a genuine no-match.
    const nudge = noKey ? `
      <div class="chat-gemini-card" style="margin:0 0 10px;">
        <div style="font-weight:600; font-size:13px; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          ${I.flash({ w: 16 })}<span>${rateLimited ? "Hit the free scan limit?" : "Scan unlimited — free"}</span>
        </div>
        <div style="font-size:11px; color:var(--ink-mute); line-height:1.45;">
          Get a free key in 30 seconds at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--bv-red); font-weight:600; text-decoration:underline;">Google AI Studio</a> and save it in the <strong>Me</strong> tab for unlimited scans.
        </div>
      </div>` : "";
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${I.close()}NO MATCH</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${headLabel}</span>
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">${escapeHtml(reason)}</p>
      ${nudge}
      <button class="btn-secondary" id="scanRetry">Try again</button>`;
    $("#scanRetry")?.addEventListener("click", () => {
      el.classList.remove("show");
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify";
      if (state.camera.mode === "barcode" && state.camera.detector) {
        state.camera.scanning = true;
        clearInterval(state.camera.timer);
        state.camera.timer = setInterval(scanBarcode, 400);
      }
    });
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
      el.classList.remove("show");
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify";
      if (state.camera.mode === "barcode" && state.camera.detector) {
        state.camera.scanning = true;
        clearInterval(state.camera.timer);
        state.camera.timer = setInterval(scanBarcode, 400);
      }
    });
    return;
  }
  let headHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()}MATCH</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(res.confidence || "high")} confidence</span>
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
            <div class="sx-meta" style="font-size:10px;color:var(--ink-mute);">${escapeHtml(set.theme||"")} · #${escapeHtml(set.set_num)}</div>
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
      listHTML += `
        <div class="scan-result-row" style="align-items:center;background:var(--surface-2);padding:8px;border-radius:var(--r-2);border:1.5px solid var(--line-soft);margin-bottom:6px;">
          <input type="checkbox" class="scan-fig-check" data-fignum="${escapeHtml(fig.fig_num)}" data-idx="${idx}" checked style="width:18px;height:18px;margin-right:10px;cursor:pointer;">
          <div class="si${hasImg ? " has-photo" : ""}" style="width:48px;height:48px;border-radius:var(--r-1);background:linear-gradient(135deg, var(--surface-2), var(--surface-3));flex-shrink:0;position:relative;">
            ${hasImg ? `<img src="${escapeHtml(fig.image_url)}" alt="" style="position:absolute;inset:2px;width:calc(100% - 4px);height:calc(100% - 4px);object-fit:contain;">` : ""}
          </div>
          <div class="sx" style="margin-left:10px;flex:1;min-width:0;text-align:left;">
            <div class="sx-name" style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(fig.name)}</div>
            <div class="sx-meta" style="font-size:10px;color:var(--ink-mute);">minifig${fig.series ? " · " + escapeHtml(fig.series) : fig.rarity ? " · " + escapeHtml(fig.rarity) : ""}</div>
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
    setBtnLoading($("#scanAdd"), true);
    let addedCount = 0;
    for (const box of checkedBoxes) {
      const setnum = box.dataset.setnum;
      const targetSet = sets[parseInt(box.dataset.idx, 10)];
      const condValue = Number(marketValueForCondition(targetSet, scanCondition)) || Number(targetSet.current_value) || null;
      const body = { set_num: setnum, quantity: 1, condition: scanCondition, purchase_price: condValue };
      try {
        await api("/api/collection", { method: "POST", body });
        addedCount++;
      } catch (e) {
        if (!navigator.onLine) {
          outboxEnqueue({ path: '/api/collection', method: 'POST', body });
          addedCount++;
        } else {
          toast(`Failed to add ${targetSet.name}: ${e.message}`, "error");
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
          toast(`Failed to add ${targetFig?.name || "minifig"}: ${e.message}`, "error");
        }
      }
    }
    invalidatePortfolio(); state.catalog.items = [];
    closeScan();
    if (addedCount > 0) {
      toast(navigator.onLine ? `Added ${addedCount} item${addedCount === 1 ? "" : "s"} to vault` : `Saved ${addedCount} offline — will sync`, "success");
    }
    location.hash = "#/";
  });
}

function scanOverlayHTML(mode) {
  return `
    <div class="scan-video-wrap">
      <video class="scan-video" id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-top" style="justify-content: space-between;">
        <button id="scanCloseBtn" aria-label="Close">${I.close()}</button>
        <div class="scan-mode-toggle" style="display: flex; align-items: center;">
          <button data-mode="barcode" class="${mode === "barcode" ? "active" : ""}">Barcode</button>
          <button data-mode="image" class="${mode === "image" ? "active" : ""}">Photo</button>
        </div>
        <div style="width:42px;"></div>
      </div>
      <div class="scan-frame ${mode !== "image" ? "barcode" : ""}">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
        ${mode !== "image" ? `<span class="laser"></span>` : ""}
      </div>
      <div class="scan-hint" id="scanHint">${mode === "blindbox" ? "Scan the blind bag or box barcode" : mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify"}</div>
      ${mode === "image" ? `
        <div class="scan-bottom">
          <button class="btn-secondary scan-gallery-btn" id="scanGalleryBtn">
            ${I.layers({w:16, h:16})} <span>Gallery</span>
          </button>
          <button class="scan-capture-btn" id="scanCapture" aria-label="Capture"></button>
          <input type="file" id="scanGalleryInput" accept="image/*" multiple style="display:none;">
          <span class="scan-bottom-spacer" aria-hidden="true"></span>
        </div>` : ""}
      <div class="scan-result" id="scanResult"></div>
    </div>`;
}

async function processBulkScanQueue(files) {
  stopCamera();

  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
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
    if (progressText) progressText.textContent = `Identifying ${i + 1} of ${files.length}...`;
    if (progressBar) progressBar.style.width = `${((i) / files.length) * 100}%`;

    let dataUrl = "";
    try {
      // Guard: a very large file is read fully into memory before resize and can
      // crash the tab. Reject up front; the catch below records it as a skip.
      if (file && file.size > 20 * 1024 * 1024) throw new Error("Image too large (max 20 MB) — skipped");
      dataUrl = await readFileAsDataURL(file);
      const resized = await resizeImage(dataUrl, 1024);

      const geminiKey = localStorage.getItem('bv_gemini_key');
      const openaiKey = localStorage.getItem('bv_openai_key');
      const extraHeaders = {};
      if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
      if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;

      let apiRes;
      const scanEngine = localStorage.getItem('bv_ai_engine') || 'cloud';
      const localReady = scanEngine === 'local' && isWebGpuAvailable() && await checkGemma3Downloaded();
      const cloudScan = () => api("/api/scan/identify", { method: "POST", body: { mode: "image", image: resized }, headers: extraHeaders });
      if (localReady) {
        try {
          const bitmap = await imageBitmapFromDataUrl(resized);
          const localResult = await runLocalVisionScan(bitmap);
          if (localResult.identified) {
            const setNum = localResult.set_num;
            const setResponse = await api(`/api/sets/${encodeURIComponent(setNum)}`).catch(() => null);
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
    showBulkScanResults(results);
  }, 300);
}

function showBulkScanResults(results) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");

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
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${results.filter(r => r.success).length} of ${results.length} matched</span>
    </div>
    ${rowsHTML}
    ${actionsHTML}
  `;

  document.getElementById("bulkCancel").addEventListener("click", () => {
    el.classList.remove("show");
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

      await Promise.all([...addPromises, ...qtyPromises]);
      invalidatePortfolio();
      toast("Collection updated successfully", "success");
      closeScan();
      // Wait, renderPortfolio can be imported or we navigate
      location.hash = "#/";
    } catch (err) {
      toast("Failed to add sets: " + err.message, "error");
      setBtnLoading($("#bulkAddBtn"), false);
    }
  });
}

function dealScoreHTML(set) {
  return `
    <div class="deal-score-wrap" id="dealScoreWrap">
      <div class="deal-score-lbl">In-store price check</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" class="deal-price-input" id="dealPriceInput" placeholder="Enter store price…" min="0" step="0.01">
        <div class="deal-badge" id="dealBadge"></div>
      </div>
    </div>`;
}

function updateDealBadge(set, priceStr) {
  const badge = document.getElementById("dealBadge");
  if (!badge) return;
  const price = parseFloat(priceStr);
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

  const estPrice = market * rate;
  const ebayFee = estPrice * (feePct / 100);
  const paypalFee = estPrice * (paymentPct / 100) + (0.30 * rate);
  const totalFees = ebayFee + paypalFee + shipping + tax;
  const net = Math.max(0, estPrice - totalFees);
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
        <span style="color:var(--ink-mute);">Marketplace Fee (${feePct}%)</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${ebayFee.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Payment Fee (${paymentPct}% + fixed)</span>
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

export function flipCalcHTML(set, entry) {
  const condition = entry?.condition || 'new';
  const market = parseFloat(marketValueForCondition(set, condition) || 0);
  if (market <= 0) return '';
  
  let estPrice = market;
  if (condition.startsWith('used') && !set.ebay_used_value) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }
  
  const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const ebayFee = estPrice * (feePct / 100);
  const paypalFee = estPrice * (paymentPct / 100) + 0.30;
  const gross = estPrice;
  const totalFees = ebayFee + paypalFee + shipping;
  const net = Math.max(0, gross - totalFees);

  const purchasePrice = parseFloat(entry?.purchase_price || 0);
  let roiHTML = '';
  if (purchasePrice > 0) {
    const netRoi = ((net - purchasePrice) / purchasePrice) * 100;
    const roiColor = netRoi >= 0 ? 'var(--up)' : 'var(--bv-red)';
    roiHTML = `<div style="font-size:11px;margin-top:4px;">Net ROI: <strong style="color:${roiColor};">${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(1)}%</strong></div>`;
  }
  
  return `
    <div class="flip-calc-wrap" style="margin-top:12px;padding:12px;background:var(--surface-3);border:1.5px solid var(--line-soft);border-radius:var(--r-2);">
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px;">Flip Calculator ${I.money({w:12,h:12})}</div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;text-align:center;font-size:12px;">
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Gross</div>
          <strong style="font-size:13px;">${fmtMoney(gross)}</strong>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Fees & Ship</div>
          <span style="color:var(--bv-red);font-weight:600;">-${fmtMoney(totalFees)}</span>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Est. Net</div>
          <strong style="color:var(--up);font-size:13px;">${fmtMoney(net)}</strong>
        </div>
      </div>
      <div class="flip-result" style="text-align:left;">${roiHTML}</div>
    </div>`;
}

export function updateFlipCalc(set, entry, storePrice) {
  const container = document.querySelector(".flip-calc-wrap");
  if (!container) return;
  const price = parseFloat(storePrice) || 0;
  const condition = entry?.condition || 'new';
  const market = parseFloat(marketValueForCondition(set, condition) || 0);
  if (market <= 0) return;

  let estPrice = market;
  if (condition.startsWith('used') && !set.ebay_used_value) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }
  const feePct2 = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct2 = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping2 = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const ebayFee = estPrice * (feePct2 / 100);
  const paypalFee = estPrice * (paymentPct2 / 100) + 0.30;
  const gross = estPrice;
  const totalFees = ebayFee + paypalFee + shipping2;
  const net = Math.max(0, gross - totalFees);

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

