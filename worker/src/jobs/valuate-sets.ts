import OpenAI from 'openai';
import type { Env } from '../types';
import { fetchSetPricing } from '../lib/brickeconomy';

export async function runValuateSets(env: Env) {
  // Prioritize sets that users own or wishlist, oldest valuation first
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT ls.set_num, ls.name, ls.theme, ls.year, ls.pieces, ls.minifigs
    FROM lego_sets ls
    WHERE (ls.valuation_method = 'formula_bulk'
       OR (ls.valuation_expires_at IS NOT NULL AND ls.valuation_expires_at < datetime('now')))
      AND (
        ls.set_num IN (SELECT DISTINCT set_num FROM user_collection WHERE deleted_at IS NULL)
        OR ls.set_num IN (SELECT DISTINCT set_num FROM user_wishlist)
      )
    ORDER BY COALESCE(ls.valuation_expires_at, '2000-01-01') ASC
    LIMIT 50
  `).all<{ set_num: string; name: string; theme: string | null; year: number; pieces: number; minifigs: number }>();

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  let updated = 0, market = 0, ai = 0;

  for (const set of results) {
    // Try BrickEconomy first (real market data, 4/min budget guard inside)
    const pricing = await fetchSetPricing(set.set_num, env);
    if (pricing) {
      await env.DB.prepare(`
        UPDATE lego_sets SET
          retail_price=?, current_value=?, forecast_2y=?, forecast_5y=?,
          retired=?, valuation_method='market',
          valuation_expires_at=datetime('now', '+7 days')
        WHERE set_num=?
      `).bind(pricing.retail_price, pricing.current_value, pricing.forecast_2y, pricing.forecast_5y,
              pricing.retired ? 1 : 0, set.set_num).run();
      updated++; market++;
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
        retail_price: number; current_value: number; forecast_2y: number; forecast_5y: number; retired: boolean;
      };
      await env.DB.prepare(`
        UPDATE lego_sets SET
          retail_price=?, current_value=?, forecast_2y=?, forecast_5y=?,
          retired=?, valuation_method='ai',
          valuation_expires_at=datetime('now', '+30 days')
        WHERE set_num=?
      `).bind(vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y,
              vals.retired ? 1 : 0, set.set_num).run();
      updated++; ai++;
    } catch (e) {
      console.warn(`[valuate] failed for ${set.set_num}:`, (e as Error).message);
    }
  }

  return { processed: results.length, updated, market, ai };
}
