const DEFAULT_MAX_ISSUES = 12;
const DEFAULT_STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const SERVICE_FLAGS = {
  brickinsights: 'brickinsights',
  firecrawl: 'firecrawl',
};

const PRICING_SERVICES = new Set([
  'bricklink', 'brickeconomy', 'ebay', 'pricecharting',
  'brickinsights', 'amazon', 'firecrawl', 'brightdata', 'decodo', 'zenrows',
]);
const CATALOG_SERVICES = new Set(['rebrickable', 'brickset', 'upc']);
const AI_SERVICES = new Set(['gemini', 'openai', 'openrouter', 'opencodex', 'workersai', 'groq']);
// Sources disabled by default require positive effective-config evidence before an
// integration failure can be called an outage. Keep this aligned with the
// server's DEFAULT_SOURCE_CONFIG opt-in entries. (BrickPicker was the last one;
// it has been removed from the server config entirely.)
const OPT_IN_TUNABLE_SERVICES = new Set([]);

const PRIORITY = { access: 0, credits: 1, error: 2, degraded: 3, stale: 4, unknown: 5 };

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

// A 429 or a spent quota is the provider saying "not now", and it recovers on
// its own. It is shown as "Quota limited" under Services, never as an issue.
function isQuotaRefusal(row) {
  const message = typeof row.last_error === 'string' ? row.last_error : '';
  return /HTTP 429|EXCEED_LIMIT|quota|rate limit|daily cap|credit ceiling|too many requests/i.test(message);
}

// Every key out of paid credits: needs a top-up or the source turned off, so it
// stays an issue (unlike a 429, which recovers by itself).
function isCreditExhaustion(row) {
  const message = typeof row.last_error === 'string' ? row.last_error : '';
  return /credits left|out of credits|insufficient credits|HTTP 402|payment required/i.test(message);
}

function isProviderSideFailure(row) {
  const message = typeof row.last_error === 'string' ? row.last_error : '';
  return /HTTP 5\d\d|service unavailable|bad gateway|gateway timeout/i.test(message);
}

function issueCopy(kind, label, row) {
  if (kind === 'access' && AI_SERVICES.has(String(row.service).toLowerCase())
    && row.configured !== false && row.status !== 'unconfigured') {
    return { title: `${label} needs a new key`, detail: 'The provider rejected the server key. AI routing skips it until the key works again.' };
  }
  if (kind === 'access') return { title: `${label} needs access`, detail: 'Required configuration is not available.' };
  if (kind === 'credits') return { title: `${label} is out of credits`, detail: 'Every key has spent its credits. Top up or turn the source off; a topped-up key is re-enabled by the daily check.' };
  if (kind === 'error' && isProviderSideFailure(row)) {
    return { title: `${label} is unavailable`, detail: 'The provider is returning server errors. Jobs retry on their next run.' };
  }
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

    // Not set up is a setup choice, not a health problem (Amazon waits on its
    // Associates approval). A service that was called and failed still shows.
    if ((row.configured === false || row.status === 'unconfigured') && !row.last_error) continue;

    const observation = observationTimestamp(row, now);
    const evidenceAt = observation?.value || null;
    // The server says how long each service's evidence stays valid: on-demand
    // services (push, fallback AI providers) are legitimately quiet for days.
    const rowStaleMs = Number(row.stale_after_hours) > 0 ? Number(row.stale_after_hours) * 60 * 60 * 1000 : staleAfterMs;
    const stale = observation ? now - observation.time > rowStaleMs : false;
    let kind = null;

    const fresh = observation && !stale;
    if (fresh && row.status === 'ok') continue;
    if (fresh && isCreditExhaustion(row) && row.status !== 'ok') kind = 'credits';
    else if (fresh && isQuotaRefusal(row) && row.status !== 'down' && row.reachable !== false) continue;
    else if (!observation) kind = 'unknown';
    else if (stale) kind = 'stale';
    else if (isAccessFailure(row) && row.status === 'degraded' && row.configured !== false) kind = 'access';
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
      severity: kind === 'access' || kind === 'error' || kind === 'credits' ? 'danger' : kind === 'degraded' || kind === 'stale' ? 'warn' : 'neutral',
      ...issueCopy(kind, label, row),
      evidenceAt,
      ...remedyFor(row.service),
    });
  }

  return issues
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || a.service.localeCompare(b.service))
    .slice(0, Math.max(0, maxIssues));
}
