import type { Env } from '../types';

// Builds a compact (~1,500 token) structured context string for the AI advisor.
// Covers the user's collection, wishlist, portfolio stats, and recent market movers.
export async function buildAdvisorContext(userId: string, env: Env): Promise<string> {
  const [topSets, wishlist, stats, movers] = await Promise.all([
    env.DB.prepare(`
      SELECT ls.set_num, ls.name, ls.theme, ls.current_value, ls.retail_price,
             ls.retired, ls.retirement_risk_score,
             uc.purchase_price, uc.quantity, uc.condition
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
      ORDER BY ls.current_value DESC
      LIMIT 25
    `).bind(userId).all<{
      set_num: string; name: string; theme: string | null;
      current_value: number; retail_price: number | null;
      retired: number; retirement_risk_score: number | null;
      purchase_price: number | null; quantity: number; condition: string | null;
    }>(),

    env.DB.prepare(`
      SELECT ls.set_num, ls.name, ls.current_value, uw.target_price
      FROM user_wishlist uw
      JOIN lego_sets ls ON ls.set_num = uw.set_num
      WHERE uw.user_id = ?
      ORDER BY ls.current_value DESC
      LIMIT 15
    `).bind(userId).all<{
      set_num: string; name: string; current_value: number; target_price: number | null;
    }>(),

    env.DB.prepare(`
      SELECT COUNT(*) as set_count,
             COALESCE(SUM(ls.current_value * uc.quantity), 0) as total_value,
             COALESCE(SUM(COALESCE(uc.purchase_price, 0) * uc.quantity), 0) as total_paid
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    `).bind(userId).first<{ set_count: number; total_value: number; total_paid: number }>(),

    // Sets that had their valuation updated in the last 14 days (market movers)
    env.DB.prepare(`
      SELECT set_num, name, current_value, retail_price, valuation_method
      FROM lego_sets
      WHERE valuation_expires_at > datetime('now', '-14 days')
        AND valuation_method IN ('market', 'brickeconomy', 'ai', 'ebay_rss')
        AND set_num IN (
          SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL
          UNION
          SELECT set_num FROM user_wishlist WHERE user_id = ?
        )
      ORDER BY current_value DESC
      LIMIT 10
    `).bind(userId, userId).all<{
      set_num: string; name: string; current_value: number; retail_price: number | null; valuation_method: string;
    }>(),
  ]);

  const fmt = (n: number | null) => n ? `$${n.toFixed(0)}` : 'unknown';
  const pct = (cur: number | null, paid: number | null) => {
    if (!cur || !paid || paid <= 0) return '';
    const g = ((cur - paid) / paid * 100).toFixed(0);
    return ` (${Number(g) >= 0 ? '+' : ''}${g}%)`;
  };

  const lines: string[] = [];

  lines.push(`USER COLLECTION (${stats?.set_count ?? 0} sets)`);
  lines.push(`Total value: ${fmt(stats?.total_value ?? 0)} | Total paid: ${fmt(stats?.total_paid ?? 0)}`);
  if ((stats?.total_value ?? 0) > 0 && (stats?.total_paid ?? 0) > 0) {
    const gain = ((stats!.total_value - stats!.total_paid) / stats!.total_paid * 100).toFixed(1);
    lines.push(`Overall ROI: ${Number(gain) >= 0 ? '+' : ''}${gain}%`);
  }
  lines.push('');

  lines.push('TOP OWNED SETS:');
  for (const s of topSets.results) {
    const risk = s.retirement_risk_score != null && s.retirement_risk_score >= 70 ? ' [HIGH RETIRE RISK]' : '';
    const ret = s.retired ? ' [RETIRED]' : '';
    lines.push(
      `- ${s.name} (${s.set_num}) | ${s.theme || 'Unknown'} | Value: ${fmt(s.current_value)}${pct(s.current_value, s.purchase_price)} | Paid: ${fmt(s.purchase_price)} | Qty: ${s.quantity}${risk}${ret}`
    );
  }
  lines.push('');

  if (wishlist.results.length > 0) {
    lines.push('WISHLIST:');
    for (const w of wishlist.results) {
      const gap = w.target_price ? ` | Target: ${fmt(w.target_price)}` : '';
      lines.push(`- ${w.name} (${w.set_num}) | Value: ${fmt(w.current_value)}${gap}`);
    }
    lines.push('');
  }

  if (movers.results.length > 0) {
    lines.push('RECENTLY REPRICED (market data):');
    for (const m of movers.results) {
      lines.push(`- ${m.name}: ${fmt(m.current_value)} (retail was ${fmt(m.retail_price)})`);
    }
  }

  return lines.join('\n');
}
