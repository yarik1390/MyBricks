import { $, haptic, toast, setBtnLoading } from '../utils.js';
import { invalidatePortfolio } from '../state.js';
import { api, _authSession, isGuestMode, guestCollectionCSVBlob } from '../api.js';
import { I } from '../icons.js';
import { confirmSheet } from '../components/sheet.js';
import { parseCollectionCSV } from '../lib/pure.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { state } from '../state.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';
import { exportBlob } from '../lib/native-file-export.js';

export async function renderMeData() {
  if (!state.me) $("#root").innerHTML = skelPage(skelSettingRows(3));
  await loadMe();
  const guest = isGuestMode();

  $("#root").innerHTML = `
    <div class="page">
      ${subpageTopbarHTML("Import & export", "Data")}

      <div class="data-grid">
        <section class="data-card">
          <div class="section-title">Export</div>
          <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Export collection</div><div class="desc">${state.me?.is_supporter
            ? "CSV with all collector fields, market values &amp; ROI."
            : "CSV of everything you've entered. <a href='#/me' style='color:var(--bv-red);font-weight:600;'>Pro</a> adds current value, retail &amp; ROI columns."}</div></div>
          <button class="import-btn" id="exportCsvBtn" aria-label="Export CSV">${I.download()}</button>
          </div>
          <div class="action-result" id="exportResult" aria-live="polite">${guest ? "Guest exports use the local vault on this device." : "Signed-in exports are pulled from your synced account."}</div>
          ${guest ? "" : `
          <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Insurance report</div><div class="desc">${state.me?.is_supporter
            ? "Printable valuation of your vault — save as PDF for home insurance."
            : "Printable valuation for home insurance. A <a href='#/me' style='color:var(--bv-red);font-weight:600;'>Pro</a> feature."}</div></div>
          <button class="import-btn" id="insuranceReportBtn" aria-label="Insurance report" ${state.me?.is_supporter ? "" : "disabled"}>${I.download()}</button>
          </div>
          <div class="action-result" id="insuranceResult" aria-live="polite"></div>`}
        </section>

        ${guest ? "" : `
        <section class="data-card">
          <div class="section-title">Backups</div>
          <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div class="lbl-wrap">
              <div class="lbl">Vault snapshots</div>
              <div class="desc">Your vault is snapshotted every Sunday. Restore rolls your collection back to that day without losing history.</div>
            </div>
            <div id="backupList" class="action-result" aria-live="polite">Loading…</div>
          </div>
        </section>`}

        ${!guest && localStorage.getItem("bv_failed_guest_migration") ? `
        <section class="data-card">
          <div class="section-title">Guest sync</div>
          <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Retry guest sync</div><div class="desc">Some items from your guest vault didn't sync when you signed in. Retry now — already-synced sets are skipped.</div></div>
          <button class="btn-primary" id="retryGuestSyncBtn" style="width:auto;padding:8px 14px;font-size:13px;">Retry</button>
          </div>
          <div class="action-result" id="retryGuestSyncResult" aria-live="polite"></div>
        </section>` : ""}

        <section class="data-card">
          <div class="section-title">Import</div>
          <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import collection</div>
            <div class="desc">Upload a CSV to add sets in bulk — works with Brickset and BrickEconomy exports too. Existing sets are skipped.</div>
          </div>
          <div class="csv-import-wrap">
            <label class="csv-file-label">${I.upload()}<span>Choose CSV file</span><input type="file" id="csvFile" accept=".csv"></label>
            <span id="csvFileName"></span>
            <button class="btn-primary" id="csvImportBtn" style="display:none;">${I.plus()}<span>Import</span></button>
          </div>
          <div id="csvImportResult" class="action-result" aria-live="polite"></div>
          </div>
          <div class="setting-row" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div class="lbl-wrap">
            <div class="lbl">Import from BrickLink orders</div>
            <div class="desc">Export your BrickLink order history as CSV and upload it here to auto-add sets you've bought.</div>
          </div>
          <div class="csv-import-wrap">
            <label class="csv-file-label">${I.upload()}<span>Choose BrickLink CSV</span><input type="file" id="blOrderFile" accept=".csv"></label>
            <span id="blOrderFileName"></span>
            <button class="btn-primary" id="blOrderImportBtn" style="display:none;">${I.plus()}<span>Import BrickLink Orders</span></button>
          </div>
          <div id="blOrderImportResult" class="action-result" aria-live="polite"></div>
          </div>
        </section>
      </div>
    </div>`;

  $("#insuranceReportBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const out = $("#insuranceResult");
    if (out) out.textContent = "Preparing report…";
    try {
      const token = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/me/insurance-report", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Report failed");
      const blob = await res.blob();
      const result = await exportBlob(blob, "bricksvault-insurance-report.html", { title: "BricksVault insurance report" });
      if (out) out.textContent = result === "shared"
        ? "Report ready — open it and print to PDF."
        : "Report downloaded — open it and print to PDF.";
    } catch (e) {
      if (out) out.textContent = "Report failed: " + e.message;
    }
  });

  // Backups: list snapshot dates with per-date Restore. Best-effort — the card
  // simply reports when backups aren't configured or none exist yet.
  (async () => {
    const list = $("#backupList");
    if (!list || isGuestMode()) return;
    try {
      const r = await api("/api/me/backups");
      const dates = r?.backups || [];
      if (!dates.length) { list.textContent = "No snapshots yet — the first one is written next Sunday."; return; }
      list.innerHTML = dates.slice(0, 8).map((d) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line-soft);">
          <span style="font-family:var(--mono);font-size:12px;">${d}</span>
          <button class="btn-secondary backup-restore" data-date="${d}" style="width:auto;padding:6px 12px;font-size:12px;">Restore</button>
        </div>`).join("");
      list.querySelectorAll(".backup-restore").forEach((btn) => btn.addEventListener("click", async (e) => {
        const date = e.currentTarget.dataset.date;
        const ok = await confirmSheet({
          title: `Restore ${date}?`,
          message: "Your collection rolls back to this snapshot. Sets added since stay; nothing is permanently deleted.",
          confirmLabel: "Restore",
        });
        if (!ok) return;
        haptic("heavy");
        setBtnLoading(e.target.closest("button"), true);
        try {
          const res = await api(`/api/me/backups/${encodeURIComponent(date)}/restore`, { method: "POST" });
          invalidatePortfolio();
          toast(`Restored ${res.restored} sets from ${date}`, "success");
        } catch (err) { toast("Restore failed: " + err.message, "error"); }
        finally { setBtnLoading(e.target.closest("button"), false); }
      }));
    } catch { list.textContent = "Backups unavailable right now."; }
  })();

  $("#retryGuestSyncBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const out = $("#retryGuestSyncResult");
    const btn = $("#retryGuestSyncBtn");
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    if (out) out.textContent = "Retrying sync…";
    try {
      const snapshot = JSON.parse(localStorage.getItem("bv_failed_guest_migration") || "null");
      const { migrateGuestVault } = await import("../api.js");
      const migrated = await migrateGuestVault(snapshot || undefined);
      if (migrated.errors?.length) {
        if (out) out.textContent = `Still ${migrated.errors.length} item${migrated.errors.length === 1 ? "" : "s"} failing: ${migrated.errors[0]}`;
      } else {
        localStorage.removeItem("bv_failed_guest_migration");
        invalidatePortfolio();
        if (out) out.textContent = `Done — ${migrated.migrated} item${migrated.migrated === 1 ? "" : "s"} synced.`;
        toast("Guest vault synced", "success");
      }
    } catch (e) {
      if (out) out.textContent = "Retry failed: " + e.message;
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
    }
  });

  $("#exportCsvBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const _expBtn = document.getElementById("exportCsvBtn");
    const out = document.getElementById("exportResult");
    if (_expBtn) { _expBtn.disabled = true; _expBtn.setAttribute("aria-busy", "true"); }
    if (out) out.textContent = "Preparing export...";
    try {
      if (guest) {
        const blob = guestCollectionCSVBlob();
        const result = await exportBlob(blob, "brickvault-collection.csv", { title: "Share BricksVault collection" });
        if (out) out.textContent = result === "shared"
          ? "Your local guest export is ready to share or save."
          : "Export downloaded from local guest data.";
        return;
      }
      const token = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/collection/export", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const result = await exportBlob(blob, "brickvault-collection.csv", { title: "Share BricksVault collection" });
      if (out) out.textContent = result === "shared"
        ? "Your synced export is ready to share or save."
        : "Export downloaded from your synced vault.";
    } catch (e) {
      if (out) out.textContent = "Export failed: " + e.message;
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
