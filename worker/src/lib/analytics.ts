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
