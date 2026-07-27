import type { Env } from '../types';
import { fetchMinifigPricing } from '../lib/bricklink';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { fetchMinifigEbaySoldViaFirecrawl } from '../lib/ebay-firecrawl';
import { normalizeMinifigName, namePrefixes, matchBlCandidates } from '../lib/bricklink-minifigs';
import type { BlNameCandidate } from '../lib/bricklink-minifigs';
import { computeMinifigRarity, plausibleEbayOnlyFigValue } from '../lib/minifig-rarity';
import { reserveQuota } from '../lib/api-quota';

export interface ValuateMinifigsSummary {
  figs: number;       // candidates pulled this run
  priced: number;     // rows that came away with a market value
  bl_matched: number; // BrickLink ids newly resolved
  parked: number;     // figs handed to the price-agreement verifier
  ebay: number;       // eBay scrapes spent
  missed: number;     // attempted, no value from any source (cooled down)
}

export async function runValuateMinifigs(
  env: Env,
  options: { limit?: number; ebayLimit?: number } = {},
): Promise<ValuateMinifigsSummary> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 10)), 400);
  // Price the figs users actually browse — not just owned ones (which left the
  // whole catalog on the hardcoded rarity fallback). Scope: owned → already-valuable
  // → Collectible-Minifigures series → popular (appears in ≥3 sets). Stale-first
  // (14-day TTL) so the targeted population cycles within the daily BrickLink budget.
  // "Collectible Minifigures" = figs that appear in a set with that theme (the
  // `series` column is populated for ~98% of figs, so it is NOT a CMF proxy).
  //
  // Membership is tested with `fig_num IN (subquery)` rather than LEFT JOINs onto
  // a MATERIALIZED CTE. The old form left `cmf` un-indexed, so SQLite did
  // `SCAN cmf LEFT-JOIN` once per minifigs row — a nested-loop blow-up that read
  // billions of rows per run (dominating D1 query time). `IN (subquery)` lets
  // SQLite build a bloom filter + ephemeral index for O(1) membership, so this
  // is a single scan of minifigs: ~24k rows read vs billions, same result set.
  const { results } = await env.DB.prepare(`
    WITH cmf AS (
      SELECT DISTINCT sm.fig_num FROM set_minifigs sm
      JOIN lego_sets ls ON ls.set_num = sm.set_num
      WHERE ls.theme = 'Collectible Minifigures'
    ),
    owned AS (SELECT DISTINCT fig_num FROM user_minifigs)
    SELECT m.fig_num, m.name, m.appears_in_sets, m.bl_id, m.year, m.current_value,
      (CASE
        WHEN m.fig_num IN (SELECT fig_num FROM owned) THEN 0
        WHEN COALESCE(m.current_value, 0) >= 10 THEN 1
        WHEN m.fig_num IN (SELECT fig_num FROM cmf) THEN 2
        ELSE 3
      END) AS priority
    FROM minifigs m
    WHERE (m.cached_at IS NULL OR m.cached_at < datetime('now', '-14 days'))
      AND (
        m.fig_num IN (SELECT fig_num FROM owned)
        OR COALESCE(m.current_value, 0) >= 10
        OR m.fig_num IN (SELECT fig_num FROM cmf)
        OR COALESCE(m.appears_in_sets, 0) >= 3
      )
    ORDER BY priority ASC, COALESCE(m.cached_at, '2000-01-01') ASC, COALESCE(m.appears_in_sets, 0) DESC
    LIMIT ?
  `).bind(limit).all<{ fig_num: string; name: string; appears_in_sets: number | null; bl_id: string | null; year: number | null; current_value: number | null; priority: number }>();

  // Account the BrickLink spend in the daily ledger (advisory — minifig
  // batches are far below the 4,000/day budget, but visibility matters).
  await reserveQuota(env, { bricklink: results.length });

  // Multi-source (G1b): only worth an eBay scrape (5 Firecrawl credits) for
  // figs valuable enough that a second source matters — cheap commons don't.
  const fcOn = firecrawlEnabled(env);
  const EBAY_MIN_VALUE = 10;
  // eBay-as-primary is now open to every queued fig, so cap the scrapes per run:
  // the candidate list is already ordered by priority, so the cap spends itself
  // on owned → valuable → Collectible-Minifigures before generic popular figs.
  // Also keeps the invocation inside the subrequest budget.
  const ebayBudget = Math.min(Math.max(0, Math.floor(options.ebayLimit ?? 60)), limit);

  const summary: ValuateMinifigsSummary = { figs: results.length, priced: 0, bl_matched: 0, parked: 0, ebay: 0, missed: 0 };
  let ebaySpent = 0;
  for (const fig of results) {
    // Resolve the BrickLink id lazily: Rebrickable fig-numbers aren't valid on
    // BrickLink, so we match this fig's normalized name (+year) against the
    // uploaded BrickLink catalog and cache the id on the row. Candidates are
    // pulled in three shapes — exact name, BrickLink name extending ours, our
    // name extending BrickLink's — and matchBlCandidates only auto-assigns when
    // the best tier resolves to one id; the rest go to the verifier.
    let blId = fig.bl_id;
    if (!blId) {
      const norm = normalizeMinifigName(fig.name);
      const exactKeys = [norm, ...namePrefixes(norm)];
      const placeholders = exactKeys.map((_, i) => `?${i + 1}`).join(',');
      // Range bounds instead of LIKE 'norm %': ' ' (0x20) → '!' (0x21) covers
      // every name extending `norm`, and unlike LIKE it uses idx_bl_mf_norm.
      const cand = await env.DB.prepare(
        `SELECT bl_id, norm_name, year FROM bricklink_minifigs
         WHERE norm_name IN (${placeholders})
            OR (norm_name > ?${exactKeys.length + 1} AND norm_name < ?${exactKeys.length + 2})
         LIMIT 60`,
      ).bind(...exactKeys, `${norm} `, `${norm}!`).all<BlNameCandidate>()
        .catch(() => ({ results: [] as BlNameCandidate[] }));
      const match = matchBlCandidates(cand.results ?? [], norm, fig.year);
      blId = match.bl_id;
      if (blId) {
        summary.bl_matched++;
        await env.DB.prepare(`UPDATE minifigs SET bl_id = ? WHERE fig_num = ?`)
          .bind(blId, fig.fig_num).run().catch(() => {});
      } else if (match.ambiguous.length) {
        // Ambiguous matches: park the candidates in the verification queue
        // (settled later by price-agreement in minifig-verify) instead of
        // dropping them — dropped meant the fig could never be priced.
        summary.parked++;
        for (const c of match.ambiguous) {
          await env.DB.prepare(`
            INSERT INTO minifig_bl_candidates (fig_num, bl_id, evidence_json)
            VALUES (?, ?, ?) ON CONFLICT (fig_num, bl_id) DO NOTHING
          `).bind(
            fig.fig_num,
            c.bl_id,
            JSON.stringify({ candidate_year: c.year, fig_year: fig.year, tier: match.tier }),
          ).run().catch(() => {});
        }
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
    // act as the PRIMARY source for any queued fig BrickLink couldn't price.
    // The old gate restricted eBay-as-primary to priority 0 (owned), and with
    // no owned figs in the database that branch never fired — leaving every
    // unmapped fig permanently unpriced. Spend is bounded by ebayBudget rather
    // than by priority, so the highest-priority figs still go first.
    const wantEbay = fcOn && ebaySpent < ebayBudget && (
      (blValue != null && blValue >= EBAY_MIN_VALUE)
      || blValue == null
    );
    let ebayAttempted = false;
    if (wantEbay) {
      ebayAttempted = true;
      ebaySpent++;
      summary.ebay++;
      const eb = await fetchMinifigEbaySoldViaFirecrawl(fig.fig_num, fig.name, env).catch(() => null);
      if (eb && eb.status === 'ok' && eb.value != null && eb.value > 0) {
        if (blValue == null) {
          // eBay is the SOLE source — apply the plausibility guard (<= $150, or
          // within 3x of the fig's own previous value). On rejection: record
          // the observation + stamp cached_at so the fig doesn't re-queue at
          // the head of every run, but leave current_value/rarity untouched,
          // and surface the reject in the admin anomaly panel.
          if (plausibleEbayOnlyFigValue(eb.value, { prior: fig.current_value })) {
            value = eb.value;          // eBay is the only source
            ebayValue = eb.value;
            ebayQty = eb.count;
            lots = 0;
          } else {
            await env.DB.prepare(`
              UPDATE minifigs SET ebay_value = ?, ebay_qty = ?, ebay_cached_at = datetime('now'),
                cached_at = datetime('now')
              WHERE fig_num = ?
            `).bind(eb.value, eb.count, fig.fig_num).run().catch(() => {});
            await env.DB.prepare(`
              INSERT INTO pricing_anomalies (
                anomaly_key, set_num, condition, source, anomaly_type, severity,
                detail_json, status, first_seen_at, last_seen_at
              ) VALUES (?1, NULL, 'used_complete', 'ebay_sold', 'implausible_solo_value', 'warning', ?2, 'open', datetime('now'), datetime('now'))
              ON CONFLICT(anomaly_key) DO UPDATE SET
                detail_json=excluded.detail_json, status='open', last_seen_at=datetime('now'), resolved_at=NULL
            `).bind(
              `minifig:${fig.fig_num}:ebay_solo`,
              JSON.stringify({ fig_num: fig.fig_num, observed: eb.value, prior: fig.current_value ?? null }),
            ).run().catch(() => {});
            summary.missed++;
            continue;
          }
        } else if (eb.value >= blValue / 3 && eb.value <= blValue * 3) {  // corroboration gate
          ebayValue = eb.value;
          ebayQty = eb.count;
          const w1 = Math.max(1, blLots);
          const w2 = Math.max(1, eb.count);
          value = Math.round(((blValue * w1 + eb.value * w2) / (w1 + w2)) * 100) / 100;
        }
      }
    }

    if (value == null || value <= 0) {
      // No market value from either source. STAMP THE ATTEMPT anyway: the
      // candidate query is stale-first on cached_at, so a fig left un-stamped
      // sorted straight back to the head of the next run — the queue ground on
      // the same few hundred unpriceable figs forever and never reached the
      // rest of the eligible population. Stamping cools this fig for the 14-day
      // TTL and leaves current_value/rarity untouched.
      summary.missed++;
      await env.DB.prepare(`
        UPDATE minifigs SET cached_at = datetime('now'),
          ebay_cached_at = CASE WHEN ? THEN datetime('now') ELSE ebay_cached_at END
        WHERE fig_num = ?
      `).bind(ebayAttempted ? 1 : 0, fig.fig_num).run().catch(() => {});
      continue;
    }

    // Rarity reflects the blended value + combined market liquidity.
    const rarity = computeMinifigRarity(value, fig.appears_in_sets, lots + ebayQty);
    const source = ebayValue != null ? (blValue != null ? 'bricklink+ebay' : 'ebay') : 'bricklink';
    await env.DB.prepare(`
      UPDATE minifigs SET current_value = ?, rarity = ?, source = ?,
        ebay_value = ?, ebay_qty = ?, ebay_cached_at = CASE WHEN ? THEN datetime('now') ELSE ebay_cached_at END,
        cached_at = datetime('now')
      WHERE fig_num = ?
    `).bind(value, rarity, source, ebayValue, ebayQty, ebayAttempted ? 1 : 0, fig.fig_num).run();
    summary.priced++;
  }
  return summary;
}
