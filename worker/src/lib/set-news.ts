import type { Env } from '../types';
import { computeRetirementRisk } from './retirement-risk';

// Retirement signals from LEGO news reports (set_news, filled by
// jobs/exa-news.ts). A report counts for 180 days, and not once the
// retirement date it gave is more than 30 days past.

export interface NewsSignal {
  sources: number;
  exitDate: string | null;
}

const IN_WINDOW = `kind = 'retiring'
  AND datetime(seen_at) >= datetime('now', '-180 days')
  AND (expected_date IS NULL OR date(expected_date) >= date('now', '-30 days'))`;

/** Retiring-news signal per set (distinct sites, earliest expected date). Never throws. */
export async function loadNewsSignals(env: Env, setNums: string[]): Promise<Map<string, NewsSignal>> {
  const out = new Map<string, NewsSignal>();
  for (let i = 0; i < setNums.length; i += 90) {
    const chunk = setNums.slice(i, i + 90);
    if (!chunk.length) continue;
    try {
      const { results } = await env.DB.prepare(
        `SELECT set_num, COUNT(DISTINCT domain) AS sources, MIN(expected_date) AS exit_date
         FROM set_news WHERE ${IN_WINDOW} AND set_num IN (${chunk.map(() => '?').join(',')})
         GROUP BY set_num`,
      ).bind(...chunk).all<{ set_num: string; sources: number; exit_date: string | null }>();
      for (const r of results ?? []) out.set(r.set_num, { sources: Number(r.sources) || 0, exitDate: r.exit_date });
    } catch {
      return out; // set_news may not exist yet on a fresh DB
    }
  }
  return out;
}

/** Recompute the retirement risk score of these sets now, news included. */
export async function rescoreRetirementRisk(env: Env, setNums: string[]): Promise<number> {
  if (!setNums.length) return 0;
  const news = await loadNewsSignals(env, setNums);
  let changed = 0;
  for (let i = 0; i < setNums.length; i += 90) {
    const chunk = setNums.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT ls.set_num, ls.year, ls.theme, ls.pieces, ls.retired,
              ls.lego_retiring_soon, ls.lego_availability, ls.exit_date, ext.pa_in_stock
       FROM lego_sets ls LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
       WHERE ls.set_num IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{
      set_num: string; year: number; theme: string | null; pieces: number; retired: number;
      lego_retiring_soon: number | null; lego_availability: string | null; exit_date: string | null;
      pa_in_stock: number | null;
    }>();
    const stmts = (results ?? []).map((s) => {
      const n = news.get(s.set_num);
      const score = computeRetirementRisk({ ...s, news_retiring_sources: n?.sources ?? 0, news_exit_date: n?.exitDate ?? null });
      return env.DB.prepare(
        `UPDATE lego_sets SET retirement_risk_score=?1, retirement_risk_updated_at=datetime('now') WHERE set_num=?2`,
      ).bind(score, s.set_num);
    });
    if (stmts.length) {
      const res = await env.DB.batch(stmts);
      changed += res.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
    }
  }
  return changed;
}
