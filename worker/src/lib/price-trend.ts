import type { Env } from '../types';

export type Trend = 'rising' | 'stable' | 'falling';

const trendCache = new Map<string, { trend: Trend | null; ts: number }>();

// Least-squares slope in USD per week over {x: days, y: value} points.
// Returns null when the series is degenerate (all same day, or empty).
export function weeklySlopeUSD(data: Array<{ x: number; y: number }>): number | null {
  const n = data.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of data) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  return ((n * sumXY - sumX * sumY) / denominator) * 7;
}

export async function computePriceTrend(setNum: string, env: Env): Promise<{ trend: Trend; slope_pct_per_week: number } | null> {
  const { results } = await env.DB.prepare(`
    SELECT snapshot_date, current_value
    FROM set_value_history
    WHERE set_num = ? AND snapshot_date >= DATE('now', '-90 days')
    ORDER BY snapshot_date ASC
  `).bind(setNum).all<{ snapshot_date: string; current_value: number }>();

  if (!results || results.length < 14) return null;

  const firstTime = new Date(results[0].snapshot_date).getTime();
  const data = results.map(r => {
    const days = (new Date(r.snapshot_date).getTime() - firstTime) / (24 * 3600 * 1000);
    return { x: days, y: r.current_value };
  });

  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of data) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { trend: 'stable', slope_pct_per_week: 0 };

  const slopeDaily = (n * sumXY - sumX * sumY) / denominator;
  const avgY = sumY / n;

  if (avgY === 0) return { trend: 'stable', slope_pct_per_week: 0 };

  const slopePctPerWeek = (slopeDaily * 7 / avgY) * 100;

  let trend: Trend = 'stable';
  if (slopePctPerWeek > 0.5) trend = 'rising';
  else if (slopePctPerWeek < -0.5) trend = 'falling';

  return { trend, slope_pct_per_week: slopePctPerWeek };
}

function medianOf(sortedAsc: number[]): number | null {
  if (!sortedAsc.length) return null;
  const mid = Math.floor(sortedAsc.length / 2);
  return sortedAsc.length % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

// Trailing-window median of the displayed value from set_value_history, used by
// the blend's anomaly guard to detect a value that has jumped off its own trend.
// Reads `db` directly so blend persistence (which holds a D1Database) can call it.
export async function recentValueMedian(
  db: D1Database,
  setNum: string,
  days = 90,
): Promise<{ recentMedian: number | null; points: number; days: number; firstValue: number | null; lastValue: number | null }> {
  const { results } = await db.prepare(`
    SELECT snapshot_date, current_value FROM set_value_history
    WHERE set_num = ? AND snapshot_date >= DATE('now', ?) AND current_value IS NOT NULL
    ORDER BY snapshot_date ASC
  `).bind(setNum, `-${days} days`).all<{ snapshot_date: string; current_value: number }>();
  const vals = (results || []).map(r => Number(r.current_value)).filter(v => v > 0).sort((a, b) => a - b);
  const chronological = (results || []).filter(r => Number(r.current_value) > 0);
  const span = chronological.length > 1
    ? Math.max(0, (Date.parse(chronological.at(-1)!.snapshot_date) - Date.parse(chronological[0].snapshot_date)) / 86_400_000)
    : 0;
  return {
    recentMedian: medianOf(vals),
    points: vals.length,
    days: span,
    firstValue: chronological.length ? Number(chronological[0].current_value) : null,
    lastValue: chronological.length ? Number(chronological.at(-1)!.current_value) : null,
  };
}

// Batch form for the valuation cron: one query for many sets, medians in JS.
export async function recentValueMedians(
  db: D1Database,
  setNums: string[],
  days = 90,
): Promise<Map<string, { recentMedian: number | null; points: number; days: number; firstValue: number | null; lastValue: number | null }>> {
  const ids = [...new Set(setNums.filter(Boolean))];
  const out = new Map<string, { recentMedian: number | null; points: number; days: number; firstValue: number | null; lastValue: number | null }>();
  if (!ids.length) return out;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(`
    SELECT set_num, snapshot_date, current_value FROM set_value_history
    WHERE set_num IN (${placeholders}) AND snapshot_date >= DATE('now', ?) AND current_value IS NOT NULL
  `).bind(...ids, `-${days} days`).all<{ set_num: string; snapshot_date: string; current_value: number }>();
  const byset = new Map<string, Array<{ value: number; date: string }>>();
  for (const r of results || []) {
    const v = Number(r.current_value);
    if (!(v > 0)) continue;
    const arr = byset.get(r.set_num) || [];
    arr.push({ value: v, date: r.snapshot_date });
    byset.set(r.set_num, arr);
  }
  for (const [sn, entries] of byset) {
    entries.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const vals = entries.map(entry => entry.value).sort((a, b) => a - b);
    out.set(sn, {
      recentMedian: medianOf(vals),
      points: entries.length,
      days: entries.length > 1 ? Math.max(0, (Date.parse(entries.at(-1)!.date) - Date.parse(entries[0].date)) / 86_400_000) : 0,
      firstValue: entries[0]?.value ?? null,
      lastValue: entries.at(-1)?.value ?? null,
    });
  }
  return out;
}

export async function getCachedPriceTrend(setNum: string, env: Env): Promise<Trend | null> {
  const now = Date.now();
  const cached = trendCache.get(setNum);
  if (cached && now - cached.ts < 24 * 3600 * 1000) {
    return cached.trend;
  }

  const res = await computePriceTrend(setNum, env).catch(() => null);
  const trend = res ? res.trend : null;
  trendCache.set(setNum, { trend, ts: now });
  return trend;
}
