import OpenAI from 'openai';
import type { Env } from '../types';
import { fetchSetPricing, fetchUsedPricing, fetchMinifigPricing } from '../lib/bricklink';
import { fetchBrickOwlPricing } from '../lib/brickowl-pricing';
import { ebaySoldCompsEnabled, brickOwlEnabled, firecrawlEnabled } from '../lib/pricing-flags';
import { fetchMinifigEbaySoldViaFirecrawl } from '../lib/ebay-firecrawl';
import { callGeminiValuation } from '../lib/gemini';
import { MODELS, openAIServerBaseURL, gatewayHeaders, gatewayMetadataHeader, openRouterBaseURL } from '../lib/llm';
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
import {
  DEFAULT_CRON_BUDGET,
  packBatch,
  reserveQuota,
  type PackProfile,
} from '../lib/api-quota';
import { recomputeBlendedValues } from '../lib/market-sources';
import { valuationExpiryModifier, isPlausibleMarketValue, formulaValuation } from '../lib/valuation';
import { computeRetirementRisk } from '../lib/retirement-risk';
import { computeMinifigRarity } from '../lib/minifig-rarity';
import {
  clearIntegrationBlock,
  isIntegrationBlocked,
  recordIntegrationHealth,
  setIntegrationBlock,
  type IntegrationName,
} from '../lib/integration-health';
import { createAiUsageAccumulator, flushAiUsage, getAiSpendStatus } from '../lib/ai-usage';

export interface ValuateSetsOptions {
  scope?: 'owned' | 'all';
  limit?: number;
  /**
   * High-value refresh mode: restrict to real (non-formula) market values
   * worth at least `minValue`, ordered by value DESC, so the visible top of
   * the catalog stays fresh instead of expiring to "Older price".
   */
  prioritizeValue?: boolean;
  /**
   * Formula-head conversion mode: restrict to formula/local ESTIMATE sets worth
   * at least `minValue` and not attempted in the last 3 days, ordered value DESC,
   * to convert the visible head to real market values. Complements
   * prioritizeValue (which excludes formula). No overlap.
   */
  formulaHead?: boolean;
  minValue?: number;
  includeFresh?: boolean;
  includeSupplemental?: boolean;
  includeEbay?: boolean;
  /**
   * Whether to attempt eBay Marketplace Insights sold comps (restricted
   * scope). Defaults to includeEbay. Set false to harvest only the
   * basic-scope Browse "ask" signal without burning calls on an
   * unapproved sold-comps keyset or tripping the shared eBay breaker.
   */
  includeEbaySold?: boolean;
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
    // Gemini is tracked separately via fetchTracked inside callGeminiValuation;
    // the cron's OpenAI fallback was previously untracked — record it here so
    // its server-key usage shows up in the admin integration-health panel.
    openai: { ok: 0, fail: 0 },
    openrouter: { ok: 0, fail: 0 },
  };
  const tallyOk = (s: IntegrationName) => { health[s].ok++; };
  const tallyFail = (s: IntegrationName, e: unknown) => {
    health[s].fail++;
    health[s].lastError = (e as Error)?.message || String(e);
  };
  // Per-run AI usage/cost accumulator (server-key calls only); flushed once at the
  // end into the daily ai_usage ledger that powers the admin panel + spend alerts.
  const aiUsage = createAiUsageAccumulator();
  const scope = options.scope ?? 'owned';
  const sourceOptions = {
    recordHealth: false,
    retries: options.sourceRetries ?? 0,
    timeoutMs: options.sourceTimeoutMs ?? 5000,
  };
  const includeSupplemental = options.includeSupplemental === true;
  const includeEbay = options.includeEbay === true;
  // Sold comps need the restricted Marketplace Insights scope; ask-only
  // callers (the recurring cron) skip them so a non-approved keyset never
  // burns calls or trips the breaker. Defaults to includeEbay (back-compat).
  const includeEbaySold = (options.includeEbaySold ?? includeEbay) && ebaySoldCompsEnabled(env);
  const includeAiFallback = options.includeAiFallback !== false;
  const requestedLimit = Number(options.limit);
  // Default raised from the old hand-tuned 4: the invocation packer below is
  // now the real safety limit, sizing each batch to the subrequest budget.
  const requested = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 250)
    : 12;
  const packProfile: PackProfile = {
    // BrickEconomy is no longer a per-set subrequest — its values are read from
    // the be_* columns (populated by the brickeconomy-enrich Firecrawl cron), so
    // the packer treats every set as BrickLink-primary.
    brickEconomy: false,
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
  // High-value mode: restrict to real (non-formula) market values worth at
  // least minValue, and order the most valuable first so the catalog head
  // stays fresh rather than the oldest-expiry rotation used for coverage.
  const prioritizeValue = options.prioritizeValue === true;
  const formulaHead = options.formulaHead === true;
  const minValueFloor = Number.isFinite(Number(options.minValue)) && Number(options.minValue) > 0
    ? Math.floor(Number(options.minValue))
    : 0;
  const valuePredicate = prioritizeValue
    ? `AND ls.valuation_method NOT IN ('formula_bulk', 'local')
      AND COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) >= ${minValueFloor}`
    : formulaHead
    ? `AND ls.valuation_method IN ('formula_bulk', 'local')
      AND COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) >= ${minValueFloor}
      AND (ls.cached_at IS NULL OR ls.cached_at < datetime('now', '-3 days'))`
    : '';
  const valueOrder = (prioritizeValue || formulaHead)
    ? `COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) DESC,`
    : '';

  // Prioritize overdue/formula rows first, then rotate through the oldest
  // cached valuations. With scope='all' this steadily covers the whole catalog.
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT ls.set_num, ls.name, ls.theme, ls.year, ls.pieces, ls.minifigs, ls.retired,
      ls.retail_price, ls.ebay_ask_value,
      ls.be_value_new, ls.be_value_used, ls.be_forecast_2y, ls.be_forecast_5y, ls.be_retail, ls.be_growth_12m,
      (ls.ebay_ask_cached_at IS NULL OR ls.ebay_ask_cached_at < datetime('now', '-7 days')) AS ask_stale
    FROM lego_sets ls
    WHERE 1=1
      ${freshnessPredicate}
      ${valuePredicate}
      ${scopePredicate}
    ORDER BY
      CASE WHEN ls.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL)
             OR ls.set_num IN (SELECT set_num FROM user_wishlist) THEN 0 ELSE 1 END,
      CASE WHEN ${duePredicate} THEN 0 ELSE 1 END,
      ${valueOrder}
      COALESCE(ls.valuation_expires_at, ls.cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string; theme: string | null; year: number; pieces: number; minifigs: number; retired: number; retail_price: number | null; ebay_ask_value: number | null; be_value_new: number | null; be_value_used: number | null; be_forecast_2y: number | null; be_forecast_5y: number | null; be_retail: number | null; be_growth_12m: number | null; ask_stale: number }>();

  // Reserve today's external-API budget for this batch up front (2-3 D1
  // round-trips total) for accounting/visibility; these budgets are far above
  // any single run. BrickEconomy is no longer reserved here — its values come
  // from the be_* columns (Firecrawl-populated by brickeconomy-enrich), not a
  // per-set API call, so the ~$1,000/mo BrickEconomy API is off the hot path.
  await reserveQuota(env, {
    bricklink: results.length * 2,
    brickowl: (includeSupplemental && brickOwlEnabled(env)) ? results.length : 0,
    ebay: includeEbay ? results.length * (includeEbaySold ? 2 : 1) : 0,
  });

  const openai = env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        // Server-key cron: route through Cloudflare AI Gateway when configured.
        baseURL: openAIServerBaseURL(env),
        defaultHeaders: { ...gatewayHeaders(env), ...gatewayMetadataHeader({ workload: 'valuation-cron' }) },
      })
    : null;
  // OpenRouter (cheap) via the gateway's OpenRouter provider path — the paid
  // valuation fallback: a free model first, then cheap paid (the models[] chain
  // below). Valuation only (public set metadata, no user data). Falls back to
  // direct OpenAI (gpt-4o-mini) when no OpenRouter key is configured.
  const openrouter = env.OPENROUTER_API_KEY
    ? new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: openRouterBaseURL(env), defaultHeaders: { ...gatewayHeaders(env), ...gatewayMetadataHeader({ workload: 'valuation-cron' }) } })
    : null;
  // Parse a JSON valuation out of an AI completion (tolerates markdown fences);
  // returns null on empty/unparseable/missing current_value.
  const parseAiVals = (text: string | null | undefined) => {
    if (!text) return null;
    try {
      const v = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as {
        retail_price?: number; current_value?: number; forecast_2y?: number; forecast_5y?: number;
      };
      return typeof v.current_value === 'number' ? v : null;
    } catch { return null; }
  };
  const aiMessages = (s: { name: string; theme: string | null; year: number; pieces: number; minifigs: number }) => [
    { role: 'system' as const, content: 'You are a LEGO market analyst. Return JSON only: { "retail_price": number, "current_value": number, "forecast_2y": number, "forecast_5y": number, "retired": boolean }' },
    { role: 'user' as const, content: `Set: ${s.name}. Theme: ${s.theme || 'Unknown'}. Year: ${s.year}. Pieces: ${s.pieces}. Minifigs: ${s.minifigs}. Estimate market values in USD.` },
  ];
  // Cheap AI valuation. OpenRouter path: a pinned free model first, then escalate
  // to cheap paid (DeepSeek) on error/empty/unparseable — a 200-with-empty does
  // NOT trigger OpenRouter's own fallback, so we escalate app-side. Otherwise:
  // direct OpenAI (gpt-4o-mini). Tallies under the actual provider for the panel.
  const aiValuate = async (s: { set_num: string; name: string; theme: string | null; year: number; pieces: number; minifigs: number }) => {
    const ask = (client: OpenAI, model: string) => client.chat.completions.create({
      // 600 (not 200) gives the pinned reasoning free model headroom so it
      // emits complete JSON instead of truncating -> fewer paid escalations.
      model, max_tokens: 600, response_format: { type: 'json_object' }, messages: aiMessages(s),
    });
    if (openrouter) {
      // Try each pinned free model in order; fall through on error/empty/unparseable
      // so a single churned/unavailable free model never forces a paid call.
      for (const model of MODELS.openrouterFreePool) {
        try {
          const completion = await ask(openrouter, model);
          aiUsage.record('openrouter', model, completion.usage);
          const v = parseAiVals(completion.choices[0]?.message?.content);
          if (v) { tallyOk('openrouter'); return v; }
          console.warn(`[valuate] ${s.set_num}: OpenRouter free model ${model} returned no usable JSON — trying next`);
        } catch (e) {
          console.warn(`[valuate] ${s.set_num}: OpenRouter free model ${model} failed (${(e as Error).message}) — trying next`);
        }
      }
      // Every free model missed — escalate to the cheap paid backstop.
      try {
        const completion = await ask(openrouter, MODELS.openrouterPaid);
        aiUsage.record('openrouter', MODELS.openrouterPaid, completion.usage);
        const v = parseAiVals(completion.choices[0]?.message?.content);
        tallyOk('openrouter');
        return v;
      } catch (e) { tallyFail('openrouter', e); return null; }
    }
    if (openai) {
      try {
        const completion = await ask(openai, MODELS.openaiFallback);
        aiUsage.record('openai', MODELS.openaiFallback, completion.usage);
        const v = parseAiVals(completion.choices[0]?.message?.content);
        tallyOk('openai');
        return v;
      } catch (e) { tallyFail('openai', e); return null; }
    }
    return null;
  };
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
    let beRejected = false;

    // Batch runs stay source-light to avoid Cloudflare subrequest limits.
    // Detail-page refreshes still fan out across providers.
    let blPricing: { current_value: number; lot_count: number; min_price: number | null; max_price: number | null } | null = null;

    // BrickEconomy values come from the be_* staging columns populated by the
    // brickeconomy-enrich Firecrawl cron — no hot-path API call (the ~$1,000/mo
    // API is gone). Shaped like the old API response so the plausibility gate +
    // forecast logic below are unchanged.
    const beDetails = (set.be_value_new != null || set.be_value_used != null
        || set.be_forecast_2y != null || set.be_forecast_5y != null || set.be_retail != null)
      ? {
          current_value_new: set.be_value_new,
          current_value_used: set.be_value_used,
          forecast_value_new_2_years: set.be_forecast_2y,
          forecast_value_new_5_years: set.be_forecast_5y,
          retail_price_us: set.be_retail,
          rolling_growth_12months: set.be_growth_12m,
        }
      : null;
    if (beDetails) {
      tallyOk('brickeconomy');
      usedPricing = beDetails.current_value_used ? { used_value: beDetails.current_value_used } : null;

      if (beDetails.current_value_new !== null) {
        // Guard against BrickEconomy mismatches (e.g. a $10k value on a $6 vintage
        // set). A corroborating ask overrides; otherwise a retail ceiling applies.
        // (BrickLink isn't fetched yet at this point, so the eBay ask is the only
        // corroborator available here.) A scraped figure can never set
        // current_value without passing this gate.
        if (isPlausibleMarketValue(beDetails.current_value_new, { retailPrice: set.retail_price, pieces: set.pieces, corroborators: [set.ebay_ask_value] })) {
          pricing = { current_value: beDetails.current_value_new };
          valMethod = 'brickeconomy';
        } else {
          beRejected = true;
          console.warn(`[valuate] ${set.set_num}: rejected implausible BrickEconomy value $${beDetails.current_value_new} (retail $${set.retail_price ?? '?'})`);
        }
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

    if (includeEbay && includeEbaySold && !ebayBlocked) {
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
        if (includeEbay && includeEbaySold && !ebayBlocked && ebayPrices === null) {
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
    // NB: be_cached_at / be_growth_12m are owned by the brickeconomy-enrich
    // Firecrawl cron — valuate-sets only READS the be_* columns, never stamps
    // be_cached_at (doing so would make the enrich cron treat the set as freshly
    // scraped and skip it).
    // BrickOwl as 4th supplemental pricing source
    if (includeSupplemental) {
      const boPricing = await fetchBrickOwlPricing(set.set_num, env, sourceOptions)
        .catch((err) => { tallyFail('brickowl', err); return null; });
      if (boPricing) {
        tallyOk('brickowl');
        supplementStmts.push(
          env.DB.prepare(`UPDATE lego_sets SET bo_new_value=?, bo_used_value=?, bo_new_qty=?, bo_used_qty=?, bo_cached_at=datetime('now') WHERE set_num=?`)
            .bind(boPricing.new_value, boPricing.used_value, boPricing.new_qty, boPricing.used_qty, set.set_num)
        );
      }
    }
    if (supplementStmts.length) await env.DB.batch(supplementStmts);

    if (!pricing && beRejected) {
      // BrickEconomy returned an implausible value and no clean market source
      // replaced it — write the formula estimate so the bad value never persists.
      const f = formulaValuation({ pieces: set.pieces, year: set.year, theme: set.theme, retired: !!set.retired, minifigs: set.minifigs });
      pricing = { current_value: f.current_value };
      valMethod = 'formula_bulk';
    }

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
        // Real 5-year forecast straight from the BrickEconomy scrape — the old
        // API never exposed it, so this used to be a growth-formula estimate.
        if (beDetails.forecast_value_new_5_years !== null) {
          forecast_5y = beDetails.forecast_value_new_5_years;
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
        const gemVals = await callGeminiValuation(set.set_num as string, set.name, env.GEMINI_API_KEY, env, { routeThroughGateway: true });
        // Count the completed server Gemini call (free tier → $0 billable cost).
        aiUsage.record('gemini', MODELS.valuation, null);
        if (gemVals?.current_value) {
          if (isPlausibleMarketValue(gemVals.current_value, { retailPrice: set.retail_price, pieces: set.pieces, corroborators: [set.ebay_ask_value, blPricing?.current_value] })) {
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
          } else {
            console.warn(`[valuate] ${set.set_num}: rejected implausible AI (Gemini) value $${gemVals.current_value} (retail $${set.retail_price ?? '?'})`);
          }
          processed++;
          if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
          continue;
        }
      } catch (e) {
        console.warn(`[valuate] Gemini failed for ${set.set_num}:`, (e as Error).message);
      }
    }
    // Cheap AI fallback: OpenRouter free model -> escalate to cheap paid, else
    // direct OpenAI (handled inside aiValuate, which also records health).
    const vals = await aiValuate(set);
    if (!vals || typeof vals.current_value !== 'number') {
      processed++;
      if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
      continue;
    }
    // Sanity-check the AI value against its own retail estimate to reject hallucinations.
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
    // Catalog-retail plausibility: catches AI hallucinations even when the AI's
    // own retail estimate is also off (the check above only compares to that).
    if (!isPlausibleMarketValue(vals.current_value, { retailPrice: set.retail_price, pieces: set.pieces, corroborators: [set.ebay_ask_value, blPricing?.current_value] })) {
      console.warn(`[valuate] ${set.set_num}: rejected implausible AI value $${vals.current_value} vs catalog retail $${set.retail_price ?? '?'} — skipped`);
      processed++;
      if (options.onProgress) await options.onProgress({ processed, updated, total: results.length, currentSet: set.set_num });
      continue;
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

  // Persist the blended fair value (valuation v2) for every set touched this
  // run so the SQL-side portfolio sums (profile stat, daily snapshots) and the
  // collection total can COALESCE(blended_value, current_value). One read + one
  // batched write for the whole batch (see RUN_OVERHEAD_SUBREQUESTS). Fails open.
  await recomputeBlendedValues(env.DB, results.map(r => r.set_num));

  await updateRetirementRiskBatch(env);
  if (options.includeMinifigs === true) {
    await runValuateMinifigs(env).catch(err => console.error('[bg-valuate-minifigs] failed:', err));
  }

  // Persist aggregated external-API health (one row per service per run).
  for (const [service, t] of Object.entries(health)) {
    await recordIntegrationHealth(env, service as IntegrationName, t);
  }

  // Persist this run's server-key AI usage into the daily ledger, then emit an
  // anomaly log if today's spend crossed the warn/over threshold (the weekly
  // Pricing Sentinel + admin AI-usage panel surface the same status).
  await flushAiUsage(env, aiUsage.entries());
  if (aiUsage.entries().length) {
    const spend = await getAiSpendStatus(env);
    if (spend.status !== 'ok') {
      console.warn(`[ai-usage] DAILY AI SPEND ${spend.status.toUpperCase()}: $${spend.total_usd.toFixed(4)} of $${spend.budget_usd}/day (${spend.pct}%) — ${spend.paid_calls} paid call(s) today`);
    }
  }

  return { processed: results.length, updated, market, ai, scope, limit };
}

export async function runEbayBackfill(env: Env, options: { limit?: number } = {}) {
  // eBay sold comps are disabled unless EBAY_SOLD_COMPS_ENABLED is set.
  if (!ebaySoldCompsEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'ebay sold comps disabled' };
  }
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

// Browse-API ASK backfill: refresh the eBay active-listing ask price + count for
// sets whose ask is missing/stale, prioritized owned/wishlist then retired (where
// secondary-market value lives) then oldest. Basic OAuth scope only — fully
// independent of the disabled sold-comps path — so it grows the free ask signal
// that feeds the blended value. Bounded by `limit`; the eBay daily quota is wide
// open. Fails open per set and honors a Browse access denial by stopping early.
export async function runEbayAskBackfill(env: Env, options: { limit?: number } = {}) {
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 40;
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name
    FROM lego_sets ls
    WHERE ls.ebay_ask_cached_at IS NULL OR ls.ebay_ask_cached_at < datetime('now', '-14 days')
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.retired, 0) DESC,
      COALESCE(ls.ebay_ask_cached_at, '2000-01-01') ASC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string }>();
  if (!results.length) return { processed: 0, updated: 0, limit };

  // Advisory ledger entry (eBay budget is far above any ask batch).
  await reserveQuota(env, { ebay: results.length });

  let updated = 0;
  let processed = 0;
  let browseDenied = false;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  for (const set of results) {
    if (browseDenied) break;
    processed++;
    const listings = await fetchEbayActiveListings(set.set_num, set.name, env, { recordHealth: false })
      .catch((err) => { health.fail++; health.lastError = (err as Error)?.message || String(err); return null; });
    if (listings && !listings.error) {
      health.ok++;
      const stmt = buildEbayAskUpdate(env.DB, set.set_num, listings);
      if (stmt) { stmts.push(stmt); if (listings.ask_value != null) updated++; }
    } else if (listings?.error) {
      health.fail++;
      health.lastError = listings.error;
      if (isEbayAccessError(listings.error)) browseDenied = true;
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  await recordIntegrationHealth(env, 'ebay', health);
  // Refresh the persisted blend so newly-collected ask prices feed blended_value.
  await recomputeBlendedValues(env.DB, results.map(r => r.set_num));

  return { processed, updated, limit };
}

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
    SELECT m.fig_num, m.name, m.appears_in_sets,
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
  `).bind(limit).all<{ fig_num: string; name: string; appears_in_sets: number | null }>();

  // Account the BrickLink spend in the daily ledger (advisory — minifig
  // batches are far below the 4,000/day budget, but visibility matters).
  await reserveQuota(env, { bricklink: results.length });

  // Multi-source (G1b): only worth an eBay scrape (5 Firecrawl credits) for
  // figs valuable enough that a second source matters — cheap commons don't.
  const fcOn = firecrawlEnabled(env);
  const EBAY_MIN_VALUE = 10;

  let updated = 0;
  for (const fig of results) {
    const px = await fetchMinifigPricing(fig.fig_num, env, { recordHealth: false }).catch(() => null);
    if (!px || px.value == null || px.value <= 0) continue;

    let value = px.value;
    let ebayValue: number | null = null;
    let ebayQty = 0;
    // Corroborated eBay sold comps blended in (qty-weighted) for valuable figs.
    if (fcOn && px.value >= EBAY_MIN_VALUE) {
      const eb = await fetchMinifigEbaySoldViaFirecrawl(fig.fig_num, fig.name, env).catch(() => null);
      if (eb && eb.status === 'ok' && eb.value != null
          && eb.value >= px.value / 3 && eb.value <= px.value * 3) {  // corroboration gate
        ebayValue = eb.value;
        ebayQty = eb.count;
        const w1 = Math.max(1, px.lots);
        const w2 = Math.max(1, eb.count);
        value = Math.round(((px.value * w1 + eb.value * w2) / (w1 + w2)) * 100) / 100;
      }
    }

    // Rarity reflects the blended value + combined market liquidity.
    const rarity = computeMinifigRarity(value, fig.appears_in_sets, px.lots + ebayQty);
    const source = ebayValue != null ? 'bricklink+ebay' : 'bricklink';
    await env.DB.prepare(`
      UPDATE minifigs SET current_value = ?, rarity = ?, source = ?,
        ebay_value = ?, ebay_qty = ?, ebay_cached_at = CASE WHEN ? THEN datetime('now') ELSE ebay_cached_at END,
        cached_at = datetime('now')
      WHERE fig_num = ?
    `).bind(value, rarity, source, ebayValue, ebayQty, fcOn && px.value >= EBAY_MIN_VALUE ? 1 : 0, fig.fig_num).run();
    updated++;
  }
  return updated;
}

// Batch-update retirement risk scores for sets due for refresh (null or >7 days old).
async function updateRetirementRiskBatch(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.year, ls.theme, ls.pieces, ls.retired,
           ls.lego_retiring_soon, ls.lego_availability, ls.exit_date, ext.pa_in_stock
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE ls.retired = 0
      AND (ls.retirement_risk_updated_at IS NULL
           OR ls.retirement_risk_updated_at < datetime('now', '-7 days'))
    LIMIT 200
  `).all<{
    set_num: string; year: number; theme: string | null; pieces: number; retired: number;
    lego_retiring_soon: number | null; lego_availability: string | null; exit_date: string | null;
    pa_in_stock: number | null;
  }>();

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
