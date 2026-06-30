import { $, $$, haptic, escapeHtml, toast } from '../utils.js';
import { state } from '../state.js';
import { api } from '../api.js';
import { I } from '../icons.js';
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
let providerFilter = 'needs';
let contributionTab = 'all';
let sourceDirty = false;

let setupRows = [];
let adminRuns = [];
let adminHealth = null;
let contributionData = null;
let supporterData = null;
let sourceDefaults = {};
let sourceConfig = {};
let activityData = null;
let activityPollTimer = null;

const ADMIN_SECTIONS = [
  ['adminOverview', 'Overview'],
  ['adminPopulate', 'Populate'],
  ['adminJobs', 'Activity'],
  ['adminProviders', 'Providers'],
  ['adminQuality', 'Catalog Quality'],
  ['adminSources', 'Source Tuning'],
  ['adminUsers', 'Users'],
  ['adminContrib', 'Contributions'],
];

const ADMIN_JOB_TOOLS = {
  sets: {
    url: '/api/admin/import-rebrickable',
    method: 'POST',
    body: { dataset: 'sets' },
    label: 'Import sets',
    desc: 'Imports the full LEGO set catalog from Rebrickable.',
    source: 'Rebrickable',
    duration: 'Several minutes',
    quota: 'Use only when catalog import is incomplete.',
    icon: I.download(),
    confirm: 'Import the set catalog now? This is safe, but it can take a while.',
  },
  figs: {
    url: '/api/admin/import-rebrickable',
    method: 'POST',
    body: { dataset: 'figs' },
    label: 'Import minifigs',
    desc: 'Imports the full minifigure catalog from Rebrickable.',
    source: 'Rebrickable',
    duration: 'Several minutes',
    quota: 'Use when minifig data is missing or stale.',
    icon: I.download(),
    confirm: 'Import the minifig catalog now?',
  },
  upc: {
    url: '/api/admin/backfill-upc',
    method: 'POST',
    body: {},
    label: 'Backfill barcodes',
    desc: 'Fills in missing UPC barcodes so sets can be scanned.',
    source: 'Brickset / UPCitemdb',
    duration: '1 safe slice',
    quota: 'Daily provider quota controls how far this advances.',
    icon: I.barcode(),
  },
  populate: {
    url: '/api/admin/populate-coverage',
    method: 'POST',
    body: {},
    label: 'Populate coverage',
    desc: 'Runs one safe slice of barcode + asking-price refresh.',
    source: 'Configured providers',
    duration: '1 safe slice',
    quota: 'Barcode pages plus asking-price refresh.',
    icon: I.refresh({ w: 16 }),
  },
  revalue: {
    url: '/api/admin/revalue-brickeconomy',
    method: 'POST',
    body: { scope: 'all', limit: 4 },
    label: 'Revalue prices',
    desc: 'Re-prices a small batch of sets from current market sources.',
    source: 'Valuation sources',
    duration: 'Small batch',
    quota: 'Uses the current daily source budgets.',
    icon: I.trend(),
  },
  everything: {
    url: '/api/admin/populate-everything',
    method: 'POST',
    body: { valuation_limit: 6, barcode_pages: 4, ebay_limit: 2 },
    label: 'Populate all safe sources',
    desc: 'Runs safe slices across every configured source until done.',
    source: 'All configured providers',
    duration: 'Repeated safe slices',
    quota: 'Stops only for hard errors; unavailable providers stay degraded.',
    icon: I.refresh({ w: 16 }),
  },
  pricechartingBulk: {
    url: '/api/admin/pricecharting-bulk-fetch',
    method: 'POST',
    body: {},
    label: 'Refresh PriceCharting (LEGO bulk)',
    desc: 'Downloads the whole LEGO price guide and updates values + liquidity.',
    source: 'PriceCharting CSV',
    duration: 'One ~2MB download',
    quota: 'Auto-runs weekly; CSV downloads are limited to once per 10 minutes.',
    icon: I.download(),
  },
  pricesapi: {
    url: '/api/admin/run-pricesapi',
    method: 'POST',
    body: { limit: 3 },
    label: 'Run pricesAPI now',
    desc: 'Refreshes live retailer offers + stock for a few sets — use to verify new keys.',
    source: 'pricesAPI.io',
    duration: 'Up to ~90s per set',
    quota: 'Needs PRICESAPI_ENABLED=1 + keys; spends the daily pricesAPI budget.',
    icon: I.refresh({ w: 16 }),
  },
  ebaySold: {
    url: '/api/admin/jobs/ebay-sold-scrape?limit=5',
    method: 'POST',
    body: {},
    label: 'Run eBay-sold scrape',
    desc: 'Scrapes eBay sold comps now (Bright Data) — use to verify tokens/zone.',
    source: 'Bright Data',
    duration: 'Up to ~60s for 5 sets',
    quota: 'Spends Bright Data credits; runs synchronously and returns the result.',
    icon: I.refresh({ w: 16 }),
  },
};

const MAINTENANCE_TOOLS = {
  expire: {
    url: '/api/admin/expire-valuations',
    method: 'POST',
    label: 'Expire valuations',
    desc: 'Marks current valuations stale so the pricing crons re-price every set.',
    confirm: 'Expire valuations so cron jobs reprice them? This can create a lot of follow-up work.',
  },
  repair: {
    url: '/api/admin/repair-search-index',
    method: 'POST',
    label: 'Repair search index',
    desc: 'Rebuilds the catalog search index if set search starts returning wrong results.',
    confirm: 'Rebuild the catalog search index now?',
  },
};

const SOURCE_META = {
  bricklink: ['BrickLink', 'Primary collector-market pricing. Strong signal for new and used values.'],
  ebay: ['eBay', 'Asking data plus sold comps only when approved and reachable. No weak sold fallback.'],
  brickeconomy: ['BrickEconomy', 'Useful historical and forecast signal when reachable.'],
  brickowl: ['BrickOwl', 'Optional marketplace signal and cross-check.'],
  pricecharting: ['PriceCharting', 'Optional loose and volume signals for broader resale context.'],
  pricesapi: ['pricesAPI.io', 'Optional retail offer signal; keep disabled unless keys and quota are ready.'],
  firecrawl: ['Firecrawl', 'Scraping runtime for structured market enrichment.'],
  brightdata: ['Bright Data', 'Scraping/runtime provider for restricted market data.'],
};

const PROVIDER_GROUPS = [
  ['Core', ['d1', 'supabase', 'worker', 'pages']],
  ['Catalog', ['rebrickable', 'brickset', 'upc', 'upcitemdb']],
  ['Pricing', ['bricklink', 'brickeconomy', 'ebay', 'brickowl', 'pricecharting', 'pricesapi']],
  ['Scraping', ['firecrawl', 'brightdata']],
  ['AI', ['gemini', 'openai', 'openrouter', 'byok']],
  ['Notifications', ['resend', 'push', 'vapid', 'discord']],
  ['Sync', ['google']],
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function renderMeAdmin() {
  if (!state.me) $('#root').innerHTML = skelPage(skelSettingRows(6));
  const me = await loadMe();
  if (!me?.is_admin) { go('#/me'); return; }

  const googleStatus = await api('/api/google/status').catch(() => ({ connected: false, configured: false }));
  setupRows = buildSetupRows(me, googleStatus);

  $('#root').innerHTML = `
    <div class="page admin-page admin-dashboard-page">
      ${subpageTopbarHTML('Admin console', 'Admin')}
      <nav class="admin-segments admin-segments-sticky" aria-label="Admin sections">
        ${ADMIN_SECTIONS.map(([id, label], i) => `<button type="button" role="tab" aria-selected="${i === 0}" aria-controls="${id}" class="${i === 0 ? 'active' : ''}" data-admin-section-link="${id}">${escapeHtml(label)}</button>`).join('')}
      </nav>

      <section class="admin-section" id="adminOverview">
        <div class="section-kicker">Operations</div>
        <h2 class="section-title">Overview</h2>
        <div id="adminOverviewCards" class="admin-summary-grid"></div>
        <div class="admin-layout">
          <div class="admin-main">
            <div class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <h3>Needs attention</h3>
                  <p>Hard failures first, expected provider limits last.</p>
                </div>
              </div>
              <div id="adminNeedsList" class="admin-action-list"></div>
            </div>
            <div class="admin-panel">
              <div class="admin-panel-head">
                <div>
                  <h3>Setup state</h3>
                  <p>Ready, degraded, and action-needed integrations.</p>
                </div>
              </div>
              <div class="admin-setup-grid">${setupRowsHTML()}</div>
            </div>
          </div>
          <aside class="admin-rail">
            <div class="admin-rail-card">
              <h3>Priority rail</h3>
              <div id="adminRail">Loading...</div>
            </div>
          </aside>
        </div>
      </section>

      <section class="admin-section" id="adminPopulate">
        <div class="section-kicker">Data population</div>
        <h2 class="section-title">Populate</h2>
        ${populateSectionHTML()}
      </section>

      <section class="admin-section" id="adminJobs">
        <div class="section-kicker">Live background activity</div>
        <h2 class="section-title">Activity</h2>
        <p class="admin-section-intro">Every background process and admin job, updated live while this page is open. Each row shows what it does, when it last ran, and the result.</p>
        <div id="jobsStatusContainer" class="admin-panel" aria-live="polite">Loading jobs...</div>
        <div id="processesContainer" class="admin-process-wrap" aria-live="polite">Loading processes...</div>
      </section>

      <section class="admin-section" id="adminProviders">
        <div class="section-kicker">Provider readiness</div>
        <h2 class="section-title">Providers</h2>
        <div class="admin-provider-filters" role="tablist" aria-label="Provider filters">
          ${providerFilterButtonHTML('needs', 'Needs action')}
          ${providerFilterButtonHTML('quota', 'Quota')}
          ${providerFilterButtonHTML('ready', 'Ready')}
          ${providerFilterButtonHTML('optional', 'Optional')}
          ${providerFilterButtonHTML('all', 'All')}
        </div>
        <div id="providersContainer" class="admin-provider-wrap">Loading providers...</div>
      </section>

      <section class="admin-section" id="adminQuality">
        <div class="section-kicker">Catalog data quality</div>
        <h2 class="section-title">Catalog Quality</h2>
        <div id="qualityContainer" class="admin-panel">Loading coverage...</div>
      </section>

      <section class="admin-section" id="adminSources">
        <div class="section-kicker">Blend controls</div>
        <h2 class="section-title">Source Tuning</h2>
        <div class="admin-panel">
          <div class="admin-panel-head">
            <div>
              <h3>Pricing source controls</h3>
              <p>Adjust trust, daily budgets, and refresh cadence. Changes apply within about 1 minute.</p>
            </div>
          </div>
          <div id="sourceTuningContainer">Loading source config...</div>
          <div id="sourceTuningResult" class="admin-status-panel" hidden></div>
        </div>
      </section>

      <section class="admin-section" id="adminUsers">
        <div class="section-kicker">Account support</div>
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
        <div class="section-kicker">Community moderation</div>
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
    </div>`;

  wireAdminShell();
  renderAdminOverview();
  updateJobsStatus();
  loadActivity();
  updateIntegrationsHealth();
  loadSourceTuning();
  loadContribQueue();
  loadSupporters();
}

function buildSetupRows(me, googleStatus) {
  const savedOpenAIKey = localStorage.getItem('bv_openai_key') || '';
  const status = state.config?.status || {};
  return [
    setupRow('D1 database', !!status.d1, 'ready', 'Missing binding', false),
    setupRow('Supabase auth', !!status.supabase, 'ready', 'Missing auth config', false),
    setupRow('Rebrickable catalog', !!status.rebrickable, 'ready', 'Missing REBRICKABLE_API_KEY', false),
    setupRow('Brickset metadata', !!status.brickset, 'ready', 'Optional setup', true),
    setupRow('BrickLink pricing', !!(status.bricklink || me?.bricklink_configured), 'ready', 'Missing BrickLink keys', false),
    setupRow('eBay credentials', !!(status.ebay || me?.ebay_configured), 'credentials set', 'Sold comps unavailable', true),
    setupRow('Google Sheets', !!(googleStatus.connected || googleStatus.configured || status.google), 'configured', 'Needs app setup/user connect', true),
    setupRow('Server AI', !!(status.openai || savedOpenAIKey), 'configured', 'BYOK or server key needed', true),
    setupRow('Notifications', !!(status.resend || status.push || status.vapid), 'configured', 'Optional setup', true),
  ];
}

function setupRow(label, ok, okText, missText, optional) {
  return { label, ok, okText, missText, optional };
}

function setupRowsHTML() {
  return setupRows.map(row => {
    const tone = row.ok ? 'ok' : row.optional ? 'neutral' : 'warn';
    const status = row.ok ? row.okText : row.missText;
    return `
      <div class="admin-setup-card ${tone}">
        <span>${escapeHtml(row.label)}</span>
        <strong>${escapeHtml(status)}</strong>
      </div>`;
  }).join('');
}

function populateSectionHTML() {
  const secondary = ['sets', 'figs', 'upc', 'populate', 'revalue', 'pricechartingBulk', 'pricesapi', 'ebaySold'];
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
    <div class="admin-tool-grid">
      ${secondary.map(key => adminToolCardHTML(key)).join('')}
      ${maintenanceCardHTML('expire')}
      ${maintenanceCardHTML('repair')}
    </div>`;
}

function adminToolCardHTML(key) {
  const tool = ADMIN_JOB_TOOLS[key];
  return `
    <article class="admin-tool-card">
      <div class="admin-tool-icon">${tool.icon}</div>
      <div>
        <h3>${escapeHtml(tool.label)}</h3>
        ${tool.desc ? `<p class="admin-tool-desc">${escapeHtml(tool.desc)}</p>` : ''}
        <small>${escapeHtml(tool.source)} · ${escapeHtml(tool.duration)} · ${escapeHtml(tool.quota)}</small>
      </div>
      <button class="icon-btn admin-tool-run" data-admin-tool="${escapeHtml(key)}" aria-label="${escapeHtml(tool.label)}">${I.refresh({ w: 16 })}</button>
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
  const sectionLinks = Array.from(document.querySelectorAll('[data-admin-section-link]'));
  sectionLinks.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-admin-section-link');
      const section = id ? document.getElementById(id) : null;
      if (!section) return;
      haptic('light');
      sectionLinks.forEach(link => {
        const active = link === btn;
        link.classList.toggle('active', active);
        link.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
  document.querySelectorAll('[data-maint-tool]').forEach(btn => {
    btn.addEventListener('click', () => triggerMaintenance(btn.getAttribute('data-maint-tool')));
  });
  document.querySelectorAll('[data-provider-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      providerFilter = btn.getAttribute('data-provider-filter') || 'needs';
      renderProviderFilters();
      renderProviders();
    });
  });
  document.querySelectorAll('[data-contrib-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      contributionTab = btn.getAttribute('data-contrib-tab') || 'all';
      renderContribQueue();
    });
  });
  $('#grantSupporterBtn')?.addEventListener('click', () => setSupporterStatus(1));
  $('#revokeSupporterBtn')?.addEventListener('click', () => setSupporterStatus(0));
  $('#adminUserSearchBtn')?.addEventListener('click', searchUsers);
  $('#refreshSupportersBtn')?.addEventListener('click', loadSupporters);
  $('#adminUserSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchUsers();
  });
  setupAdminSectionObserver();
}

function setupAdminSectionObserver() {
  const links = Array.from(document.querySelectorAll('[data-admin-section-link]'));
  const sections = ADMIN_SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean);
  if (!('IntersectionObserver' in window) || !sections.length) return;
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    links.forEach(link => {
      const active = link.dataset.adminSectionLink === visible.target.id;
      link.classList.toggle('active', active);
      link.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }, { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.2, 0.6] });
  sections.forEach(section => observer.observe(section));
}

function providerFilterButtonHTML(id, label) {
  return `<button class="chip ${providerFilter === id ? 'active' : ''}" data-provider-filter="${escapeHtml(id)}" role="tab" aria-selected="${providerFilter === id}">${escapeHtml(label)}</button>`;
}

function renderProviderFilters() {
  const wrap = document.querySelector('.admin-provider-filters');
  if (!wrap) return;
  wrap.innerHTML = [
    providerFilterButtonHTML('needs', 'Needs action'),
    providerFilterButtonHTML('quota', 'Quota'),
    providerFilterButtonHTML('ready', 'Ready'),
    providerFilterButtonHTML('optional', 'Optional'),
    providerFilterButtonHTML('all', 'All'),
  ].join('');
  wrap.querySelectorAll('[data-provider-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      providerFilter = btn.getAttribute('data-provider-filter') || 'needs';
      renderProviderFilters();
      renderProviders();
    });
  });
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
    renderAdminOverview();

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
  c.innerHTML = `
    <div class="admin-activity-summary">
      ${counts.running ? `<span class="admin-pill admin-pill--running">${counts.running} running</span>` : ''}
      <span class="admin-pill admin-pill--ok">${counts.ok} healthy</span>
      ${counts.failed ? `<span class="admin-pill admin-pill--danger">${counts.failed} failed</span>` : ''}
      ${counts.idle ? `<span class="admin-pill admin-pill--idle">${counts.idle} not yet run</span>` : ''}
    </div>
    ${groups.map(g => `
      <div class="admin-process-group">
        <h3 class="admin-process-group-title">${escapeHtml(g)}</h3>
        <div class="admin-process-list">${byGroup.get(g).map(processRowHTML).join('')}</div>
      </div>`).join('')}`;
}

function processRowHTML(p) {
  const badge = processRunBadge(p);
  const when = formatRelativeTime(p.finished_at || p.started_at);
  const dur = p.duration_ms ? ` · ${(p.duration_ms / 1000).toFixed(1)}s` : '';
  const result = p.status === 'failed'
    ? `<span class="admin-process-result is-error">${escapeHtml(p.error || 'failed')}</span>`
    : (p.summary ? `<span class="admin-process-result">${escapeHtml(p.summary)}</span>` : '');
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
    </div>`;
}

function renderJobs(container) {
  if (!adminRuns.length) {
    container.innerHTML = `<div class="admin-empty-state">${I.info()}<strong>No jobs have run yet.</strong><span>Use Populate all safe sources to start a controlled data pass.</span></div>`;
    return;
  }
  const running = adminRuns.find(run => classifyJobRun(run).label === 'Running');
  const activeHTML = running ? activeJobPanelHTML(running) : `
    <div class="admin-job-idle">
      <div><strong>No active job</strong><span>Safe slices can be run any time provider quotas allow.</span></div>
      <button class="btn-primary" id="adminRunNextSlice">${I.refresh()}<span>Run next slice</span></button>
    </div>`;
  const groups = groupAdminJobRuns(adminRuns);
  const visible = showAllJobs ? groups : groups.slice(0, 3);
  container.innerHTML = `
    ${activeHTML}
    <div class="admin-job-list">
      ${visible.map(jobGroupHTML).join('')}
    </div>
    ${groups.length > 3 ? `<button class="btn-secondary admin-show-more" id="adminShowMoreJobs">${showAllJobs ? 'Show newest 3' : `Show ${groups.length - 3} more`}</button>` : ''}`;
  $('#adminRunNextSlice')?.addEventListener('click', () => triggerImport('everything', { single: true }));
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
    renderProviders();
    renderCatalogQuality();
    renderAdminOverview();
    renderSourceTuning(sourceConfig);
  } catch (err) {
    const providers = $('#providersContainer');
    const quality = $('#qualityContainer');
    if (providers) providers.innerHTML = errorPanelHTML('Provider health unavailable', err.message || String(err));
    if (quality) quality.innerHTML = errorPanelHTML('Catalog quality unavailable', err.message || String(err));
  }
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

function renderProviders() {
  const container = $('#providersContainer');
  if (!container) return;
  if (!adminHealth) {
    container.textContent = 'Loading providers...';
    return;
  }
  const rows = providerRows().map(row => ({ row, health: classifyProviderHealth(row), group: providerGroupFor(row.service) }));
  const filtered = rows.filter(({ health }) => {
    if (providerFilter === 'all') return true;
    if (providerFilter === 'needs') return health.actionable || health.blocked || health.tone === 'danger';
    if (providerFilter === 'quota') return health.quotaLimited;
    if (providerFilter === 'ready') return health.ready;
    if (providerFilter === 'optional') return health.optional;
    return true;
  });
  if (!filtered.length) {
    container.innerHTML = `<div class="admin-empty-state">${I.check()}<strong>No providers in this filter.</strong><span>Try All to see the full diagnostic list.</span></div>`;
    return;
  }
  container.innerHTML = PROVIDER_GROUPS.map(([label]) => {
    const groupRows = filtered.filter(x => x.group === label);
    if (!groupRows.length) return '';
    return `
      <div class="admin-provider-group">
        <h3>${escapeHtml(label)}</h3>
        <div class="admin-provider-grid">${groupRows.map(providerCardHTML).join('')}</div>
      </div>`;
  }).join('') || filtered.map(providerCardHTML).join('');
}

function providerCardHTML({ row, health }) {
  const service = String(row.service || row.name || 'provider');
  const quota = quotaFor(service);
  const statusBits = [
    row.configured === false ? 'not configured' : 'configured',
    row.status ? String(row.status) : 'unknown',
    quota ? `${quota.used}/${quota.cap} quota` : '',
  ].filter(Boolean);
  return `
    <article class="admin-provider-card ${health.tone}">
      <div class="admin-provider-head">
        <div>
          <h4>${escapeHtml(providerLabel(service))}</h4>
          <p>${escapeHtml(statusBits.join(' - '))}</p>
        </div>
        <span class="badge ${badgeClass(health.tone)}">${escapeHtml(health.label)}</span>
      </div>
      <div class="admin-provider-facts">
        <span>Last OK: ${escapeHtml(ago(row.last_ok_at))}</span>
        <span>Last fail: ${escapeHtml(ago(row.last_fail_at))}</span>
        ${quota ? `<span>Remaining: ${escapeHtml(String(quota.remaining ?? Math.max(0, quota.cap - quota.used)))}</span>` : ''}
      </div>
      ${service.toLowerCase() === 'ebay' ? ebayStateHTML(health) : ''}
      <p class="admin-provider-action">${escapeHtml(health.action)}</p>
      ${row.last_error ? `<details class="admin-job-details"><summary>Latest failure</summary><div>${escapeHtml(String(row.last_error).slice(0, 900))}</div></details>` : ''}
    </article>`;
}

function ebayStateHTML(health) {
  const coverage = adminHealth?.coverage || {};
  const soldState = health.blocked ? 'sold comps blocked' : (coverage.sets_with_ebay_new || coverage.sets_with_ebay_used) ? 'sold comps available' : 'sold comps not populated';
  const askingState = coverage.sets_with_ebay_ask ? 'asking data available' : 'asking data not populated';
  return `<div class="admin-ebay-state"><span>${escapeHtml(soldState)}</span><span>${escapeHtml(askingState)}</span><span>No weak sold fallback</span></div>`;
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
  if (!priority) return 'Run Populate all safe sources to refresh the latest provider coverage.';
  if (priority.label === 'Missing UPC') return 'Run Backfill barcodes or Populate all safe sources in daily safe slices.';
  if (priority.label === 'Low-confidence values') return 'Run Revalue prices and check provider access before increasing source weights.';
  if (priority.label.startsWith('eBay')) return 'Check eBay sold-comps access; do not fall back to active listings for sold value.';
  return 'Run Populate all safe sources to advance the next safe slice.';
}

async function loadSourceTuning() {
  const container = $('#sourceTuningContainer');
  try {
    const data = await api('/api/admin/source-config');
    sourceDefaults = data.defaults || {};
    sourceConfig = data.config || {};
    sourceDirty = false;
    renderSourceTuning(sourceConfig);
  } catch (e) {
    if (container) container.innerHTML = errorPanelHTML('Could not load source config', e.message || String(e), 'Retry source tuning');
    $('#adminErrorRetry')?.addEventListener('click', loadSourceTuning);
  }
}

function renderSourceTuning(config = sourceConfig) {
  const container = $('#sourceTuningContainer');
  if (!container) return;
  const entries = Object.entries(config || {});
  if (!entries.length) {
    container.innerHTML = `<div class="admin-empty-state">${I.info()}<strong>No source tuning data yet.</strong><span>Reload after the admin endpoint is ready.</span></div>`;
    return;
  }
  container.innerHTML = `
    <div class="source-card-grid">
      ${entries.map(([name, tuning]) => sourceCardHTML(name, tuning)).join('')}
    </div>
    <div class="source-tuning-footer">
      <span id="sourceUnsavedCount">${sourceDirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
      <button class="btn-secondary" id="sourceTuningResetBtn">${I.refresh()}<span>Reset to defaults</span></button>
      <button class="btn-primary" id="sourceTuningSaveBtn">${I.check()}<span>Save changes</span></button>
    </div>`;
  container.querySelectorAll('input').forEach(input => input.addEventListener('input', markSourceDirty));
  $('#sourceTuningSaveBtn')?.addEventListener('click', saveSourceTuning);
  $('#sourceTuningResetBtn')?.addEventListener('click', resetSourceTuning);
}

function sourceCardHTML(name, t) {
  const meta = SOURCE_META[name] || [name, 'Pricing or data source.'];
  const health = classifyProviderHealth(providerRows().find(r => String(r.service).toLowerCase() === String(name).toLowerCase()) || { service: name, configured: true, status: 'unknown' });
  return `
    <article class="source-card" data-src="${escapeHtml(name)}">
      <div class="source-card-head">
        <div>
          <h3>${escapeHtml(meta[0])}</h3>
          <p>${escapeHtml(meta[1])}</p>
        </div>
        <span class="badge ${badgeClass(health.tone)}">${escapeHtml(health.label)}</span>
      </div>
      <label class="source-toggle-row">
        <input type="checkbox" class="src-enabled" ${t.enabled ? 'checked' : ''}>
        <span>Enabled for scheduled jobs and valuation blend</span>
      </label>
      <div class="source-grid">
        ${sourceInputHTML('Trust weight', 'src-weight', t.weight, 'decimal', '0.05')}
        ${sourceInputHTML('Daily cap', 'src-cap', t.dailyCap == null ? '' : t.dailyCap, 'numeric', '1')}
        ${sourceInputHTML('Refresh days', 'src-refresh', t.refreshDays == null ? '' : t.refreshDays, 'numeric', '1')}
      </div>
      <div class="source-error" hidden></div>
    </article>`;
}

function sourceInputHTML(label, cls, value, inputMode, step) {
  return `
    <label class="admin-field source-field">
      <span>${escapeHtml(label)}</span>
      <input class="input ${cls}" inputmode="${inputMode}" step="${step}" value="${escapeHtml(value)}">
    </label>`;
}

function markSourceDirty() {
  sourceDirty = true;
  const out = $('#sourceUnsavedCount');
  if (out) out.textContent = `${document.querySelectorAll('.source-card').length} sources editable - unsaved changes`;
}

function collectSourceTuning() {
  const config = {};
  for (const row of $$('.source-card')) {
    const name = row.getAttribute('data-src');
    config[name] = {
      enabled: !!row.querySelector('.src-enabled')?.checked,
      weight: row.querySelector('.src-weight')?.value ?? '',
      dailyCap: row.querySelector('.src-cap')?.value ?? '',
      refreshDays: row.querySelector('.src-refresh')?.value ?? '',
    };
  }
  return config;
}

async function saveSourceTuning() {
  const out = $('#sourceTuningResult');
  if (out) {
    out.hidden = false;
    out.className = 'admin-status-panel';
    out.textContent = 'Saving source tuning...';
  }
  document.querySelectorAll('.source-card').forEach(card => {
    card.classList.remove('invalid');
    const err = card.querySelector('.source-error');
    if (err) { err.hidden = true; err.textContent = ''; }
  });
  const validation = validateSourceTuningInput(collectSourceTuning());
  if (!validation.ok) {
    for (const [name, errors] of Object.entries(validation.errors)) {
      const card = document.querySelector(`.source-card[data-src="${CSS.escape(name)}"]`);
      card?.classList.add('invalid');
      const err = card?.querySelector('.source-error');
      if (err) { err.hidden = false; err.textContent = errors.join(' '); }
    }
    if (out) {
      out.className = 'admin-status-panel danger';
      out.textContent = 'Fix the highlighted source tuning values before saving.';
    }
    return;
  }
  try {
    const res = await api('/api/admin/source-config', { method: 'PUT', body: { config: validation.config } });
    sourceConfig = res.config || validation.config;
    sourceDirty = false;
    renderSourceTuning(sourceConfig);
    if (out) {
      out.hidden = false;
      out.className = 'admin-status-panel ok';
      out.textContent = 'Source tuning saved.';
    }
  } catch (e) {
    if (out) {
      out.className = 'admin-status-panel danger';
      out.textContent = `Error: ${e.message || e}`;
    }
  }
}

function resetSourceTuning() {
  if (!Object.keys(sourceDefaults).length) return;
  if (!window.confirm('Reset source tuning to defaults?')) return;
  sourceConfig = typeof structuredClone === 'function' ? structuredClone(sourceDefaults) : JSON.parse(JSON.stringify(sourceDefaults));
  sourceDirty = true;
  renderSourceTuning(sourceConfig);
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
    renderAdminOverview();
  } catch (e) {
    contributionData = { error: e.message || 'Unknown error', items: [], counts: { total: 0, reviews: 0, photos: 0, data: 0 } };
    renderContribQueue();
    renderAdminOverview();
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

function renderAdminOverview() {
  const cards = $('#adminOverviewCards');
  const needs = $('#adminNeedsList');
  const rail = $('#adminRail');
  if (!cards || !needs || !rail) return;
  const providerStates = providerRows().map(row => ({ row, health: classifyProviderHealth(row) }));
  const running = adminRuns.find(run => classifyJobRun(run).label === 'Running');
  const hardJobs = adminRuns.filter(run => classifyJobRun(run).needsAttention);
  const blockedProviders = providerStates.filter(x => x.health.blocked || x.health.tone === 'danger');
  const quotaProviders = providerStates.filter(x => x.health.quotaLimited);
  const pending = Number(contributionData?.counts?.total || 0);
  const coverage = adminHealth?.coverage || {};
  const quotaPressure = (adminHealth?.quota || []).filter(q => Number(q.cap || 0) > 0 && Number(q.used || 0) / Number(q.cap || 1) >= 0.75);
  cards.innerHTML = [
    summaryCard('System ready', setupRows.some(r => !r.ok && !r.optional) ? 'Action needed' : 'Ready', setupRows.some(r => !r.ok && !r.optional) ? 'warn' : 'ok', 'Core setup and required providers.'),
    summaryCard('Catalog coverage', `${Number(coverage.total_sets || 0).toLocaleString()} sets`, 'ok', `${Number(coverage.total_minifigs || 0).toLocaleString()} minifigs tracked.`),
    summaryCard('Running job', running ? `#${running.id}` : 'None', running ? 'warn' : 'neutral', running ? jobProgressSummary(running).label : 'Safe slices can be started.'),
    summaryCard('Provider issues', blockedProviders.length, blockedProviders.length ? 'danger' : 'ok', `${quotaProviders.length} quota-limited providers.`),
    summaryCard('Pending contributions', pending, pending ? 'warn' : 'ok', 'Reviews, photos, and data fixes awaiting moderation.'),
    summaryCard('Daily quota pressure', quotaPressure.length, quotaPressure.length ? 'warn' : 'ok', quotaPressure.length ? quotaPressure.map(q => q.service).join(', ') : 'Within daily budgets.'),
  ].join('');
  const actionItems = [
    ...hardJobs.slice(0, 2).map(run => actionItem('Hard job error', `Job #${run.id}: ${classifyJobRun(run).label}`, '#adminJobs', 'danger')),
    ...blockedProviders.slice(0, 4).map(x => actionItem(`${providerLabel(x.row.service)} blocked`, x.health.action, '#adminProviders', 'danger')),
    ...quotaProviders.slice(0, 3).map(x => actionItem(`${providerLabel(x.row.service)} quota`, x.health.action, '#adminProviders', 'warn')),
    ...setupRows.filter(r => !r.ok).slice(0, 3).map(r => actionItem(r.optional ? 'Optional setup' : 'Setup needed', `${r.label}: ${r.missText}`, '#adminOverview', r.optional ? 'neutral' : 'warn')),
  ];
  if (!actionItems.length) actionItems.push(actionItem('Nothing urgent', 'Core systems look ready. Keep Populate all safe sources moving in small slices.', '#adminPopulate', 'ok'));
  needs.innerHTML = actionItems.join('');
  rail.innerHTML = actionItems.slice(0, 5).join('');
}

function summaryCard(label, value, tone, body) {
  return `
    <article class="admin-summary-card ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <p>${escapeHtml(body)}</p>
    </article>`;
}

function actionItem(title, body, href, tone) {
  return `
    <a class="admin-action-item ${tone}" href="${escapeHtml(href)}">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </a>`;
}

function quotaFor(service) {
  const name = String(service || '').toLowerCase();
  return (adminHealth?.quota || []).find(q => String(q.service || '').toLowerCase() === name) || null;
}

function providerGroupFor(service) {
  const name = String(service || '').toLowerCase();
  const found = PROVIDER_GROUPS.find(([, keys]) => keys.some(key => name.includes(key)));
  return found ? found[0] : 'Optional';
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
