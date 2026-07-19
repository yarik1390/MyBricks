import type { Env } from '../types';
import { fetchMinifigPricing } from '../lib/bricklink';
import { reserveQuota } from '../lib/api-quota';

// Settle ambiguous Rebrickable->BrickLink minifig identity by PRICE AGREEMENT,
// mirroring the policy that un-quarantined PriceCharting for sets
// (jobs/pricecharting-verify.ts): a candidate id whose market price agrees
// with what we already know about the fig is overwhelmingly likely to be the
// right item; same-name-different-fig collisions disagree wildly.
//
// Decision per fig (all pending candidates priced in one pass):
//  - fig has its own current_value: candidates within 3x of it "agree";
//    exactly ONE agreeing candidate -> verified (siblings rejected).
//  - fig has no value yet: exactly ONE candidate with any market presence
//    (value + lots) -> verified. Multiple with presence -> stays pending.
// Undecided figs keep status 'pending' with checked_at stamped so retries
// rotate instead of re-burning the same heads.

const FIGS_PER_RUN = 20; // × ~2-3 candidates ≈ ~40-60 BrickLink calls

export async function runMinifigVerify(env: Env, options: { limit?: number } = {}) {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? FIGS_PER_RUN)), 50);

  const { results: figs } = await env.DB.prepare(`
    SELECT c.fig_num, m.current_value,
           MIN(COALESCE(c.checked_at, '2000-01-01')) AS oldest_check
    FROM minifig_bl_candidates c
    JOIN minifigs m ON m.fig_num = c.fig_num
    WHERE c.status = 'pending' AND m.bl_id IS NULL
    GROUP BY c.fig_num
    ORDER BY oldest_check ASC
    LIMIT ?
  `).bind(limit).all<{ fig_num: string; current_value: number | null }>();
  if (!figs.length) return { figs: 0, verified: 0, checked: 0 };

  let verified = 0;
  let checked = 0;
  for (const fig of figs) {
    const { results: candidates } = await env.DB.prepare(
      `SELECT bl_id FROM minifig_bl_candidates WHERE fig_num = ? AND status = 'pending'`,
    ).bind(fig.fig_num).all<{ bl_id: string }>();
    if (!candidates.length) continue;

    await reserveQuota(env, { bricklink: candidates.length });
    const priced: Array<{ bl_id: string; value: number | null; lots: number }> = [];
    for (const cand of candidates) {
      const px = await fetchMinifigPricing(cand.bl_id, env, { recordHealth: false }).catch(() => null);
      priced.push({ bl_id: cand.bl_id, value: px?.value ?? null, lots: px?.lots ?? 0 });
      checked++;
    }

    const prior = Number(fig.current_value);
    const hasPrior = Number.isFinite(prior) && prior > 0;
    const agreeing = hasPrior
      ? priced.filter((p) => p.value != null && p.value > 0 && p.value >= prior / 3 && p.value <= prior * 3)
      : priced.filter((p) => p.value != null && p.value > 0 && p.lots > 0);

    if (agreeing.length === 1) {
      const winner = agreeing[0];
      await env.DB.batch([
        env.DB.prepare(`UPDATE minifigs SET bl_id = ? WHERE fig_num = ?`).bind(winner.bl_id, fig.fig_num),
        env.DB.prepare(`
          UPDATE minifig_bl_candidates
          SET status = CASE WHEN bl_id = ?1 THEN 'verified' ELSE 'rejected' END,
              decided_at = datetime('now'), checked_at = datetime('now'),
              evidence_json = json_object('winner_value', ?2, 'prior', ?3)
          WHERE fig_num = ?4 AND status = 'pending'
        `).bind(winner.bl_id, winner.value, hasPrior ? prior : null, fig.fig_num),
      ]);
      verified++;
    } else {
      await env.DB.prepare(
        `UPDATE minifig_bl_candidates SET checked_at = datetime('now') WHERE fig_num = ? AND status = 'pending'`,
      ).bind(fig.fig_num).run().catch(() => {});
    }
  }
  return { figs: figs.length, verified, checked };
}
