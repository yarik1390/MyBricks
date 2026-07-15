export const PRICING_WRITE_LIMITS = {
  operational_30d: 10_000_000,
  warning_30d: 15_000_000,
  pause_30d: 25_000_000,
  emergency_30d: 35_000_000,
  daily_warning: 500_000,
  daily_pause: 1_000_000,
  pricing_pipeline_monthly: 2_000_000,
  amazon_monthly: 100_000,
} as const;

export interface PricingWriteWorkload {
  initial_shadow_sets: number;
  state_rows_per_set: number;
  changed_values_per_day: number;
  rows_per_value_change: number;
  history_rows_per_day: number;
  retail_changes_per_day: number;
  retail_rows_per_change: number;
}

export function projectPricingWrites30d(workload: PricingWriteWorkload): number {
  const initial = workload.initial_shadow_sets * workload.state_rows_per_set;
  const daily = workload.changed_values_per_day * workload.rows_per_value_change
    + workload.history_rows_per_day
    + workload.retail_changes_per_day * workload.retail_rows_per_change;
  return Math.ceil(initial + daily * 30);
}

export const PRICING_WRITE_REFERENCE_PLAN: PricingWriteWorkload = {
  initial_shadow_sets: 27_500,
  state_rows_per_set: 3,
  changed_values_per_day: 1_000,
  rows_per_value_change: 3,
  history_rows_per_day: 4_500,
  retail_changes_per_day: 18,
  retail_rows_per_change: 3,
};

export async function recordPricingWrites(db: D1Database, job: string, rowsWritten: number): Promise<void> {
  const count = Math.max(0, Math.floor(Number(rowsWritten) || 0));
  if (!count) return;
  await db.prepare(`
    INSERT INTO pricing_write_ledger (day, job, rows_written, updated_at)
    VALUES (date('now'), ?1, ?2, datetime('now'))
    ON CONFLICT(day, job) DO UPDATE SET
      rows_written=pricing_write_ledger.rows_written + excluded.rows_written,
      updated_at=datetime('now')
  `).bind(job, count).run().catch(() => {});
}

export async function getPricingWriteBudget(db: D1Database) {
  const totals = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN day=date('now') THEN rows_written ELSE 0 END),0) AS today,
      COALESCE(SUM(CASE WHEN day>=date('now','-29 days') THEN rows_written ELSE 0 END),0) AS rolling_30d,
      COUNT(DISTINCT CASE WHEN day>=date('now','-29 days') THEN day END) AS observed_days
    FROM pricing_write_ledger
  `).first<{ today: number; rolling_30d: number; observed_days: number }>().catch(() => ({ today: 0, rolling_30d: 0, observed_days: 0 }));
  const today = Number(totals?.today || 0);
  const rolling = Number(totals?.rolling_30d || 0);
  const observedDays = Number(totals?.observed_days || 0);
  const projected = observedDays > 0 ? Math.round((rolling / observedDays) * 30) : 0;
  const state = rolling >= PRICING_WRITE_LIMITS.emergency_30d ? 'emergency'
    : rolling >= PRICING_WRITE_LIMITS.pause_30d || today >= PRICING_WRITE_LIMITS.daily_pause ? 'paused'
      : rolling >= PRICING_WRITE_LIMITS.warning_30d || today >= PRICING_WRITE_LIMITS.daily_warning ? 'warning'
        : 'healthy';
  return {
    state,
    today,
    rolling_30d: rolling,
    projected_30d: projected,
    observed_days: observedDays,
    non_critical_allowed: state === 'healthy' || state === 'warning',
    limits: PRICING_WRITE_LIMITS,
  };
}

export async function pricingWritesAllowed(db: D1Database, critical = false): Promise<boolean> {
  const budget = await getPricingWriteBudget(db);
  if (budget.state === 'emergency') return false;
  return critical || budget.non_critical_allowed;
}
