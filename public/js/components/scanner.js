import { $, $$, haptic, escapeHtml, fmtMoney, toast, setBtnLoading, readFileAsDataURL, resizeImage, setHue, fmtPct, getExchangeRate, CURRENCY_SYMBOLS } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, outboxEnqueue } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet, showSheet, hideSheet } from './sheet.js';

export function openScan(mode = "barcode") {
  state.camera.mode = mode;
  const ov = $("#scanOverlay");
  ov.innerHTML = scanOverlayHTML(mode);
  ov.classList.add("open");
  $("#scanCloseBtn").addEventListener("click", closeScan);
  
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

    if (state.camera.mode === "barcode" && "BarcodeDetector" in window) {
      state.camera.detector = new BarcodeDetector({ formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39"] });
      state.camera.scanning = true;
      state.camera.timer = setInterval(scanBarcode, 400);
    } else if (state.camera.mode === "barcode") {
      const hint = $("#scanHint");
      if (hint) hint.textContent = "Barcode scanning isn't supported on this browser — switch to photo mode";
    }
  } catch (e) {
    const hint = $("#scanHint");
    if (hint) hint.textContent = "Camera not available — check permissions";
  }
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
      if (hint) hint.textContent = "Looking up barcode…";
      sendScanToAPI({ mode: "barcode", barcode });
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

async function sendScanToAPI(payload) {
  const el = $("#scanResult");
  if (el) {
    el.classList.add("show");
    el.innerHTML = `<div class="scan-loading"><div class="spinner"></div><span>Identifying…</span></div>`;
  }
  const frame = document.querySelector(".scan-frame");
  if (frame) frame.classList.add("scan-pending");
  const ac = new AbortController();
  const tid = setTimeout(() => ac.abort(), 30_000);
  try {
    const geminiKey = localStorage.getItem('bv_gemini_key');
    const openaiKey = localStorage.getItem('bv_openai_key');
    const extraHeaders = {};
    if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
    if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;
    const res = await api("/api/scan/identify", { method: "POST", body: payload, signal: ac.signal, headers: extraHeaders });
    showScanResult(res);
  } catch (e) {
    const msg = ac.signal.aborted ? "Took too long — try again." : e.message;
    const hint = $("#scanHint");
    if (hint) hint.textContent = ac.signal.aborted ? "Timed out" : "Error: " + e.message;
    showScanResult({ identified: false, reasoning: msg });
  } finally {
    clearTimeout(tid);
    if (frame) frame.classList.remove("scan-pending");
  }
}

function showScanResult(res) {
  const el = $("#scanResult");
  if (!el) return;
  el.classList.add("show");
  if (!res.identified) {
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${I.close()}NO MATCH</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">Not found</span>
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">${escapeHtml(res.reasoning || "Couldn't identify the set. Try a clearer photo.")}</p>
      <button class="btn-secondary" id="scanRetry">Try again</button>`;
    $("#scanRetry")?.addEventListener("click", () => {
      el.classList.remove("show");
      state.camera.scanning = true;
      state.camera.timer = setInterval(scanBarcode, 400);
      const hint = $("#scanHint");
      if (hint) hint.textContent = state.camera.mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify";
    });
    return;
  }
  const sets = res.sets || (res.set ? [res.set] : []);
  if (!sets.length) {
    el.innerHTML = `
      <div class="scan-result-head">
        <span class="badge miss">${I.close()}NO MATCH</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">No sets found</span>
      </div>
      <p style="font-size:13px;color:var(--ink-mute);margin:0 0 10px;">Matched sets were not found in local catalog.</p>
      <button class="btn-secondary" id="scanRetry">Try again</button>`;
    return;
  }
  let headHTML = `
    <div class="scan-result-head">
      <span class="badge">${I.check()}MATCH</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;">${escapeHtml(res.confidence || "high")} confidence</span>
    </div>`;
  let listHTML = `<div style="display:flex;flex-direction:column;gap:10px;margin:8px 0 16px;max-height:40vh;overflow-y:auto;padding-right:4px;">`;
  sets.forEach((set, idx) => {
    const h = setHue(set);
    const hasImg = set.image_url && !set.image_url.startsWith("data:");
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
          <div class="sx-val" style="font-weight:600;font-size:12px;color:var(--up);">${fmtMoney(set.current_value)}</div>
        </div>
      </div>`;
  });
  listHTML += `</div>`;

  let dealHTML = "";
  if (sets.length === 1) {
    dealHTML = `
      <div style="margin: 0 0 12px 0;">
        ${dealScoreHTML(sets[0])}
        <div id="scanFlipCalcContainer">${flipCalcHTML(sets[0], null)}</div>
      </div>`;
  }

  let actionsHTML = `
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn-secondary" id="scanDetails" ${sets.length > 1 ? 'disabled style="opacity:0.5;"' : ""}>Details</button>
      <button class="btn-primary" id="scanAdd">${I.plus()}<span>Add selected</span></button>
    </div>`;
  el.innerHTML = headHTML + listHTML + dealHTML + actionsHTML;

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
    if (!checkedBoxes.length) { toast("No sets selected", "info"); return; }
    setBtnLoading($("#scanAdd"), true);
    let addedCount = 0;
    for (const box of checkedBoxes) {
      const setnum = box.dataset.setnum;
      const targetSet = sets[parseInt(box.dataset.idx, 10)];
      try {
        await api("/api/collection", { method: "POST", body: { set_num: setnum, quantity: 1, purchase_price: targetSet.current_value } });
        addedCount++;
      } catch (e) {
        if (!navigator.onLine) {
          outboxEnqueue({ path: '/api/collection', method: 'POST', body: { set_num: setnum, quantity: 1, purchase_price: targetSet.current_value } });
          addedCount++;
        } else {
          toast(`Failed to add ${targetSet.name}: ${e.message}`, "error");
        }
      }
    }
    invalidatePortfolio(); state.catalog.items = [];
    closeScan();
    if (addedCount > 0) {
      toast(navigator.onLine ? `Added ${addedCount} sets to vault` : `Saved ${addedCount} offline — will sync`, "success");
    }
    location.hash = "#/";
  });
}

function scanOverlayHTML(mode) {
  return `
    <div class="scan-video-wrap">
      <video class="scan-video" id="scanVideo" autoplay playsinline muted></video>
      <div class="scan-top">
        <button id="scanCloseBtn" aria-label="Close">${I.close()}</button>
        <div class="scan-mode-toggle">
          <button data-mode="barcode" class="${mode === "barcode" ? "active" : ""}">Barcode</button>
          <button data-mode="image" class="${mode === "image" ? "active" : ""}">Photo</button>
        </div>
        <div style="width:42px;"></div>
      </div>
      <div class="scan-frame ${mode === "barcode" ? "barcode" : ""}">
        <span class="corner tl"></span><span class="corner tr"></span>
        <span class="corner bl"></span><span class="corner br"></span>
        ${mode === "barcode" ? `<span class="laser"></span>` : ""}
      </div>
      <div class="scan-hint" id="scanHint">${mode === "barcode" ? "Align barcode within the frame" : "Frame the set and tap to identify"}</div>
      ${mode === "image" ? `
        <div class="scan-bottom" style="display:flex;align-items:center;justify-content:space-between;padding:0 24px;width:100%;">
          <button class="btn-secondary" id="scanGalleryBtn" style="font-size:12px;padding:8px 12px;width:auto;margin:0;display:flex;align-items:center;gap:6px;">
            ${I.layers({w:16, h:16})} <span>Gallery</span>
          </button>
          <button class="scan-capture-btn" id="scanCapture" aria-label="Capture"></button>
          <input type="file" id="scanGalleryInput" accept="image/*" multiple style="display:none;">
          <div style="width:78px;"></div>
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
      dataUrl = await readFileAsDataURL(file);
      const resized = await resizeImage(dataUrl, 1024);

      const geminiKey = localStorage.getItem('bv_gemini_key');
      const openaiKey = localStorage.getItem('bv_openai_key');
      const extraHeaders = {};
      if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
      if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;

      const apiRes = await api("/api/scan/identify", {
        method: "POST",
        body: { mode: "image", image: resized },
        headers: extraHeaders
      });

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

function computeDealScore(set, storePrice) {
  const market = set.ebay_value || set.current_value;
  if (!market || !storePrice || storePrice <= 0) return null;
  const pct = (market - storePrice) / market;
  const greatThreshold = set.retired ? 0.05 : 0.15;
  let verdict, label;
  if (pct >= greatThreshold) {
    verdict = "great";
    label = `${fmtPct(pct)} below market — great deal!`;
  } else if (pct <= -0.05) {
    verdict = "over";
    label = `${fmtPct(Math.abs(pct))} above market — overpriced`;
  } else {
    verdict = "fair";
    label = `Within ${fmtPct(Math.abs(pct))} of market price`;
  }
  return { verdict, pct, label };
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
  const score = computeDealScore(set, price);
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
  const market = parseFloat(set.ebay_value || set.current_value || 0);
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
  const market = parseFloat(set.ebay_value || set.current_value || 0);
  if (market <= 0) return '';
  
  let estPrice = market;
  if (condition.startsWith('used')) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }
  
  const ebayFee = estPrice * 0.1325;
  const paypalFee = estPrice * 0.029 + 0.30;
  const shipping = 5.00;
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
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">Flip Calculator 💸</div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;text-align:center;font-size:12px;">
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Gross</div>
          <strong style="font-size:13px;">$${gross.toFixed(2)}</strong>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Fees & Ship</div>
          <span style="color:var(--bv-red);font-weight:600;">-$${totalFees.toFixed(2)}</span>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Est. Net</div>
          <strong style="color:var(--up);font-size:13px;">$${net.toFixed(2)}</strong>
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
  const market = parseFloat(set.ebay_value || set.current_value || 0);
  if (market <= 0) return;

  let estPrice = market;
  if (condition.startsWith('used')) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }
  const ebayFee = estPrice * 0.1325;
  const paypalFee = estPrice * 0.029 + 0.30;
  const shipping = 5.00;
  const gross = estPrice;
  const totalFees = ebayFee + paypalFee + shipping;
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

