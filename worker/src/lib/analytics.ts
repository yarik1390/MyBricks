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
  'scan_attempt', 'scan_success', 'scan_fallback', 'scan_path',
  'feature_open',
  'client_error',
  'api_error',
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
const MIRROR_EVENTS = new Set(['scan_attempt', 'scan_success', 'scan_fallback', 'scan_path', 'client_error', 'api_error', 'server_error']);

// client_error keeps only its "@file.js:line" (or "unhandled") so the D1 key
// stays bounded by code locations, not by free-form messages.
function mirrorDetail(event: string, detail: string): string {
  const d = String(detail || '');
  if (event === 'client_error') {
    if (d.startsWith('unhandled')) return 'unhandled';
    const at = d.lastIndexOf('@');
    return at >= 0 ? d.slice(at + 1, at + 33) : '';
  }
  return d.slice(0, 32);
}

export async function mirrorClientMetric(env: Env, event: string, detail: string): Promise<void> {
  if (!MIRROR_EVENTS.has(event)) return;
  const d = mirrorDetail(event, detail);
  await env.DB.prepare(`
    INSERT INTO client_metrics_daily (day, event, detail, count)
    VALUES (date('now'), ?, ?, 1)
    ON CONFLICT (day, event, detail) DO UPDATE SET count = count + 1
  `).bind(event, d).run().catch(() => {});
}
