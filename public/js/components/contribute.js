// Contribution submission sheets (review / photo / data-fix). Each opens a
// bottom sheet, submits via the api() helper, toasts the result, and calls the
// provided onDone() so the caller (the set-detail Community tab) can refresh.
import { $, escapeHtml, toast, haptic } from '../utils.js';
import { I } from '../icons.js';
import { api, _authSession } from '../api.js';
import { showSheet, hideSheet } from './sheet.js';

// ── Write a review ────────────────────────────────────────────────
export function openReviewSheet(setNum, onDone) {
  showSheet(`
    <h2 class="u-serif-h" style="margin:0 4px 12px;">Write a review</h2>
    <div id="starPick" style="display:flex;gap:6px;justify-content:center;margin:0 0 14px;font-size:30px;cursor:pointer;">
      ${[1,2,3,4,5].map(n => `<span data-star="${n}" style="opacity:.3;">★</span>`).join("")}
    </div>
    <input class="field-input" id="rvTitle" placeholder="Title (optional)" maxlength="120" autocomplete="off">
    <textarea class="field-input" id="rvBody" placeholder="Your thoughts on this set (optional)" rows="4" maxlength="4000" style="margin-top:10px;resize:vertical;"></textarea>
    <button class="btn-primary" id="rvSave" style="margin-top:14px;">Submit for review</button>
    <button class="btn-secondary" id="rvCancel" style="margin-top:8px;">Cancel</button>
    <p class="u-mute" style="font-size:11px;text-align:center;margin-top:10px;">Reviews appear once approved by a moderator.</p>`);

  let rating = 0;
  const paint = () => $("#starPick").querySelectorAll("span").forEach(s => {
    s.style.opacity = Number(s.dataset.star) <= rating ? "1" : ".3";
  });
  $("#starPick").addEventListener("click", (e) => {
    const s = e.target.closest("[data-star]"); if (!s) return;
    rating = Number(s.dataset.star); haptic("light"); paint();
  });
  $("#rvCancel").addEventListener("click", hideSheet);
  $("#rvSave").addEventListener("click", async () => {
    if (!rating) { toast("Pick a star rating first", "error"); return; }
    const btn = $("#rvSave"); btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await api("/api/contributions/reviews", { method: "POST", body: {
        set_num: setNum, rating, title: $("#rvTitle").value.trim(), body: $("#rvBody").value.trim(),
      }});
      hideSheet(); toast("Review submitted for approval", "success"); onDone?.();
    } catch (e) {
      btn.disabled = false; btn.textContent = "Submit for review";
      toast(e.message || "Could not submit", "error");
    }
  });
}

// ── Add a photo ───────────────────────────────────────────────────
export function openPhotoSheet(setNum, onDone) {
  showSheet(`
    <h2 class="u-serif-h" style="margin:0 4px 12px;">Add a photo</h2>
    <!-- A bare <input type="file"> paints the BROWSER's own "Choose file /
         No file chosen", which follows the browser locale rather than the app's
         and cannot be styled or translated at all. Every other file picker in
         the app already uses this label-wraps-hidden-input pattern; this sheet
         was the one that did not. -->
    <span class="csv-file-picker"><button type="button" class="csv-file-label" data-file-picker data-file-input="phFile">${I.upload()}<span>Choose a photo</span></button>
      <input type="file" id="phFile" accept="image/jpeg,image/png,image/webp" tabindex="-1" aria-hidden="true"></span>
    <div id="phFileName" class="u-mute" style="font-size:11px;font-family:var(--mono);margin-top:6px;"></div>
    <input class="field-input" id="phCaption" placeholder="Caption (optional)" maxlength="200" style="margin-top:10px;" autocomplete="off">
    <button class="btn-primary" id="phSave" style="margin-top:14px;">Upload for review</button>
    <button class="btn-secondary" id="phCancel" style="margin-top:8px;">Cancel</button>
    <p class="u-mute" style="font-size:11px;text-align:center;margin-top:10px;">JPEG/PNG/WebP, max 4 MB. Photos appear once approved.</p>`);
  $("#phCancel").addEventListener("click", hideSheet);
  // The native picker showed the chosen filename; the styled label has to say
  // so itself or there is no feedback that a file was picked at all.
  $("#phFile").addEventListener("change", (e) => {
    $("#phFileName").textContent = e.target.files?.[0]?.name || "";
  });
  $("#phSave").addEventListener("click", async () => {
    const file = $("#phFile").files?.[0];
    if (!file) { toast("Choose a photo first", "error"); return; }
    if (file.size > 4_000_000) { toast("Image too large (max 4 MB)", "error"); return; }
    const btn = $("#phSave"); btn.disabled = true; btn.textContent = "Uploading…";
    try {
      // FormData uploads bypass the api() helper (which JSON-stringifies bodies);
      // post raw with the bearer token like the collection-photo uploader.
      const fd = new FormData();
      fd.append("photo", file);
      fd.append("caption", $("#phCaption").value.trim());
      const token = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + `/api/contributions/photos/${encodeURIComponent(setNum)}`, {
        method: "POST",
        headers: token ? { Authorization: "Bearer " + token } : {},
        body: fd,
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || res.statusText); }
      hideSheet(); toast("Photo submitted for approval", "success"); onDone?.();
    } catch (e) {
      btn.disabled = false; btn.textContent = "Upload for review";
      toast(e.message || "Could not upload", "error");
    }
  });
}

// ── Suggest a data fix ────────────────────────────────────────────
const FIX_FIELDS = {
  barcode: `<input class="field-input" id="fxUpc" placeholder="Barcode / UPC (8–14 digits)" inputmode="numeric" maxlength="14" autocomplete="off">`,
  price: `<input class="field-input" id="fxPrice" placeholder="Recent sale price (USD)" inputmode="decimal" autocomplete="off">
    <select class="field-input" id="fxCond" style="margin-top:10px;"><option value="new">New / sealed</option><option value="used">Used</option></select>`,
  image: `<p class="u-mute" style="font-size:13px;margin:0 0 4px;">Tell us what's wrong with the current image.</p>`,
  partlist: `<p class="u-mute" style="font-size:13px;margin:0 0 4px;">Describe the part-list error (missing/extra/wrong part).</p>`,
  metadata: `<p class="u-mute" style="font-size:13px;margin:0 0 4px;">Describe the metadata to fix (name, year, theme, piece count…).</p>`,
};

export function openDataFixSheet(setNum, onDone) {
  const kindOpts = [
    ["barcode", "Missing barcode"],
    ["price", "Recent sale price"],
    ["image", "Wrong image"],
    ["partlist", "Part-list error"],
    ["metadata", "Other metadata"],
  ];
  const renderFields = (kind) => {
    const el = $("#fxFields"); if (el) el.innerHTML = FIX_FIELDS[kind] || "";
  };
  showSheet(`
    <h2 class="u-serif-h" style="margin:0 4px 12px;">Suggest a fix</h2>
    <label class="field-lbl" for="fxKind">What needs fixing?</label>
    <select class="field-input" id="fxKind">
      ${kindOpts.map(([v,l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join("")}
    </select>
    <div id="fxFields" style="margin-top:10px;"></div>
    <textarea class="field-input" id="fxNote" placeholder="Notes / source (optional)" rows="3" maxlength="1000" style="margin-top:10px;resize:vertical;"></textarea>
    <button class="btn-primary" id="fxSave" style="margin-top:14px;">Submit for review</button>
    <button class="btn-secondary" id="fxCancel" style="margin-top:8px;">Cancel</button>`);
  renderFields("barcode");
  $("#fxKind").addEventListener("change", (e) => renderFields(e.target.value));
  $("#fxCancel").addEventListener("click", hideSheet);
  $("#fxSave").addEventListener("click", async () => {
    const kind = $("#fxKind").value;
    const payload = {};
    if (kind === "barcode") {
      payload.upc = ($("#fxUpc")?.value || "").replace(/\s+/g, "");
      if (!/^\d{8,14}$/.test(payload.upc)) { toast("Barcode must be 8–14 digits", "error"); return; }
    } else if (kind === "price") {
      payload.price = Number($("#fxPrice")?.value);
      payload.condition = $("#fxCond")?.value || "new";
      if (!(payload.price > 0)) { toast("Enter a valid price", "error"); return; }
    }
    const note = $("#fxNote").value.trim();
    if (["image","partlist","metadata"].includes(kind) && !note) { toast("Please describe the issue", "error"); return; }
    const btn = $("#fxSave"); btn.disabled = true; btn.textContent = "Submitting…";
    try {
      await api("/api/contributions/data", { method: "POST", body: { set_num: setNum, kind, payload, note } });
      hideSheet(); toast("Fix submitted for approval", "success"); onDone?.();
    } catch (e) {
      btn.disabled = false; btn.textContent = "Submit for review";
      toast(e.message || "Could not submit", "error");
    }
  });
}
