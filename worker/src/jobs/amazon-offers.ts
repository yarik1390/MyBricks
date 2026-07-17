import type { Env } from '../types';
import { amazonMarket, getFreshAmazonOffer } from '../lib/amazon';
import { fetchAmazonCreatorsOffer } from '../lib/amazon-creators';
import { quotaRemaining, spendQuota } from '../lib/api-quota';
import { sourceEnabled } from '../lib/source-config';

const truthy = (value: unknown): boolean => /^(1|true|yes|on)$/i.test(String(value || ''));

/**
 * Refresh live Amazon offers (Creators API) for the sets users actually see:
 * owned/wishlisted first, then retiring-soon, then the value-sorted head.
 *
 * COMPLIANCE (Associates terms): offers live ONLY in KV (`amazon:offer:*`)
 * with a 24h TTL — never persisted to D1, never fed into valuations or the
 * retail price history. The set-detail route merges a fresh KV offer into
 * `__retail_offer` at read time, so acquisition prices and the buy slot pick
 * it up while the data stays ephemeral.
 *
 * Requires AMAZON_CREATORS_ENABLED=1 + credential pair; the account must hold
 * Creators API eligibility (>= 10 qualifying sales / 30 days) or every call
 * is denied and the job backs off via integration health.
 */
export async function runAmazonOffers(
  env: Env,
  options: { limit?: number } = {},
): Promise<{ processed: number; updated: number; limit: number; skipped?: string }> {
  if (!truthy(env.AMAZON_CREATORS_ENABLED) || !env.AMAZON_CREATORS_PUBLIC_KEY || !env.AMAZON_CREATORS_PRIVATE_KEY) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'Creators API disabled (set AMAZON_CREATORS_ENABLED=1 + credentials)' };
  }
  if (!env.CACHE_KV) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'CACHE_KV binding missing — offers must be KV-cached (no D1 persistence allowed)' };
  }
  if (!(await sourceEnabled(env, 'amazon'))) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'Amazon disabled in admin source tuning' };
  }

  const remaining = await quotaRemaining(env, 'amazon');
  if (remaining <= 0) return { processed: 0, updated: 0, limit: 0, skipped: 'daily amazon cap reached' };

  const requested = Number(options.limit);
  const limit = Math.min(
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 60,
    remaining,
  );
  const market = amazonMarket(env.AMAZON_DEFAULT_MARKET, env);

  // Amazon only carries current/recent sets — old retired sets are 3P-seller
  // territory whose asks aren't retail signal. Over-select 2x, then skip rows
  // whose KV offer is still fresh (<23h) or recently returned no match.
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name
    FROM lego_sets ls
    WHERE ls.year >= 2018
    ORDER BY
      CASE WHEN ls.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL)
             OR ls.set_num IN (SELECT set_num FROM user_wishlist) THEN 0 ELSE 1 END,
      CASE WHEN ls.lego_retiring_soon = 1 OR ls.retirement_risk_score >= 70 THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit * 2).all<{ set_num: string; name: string | null }>();

  let processed = 0;
  let updated = 0;
  let consecutiveFailures = 0;

  for (const set of results) {
    if (processed >= limit) break;
    if (await getFreshAmazonOffer(env, set.set_num, market)) continue; // still fresh
    const noDataKey = `amazon:no-data:${market}:${set.set_num}`;
    if (await env.CACHE_KV.get(noDataKey).catch(() => null)) continue;
    if (!(await spendQuota(env, 'amazon', 1))) break;
    processed++;

    const offer = await fetchAmazonCreatorsOffer(env, set, market);
    if (!offer) {
      // Distinguish "no match" (cheap, back off 3 days) from provider failure
      // (bail after a few in a row — likely a token/eligibility outage).
      await env.CACHE_KV.put(noDataKey, '1', { expirationTtl: 3 * 86_400 }).catch(() => {});
      if (++consecutiveFailures >= 4) break;
      continue;
    }
    consecutiveFailures = 0;
    // 24h hard TTL — the read path additionally treats anything >= 23h as stale,
    // so a displayed price is always fresher than Amazon's republication limit.
    await env.CACHE_KV.put(`amazon:offer:${market}:${set.set_num}`, JSON.stringify(offer), { expirationTtl: 86_400 }).catch(() => {});
    updated++;
  }

  return { processed, updated, limit };
}
