import type { Env } from '../types';
import { fetchMinifigPricing } from '../lib/bricklink';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { fetchMinifigEbaySoldViaFirecrawl } from '../lib/ebay-firecrawl';
import { normalizeMinifigName, resolveBlId } from '../lib/bricklink-minifigs';
import { computeMinifigRarity } from '../lib/minifig-rarity';
import { reserveQuota } from '../lib/api-quota';

export async function runValuateMinifigs(env: Env, options: { limit?: number } = {}): Promise<number> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 10)), 400);
  // Price the figs users actually browse — not just owned ones (which left the
  // whole catalog on the hardcoded rarity fallback). Scope: owned → already-valuable
  // → Collectible-Minifigures series → popular (appears in ≥3 sets). Stale-first
  // (14-day TTL) so the targeted population cycles within the daily BrickLink budget.
  // "Collectible Minifigures" = figs that appear in a set with that theme (the
  // `series` column is populated for ~98% of figs, so it is NOT a CMF proxy).
  // A MATERIALIZED CTE + LEFT JOINs keep this a single fast scan; a correlated
  // EXISTS per fig was ~12s on the live catalog, this is ~1s.
  const { results } = await env.DB.prepare(`
    WITH cmf AS MATERIALIZED (
      SELECT DISTINCT sm.fig_num FROM set_minifigs sm
      JOIN lego_sets ls ON ls.set_num = sm.set_num
      WHERE ls.theme = 'Collectible Minifigures'
    )
    SELECT m.fig_num, m.name, m.appears_in_sets, m.bl_id, m.year,
      (CASE
        WHEN um.fig_num IS NOT NULL THEN 0
        WHEN COALESCE(m.current_value, 0) >= 10 THEN 1
        WHEN cmf.fig_num IS NOT NULL THEN 2
        ELSE 3
      END) AS priority
    FROM minifigs m
    LEFT JOIN cmf ON cmf.fig_num = m.fig_num
    LEFT JOIN (SELECT DISTINCT fig_num FROM user_minifigs) um ON um.fig_num = m.fig_num
    WHERE (m.cached_at IS NULL OR m.cached_at < datetime('now', '-14 days'))
      AND (
        um.fig_num IS NOT NULL
        OR COALESCE(m.current_value, 0) >= 10
        OR cmf.fig_num IS NOT NULL
        OR COALESCE(m.appears_in_sets, 0) >= 3
      )
    ORDER BY priority ASC, COALESCE(m.cached_at, '2000-01-01') ASC, COALESCE(m.appears_in_sets, 0) DESC
    LIMIT ?
  `).bind(limit).all<{ fig_num: string; name: string; appears_in_sets: number | null; bl_id: string | null; year: number | null; priority: number }>();

  // Account the BrickLink spend in the daily ledger (advisory — minifig
  // batches are far below the 4,000/day budget, but visibility matters).
  await reserveQuota(env, { bricklink: results.length });

  // Multi-source (G1b): only worth an eBay scrape (5 Firecrawl credits) for
  // figs valuable enough that a second source matters — cheap commons don't.
  const fcOn = firecrawlEnabled(env);
  const EBAY_MIN_VALUE = 10;

  let updated = 0;
  for (const fig of results) {
    // Resolve the BrickLink id lazily: Rebrickable fig-numbers aren't valid on
    // BrickLink, so we match this fig's normalized name (+year) against the
    // uploaded BrickLink catalog and cache the id on the row. Only unambiguous
    // matches are accepted (resolveBlId returns null otherwise).
    let blId = fig.bl_id;
    if (!blId) {
      const cand = await env.DB.prepare(
        `SELECT bl_id, year FROM bricklink_minifigs WHERE norm_name = ?`,
      ).bind(normalizeMinifigName(fig.name)).all<{ bl_id: string; year: number | null }>()
        .catch(() => ({ results: [] as Array<{ bl_id: string; year: number | null }> }));
      blId = resolveBlId(cand.results ?? [], fig.year);
      if (blId) {
        await env.DB.prepare(`UPDATE minifigs SET bl_id = ? WHERE fig_num = ?`)
          .bind(blId, fig.fig_num).run().catch(() => {});
      }
    }

    // BrickLink sold price (only with a real BrickLink id).
    const px = blId
      ? await fetchMinifigPricing(blId, env, { recordHealth: false }).catch(() => null)
      : null;
    const blValue = px && px.value != null && px.value > 0 ? px.value : null;
    const blLots = px?.lots ?? 0;

    let value = blValue;
    let lots = blLots;
    let ebayValue: number | null = null;
    let ebayQty = 0;

    // eBay sold comps: corroborate a real BrickLink value for valuable figs, OR
    // act as the PRIMARY source for owned/wishlisted figs (priority 0) that
    // BrickLink couldn't price — so those aren't left with no market value just
    // because the fig isn't mapped. Gated so we don't scrape every common fig.
    const wantEbay = fcOn && (
      (blValue != null && blValue >= EBAY_MIN_VALUE)
      || (blValue == null && fig.priority === 0)
    );
    let ebayAttempted = false;
    if (wantEbay) {
      ebayAttempted = true;
      const eb = await fetchMinifigEbaySoldViaFirecrawl(fig.fig_num, fig.name, env).catch(() => null);
      if (eb && eb.status === 'ok' && eb.value != null && eb.value > 0) {
        if (blValue == null) {
          value = eb.value;          // eBay is the only source
          ebayValue = eb.value;
          ebayQty = eb.count;
          lots = 0;
        } else if (eb.value >= blValue / 3 && eb.value <= blValue * 3) {  // corroboration gate
          ebayValue = eb.value;
          ebayQty = eb.count;
          const w1 = Math.max(1, blLots);
          const w2 = Math.max(1, eb.count);
          value = Math.round(((blValue * w1 + eb.value * w2) / (w1 + w2)) * 100) / 100;
        }
      }
    }

    if (value == null || value <= 0) continue; // no market value from either source

    // Rarity reflects the blended value + combined market liquidity.
    const rarity = computeMinifigRarity(value, fig.appears_in_sets, lots + ebayQty);
    const source = ebayValue != null ? (blValue != null ? 'bricklink+ebay' : 'ebay') : 'bricklink';
    await env.DB.prepare(`
      UPDATE minifigs SET current_value = ?, rarity = ?, source = ?,
        ebay_value = ?, ebay_qty = ?, ebay_cached_at = CASE WHEN ? THEN datetime('now') ELSE ebay_cached_at END,
        cached_at = datetime('now')
      WHERE fig_num = ?
    `).bind(value, rarity, source, ebayValue, ebayQty, ebayAttempted ? 1 : 0, fig.fig_num).run();
    updated++;
  }
  return updated;
}
