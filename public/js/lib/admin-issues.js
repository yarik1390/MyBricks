const DEFAULT_MAX_ISSUES = 6;
const DEFAULT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const SERVICE_FLAGS = {
  ebay: 'ebay_sold_comps',
  brickowl: 'brickowl',
  brickinsights: 'brickinsights',
  firecrawl: 'firecrawl',
  stockx: 'stockx',
};

const PRICING_SERVICES = new Set([
  'bricklink', 'brickeconomy', 'ebay', 'brickowl', 'pricecharting',
  'brickpicker', 'brickinsights', 'amazon', 'firecrawl', 'brightdata', 'stockx',
]);
const CATALOG_SERVICES = new Set(['rebrickable', 'brickset', 'upc']);
const AI_SERVICES = new Set(['gemini', 'openai', 'openrouter', 'omniroute', 'merge']);
// Sources disabled by default require positive effective-config evidence before an
// integration failure can be called an outage. Keep this aligned with the
// server's DEFAULT_SOURCE_CONFIG opt-in entries.
const OPT_IN_TUNABLE_SERVICES = new Set(['brickpicker']);

const PRIORITY = { access: 0, error: 1, degraded: 2, stale: 3, unknown: 4 };

function observationTimestamp(row, now) {
  const value = row?.last_checked_at;
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > now) return null;
  return { value, time };
}

function remedyFor(service) {
  if (PRICING_SERVICES.has(service)) {
    return { href: '#/me/admin?hub=pricing&view=center', label: 'Review pricing services' };
  }
  if (CATALOG_SERVICES.has(service)) {
    return { href: '#/me/admin?hub=pricing&view=populate', label: 'Review catalog sources' };
  }
  if (AI_SERVICES.has(service)) {
    return { href: '#/me/admin?hub=ai', label: 'Review AI routing' };
  }
  if (service === 'email' || service === 'push' || service === 'firebase' || service === 'google') {
    return { href: '#/me/admin?hub=governance&view=maintenance', label: 'Review service settings' };
  }
  return { href: '#/me/admin', label: 'Review services' };
}

function isAccessFailure(row) {
  if (row.configured === false || row.status === 'unconfigured') return true;
  const message = typeof row.last_error === 'string' ? row.last_error : '';
  return /\b(?:401|403)\b|unauthori[sz]ed|forbidden|invalid[_ -]?(?:client|key|token)|access denied|credential|permission/i.test(message);
}

function issueCopy(kind, label) {
  if (kind === 'access') return { title: `${label} needs access`, detail: 'Required configuration is not available.' };
  if (kind === 'error') return { title: `${label} is unavailable`, detail: 'A recent health check failed.' };
  if (kind === 'degraded') return { title: `${label} is degraded`, detail: 'A recent health check reported reduced service.' };
  if (kind === 'stale') return { title: `${label} evidence is stale`, detail: 'The last observation is too old to confirm current health.' };
  return { title: `${label} health is unknown`, detail: 'No current health evidence is available.' };
}

/**
 * Build a bounded, deterministic issue list from already-loaded diagnostics.
 * Deliberately excludes raw error fields: callers receive only safe fixed copy.
 */
export function buildAdminIssues({
  diagnostics,
  featureFlags = {},
  sourceConfig,
  now = Date.now(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  maxIssues = DEFAULT_MAX_ISSUES,
} = {}) {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return [{
      service: 'diagnostics',
      label: 'Service diagnostics',
      kind: 'unknown',
      severity: 'neutral',
      title: 'Service evidence is unavailable',
      detail: 'Overview could not confirm current service health.',
      evidenceAt: null,
      ...remedyFor('diagnostics'),
    }];
  }

  const issues = [];
  for (const row of diagnostics) {
    if (!row || typeof row.service !== 'string') continue;
    const service = row.service.toLowerCase();
    const flag = SERVICE_FLAGS[service];
    const tuning = sourceConfig && typeof sourceConfig === 'object' ? sourceConfig[service] : undefined;
    // Integration diagnostics do not expose source tuning. Use the effective
    // config returned by /api/admin/source-config instead of a synthetic row
    // property, while retaining explicit backend disabled statuses.
    if (tuning?.enabled === false || row.status === 'disabled') continue;
    // Unknown tuning must not turn a default-off, opt-in source into an outage.
    if (OPT_IN_TUNABLE_SERVICES.has(service) && tuning?.enabled !== true) continue;
    // A missing flag snapshot is not evidence that a runtime-disabled source is
    // enabled. Suppress flag-governed sources until the effective state is known.
    if (flag && featureFlags[flag] !== true) continue;

    const observation = observationTimestamp(row, now);
    const evidenceAt = observation?.value || null;
    const stale = observation ? now - observation.time > staleAfterMs : false;
    let kind = null;

    if (!observation) kind = 'unknown';
    else if (stale) kind = 'stale';
    else if (isAccessFailure(row) && (row.configured === false || row.status === 'unconfigured' || row.reachable === false || row.status === 'down')) kind = 'access';
    else if (row.reachable === false || row.status === 'down') kind = 'error';
    else if (row.degraded === true || row.status === 'degraded') kind = 'degraded';
    else if (row.status === 'unknown' || row.reachable == null) kind = 'unknown';
    if (!kind) continue;

    const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : row.service;
    issues.push({
      service: row.service,
      label,
      kind,
      severity: kind === 'access' || kind === 'error' ? 'danger' : kind === 'degraded' || kind === 'stale' ? 'warn' : 'neutral',
      ...issueCopy(kind, label),
      evidenceAt,
      ...remedyFor(row.service),
    });
  }

  return issues
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.service.localeCompare(b.service))
    .slice(0, Math.max(0, maxIssues));
}
