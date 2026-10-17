import type { Env } from '../types';
import { sendPushToUser } from './wishlist-alerts';

// Set anniversaries (daily, 08:00 UTC): "3 years with Millennium Falcon, up
// $210 since you bought it". One push per member per day, for the owned set
// whose purchase date falls on today with the most years behind it (largest
// value breaks ties). Members who switched off big-move alerts (or price-drop
// alerts, the original master switch) don't get it. The app also celebrates
// on open (views/portfolio.js checkAnniversaries) and offers a share card.

export interface AnniversaryRow {
  user_id: string; set_num: string; name: string; years: number;
  purchase_price: number | null; value: number | null;
}

export function anniversaryMessage(r: AnniversaryRow): { title: string; body: string } {
  const years = Number(r.years);
  const title = `${years} ${years === 1 ? 'year' : 'years'} with ${r.name} 🎂`;
  const paid = Number(r.purchase_price) || 0;
  const value = Number(r.value) || 0;
  const usd = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
  const body = paid > 0 && value > 0
    ? (value >= paid ? `Bought for ${usd(paid)}, now worth about ${usd(value)}: up ${usd(value - paid)}.` : `Bought for ${usd(paid)}. Some sets are for love, not profit.`)
    : 'Time flies when you’re building. Tap to see it in your vault.';
  return { title, body };
}

export async function runSetAnniversaries(env: Env, now = new Date()) {
  const md = now.toISOString().slice(5, 10);
  const { results } = await env.DB.prepare(`
    SELECT uc.user_id, uc.set_num, s.name,
           CAST(strftime('%Y', ?) AS INTEGER) - CAST(strftime('%Y', uc.purchased_at) AS INTEGER) AS years,
           uc.purchase_price, COALESCE(s.current_value, s.retail_price) AS value
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      LEFT JOIN user_prefs p ON p.user_id = uc.user_id
     WHERE uc.deleted_at IS NULL AND uc.sold_at IS NULL
       AND uc.purchased_at IS NOT NULL AND strftime('%m-%d', uc.purchased_at) = ?
       AND strftime('%Y', uc.purchased_at) < strftime('%Y', ?)
       AND COALESCE(p.notify_big_moves, p.notify_price_drops, 1) = 1
     ORDER BY uc.user_id, years DESC, value DESC
  `).bind(now.toISOString(), md, now.toISOString()).all<AnniversaryRow>().catch(() => ({ results: [] as AnniversaryRow[] }));
  const seen = new Set<string>();
  let sent = 0;
  for (const row of results || []) {
    if (seen.has(row.user_id) || !(Number(row.years) >= 1)) continue;
    seen.add(row.user_id);
    const { title, body } = anniversaryMessage(row);
    await sendPushToUser(env, row.user_id, JSON.stringify({
      title, body, url: `#/set/${encodeURIComponent(row.set_num)}?anniversary=${Number(row.years)}`,
    })).catch(() => {});
    sent++;
  }
  return { candidates: (results || []).length, sent };
}
