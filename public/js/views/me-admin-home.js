// Admin console: the Today start page, the Jobs list, and the summary tiles on
// Pricing and Users. Rendering only: me-admin.js owns loading, state and wiring;
// the pure maths lives in lib/admin-home.js.
import { escapeHtml } from '../utils.js';
import { formatRelativeTime } from '../lib/pure.js';
import { getLocale } from '../lib/i18n.js';
import {
  processHealth, summarizeJobHealth, sortProcesses, processProblemLine, runDots,
  quotaRows, scanFunnel, scanOutcomes, aiTotals, pct,
} from '../lib/admin-home.js';

const fmt = (v) => Number(v || 0).toLocaleString();
const when = (ts) => {
  if (!ts) return '—';
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(String(ts)) ? String(ts) : `${String(ts).replace(' ', 'T')}Z`;
  return formatRelativeTime(iso, Date.now(), getLocale());
};
const DOT = { ok: 'ok', failing: 'bad', missed: 'warn', running: 'run', idle: 'idle' };

function dotsHTML(p) {
  const dots = runDots(p);
  if (!dots.length) return '';
  return `<span class="adm-runs" aria-label="Last ${dots.length} runs: ${dots.filter(d => d === 'failed').length} failed">${dots.map(d => `<i class="is-${d}"></i>`).join('')}</span>`;
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/**
 * Items that need the admin, most urgent first: jobs that stopped firing, then
 * service issues, then failing jobs. `canRun(name)` says whether a job has a
 * Run now action.
 */
export function needsYouItems({ processes = [], issues = [], canRun = () => false } = {}) {
  const items = [];
  const jobs = sortProcesses(processes).filter(p => ['missed', 'failing'].includes(processHealth(p)));
  const jobItem = (p) => {
    const h = processHealth(p);
    return {
      kind: 'job',
      tone: 'bad',
      title: h === 'missed'
        ? `${p.label} has not run since ${dateShort(p.started_at)}`
        : `${p.label} is failing`,
      detail: `${processProblemLine(p)}${p.schedule ? ` · ${p.schedule}` : ''}`,
      side: h === 'missed' ? 'missed' : `${Math.max(1, Number(p.consecutive_failures || 1))}× failed`,
      name: p.name,
      canRun: canRun(p.name) && h !== 'running',
    };
  };
  for (const p of jobs.filter(p => processHealth(p) === 'missed')) items.push(jobItem(p));
  for (const issue of issues.filter(i => i.severity === 'danger')) items.push(issueItem(issue));
  for (const p of jobs.filter(p => processHealth(p) === 'failing')) items.push(jobItem(p));
  for (const issue of issues.filter(i => i.severity !== 'danger')) items.push(issueItem(issue));
  return items;
}

function issueItem(issue) {
  return {
    kind: 'service',
    tone: issue.severity === 'danger' ? 'bad' : 'warn',
    title: issue.title,
    detail: issue.detail,
    side: issue.evidenceAt ? when(issue.evidenceAt) : '',
    href: issue.href,
    label: issue.label,
    kindLabel: issue.kindLabel || '',
  };
}

function dateShort(ts) {
  const t = Date.parse(`${String(ts || '').replace(' ', 'T')}${String(ts || '').includes('Z') ? '' : 'Z'}`);
  if (!Number.isFinite(t)) return 'a while';
  return new Date(t).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
}

function needsYouHTML(items) {
  if (!items.length) {
    return `<div class="adm-card adm-empty"><span class="adm-dot is-ok"></span><div><strong>Nothing needs you</strong><p>Every scheduled job ran on time and no service reports a problem.</p></div></div>`;
  }
  const VISIBLE = 6;
  const itemHTML = (item) => `
    <div class="adm-item">
      <span class="adm-dot is-${item.tone}"></span>
      <div class="adm-item-body">
        ${item.kind === 'job'
          ? `<button type="button" class="adm-item-title" data-admin-section-jump="adminJobs" data-job-focus="${escapeHtml(item.name)}">${escapeHtml(item.title)}</button>`
          : `<strong>${escapeHtml(item.title)}</strong>`}
        <p>${item.kindLabel ? `<span class="adm-kind">${escapeHtml(item.kindLabel)}</span> ` : ''}${escapeHtml(item.detail || '')}</p>
        ${(item.kind === 'job' && item.canRun) || (item.kind === 'service' && item.href) ? `<div class="adm-acts">
          ${item.kind === 'job' && item.canRun ? `<button type="button" class="adm-btn is-primary" data-process-run="${escapeHtml(item.name)}">Run now</button>` : ''}
          ${item.kind === 'service' && item.href ? `<a class="adm-btn" href="${escapeHtml(item.href)}">${escapeHtml(item.label || 'Open')}</a>` : ''}
        </div>` : ''}
      </div>
      ${item.side ? `<span class="adm-side">${escapeHtml(item.side)}</span>` : ''}
    </div>`;
  const head = items.slice(0, VISIBLE).map(itemHTML).join('');
  const rest = items.slice(VISIBLE);
  return `<div class="adm-card adm-list">${head}${rest.length ? `
    <details class="adm-more"><summary>Show ${rest.length} more</summary>${rest.map(itemHTML).join('')}</details>` : ''}</div>`;
}

// "12 on time": the count and its words go in as one escaped value (admin copy is English-only).
const countText = (count, words) => `${Number(count || 0).toLocaleString()} ${words}`;
const legend = (tone, count, words) => `<span><span class="adm-dot is-${tone}"></span>${escapeHtml(countText(count, words))}</span>`;

export function jobsBarHTML(processes = []) {
  const s = summarizeJobHealth(processes);
  if (!s.total) return '<div class="adm-card adm-muted">Loading jobs…</div>';
  const seg = (count, cls) => (count ? `<span class="is-${cls}" style="flex:${count}"></span>` : '');
  return `
    <div class="adm-card adm-jobsbar">
      <div class="adm-jobsbar-main">
        <div class="adm-stack" role="img" aria-label="${s.ok} on time, ${s.failing} failing, ${s.missed} missed">${seg(s.ok, 'ok')}${seg(s.running, 'run')}${seg(s.failing, 'bad')}${seg(s.missed, 'warn')}${seg(s.idle, 'idle')}</div>
        <div class="adm-legend">
          ${legend('ok', s.ok, 'on time')}
          ${s.running ? legend('run', s.running, 'running') : ''}
          ${legend('bad', s.failing, 'failing')}
          ${legend('warn', s.missed, 'missed')}
          ${s.idle ? legend('idle', s.idle, 'not run yet') : ''}
        </div>
      </div>
      <button type="button" class="adm-btn" data-admin-section-jump="adminJobs">Open</button>
    </div>`;
}

export function quotasHTML(todayRows = [], yesterdayRows = []) {
  const all = quotaRows(todayRows, yesterdayRows);
  if (!all.length) return '<div class="adm-card adm-muted">No daily limits recorded yet today.</div>';
  const rows = all.filter(r => r.used > 0 || r.yesterday_pct >= 0.5);
  const quiet = all.length - rows.length;
  return `<div class="adm-card adm-quotas">${rows.map(r => {
    const tone = r.full_today ? 'bad' : (r.full_yesterday || r.near_yesterday || r.pct >= 0.9) ? 'warn' : '';
    const note = r.full_today ? 'full today' : r.full_yesterday ? 'full yesterday' : r.near_yesterday ? `${Math.round(r.yesterday_pct * 100)}% yesterday` : '';
    return `
      <div class="adm-quota">
        <span class="adm-quota-name">${escapeHtml(r.label)}</span>
        <span class="adm-bar"><span class="${tone ? `is-${tone}` : ''}" style="width:${Math.max(2, Math.round(r.pct * 100))}%"></span></span>
        <span class="adm-quota-val">${fmt(r.used)} / ${fmt(r.cap)}${note ? `<em>${escapeHtml(note)}</em>` : ''}</span>
      </div>`;
  }).join('')}${quiet ? `<p class="adm-note">${quiet} more limits unused so far today</p>` : ''}</div>`;
}

function tile(value, label, sub = '', tone = '') {
  return `<div class="adm-tile"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span>${sub ? `<small class="${tone ? `is-${tone}` : ''}">${escapeHtml(sub)}</small>` : ''}</div>`;
}

export function appTilesHTML(summary, aiUsage) {
  if (!summary) return '<div class="adm-card adm-muted">Loading app numbers…</div>';
  const u = summary.users || {};
  const f = scanFunnel(summary.events_7d || {});
  const ai = aiTotals(aiUsage);
  const ev = summary.events_7d || {};
  const errors = Number(ev.api_error || 0) + Number(ev.client_error || 0) + Number(ev.server_error || 0);
  return `<div class="adm-tiles">
    ${tile(fmt(u.total), 'accounts', u.new_7d ? `+${fmt(u.new_7d)} this week` : 'none new this week', u.new_7d ? 'up' : '')}
    ${tile(fmt(u.with_sets), 'with sets', `${fmt(u.sets_logged)} sets`)}
    ${tile(fmt(u.wishlist_items), 'wishlist items')}
    ${tile(fmt(f.attempts), 'scan attempts', f.rate == null ? 'no scans' : `${f.rate}% identified`, f.rate != null && f.rate < 50 ? 'down' : '')}
    ${tile(fmt(ai.calls), 'AI calls', `$${ai.cost.toFixed(2)}`)}
    ${tile(fmt(errors), 'app errors', `${fmt(ev.api_error)} API · ${fmt(ev.client_error)} app`, errors ? 'down' : '')}
  </div>`;
}

export function todayHTML({ processes, issues, canRun, quotaToday, quotaYesterday, summary, aiUsage, loaded }) {
  const items = needsYouItems({ processes, issues, canRun });
  const status = !loaded
    ? `<div class="adm-status is-idle"><span class="adm-dot is-idle"></span><div><strong>Checking…</strong><small>Loading jobs and services.</small></div></div>`
    : items.length
      ? `<div class="adm-status is-bad"><span class="adm-dot is-bad"></span><div><strong>${items.length === 1 ? '1 thing needs you' : `${items.length} things need you`}</strong><small>Everything else is running.</small></div></div>`
      : `<div class="adm-status is-ok"><span class="adm-dot is-ok"></span><div><strong>All good</strong><small>Jobs are on schedule and services are healthy.</small></div></div>`;
  return `
    ${status}
    <div class="adm-today-grid">
      <div class="adm-col">
        <div class="adm-h"><h3>Needs you</h3><span>most urgent first</span></div>
        ${loaded ? needsYouHTML(items) : '<div class="adm-card adm-muted">Loading…</div>'}
        <div class="adm-h"><h3>Background jobs</h3><span>${summarizeJobHealth(processes).scheduled} scheduled</span></div>
        ${jobsBarHTML(processes)}
      </div>
      <div class="adm-col">
        <div class="adm-h"><h3>App this week</h3><span>last 7 days</span></div>
        ${appTilesHTML(summary, aiUsage)}
        <div class="adm-h"><h3>Daily limits</h3><span>today so far</span></div>
        ${quotasHTML(quotaToday, quotaYesterday)}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function jobFiltersHTML(processes = [], active = 'problems') {
  const s = summarizeJobHealth(processes);
  const chip = (id, label, count) => `<button type="button" class="adm-chip${active === id ? ' is-on' : ''}" data-job-filter="${id}" aria-pressed="${active === id}">${escapeHtml(label)} <span>${count}</span></button>`;
  return `${chip('problems', 'Problems', s.problems)}${chip('all', 'All', s.total)}${chip('running', 'Running', s.running)}`;
}

function jobRowHTML(p, { canRun, open }) {
  const h = processHealth(p);
  const dur = p.duration_ms ? ` · ${(Number(p.duration_ms) / 1000).toFixed(1)}s` : '';
  const last = p.finished_at || p.started_at;
  const result = p.status === 'failed' ? (p.error || 'failed') : (p.summary || '');
  return `
    <details class="adm-job is-${h}" data-job="${escapeHtml(p.name)}"${open ? ' open' : ''}>
      <summary>
        <span class="adm-dot is-${DOT[h]}"></span>
        <span class="adm-job-main">
          <strong>${escapeHtml(p.label)}</strong>
          <small>${escapeHtml(processProblemLine(p))}</small>
          ${dotsHTML(p)}
        </span>
        <span class="adm-job-when">${escapeHtml(last ? when(last) : 'never')}<br><span>${escapeHtml(p.schedule || '')}</span></span>
      </summary>
      <div class="adm-job-body">
        <p>${escapeHtml(p.description || '')}</p>
        <dl>
          <dt>Schedule</dt><dd>${escapeHtml(p.schedule || 'Manual')}</dd>
          <dt>Last run</dt><dd>${last ? `${escapeHtml(when(last))}${escapeHtml(dur)} · ${escapeHtml(p.status)}` : 'Never'}</dd>
          ${result ? `<dt>Result</dt><dd class="${p.status === 'failed' ? 'is-bad' : ''}">${escapeHtml(String(result).slice(0, 300))}</dd>` : ''}
          ${h === 'missed' ? `<dt>Expected</dt><dd>every ${p.every_hours >= 168 ? 'week' : p.every_hours === 1 ? 'hour' : 'day'}; ${escapeHtml(processProblemLine(p).toLowerCase())}</dd>` : ''}
        </dl>
        ${canRun(p.name) && h !== 'running' ? `<div class="adm-acts"><button type="button" class="adm-btn is-primary admin-proc-run" data-process-run="${escapeHtml(p.name)}">Run now</button></div>` : ''}
      </div>
    </details>`;
}

export function jobsListHTML(activity, { filter = 'problems', canRun = () => false, openSet = new Set() } = {}) {
  const processes = activity?.processes || [];
  if (!processes.length) return '<div class="adm-card adm-muted">Loading jobs…</div>';
  const row = (p) => jobRowHTML(p, { canRun, open: openSet.has(p.name) });
  if (filter === 'problems') {
    const problems = sortProcesses(processes).filter(p => ['missed', 'failing'].includes(processHealth(p)));
    const recent = sortProcesses(processes).filter(p => processHealth(p) === 'ok').slice(0, 4);
    return `
      ${problems.length
        ? `<div class="adm-card adm-list">${problems.map(row).join('')}</div>`
        : `<div class="adm-card adm-empty"><span class="adm-dot is-ok"></span><div><strong>No problems</strong><p>Every scheduled job ran on time and finished.</p></div></div>`}
      <div class="adm-grp">Healthy, most recent</div>
      <div class="adm-card adm-list">${recent.map(row).join('')}</div>
      <p class="adm-note">${processes.length - problems.length - recent.length > 0 ? `+ ${processes.length - problems.length - recent.length} more under All` : ''}</p>`;
  }
  if (filter === 'running') {
    const running = processes.filter(p => processHealth(p) === 'running');
    return running.length
      ? `<div class="adm-card adm-list">${running.map(row).join('')}</div>`
      : '<div class="adm-card adm-muted">Nothing is running right now.</div>';
  }
  const order = activity.group_order || [];
  const groups = new Map();
  for (const p of processes) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  const names = [...order.filter(g => groups.has(g)), ...[...groups.keys()].filter(g => !order.includes(g))];
  return names.map(g => `<div class="adm-grp">${escapeHtml(g)}</div><div class="adm-card adm-list">${sortProcesses(groups.get(g)).map(row).join('')}</div>`).join('');
}

// ---------------------------------------------------------------------------
// Pricing + Users summary tiles
// ---------------------------------------------------------------------------

export function pricingKeysHTML(summary, quality) {
  const cat = summary?.catalog || {};
  const held = summary?.held_sets || {};
  const anomalies = (quality?.anomalies || []).reduce((s, r) => s + Number(r.count || 0), 0);
  const onHold = (quality?.mappings || []).filter(r => r.status === 'quarantined').reduce((s, r) => s + Number(r.count || 0), 0);
  const catPct = pct(cat.market_priced, cat.total);
  const heldPct = pct(held.market_priced, held.total);
  return `<div class="adm-tiles adm-tiles-2">
    ${tile(summary ? fmt(cat.total) : '…', 'sets in catalog')}
    ${tile(catPct == null ? '…' : `${catPct}%`, 'have a real market price', summary ? `${fmt(cat.market_priced)} sets · rest are "~" estimates` : '')}
    ${tile(heldPct == null ? '…' : `${heldPct}%`, 'of owned & wishlisted sets priced', summary ? `${fmt(held.market_priced)} of ${fmt(held.total)}` : '')}
    ${tile(quality ? fmt(anomalies) : '…', 'open price warnings', quality ? (anomalies ? 'values held back until resolved' : 'none open') : '', anomalies ? 'down' : '')}
  </div>
  ${quality && onHold ? `<p class="adm-note">${fmt(onHold)} PriceCharting matches are on hold. They never feed a price; the hourly triage settles what it can.</p>` : ''}`;
}

const SCAN_MODE_LABEL = { image: 'Photo scans', shelf: 'Shelf scans', barcode: 'Barcode lookups' };
const topList = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');

const scanOutcomeTitle = (m) => `${SCAN_MODE_LABEL[m.mode] || m.mode}: a set was identified in ${fmt(m.hits)} of ${fmt(m.total)} (${m.rate}%)`;
const scanAnsweredLine = (m) => `Answered by: ${topList(m.steps)}`;
const scanMissedLine = (m) => `Not found: ${topList(m.reasons)}`;

/** What happened to scans that reached the server (scan_outcome metric). */
export function scanOutcomesHTML(rows) {
  const modes = scanOutcomes(rows);
  if (!modes.length) return '<p class="adm-note">No scans have reached the server since this counter started.</p>';
  return `<div class="adm-list">${modes.map((m) => `
    <div class="adm-item"><span class="adm-dot ${m.rate >= 50 ? 'is-ok' : 'is-warn'}"></span><div class="adm-item-body">
      <strong>${escapeHtml(scanOutcomeTitle(m))}</strong>
      ${Object.keys(m.steps).length ? `<p>${escapeHtml(scanAnsweredLine(m))}</p>` : ''}
      ${Object.keys(m.reasons).length ? `<p>${escapeHtml(scanMissedLine(m))}</p>` : ''}
    </div></div>`).join('')}</div>`;
}

const scanRateLine = (rate) => `${rate}% of scans ended with the set identified.`;

export function usersStatsHTML(summary) {
  if (!summary) return '<div class="adm-card adm-muted">Loading…</div>';
  const u = summary.users || {};
  const f = scanFunnel(summary.events_7d || {});
  const max = Math.max(1, f.attempts, f.sent, f.fallback, f.success);
  const bar = (v, label, cls = '') => `<div class="adm-funnel-col"><span class="adm-funnel-n">${fmt(v)}</span><span class="adm-funnel-bar${cls}" style="height:${Math.max(4, Math.round((v / max) * 100))}%"></span><span class="adm-funnel-l">${label}</span></div>`;
  return `
    <div class="adm-tiles">
      ${tile(fmt(u.total), 'accounts', u.new_7d ? `+${fmt(u.new_7d)} this week` : 'none new this week', u.new_7d ? 'up' : '')}
      ${tile(fmt(u.with_sets), 'have sets', pct(u.with_sets, u.total) == null ? '' : `${pct(u.with_sets, u.total)}%`)}
      ${tile(fmt(u.new_30d), 'new in 30 days')}
    </div>
    <div class="adm-h"><h3>Scanner</h3><span>last 7 days</span></div>
    <div class="adm-card">
      ${f.attempts ? `<div class="adm-funnel">${bar(f.attempts, 'attempts')}${bar(f.sent, 'sent')}${bar(f.fallback, 'fallback')}${bar(f.success, 'identified', ' is-ok')}</div>
      <p class="adm-note">${escapeHtml(scanRateLine(f.rate))}</p>` : '<p class="adm-note">No scans in the last 7 days.</p>'}
    </div>
    <div class="adm-h"><h3>Scans that reached the server</h3><span>last 7 days</span></div>
    <div class="adm-card">${scanOutcomesHTML(summary.scan_outcomes_7d)}</div>`;
}
