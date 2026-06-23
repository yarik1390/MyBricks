import { $, haptic, escapeHtml, toast } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { classifyJobRun, jobProgressSummary } from '../lib/pure.js';
import { go } from '../router.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';

let activeAdminRunId = null;
let activeAdminTool = null;
let adminJobPollTimer = null;
let populateEverythingAuto = false;
let populateEverythingContinueTimer = null;

export async function renderMeAdmin() {
  if (!state.me) $("#root").innerHTML = skelPage(skelSettingRows(6));
  const me = await loadMe();
  if (!me?.is_admin) { go("#/me"); return; }

  const savedOpenAIKey = localStorage.getItem('bv_openai_key') || '';
  const googleStatus = await api("/api/google/status").catch(() => ({ connected: false, configured: false }));
  const status = state.config?.status || {
    supabase: true,
    d1: true,
    openai: !!savedOpenAIKey,
    google: googleStatus.connected,
    ebay: me?.ebay_configured,
    bricklink: me?.bricklink_configured,
    brickeconomy: me?.brickeconomy_configured,
    brickset: false,
    brickowl: false,
    rebrickable: false,
    firecrawl: false
  };

  const checkRow = (label, ok, okText, missText, optional = false) => `
    <div class="u-between" style="min-height:28px;">
      <span>${label}</span>
      ${ok
        ? `<span class="badge badge--up">● ${okText}</span>`
        : `<span class="badge ${optional ? "badge--neutral" : "badge--down"}">${missText}</span>`}
    </div>`;

  $("#root").innerHTML = `
    <div class="page">
      ${subpageTopbarHTML("Admin console", "Admin")}

      <div class="section-title">System Setup Checklist</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div class="u-col u-fs-sm" style="gap:10px;">
          ${checkRow("Database (D1)", status.d1, "Connected", "Missing")}
          ${checkRow("Authentication (Supabase)", status.supabase, "Configured", "Missing")}
          ${checkRow("Server AI (OpenAI)", status.openai, "Configured", "Unconfigured (use your own key)", true)}
          ${checkRow("Google Sheets Integration", status.google, "Configured", "Unconfigured")}
          ${checkRow("BrickLink Pricing API", status.bricklink, "Connected", "Unconfigured")}
          ${checkRow("eBay Pricing API", status.ebay, "Connected", "Unconfigured (sold comps disabled)", true)}
          ${checkRow("Firecrawl (scraping engine)", status.firecrawl, "Configured", "Unconfigured")}
          ${checkRow("BrickEconomy API (legacy)", status.brickeconomy, "Configured", "Now via Firecrawl", true)}
          ${checkRow("Rebrickable Catalog API", status.rebrickable, "Configured", "Missing")}
          ${checkRow("Brickset Metadata API", status.brickset, "Configured", "Optional", true)}
          ${(!status.supabase || !status.google || !status.ebay || !status.firecrawl || !status.openai || !status.rebrickable) ? `
            <div class="u-col u-gap-1 u-fs-2xs u-mute" style="border-top:1px solid var(--border-soft-c);padding-top:8px;line-height:1.4;">
              <span>To configure integrations, set the following environment variables in your Cloudflare dashboard:</span>
              <code style="word-break: break-all;">DB (D1 Binding), SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, OPENAI_API_KEY, REBRICKABLE_API_KEY, BRICKSET_API_KEY, FIRECRAWL_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, EBAY_APP_ID, EBAY_CLIENT_SECRET</code>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="section-title">Catalog</div>
      <div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Import sets</div><div class="desc" id="importSetsDesc">~22k sets from Rebrickable with themes &amp; images</div></div>
          <button class="import-btn" id="importSetsBtn" aria-label="Import sets">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Import minifigs</div><div class="desc" id="importFigsDesc">~10k minifigures from Rebrickable</div></div>
          <button class="import-btn" id="importFigsBtn" aria-label="Import minifigs">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Backfill barcodes</div><div class="desc" id="backfillUpcDesc">Daily safe slices from Brickset; press to advance now</div></div>
          <button class="import-btn" id="backfillUpcBtn" aria-label="Backfill barcodes">${I.download()}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Populate coverage</div><div class="desc" id="populateCoverageDesc">One safe slice: barcode pages plus eBay ask refresh</div></div>
          <button class="import-btn" id="populateCoverageBtn" aria-label="Populate coverage">${I.refresh({w: 16, h: 16})}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Revalue prices</div><div class="desc" id="revalueAllDesc">Daily safe valuation batches; press to advance now</div></div>
          <button class="import-btn" id="revalueAllBtn" aria-label="Revalue all prices">${I.refresh({w: 16, h: 16})}</button>
        </div>
        <div class="setting-row">
          <div class="lbl-wrap"><div class="lbl">Populate everything</div><div class="desc" id="populateEverythingDesc">Auto-runs safe slices from every configured data source</div></div>
          <button class="import-btn" id="populateEverythingBtn" aria-label="Populate all configured data sources">${I.refresh({w: 16, h: 16})}</button>
        </div>
      </div>

      <div class="section-title">Import &amp; Revalue Jobs</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div id="jobsStatusContainer" class="u-col u-fs-sm" style="color:var(--ink-soft);">
          Loading jobs status...
        </div>
      </div>

      <div class="section-title">Integrations Health</div>
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div id="integrationsHealthContainer" class="u-col u-fs-sm" style="color:var(--ink-soft);">
          Loading integrations status...
        </div>
      </div>
    </div>`;

  $("#importSetsBtn")?.addEventListener("click", () => triggerImport("sets"));
  $("#importFigsBtn")?.addEventListener("click", () => triggerImport("figs"));
  $("#backfillUpcBtn")?.addEventListener("click", () => triggerImport("upc"));
  $("#populateCoverageBtn")?.addEventListener("click", () => triggerImport("populate"));
  $("#revalueAllBtn")?.addEventListener("click", () => triggerImport("revalue"));
  $("#populateEverythingBtn")?.addEventListener("click", () => triggerImport("everything"));

  updateJobsStatus();
  updateIntegrationsHealth();
}

const ADMIN_JOB_TOOLS = {
  sets: { url: "/api/admin/import-rebrickable", method: "POST", body: { dataset: "sets" }, desc: "importSetsDesc", btn: "importSetsBtn", text: "Importing sets...", idle: "~22k sets from Rebrickable with themes & images" },
  figs: { url: "/api/admin/import-rebrickable", method: "POST", body: { dataset: "figs" }, desc: "importFigsDesc", btn: "importFigsBtn", text: "Importing figs...", idle: "~10k minifigures from Rebrickable" },
  upc: { url: "/api/admin/backfill-upc", method: "POST", body: {}, desc: "backfillUpcDesc", btn: "backfillUpcBtn", text: "Backfilling UPC...", idle: "Daily safe slices from Brickset; press to advance now" },
  populate: { url: "/api/admin/populate-coverage", method: "POST", body: {}, desc: "populateCoverageDesc", btn: "populateCoverageBtn", text: "Populating coverage...", idle: "One safe slice: barcode pages plus eBay ask refresh" },
  revalue: { url: "/api/admin/revalue-brickeconomy", method: "POST", body: { scope: "all", limit: 4 }, desc: "revalueAllDesc", btn: "revalueAllBtn", text: "Revaluing prices...", idle: "Daily safe valuation batches; press to advance now" },
  everything: { url: "/api/admin/populate-everything", method: "POST", body: { valuation_limit: 5, barcode_pages: 4, ebay_limit: 2 }, desc: "populateEverythingDesc", btn: "populateEverythingBtn", text: "Populating everything...", idle: "Auto-runs safe slices from every configured data source" }
};

function adminToolFromJobType(jobType = "") {
  if (jobType === "catalog_sets") return "sets";
  if (jobType === "catalog_figs") return "figs";
  if (jobType === "catalog_all") return "sets";
  if (jobType === "barcode_backfill") return "upc";
  if (jobType === "populate_coverage") return "populate";
  if (jobType === "valuation") return "revalue";
  if (jobType === "populate_everything") return "everything";
  return null;
}

function setAdminJobButtons(runningType = null) {
  Object.entries(ADMIN_JOB_TOOLS).forEach(([key, cfg]) => {
    const btn = document.getElementById(cfg.btn);
    if (!btn) return;
    const busy = !!runningType;
    btn.disabled = busy;
    btn.setAttribute("aria-busy", busy && key === runningType ? "true" : "false");
  });
}

function setAdminJobDescriptions(runningType = null, text = "") {
  Object.entries(ADMIN_JOB_TOOLS).forEach(([key, cfg]) => {
    const desc = document.getElementById(cfg.desc);
    if (!desc) return;
    desc.textContent = runningType && key === runningType ? (text || cfg.text) : cfg.idle;
  });
}

function scheduleAdminJobPoll(delay = 2500) {
  if (adminJobPollTimer) clearTimeout(adminJobPollTimer);
  if (location.hash !== "#/me/admin") return;
  adminJobPollTimer = setTimeout(() => {
    adminJobPollTimer = null;
    updateJobsStatus();
  }, delay);
}

function isPopulateEverythingComplete(run = {}) {
  return run.job_type === "populate_everything" && /method:populate-everything\b[\s\S]*complete:true/i.test(String(run.error || ""));
}

function schedulePopulateEverythingContinue(delay = 1400) {
  if (populateEverythingContinueTimer) clearTimeout(populateEverythingContinueTimer);
  if (!populateEverythingAuto || location.hash !== "#/me/admin") return;
  populateEverythingContinueTimer = setTimeout(() => {
    populateEverythingContinueTimer = null;
    if (populateEverythingAuto && !activeAdminRunId) triggerImport("everything");
  }, delay);
}

async function triggerImport(type) {
  const cnf = ADMIN_JOB_TOOLS[type];
  if (!cnf) return;
  if (activeAdminRunId) {
    toast("A catalog job is already running", "info");
    scheduleAdminJobPoll(500);
    return;
  }
  if (type === "everything") populateEverythingAuto = true;
  else populateEverythingAuto = false;
  haptic("medium");
  const descEl = document.getElementById(cnf.desc);
  const origText = descEl ? descEl.textContent : "";
  if (descEl) descEl.textContent = cnf.text;
  setAdminJobButtons(type);
  try {
    const r = await api(cnf.url, { method: cnf.method, body: cnf.body });
    activeAdminRunId = r.run_id || null;
    activeAdminTool = type;
    if (type === "everything" && r.done) populateEverythingAuto = false;
    toast(r.message || `Job #${activeAdminRunId || ""} started`, "success");
    await updateJobsStatus();
    scheduleAdminJobPoll(1200);
  } catch (e) {
    toast("Job failed: " + e.message, "error");
    if (descEl) descEl.textContent = origText;
    activeAdminRunId = null;
    activeAdminTool = null;
    populateEverythingAuto = false;
    if (populateEverythingContinueTimer) {
      clearTimeout(populateEverythingContinueTimer);
      populateEverythingContinueTimer = null;
    }
    setAdminJobButtons(null);
    setAdminJobDescriptions(null);
  }
}

async function updateJobsStatus() {
  const container = document.getElementById("jobsStatusContainer");
  if (!container) return;
  const ago = (ts) => {
    if (!ts) return "";
    const then = new Date(String(ts).replace(" ", "T") + "Z").getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (!Number.isFinite(mins)) return "";
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
  };
  try {
    const data = await api("/api/admin/import-status");
    const runs = data.runs || [];
    if (runs.length === 0) {
      activeAdminRunId = null;
      activeAdminTool = null;
      setAdminJobButtons(null);
      setAdminJobDescriptions(null);
      if (adminJobPollTimer) {
        clearTimeout(adminJobPollTimer);
        adminJobPollTimer = null;
      }
      if (populateEverythingContinueTimer) {
        clearTimeout(populateEverythingContinueTimer);
        populateEverythingContinueTimer = null;
      }
      container.innerHTML = `<div class="u-mute">No jobs have run yet.</div>`;
      return;
    }

    const classified = runs.map(run => ({ run, state: classifyJobRun(run) }));
    const runningRun = classified.find(x => x.state.label === "Running")?.run || null;
    if (runningRun) {
      activeAdminRunId = runningRun.id;
      activeAdminTool = adminToolFromJobType(runningRun.job_type) || activeAdminTool;
    } else {
      activeAdminRunId = null;
      activeAdminTool = null;
    }
    const runningProgress = runningRun ? jobProgressSummary(runningRun) : null;
    setAdminJobButtons(activeAdminTool || (runningRun ? "active" : null));
    setAdminJobDescriptions(activeAdminTool, runningProgress?.label);
    const isStoppedRun = (run) => ["Stopped", "Stalled"].includes(classifyJobRun(run).label) || /Timed out|Worker run stopped/i.test(String(run.error || ""));
    const hasCompleted = classified.some(x => x.state.label === "Completed");
    const hasRunning = classified.some(x => x.state.label === "Running");
    const retryableCount = classified.filter(x => x.state.retryable).length;
    const hardErrors = classified.filter(x => x.state.needsAttention);
    const latestState = classified[0]?.state || null;
    const summaryText = hasRunning
      ? "Job running"
      : latestState?.needsAttention
        ? "Latest job needs attention"
        : retryableCount
          ? `${retryableCount} retryable stopped/provider note${retryableCount === 1 ? "" : "s"}`
          : hasCompleted
            ? "Latest batches completed"
            : hardErrors.length
              ? `${hardErrors.length} historical hard job error${hardErrors.length === 1 ? "" : "s"}`
              : "No completed batches yet";
    const activeProgressHTML = runningRun && runningProgress ? `
      <div style="margin-top:9px;">
        <div class="u-between u-fs-xs" style="color:var(--ink-soft);margin-bottom:5px;">
          <span>${escapeHtml(runningProgress.label)}</span>
          <span>${escapeHtml(runningProgress.countText || "working")}${runningProgress.pct != null ? ` / ${runningProgress.pct}%` : ""}</span>
        </div>
        <div style="height:8px;border:1px solid var(--border-c);border-radius:var(--r-full);background:var(--surface);overflow:hidden;">
          <div style="height:100%;width:${runningProgress.pct ?? 32}%;background:var(--bv-yellow);transition:width .25s ease;"></div>
        </div>
      </div>
    ` : "";
    const summaryHTML = `
      <div style="border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);background:var(--surface-2);padding:10px 12px;margin-bottom:10px;">
        <div class="u-fs-sm" style="font-weight:700;color:${latestState?.needsAttention ? "var(--bv-red)" : (hasRunning || retryableCount) ? "var(--bv-yellow)" : "var(--up)"};">
          ${summaryText}
        </div>
        <div class="u-fs-xs u-mute" style="line-height:1.45;margin-top:3px;">
          Provider no-data and stopped slices are safe to retry. D1/SQLite corruption and access errors are highlighted as hard failures.
        </div>
        ${activeProgressHTML}
      </div>`;

    container.innerHTML = summaryHTML + runs.map(run => {
      const jobState = classifyJobRun(run);
      const statusColor = jobState.tone === "ok" ? "var(--up)"
        : jobState.tone === "warn" ? "var(--warn)"
        : jobState.tone === "danger" ? "var(--bv-red)"
        : "var(--ink-mute)";
      const statusBadge = jobState.tone === "ok" ? "badge--up"
        : jobState.tone === "warn" ? "badge--warn"
        : jobState.tone === "danger" ? "badge--down"
        : "badge--neutral";
      const statusText = jobState.label.toUpperCase();
      const progress = jobProgressSummary(run);

      const dateStr = run.started_at ? new Date(run.started_at.replace(" ", "T") + "Z").toLocaleString() : "Unknown date";
      const details = [];
      if (run.themes_loaded) details.push(`${run.themes_loaded} themes`);
      if (run.error && /Brickset says:\s*success/i.test(String(run.error))) {
        details.push("key valid; rerun backfill");
      } else if (isStoppedRun(run)) {
        details.push("continue with safe batch");
      } else if (run.error && String(run.error).includes('method:valuation')) {
        if (run.sets_skipped) details.push(`${run.sets_skipped} processed`);
        if (run.sets_loaded) details.push(`${run.sets_loaded} updated`);
      } else if (run.error && String(run.error).includes('method:')) {
        if (run.sets_skipped) details.push(`${run.sets_skipped} processed`);
        if (run.sets_loaded) details.push(`${run.sets_loaded} filled`);
        const nextMatch = String(run.error).match(/next_page:(\d+)/);
        if (nextMatch) details.push(`next page ${nextMatch[1]}`);
      } else if (run.sets_loaded) details.push(`${run.sets_loaded} sets`);
      if (run.figs_loaded) details.push(`${run.figs_loaded} figs`);
      if (!(run.error && String(run.error).includes('method:')) && run.sets_skipped) details.push(`${run.sets_skipped} skipped/processed`);
      if (jobState.retryable && !details.length) details.push("safe to retry");
      if (jobState.needsAttention) details.push("check diagnostics");
      if (progress.countText && !details.includes(progress.countText)) details.unshift(progress.countText);
      const updatedText = run.updated_at ? `Updated ${ago(run.updated_at)}` : "";
      const progressHTML = progress.pct != null ? `
        <div style="margin-top:6px;">
          <div class="u-between u-fs-2xs u-mute" style="margin-bottom:4px;">
            <span>${escapeHtml(progress.label)}</span>
            <span>${progress.pct}%</span>
          </div>
          <div style="height:6px;border:1px solid var(--border-soft-c);border-radius:var(--r-full);background:var(--surface-2);overflow:hidden;">
            <div style="height:100%;width:${progress.pct}%;background:${statusColor};transition:width .25s ease;"></div>
          </div>
        </div>
      ` : progress.active ? `
        <div class="u-fs-2xs u-mute" style="margin-top:6px;">${escapeHtml(progress.label)}...</div>
      ` : "";
      const _errTxt = String(run.error || ""); const errorHTML = run.error ? `<div class="u-fs-xs" style="color:${statusColor};margin-top:3px;overflow-wrap:anywhere;">${escapeHtml(_errTxt.length > 300 ? _errTxt.slice(0, 300) + "…" : _errTxt)}</div>` : "";

      return `
        <div style="border-bottom:1px solid var(--border-soft-c);padding-bottom:8px;margin-bottom:4px;">
          <div class="u-between" style="font-weight:600;margin-bottom:2px;">
            <span>Job #${run.id}</span>
            <span class="badge ${statusBadge}" style="max-width:58%;">${escapeHtml(statusText)}</span>
          </div>
          <div class="u-between u-fs-xs u-mute">
            <span>Started: ${dateStr}</span>
            <span>${details.join(", ") || "No items processed"}</span>
          </div>
          ${updatedText ? `<div class="u-fs-2xs u-faint" style="margin-top:2px;">${escapeHtml(updatedText)}</div>` : ""}
          ${progressHTML}
          ${errorHTML}
        </div>
      `;
    }).join("");

    const latestRun = runs[0] || null;
    if (hasRunning && location.hash === "#/me/admin") {
      scheduleAdminJobPoll(2500);
    } else if (adminJobPollTimer) {
      clearTimeout(adminJobPollTimer);
      adminJobPollTimer = null;
    }
    if (!hasRunning && populateEverythingAuto && latestRun?.job_type === "populate_everything") {
      if (isPopulateEverythingComplete(latestRun)) {
        populateEverythingAuto = false;
        toast("All configured data sources are populated", "success");
      } else if (latestState?.needsAttention) {
        populateEverythingAuto = false;
        toast("Populate everything stopped for a hard provider error", "error");
      } else {
        schedulePopulateEverythingContinue();
      }
    }
  } catch (err) {
    setAdminJobButtons(null);
    container.innerHTML = `<div style="color:var(--bv-red);">Failed to load jobs: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateIntegrationsHealth() {
  const container = document.getElementById("integrationsHealthContainer");
  if (!container) return;
  const ago = (ts) => {
    if (!ts) return "never";
    const then = new Date(String(ts).replace(" ", "T") + "Z").getTime();
    const mins = Math.round((Date.now() - then) / 60000);
    if (!Number.isFinite(mins)) return "unknown";
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };
  const statusColor = (status) => status === "ok" ? "var(--up)"
    : status === "degraded" ? "var(--warn)"
    : status === "down" ? "var(--bv-red)"
    : "var(--ink-mute)";
  const statusBadgeClass = (status) => status === "ok" ? "badge--up"
    : status === "degraded" ? "badge--warn"
    : status === "down" ? "badge--down"
    : "badge--neutral";
  const isLatestFailure = (r) => {
    const okAt = r.last_ok_at ? new Date(String(r.last_ok_at).replace(" ", "T") + "Z").getTime() : 0;
    const failAt = r.last_fail_at ? new Date(String(r.last_fail_at).replace(" ", "T") + "Z").getTime() : 0;
    return failAt && failAt >= okAt;
  };
  const statusLabel = (r, standbyFallback = false) => {
    if (standbyFallback) return "Standby fallback";
    const latestFail = isLatestFailure(r);
    if (latestFail && r.service === "ebay" && /OAuth|invalid[_ -]?client/i.test(r.last_error || "")) return "Check keys";
    if (latestFail && r.service === "ebay" && /Marketplace Insights|HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized/i.test(r.last_error || "")) return "Sold comps blocked";
    if (latestFail && /HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized/i.test(r.last_error || "")) return "Needs access";
    if (latestFail && /Too many subrequests|operation was aborted|AbortError|timed out|timeout/i.test(r.last_error || "")) return "Batch limited";
    if (r.status === "unknown") return r.configured ? "Ready / no calls" : "Unconfigured";
    return String(r.status || "unknown").replace("_", " ");
  };
  try {
    const data = await api("/api/admin/integrations");
    const rows = data.integrations || [];
    const bricksetRow = rows.find(r => r.service === "brickset");
    const bricksetCoversBarcodes = !!bricksetRow?.configured && bricksetRow.status !== "down";
    const isBrickOwlStandby = (r) => r.service === "brickowl"
      && bricksetCoversBarcodes
      && /HTTP 401|HTTP 403|access denied|not authorized/i.test(r.last_error || "");
    const coverage = data.coverage || {};
    const quality = coverage.quality || {};
    const routing = data.api_routing || {};
    const totalSets = Number(coverage.total_sets || 0);
    const formatCoverage = (count, pct, denom = totalSets) => {
      const n = Number(count || 0);
      const d = Number(denom || 0);
      if (!d) return "No catalog";
      if (!n) return `No rows yet (0/${d.toLocaleString()})`;
      const displayPct = Number(pct || 0);
      const pctLabel = displayPct > 0 ? `${displayPct}%` : "<0.1%";
      return `${pctLabel} (${n.toLocaleString()}/${d.toLocaleString()})`;
    };
    const bricklinkCount = coverage.sets_with_bricklink ?? coverage.sets_with_bricklink_new ?? 0;
    const coverageRows = [
      ["Catalog sets", Number(coverage.total_sets || 0).toLocaleString()],
      ["Stale values", Number(coverage.stale_values || 0).toLocaleString()],
      ["Expired values", Number(coverage.expired_values || 0).toLocaleString()],
      ["Missing values", Number(coverage.missing_values || 0).toLocaleString()],
      ["Missing MSRP", Number(quality.missing_msrp || 0).toLocaleString()],
      ["Missing UPC (retail)", Number(Math.max(0, (coverage.barcode_retail_total || 0) - (coverage.barcode_retail_with_upc || 0))).toLocaleString()],
      ["Old active sets", Number(quality.old_active_sets || 0).toLocaleString()],
      ["Low-confidence values", Number(quality.low_confidence_values || 0).toLocaleString()],
      ["Barcode coverage (retail)", formatCoverage(coverage.barcode_retail_with_upc, coverage.barcode_coverage_pct, coverage.barcode_retail_total)],
      ["BrickLink coverage", formatCoverage(bricklinkCount, coverage.bricklink_coverage_pct)],
      ["eBay new sold", formatCoverage(coverage.sets_with_ebay_new, coverage.ebay_new_coverage_pct)],
      ["eBay used sold", formatCoverage(coverage.sets_with_ebay_used, coverage.ebay_used_coverage_pct)],
    ];
    const coverageNote = "Coverage tracks populated catalog fields. Barcode/UPC coverage is measured over scannable retail sets — it excludes Gear, books, parts packs, education and store/vintage items that have no retail barcode. BrickLink and eBay are split into new and used market data; daily safe batches advance barcode and price coverage automatically.";
    const routingHTML = `
      <div style="border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);padding:10px 12px;background:var(--surface-2);margin-bottom:10px;">
        <div class="u-mono-label u-fs-2xs" style="margin-bottom:6px;">API routing</div>
        <div class="u-fs-xs" style="color:var(--ink-soft);line-height:1.45;word-break:break-all;">
          Worker: ${escapeHtml(routing.worker_base_url || window.WORKER_BASE || "unknown")}<br>
          Config: ${escapeHtml(routing.config_endpoint || "")}
        </div>
      </div>`;
    const bh = coverage.barcode_health || null;
    const bhOk = bh && bh.last_ok_at && (!bh.last_fail_at || bh.last_ok_at >= bh.last_fail_at);
    const bhColor = !bh ? "var(--ink-mute)" : bhOk ? "var(--up)" : "var(--bv-yellow)";
    const bhWhen = bh && bh.updated_at ? ago(bh.updated_at) : null;
    const barcodeHealthHTML = bh ? `
        <div class="u-fs-2xs" style="line-height:1.4;margin-top:8px;display:flex;align-items:flex-start;gap:6px;color:var(--ink-soft);">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${bhColor};margin-top:3px;flex-shrink:0;"></span>
          <span><strong>Barcode backfill:</strong> ${escapeHtml(bh.last_error || "no run recorded yet")}${bhWhen ? ` · ${escapeHtml(bhWhen)}` : ""}</span>
        </div>` : "";
    const coverageHTML = `
      <div style="border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);padding:10px 12px;background:var(--surface-2);margin-bottom:10px;">
        <div class="u-mono-label u-fs-2xs" style="margin-bottom:8px;">Data coverage</div>
        <div class="adm-cov-grid">
          ${coverageRows.map(([label, value]) => `
            <div class="adm-cov-cell">
              <div class="adm-cov-lbl">${escapeHtml(label)}</div>
              <div class="adm-cov-val">${escapeHtml(value)}</div>
            </div>
          `).join("")}
        </div>
        ${barcodeHealthHTML}
        <div class="u-fs-2xs u-mute" style="line-height:1.4;margin-top:8px;">${escapeHtml(coverageNote)}</div>
      </div>`;
    const bq = coverage.blend_quality || {};
    const fresh = bq.freshness_30d || {};
    const conf = bq.confidence || {};
    const n = (v) => Number(v || 0).toLocaleString();
    const blendRows = [
      ["Multi-source (2+)", formatCoverage(bq.multi_source, bq.multi_source_pct)],
      ["Source mix 0/1/2/3+", `${n(bq.src0)} / ${n(bq.src1)} / ${n(bq.src2)} / ${n(bq.src3plus)}`],
      ["Blended populated", formatCoverage(bq.blended_count, bq.blended_coverage_pct)],
      ["Diverged from formula", n(bq.blended_diverged)],
      ["BrickOwl coverage", formatCoverage(bq.sets_with_brickowl, bq.brickowl_coverage_pct)],
      ["eBay asking coverage", formatCoverage(bq.sets_with_ebay_ask, bq.ebay_ask_coverage_pct)],
      ["BrickInsights ratings", formatCoverage(bq.sets_with_brickinsights, bq.brickinsights_rating_coverage_pct)],
      ["Fresh <30d BL/eBay/BE/BO", `${n(fresh.bricklink)} / ${n(fresh.ebay_sold)} / ${n(fresh.brickeconomy)} / ${n(fresh.brickowl)}`],
      ["Confidence H/M/L/est", `${n(conf.high)} / ${n(conf.medium)} / ${n(conf.low)} / ${n(conf.estimated)}`],
    ];
    const blendNote = "Valuation-v2 blend quality. The blend diverges from formula when a set has 2+ fresh sources; two fresh SOLD sources reach high confidence. Active sources: BrickLink, BrickEconomy (scraped via Firecrawl), eBay ask, and eBay sold comps (Firecrawl structured extraction, corroborating). BrickOwl is disabled (no provider access). BrickInsights ratings are a non-price quality signal.";
    const blendHTML = Object.keys(bq).length ? `
      <div style="border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);padding:10px 12px;background:var(--surface-2);margin-bottom:10px;">
        <div class="u-mono-label u-fs-2xs" style="margin-bottom:8px;">Blend quality</div>
        <div class="adm-cov-grid">
          ${blendRows.map(([label, value]) => `
            <div class="adm-cov-cell">
              <div class="adm-cov-lbl">${escapeHtml(label)}</div>
              <div class="adm-cov-val">${escapeHtml(value)}</div>
            </div>
          `).join("")}
        </div>
        <div class="u-fs-2xs u-mute" style="line-height:1.4;margin-top:8px;">${escapeHtml(blendNote)}</div>
      </div>` : "";
    // AI spend (server-key only) — Phase 3 #3/#4. The $1/day AI Gateway cap is the
    // ceiling; BYOK calls don't count. Status warns at 50% of the daily budget.
    const ai = data.ai_usage || {};
    const spend = ai.spend || {};
    const aiByModel = Array.isArray(ai.by_model) ? ai.by_model : [];
    const usd = (v) => {
      const num = Number(v || 0);
      return `$${num.toFixed(num >= 1 ? 2 : 4)}`;
    };
    const spendDotColor = spend.status === "over" ? "var(--bv-red)"
      : spend.status === "warn" ? "var(--warn)"
      : "var(--up)";
    const spendBadgeClass = spend.status === "over" ? "badge--down"
      : spend.status === "warn" ? "badge--warn"
      : "badge--up";
    const aiModelRows = aiByModel.map(m => [
      `${m.provider} · ${m.model}`,
      `${Number(m.calls || 0).toLocaleString()} call${Number(m.calls || 0) === 1 ? "" : "s"} · ${m.free ? "free" : usd(m.cost_usd)}`,
    ]);
    const aiUsageNote = "Server-key AI spend only — the $1/day AI Gateway cap is the ceiling. BYOK scans/advisor run on the user's own key and never count here. Free models cost $0; the paid fallback (DeepSeek/gpt-4o-mini) is the backstop. Status warns at 50% of the daily budget.";
    const aiUsageHTML = `
      <div style="border:var(--bw-thin) solid var(--border-soft-c);border-radius:var(--r-2);padding:10px 12px;background:var(--surface-2);margin-bottom:10px;">
        <div class="u-between u-gap-3" style="margin-bottom:8px;">
          <div class="u-mono-label u-fs-2xs">AI spend (today)</div>
          <span class="badge ${spendBadgeClass}" style="text-transform:uppercase;">${escapeHtml(usd(spend.total_usd))} / ${escapeHtml(usd(spend.budget_usd || 1))}${spend.pct != null ? ` · ${escapeHtml(String(spend.pct))}%` : ""}</span>
        </div>
        <div class="u-fs-xs u-mute" style="margin-bottom:8px;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${spendDotColor};margin-right:6px;"></span>
          ${Number(spend.free_calls || 0).toLocaleString()} free call${Number(spend.free_calls || 0) === 1 ? "" : "s"} · ${Number(spend.paid_calls || 0).toLocaleString()} paid call${Number(spend.paid_calls || 0) === 1 ? "" : "s"} today
        </div>
        ${aiModelRows.length ? `<div class="adm-cov-grid">
          ${aiModelRows.map(([label, value]) => `
            <div class="adm-cov-cell">
              <div class="adm-cov-lbl">${escapeHtml(label)}</div>
              <div class="adm-cov-val">${escapeHtml(value)}</div>
            </div>
          `).join("")}
        </div>` : `<div class="u-fs-xs u-mute">No server-key AI calls recorded today.</div>`}
        <div class="u-fs-2xs u-mute" style="line-height:1.4;margin-top:8px;">${escapeHtml(aiUsageNote)}</div>
      </div>`;
    const integrationsHTML = rows.map(r => {
      const standbyFallback = isBrickOwlStandby(r);
      const color = standbyFallback ? statusColor("unknown") : statusColor(r.status);
      const hasAttempts = Number(r.ok_count || 0) + Number(r.fail_count || 0) > 0;
      const latestFail = isLatestFailure(r);
      const isEbayAccessBlocked = latestFail && r.service === "ebay"
        && /Marketplace Insights|HTTP 401|HTTP 403|access denied|insufficient permissions|invalid[_ -]?scope|not authorized|OAuth|invalid[_ -]?client/i.test(r.last_error || "");
      const timingText = standbyFallback ? "Brickset barcode backfill active" : hasAttempts
        ? latestFail ? `OK ${ago(r.last_ok_at)} / Fail ${ago(r.last_fail_at)}` : `Last OK ${ago(r.last_ok_at)}`
        : "No recent calls logged";
      const countText = standbyFallback ? "Not used" : hasAttempts
        ? isEbayAccessBlocked
          ? `${r.fail_count || 0} blocked call${Number(r.fail_count || 0) === 1 ? "" : "s"}`
          : latestFail ? `${r.ok_count || 0} ok / ${r.fail_count || 0} fail` : `${r.ok_count || 0} ok / ${r.fail_count || 0} past fail`
        : "Ready when used";
      const usedByText = standbyFallback
        ? "optional barcode fallback; not used while Brickset is available"
        : ((r.used_by || []).join(", ") || r.notes || "");
      const actionText = standbyFallback ? "" : (r.recommended_action || "");
      const missingSecrets = Array.isArray(r.missing_secrets) && r.missing_secrets.length
        ? `Missing secrets: ${r.missing_secrets.join(", ")}`
        : "";
      return `
        <div style="border-bottom:1px solid var(--border-soft-c);padding-bottom:8px;margin-bottom:4px;">
          <div class="u-between u-gap-3" style="font-weight:600;margin-bottom:2px;">
            <span style="min-width:0;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;"></span>${escapeHtml(r.label || r.service)}</span>
            <span class="badge ${standbyFallback ? "badge--neutral" : statusBadgeClass(r.status)}" style="text-transform:uppercase;">${escapeHtml(statusLabel(r, standbyFallback))}</span>
          </div>
          <div class="u-between u-gap-3 u-fs-xs u-mute">
            <span>${escapeHtml(timingText)}</span>
            <span>${escapeHtml(countText)}</span>
          </div>
          <div class="u-fs-xs u-mute" style="margin-top:2px;">${escapeHtml(usedByText)}</div>
          ${missingSecrets ? `<div class="u-fs-xs" style="color:var(--bv-red);margin-top:2px;">${escapeHtml(missingSecrets)}</div>` : ""}
          ${actionText ? `<div class="u-fs-xs" style="color:var(--ink-soft);margin-top:2px;">Action: ${escapeHtml(actionText)}</div>` : ""}
          ${!standbyFallback && latestFail && r.last_error && (r.status === "down" || r.status === "degraded") ? `<div class="u-fs-xs" style="color:${color};margin-top:2px;">${escapeHtml(r.last_error)}</div>` : ""}
        </div>
      `;
    }).join("");
    container.innerHTML = routingHTML + coverageHTML + blendHTML + aiUsageHTML + (integrationsHTML || `<div class="u-mute">No integration diagnostics available.</div>`);
  } catch (err) {
    container.innerHTML = `<div style="color:var(--bv-red);">Failed to load integrations: ${escapeHtml(err.message)}</div>`;
  }
}
