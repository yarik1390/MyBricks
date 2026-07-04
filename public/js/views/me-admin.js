import { $, haptic, escapeHtml, toast } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
import { ADMIN_SECTIONS, ADMIN_JOB_TOOLS, MAINTENANCE_TOOLS, SOURCE_META, PROVIDER_GROUPS, SERVICE_FLAG, FLAG_LABEL, TESTABLE, TUNABLE_SOURCES, SERVICE_DESC, UUID_RE } from './me-admin-config.js';
import {
  classifyJobRun,
  jobProgressSummary,
  groupAdminJobRuns,
  classifyProviderHealth,
  validateSourceTuningInput,
  formatRelativeTime,
  processRunBadge,
} from '../lib/pure.js';
import { go } from '../router.js';
import { subpageTopbarHTML, loadMe } from './me-shared.js';
import { skelPage, skelSettingRows } from '../components/skeleton.js';

let activeAdminRunId = null;
let activeAdminTool = null;
let adminJobPollTimer = null;
let populateEverythingAuto = false;
let populateEverythingContinueTimer = null;
let showAllJobs = false;
let contributionTab = 'all';

let adminRuns = [];
let adminHealth = null;
let contributionData = null;
let supporterData = null;
let sourceDefaults = {};
let sourceConfig = {};
let activityData = null;
let activityPollTimer = null;
let featureFlags = { flags: [], overrides: {}, effective: {} };
// Active Services tab: 'attention' (triage across all categories) or a
// PROVIDER_GROUPS category label ('Core', 'Pricing', …). Category-per-tab keeps
// the mobile view short — one category on screen at a time.
let serviceTab = 'attention';


export async function renderMeAdmin() {
  if (!state.me) $('#root').innerHTML = skelPage(skelSettingRows(6));
  const me = await loadMe();
  if (!me?.is_admin) { go('#/me'); return; }

  $('#root').innerHTML = `
    <div class="page admin-page admin-dashboard-page">
      ${subpageTopbarHTML('Admin console', 'Admin')}
      <nav class="admin-segments admin-segments-sticky" role="tablist" aria-label="Admin sections">
        ${ADMIN_SECTIONS.map(([id, label], i) => `<button type="button" role="tab" aria-selected="${i === 0}" aria-controls="${id}" class="${i === 0 ? 'active' : ''}" data-admin-section-link="${id}">${escapeHtml(label)}</button>`).join('')}
      </nav>

      <section class="admin-section" id="adminServices">
        <h2 class="section-title">Services</h2>
        <p class="admin-section-intro">Pick a category tab to see just those services. Tap any service for its status, usage, and controls — test it, flip capabilities on or off, and tune pricing, all without touching code.</p>
        <div class="admin-service-filters" role="tablist" aria-label="Service categories">
          ${serviceTabs().map(([id, label]) => serviceTabButtonHTML(id, label)).join('')}
        </div>
        <div id="servicesContainer" class="admin-service-wrap" aria-live="polite">Loading services...</div>
      </section>

      <section class="admin-section" id="adminPopulate">
        <h2 class="section-title">Populate</h2>
        ${populateSectionHTML()}
      </section>

      <section class="admin-section" id="adminJobs">
        <h2 class="section-title">Activity</h2>
        <p class="admin-section-intro">Every background process and admin job, updated live while this page is open. Each row shows what it does, when it last ran, and the result.</p>
        <div id="jobsStatusContainer" class="admin-panel" aria-live="polite">Loading jobs...</div>
        <div id="processesContainer" class="admin-process-wrap" aria-live="polite">Loading processes...</div>
      </section>

      <section class="admin-section" id="adminQuality">
        <h2 class="section-title">Catalog Quality</h2>
        <div id="qualityContainer" class="admin-panel">Loading coverage...</div>
      </section>

      <section class="admin-section" id="adminUsers">
        <h2 class="section-title">Users</h2>
        <div class="admin-panel admin-user-panel">
          <label class="admin-field">
            <span>User ID</span>
            <input id="supporterUserIdInput" class="input" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false">
            <small>Paste the Supabase user UUID. This changes supporter status for exactly that account.</small>
          </label>
          <div class="admin-user-actions">
            <button class="btn-primary" id="grantSupporterBtn">${I.star()}<span>Grant supporter</span></button>
            <button class="btn-secondary" id="revokeSupporterBtn">${I.minus()}<span>Revoke</span></button>
          </div>
          <div class="admin-user-search">
            <label class="admin-field">
              <span>Find a user</span>
              <input id="adminUserSearchInput" class="input" placeholder="Handle, email, or user ID" autocomplete="off">
              <small>Search helps confirm the UUID before changing supporter status.</small>
            </label>
            <button class="btn-secondary" id="adminUserSearchBtn">${I.search()}<span>Search</span></button>
          </div>
          <div id="adminUserSearchResults" class="admin-search-results"></div>
          <div id="supporterResult" class="admin-status-panel" hidden></div>
          <div class="admin-supporters">
            <div class="admin-supporters-head">
              <div>
                <strong>Current supporters</strong>
                <span>Live accounts with supporter access enabled.</span>
              </div>
              <button class="btn-secondary" id="refreshSupportersBtn">${I.refresh({ w: 16 })}<span>Refresh</span></button>
            </div>
            <div id="supportersList" class="admin-supporter-list">Loading supporters...</div>
          </div>
        </div>
      </section>

      <section class="admin-section" id="adminContrib">
        <h2 class="section-title">Contributions <span id="contribCount" class="contrib-count"></span></h2>
        <div class="admin-panel">
          <div class="admin-contrib-tabs" role="tablist" aria-label="Contribution type">
            ${contribTabButtonHTML('all', 'All')}
            ${contribTabButtonHTML('review', 'Reviews')}
            ${contribTabButtonHTML('photo', 'Photos')}
            ${contribTabButtonHTML('data', 'Data fixes')}
          </div>
          <div id="contribQueue">Loading queue...</div>
        </div>
      </section>

      <section class="admin-section" id="adminTools">
        <h2 class="section-title">Tools</h2>
        <div class="admin-panel">
          <div class="admin-supporters-head">
            <div>
              <strong>Onboarding wizard</strong>
              <span>Replay the first-run setup (mode, appearance, extras, Pro) to review it.</span>
            </div>
            <button class="btn-secondary" id="previewSetupBtn">${I.sparkles({ w: 16 })}<span>Preview</span></button>
          </div>
          <div class="admin-supporters-head" style="margin-top:10px;">
            <div>
              <strong>Guided tour</strong>
              <span>Replay the coach-mark tour that spotlights the nav.</span>
            </div>
            <button class="btn-secondary" id="previewTourBtn">${I.info({ w: 16 })}<span>Preview</span></button>
          </div>
        </div>
      </section>
    </div>`;

  wireAdminShell();
  updateJobsStatus();
  loadActivity();
  updateIntegrationsHealth();
  loadFeatureFlags();
  loadSourceTuning();
  loadContribQueue();
  loadSupporters();
}

function populateSectionHTML() {
  return `
    <div class="admin-populate-primary">
      <div class="admin-populate-copy">
        <div class="section-kicker">Recommended</div>
        <h3>Populate all safe sources</h3>
        <p>Runs small protected slices against every configured and reachable provider. Blocked eBay sold comps stay unavailable instead of falling back to weak data.</p>
        <div class="admin-fill-list">
          <span>Rebrickable catalog</span>
          <span>Brickset/UPC barcodes</span>
          <span>BrickLink values</span>
          <span>BrickEconomy values</span>
          <span>eBay asking data</span>
          <span>Approved eBay sold comps</span>
        </div>
      </div>
      <button class="btn-primary admin-primary-action" data-admin-tool="everything">${I.refresh()}<span>Run safe slice</span></button>
    </div>
    <p class="admin-section-note">To run one job on its own — catalog imports, PriceCharting bulk, pricesAPI, or the eBay sold-comps scrape — use its <strong>Run now</strong> button on the Activity tab, where you can also watch it finish.</p>
    <div class="admin-tool-grid">
      ${maintenanceCardHTML('expire')}
      ${maintenanceCardHTML('repair')}
    </div>
    <article class="admin-tool-card admin-upload-card">
      <div class="admin-tool-icon">${I.download()}</div>
      <div>
        <h3>Import BrickLink minifig catalog</h3>
        <p class="admin-tool-desc">Upload BrickLink's Minifigures export (the tab-separated file) to map minifig IDs so BrickLink minifig prices resolve.</p>
        <small id="blMinifigUploadResult">Choose the exported Minifigures file (tab format).</small>
      </div>
      <label class="btn-secondary admin-upload-btn">
        ${I.upload ? I.upload({ w: 16 }) : I.download({ w: 16 })}<span>Upload</span>
        <input type="file" id="blMinifigFile" accept=".txt,.xml,.tsv,.csv,text/plain,text/xml,text/tab-separated-values" hidden>
      </label>
    </article>`;
}

function maintenanceCardHTML(key) {
  const tool = MAINTENANCE_TOOLS[key];
  return `
    <article class="admin-tool-card admin-tool-card-muted">
      <div class="admin-tool-icon">${I.gear()}</div>
      <div>
        <h3>${escapeHtml(tool.label)}</h3>
        ${tool.desc ? `<p class="admin-tool-desc">${escapeHtml(tool.desc)}</p>` : ''}
        <small>High-impact · confirmation required before running.</small>
      </div>
      <button class="icon-btn admin-tool-run" data-maint-tool="${escapeHtml(key)}" aria-label="${escapeHtml(tool.label)}">${I.arrowR({ w: 16 })}</button>
    </article>`;
}

function wireAdminShell() {
  document.querySelectorAll('.admin-section').forEach(s => s.setAttribute('role', 'tabpanel'));
  document.querySelectorAll('[data-admin-section-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-admin-section-link');
      if (!id || !document.getElementById(id)) return;
      haptic('light');
      activateAdminSection(id);
    });
  });
  document.querySelectorAll('[data-admin-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-admin-tool');
      // Synchronous jobs return their result inline (no run_id / progress polling).
      if (tool === 'ebaySold') return triggerSyncJob(tool);
      triggerImport(tool);
    });
  });
  $('#blMinifigFile')?.addEventListener('change', (e) => importBlMinifigCatalog(e.target));
  document.querySelectorAll('[data-maint-tool]').forEach(btn => {
    btn.addEventListener('click', () => triggerMaintenance(btn.getAttribute('data-maint-tool')));
  });
  document.querySelectorAll('[data-service-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      serviceTab = btn.getAttribute('data-service-tab') || 'attention';
      renderServiceFilters();
      renderServices();
    });
  });
  const servicesEl = document.getElementById('servicesContainer');
  if (servicesEl) {
    servicesEl.addEventListener('click', (e) => {
      const testBtn = e.target.closest('[data-svc-test]');
      if (testBtn) { runServiceProbe(testBtn.getAttribute('data-svc-test'), testBtn); return; }
      const saveBtn = e.target.closest('[data-svc-save]');
      if (saveBtn) { saveServiceTuning(saveBtn.getAttribute('data-svc-save'), saveBtn); return; }
      const resetBtn = e.target.closest('[data-svc-reset]');
      if (resetBtn) { resetPricingDefaults(resetBtn); }
    });
    servicesEl.addEventListener('change', (e) => {
      const flagInput = e.target.closest('[data-svc-flag]');
      if (flagInput) toggleServiceFlag(flagInput.getAttribute('data-svc-flag'), flagInput.checked, flagInput);
    });
  }
  const processesEl = document.getElementById('processesContainer');
  processesEl?.addEventListener('click', (e) => {
    const runBtn = e.target.closest('[data-process-run]');
    if (runBtn) runProcess(runBtn.getAttribute('data-process-run'), runBtn);
  });
  document.querySelectorAll('[data-contrib-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      contributionTab = btn.getAttribute('data-contrib-tab') || 'all';
      renderContribQueue();
    });
  });
  $('#previewSetupBtn')?.addEventListener('click', async () => {
    haptic('light');
    try { (await import('../components/onboarding.js')).showSetup(); }
    catch { toast('Could not open onboarding', 'error'); }
  });
  $('#previewTourBtn')?.addEventListener('click', async () => {
    haptic('light');
    try { (await import('../components/onboarding.js')).startOnboarding(); }
    catch { toast('Could not open tour', 'error'); }
  });
  $('#grantSupporterBtn')?.addEventListener('click', () => setSupporterStatus(1));
  $('#revokeSupporterBtn')?.addEventListener('click', () => setSupporterStatus(0));
  $('#adminUserSearchBtn')?.addEventListener('click', searchUsers);
  $('#refreshSupportersBtn')?.addEventListener('click', loadSupporters);
  $('#adminUserSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers();
  });
  syncAdminNavOffset();
  requestAnimationFrame(syncAdminNavOffset);
  window.removeEventListener('resize', syncAdminNavOffset);
  window.addEventListener('resize', syncAdminNavOffset);
  activateAdminSection(ADMIN_SECTIONS[0][0]);
}

// Measure the sticky tab-nav's height into a CSS var so the Services category
// bar can stick exactly beneath it (stacked sticky offsets). Recomputed on
// resize / orientation change.
function syncAdminNavOffset() {
  const nav = document.querySelector('.admin-segments-sticky');
  const page = document.querySelector('.admin-dashboard-page');
  if (!nav || !page) return;
  page.style.setProperty('--admin-seg-h', `${Math.round(nav.getBoundingClientRect().height)}px`);
}

// Tab view: show only the active section, sync the sticky nav (highlight +
// reveal the active chip in the horizontal strip), and reset scroll to the top
// — so switching tabs feels like a native segmented view instead of a long scroll.
function activateAdminSection(id) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.toggle('is-active', s.id === id));
  let activeBtn = null;
  document.querySelectorAll('[data-admin-section-link]').forEach(b => {
    const on = b.getAttribute('data-admin-section-link') === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) activeBtn = b;
  });
  const nav = document.querySelector('.admin-segments-sticky');
  if (nav && activeBtn) {
    const btnRect = activeBtn.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    const delta = (btnRect.left + btnRect.width / 2) - (navRect.left + navRect.width / 2);
    if (Math.abs(delta) > 1) nav.scrollBy({ left: delta, behavior: 'smooth' });
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function contribTabButtonHTML(id, label) {
  return `<button class="chip ${contributionTab === id ? 'active' : ''}" data-contrib-tab="${escapeHtml(id)}" role="tab" aria-selected="${contributionTab === id}">${escapeHtml(label)}</button>`;
}

function adminToolFromJobType(jobType = '') {
  if (jobType === 'catalog_sets' || jobType === 'catalog_all') return 'sets';
  if (jobType === 'catalog_figs') return 'figs';
  if (jobType === 'barcode_backfill') return 'upc';
  if (jobType === 'populate_coverage') return 'populate';
  if (jobType === 'valuation') return 'revalue';
  if (jobType === 'populate_everything') return 'everything';
  return null;
}

function setAdminJobButtons(runningType = null) {
  document.querySelectorAll('[data-admin-tool]').forEach(btn => {
    const key = btn.getAttribute('data-admin-tool');
    const busy = !!runningType;
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy && key === runningType ? 'true' : 'false');
  });
}

function scheduleAdminJobPoll(delay = 2500) {
  if (adminJobPollTimer) clearTimeout(adminJobPollTimer);
  if (location.hash !== '#/me/admin') return;
  adminJobPollTimer = setTimeout(() => {
    adminJobPollTimer = null;
    updateJobsStatus();
  }, delay);
}

function isPopulateEverythingComplete(run = {}) {
  return run.job_type === 'populate_everything' && /method:populate-everything\b[\s\S]*complete:true/i.test(String(run.error || ''));
}

function schedulePopulateEverythingContinue(delay = 1400) {
  if (populateEverythingContinueTimer) clearTimeout(populateEverythingContinueTimer);
  if (!populateEverythingAuto || location.hash !== '#/me/admin') return;
  populateEverythingContinueTimer = setTimeout(() => {
    populateEverythingContinueTimer = null;
    if (populateEverythingAuto && !activeAdminRunId) triggerImport('everything');
  }, delay);
}

// Run a synchronous admin job (returns its result inline rather than a tracked
// run_id). Shows a running state on the button, then toasts the result summary
// and refreshes the integrations panel so e.g. the Bright Data row updates.
async function triggerSyncJob(type) {
  const cnf = ADMIN_JOB_TOOLS[type];
  if (!cnf) return;
  if (cnf.confirm && !window.confirm(cnf.confirm)) return;
  const btns = [...document.querySelectorAll(`[data-admin-tool="${type}"]`)];
  btns.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
  haptic('medium');
  toast(`${cnf.label}: running…`, 'info');
  try {
    const r = await api(cnf.url, { method: cnf.method, body: cnf.body });
    const summary = r.skipped
      ? `skipped — ${r.skipped}`
      : `processed ${r.processed ?? 0}, updated ${r.updated ?? 0}, rejected ${r.rejected ?? 0}`;
    toast(`${cnf.label}: ${summary}`, (r.updated > 0 || r.skipped) ? 'success' : 'info');
    await updateIntegrationsHealth();
  } catch (e) {
    toast(`${cnf.label} failed: ${e.message || e}`, 'error');
  } finally {
    btns.forEach(b => { b.disabled = false; b.setAttribute('aria-busy', 'false'); });
  }
}

async function triggerImport(type, { single = false } = {}) {
  const cnf = ADMIN_JOB_TOOLS[type];
  if (!cnf) return;
  if (cnf.confirm && !window.confirm(cnf.confirm)) return;
  if (activeAdminRunId) {
    toast('A catalog job is already running', 'info');
    scheduleAdminJobPoll(500);
    return;
  }
  populateEverythingAuto = type === 'everything' && !single;
  haptic('medium');
  setAdminJobButtons(type);
  try {
    const r = await api(cnf.url, { method: cnf.method, body: cnf.body });
    activeAdminRunId = r.run_id || null;
    activeAdminTool = type;
    if (type === 'everything' && r.done) populateEverythingAuto = false;
    toast(r.message || `Job #${activeAdminRunId || ''} started`, 'success');
    await updateJobsStatus();
    loadActivity();
    scheduleAdminJobPoll(1200);
  } catch (e) {
    toast('Job failed: ' + (e.message || e), 'error');
    activeAdminRunId = null;
    activeAdminTool = null;
    populateEverythingAuto = false;
    setAdminJobButtons(null);
  }
}

async function triggerMaintenance(type) {
  const tool = MAINTENANCE_TOOLS[type];
  if (!tool || !window.confirm(tool.confirm)) return;
  try {
    const res = await api(tool.url, { method: tool.method });
    toast(res.message || `${tool.label} complete`, 'success');
    await updateIntegrationsHealth();
  } catch (e) {
    toast(`${tool.label} failed: ${e.message || e}`, 'error');
  }
}

// Upload BrickLink's Minifigures catalog export (tab file) so minifig pricing can
// resolve Rebrickable figs to BrickLink ids. Sends the file body verbatim.
async function importBlMinifigCatalog(input) {
  const file = input?.files?.[0];
  const out = $('#blMinifigUploadResult');
  if (!file) return;
  if (out) out.textContent = `Uploading ${file.name}…`;
  try {
    const text = await file.text();
    const r = await api('/api/admin/import-bricklink-minifigs', { method: 'POST', rawBody: text });
    if (out) out.textContent = `Imported ${Number(r.inserted ?? 0).toLocaleString()} of ${Number(r.parsed ?? 0).toLocaleString()} minifigs. They map to prices as they're valued.`;
    toast(`BrickLink minifig catalog: ${Number(r.inserted ?? 0).toLocaleString()} imported`, 'success');
  } catch (e) {
    if (out) out.textContent = `Failed: ${e.message || e}`;
    toast(`Catalog upload failed: ${e.message || e}`, 'error');
  } finally {
    input.value = '';
  }
}

async function updateJobsStatus() {
  const container = $('#jobsStatusContainer');
  if (!container) return;
  try {
    const data = await api('/api/admin/import-status');
    adminRuns = data.runs || [];
    const classified = adminRuns.map(run => ({ run, state: classifyJobRun(run) }));
    const runningRun = classified.find(x => x.state.label === 'Running')?.run || null;
    if (runningRun) {
      activeAdminRunId = runningRun.id;
      activeAdminTool = adminToolFromJobType(runningRun.job_type) || activeAdminTool;
    } else {
      activeAdminRunId = null;
      activeAdminTool = null;
    }
    setAdminJobButtons(activeAdminTool || (runningRun ? 'active' : null));
    renderJobs(container);

    if (runningRun && location.hash === '#/me/admin') {
      scheduleAdminJobPoll(2500);
    } else if (adminJobPollTimer) {
      clearTimeout(adminJobPollTimer);
      adminJobPollTimer = null;
    }

    const latestRun = adminRuns[0] || null;
    const latestState = latestRun ? classifyJobRun(latestRun) : null;
    if (!runningRun && populateEverythingAuto && latestRun?.job_type === 'populate_everything') {
      if (isPopulateEverythingComplete(latestRun)) {
        populateEverythingAuto = false;
        toast('All configured data sources are populated', 'success');
      } else if (latestState?.needsAttention) {
        populateEverythingAuto = false;
        toast('Populate everything stopped for a hard provider error', 'error');
      } else {
        schedulePopulateEverythingContinue();
      }
    }
  } catch (err) {
    setAdminJobButtons(null);
    container.innerHTML = errorPanelHTML('Failed to load jobs', err.message || String(err), 'Retry');
    $('#adminErrorRetry')?.addEventListener('click', updateJobsStatus);
  }
}

async function loadActivity() {
  if (location.hash !== '#/me/admin') return;
  try {
    activityData = await api('/api/admin/activity');
    renderProcesses();
  } catch (err) {
    const c = $('#processesContainer');
    if (c) {
      c.innerHTML = errorPanelHTML('Failed to load processes', err.message || String(err), 'Retry');
      $('#adminErrorRetry')?.addEventListener('click', loadActivity);
    }
  } finally {
    scheduleActivityPoll();
  }
}

function scheduleActivityPoll() {
  if (activityPollTimer) { clearTimeout(activityPollTimer); activityPollTimer = null; }
  if (location.hash !== '#/me/admin') return;
  const anyRunning = (activityData?.processes || []).some(p => p.status === 'running') || !!activeAdminRunId;
  const delay = document.hidden ? 30000 : (anyRunning ? 3000 : 8000);
  activityPollTimer = setTimeout(loadActivity, delay);
}

function renderProcesses() {
  const c = $('#processesContainer');
  if (!c || !activityData) return;
  const procs = activityData.processes || [];
  const order = activityData.group_order || [];
  const counts = { ok: 0, failed: 0, running: 0, idle: 0 };
  for (const p of procs) counts[p.status === 'ok' ? 'ok' : p.status === 'failed' ? 'failed' : p.status === 'running' ? 'running' : 'idle']++;
  const byGroup = new Map();
  for (const p of procs) {
    if (!byGroup.has(p.group)) byGroup.set(p.group, []);
    byGroup.get(p.group).push(p);
  }
  const groups = order.filter(g => byGroup.has(g));
  // Preserve which groups the admin expanded across the live re-render poll. On
  // first paint (no groups in the DOM yet), open only groups that have a running
  // or failed process so problems surface without expanding everything.
  const existing = c.querySelectorAll('details.admin-process-group');
  const firstPaint = existing.length === 0;
  const openGroups = new Set(Array.from(existing).filter(d => d.open).map(d => d.getAttribute('data-group')));
  c.innerHTML = `
    <div class="admin-activity-summary">
      ${counts.running ? `<span class="admin-pill admin-pill--running">${counts.running} running</span>` : ''}
      <span class="admin-pill admin-pill--ok">${counts.ok} healthy</span>
      ${counts.failed ? `<span class="admin-pill admin-pill--danger">${counts.failed} failed</span>` : ''}
      ${counts.idle ? `<span class="admin-pill admin-pill--idle">${counts.idle} not yet run</span>` : ''}
    </div>
    ${groups.map(g => {
      const items = byGroup.get(g);
      const gRunning = items.filter(p => p.status === 'running').length;
      const gFailed = items.filter(p => p.status === 'failed').length;
      const open = firstPaint ? (gRunning > 0 || gFailed > 0) : openGroups.has(g);
      const meta = [gRunning ? `${gRunning} running` : '', gFailed ? `${gFailed} failed` : '']
        .filter(Boolean).join(' · ') || `${items.length}`;
      const metaTone = gFailed ? ' is-error' : gRunning ? ' is-running' : '';
      return `
      <details class="admin-process-group" data-group="${escapeHtml(g)}"${open ? ' open' : ''}>
        <summary class="admin-process-group-title">
          <span>${escapeHtml(g)}</span>
          <span class="admin-process-group-count${metaTone}">${escapeHtml(meta)}</span>
        </summary>
        <div class="admin-process-list">${items.map(processRowHTML).join('')}</div>
      </details>`;
    }).join('')}`;
}

// Background processes an admin can trigger on demand, mapped to their job tool.
// The rest of the registry (valuation, snapshots, alerts…) is monitor-only.
const PROCESS_TRIGGER = {
  'weekly-import-sets': 'sets',
  'weekly-import-figs': 'figs',
  'upcitemdb-backfill': 'upc',
  'pricecharting-bulk': 'pricechartingBulk',
  'pricesapi-retail': 'pricesapi',
  'ebay-sold-scrape': 'ebaySold',
};

function processRowHTML(p) {
  const badge = processRunBadge(p);
  const when = formatRelativeTime(p.finished_at || p.started_at);
  const dur = p.duration_ms ? ` · ${(p.duration_ms / 1000).toFixed(1)}s` : '';
  const result = p.status === 'failed'
    ? `<span class="admin-process-result is-error">${escapeHtml(p.error || 'failed')}</span>`
    : (p.summary ? `<span class="admin-process-result">${escapeHtml(p.summary)}</span>` : '');
  const canRun = !!PROCESS_TRIGGER[p.name] && p.status !== 'running';
  return `
    <div class="admin-process-row${p.status === 'running' ? ' is-running' : ''}">
      <div class="admin-process-head">
        <span class="admin-process-label">${escapeHtml(p.label)}</span>
        <span class="badge badge--${badge.tone}">${escapeHtml(badge.label)}</span>
      </div>
      <p class="admin-process-desc">${escapeHtml(p.description)}</p>
      <div class="admin-process-meta">
        ${p.schedule ? `<span class="admin-process-sched">${escapeHtml(p.schedule)}</span>` : ''}
        ${p.status === 'idle' ? '' : `<span>last run ${escapeHtml(when)}${dur}</span>`}
        ${result}
      </div>
      ${canRun ? `<div class="admin-process-actions"><button type="button" class="btn-secondary admin-proc-run" data-process-run="${escapeHtml(p.name)}">${I.refresh({ w: 14 })}<span>Run now</span></button></div>` : ''}
    </div>`;
}

// Trigger a background process from its Activity row, reusing the same job
// pipeline the Populate buttons used. eBay sold comps runs synchronously; the
// rest go through the tracked import-run path (which self-refreshes Activity).
function runProcess(name, btn) {
  const tool = PROCESS_TRIGGER[name];
  if (!tool) return;
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  if (tool === 'ebaySold') {
    triggerSyncJob(tool).finally(() => loadActivity());
  } else {
    triggerImport(tool);
  }
}

function renderJobs(container) {
  if (!adminRuns.length) {
    container.innerHTML = `<div class="admin-empty-state">${I.info()}<strong>No jobs have run yet.</strong><span>Use Populate all safe sources to start a controlled data pass.</span></div>`;
    return;
  }
  const running = adminRuns.find(run => classifyJobRun(run).label === 'Running');
  const activeHTML = running ? activeJobPanelHTML(running) : `
    <div class="admin-job-idle">
      <div><strong>No active job</strong><span>Start a run from the Populate tab — live progress shows here.</span></div>
    </div>`;
  const groups = groupAdminJobRuns(adminRuns);
  const visible = showAllJobs ? groups : groups.slice(0, 3);
  container.innerHTML = `
    ${activeHTML}
    <div class="admin-job-list">
      ${visible.map(jobGroupHTML).join('')}
    </div>
    ${groups.length > 3 ? `<button class="btn-secondary admin-show-more" id="adminShowMoreJobs">${showAllJobs ? 'Show newest 3' : `Show ${groups.length - 3} more`}</button>` : ''}`;
  $('#adminStopAutoRun')?.addEventListener('click', () => {
    populateEverythingAuto = false;
    if (populateEverythingContinueTimer) clearTimeout(populateEverythingContinueTimer);
    toast('Auto-run stopped. The current slice, if any, will finish normally.', 'info');
    renderJobs(container);
  });
  $('#adminShowMoreJobs')?.addEventListener('click', () => {
    showAllJobs = !showAllJobs;
    renderJobs(container);
  });
}

function activeJobPanelHTML(run) {
  const p = jobProgressSummary(run);
  return `
    <div class="admin-active-job" aria-live="polite">
      <div class="admin-active-job-head">
        <div>
          <div class="section-kicker">Running now</div>
          <h3>Job #${escapeHtml(run.id)} - ${escapeHtml(jobTypeLabel(run.job_type))}</h3>
        </div>
        <button class="btn-secondary" id="adminStopAutoRun">${I.close()}<span>Stop auto-run</span></button>
      </div>
      <div class="admin-progress-line">
        <div>
          <strong>${escapeHtml(p.label)}</strong>
          <span>${escapeHtml(p.countText || 'Working')}${p.pct != null ? ` / ${p.pct}%` : ''}</span>
        </div>
        <div class="admin-progress-track"><span style="width:${p.pct ?? 30}%"></span></div>
      </div>
      <div class="admin-job-facts">
        <span>Heartbeat: ${escapeHtml(ago(run.updated_at || run.started_at))}</span>
        <span>Elapsed: ${escapeHtml(elapsed(run.started_at))}</span>
        <span>Provider: ${escapeHtml(currentProvider(run))}</span>
        <span>Next: ${escapeHtml(nextStep(run))}</span>
      </div>
    </div>`;
}

function jobGroupHTML(group) {
  const run = group.latest;
  const state = group.state;
  const p = jobProgressSummary(run);
  const grouped = group.count > 1 && state.label === 'Completed';
  const title = grouped ? `${group.count} completed safe slices` : `Job #${run.id}`;
  const details = jobDetails(run, state, p);
  const error = String(run.error || '');
  return `
    <article class="admin-job-row ${state.tone}">
      <div class="admin-job-row-head">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(jobTypeLabel(run.job_type))} - ${escapeHtml(startedAt(run.started_at))}</p>
        </div>
        <span class="badge ${badgeClass(state.tone)}">${escapeHtml(state.label)}</span>
      </div>
      ${p.pct != null ? `<div class="admin-mini-progress"><span style="width:${p.pct}%"></span></div>` : ''}
      <div class="admin-job-meta">${details.map(x => `<span>${escapeHtml(x)}</span>`).join('')}</div>
      ${error ? `<details class="admin-job-details"><summary>Details</summary><div>${escapeHtml(error.length > 1000 ? error.slice(0, 1000) + '...' : error)}</div></details>` : ''}
    </article>`;
}

function jobDetails(run, state, progress) {
  const details = [];
  if (progress.countText) details.push(progress.countText);
  if (run.sets_loaded) details.push(`${run.sets_loaded} filled`);
  if (run.sets_skipped) details.push(`${run.sets_skipped} processed`);
  if (run.figs_loaded) details.push(`${run.figs_loaded} figs`);
  if (state.retryable) details.push('safe to retry');
  if (state.needsAttention) details.push('check diagnostics');
  return details.length ? details : ['No items processed'];
}

async function updateIntegrationsHealth() {
  try {
    adminHealth = await api('/api/admin/integrations');
    renderServices();
    renderCatalogQuality();
  } catch (err) {
    const quality = $('#qualityContainer');
    const services = $('#servicesContainer');
    if (services) services.innerHTML = errorPanelHTML('Service health unavailable', err.message || String(err));
    if (quality) quality.innerHTML = errorPanelHTML('Catalog quality unavailable', err.message || String(err));
  }
}

// Runtime capability flags (eBay sold comps, Bright Data sold, BrickInsights,
// Firecrawl, pricesAPI, BrickOwl). Feeds the per-service toggles in Services.
async function loadFeatureFlags() {
  try {
    featureFlags = await api('/api/admin/feature-flags');
  } catch (e) {
    featureFlags = { flags: [], overrides: {}, effective: {}, error: e.message || String(e) };
  }
  renderServices();
}

function providerRows() {
  const rows = Array.isArray(adminHealth?.integrations) ? [...adminHealth.integrations] : [];
  const status = state.config?.status || {};
  const addSynthetic = (service, configured, providerStatus, action) => {
    if (!rows.some(r => String(r.service).toLowerCase() === service)) {
      rows.push({ service, configured, status: providerStatus, last_ok_at: null, last_fail_at: null, last_error: '', recommended_action: action });
    }
  };
  addSynthetic('d1', !!status.d1, status.d1 ? 'ok' : 'down', 'Check the D1 binding.');
  addSynthetic('supabase', !!status.supabase, status.supabase ? 'ok' : 'down', 'Check Supabase URL, anon key, and JWT secret.');
  addSynthetic('worker', true, 'ok', 'No action needed.');
  return rows;
}

function ebayStateHTML(health) {
  const coverage = adminHealth?.coverage || {};
  const soldState = health.blocked ? 'sold comps blocked' : (coverage.sets_with_ebay_new || coverage.sets_with_ebay_used) ? 'sold comps available' : 'sold comps not populated';
  const askingState = coverage.sets_with_ebay_ask ? 'asking data available' : 'asking data not populated';
  return `<div class="admin-ebay-state"><span>${escapeHtml(soldState)}</span><span>${escapeHtml(askingState)}</span><span>No weak sold fallback</span></div>`;
}

// Per-key Bright Data spend this month (each key is capped at 5000 credits/mo on
// the free tier). Reads adminHealth.brightdata.pool from /api/admin/integrations.
function brightDataPoolHTML() {
  const pool = adminHealth?.brightdata?.pool;
  if (!pool || !Array.isArray(pool.entries) || !pool.entries.length) return '';
  const live = pool.keys_live ?? 0;
  const configured = pool.keys_configured ?? pool.entries.length;
  const remaining = Number(pool.pooled_remaining ?? 0);
  const head = `${live}/${configured} keys live · ${remaining.toLocaleString()} credits left this month`;
  const rows = pool.entries.map((e) => {
    const used = Number(e.used || 0);
    const cap = Number(e.cap || 5000);
    const left = Number(e.remaining ?? Math.max(0, cap - used));
    // A key latched as "exhausted" while barely used almost certainly failed
    // auth (invalid/revoked token) rather than draining its budget — label it so
    // it's clear the token should be dropped, not waited out.
    const flag = e.exhausted ? (used < 100 ? ' (rejected — likely invalid token)' : ' (exhausted)') : '';
    return `<div>…${escapeHtml(String(e.key_hash || '').slice(0, 8))} — ${used.toLocaleString()}/${cap.toLocaleString()} credits${escapeHtml(flag)} · ${left.toLocaleString()} left</div>`;
  }).join('');
  return `<details class="admin-job-details" open><summary>Key pool — monthly spend: ${escapeHtml(head)}</summary><div class="admin-bd-pool">${rows}</div></details>`;
}

// Relative age for an ISO-8601 timestamp (e.g. new Date().toISOString()). The
// shared ago() helper is for SQLite "YYYY-MM-DD HH:MM:SS" strings — it appends a
// 'Z', which double-stamps an ISO value and yields "unknown". Parse natively here.
function agoIso(ts) {
  if (!ts) return null;
  const then = Date.parse(String(ts));
  if (!Number.isFinite(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

// PriceCharting whole-catalog bulk-download status, surfaced right on the
// PriceCharting service card so "is the Legendary CSV import healthy?" is
// self-serve (no digging through the Activity tab). Reads
// adminHealth.pricecharting_ext.last_bulk from /api/admin/integrations.
function pcBulkStatusHTML() {
  const lb = adminHealth?.pricecharting_ext?.last_bulk;
  if (!lb || typeof lb !== 'object') {
    return `<p class="admin-service-action"><strong>Last bulk import:</strong> none recorded yet — the weekly LEGO price-guide download hasn’t run (or isn’t tracked). Trigger it from Activity → Pricing → “PriceCharting (bulk CSV)”.</p>`;
  }
  const when = agoIso(lb.finished_at);
  // A skip/failure is the important case to surface — usually a non-Legendary
  // token. Show the reason inline in the error tone.
  if (lb.skipped) {
    return `<p class="admin-service-action"><strong>Last bulk import:</strong> <span class="admin-process-result is-error">skipped — ${escapeHtml(String(lb.skipped))}</span>${when ? ` · ${escapeHtml(when)}` : ''}</p>`;
  }
  const matched = Number(lb.matched || 0);
  const rows = Number(lb.rows || 0);
  const updated = Number(lb.updated || 0);
  const parts = [`matched ${matched.toLocaleString()}${rows ? ` / ${rows.toLocaleString()} rows` : ''}`];
  if (updated) parts.push(`updated ${updated.toLocaleString()}`);
  if (when) parts.push(when);
  return `<p class="admin-service-action"><strong>Last bulk import:</strong> <span class="admin-process-result">${escapeHtml(parts.join(' · '))}</span></p>`;
}

// ---------------------------------------------------------------------------
// Services section — the mobile-first, service-per-place view. Each provider is
// a tap-to-expand card showing status, usage/spend, an on-demand Test button,
// and (where applicable) a runtime capability toggle + pricing tuning, so an
// admin can test and tune every service without touching code.
// ---------------------------------------------------------------------------

// Tab set: a leading "Needs action" triage view, then one tab per service
// category (PROVIDER_GROUPS). One category on screen at a time = far less
// scrolling on mobile.
function serviceTabs() {
  return [['attention', 'Needs action'], ...PROVIDER_GROUPS.map(([label]) => [label, label])];
}

function serviceTabButtonHTML(id, label) {
  const active = serviceTab === id;
  return `<button class="chip ${active ? 'active' : ''}" data-service-tab="${escapeHtml(id)}" role="tab" aria-selected="${active}">${escapeHtml(label)}</button>`;
}

function renderServiceFilters() {
  const wrap = document.querySelector('.admin-service-filters');
  if (!wrap) return;
  wrap.innerHTML = serviceTabs().map(([id, label]) => serviceTabButtonHTML(id, label)).join('');
  wrap.querySelectorAll('[data-service-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      serviceTab = btn.getAttribute('data-service-tab') || 'attention';
      renderServiceFilters();
      renderServices();
    });
  });
}

function serviceDescription(service) {
  const key = String(service || '').toLowerCase();
  if (SOURCE_META[key]) return SOURCE_META[key][1];
  return SERVICE_DESC[key] || 'Configured service.';
}

// Build a health row for a grouped service even when the health endpoint has no
// entry for it (infra like worker/pages, or not-yet-probed providers).
function serviceRow(service, rows) {
  const key = String(service).toLowerCase();
  const found = rows.find(r => String(r.service).toLowerCase() === key);
  if (found) return found;
  const status = state.config?.status || {};
  if (key === 'worker' || key === 'pages') return { service: key, configured: true, status: 'ok' };
  const known = key in status ? !!status[key] : null;
  return {
    service: key,
    configured: known == null ? true : known,
    status: known == null ? 'unknown' : known ? 'ok' : 'down',
    last_ok_at: null, last_fail_at: null, last_error: '',
  };
}

function renderServices() {
  const container = $('#servicesContainer');
  if (!container) return;
  if (!adminHealth) { container.textContent = 'Loading services...'; return; }
  // Preserve which cards the admin has expanded across re-renders.
  const openSet = new Set(
    Array.from(container.querySelectorAll('details.admin-service[open]')).map(d => d.getAttribute('data-svc')),
  );
  const rows = providerRows();
  const cfg = sourceConfig || {};
  const card = (svc) => {
    const row = serviceRow(svc, rows);
    return { svc, row, health: classifyProviderHealth(row) };
  };
  const renderCard = (c) => serviceCardHTML(c.svc, c.row, c.health, cfg, openSet);

  let body = '';
  if (serviceTab === 'attention') {
    // Triage across every category: only services that need attention, grouped
    // so it's clear which area each belongs to.
    body = PROVIDER_GROUPS.map(([label, keys]) => {
      const cards = keys.map(card)
        .filter(c => c.health.actionable || c.health.blocked || c.health.tone === 'danger' || c.health.tone === 'warn')
        .map(renderCard);
      return cards.length ? `<div class="admin-service-group"><h3>${escapeHtml(label)}</h3>${cards.join('')}</div>` : '';
    }).join('');
    if (!body) {
      container.innerHTML = `<div class="admin-empty-state">${I.check()}<strong>Nothing needs attention.</strong><span>All services look healthy — tap a category tab to browse or tune them.</span></div>`;
      return;
    }
    container.innerHTML = body;
    return;
  }

  // A single category tab: show every service in that group, no sub-header
  // (the active tab already names the category).
  const group = PROVIDER_GROUPS.find(([label]) => label === serviceTab);
  const keys = group ? group[1] : [];
  const cards = keys.map(card).map(renderCard).filter(Boolean);
  body = cards.length ? `<div class="admin-service-group">${cards.join('')}</div>` : '';
  // The reset-to-defaults escape hatch lives with the tunable sources.
  const showReset = (serviceTab === 'Pricing' || serviceTab === 'Scraping') && Object.keys(cfg).length;
  const footer = body && showReset
    ? `<div class="admin-service-footer">
        <span>Adjust weight, daily cap, and refresh on each service above.</span>
        <button type="button" class="btn-secondary admin-svc-reset" data-svc-reset>${I.refresh({ w: 16 })}<span>Reset pricing to defaults</span></button>
      </div>`
    : '';
  container.innerHTML = (body + footer)
    || `<div class="admin-empty-state">${I.info()}<strong>No services in this category.</strong><span>Pick another category tab.</span></div>`;
}

function serviceCardHTML(svc, row, health, cfg, openSet) {
  const key = String(svc).toLowerCase();
  const quota = quotaFor(key);
  const flag = SERVICE_FLAG[key];
  const tuning = TUNABLE_SOURCES.has(key) ? (cfg[key] || null) : null;
  const isOpen = openSet.has(key);
  const facts = [
    `Last OK: ${ago(row.last_ok_at)}`,
    `Last fail: ${ago(row.last_fail_at)}`,
    quota ? `Quota: ${quota.used}/${quota.cap}` : '',
    quota ? `Remaining: ${quota.remaining ?? Math.max(0, quota.cap - quota.used)}` : '',
  ].filter(Boolean);
  return `
    <details class="admin-service ${health.tone}" data-svc="${escapeHtml(key)}" ${isOpen ? 'open' : ''}>
      <summary class="admin-service-summary">
        <span class="admin-service-id">
          <strong>${escapeHtml(providerLabel(key))}</strong>
          <small>${escapeHtml(serviceDescription(key))}</small>
        </span>
        <span class="badge ${badgeClass(health.tone)}">${escapeHtml(health.label)}</span>
      </summary>
      <div class="admin-service-body">
        <div class="admin-service-facts">${facts.map(f => `<span>${escapeHtml(f)}</span>`).join('')}</div>
        ${key === 'ebay' ? ebayStateHTML(health) : ''}
        ${key === 'brightdata' ? brightDataPoolHTML() : ''}
        ${key === 'pricecharting' ? pcBulkStatusHTML() : ''}
        <p class="admin-service-action">${escapeHtml(health.action)}</p>
        ${row.last_error ? `<details class="admin-job-details"><summary>Latest failure</summary><div>${escapeHtml(String(row.last_error).slice(0, 900))}</div></details>` : ''}
        ${TESTABLE.has(key) ? serviceTestHTML(key) : ''}
        ${flag ? serviceFlagHTML(key, flag) : ''}
        ${tuning ? serviceTuningHTML(key, tuning) : ''}
      </div>
    </details>`;
}

function serviceTestHTML(svc) {
  return `
    <div class="admin-service-test">
      <button type="button" class="btn-secondary admin-svc-test-btn" data-svc-test="${escapeHtml(svc)}">${I.refresh({ w: 16 })}<span>Test now</span></button>
      <div class="admin-svc-test-result" data-svc-test-result="${escapeHtml(svc)}" hidden></div>
    </div>`;
}

function serviceFlagHTML(svc, flag) {
  const hasOverride = featureFlags.overrides && flag in featureFlags.overrides;
  const intended = hasOverride ? !!featureFlags.overrides[flag] : !!featureFlags.effective?.[flag];
  const effective = !!featureFlags.effective?.[flag];
  const label = FLAG_LABEL[flag] || flag;
  // "Blocked" = switched on, but it can't actually run because a required
  // key/token is missing (or the provider is unreachable). Don't render this as a
  // happy checked/active switch — flag it clearly as needing setup so it doesn't
  // read as "on" when it does nothing.
  const blocked = intended && !effective;
  if (blocked) {
    return `
    <div class="admin-service-control is-blocked">
      <div class="admin-toggle-row admin-toggle-row-static">
        <span>${escapeHtml(label)}</span>
        <span class="badge badge--warn">needs key</span>
      </div>
      <small class="admin-svc-hint">Enabled, but inactive — add the required key/token (or the provider is unreachable). It won't run until then.</small>
    </div>`;
  }
  return `
    <div class="admin-service-control">
      <label class="admin-toggle-row">
        <input type="checkbox" class="admin-svc-flag" data-svc-flag="${escapeHtml(flag)}" data-svc="${escapeHtml(svc)}" ${intended ? 'checked' : ''}>
        <span>${escapeHtml(label)}</span>
        <span class="badge ${effective ? 'badge--up' : 'badge--neutral'}">${effective ? 'active' : 'off'}</span>
      </label>
      <small class="admin-svc-hint">Runtime switch — applies within about 1 minute, no redeploy.</small>
    </div>`;
}

function serviceTuningHTML(svc, t) {
  return `
    <div class="admin-service-tuning" data-src="${escapeHtml(svc)}">
      <div class="admin-service-tuning-head">Valuation blend</div>
      <label class="admin-toggle-row">
        <input type="checkbox" class="src-enabled" ${t.enabled ? 'checked' : ''}>
        <span>Included in scheduled jobs and the valuation blend</span>
      </label>
      <div class="admin-service-tuning-grid">
        ${sourceInputHTML('Trust weight', 'src-weight', t.weight, 'decimal', '0.05')}
        ${sourceInputHTML('Daily cap', 'src-cap', t.dailyCap == null ? '' : t.dailyCap, 'numeric', '1')}
        ${sourceInputHTML('Refresh days', 'src-refresh', t.refreshDays == null ? '' : t.refreshDays, 'numeric', '1')}
      </div>
      <div class="source-error" hidden></div>
      <div class="admin-service-tuning-actions">
        <button type="button" class="btn-primary admin-svc-save" data-svc-save="${escapeHtml(svc)}">${I.check()}<span>Save ${escapeHtml(providerLabel(svc))}</span></button>
      </div>
    </div>`;
}

async function runServiceProbe(svc, btn) {
  const box = document.querySelector(`[data-svc-test-result="${CSS.escape(svc)}"]`);
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  if (box) { box.hidden = false; box.className = 'admin-svc-test-result'; box.textContent = 'Testing…'; }
  haptic('light');
  try {
    const r = await api(`/api/admin/test/${encodeURIComponent(svc)}`, { method: 'POST' });
    const degraded = r.status === 'degraded';
    const tone = degraded ? 'warn' : r.ok ? 'ok' : r.status === 'unconfigured' ? 'warn' : 'danger';
    const head = degraded ? 'Degraded' : r.ok ? 'OK' : r.status || 'error';
    if (box) {
      box.className = `admin-svc-test-result ${tone}`;
      box.textContent = `${head} — ${r.detail || ''} (${r.ms}ms)`;
    }
    toast(`${providerLabel(svc)}: ${head}`, degraded ? 'info' : r.ok ? 'success' : r.status === 'unconfigured' ? 'info' : 'error');
  } catch (e) {
    if (box) { box.className = 'admin-svc-test-result danger'; box.textContent = `Failed: ${e.message || e}`; }
    toast(`${providerLabel(svc)} test failed`, 'error');
  } finally {
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
  }
}

async function toggleServiceFlag(flag, checked, input) {
  input.disabled = true;
  // saveFeatureFlags REPLACES the whole map, so send all current overrides plus
  // the one we're changing (untouched env-default flags stay unset).
  const next = { ...(featureFlags.overrides || {}), [flag]: checked };
  try {
    const r = await api('/api/admin/feature-flags', { method: 'PUT', body: { flags: next } });
    featureFlags.overrides = r.overrides || next;
    featureFlags.effective = r.effective || featureFlags.effective;
    haptic('light');
    const eff = !!featureFlags.effective?.[flag];
    const suffix = checked && !eff ? ' (inactive — needs a key/token)' : '';
    toast(`${FLAG_LABEL[flag] || flag}: ${checked ? 'enabled' : 'disabled'}${suffix}`, checked && !eff ? 'info' : 'success');
    renderServices();
  } catch (e) {
    input.checked = !checked;
    input.disabled = false;
    toast(`Could not update ${FLAG_LABEL[flag] || flag}: ${e.message || e}`, 'error');
  }
}

async function saveServiceTuning(svc, btn) {
  const card = btn.closest('.admin-service-tuning');
  if (!card) return;
  const errEl = card.querySelector('.source-error');
  card.classList.remove('invalid');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  // saveSourceConfig resets omitted sources to defaults, so send the FULL config
  // with just this source's fields replaced from the inputs.
  const draft = { ...(sourceConfig || {}) };
  draft[svc] = {
    enabled: !!card.querySelector('.src-enabled')?.checked,
    weight: card.querySelector('.src-weight')?.value ?? '',
    dailyCap: card.querySelector('.src-cap')?.value ?? '',
    refreshDays: card.querySelector('.src-refresh')?.value ?? '',
  };
  const validation = validateSourceTuningInput(draft);
  if (!validation.ok) {
    const errs = validation.errors[svc];
    if (errs && errEl) { errEl.hidden = false; errEl.textContent = errs.join(' '); }
    card.classList.add('invalid');
    toast('Fix the highlighted values before saving.', 'error');
    return;
  }
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const res = await api('/api/admin/source-config', { method: 'PUT', body: { config: validation.config } });
    sourceConfig = res.config || validation.config;
    haptic('light');
    toast(`${providerLabel(svc)} saved.`, 'success');
    renderServices();
  } catch (e) {
    toast(`Error saving ${providerLabel(svc)}: ${e.message || e}`, 'error');
  } finally {
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
  }
}

function renderCatalogQuality() {
  const container = $('#qualityContainer');
  if (!container) return;
  const coverage = adminHealth?.coverage || {};
  const quality = coverage.quality || {};
  const blend = coverage.blend_quality || {};
  const total = Number(coverage.total_sets || 0);
  const barcodeTotal = Number(coverage.barcode_retail_total || total || 0);
  const barcodeWith = Number(coverage.barcode_retail_with_upc || 0);
  const cards = [
    qualityCard('Catalog sets', total, total ? 100 : 0, 'ok', 'Rows in the live catalog.'),
    qualityCard('Expired values', Number(coverage.expired_values || 0), percent(coverage.expired_values, total), 'warn', 'Values that need a refresh.'),
    qualityCard('Missing MSRP', Number(quality.missing_msrp || 0), Number(quality.missing_msrp_pct || percent(quality.missing_msrp, total)), 'warn', 'Rows missing retail price context.'),
    qualityCard('Missing UPC', Math.max(0, barcodeTotal - barcodeWith), 100 - Number(coverage.barcode_coverage_pct || percent(barcodeWith, barcodeTotal)), 'warn', 'Retail sets still missing barcode data.'),
    qualityCard('Old active sets', Number(quality.old_active_sets || 0), Number(quality.old_active_sets_pct || percent(quality.old_active_sets, total)), 'warn', 'Older sets still marked active.'),
    qualityCard('Low-confidence values', Number(quality.low_confidence_values || 0), Number(quality.low_confidence_values_pct || percent(quality.low_confidence_values, total)), 'danger', 'Rows using weak or formula-heavy valuation.'),
    qualityCard('BrickLink coverage', coverage.sets_with_bricklink ?? coverage.sets_with_bricklink_new ?? 0, Number(coverage.bricklink_coverage_pct || 0), 'ok', 'Sets with BrickLink market data.'),
    qualityCard('eBay new sold', coverage.sets_with_ebay_new || 0, Number(coverage.ebay_new_coverage_pct || 0), 'neutral', 'Sets with validated new/sealed sold comps.'),
    qualityCard('eBay used sold', coverage.sets_with_ebay_used || 0, Number(coverage.ebay_used_coverage_pct || 0), 'neutral', 'Sets with validated used sold comps.'),
    qualityCard('Blended values', blend.blended_count || 0, Number(blend.blended_coverage_pct || 0), 'ok', 'Rows with persisted blended values.'),
  ];
  container.innerHTML = `
    <div class="admin-recommendation">
      <strong>Recommended next action</strong>
      <span>${escapeHtml(recommendedQualityAction(cards))}</span>
    </div>
    <div class="admin-quality-grid">${cards.map(card => card.html).join('')}</div>
    <details class="admin-help-block">
      <summary>How denominators work</summary>
      <p>Catalog coverage is measured against all catalog rows. Barcode coverage uses scannable retail sets where a UPC is expected. eBay sold coverage stays at zero when Marketplace Insights or sold-comps access is blocked.</p>
    </details>`;
}

function qualityCard(label, count, pctValue, tone, help) {
  const pctClamped = Math.max(0, Math.min(100, Number(pctValue) || 0));
  return {
    label,
    count: Number(count || 0),
    pct: pctClamped,
    tone,
    html: `
      <article class="admin-quality-card ${tone}">
        <div class="admin-quality-head"><span>${escapeHtml(label)}</span><strong>${formatCount(count)}</strong></div>
        <div class="admin-mini-progress"><span style="width:${pctClamped}%"></span></div>
        <p>${pctClamped.toFixed(pctClamped < 1 && pctClamped > 0 ? 1 : 0)}% - ${escapeHtml(help)}</p>
      </article>`,
  };
}

function recommendedQualityAction(cards) {
  const priority = cards
    .filter(c => ['Missing UPC', 'Low-confidence values', 'Expired values', 'eBay new sold', 'eBay used sold'].includes(c.label))
    .sort((a, b) => b.pct - a.pct)[0];
  if (!priority) return 'Run Populate all safe sources (Populate tab) to refresh the latest provider coverage.';
  if (priority.label === 'Missing UPC') return 'Run Populate all safe sources, or the Barcode backfill job from the Activity tab.';
  if (priority.label === 'Low-confidence values') return 'Run Populate all safe sources and check provider access in the Services tab before increasing source weights.';
  if (priority.label.startsWith('eBay')) return 'Check eBay sold-comps access in the Services tab; do not fall back to active listings for sold value.';
  return 'Run Populate all safe sources to advance the next safe slice.';
}

// Loads pricing source config (defaults + stored overrides) for the per-service
// tuning + reset controls in the Services section. No dedicated UI of its own.
async function loadSourceTuning() {
  try {
    const data = await api('/api/admin/source-config');
    sourceDefaults = data.defaults || {};
    sourceConfig = data.config || {};
    renderServices();
  } catch (e) {
    toast(`Could not load pricing config: ${e.message || e}`, 'error');
  }
}

function sourceInputHTML(label, cls, value, inputMode, step) {
  return `
    <label class="admin-field source-field">
      <span>${escapeHtml(label)}</span>
      <input class="input ${cls}" inputmode="${inputMode}" step="${step}" value="${escapeHtml(value)}">
    </label>`;
}

// Reset all pricing sources (weight, daily cap, refresh, enabled) to the server
// defaults. The escape hatch that used to live in the Source Tuning tab; it now
// applies immediately and re-renders Services.
async function resetPricingDefaults(btn) {
  if (!Object.keys(sourceDefaults).length) {
    toast('Pricing defaults not loaded yet — try again in a moment.', 'info');
    return;
  }
  if (!window.confirm('Reset all pricing sources (weight, daily cap, refresh, enabled) to defaults?')) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const res = await api('/api/admin/source-config', { method: 'PUT', body: { config: sourceDefaults } });
    sourceConfig = res.config || sourceDefaults;
    haptic('light');
    toast('Pricing sources reset to defaults.', 'success');
    renderServices();
  } catch (e) {
    toast(`Reset failed: ${e.message || e}`, 'error');
  } finally {
    btn.disabled = false;
    btn.setAttribute('aria-busy', 'false');
  }
}

async function setSupporterStatus(value) {
  const input = $('#supporterUserIdInput');
  const out = $('#supporterResult');
  const userId = input?.value.trim() || '';
  if (!UUID_RE.test(userId)) {
    showPanel(out, 'danger', 'Enter a valid Supabase user UUID before changing supporter status.');
    return;
  }
  const label = value ? 'grant supporter status to' : 'revoke supporter status from';
  if (!window.confirm(`Confirm you want to ${label} ${userId}?`)) return;
  showPanel(out, '', value ? 'Granting supporter status...' : 'Revoking supporter status...');
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}/supporter`, { method: 'PATCH', body: { is_supporter: value } });
    showPanel(out, 'ok', value ? 'Supporter granted.' : 'Supporter revoked.');
    await loadSupporters();
  } catch (e) {
    showPanel(out, 'danger', `Error: ${e.message || e}`);
  }
}

async function searchUsers() {
  const q = $('#adminUserSearchInput')?.value.trim() || '';
  const out = $('#adminUserSearchResults');
  if (!out) return;
  if (q.length < 2) {
    out.innerHTML = `<div class="admin-status-panel danger">Type at least 2 characters.</div>`;
    return;
  }
  out.innerHTML = `<div class="admin-status-panel">Searching...</div>`;
  try {
    const data = await api(`/api/admin/users/search?q=${encodeURIComponent(q)}`);
    const users = data.users || [];
    out.innerHTML = users.length ? users.map(userSearchRowHTML).join('') : `<div class="admin-empty-state">${I.search()}<strong>No users found.</strong><span>Use the exact Supabase UUID if search has no result.</span></div>`;
    out.querySelectorAll('[data-pick-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-pick-user') || '';
        const input = $('#supporterUserIdInput');
        if (input) input.value = id;
      });
    });
  } catch (e) {
    out.innerHTML = errorPanelHTML('User search unavailable', e.message || String(e));
  }
}

function userSearchRowHTML(user) {
  const id = String(user.user_id || user.id || '');
  return `
    <div class="admin-user-result">
      <div>
        <strong>${escapeHtml(user.handle || user.display_name || user.email || id)}</strong>
        <span>${escapeHtml(id)}</span>
      </div>
      <button class="btn-secondary" data-pick-user="${escapeHtml(id)}">Use ID</button>
    </div>`;
}

async function loadSupporters() {
  const box = $('#supportersList');
  if (box) box.innerHTML = 'Loading supporters...';
  try {
    supporterData = await api('/api/admin/users/supporters');
  } catch (e) {
    supporterData = { error: e.message || String(e), supporters: [] };
  }
  renderSupporters();
}

function renderSupporters() {
  const box = $('#supportersList');
  if (!box) return;
  if (supporterData?.error) {
    box.innerHTML = errorPanelHTML('Supporter list unavailable', supporterData.error, 'Retry');
    $('#adminErrorRetry')?.addEventListener('click', loadSupporters);
    return;
  }
  const supporters = supporterData?.supporters || [];
  if (!supporters.length) {
    box.innerHTML = `<div class="admin-empty-state">${I.info()}<strong>No supporters yet.</strong><span>Grant supporter status above, then refresh this list.</span></div>`;
    return;
  }
  box.innerHTML = supporters.map(supporterRowHTML).join('');
  box.querySelectorAll('[data-pick-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-pick-user') || '';
      const input = $('#supporterUserIdInput');
      if (input) input.value = id;
    });
  });
  box.querySelectorAll('[data-revoke-supporter]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-revoke-supporter') || '';
      const input = $('#supporterUserIdInput');
      if (input) input.value = id;
      await setSupporterStatus(0);
    });
  });
}

function supporterRowHTML(user) {
  const id = String(user.user_id || '');
  const name = user.handle || user.display_name || user.email || 'Unnamed supporter';
  const since = user.supporter_since ? `Since ${startedAt(user.supporter_since)}` : 'Supporter enabled';
  return `
    <div class="admin-supporter-row">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(id)}</span>
        <small>${escapeHtml(since)}</small>
      </div>
      <div class="admin-supporter-actions">
        <button class="btn-secondary" data-pick-user="${escapeHtml(id)}">Use ID</button>
        <button class="btn-secondary" data-revoke-supporter="${escapeHtml(id)}">${I.minus()}<span>Revoke</span></button>
      </div>
    </div>`;
}

async function loadContribQueue() {
  try {
    contributionData = await api('/api/admin/contributions?status=pending');
    renderContribQueue();
  } catch (e) {
    contributionData = { error: e.message || 'Unknown error', items: [], counts: { total: 0, reviews: 0, photos: 0, data: 0 } };
    renderContribQueue();
  }
}

function renderContribQueue() {
  const box = $('#contribQueue');
  const badge = $('#contribCount');
  if (!box) return;
  const counts = contributionData?.counts || {};
  const total = Number(counts.total || 0);
  if (badge) badge.textContent = total ? String(total) : '';
  const tabs = document.querySelector('.admin-contrib-tabs');
  if (tabs) {
    tabs.innerHTML = [
      contribTabButtonHTML('all', `All ${total || ''}`.trim()),
      contribTabButtonHTML('review', `Reviews ${counts.reviews || ''}`.trim()),
      contribTabButtonHTML('photo', `Photos ${counts.photos || ''}`.trim()),
      contribTabButtonHTML('data', `Data fixes ${counts.data || ''}`.trim()),
    ].join('');
    tabs.querySelectorAll('[data-contrib-tab]').forEach(btn => btn.addEventListener('click', () => {
      contributionTab = btn.getAttribute('data-contrib-tab') || 'all';
      renderContribQueue();
    }));
  }
  if (contributionData?.error) {
    box.innerHTML = errorPanelHTML('Contribution queue unavailable', contributionData.error, 'Retry');
    $('#adminErrorRetry')?.addEventListener('click', loadContribQueue);
    return;
  }
  const items = (contributionData?.items || []).filter(item => contributionTab === 'all' || item.type === contributionTab);
  if (!items.length) {
    box.innerHTML = `<div class="admin-empty-state">${I.check()}<strong>No pending ${contributionTab === 'all' ? 'contributions' : contributionTab + ' items'}.</strong><span>Approved community content will appear on set detail pages.</span></div>`;
    return;
  }
  box.innerHTML = `<div class="admin-contrib-list">${items.map(contribCardHTML).join('')}</div>`;
  box.querySelectorAll('[data-contrib-action]').forEach(btn => {
    btn.addEventListener('click', () => moderateContribution(btn));
  });
}

function contribCardHTML(item) {
  const detail = contributionDetail(item);
  const thumb = item.photo_url
    ? `<img src="${escapeHtml((window.WORKER_BASE || '') + item.photo_url)}" alt="" loading="lazy">`
    : `<div class="admin-contrib-thumb">${item.type === 'photo' ? I.camera() : item.type === 'review' ? I.star() : I.pencil()}</div>`;
  return `
    <article class="admin-contrib-card" data-type="${escapeHtml(item.type)}" data-id="${escapeHtml(item.id)}">
      ${thumb}
      <div class="admin-contrib-body">
        <div class="admin-contrib-head">
          <div>
            <h3>${escapeHtml(contributionSummary(item))}</h3>
            <p>${escapeHtml(item.set_num)} ${escapeHtml(item.set_name || '')}</p>
          </div>
          <span class="badge badge--neutral">${escapeHtml(item.type)}</span>
        </div>
        <div class="admin-contrib-meta">
          <span>Contributor: ${escapeHtml(item.user_id || 'unknown')}</span>
          <span>Submitted: ${escapeHtml(startedAt(item.created_at))}</span>
        </div>
        ${detail ? `<div class="admin-contrib-detail">${detail}</div>` : ''}
        ${item.type === 'data' ? `<p class="admin-impact-note">Barcode approval auto-applies UPC only when the set has no UPC. Other data fixes are review notes.</p>` : ''}
        <div class="admin-contrib-actions">
          <a class="btn-secondary" href="#/set/${encodeURIComponent(String(item.set_num || ''))}">${I.extLink()}<span>Open set</span></a>
          <button class="btn-primary" data-contrib-action="approve">${I.check()}<span>Approve</span></button>
          <button class="btn-secondary" data-contrib-action="reject">${I.close()}<span>Reject</span></button>
        </div>
      </div>
    </article>`;
}

function contributionDetail(item) {
  if (!item.detail) return '';
  if (item.type !== 'data') return escapeHtml(String(item.detail));
  try {
    const parsed = typeof item.detail === 'string' ? JSON.parse(item.detail) : item.detail;
    return `<pre>${escapeHtml(JSON.stringify(parsed, null, 2))}</pre>`;
  } catch {
    return `<pre>${escapeHtml(String(item.detail))}</pre>`;
  }
}

function contributionSummary(item) {
  const raw = String(item.summary || item.type || '');
  if (item.type === 'review') {
    const rating = raw.match(/\d+/)?.[0];
    return rating ? `Review ${rating}/5` : 'Review';
  }
  if (item.type === 'photo') return raw.replace(/[\u0412\u00c2]\u00b7/g, '-').replace(/\s+-\s*$/, '').trim() || 'Photo';
  return raw.replace(/[\u0412\u00c2]\u00b7/g, '-').trim();
}

async function moderateContribution(btn) {
  const card = btn.closest('.admin-contrib-card');
  const type = card?.dataset.type;
  const id = card?.dataset.id;
  const action = btn.getAttribute('data-contrib-action');
  if (!type || !id || !action) return;
  const note = action === 'reject' ? window.prompt('Optional reviewer note for rejection:') : '';
  card.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try {
    const res = await api(`/api/admin/contributions/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action, note: note || '' } });
    haptic('light');
    toast(res.applied ? `${action === 'approve' ? 'Approved' : 'Rejected'} - ${res.applied}` : (action === 'approve' ? 'Approved' : 'Rejected'), 'success');
    await loadContribQueue();
  } catch (e) {
    card.querySelectorAll('button').forEach(b => { b.disabled = false; });
    toast(e.message || 'Action failed', 'error');
  }
}

function quotaFor(service) {
  const name = String(service || '').toLowerCase();
  return (adminHealth?.quota || []).find(q => String(q.service || '').toLowerCase() === name) || null;
}

function providerLabel(service) {
  const s = String(service || 'provider');
  const labels = {
    d1: 'D1',
    supabase: 'Supabase',
    upcitemdb: 'UPCitemdb',
    bricklink: 'BrickLink',
    brickeconomy: 'BrickEconomy',
    brickowl: 'BrickOwl',
    pricecharting: 'PriceCharting',
    pricesapi: 'pricesAPI.io',
    firecrawl: 'Firecrawl',
    brightdata: 'Bright Data',
    ebay: 'eBay',
    rebrickable: 'Rebrickable',
    brickset: 'Brickset',
    openai: 'OpenAI',
    gemini: 'Gemini',
    openrouter: 'OpenRouter',
    resend: 'Resend',
    google: 'Google Sheets',
  };
  return labels[s.toLowerCase()] || s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function jobTypeLabel(type = '') {
  const labels = {
    catalog_sets: 'Catalog sets',
    catalog_figs: 'Minifig import',
    catalog_all: 'Catalog import',
    barcode_backfill: 'Barcode backfill',
    populate_coverage: 'Populate coverage',
    valuation: 'Revalue prices',
    populate_everything: 'Populate everything',
  };
  return labels[type] || String(type || 'Job').replace(/_/g, ' ');
}

function currentProvider(run) {
  const text = String(run.error || run.progress_label || '');
  if (/ebay/i.test(text)) return 'eBay';
  if (/bricklink/i.test(text)) return 'BrickLink';
  if (/brickset|barcode/i.test(text)) return 'Brickset / barcode';
  if (/valuation/i.test(text)) return 'Valuation';
  return 'Current slice';
}

function nextStep(run) {
  const state = classifyJobRun(run);
  if (state.label === 'Running') return 'Poll heartbeat';
  if (state.retryable) return 'Retry with safe slice';
  if (state.needsAttention) return 'Review provider diagnostics';
  return 'Run next slice if coverage remains';
}

function badgeClass(tone) {
  if (tone === 'ok') return 'badge--up';
  if (tone === 'warn') return 'badge--warn';
  if (tone === 'danger') return 'badge--down';
  return 'badge--neutral';
}

function percent(part, whole) {
  const p = Number(part || 0);
  const w = Number(whole || 0);
  return w > 0 ? Math.round((p / w) * 1000) / 10 : 0;
}

function formatCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : String(value || 0);
}

function startedAt(ts) {
  if (!ts) return 'unknown';
  try { return new Date(String(ts).replace(' ', 'T') + 'Z').toLocaleString(); }
  catch { return String(ts); }
}

function ago(ts) {
  if (!ts) return 'never';
  const then = new Date(String(ts).replace(' ', 'T') + 'Z').getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (!Number.isFinite(mins)) return 'unknown';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function elapsed(ts) {
  if (!ts) return 'unknown';
  const then = new Date(String(ts).replace(' ', 'T') + 'Z').getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (!Number.isFinite(mins)) return 'unknown';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function showPanel(el, tone, text) {
  if (!el) return;
  el.hidden = false;
  el.className = `admin-status-panel ${tone || ''}`.trim();
  el.textContent = text;
}

function errorPanelHTML(title, body, retryLabel = '') {
  return `
    <div class="admin-error-state">
      ${I.alert()}
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(body || 'Unknown error')}</span>
      </div>
      ${retryLabel ? `<button class="btn-secondary" id="adminErrorRetry">${I.refresh()}<span>${escapeHtml(retryLabel)}</span></button>` : ''}
    </div>`;
}
