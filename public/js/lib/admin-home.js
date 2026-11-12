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

/** Total AI calls and spend over the days in /integrations ai_usage.recent. */
export function aiTotals(aiUsage = {}) {
  const recent = Array.isArray(aiUsage?.recent) ? aiUsage.recent : [];
  return recent.reduce((acc, r) => ({ calls: acc.calls + n(r.calls), cost: acc.cost + n(r.cost_usd) }), { calls: 0, cost: 0 });
}

/** Percentage helper that never divides by zero; null when there is no denominator. */
export function pct(part, whole) {
  return n(whole) > 0 ? Math.round((n(part) / n(whole)) * 100) : null;
}
