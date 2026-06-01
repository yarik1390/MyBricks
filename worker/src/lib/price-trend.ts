import type { Env } from '../types';

export type Trend = 'rising' | 'stable' | 'falling';

const trendCache = new Map<string, { trend: Trend | null; ts: number }>();

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
