import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { holdingValueForRollout } from '../lib/market-sources';

// Lot checker (mounted at /api/lot): is a bundle of sets (a garage-sale box, a
// marketplace listing) worth its asking price?
//
// POST /api/lot/parse  { text }                    set numbers named in a
//                                                  pasted listing, matched to
//                                                  the catalog
// POST /api/lot/value  { items, asking_usd? }      what each item and the lot is
//                                                  worth, and a verdict. Free
//                                                  members can check up to
//                                                  FREE_LOT_ITEMS items; Pro has
//                                                  no limit.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const FREE_LOT_ITEMS = 3;
export const MAX_LOT_ITEMS = 60;
/** What a seller keeps after marketplace fees and shipping, roughly. */
export const RESALE_KEEP = 0.87;
/** An incomplete set is usually sold for parts: about this share of a complete used one. */
export const INCOMPLETE_SHARE = 0.6;

export type LotCondition = 'sealed' | 'used' | 'incomplete';

/** Candidate set numbers in free text: "75313", "10497-1", "set #6086". Years are skipped unless suffixed. */
export function setNumberCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || '').slice(0, 20_000).matchAll(/(?:^|[^\d$€£.,])(\d{3,7})(?:-(\d{1,2}))?(?![\d.,]*\s*(?:pcs|pieces|teile|€|\$|usd|eur|%))/gi)) {
    const num = m[1];
    const variant = m[2];
    const n = Number(num);
    if (!variant && n >= 1949 && n <= 2035) continue; // a year, most likely
    out.add(variant ? `${num}-${variant}` : `${num}-1`);
  }
  return [...out].slice(0, MAX_LOT_ITEMS);
}

export function lotVerdict(resaleKeep: number, asking: number | null): { verdict: 'great' | 'good' | 'fair' | 'overpriced' | null; margin: number | null } {
  if (asking == null || !(asking > 0) || !(resaleKeep > 0)) return { verdict: null, margin: null };
  const margin = Math.round((resaleKeep - asking) * 100) / 100;
  const ratio = asking / resaleKeep;
  return { verdict: ratio <= 0.6 ? 'great' : ratio <= 0.85 ? 'good' : ratio <= 1.05 ? 'fair' : 'overpriced', margin };
}

const SET_COLS = `s.set_num, s.name, s.year, s.image_url, s.current_value, s.blended_value, s.used_value,
  s.ebay_used_value, s.pc_new_value, s.pc_complete_value, s.part_out_value,
  svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair`;
const SET_JOINS = `LEFT JOIN set_valuation_state svn ON svn.set_num = s.set_num AND svn.condition = 'new_sealed'
  LEFT JOIN set_valuation_state svu ON svu.set_num = s.set_num AND svu.condition = 'used_complete'`;

app.post('/parse', async (c) => {
  const { text } = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
  const candidates = setNumberCandidates(text || '');
  if (!candidates.length) return c.json({ sets: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT set_num, name, year, image_url FROM lego_sets WHERE set_num IN (${candidates.map(() => '?').join(',')})`,
  ).bind(...candidates).all<{ set_num: string; name: string; year: number; image_url: string | null }>();
  const order = new Map(candidates.map((n, i) => [n, i]));
  return c.json({ sets: (results || []).sort((a, b) => (order.get(a.set_num) ?? 0) - (order.get(b.set_num) ?? 0)) });
});

app.post('/value', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ items?: Array<{ set_num?: string; condition?: string; qty?: number }>; asking_usd?: number }>()
    .catch(() => ({} as { items?: never[]; asking_usd?: number }));
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((i) => typeof i?.set_num === 'string' && i.set_num.length <= 20)
    .map((i) => ({
      set_num: String(i.set_num),
      condition: (['sealed', 'used', 'incomplete'].includes(String(i.condition)) ? i.condition : 'sealed') as LotCondition,
      qty: Math.min(99, Math.max(1, Math.floor(Number(i.qty) || 1))),
    }));
  if (!items.length) return c.json({ error: 'Add at least one set' }, 400);
  if (items.length > MAX_LOT_ITEMS) return c.json({ error: `Up to ${MAX_LOT_ITEMS} items per lot` }, 400);
  if (items.length > FREE_LOT_ITEMS) {
    const pref = await c.env.DB.prepare('SELECT is_supporter FROM user_prefs WHERE user_id = ?')
      .bind(userId).first<{ is_supporter: number }>().catch(() => null);
    if (!pref?.is_supporter) return c.json({ error: `Lots over ${FREE_LOT_ITEMS} sets come with Pro.`, code: 'pro_required' }, 402);
  }

  const nums = [...new Set(items.map((i) => i.set_num))];
  const { results } = await c.env.DB.prepare(`SELECT ${SET_COLS} FROM lego_sets s ${SET_JOINS} WHERE s.set_num IN (${nums.map(() => '?').join(',')})`)
    .bind(...nums).all<Record<string, unknown>>();
  const bySet = new Map((results || []).map((r) => [String(r.set_num), r]));

  let total = 0;
  let unpriced = 0;
  const rows = items.map((i) => {
    const s = bySet.get(i.set_num);
    if (!s) { unpriced++; return { ...i, name: null, image_url: null, unit_value: null, value: null }; }
    const sealed = holdingValueForRollout({ ...s, condition: 'sealed' });
    // A used price falls back to the sealed one only when no used signal exists at all.
    const used = Number(s.v3_used_fair) || Number(s.ebay_used_value) || Number(s.used_value) || sealed;
    const unit = i.condition === 'sealed' ? sealed : i.condition === 'used' ? used : used * INCOMPLETE_SHARE;
    const unitValue = unit > 0 ? Math.round(unit * 100) / 100 : null;
    if (unitValue == null) unpriced++;
    else total += unitValue * i.qty;
    return { ...i, name: s.name, year: s.year, image_url: s.image_url, unit_value: unitValue, value: unitValue == null ? null : Math.round(unitValue * i.qty * 100) / 100 };
  });
  total = Math.round(total * 100) / 100;
  const keep = Math.round(total * RESALE_KEEP * 100) / 100;
  const asking = Number(body.asking_usd);
  const { verdict, margin } = lotVerdict(keep, Number.isFinite(asking) && asking > 0 ? asking : null);
  return c.json({ items: rows, total, resale_keep: keep, unpriced, asking_usd: Number.isFinite(asking) && asking > 0 ? asking : null, verdict, margin });
});

export { app as lotRoute };
