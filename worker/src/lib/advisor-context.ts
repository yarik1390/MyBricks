import type { Env } from '../types';
import { enrichSetRecord, holdingValueForRollout, type HoldingValuationRow } from './market-sources';

// Builds a structured context string for the AI advisor. Covers collection,
// wishlist, portfolio stats, market movers, 90-day price trends, resale spread,
// theme breakdown, and the richer signals: deal (buy/below-market), part-out
// (sum-of-parts), retiring-soon, pre-order/coming-soon, and notable minifigs by
// rarity. Source-anonymized — the advice is user-facing, so the context feeds
// generic signal types/confidence, never a provider name.
export async function buildAdvisorContext(userId: string, env: Env): Promise<string> {
  const [topSets, wishlist, holdings, movers, trends, rareFigs] = await Promise.all([
    env.DB.prepare(`
      SELECT ls.set_num, ls.name, ls.theme, COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) AS current_value, ls.retail_price,
             COALESCE(ls.ebay_new_value, ls.ebay_value) AS ebay_value,
             ls.ebay_used_value, ls.retired, ls.retirement_risk_score,
             ls.valuation_method, ls.valuation_expires_at, ls.cached_at,
             ls.bl_new_value, ls.bl_new_qty, ls.bl_used_qty, ls.used_value,
             ls.be_growth_12m, ls.blended_value,
             ls.deal_signal, ls.deal_discount_pct, ls.deal_strong,
             ls.part_out_value, ls.part_out_coverage,
             ls.lego_availability, ls.lego_retiring_soon,
             uc.purchase_price, uc.quantity, uc.condition, uc.purchased_at
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
      ORDER BY COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) DESC
      LIMIT 25
    `).bind(userId).all<{
      set_num: string; name: string; theme: string | null;
      current_value: number; retail_price: number | null; ebay_value: number | null; ebay_used_value: number | null;
      valuation_method: string | null; valuation_expires_at: string | null; cached_at: string | null;
      bl_new_value: number | null; bl_new_qty: number | null; bl_used_qty: number | null; used_value: number | null;
      retired: number; retirement_risk_score: number | null;
      be_growth_12m: number | null; blended_value: number | null;
      deal_signal: string | null; deal_discount_pct: number | null; deal_strong: number | null;
      part_out_value: number | null; part_out_coverage: number | null;
      lego_availability: string | null; lego_retiring_soon: number | null;
      purchase_price: number | null; quantity: number;
      condition: string | null; purchased_at: string | null;
    }>(),

    env.DB.prepare(`
      SELECT ls.set_num, ls.name, COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) AS current_value,
             COALESCE(ls.ebay_new_value, ls.ebay_value) AS ebay_value,
             ls.ebay_used_value, ls.valuation_method,
             ls.valuation_expires_at, ls.cached_at, ls.bl_new_value, ls.bl_new_qty,
             ls.bl_used_qty, ls.used_value, uw.target_price,
             ls.deal_signal, ls.deal_discount_pct, ls.deal_strong,
             ls.lego_availability, ls.lego_retiring_soon
      FROM user_wishlist uw
      JOIN lego_sets ls ON ls.set_num = uw.set_num
      WHERE uw.user_id = ?
      ORDER BY COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) DESC
      LIMIT 15
    `).bind(userId).all<{
      set_num: string; name: string; current_value: number;
      valuation_method: string | null; valuation_expires_at: string | null; cached_at: string | null;
      bl_new_value: number | null; bl_new_qty: number | null; bl_used_qty: number | null; used_value: number | null;
      ebay_value: number | null; ebay_used_value: number | null; target_price: number | null;
      deal_signal: string | null; deal_discount_pct: number | null; deal_strong: number | null;
      lego_availability: string | null; lego_retiring_soon: number | null;
    }>(),

    // Every holding, valued in JS by the same holdingValueForRollout chain as
    // the vault total and the daily value chart (condition-aware, opened-copy
    // cap, withheld values count as 0), so the advisor quotes the same totals.
    env.DB.prepare(`
      SELECT uc.set_num, uc.condition, uc.quantity, uc.purchase_price, ls.theme,
             ls.current_value, ls.blended_value, ls.used_value, ls.ebay_used_value,
             ls.pc_new_value, ls.pc_complete_value, ls.bl_new_value, ls.bl_new_qty,
             svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      LEFT JOIN set_valuation_state svn ON svn.set_num = ls.set_num AND svn.condition = 'new_sealed'
      LEFT JOIN set_valuation_state svu ON svu.set_num = ls.set_num AND svu.condition = 'used_complete'
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    `).bind(userId).all<HoldingValuationRow & { theme: string | null; quantity: number; purchase_price: number | null }>(),

    env.DB.prepare(`
      SELECT set_num, name, COALESCE(NULLIF(blended_value, 0), current_value) AS current_value, retail_price, valuation_method
      FROM lego_sets
      WHERE valuation_expires_at > datetime('now', '-14 days')
        AND valuation_method IN ('market', 'brickeconomy', 'ai', 'ebay_rss', 'ebay_sold')
        AND set_num IN (
          SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL
          UNION
          SELECT set_num FROM user_wishlist WHERE user_id = ?
        )
      ORDER BY COALESCE(NULLIF(blended_value, 0), current_value) DESC
      LIMIT 10
    `).bind(userId, userId).all<{
      set_num: string; name: string; current_value: number;
      retail_price: number | null; valuation_method: string;
    }>(),

    // 90-day price change per owned set: latest snapshot vs the first one in
    // the window (chronological, so a falling set reads negative), requiring
    // >=7 snapshots for reliability.
    env.DB.prepare(`
      SELECT set_num, ROUND((last_v - first_v) / NULLIF(first_v, 0) * 100, 1) AS growth_90d
      FROM (
        SELECT svh.set_num, COUNT(*) AS n,
          (SELECT x.current_value FROM set_value_history x WHERE x.set_num = svh.set_num
             AND x.snapshot_date >= DATE('now', '-90 days') AND x.current_value > 0
           ORDER BY x.snapshot_date ASC LIMIT 1) AS first_v,
          (SELECT x.current_value FROM set_value_history x WHERE x.set_num = svh.set_num
             AND x.snapshot_date >= DATE('now', '-90 days') AND x.current_value > 0
           ORDER BY x.snapshot_date DESC LIMIT 1) AS last_v
        FROM set_value_history svh
        WHERE svh.snapshot_date >= DATE('now', '-90 days') AND svh.current_value > 0
          AND svh.set_num IN (
            SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL
          )
        GROUP BY svh.set_num
        HAVING COUNT(*) >= 7
      )
    `).bind(userId).all<{ set_num: string; growth_90d: number }>(),

    // Rare+ owned minifigs (G1 real rarity) — surfaces standout figs so the
    // advisor can flag hidden value in the minifig collection.
    env.DB.prepare(`
      SELECT m.fig_num, m.name, m.rarity, m.current_value, um.quantity
      FROM user_minifigs um
      JOIN minifigs m ON m.fig_num = um.fig_num
      WHERE um.user_id = ? AND m.rarity IN ('rare', 'legendary')
      ORDER BY CASE m.rarity WHEN 'legendary' THEN 2 ELSE 1 END DESC, COALESCE(m.current_value, 0) DESC
      LIMIT 8
    `).bind(userId).all<{ fig_num: string; name: string; rarity: string; current_value: number | null; quantity: number }>(),
  ]);

  const rolloutPercent = Number(env.PRICING_V3_READ_PERCENT || 0);
  const stats = { set_count: holdings.results.length, total_value: 0, total_paid: 0 };
  const themeAgg = new Map<string, { theme: string; sets: number; value: number; paid: number }>();
  for (const h of holdings.results) {
    const qty = Number(h.quantity || 1);
    const value = holdingValueForRollout(h, rolloutPercent) * qty;
    const paid = (Number(h.purchase_price) || 0) * qty;
    stats.total_value += value;
    stats.total_paid += paid;
    if (h.theme) {
      const t = themeAgg.get(h.theme) || { theme: h.theme, sets: 0, value: 0, paid: 0 };
      t.sets += 1; t.value += value; t.paid += paid;
      themeAgg.set(h.theme, t);
    }
  }
  const themes = { results: [...themeAgg.values()].sort((a, b) => b.value - a.value).slice(0, 5) };

  const fmt = (n: number | null | undefined) => n ? `$${n.toFixed(0)}` : 'unknown';
  const pct = (cur: number | null, paid: number | null) => {
    if (!cur || !paid || paid <= 0) return '';
    const g = ((cur - paid) / paid * 100).toFixed(0);
    return ` (${Number(g) >= 0 ? '+' : ''}${g}%)`;
  };
  // Anonymized basis label — the advisor produces user-facing advice, so never
  // feed it a raw provider name (source anonymization, B1). Maps the internal
  // valuation method to a generic signal type.
  const basisLabel = (method: string | null | undefined): string => {
    switch (String(method || '')) {
      case 'brickeconomy':
      case 'market': return 'market';
      case 'ebay_rss':
      case 'ebay_sold': return 'recent sold';
      case 'ai': return 'AI estimate';
      default: return 'formula estimate';
    }
  };
  // Deal flag from the persisted signal (same one behind the badge/filter/alert).
  const dealFlag = (signal: string | null, pctOff: number | null, strong: number | null): string => {
    if (signal === 'buy') {
      const p = Number.isFinite(Number(pctOff)) ? `${Math.abs(Math.round(Number(pctOff)))}% below` : 'below';
      return ` [${strong ? 'STRONG BUY' : 'BUY'} — ${p} market]`;
    }
    if (signal === 'premium') return ' [priced above market]';
    return '';
  };
  const availFlag = (a: string | null): string =>
    a === 'pre_order' ? ' [PRE-ORDER]' : a === 'coming_soon' ? ' [COMING SOON]' : '';

  // Build trend lookup map
  const trendMap = new Map<string, number>();
  for (const t of trends.results) trendMap.set(t.set_num, t.growth_90d);

  const lines: string[] = [];

  lines.push(`USER COLLECTION (${stats?.set_count ?? 0} sets)`);
  lines.push(`Total value: ${fmt(stats?.total_value ?? 0)} | Total paid: ${fmt(stats?.total_paid ?? 0)}`);
  if ((stats?.total_value ?? 0) > 0 && (stats?.total_paid ?? 0) > 0) {
    const gain = ((stats!.total_value - stats!.total_paid) / stats!.total_paid * 100).toFixed(1);
    lines.push(`Overall ROI: ${Number(gain) >= 0 ? '+' : ''}${gain}%`);
  }
  lines.push('');

  // Theme breakdown
  if (themes.results.length > 0) {
    lines.push('THEME BREAKDOWN:');
    for (const t of themes.results) {
      const roi = t.paid > 0 ? ` ${((t.value - t.paid) / t.paid * 100).toFixed(0)}% ROI` : '';
      lines.push(`- ${t.theme}: ${t.sets} sets, ${fmt(t.value)} value,${roi}`);
    }
    lines.push('');
  }

  lines.push('TOP OWNED SETS:');
  for (const s of topSets.results) {
    const market = enrichSetRecord(s as unknown as Record<string, unknown>);
    const risk = s.retirement_risk_score != null && s.retirement_risk_score >= 70 ? ' [HIGH RETIRE RISK]' : '';
    const retiring = !s.retired && s.lego_retiring_soon ? ' [RETIRING SOON]' : '';
    const ret = s.retired ? ' [RETIRED]' : '';
    const trend90 = trendMap.get(s.set_num);
    const trendStr = trend90 != null ? ` | ${trend90 >= 0 ? '+' : ''}${trend90}%/90d` : '';
    const sourceStr = ` | Conf: ${basisLabel(s.valuation_method)}/${market.confidence}/${market.freshness}`;
    const dealStr = dealFlag(s.deal_signal, s.deal_discount_pct, s.deal_strong);
    // Part-out (sum-of-parts) — only when coverage is high (mirrors the UI gate).
    const partOutStr = (Number(s.part_out_value) > 0 && Number(s.part_out_coverage) >= 0.9)
      ? ` | Part-out: ${fmt(Number(s.part_out_value))}`
      : '';

    // eBay vs BrickLink spread signal
    let spreadStr = '';
    if (s.ebay_value && s.current_value) {
      const spread = (s.ebay_value - s.current_value) / s.current_value;
      if (spread > 0.15) spreadStr = ` [resale HOT +${(spread * 100).toFixed(0)}%]`;
      else if (spread < -0.15) spreadStr = ` [resale WEAK -${(Math.abs(spread) * 100).toFixed(0)}%]`;
    }

    lines.push(
      `- ${s.name} (${s.set_num}) | ${s.theme || 'Unknown'} | Value: ${fmt(s.current_value)}${pct(s.current_value, s.purchase_price)}${sourceStr} | Paid: ${fmt(s.purchase_price)} | Qty: ${s.quantity}${trendStr}${partOutStr}${spreadStr}${dealStr}${risk}${retiring}${ret}`
    );
  }
  lines.push('');

  if (wishlist.results.length > 0) {
    lines.push('WISHLIST:');
    for (const w of wishlist.results) {
      const market = enrichSetRecord(w as unknown as Record<string, unknown>);
      const gap = w.target_price ? ` | Target: ${fmt(w.target_price)}` : '';
      // resale spread on wishlist too
      let spreadStr = '';
      if (w.ebay_value && w.current_value) {
        const spread = (w.ebay_value - w.current_value) / w.current_value;
        if (spread > 0.15) spreadStr = ` [resale HOT +${(spread * 100).toFixed(0)}%]`;
      }
      const dealStr = dealFlag(w.deal_signal, w.deal_discount_pct, w.deal_strong);
      const availStr = availFlag(w.lego_availability);
      lines.push(`- ${w.name} (${w.set_num}) | Value: ${fmt(w.current_value)} | Conf: ${basisLabel(w.valuation_method)}/${market.confidence}/${market.freshness}${gap}${spreadStr}${dealStr}${availStr}`);
    }
    lines.push('');
  }

  if (movers.results.length > 0) {
    lines.push('RECENTLY REPRICED (market data):');
    for (const m of movers.results) {
      lines.push(`- ${m.name}: ${fmt(m.current_value)} (retail was ${fmt(m.retail_price)})`);
    }
    lines.push('');
  }

  if (rareFigs.results.length > 0) {
    lines.push('NOTABLE MINIFIGS (rare / legendary):');
    for (const f of rareFigs.results) {
      lines.push(`- ${f.name} (${f.fig_num}) | ${f.rarity}${f.current_value ? ` | ${fmt(f.current_value)}` : ''}${f.quantity > 1 ? ` | x${f.quantity}` : ''}`);
    }
  }

  return lines.join('\n');
}
