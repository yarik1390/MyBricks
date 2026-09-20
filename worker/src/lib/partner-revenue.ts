/**
 * Partner licensing revenue meter.
 *
 * PriceCharting's written permission (Brady Haugh) covers the free app under
 * Y Z's existing Legendary subscription and requires moving to a COMMERCIAL
 * agreement once app revenue reaches $1,000/month. Nothing in the app measured
 * that, so the threshold could be crossed silently and stayed crossed.
 *
 * This records store purchase events (via the RevenueCat webhook) and reports
 * the current calendar month against the threshold.
 *
 * Honesty rules:
 *   - Only amounts we actually received are counted. A missing amount is not
 *     treated as zero revenue and not guessed from the product catalog.
 *   - Foreign-currency amounts are counted SEPARATELY, never converted at an
 *     invented exchange rate, so the USD figure is never overstated.
 */

export const PARTNER_COMMERCIAL_THRESHOLD_USD = 1000;

export interface PartnerRevenueEvent {
  eventId: string;
  userId?: string | null;
  eventType: string;
  productId?: string | null;
  amount?: number | null;
  currency?: string | null;
  eventAt?: string | null;
}

export interface PartnerRevenueStatus {
  month: string;
  usd: number;
  threshold_usd: number;
  remaining_usd: number;
  exceeded: boolean;
  /** Count of non-USD amounts this month — reported, never silently converted. */
  non_usd_events: number;
  events_counted: number;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Best-effort write. A meter failure must never break the purchase webhook. */
export async function recordPartnerRevenueEvent(
  db: D1Database,
  event: PartnerRevenueEvent,
): Promise<void> {
  const amount = Number(event.amount);
  const hasAmount = Number.isFinite(amount) && amount > 0;
  const eventType = String(event.eventType || '').toUpperCase();
  const signedAmount = eventType.includes('REFUND') || eventType.includes('CANCEL')
    ? (hasAmount ? -amount : null)
    : (hasAmount ? amount : null);
  await db
    .prepare(
      `INSERT OR IGNORE INTO partner_revenue_events
         (event_id, user_id, event_type, product_id, amount, currency, event_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, datetime('now')))`,
    )
    .bind(
      event.eventId,
      event.userId ?? null,
      event.eventType,
      event.productId ?? null,
      signedAmount,
      event.currency ?? null,
      event.eventAt ?? null,
    )
    .run()
    .catch(() => {});
}

export async function partnerRevenueStatus(
  db: D1Database,
  month: string = currentMonth(),
): Promise<PartnerRevenueStatus> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN UPPER(COALESCE(currency,'USD')) = 'USD' THEN amount ELSE 0 END), 0) AS usd,
         SUM(CASE WHEN amount IS NOT NULL AND UPPER(COALESCE(currency,'USD')) <> 'USD' THEN 1 ELSE 0 END) AS non_usd_events,
         COUNT(*) AS events_counted
       FROM partner_revenue_events
       WHERE strftime('%Y-%m', COALESCE(event_at, recorded_at)) = ?1`,
    )
    .bind(month)
    .first<{ usd: number | null; non_usd_events: number | null; events_counted: number | null }>()
    .catch(() => null);

  const usd = Math.round(Number(row?.usd ?? 0) * 100) / 100;
  const threshold = PARTNER_COMMERCIAL_THRESHOLD_USD;
  return {
    month,
    usd,
    threshold_usd: threshold,
    remaining_usd: Math.max(0, Math.round((threshold - usd) * 100) / 100),
    exceeded: usd >= threshold,
    non_usd_events: Number(row?.non_usd_events ?? 0),
    events_counted: Number(row?.events_counted ?? 0),
  };
}
