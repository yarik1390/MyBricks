import type { Env } from '../types';
import { fetchSetPricing, fetchSetPricingDetailed, fetchSetStockAsk, fetchUsedPricing } from '../lib/bricklink';
import type { BrickLinkStockAsk, BrickLinkThinSold } from '../lib/bricklink';
import { buildEbayAskUpdate, fetchEbayActiveListings, isEbayAccessError } from '../lib/ebay';
import { recomputeBlendedValues } from '../lib/market-sources';
import { beDetailsFromRow } from '../lib/brickeconomy-stored';
import { valuationExpiryModifier, isPlausibleMarketValue, independentRetailAnchor, formulaValuation, plausibleAskValue } from '../lib/valuation';
import { computeRetirementRisk } from '../lib/retirement-risk';
import { runValuateMinifigs } from './valuate-minifigs';
import { sourceEnabled } from '../lib/source-config';
import { discoveryWantsUsed, selectDueSets, blBackedOffAt, type ValuationQuotaGrants } from './valuate-select';
import { recordIntegrationHealth, type IntegrationName } from '../lib/integration-health';

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
  /**
   * BrickLink-staleness refresh mode: re-query sets that ALREADY have a BrickLink
   * value which has aged past the blend's 14-day freshness window, ordered so those
   * that also carry an eBay sold comp go first (one refresh from a two-fresh-family
   * high-confidence blend). These sets are NOT "due" by the normal rule, so without
   * this mode they never re-enter the queue and the blend's confidence ceiling is
   * pinned by BrickLink age rather than by data availability.
   */
  blStale?: boolean;
  /**
   * Tie-break mode: fetch a BrickLink guide for sets whose v3 valuation has an
   * unresolved source_conflict and no recent BrickLink attempt, most valuable
   * first, so a third independent source can outvote the outlier.
   */
  conflictTiebreak?: boolean;
  /**
   * BrickEconomy-replacement discovery: fetch a first BrickLink guide for sets
   * whose only market value is a stored BrickEconomy figure and that BrickLink
   * has never been asked about, most valuable first.
   */
  blDiscovery?: boolean;
  minValue?: number;
  includeFresh?: boolean;
  includeSupplemental?: boolean;
  includeEbay?: boolean;
  includeMinifigs?: boolean;
  sourceRetries?: number;
  sourceTimeoutMs?: number;
  /**
   * Subrequest budget for this invocation. Free-plan Workers allow 50 and
   * every fetch/D1/KV call counts, so the batch size is packed to fit (see
   * lib/api-quota.ts). Callers sharing an invocation with other phases (e.g.
   * admin populate slices) should pass what remains of their budget.
   */
  subrequestBudget?: number;
  /**
   * Wall-clock ceiling for the whole run, in ms. The loop stops cleanly at the
   * top of the next set once this is spent.
   *
   * Exists because a single set could stall the entire nightly populate: the
   * admin populate slice reports `Refreshing <set_num>` from onProgress, so a
   * set whose sources hang produces NO further progress writes, the run's
   * heartbeat goes stale after 10 minutes, and the slice is expired. `BIGBOX-1`
   * ("The Ultimate Battle for Chima", a junk catalog row listing 10,001 pieces
   * at $44.99 retail) did exactly that on two consecutive nights. A per-source
   * timeout is not enough — it bounds one fetch, not the set's whole fan-out.
   */
  budgetMs?: number;
  onProgress?: (progress: { processed: number; updated: number; total: number; currentSet?: string }) => Promise<void>;
}

export async function runValuateSets(env: Env, options: ValuateSetsOptions = {}) {
  // Aggregate external-API health across the whole run, then persist once per service.
  const health: Record<string, { ok: number; fail: number; lastError?: string }> = {
    ebay: { ok: 0, fail: 0 },
    bricklink: { ok: 0, fail: 0 },
    brickeconomy: { ok: 0, fail: 0 },
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
  const bricklinkEnabled = await sourceEnabled(env, 'bricklink');
  const brickeconomyEnabled = await sourceEnabled(env, 'brickeconomy');
  const includeSupplemental = options.includeSupplemental === true;
  const forceBrickLink = options.blStale === true || options.conflictTiebreak === true
    || options.blDiscovery === true;
  const bricklinkConfigured = bricklinkEnabled && !!env.BRICKLINK_CONSUMER_KEY;
  const includeEbay = options.includeEbay === true && await sourceEnabled(env, 'ebay')
    && !!env.EBAY_APP_ID && !!env.EBAY_CLIENT_SECRET;
  const { results, limit, grants } = await selectDueSets(env, {
    scope, options, includeSupplemental,
    includeBrickLink: bricklinkConfigured,
    includeEbay,
  });
  const quotaRemaining: ValuationQuotaGrants = { ...grants };
  const takeQuota = (service: keyof ValuationQuotaGrants, units = 1): boolean => {
    if (units <= 0 || quotaRemaining[service] < units) return false;
    quotaRemaining[service] -= units;
    return true;
  };

  let updated = 0, market = 0;
  // Browse API (basic scope) access is tracked run-locally.
  let browseDenied = false;

  let processed = 0;
  // See ValuateSetsOptions.budgetMs — one hanging set must not be able to stall
  // the whole run past its caller's heartbeat.
  const deadline = options.budgetMs && options.budgetMs > 0 ? Date.now() + options.budgetMs : 0;
  let budgetExhausted = false;
  for (const set of results) {
    if (deadline && Date.now() > deadline) {
      budgetExhausted = true;
      console.warn(`[valuate-sets] wall-clock budget spent after ${processed}/${results.length} sets — stopping cleanly`);
      break;
    }
    const processedBefore = processed;
    try {
    let pricing: { current_value: number } | null = null;
    let usedPricing: { used_value: number; lot_count?: number; min_price?: number | null; max_price?: number | null } | null = null;
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
    let blNewAttempted = false;
    let blUsedAttempted = false;
    // Set when the BrickLink NEW-sold fetch THROWS (a transient/credential
    // outage, not genuine no-data). Gates the bl_nodata_at stamp below so a
    // source blip never triggers a 90-day skip on a set that may have data.
    let blErrored = false;
    // Discovery-only fallbacks for sets whose sold guide is too thin (<5 lots).
    let blThin: BrickLinkThinSold | null = null;
    let blAsk: BrickLinkStockAsk | null = null;
    let blAskErrored = false;
    const loadBrickLinkNew = async (): Promise<typeof blPricing> => {
      if (blNewAttempted || !takeQuota('bricklink')) return blPricing;
      blNewAttempted = true;
      blAttempted = true;
      if (options.blDiscovery === true) {
        // Discovery keeps a 1–4 lot guide as a thin signal instead of dropping it.
        const detailed = await fetchSetPricingDetailed(set.set_num, env, sourceOptions)
          .catch((err) => { tallyFail('bricklink', err); blErrored = true; return null; });
        blPricing = detailed?.pricing ?? null;
        blThin = detailed?.thin ?? null;
      } else {
        blPricing = await fetchSetPricing(set.set_num, env, sourceOptions)
          .catch((err) => { tallyFail('bricklink', err); blErrored = true; return null; });
      }
      if (blPricing) tallyOk('bricklink');
      return blPricing;
    };
    const loadBrickLinkUsed = async (): Promise<typeof usedPricing> => {
      if (blUsedAttempted || !takeQuota('bricklink')) return usedPricing;
      blUsedAttempted = true;
      usedPricing = await fetchUsedPricing(set.set_num, env, sourceOptions)
        .catch((err) => { tallyFail('bricklink', err); return null; });
      if (usedPricing) tallyOk('bricklink');
      return usedPricing;
    };

    // Stored BrickEconomy values (be_* columns) — read only, never fetched.
    // beDetailsFromRow strips a fabricated retail echo (retail==value) so a
    // stored value can never anchor itself.
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
        if (isPlausibleMarketValue(beDetails.current_value_new, { retailPrice: independentRetailAnchor(set), pieces: set.pieces, corroborators: [plausibleAskValue(set as unknown as Record<string, unknown>)] })) {
          pricing = { current_value: beDetails.current_value_new };
          valMethod = 'brickeconomy';
        } else {
          beRejected = true;
          console.warn(`[valuate] ${set.set_num}: rejected implausible BrickEconomy value $${beDetails.current_value_new} (retail $${set.retail_price ?? '?'})`);
        }
      }
    }

    // The BrickLink lanes exist to fetch a BrickLink guide, so they must call
    // BrickLink even when a plausible BrickEconomy value already answered the
    // headline; selectDueSets reserved BrickLink quota for every row they pick.
    if ((includeSupplemental || forceBrickLink) && bricklinkConfigured && !blBackedOff) {
      blPricing = await loadBrickLinkNew();
      if (options.blDiscovery === true) {
        // With no reliable NEW sales, discovery also takes current NEW listings
        // as an asking price. The BrickLink USED guide is fetched for sets 4+
        // years old even when a BrickEconomy used figure exists: it is the
        // strongest input the value model has for older sets.
        if (blPricing) {
          if (!usedPricing && wantUsed) usedPricing = await loadBrickLinkUsed();
        } else if (blNewAttempted && !blErrored) {
          if (takeQuota('bricklink')) {
            blAsk = await fetchSetStockAsk(set.set_num, env, sourceOptions)
              .catch((err) => { tallyFail('bricklink', err); blAskErrored = true; return null; });
            if (blAsk) tallyOk('bricklink');
          }
          if (discoveryWantsUsed(set)) {
            const blUsed = await loadBrickLinkUsed();
            if (blUsed) usedPricing = blUsed;
          }
        }
      } else if (!usedPricing && wantUsed) usedPricing = await loadBrickLinkUsed();
    }

    if (!pricing) {
      // No usable stored BrickEconomy value — use BrickLink as primary
      // (still honoring the no-data backoff + retired-only used-guide savers).
      if (bricklinkConfigured && !blBackedOff) {
        if (!blPricing) blPricing = await loadBrickLinkNew();
        if (!usedPricing && wantUsed) usedPricing = await loadBrickLinkUsed();
      }
      pricing = blPricing;
      valMethod = 'market';
    }

    // Write used + eBay ask + BrickLink new prices (independent of main valuation path)
    const supplementStmts: D1PreparedStatement[] = [];
    if (usedPricing) {
      supplementStmts.push(
        env.DB.prepare('UPDATE lego_sets SET used_value=? WHERE set_num=?')
          .bind(usedPricing.used_value, set.set_num)
      );
    }
    // Supply signal: weekly refresh of active-listing ask price + count for
    // prioritized (owned/wishlisted) sets only. The Browse API needs only the
    // basic OAuth scope.
    if (includeEbay && !browseDenied && set.ask_stale && takeQuota('ebay')) {
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
    } else if (blAttempted && !blErrored && !blAskErrored) {
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
    // Thin sold guide and current listings (discovery). Written whenever the
    // set answered cleanly, so a set that lost its listings drops the old ask.
    if (options.blDiscovery === true && blNewAttempted && !blErrored && !blPricing && !blAskErrored) {
      // Assigned inside loadBrickLinkNew, which TS's narrowing cannot see.
      const thin = blThin as BrickLinkThinSold | null;
      supplementStmts.push(
        env.DB.prepare(
          `INSERT INTO set_market_ext (set_num, bl_thin_value, bl_thin_qty, bl_ask_value, bl_ask_qty, bl_fallback_cached_at)
           VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
           ON CONFLICT(set_num) DO UPDATE SET bl_thin_value=excluded.bl_thin_value, bl_thin_qty=excluded.bl_thin_qty,
             bl_ask_value=excluded.bl_ask_value, bl_ask_qty=excluded.bl_ask_qty, bl_fallback_cached_at=excluded.bl_fallback_cached_at`
        ).bind(set.set_num, thin?.value ?? null, thin?.lot_count ?? null, blAsk?.ask_value ?? null, blAsk?.lot_count ?? null)
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
    // NB: valuate-sets only READS the be_* columns and never stamps be_cached_at.
    if (supplementStmts.length) await env.DB.batch(supplementStmts);

    if (!pricing && beRejected) {
      // BrickEconomy returned an implausible value and no clean market source
      // replaced it — write the formula estimate so the bad value never persists.
      const f = formulaValuation({
        pieces: set.pieces, year: set.year, theme: set.theme, retired: !!set.retired, minifigs: set.minifigs,
        // Real RRP drives the empirical age curve; far better than the synthesised
        // piece-count MSRP, and available for ~99.99% of formula-priced sets.
        retailPrice: set.retail_price || set.brickset_msrp || null,
      });
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
        if (beDetails.forecast_value_new_5_years !== null) {
          forecast_5y = beDetails.forecast_value_new_5_years;
        }
        if (beDetails.retail_price_us !== null) {
          retailPrice = beDetails.retail_price_us;
        }
      }

      // Backfill-only: a stored BE retail may fill a missing RRP but must never
      // OVERWRITE an existing one — BE-sourced retail overwriting real retail is
      // what poisoned the plausibility anchor for rare/promo sets.
      await env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          retail_price=CASE WHEN LOWER(COALESCE(subtheme, '')) = 'magazine gift' THEN retail_price ELSE COALESCE(retail_price, ?) END,
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

    // No market value: retry tomorrow, keeping the current value.
    await env.DB.prepare(`
      UPDATE lego_sets SET
        valuation_expires_at=datetime('now', '+1 day'),
        cached_at=datetime('now')
      WHERE set_num=?
    `).bind(set.set_num).run();
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

  // When the budget cut the run short, report what was ACTUALLY processed —
  // results.length would claim the skipped tail was done. Unchanged when no
  // budget is set, so existing callers/tests see the same numbers as before.
  return {
    processed: budgetExhausted ? processed : results.length,
    updated, market, scope, limit,
    ...(budgetExhausted ? { budget_exhausted: true } : {}),
  };
}

// runEbayAskBackfill / runValuateMinifigs live in their own modules now;
// re-exported here so existing importers (index.ts, admin.ts, tests) keep
// importing them from ./valuate-sets unchanged.
export { runEbayAskBackfill } from './ebay-backfill';
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

  // Process in modest batches to leave headroom in the invocation query budget.
  for (let i = 0; i < stmts.length; i += 100) {
    await env.DB.batch(stmts.slice(i, i + 100));
  }
}
