import type { Env } from '../types';

export type AnalyticsEvent =
  | 'set_viewed'
  | 'set_added'
  | 'set_sold'
  | 'set_removed'
  | 'valuation_triggered'
  | 'advisor_used'
  | 'scan_used'
  | 'minifig_owned'
  | 'wishlist_added';

function fnv32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}

export function logEvent(
  env: Env,
  event: AnalyticsEvent,
  userId: string,
  meta: { setNum?: string; figNum?: string } = {},
): void {
  if (!env.ANALYTICS) return;
  try {
    const userHash = fnv32(userId).toString(16);
    env.ANALYTICS.writeDataPoint({
      blobs: [event, meta.setNum || '', meta.figNum || ''],
      doubles: [Date.now()],
      indexes: [userHash],
    });
  } catch { /* non-fatal */ }
}

// Client telemetry events (POST /api/telemetry). Allowlisted so the public
// endpoint can't be used to stuff arbitrary blobs into the dataset.
export const CLIENT_EVENTS = new Set([
  'route_view',
  'scan_attempt', 'scan_success', 'scan_fallback',
  'feature_open',
  'client_error',
]);

export function logClientEvent(env: Env, event: string, detail: string): void {
  if (!env.ANALYTICS) return;
  try {
    env.ANALYTICS.writeDataPoint({
      blobs: ['client:' + event, String(detail || '').slice(0, 120), ''],
      doubles: [Date.now()],
      indexes: ['client'],
    });
  } catch { /* non-fatal */ }
}

// Events whose daily counts are mirrored into D1 so the admin panel can
// compute SLOs (scan success rate). route_view is deliberately AE-only —
// highest volume, no SLO value.
const MIRROR_EVENTS = new Set(['scan_attempt', 'scan_success', 'scan_fallback', 'client_error']);

export async function mirrorClientMetric(env: Env, event: string, detail: string): Promise<void> {
  if (!MIRROR_EVENTS.has(event)) return;
  // Keep PK cardinality bounded: only scan modes carry a detail dimension.
  const d = event === 'client_error' ? '' : String(detail || '').slice(0, 24);
  await env.DB.prepare(`
    INSERT INTO client_metrics_daily (day, event, detail, count)
    VALUES (date('now'), ?, ?, 1)
    ON CONFLICT (day, event, detail) DO UPDATE SET count = count + 1
  `).bind(event, d).run().catch(() => {});
}
