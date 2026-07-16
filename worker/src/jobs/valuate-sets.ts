import OpenAI from 'openai';
import type { Env } from '../types';
import { fetchSetPricing, fetchUsedPricing } from '../lib/bricklink';
import { fetchBrickOwlPricing } from '../lib/brickowl-pricing';
import { ebaySoldCompsEnabled } from '../lib/pricing-flags';
import { callGeminiValuation } from '../lib/gemini';
import { MODELS, getOpenRouterPools, openAIServerBaseURL, gatewayHeaders, gatewayMetadataHeader, openRouterBaseURL } from '../lib/llm';
import {
  buildEbayAskUpdate,
  buildEbaySoldUpdate,
  ebaySoldNewValue,
  fetchEbayActiveListings,
  fetchEbaySoldPrices,
  isEbayAccessError,
  type EbaySoldPrices,
} from '../lib/ebay';
import { recomputeBlendedValues } from '../lib/market-sources';
import { beDetailsFromRow } from '../lib/brickeconomy-firecrawl';
import { valuationExpiryModifier, isPlausibleMarketValue, independentRetailAnchor, formulaValuation } from '../lib/valuation';
import { computeRetirementRisk } from '../lib/retirement-risk';
import { runValuateMinifigs } from './valuate-minifigs';
import { sourceEnabled } from '../lib/source-config';
import { selectDueSets, blBackedOffAt } from './valuate-select';
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
  const bricklinkEnabled = await sourceEnabled(env, 'bricklink');
  const brickeconomyEnabled = await sourceEnabled(env, 'brickeconomy');
  const brickowlEnabled = await sourceEnabled(env, 'brickowl');
  const includeSupplemental = options.includeSupplemental === true;
  const includeEbay = options.includeEbay === true && await sourceEnabled(env, 'ebay');
  // Sold comps need the restricted Marketplace Insights scope; ask-only
  // callers (the recurring cron) skip them so a non-approved keyset never
  // burns calls or trips the breaker. Defaults to includeEbay (back-compat).
  const includeEbaySold = (options.includeEbaySold ?? includeEbay) && ebaySoldCompsEnabled(env);
  const includeAiFallback = options.includeAiFallback !== false;
  const { results, limit } = await selectDueSets(env, {
    scope, options, includeSupplemental, includeEbay, includeEbaySold, includeAiFallback,
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
      // Try each free model in order (live-validated pool from the daily
      // model-refresh cron, curated constants as fallback); fall through on
      // error/empty/unparseable so a single churned/unavailable free model
      // never forces a paid call.
      const { text: freePool } = await getOpenRouterPools(env);
      for (const model of freePool) {
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

    // BrickLink budget savers (5,000/day API limit):
    //  • no-data backoff — a set whose sold guide has no reliable price (<5 lots)
    //    is stamped bl_nodata_at and its BrickLink calls are skipped for 90 days,
    //    so we stop re-querying sets that will never have data every cycle.
    //  • conditional used — only retired sets fetch the USED guide (used market is
    //    negligible for modern sealed sets); this ~halves calls-per-set.
    const blBackedOff = blBackedOffAt(set.bl_nodata_at);
    const wantUsed = !!set.retired;
    let blAttempted = false;
    // Set when the BrickLink NEW-sold fetch THROWS (a transient/credential
    // outage, not genuine no-data). Gates the bl_nodata_at stamp below so a
    // source blip never triggers a 90-day skip on a set that may have data.
    let blErrored = false;

    // BrickEconomy values come from the be_* staging columns populated by the
    // brickeconomy-enrich Firecrawl cron — no hot-path API call (the ~$1,000/mo
    // API is gone). beDetailsFromRow also strips a fabricated retail echo
    // (retail==value) so a scraped value can never anchor itself.
    const beDetails = brickeconomyEnabled ? beDetailsFromRow(set as unknown as Record<string, unknown>) : null;
    if (beDetails) {
      tallyOk('brickeconomy');
      usedPricing = beDetails.current_value_used ? { used_value: beDetails.current_value_used } : null;

      if (beDetails.current_value_new !== null) {
        // Guard against BrickEconomy mismatches (e.g. a $10k value on a $6 vintage
        // set). A corroborating ask overrides; otherwise a retail ceiling applies.
        // The anchor must be INDEPENDENT of BrickEconomy: brickset_msrp, or a
        // retail_price that did NOT come from the same scrape — garbage
        // validating garbage is how $15,000 kits reached the catalog.
        if (isPlausibleMarketValue(beDetails.current_value_new, { retailPrice: independentRetailAnchor(set), pieces: set.pieces, corroborators: [set.ebay_ask_value] })) {
          pricing = { current_value: beDetails.current_value_new };
          valMethod = 'brickeconomy';
        } else {
          beRejected = true;
          console.warn(`[valuate] ${set.set_num}: rejected implausible BrickEconomy value $${beDetails.current_value_new} (retail $${set.retail_price ?? '?'})`);
        }
      }
    }

    if (includeSupplemental && bricklinkEnabled && !blBackedOff) {
      blAttempted = true;
      blPricing = await fetchSetPricing(set.set_num, env, sourceOptions)
        .catch((err) => { tallyFail('bricklink', err); blErrored = true; return null; });
      if (blPricing) tallyOk('bricklink');
      if (!usedPricing && wantUsed) {
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
      // (still honoring the no-data backoff + retired-only used-guide savers).
      if (bricklinkEnabled && !blBackedOff) {
        if (!blPricing) {
          blAttempted = true;
          blPricing = await fetchSetPricing(set.set_num, env, sourceOptions)
            .catch((err) => { tallyFail('bricklink', err); blErrored = true; return null; });
          if (blPricing) tallyOk('bricklink');
        }
        if (!usedPricing && wantUsed) {
          usedPricing = await fetchUsedPricing(set.set_num, env, sourceOptions)
            .catch((err) => { tallyFail('bricklink', err); return null; });
          if (usedPricing) tallyOk('bricklink');
        }
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
      // Data came back — clear a stale no-data backoff stamp (only if one existed,
      // so successful sets that were never backed off skip this extra write).
      if (set.bl_nodata_at) {
        supplementStmts.push(
          env.DB.prepare('UPDATE set_market_ext SET bl_nodata_at=NULL WHERE set_num=?').bind(set.set_num)
        );
      }
    } else if (blAttempted && !blErrored) {
      // Called BrickLink AND it answered cleanly, but the sold guide had no
      // reliable price (404 / <5 lots / no usable avg). Stamp so the 90-day
      // backoff skips this set on future cycles and the API budget goes to sets
      // that actually have data. UPSERT — the set may not have a set_market_ext
      // row yet. NB: gated on !blErrored so a transient outage (which THROWS out
      // of fetchSetPricing) never masquerades as no-data and freezes a set for
      // 90 days — it'll simply be retried on the next run.
      supplementStmts.push(
        env.DB.prepare(
          `INSERT INTO set_market_ext (set_num, bl_nodata_at) VALUES (?1, datetime('now'))
           ON CONFLICT(set_num) DO UPDATE SET bl_nodata_at=datetime('now')`
        ).bind(set.set_num)
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
    if (includeSupplemental && brickowlEnabled) {
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

      // Backfill-only: a scraped BE retail may fill a missing RRP but must never
      // OVERWRITE an existing one — BE-sourced retail overwriting real retail is
      // what poisoned the plausibility anchor for rare/promo sets.
      await env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          retail_price=COALESCE(retail_price, ?),
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
          if (isPlausibleMarketValue(gemVals.current_value, { retailPrice: independentRetailAnchor(set), pieces: set.pieces, corroborators: [set.ebay_ask_value, blPricing?.current_value] })) {
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
    if (!isPlausibleMarketValue(vals.current_value, { retailPrice: independentRetailAnchor(set), pieces: set.pieces, corroborators: [set.ebay_ask_value, blPricing?.current_value] })) {
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

// runEbayBackfill / runEbayAskBackfill / runValuateMinifigs live in their own
// modules now; re-exported here so existing importers (index.ts, admin.ts, tests)
// keep importing them from ./valuate-sets unchanged.
export { runEbayBackfill, runEbayAskBackfill } from './ebay-backfill';
export { runValuateMinifigs };

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
