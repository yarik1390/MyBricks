import { $, haptic, toast, setBtnLoading } from '../utils.js';
import { invalidatePortfolio } from '../state.js';
import { api, _authSession, isGuestMode, guestCollectionCSVBlob } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet } from '../components/sheet.js';
import { parseCollectionCSV } from '../lib/pure.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { state } from '../state.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';

export async function renderMeData() {
  if (!state.me) $("#root").innerHTML = skelPage(skelSettingRows(3));
  await loadMe();
  const guest = isGuestMode();

  $("#root").innerHTML = `
    <div class="page">
      ${subpageTopbarHTML("Import & export", "Data")}

      <div class="section-title">Export</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Export collection</div><div class="desc">CSV with all collector fields &amp; ROI.</div></div>
          <button class="import-btn" id="exportCsvBtn" aria-label="Export CSV">${I.download()}</button>
        </div>
      </div>

      <div class="section-title">Import</div>
      <div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import collection</div>
            <div class="desc">Upload a CSV to add sets in bulk. Existing sets are skipped.</div>
          </div>
          <div class="csv-import-wrap">
            <label class="csv-file-label">${I.download()}<span>Choose CSV file</span><input type="file" id="csvFile" accept=".csv"></label>
            <span id="csvFileName"></span>
            <button class="btn-primary" id="csvImportBtn" style="display:none;">${I.plus()}<span>Import</span></button>
          </div>
          <div id="csvImportResult" class="u-fs-base u-mute" style="font-family:var(--mono);"></div>
        </div>
        <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import from BrickLink orders</div>
            <div class="desc">Export your BrickLink order history as CSV and upload it here to auto-add sets you've bought.</div>
          </div>
          <div class="csv-import-wrap">
            <label class="csv-file-label">${I.download()}<span>Choose BrickLink CSV</span><input type="file" id="blOrderFile" accept=".csv"></label>
            <span id="blOrderFileName"></span>
            <button class="btn-primary" id="blOrderImportBtn" style="display:none;">${I.plus()}<span>Import BrickLink Orders</span></button>
          </div>
          <div id="blOrderImportResult" class="u-fs-base u-mute" style="font-family:var(--mono);"></div>
        </div>
      </div>
    </div>`;

  $("#exportCsvBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const _expBtn = document.getElementById("exportCsvBtn");
    if (_expBtn) { _expBtn.disabled = true; _expBtn.setAttribute("aria-busy", "true"); }
    try {
      if (guest) {
        const blob = guestCollectionCSVBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "brickvault-collection.csv";
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const token = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/collection/export", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "brickvault-collection.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast("Error exporting: " + e.message, "error");
    } finally {
      if (_expBtn) { _expBtn.disabled = false; _expBtn.removeAttribute("aria-busy"); }
    }
  });

  const fileInput = $("#csvFile");
  const importBtn = $("#csvImportBtn");
  const fileNameSpan = $("#csvFileName");

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      fileNameSpan.textContent = file.name;
      importBtn.style.display = "inline-flex";
    } else {
      fileNameSpan.textContent = "";
      importBtn.style.display = "none";
    }
  });

  importBtn?.addEventListener("click", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    haptic("medium");
    setBtnLoading(importBtn, true);
    const resultEl = $("#csvImportResult");
    if (resultEl) resultEl.textContent = "Uploading & parsing...";
    try {
      const text = await file.text();
      const rows = parseCollectionCSV(text);
      if (!rows.length) throw new Error("No valid rows found — check set_num column exists");

      // Preview before applying — imports are hard to undo.
      const sample = rows.slice(0, 3)
        .map(r => `${r.set_num}${r.quantity > 1 ? ` ×${r.quantity}` : ''}`)
        .join(', ');
      setBtnLoading(importBtn, false);
      if (resultEl) resultEl.textContent = "";
      const ok = await confirmSheet({
        title: `Import ${rows.length} set${rows.length === 1 ? '' : 's'}?`,
        message: `Starting with: ${sample}${rows.length > 3 ? ` and ${rows.length - 3} more` : ''}. Existing sets are kept.`,
        confirmLabel: "Import",
      });
      if (!ok) return;
      setBtnLoading(importBtn, true);
      if (resultEl) resultEl.textContent = "Importing...";

      const r = await api("/api/collection/import", { method: "POST", body: { rows } });
      if (resultEl) resultEl.textContent = `✓ ${r.imported} imported, ${r.skipped} skipped${r.errors?.length ? `, ${r.errors.length} errors` : ""}`;
      invalidatePortfolio();
      toast(`${r.imported} sets imported`, "success");
    } catch (e) {
      if (resultEl) resultEl.textContent = "Error: " + e.message;
      toast("Import failed: " + e.message, "error");
    } finally {
      setBtnLoading(importBtn, false);
    }
  });

  // BrickLink order CSV import
  const blFileInput = $("#blOrderFile");
  const blImportBtn = $("#blOrderImportBtn");
  const blFileNameSpan = $("#blOrderFileName");

  blFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (blFileNameSpan) blFileNameSpan.textContent = file.name;
      if (blImportBtn) blImportBtn.style.display = "inline-flex";
    } else {
      if (blFileNameSpan) blFileNameSpan.textContent = "";
      if (blImportBtn) blImportBtn.style.display = "none";
    }
  });

  blImportBtn?.addEventListener("click", async () => {
    const file = blFileInput?.files?.[0];
    if (!file) return;
    haptic("medium");
    setBtnLoading(blImportBtn, true);
    const resultEl = $("#blOrderImportResult");
    if (resultEl) resultEl.textContent = "Parsing BrickLink orders...";
    try {
      const text = await file.text();
      const res = await api("/api/bricklink/import-csv", { method: "POST", body: { csv: text } });
      if (resultEl) resultEl.textContent = `✓ ${res.added} sets added, ${res.skipped} skipped${res.errors?.length ? ` (first errors: ${res.errors.slice(0,3).join("; ")})` : ""}`;
      invalidatePortfolio();
      toast(`${res.added} sets imported from BrickLink orders`, "success");
    } catch (e) {
      if (resultEl) resultEl.textContent = "Error: " + e.message;
      toast("BrickLink import failed: " + e.message, "error");
    } finally {
      setBtnLoading(blImportBtn, false);
    }
  });
}
