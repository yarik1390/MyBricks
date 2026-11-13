// Pure helpers for the admin start page (Today) and Jobs tab: no DOM, no state.
// Inputs are the raw API payloads (/api/admin/activity, /api/admin/integrations,
// /api/admin/summary); outputs are plain data the views render.

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Health of one background process, using the server's schedule-aware verdict when present. */
export function processHealth(p = {}) {
  const h = String(p.health || '');
  if (['ok', 'failing', 'missed', 'running', 'idle'].includes(h)) return h;
  if (p.status === 'running') return 'running';
  if (p.status === 'failed') return 'failing';
  if (p.status === 'ok') return 'ok';
  return 'idle';
}

/** Counts for the jobs bar: on time / failing / missed / running / not run yet. */
export function summarizeJobHealth(processes = []) {
  const out = { total: 0, ok: 0, failing: 0, missed: 0, running: 0, idle: 0, scheduled: 0 };
  for (const p of processes) {
    const h = processHealth(p);
    out.total++;
    out[h]++;
    if (p.every_hours != null || /^(hourly|daily|weekly)/i.test(String(p.schedule || ''))) out.scheduled++;
  }
  out.problems = out.failing + out.missed;
  return out;
}

const HEALTH_ORDER = { missed: 0, failing: 1, running: 2, ok: 3, idle: 4 };

/** Problems first (missed, then failing), then running, healthy and never-run; newest run first inside each. */
export function sortProcesses(processes = []) {
  const ts = (p) => Date.parse(String(p.started_at || '').replace(' ', 'T') + (String(p.started_at || '').includes('Z') ? '' : 'Z')) || 0;
  return processes.slice().sort((a, b) =>
    HEALTH_ORDER[processHealth(a)] - HEALTH_ORDER[processHealth(b)] || ts(b) - ts(a) || String(a.label).localeCompare(String(b.label)));
}

/** One plain-language line describing why a process is a problem (or its last result). */
export function processProblemLine(p = {}) {
  const h = processHealth(p);
  if (h === 'missed') {
    const k = n(p.missed_runs);
    const unit = n(p.every_hours) === 1 ? 'hourly' : n(p.every_hours) >= 168 ? 'weekly' : 'daily';
    return k > 1 ? `Missed ${k} ${unit} runs` : `Missed its ${unit} run`;
  }
  if (h === 'failing') {
    const k = n(p.consecutive_failures) || 1;
    const err = String(p.error || '');
    const reason = /^stale:/i.test(err)
      ? 'Cut off before finishing'
      : (p.summary || err || 'Failed').replace(/^Provider\/item failures:\s*/i, '');
    return k > 1 ? `${reason} · ${k} runs in a row` : reason;
  }
  if (h === 'running') return 'Running now';
  if (h === 'idle') return 'Not run yet';
  return p.summary || 'OK';
}

/** Dots for the last runs, oldest → newest: 'ok' | 'failed' | 'running'. */
export function runDots(p = {}, max = 12) {
  const runs = Array.isArray(p.runs) ? p.runs : [];
  return runs.slice(-max).map((r) => (r.status === 'failed' ? 'failed' : r.status === 'running' ? 'running' : 'ok'));
}

// Display names for quota ledger keys; anything else is title-cased.
const QUOTA_LABEL = {
  bricklink: 'BrickLink', ebay: 'eBay', brightdata: 'Bright Data', decodo: 'Decodo', zenrows: 'ZenRows',
  firecrawl: 'Firecrawl', pricecharting: 'PriceCharting', gemini_paid: 'Gemini (paid)', exa: 'Exa',
  workersai: 'Workers AI', brickset: 'Brickset', stores: 'Store prices', lego_local: 'LEGO.com local',
  groq: 'Groq', openrouter: 'OpenRouter', brickinsights: 'BrickInsights', rebrickable: 'Rebrickable',
};

export function quotaLabel(service) {
  const key = String(service || '');
  return QUOTA_LABEL[key] || key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Merge today's quota rows with yesterday's so the bars can warn about a limit
 * that was hit yesterday even when today has barely started. Rows with no cap
 * and no use are dropped. Sorted by the fuller of today/yesterday.
 */
export function quotaRows(today = [], yesterday = []) {
  const prev = new Map((yesterday || []).map((r) => [r.service, r]));
  return (today || [])
    .filter((r) => n(r.cap) > 0 || n(r.used) > 0)
    .map((r) => {
      const cap = n(r.cap);
      const used = n(r.used);
      const y = prev.get(r.service);
      const yPct = y && n(y.cap) > 0 ? n(y.used) / n(y.cap) : 0;
      const pct = cap > 0 ? used / cap : 0;
      return {
        service: r.service,
        label: quotaLabel(r.service),
        used,
        cap,
        pct: Math.min(1, pct),
        yesterday_pct: Math.min(1, yPct),
        full_today: cap > 0 && used >= cap,
        full_yesterday: yPct >= 0.999,
        near_yesterday: yPct >= 0.9 && yPct < 0.999,
      };
    })
    .sort((a, b) => Math.max(b.pct, b.yesterday_pct) - Math.max(a.pct, a.yesterday_pct) || a.label.localeCompare(b.label));
}

/** Scanner funnel from last-7-day client events. */
export function scanFunnel(events = {}) {
  const attempts = n(events.scan_attempt);
  const success = n(events.scan_success);
  return {
    attempts,
    sent: n(events.scan_path),
    fallback: n(events.scan_fallback),
    success,
    rate: attempts ? Math.round((success / attempts) * 100) : null,
  };
}

/**
 * Server-side scan results by mode from summary.scan_outcomes_7d
 * ([{ detail: "image:hit:brickognize", n }]): how many scans actually reached
 * the server, how many found a set, and which step answered.
 */
export function scanOutcomes(rows = []) {
  const modes = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const [mode, kind, ...rest] = String(row?.detail || '').split(':');
    const count = n(row?.n);
    if (!mode || !kind || !count) continue;
    const m = (modes[mode] ||= { mode, total: 0, hits: 0, misses: 0, errors: 0, steps: {}, reasons: {} });
    const what = rest.join(':') || 'unknown';
    m.total += count;
    if (kind === 'hit') { m.hits += count; m.steps[what] = (m.steps[what] || 0) + count; }
    else if (kind === 'err') { m.errors += count; m.reasons[what] = (m.reasons[what] || 0) + count; }
    else { m.misses += count; m.reasons[what] = (m.reasons[what] || 0) + count; }
  }
  const order = ['image', 'shelf', 'barcode'];
  return Object.values(modes)
    .map((m) => ({ ...m, rate: m.total ? Math.round((m.hits / m.total) * 100) : null }))
    .sort((a, b) => (order.indexOf(a.mode) + 9) % 9 - (order.indexOf(b.mode) + 9) % 9 || b.total - a.total);
}

/** Total AI calls and spend over the days in /integrations ai_usage.recent. */
export function aiTotals(aiUsage = {}) {
  const recent = Array.isArray(aiUsage?.recent) ? aiUsage.recent : [];
  return recent.reduce((acc, r) => ({ calls: acc.calls + n(r.calls), cost: acc.cost + n(r.cost_usd) }), { calls: 0, cost: 0 });
}

/** Percentage helper that never divides by zero; null when there is no denominator. */
export function pct(part, whole) {
  return n(whole) > 0 ? Math.round((n(part) / n(whole)) * 100) : null;
}

// ---------------------------------------------------------------------------
// Live progress of a running job and failure advice (Today "Running now",
// Jobs rows). Inputs are /api/admin/activity process rows.
// ---------------------------------------------------------------------------

const runTs = (ts) => {
  if (!ts) return NaN;
  const s = String(ts);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
};

/** "45s", "3m 05s", "1h 12m". */
export function durationText(ms) {
  const s = Math.max(0, Math.round(n(ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** No heartbeat for this long while "running" means the run was cut off (heartbeat every 20s). */
export const STALL_MS = 90_000;

/**
 * Live view of a running job: how far it is, how long it has run, when it was
 * last seen alive. `pct` is 0–1 or null (unknown). `estimated` marks a
 * percentage guessed from the usual run length rather than counted.
 */
export function liveProgress(p = {}, now = Date.now()) {
  if (processHealth(p) !== 'running') return null;
  const started = runTs(p.started_at);
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  const hb = runTs(p.heartbeat_at);
  const lastSignMs = Number.isFinite(hb) ? Math.max(0, now - hb) : elapsedMs;
  const done = p.progress_done == null ? null : n(p.progress_done);
  const total = n(p.progress_total);
  const step = p.progress_step ? String(p.progress_step) : '';
  let pct = null;
  let estimated = false;
  let countText = '';
  let etaMs = null;
  if (done != null && total > 0) {
    pct = Math.min(1, done / total);
    countText = `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
    if (pct > 0.02 && pct < 1 && elapsedMs > 10_000) etaMs = Math.round(elapsedMs * (1 - pct) / pct);
  } else if (n(p.typical_ms) > 0) {
    pct = Math.min(0.95, elapsedMs / n(p.typical_ms));
    estimated = true;
    const left = n(p.typical_ms) - elapsedMs;
    if (left > 0) etaMs = left;
  }
  const stalled = lastSignMs > STALL_MS;
  return {
    pct, estimated, step, countText, elapsedMs, lastSignMs, etaMs, stalled,
    overdue: n(p.typical_ms) > 0 && elapsedMs > n(p.typical_ms) * 3 && elapsedMs > 120_000,
  };
}

/** One line under a running job: "Step · 120 of 200 · 1m 05s · ~40s left". */
export function liveProgressLine(live) {
  if (!live) return '';
  if (live.stalled) return `No sign of life for ${durationText(live.lastSignMs)}: it was probably cut off`;
  const parts = [];
  if (live.step) parts.push(live.step);
  if (live.countText) parts.push(live.countText);
  else if (live.estimated && live.pct != null) parts.push(`~${Math.round(live.pct * 100)}% of its usual time`);
  parts.push(`running ${durationText(live.elapsedMs)}`);
  if (live.etaMs != null) parts.push(`~${durationText(live.etaMs)} left`);
  return parts.join(' · ');
}

/** Where a failed run stopped, from its last reported step: "Stopped at step 3 of 7: Matching rows to sets". */
export function stoppedAtLine(p = {}) {
  if (p.status !== 'failed' || !p.progress_step) return '';
  const total = n(p.progress_total);
  const done = n(p.progress_done);
  if (total > 0 && total <= 12) return `Stopped at step ${Math.min(done + 1, total)} of ${total}: ${p.progress_step}`;
  if (total > 0) return `Stopped after ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} (${p.progress_step})`;
  return `Stopped at: ${p.progress_step}`;
}

const ADVICE_LABEL = {
  retry: 'Retry', wait: 'Wait', key: 'Replace key', topup: 'Top up', quota: 'Limit reached', code: 'Code fix', check: 'Check',
};

/** Badge text for an advice kind. */
export function adviceLabel(kind) {
  return ADVICE_LABEL[kind] || 'Check';
}

/** Ready-to-paste message for Claude when a job needs a code fix. */
export function adviceCopyText(p = {}) {
  const lines = [
    `BricksVault admin: the background job "${p.label || p.name}" (${p.name}) is failing.`,
    `Error: ${p.error || p.summary || 'unknown'}`,
  ];
  const stop = stoppedAtLine(p);
  if (stop) lines.push(stop);
  if (n(p.consecutive_failures) > 1) lines.push(`Failed ${n(p.consecutive_failures)} runs in a row.`);
  lines.push('Please find the cause and fix it.');
  return lines.join('\n');
}
