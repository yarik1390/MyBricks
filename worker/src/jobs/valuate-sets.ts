import OpenAI from 'openai';
import type { Env } from '../types';
import { fetchSetPricing, fetchUsedPricing, fetchMinifigPricing } from '../lib/bricklink';
import { fetchEbayPrice } from '../lib/ebay';
import { fetchBrickEconomyDetails } from '../lib/brickeconomy';
import { computeRetirementRisk } from '../lib/retirement-risk';
import { recordIntegrationHealth, type IntegrationName } from '../lib/integration-health';

export async function runValuateSets(env: Env) {
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
  // Prioritize sets that users own or wishlist, oldest valuation first
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT ls.set_num, ls.name, ls.theme, ls.year, ls.pieces, ls.minifigs, ls.retired
    FROM lego_sets ls
    WHERE (ls.valuation_method = 'formula_bulk'
       OR (ls.valuation_expires_at IS NOT NULL AND ls.valuation_expires_at < datetime('now')))
      AND (
        ls.set_num IN (SELECT DISTINCT set_num FROM user_collection WHERE deleted_at IS NULL)
        OR ls.set_num IN (SELECT DISTINCT set_num FROM user_wishlist)
      )
    ORDER BY COALESCE(ls.valuation_expires_at, '2000-01-01') ASC
    LIMIT 50
  `).all<{ set_num: string; name: string; theme: string | null; year: number; pieces: number; minifigs: number; retired: number }>();

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  let updated = 0, market = 0, ai = 0;

  for (const set of results) {
    let pricing: { current_value: number } | null = null;
    let usedPricing: { used_value: number } | null = null;
    let ebayPrice: number | null = null;
    let valMethod = 'market';
    let beDetails: any = null;

    if (env.BRICKECONOMY_API_KEY) {
      beDetails = await fetchBrickEconomyDetails(set.set_num, env).catch((e) => { tallyFail('brickeconomy', e); return null; });
      if (beDetails) tallyOk('brickeconomy');
      if (beDetails && beDetails.current_value_new !== null) {
        pricing = { current_value: beDetails.current_value_new };
        usedPricing = { used_value: beDetails.current_value_used };
        valMethod = 'brickeconomy';
        ebayPrice = await fetchEbayPrice(set.set_num, set.name, env).catch((e) => { tallyFail('ebay', e); return null; });
        if (ebayPrice != null) tallyOk('ebay');
      }
    }

    if (!pricing) {
      const [p, u, e] = await Promise.all([
        fetchSetPricing(set.set_num, env).catch((err) => { tallyFail('bricklink', err); return null; }),
        fetchUsedPricing(set.set_num, env).catch((err) => { tallyFail('bricklink', err); return null; }),
        fetchEbayPrice(set.set_num, set.name, env).catch((err) => { tallyFail('ebay', err); return null; }),
      ]);
      if (p != null || u != null) tallyOk('bricklink');
      if (e != null) tallyOk('ebay');
      pricing = p;
      usedPricing = u;
      ebayPrice = e;
      valMethod = 'market';
    }

    // Write used + eBay prices when available (independent of main valuation path)
    const supplementStmts: D1PreparedStatement[] = [];
    if (usedPricing) {
      supplementStmts.push(
        env.DB.prepare('UPDATE lego_sets SET used_value=? WHERE set_num=?')
          .bind(usedPricing.used_value, set.set_num)
      );
    }
    if (ebayPrice) {
      supplementStmts.push(
        env.DB.prepare("UPDATE lego_sets SET ebay_value=?, ebay_cached_at=datetime('now') WHERE set_num=?")
          .bind(ebayPrice, set.set_num)
      );
    }
    if (supplementStmts.length) await env.DB.batch(supplementStmts);

    if (pricing) {
      const yr = set.retired ? 0.15 : 0.10;
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
          valuation_expires_at=datetime('now', '+1 day'),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(pricing.current_value, forecast_2y, forecast_5y, retailPrice, valMethod, set.set_num).run();
      updated++;
      if (valMethod === 'market') {
        market++;
      }
      continue;
    }

    if (ebayPrice !== null && ebayPrice !== undefined) {
      const yr = set.retired ? 0.15 : 0.10;
      const forecast_2y = Math.round(ebayPrice * Math.pow(1 + yr, 2) * 100) / 100;
      const forecast_5y = Math.round(ebayPrice * Math.pow(1 + yr, 5) * 100) / 100;
      await env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          valuation_method='ebay_rss',
          valuation_expires_at=datetime('now', '+1 day'),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(ebayPrice, forecast_2y, forecast_5y, set.set_num).run();
      updated++;
      continue;
    }

    // Fall back to GPT-4o-mini
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
      if (!text || result.choices[0].finish_reason === 'length') continue;
      const vals = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as {
        retail_price: number; current_value: number; forecast_2y: number; forecast_5y: number;
      };
      // Sanity-check the AI value against retail price to reject hallucinations.
      if (vals.retail_price && vals.current_value) {
        const pieceCount = Number(set.pieces ?? 0);
        const maxCapMultiplier = pieceCount > 500 ? 8 : 15;
        if (vals.current_value < 0.3 * vals.retail_price || vals.current_value > maxCapMultiplier * vals.retail_price) {
          console.warn(`[valuate] ${set.set_num}: AI value $${vals.current_value} out of sanity range vs retail $${vals.retail_price} (limit ${maxCapMultiplier}x, pieces: ${pieceCount}) — skipped`);
          continue;
        }
      }
      await env.DB.prepare(`
        UPDATE lego_sets SET
          retail_price=?, current_value=?, forecast_2y=?, forecast_5y=?,
          valuation_method='ai',
          valuation_expires_at=datetime('now', '+1 day'),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y,
              set.set_num).run();
      updated++; ai++;
    } catch (e) {
      console.warn(`[valuate] failed for ${set.set_num}:`, (e as Error).message);
    }
  }

  await updateRetirementRiskBatch(env);
  await runValuateMinifigs(env).catch(err => console.error('[bg-valuate-minifigs] failed:', err));

  // Persist aggregated external-API health (one row per service per run).
  for (const [service, t] of Object.entries(health)) {
    await recordIntegrationHealth(env, service as IntegrationName, t);
  }

  return { processed: results.length, updated, market, ai };
}

export async function runValuateMinifigs(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT m.fig_num
    FROM minifigs m
    JOIN user_minifigs um ON um.fig_num = m.fig_num
    ORDER BY COALESCE(m.added_at, '2000-01-01') ASC
    LIMIT 20
  `).all<{ fig_num: string }>();

  let updated = 0;
  for (const fig of results) {
    const price = await fetchMinifigPricing(fig.fig_num, env).catch(() => null);
    if (price !== null && price > 0) {
      await env.DB.prepare(`
        UPDATE minifigs SET current_value = ?, added_at = datetime('now') WHERE fig_num = ?
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
