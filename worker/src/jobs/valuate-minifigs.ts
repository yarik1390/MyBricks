import type { Env } from '../types';
import { fetchMinifigPricing } from '../lib/bricklink';
import { normalizeMinifigName, namePrefixes, matchBlCandidates } from '../lib/bricklink-minifigs';
import type { BlNameCandidate } from '../lib/bricklink-minifigs';
import { computeMinifigRarity } from '../lib/minifig-rarity';
import { reserveQuota } from '../lib/api-quota';
import { sourceEnabled } from '../lib/source-config';

export interface ValuateMinifigsSummary {
  figs: number;       // candidates pulled this run
  priced: number;     // rows that came away with a market value
  bl_matched: number; // BrickLink ids newly resolved
  parked: number;     // figs handed to the price-agreement verifier
  missed: number;     // attempted, no value from any source
  failed: number;     // provider failure; observation clocks unchanged
}

export async function runValuateMinifigs(
  env: Env,
  options: { limit?: number } = {},
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
      AND (m.attempted_at IS NULL OR m.attempted_at < datetime('now', '-14 days'))
      AND (
        m.fig_num IN (SELECT fig_num FROM owned)
        OR COALESCE(m.current_value, 0) >= 10
        OR m.fig_num IN (SELECT fig_num FROM cmf)
        OR COALESCE(m.appears_in_sets, 0) >= 3
      )
    ORDER BY priority ASC, COALESCE(m.attempted_at, m.cached_at, '2000-01-01') ASC, COALESCE(m.appears_in_sets, 0) DESC
    LIMIT ?
  `).bind(limit).all<{ fig_num: string; name: string; appears_in_sets: number | null; bl_id: string | null; year: number | null; current_value: number | null; priority: number }>();

  // Claim one BrickLink call per queued fig up front. The returned grant is the
  // hard processing ceiling: accounting failure/exhaustion must not leak calls,
  // and rows outside a partial grant must remain immediately eligible.
  if (!(await sourceEnabled(env, 'bricklink'))) {
    return { figs: results.length, priced: 0, bl_matched: 0, parked: 0, missed: 0, failed: 0 };
  }
  const grants = await reserveQuota(env, { bricklink: results.length });
  const grantedResults = results.slice(0, Math.min(results.length, grants.bricklink ?? 0));

  const summary: ValuateMinifigsSummary = { figs: results.length, priced: 0, bl_matched: 0, parked: 0, missed: 0, failed: 0 };
  for (const fig of grantedResults) {
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
    let px = null;
    let brickLinkFailed = false;
    if (blId) {
      try {
        px = await fetchMinifigPricing(blId, env, { recordHealth: false });
      } catch {
        brickLinkFailed = true;
      }
    }
    const blValue = px && px.value != null && px.value > 0 ? px.value : null;
    const blLots = px?.lots ?? 0;

    if (blValue == null) {
      // Do not cool the row after a provider failure; keep it eligible for the
      // next run. A verified empty guide still receives the normal miss stamp.
      if (brickLinkFailed) {
        summary.failed++;
        summary.missed++;
        continue;
      }
      // No market value. STAMP THE ATTEMPT anyway: the
      // candidate query is stale-first on cached_at, so a fig left un-stamped
      // sorted straight back to the head of the next run — the queue ground on
      // the same few hundred unpriceable figs forever and never reached the
      // rest of the eligible population. Stamping cools this fig for the 14-day
      // TTL and leaves current_value/rarity untouched.
      summary.missed++;
      await env.DB.prepare(`
        UPDATE minifigs SET attempted_at = datetime('now') WHERE fig_num = ?
      `).bind(fig.fig_num).run();
      continue;
    }

    const rarity = computeMinifigRarity(blValue, fig.appears_in_sets, blLots);
    await env.DB.prepare(`
      UPDATE minifigs SET current_value = ?, rarity = ?, source = 'bricklink',
        cached_at = datetime('now'), attempted_at = datetime('now')
      WHERE fig_num = ?
    `).bind(blValue, rarity, fig.fig_num).run();
    summary.priced++;
  }
  return summary;
}
