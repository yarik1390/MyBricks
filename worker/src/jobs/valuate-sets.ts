import OpenAI from 'openai';
import type { Env } from '../types';
import { fetchSetPricing, fetchUsedPricing, fetchMinifigPricing } from '../lib/bricklink';
import { fetchBrickOwlPricing } from '../lib/brickowl-pricing';
import { callGeminiValuation } from '../lib/gemini';
import {
  buildEbayAskUpdate,
  buildEbaySoldUpdate,
  ebaySoldHasValue,
  ebaySoldNewValue,
  fetchEbayActiveListings,
  fetchEbaySoldPrices,
  isEbayAccessError,
  type EbaySoldPrices,
} from '../lib/ebay';
import { fetchBrickEconomyDetails } from '../lib/brickeconomy';
import {
  DEFAULT_CRON_BUDGET,
  packBatch,
  reserveQuota,
  type PackProfile,
} from '../lib/api-quota';
import { valuationExpiryModifier } from '../lib/valuation';
import { computeRetirementRisk } from '../lib/retirement-risk';
import {
  clearIntegrationBlock,
  isIntegrationBlocked,
  recordIntegrationHealth,
  setIntegrationBlock,
  type IntegrationName,
} from '../lib/integration-health';

export interface ValuateSetsOptions {
  scope?: 'owned' | 'all';
  limit?: number;
  includeFresh?: boolean;
  includeSupplemental?: boolean;
  includeEbay?: boolean;
  includeMinifigs?: boolean;
  includeAiFallback?: boolean;
  sourceRetries?: number;
  sourceTimeoutMs?: number;
  /**
   * Subrequest budget for this invocation. Free-plan Workers allow 50 and
   * every fetch/D1/KV call counts, so the batch size is packed to fit (see
   * lib/api-quota.ts). Callers sharing an invocation with other phases (e.g.
   * admin populate slices) should pass what remains of their budget.
   */
  subrequestBudget?: number;
  onProgress?: (progress: { processed: number; updated: number; total: number; currentSet?: string }) => Promise<void>;
}

export async function runValuateSets(env: Env, options: ValuateSetsOptions = {}) {
  // Aggregate external-API health across the whole run, then persist once per service.
  const health: Record<string, { ok: number; fail: number; lastError?: string }> = {
    ebay: { ok: 0, fail: 0 },
    bricklink: { ok: 0, fail: 0 },
    brickeconomy: { ok: 0, fail: 0 },
    brickowl: { ok: 0, fail: 0 },
  };
  const tallyOk = (s: IntegrationName) => { health[s].ok++; };
  const tallyFail = (s: IntegrationName, e: unknown) => {
    health[s].fail++;
    health[s].lastError = (e as Error)?.message || String(e);
  };
  const scope = options.scope ?? 'owned';
  const sourceOptions = {
    recordHealth: false,
    retries: options.sourceRetries ?? 0,
    timeoutMs: options.sourceTimeoutMs ?? 5000,
  };
  const includeSupplemental = options.includeSupplemental === true;
  const includeEbay = options.includeEbay === true;
  const includeAiFallback = options.includeAiFallback !== false;
  const requestedLimit = Number(options.limit);
  // Default raised from the old hand-tuned 4: the invocation packer below is
  // now the real safety limit, sizing each batch to the subrequest budget.
  const requested = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 250)
    : 12;
  const packProfile: PackProfile = {
    brickEconomy: !!env.BRICKECONOMY_API_KEY,
    supplemental: includeSupplemental,
    ebay: includeEbay,
    aiFallback: includeAiFallback && !!(env.GEMINI_API_KEY || env.OPENAI_API_KEY),
    progressWrites: !!options.onProgress,
  };
  const requestedBudget = Number(options.subrequestBudget);
  const subrequestBudget = Number.isFinite(requestedBudget) && requestedBudget > 0
    ? requestedBudget
    : DEFAULT_CRON_BUDGET;
  const limit = packBatch(requested, subrequestBudget, packProfile);
  const duePredicate = `(
    ls.valuation_method = 'formula_bulk'
    OR ls.valuation_expires_at IS NULL
    OR ls.valuation_expires_at < datetime('now')
    OR ls.cached_at IS NULL
  )`;
  const scopePredicate = scope === 'owned'
    ? `AND (
        ls.set_num IN (SELECT DISTINCT set_num FROM user_collection WHERE deleted_at IS NULL)
        OR ls.set_num IN (SELECT DISTINCT set_num FROM user_wishlist)
      )`
    : '';
  const freshnessPredicate = options.includeFresh ? '' : `AND ${duePredicate}`;

  // Prioritize overdue/formula rows first, then rotate through the oldest
  // cached valuations. With scope='all' this steadily covers the whole catalog.
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT ls.set_num, ls.name, ls.theme, ls.year, ls.pieces, ls.minifigs, ls.retired,
      (ls.ebay_ask_cached_at IS NULL OR ls.ebay_ask_cached_at < datetime('now', '-7 days')) AS ask_stale
    FROM lego_sets ls
    WHERE 1=1
      ${freshnessPredicate}
      ${scopePredicate}
    ORDER BY
      CASE WHEN ${duePredicate} THEN 0 ELSE 1 END,
      COALESCE(ls.valuation_expires_at, ls.cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string; theme: string | null; year: number; pieces: number; minifigs: number; retired: number; ask_stale: number }>();

  // Reserve today's external-API budget for this batch up front (2-3 D1
  // round-trips total). BrickEconomy is the scarce source (80/day budget of a
  // 100/day hard cap): when its grant runs out mid-batch, sets transparently
  // fall back to the BrickLink-primary path. Other grants are reservations
  // for accounting/visibility; their budgets are far above any single run.
  const grants = await reserveQuota(env, {
    brickeconomy: packProfile.brickEconomy ? results.length : 0,
    bricklink: results.length * 2,
    brickowl: includeSupplemental ? results.length : 0,
    ebay: includeEbay ? results.length * 2 : 0,
  });
  let beBudget = grants.brickeconomy ?? 0;

  const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
  let updated = 0, market = 0, ai = 0;
  // Circuit breaker: honor a persisted block from a previous run so each batch
  // doesn't re-probe an access-denied eBay keyset. Expires automatically.
  let ebayBlocked = includeEbay ? await isIntegrationBlocked(env, 'ebay') : false;
  let ebayBlockPersisted = ebayBlocked;
  let ebayBlockCleared = false;
  // Browse API (basic scope) access tracked separately from the Marketplace
  // Insights block — run-local only, since most keysets have basic scope.
  let browseDenied = false;

  const markEbayBlocked = async () => {
    ebayBlocked = true;
    if (!ebayBlockPersisted) {
      ebayBlockPersisted = true;
      await setIntegrationBlock(env, 'ebay', 6);
    }
  };

  const tallyEbayResult = async (prices: EbaySoldPrices | null) => {
    if (!prices || prices.status === 'unconfigured') return;
    if (prices.status === 'error' || prices.status === 'unauthorized') {
      tallyFail('ebay', prices.error || prices.status);
      if (prices.status === 'unauthorized' || isEbayAccessError(prices.error)) {
        await markEbayBlocked();
      }
      return;
    }
    tallyOk('ebay');
    if (!ebayBlockCleared) {
      ebayBlockCleared = true;
      await clearIntegrationBlock(env, 'ebay');
    }
  };

  let processed = 0;
  for (const set of results) {
    const processedBefore = processed;
    try {
    let pricing: { current_value: number } | null = null;
    let usedPricing: { used_value: number; lot_count?: number; min_price?: number | null; max_price?: number | null } | null = null;
    let ebayPrices: EbaySoldPrices | null = null;
    let valMethod = 'market';
    let beDetails: any = null;

    // Batch runs stay source-light to avoid Cloudflare subrequest limits.
    // Detail-page refreshes still fan out across providers.
    let blPricing: { current_value: number; lot_count: number; min_price: number | null; max_price: number | null } | null = null;

    // Ledger-gated: skip BrickEconomy once today's grant is spent — the set
    // then prices via the BrickLink-primary path below instead of failing.
    if (env.BRICKECONOMY_API_KEY && beBudget > 0) {
      beBudget--;
      const be = await fetchBrickEconomyDetails(set.set_num, env, sourceOptions)
        .catch((err) => { tallyFail('brickeconomy', err); return null; });
      if (be) tallyOk('brickeconomy');
      beDetails = be;
      usedPricing = be?.current_value_used ? { used_value: be.current_value_used } : null;

      if (beDetails && beDetails.current_value_new !== null) {
        pricing = { current_value: beDetails.current_value_new };
        valMethod = 'brickeconomy';
      }
    }

    if (includeSupplemental) {
      blPricing = await fetchSetPricing(set.set_num, env, sourceOptions)
        .catch((err) => { tallyFail('bricklink', err); return null; });
      if (blPricing) tallyOk('bricklink');
      if (!usedPricing) {
        usedPricing = await fetchUsedPricing(set.set_num, env, sourceOptions)
          .catch((err) => { tallyFail('bricklink', err); return null; });
        if (usedPricing) tallyOk('bricklink');
      }
    }

    if (includeEbay && !ebayBlocked) {
      ebayPrices = await fetchEbaySoldPrices(set.set_num, set.name, env, sourceOptions)
        .catch(async (err) => {
          tallyFail('ebay', err);
          if (isEbayAccessError((err as Error)?.message || String(err))) await markEbayBlocked();
          return null;
        });
      await tallyEbayResult(ebayPrices);
    }

    if (!pricing) {
      // BrickEconomy not configured or returned no data — use BrickLink as primary
      if (!blPricing || !usedPricing) {
        if (!blPricing) {
          blPricing = await fetchSetPricing(set.set_num, env, sourceOptions)
            .catch((err) => { tallyFail('bricklink', err); return null; });
          if (blPricing) tallyOk('bricklink');
        }
        if (!usedPricing) {
          usedPricing = await fetchUsedPricing(set.set_num, env, sourceOptions)
            .catch((err) => { tallyFail('bricklink', err); return null; });
          if (usedPricing) tallyOk('bricklink');
        }
        if (includeEbay && !ebayBlocked && ebayPrices === null) {
          ebayPrices = await fetchEbaySoldPrices(set.set_num, set.name, env, sourceOptions)
            .catch(async (err) => {
              tallyFail('ebay', err);
              if (isEbayAccessError((err as Error)?.message || String(err))) await markEbayBlocked();
              return null;
            });
          await tallyEbayResult(ebayPrices);
        }
      }
      pricing = blPricing;
      valMethod = 'market';
    }

    // Write used + eBay + BrickLink new prices (independent of main valuation path)
    const supplementStmts: D1PreparedStatement[] = [];
    if (usedPricing) {
      supplementStmts.push(
        env.DB.prepare('UPDATE lego_sets SET used_value=? WHERE set_num=?')
          .bind(usedPricing.used_value, set.set_num)
      );
    }
    const ebayStmt = buildEbaySoldUpdate(env.DB, set.set_num, ebayPrices);
    if (ebayStmt) supplementStmts.push(ebayStmt);
    // Supply signal: weekly refresh of active-listing ask price + count for
    // prioritized (owned/wishlisted) sets only. The Browse API needs only the
    // basic OAuth scope, so a Marketplace Insights block must not starve it —
    // it runs regardless of ebayBlocked, with its own run-local access flag.
    if (includeEbay && !browseDenied && set.ask_stale) {
      const listings = await fetchEbayActiveListings(set.set_num, set.name, env, sourceOptions)
        .catch((err) => { tallyFail('ebay', err); return null; });
      if (listings && !listings.error) tallyOk('ebay');
      else if (listings?.error) {
        tallyFail('ebay', listings.error);
        if (isEbayAccessError(listings.error)) browseDenied = true;
      }
      const askStmt = buildEbayAskUpdate(env.DB, set.set_num, listings);
      if (askStmt) supplementStmts.push(askStmt);
    }
    if (blPricing) {
      supplementStmts.push(
        env.DB.prepare(`UPDATE lego_sets SET bl_new_value=?, bl_new_qty=?, bl_new_min=?, bl_new_max=?, bl_cached_at=datetime('now') WHERE set_num=?`)
          .bind(blPricing.current_value, blPricing.lot_count, blPricing.min_price ?? null, blPricing.max_price ?? null, set.set_num)
      );
    }
    const hasBrickLinkUsedMeta = usedPricing?.lot_count != null
      || usedPricing?.min_price != null
      || usedPricing?.max_price != null;
    if (hasBrickLinkUsedMeta) {
      supplementStmts.push(
        env.DB.prepare(`UPDATE lego_sets SET bl_used_qty=?, bl_used_min=?, bl_used_max=?, bl_cached_at=datetime('now') WHERE set_num=?`)
          .bind(usedPricing?.lot_count ?? null, usedPricing?.min_price ?? null, usedPricing?.max_price ?? null, set.set_num)
      );
    }
    if (beDetails) {
      supplementStmts.push(
        env.DB.prepare(`UPDATE lego_sets SET be_cached_at=datetime('now'), be_growth_12m=COALESCE(?, be_growth_12m) WHERE set_num=?`)
          .bind(beDetails.rolling_growth_12months ?? null, set.set_num)
      );
    }
    // BrickOwl as 4th supplemental pricing source
    if (includeSupplemental) {
      const boPricing = await fetchBrickOwlPricing(set.set_num, env, sourceOptions)
        .catch((err) => { tallyFail('brickowl', err); return null; });
      if (boPricing) {
        tallyOk('brickowl');
        supplementStmts.push(
          env.DB.prepare(`UPDATE lego_sets SET bo_new_value=?, bo_used_value=?, bo_cached_at=datetime('now') WHERE set_num=?`)
            .bind(boPricing.new_value, boPricing.used_value, set.set_num)
        );
      }
    }
    if (supplementStmts.length) await env.DB.batch(supplementStmts);

    if (pricing) {
      // Use BrickEconomy rolling 12-month growth for forward rate when available.
      // Clamp to 2%–25% to guard against data outliers.
      const defaultYr = set.retired ? 0.15 : 0.10;
      const yr = (beDetails?.rolling_growth_12months != null)
        ? Math.min(0.25, Math.max(0.02, beDetails.rolling_growth_12months / 100))
        : defaultYr;

      let forecast_2y = Math.round(pricing.current_value * Math.pow(1 + yr, 2) * 100) / 100;
      let forecast_5y = Math.round(pricing.current_value * Math.pow(1 + yr, 5) * 100) / 100;
      let retailPrice: number | null = null;

      if (valMethod === 'brickeconomy' && beDetails) {
        if (beDetails.forecast_value_new_2_years !== null) {
          forecast_2y = beDetails.forecast_value_new_2_years;
        }
        if (beDetails.retail_price_us !== null) {
          retailPrice = beDetails.retail_price_us;
        }
      }

      await env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          retail_price=COALESCE(?, retail_price),
          valuation_method=?,
          valuation_expires_at=datetime('now', ?),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(pricing.current_value, forecast_2y, forecast_5y, retailPrice, valMethod, valuationExpiryModifier(valMethod), set.set_num).run();
      updated++;
      if (valMethod === 'market') {
        market++;
      }
      processed++;
      if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
      continue;
    }

    const ebayPrice = ebaySoldNewValue(ebayPrices);
    if (ebayPrice !== null && ebayPrice !== undefined) {
      const yr = set.retired ? 0.15 : 0.10;
      const forecast_2y = Math.round(ebayPrice * Math.pow(1 + yr, 2) * 100) / 100;
      const forecast_5y = Math.round(ebayPrice * Math.pow(1 + yr, 5) * 100) / 100;
      await env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          valuation_method='ebay_sold',
          valuation_expires_at=datetime('now', ?),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(ebayPrice, forecast_2y, forecast_5y, valuationExpiryModifier('ebay_sold'), set.set_num).run();
      updated++;
      processed++;
      if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
      continue;
    }

    if (!includeAiFallback) {
      await env.DB.prepare(`
        UPDATE lego_sets SET
          valuation_expires_at=datetime('now', '+1 day'),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(set.set_num).run();
      processed++;
      if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
      continue;
    }

    // Fall back to Gemini (cheaper) then GPT-4o-mini
    if (env.GEMINI_API_KEY) {
      try {
        const gemVals = await callGeminiValuation(set.set_num as string, set.name, env.GEMINI_API_KEY, env);
        if (gemVals?.current_value) {
          await env.DB.prepare(`
            UPDATE lego_sets SET
              current_value=?, used_value=COALESCE(?, used_value),
              valuation_method='ai',
              valuation_expires_at=datetime('now', ?),
              cached_at=datetime('now')
            WHERE set_num=?
          `).bind(gemVals.current_value, gemVals.used_value ?? null,
                  valuationExpiryModifier('ai'), set.set_num).run();
          updated++; ai++;
          processed++;
          if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
          continue;
        }
      } catch (e) {
        console.warn(`[valuate] Gemini failed for ${set.set_num}:`, (e as Error).message);
      }
    }
    if (!openai) {
      processed++;
      if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
      continue;
    }
    try {
      const result = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [
          { role: 'system', content: 'You are a LEGO market analyst. Return JSON only: { "retail_price": number, "current_value": number, "forecast_2y": number, "forecast_5y": number, "retired": boolean }' },
          { role: 'user', content: `Set: ${set.name}. Theme: ${set.theme || 'Unknown'}. Year: ${set.year}. Pieces: ${set.pieces}. Minifigs: ${set.minifigs}. Estimate market values in USD.` },
        ],
      });
      const text = result.choices[0].message.content;
      if (!text || result.choices[0].finish_reason === 'length') {
        processed++;
        if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
        continue;
      }
      const vals = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as {
        retail_price: number; current_value: number; forecast_2y: number; forecast_5y: number;
      };
      // Sanity-check the AI value against retail price to reject hallucinations.
      if (vals.retail_price && vals.current_value) {
        const pieceCount = Number(set.pieces ?? 0);
        const maxCapMultiplier = pieceCount > 500 ? 8 : 15;
        if (vals.current_value < 0.3 * vals.retail_price || vals.current_value > maxCapMultiplier * vals.retail_price) {
          console.warn(`[valuate] ${set.set_num}: AI value $${vals.current_value} out of sanity range vs retail $${vals.retail_price} (limit ${maxCapMultiplier}x, pieces: ${pieceCount}) — skipped`);
          processed++;
          if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
          continue;
        }
      }
      await env.DB.prepare(`
        UPDATE lego_sets SET
          retail_price=?, current_value=?, forecast_2y=?, forecast_5y=?,
          valuation_method='ai',
          valuation_expires_at=datetime('now', ?),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(vals.retail_price ?? null, vals.current_value ?? null, vals.forecast_2y ?? null, vals.forecast_5y ?? null,
              valuationExpiryModifier('ai'), set.set_num).run();
      updated++; ai++;
    } catch (e) {
      console.warn(`[valuate] failed for ${set.set_num}:`, (e as Error).message);
    }
    processed++;
    if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
    } catch (e) {
      // One bad set (D1 write error, malformed provider payload) must not kill
      // the whole batch — log it, count it processed, and move on.
      console.error(`[valuate] ${set.set_num} failed:`, (e as Error)?.message || e);
      if (processed === processedBefore) processed++;
      if (options.onProgress) {
        await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num }).catch(() => {});
      }
    }
  }

  await updateRetirementRiskBatch(env);
  if (options.includeMinifigs === true) {
    await runValuateMinifigs(env).catch(err => console.error('[bg-valuate-minifigs] failed:', err));
  }

  // Persist aggregated external-API health (one row per service per run).
  for (const [service, t] of Object.entries(health)) {
    await recordIntegrationHealth(env, service as IntegrationName, t);
  }

  return { processed: results.length, updated, market, ai, scope, limit };
}

export async function runEbayBackfill(env: Env, options: { limit?: number } = {}) {
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 2)
    : 1;
  // Circuit breaker: skip the whole backfill while a previous access-denied
  // block is still active.
  if (await isIntegrationBlocked(env, 'ebay')) {
    return { processed: 0, updated: 0, limit, skipped: 'ebay access blocked' };
  }
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name
    FROM lego_sets ls
    WHERE (
      (ls.ebay_new_value IS NULL AND (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-7 days')))
      OR (ls.ebay_used_value IS NULL AND (ls.ebay_used_cached_at IS NULL OR ls.ebay_used_cached_at < datetime('now', '-7 days')))
    )
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc
        WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw
        WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.ebay_new_cached_at, '2000-01-01') ASC,
      COALESCE(ls.ebay_used_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string }>();

  // Account the eBay spend in the daily ledger (advisory at backfill sizes).
  await reserveQuota(env, { ebay: results.length });

  let updated = 0;
  let processed = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  for (const set of results) {
    processed++;
    const prices = await fetchEbaySoldPrices(set.set_num, set.name, env, { recordHealth: false })
      .catch((err) => {
        health.fail++;
        health.lastError = (err as Error)?.message || String(err);
        return null;
      });
    if (prices?.status === 'error' || prices?.status === 'unauthorized') {
      health.fail++;
      health.lastError = prices.error || prices.status;
    } else if (prices?.status && prices.status !== 'unconfigured') {
      health.ok++;
    }
    const stmt = buildEbaySoldUpdate(env.DB, set.set_num, prices);
    if (stmt) {
      await stmt.run();
      if (ebaySoldHasValue(prices)) updated++;
    }
    if (prices?.status === 'unauthorized' || isEbayAccessError(prices?.error)) {
      await setIntegrationBlock(env, 'ebay', 6);
      break;
    }
  }

  await recordIntegrationHealth(env, 'ebay', health);

  return { processed, updated, limit };
}

export async function runValuateMinifigs(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT m.fig_num
    FROM minifigs m
    JOIN user_minifigs um ON um.fig_num = m.fig_num
    WHERE m.cached_at IS NULL OR m.cached_at < datetime('now', '-7 days')
    ORDER BY COALESCE(m.cached_at, '2000-01-01') ASC
    LIMIT 10
  `).all<{ fig_num: string }>();

  // Account the BrickLink spend in the daily ledger (advisory — minifig
  // batches are far below the 4,000/day budget, but visibility matters).
  await reserveQuota(env, { bricklink: results.length });

  let updated = 0;
  for (const fig of results) {
    const price = await fetchMinifigPricing(fig.fig_num, env, { recordHealth: false }).catch(() => null);
    if (price !== null && price > 0) {
      await env.DB.prepare(`
        UPDATE minifigs SET current_value = ?, cached_at = datetime('now') WHERE fig_num = ?
      `).bind(price, fig.fig_num).run();
      updated++;
    }
  }
  return updated;
}

// Batch-update retirement risk scores for sets due for refresh (null or >7 days old).
async function updateRetirementRiskBatch(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`
    SELECT set_num, year, theme, pieces, retired FROM lego_sets
    WHERE retired = 0
      AND (retirement_risk_updated_at IS NULL
           OR retirement_risk_updated_at < datetime('now', '-7 days'))
    LIMIT 200
  `).all<{ set_num: string; year: number; theme: string | null; pieces: number; retired: number }>();

  if (!results.length) return;

  const stmts = results.map(s =>
    env.DB.prepare(`
      UPDATE lego_sets SET retirement_risk_score=?, retirement_risk_updated_at=datetime('now')
      WHERE set_num=?
    `).bind(computeRetirementRisk(s), s.set_num)
  );

  // Process in batches of 100 (D1 batch limit)
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
}
