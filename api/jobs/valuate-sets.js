import { db, ai } from 'hatchable';

export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  // Pick up to 50 sets needing AI valuation
  const r = await db.query(`
    SELECT set_num, name, theme, year, pieces, minifigs
    FROM lego_sets
    WHERE valuation_method = 'formula_bulk'
       OR (valuation_expires_at IS NOT NULL AND valuation_expires_at < now())
    ORDER BY COALESCE(valuation_expires_at, '2000-01-01') ASC
    LIMIT 50
  `);

  let updated = 0;
  for (const set of r.rows) {
    try {
      const result = await ai.generateText({
        purpose: 'valuate-set',
        model: 'gpt-mini',
        messages: [
          { role: 'system', content: 'You are a LEGO market analyst. Return JSON only: { "retail_price": number, "current_value": number, "forecast_2y": number, "forecast_5y": number, "retired": boolean }' },
          { role: 'user', content: `Set: ${set.name}. Theme: ${set.theme || 'Unknown'}. Year: ${set.year}. Pieces: ${set.pieces}. Minifigs: ${set.minifigs}. Estimate market values in USD.` },
        ],
        maxTokens: 200,
      });

      if (result.finishReason === 'length') continue;
      const vals = JSON.parse(result.text.replace(/```json?\n?|```/g, '').trim());

      await db.query(`
        UPDATE lego_sets SET
          retail_price=$1, current_value=$2, forecast_2y=$3, forecast_5y=$4,
          retired=$5, valuation_method='ai',
          valuation_expires_at=now() + interval '30 days'
        WHERE set_num=$6
      `, [vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y, vals.retired || false, set.set_num]);
      updated++;
    } catch (_) { /* skip failed sets */ }
  }

  return res.json({ processed: r.rows.length, updated });
}