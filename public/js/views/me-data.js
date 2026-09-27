import { $, haptic, toast, setBtnLoading, escapeHtml } from '../utils.js';
import { invalidatePortfolio } from '../state.js';
import { api, _authSession, isGuestMode, guestCollectionCSVBlob } from '../api.js';
import { icon as kitIcon, row as kitRow } from '../ui/kit.js';
import { confirmSheet } from '../components/sheet.js';
import { parseCollectionCSV } from '../lib/pure.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { state } from '../state.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';
import { exportBlob } from '../lib/native-file-export.js';
import { t, tPlural, getLocale } from '../lib/i18n.js';

// "2026-08-24" → a friendly day ("24 Aug 2026"); unknown shapes stay as-is.
function backupLabel(d) {
  const ts = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(ts) ? new Date(ts).toLocaleDateString(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) : d;
}

export async function renderMeData() {
  if (!state.me) $("#root").innerHTML = skelPage(skelSettingRows(3));
  await loadMe();
  const guest = isGuestMode();

  const pro = !!state.me?.is_supporter;
  const fileRow = ({ icon: ic, title, sub, inputId, pickLabel, nameId, importId, importLabel, resultId }) => `
    <div class="bv-datarow">
      <div class="bv-datarow__head">${kitIcon(ic, { size: 22 })}<span class="bv-row__text"><span class="bv-row__title">${title}</span><span class="bv-row__sub">${sub}</span></span></div>
      <div class="csv-import-wrap bv-datarow__actions">
        <span class="csv-file-picker"><button type="button" class="bv-btn bv-btn--tonal csv-file-label" data-file-picker data-file-input="${inputId}">${kitIcon('upload', { size: 20 })}<span>${pickLabel}</span></button><input type="file" id="${inputId}" accept=".csv" tabindex="-1" aria-hidden="true"></span>
        <span class="bv-datarow__file" id="${nameId}"></span>
        <button type="button" class="bv-btn bv-btn--primary" id="${importId}" style="display:none;">${kitIcon('plus', { size: 20 })}<span>${importLabel}</span></button>
      </div>
      <div id="${resultId}" class="action-result" aria-live="polite"></div>
    </div>`;

  $("#root").innerHTML = `
    <main class="bv-page data-page bv-data">
      ${subpageTopbarHTML(t('bvAccount.dataLead'), t('bvAccount.importExport'))}

      <section class="bv-group">
        <h2 class="bv-h2">${escapeHtml(t('bvAccount.bringIn'))}</h2>
        <div class="bv-group__box">
          ${kitRow({ icon: 'brick', title: t('bvAccount.fromBrickset'), sub: t('bvAccount.fromBricksetSub'), href: '#/me/integrations' })}
          ${fileRow({ icon: 'upload', title: 'Import from BrickLink orders', sub: "Export your BrickLink order history as CSV and upload it here to auto-add sets you've bought.", inputId: 'blOrderFile', pickLabel: 'Choose BrickLink CSV', nameId: 'blOrderFileName', importId: 'blOrderImportBtn', importLabel: 'Import BrickLink Orders', resultId: 'blOrderImportResult' })}
          ${fileRow({ icon: 'file', title: 'Import collection', sub: 'Upload a CSV to add sets in bulk — works with Brickset and BrickEconomy exports too. Existing sets are skipped.', inputId: 'csvFile', pickLabel: 'Choose CSV file', nameId: 'csvFileName', importId: 'csvImportBtn', importLabel: 'Import', resultId: 'csvImportResult' })}
        </div>
      </section>

      <section class="bv-group">
        <h2 class="bv-h2">${escapeHtml(t('bvAccount.takeOut'))}</h2>
        <div class="bv-group__box">
          <button type="button" class="bv-row" id="exportCsvBtn" aria-label="Export CSV">${kitIcon('download', { size: 22 })}<span class="bv-row__text"><span class="bv-row__title">Export collection</span><span class="bv-row__sub">${pro
            ? "CSV with all collector fields, market values &amp; ROI."
            : "CSV of everything you've entered. <a href='#/pro'>Pro</a> adds current value, retail &amp; ROI columns."}</span></span><span class="bv-row__trail">${kitIcon('chev', { size: 20 })}</span></button>
          <div class="action-result bv-data__result" id="exportResult" aria-live="polite">${guest ? "Guest exports use the local vault on this device." : "Signed-in exports are pulled from your synced account."}</div>
          ${guest ? '' : kitRow({ icon: 'shield', title: t('bvAccount.insurance'), sub: t('bvAccount.insuranceSub'), href: '#/me/insurance' })}
        </div>
      </section>

      ${guest ? "" : `
      <section class="bv-group">
        <h2 class="bv-h2">${escapeHtml(t('bvAccount.backups'))}</h2>
        <div class="bv-group__box">
          <p class="bv-data__lead">Your vault is snapshotted every Sunday. Restore rolls your collection back to that day without losing history.</p>
          <div id="backupList" class="action-result bv-backups" aria-live="polite">Loading…</div>
        </div>
      </section>`}

      ${!guest && localStorage.getItem("bv_failed_guest_migration") ? `
      <section class="bv-group">
        <h2 class="bv-h2">Guest sync</h2>
        <div class="bv-group__box">
          <div class="bv-datarow">
            <div class="bv-datarow__head">${kitIcon('refresh', { size: 22 })}<span class="bv-row__text"><span class="bv-row__title">Retry guest sync</span><span class="bv-row__sub">Some items from your guest vault didn't sync when you signed in. Retry now — already-synced sets are skipped.</span></span></div>
            <div class="bv-datarow__actions"><button type="button" class="bv-btn bv-btn--primary" id="retryGuestSyncBtn">Retry</button></div>
            <div class="action-result" id="retryGuestSyncResult" aria-live="polite"></div>
          </div>
        </div>
      </section>` : ""}
    </main>`;

  // Backups: list snapshot dates with per-date Restore. Best-effort — the card
  // simply reports when backups aren't configured or none exist yet.
  (async () => {
    const list = $("#backupList");
    if (!list || isGuestMode()) return;
    try {
      const r = await api("/api/me/backups");
      const dates = r?.backups || [];
      if (!dates.length) { list.textContent = t('data.noSnapshotsYet'); return; }
      list.innerHTML = dates.slice(0, 8).map((d) => `
        <div class="backup-row">
          ${kitIcon('clock', { size: 22 })}<span class="backup-row__date">${escapeHtml(backupLabel(d))}</span>
          <button type="button" class="bv-btn bv-btn--outline backup-restore" data-date="${escapeHtml(d)}" aria-label="Restore snapshot from ${escapeHtml(d)}">Restore</button>
        </div>`).join("");
      list.querySelectorAll(".backup-restore").forEach((btn) => btn.addEventListener("click", async (e) => {
        const date = e.currentTarget.dataset.date;
        const ok = await confirmSheet({
          title: `Restore ${date}?`,
          message: "Your collection rolls back to this snapshot. Sets added since stay; nothing is permanently deleted.",
          confirmLabel: "Restore snapshot",
        });
        if (!ok) return;
        haptic("heavy");
        setBtnLoading(e.target.closest("button"), true);
        try {
          const res = await api(`/api/me/backups/${encodeURIComponent(date)}/restore`, { method: "POST" });
          invalidatePortfolio();
toast(tPlural('data.restoredFromBackup', res.restored, { date }), "success");
        } catch (err) { toast(t('data.restoreFailed', { error: err.message || err }), "error"); }
        finally { setBtnLoading(e.target.closest("button"), false); }
      }));
    } catch { list.textContent = t('data.backupsUnavailable'); }
  })();

  $("#retryGuestSyncBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const out = $("#retryGuestSyncResult");
    const btn = $("#retryGuestSyncBtn");
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    if (out) out.textContent = t('data.retryingSync');
    try {
      const snapshot = JSON.parse(localStorage.getItem("bv_failed_guest_migration") || "null");
      const { migrateGuestVault } = await import("../api.js");
      const migrated = await migrateGuestVault(snapshot || undefined);
      if (migrated.errors?.length) {
        if (out) out.textContent = tPlural('data.migrationStillFailing', migrated.errors.length, { error: migrated.errors[0] });
      } else {
        localStorage.removeItem("bv_failed_guest_migration");
        invalidatePortfolio();
        if (out) out.textContent = tPlural('data.migrationComplete', migrated.migrated);
        toast(t('data.guestVaultSynced'), "success");
      }
    } catch (e) {
      if (out) out.textContent = t('data.retryFailed', { error: e.message || e });
    } finally {
      if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
    }
  });

  $("#exportCsvBtn")?.addEventListener("click", async () => {
    haptic("medium");
    const _expBtn = document.getElementById("exportCsvBtn");
    const out = document.getElementById("exportResult");
    if (_expBtn) { _expBtn.disabled = true; _expBtn.setAttribute("aria-busy", "true"); }
    if (out) out.textContent = t('data.exportPreparing');
    try {
      if (guest) {
        const blob = guestCollectionCSVBlob();
        const result = await exportBlob(blob, "brickvault-collection.csv", { title: t('data.collectionExportTitle') });
        if (out) out.textContent = result === "shared"
          ? t('data.guestExportShared')
          : t('data.guestExportDownloaded');
        return;
      }
      const token = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/collection/export", {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const result = await exportBlob(blob, "brickvault-collection.csv", { title: t('data.collectionExportTitle') });
      if (out) out.textContent = result === "shared"
        ? t('data.syncedExportShared')
        : t('data.syncedExportDownloaded');
    } catch (e) {
      if (out) out.textContent = t('data.exportFailed', { error: e.message || e });
      toast(t('data.exportFailed', { error: e.message || e }), "error");
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
        title: tPlural('data.csvImportConfirmTitle', rows.length),
        message: tPlural('data.csvImportConfirmMessage', rows.length, {
          sample,
          more: rows.length > 3 ? tPlural('data.csvImportMore', rows.length - 3) : '',
        }),
        confirmLabel: t('data.importConfirm'),
      });
      if (!ok) return;
      setBtnLoading(importBtn, true);
      if (resultEl) resultEl.textContent = "Importing...";

      const r = await api("/api/collection/import", { method: "POST", body: { rows } });
      const importSummary = {
        imported: tPlural('data.importedCount', r.imported),
        skipped: tPlural('data.skippedCount', r.skipped),
        errors: tPlural('data.errorsCount', r.errors?.length || 0),
      };
      if (resultEl) resultEl.textContent = t('data.importResult', importSummary);
      invalidatePortfolio();
      toast(tPlural('data.setsImported', r.imported), "success");
    } catch (e) {
      if (resultEl) resultEl.textContent = t('data.importFailed', { error: e.message || e });
      toast(t('data.importFailed', { error: e.message || e }), "error");
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
      const bricklinkSummary = {
        added: tPlural('data.setsAddedCount', res.added),
        skipped: tPlural('data.skippedCount', res.skipped),
        errors: res.errors?.slice(0, 3).join('; ') || '',
      };
      if (resultEl) resultEl.textContent = t('data.bricklinkImportResult', bricklinkSummary);
      invalidatePortfolio();
      toast(tPlural('data.bricklinkSetsImported', res.added), "success");
    } catch (e) {
      if (resultEl) resultEl.textContent = t('data.bricklinkImportFailed', { error: e.message || e });
      toast(t('data.bricklinkImportFailed', { error: e.message || e }), "error");
    } finally {
      setBtnLoading(blImportBtn, false);
    }
  });
}
