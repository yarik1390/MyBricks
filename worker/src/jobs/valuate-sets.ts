import OpenAI from 'openai';
import type { Env } from '../types';

export async function runValuateSets(env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT set_num, name, theme, year, pieces, minifigs
    FROM lego_sets
    WHERE valuation_method = 'formula_bulk'
       OR (valuation_expires_at IS NOT NULL AND valuation_expires_at < datetime('now'))
    ORDER BY COALESCE(valuation_expires_at, '2000-01-01') ASC
    LIMIT 50
  `).all<{ set_num: string; name: string; theme: string | null; year: number; pieces: number; minifigs: number }>();

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  let updated = 0;

  for (const set of results) {
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
      updated++;
    } catch (_) { /* skip failed sets */ }
  }

  return { processed: results.length, updated };
}
