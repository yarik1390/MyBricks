import type { Env } from '../types';
import { fetchGzip } from './import-catalog';
import { pricingWritesAllowed } from '../lib/pricing-budget';
import { recomputeBlendedValues } from '../lib/market-sources';

// Bundles (multi-packs, complete minifigure series, sealed CMF boxes, starter
// bundles) have no piece count and rarely any sales of their own, so neither
// the market sources nor the value model can price them. What they contain is
// known: Rebrickable's inventory files list the sets inside each one, and we
// price those sets already. A bundle is worth the sum of its contents, and a
// minifigure random box/bag the average figure of its series.
//
// Runs daily right after the value model. Two small public downloads, one
// value read, and writes only where a value changed.

const CDN = 'https://cdn.rebrickable.com/media/downloads';
// A random box draws one figure, so one mispriced chase figure must not drag
// the average: each figure counts at most this multiple of the series median.
export const FIGURE_CAP_X_MEDIAN = 3;
// Recompute at most this many valuations per run so the new values show today.
const RECOMPUTE_LIMIT = 400;

export type BundleItems = Map<string, Array<{ set_num: string; quantity: number }>>;

const rows = (csv: string) => csv.split('\n').slice(1).map(l => l.trim()).filter(Boolean).map(l => l.split(','));

/** Parent set -> contained sets, from the lowest-version inventory that lists sets. */
export function parseBundleItems(inventoriesCsv: string, inventorySetsCsv: string): BundleItems {
  const children = new Map<string, Array<{ set_num: string; quantity: number }>>();
  for (const [inv, setNum, qty] of rows(inventorySetsCsv)) {
    const quantity = Number(qty);
    if (!inv || !setNum || !(quantity > 0)) continue;
    let list = children.get(inv);
    if (!list) children.set(inv, list = []);
    list.push({ set_num: setNum, quantity });
  }
  const best = new Map<string, { version: number; inv: string }>();
  for (const [inv, version, setNum] of rows(inventoriesCsv)) {
    if (!children.has(inv) || !setNum) continue;
    const v = Number(version) || 1;
    const prev = best.get(setNum);
    if (!prev || v < prev.version) best.set(setNum, { version: v, inv });
  }
  const out: BundleItems = new Map();
  for (const [setNum, { inv }] of best) out.set(setNum, children.get(inv)!);
  return out;
}

const round = (v: number) => (v >= 20 ? Math.round(v) : Math.round(v * 10) / 10);
const base = (setNum: string) => setNum.slice(0, setNum.lastIndexOf('-'));

/**
 * Values for every bundle whose contents are all priced, plus random boxes
 * ("<series>-0") from the figures of their series' complete bundle.
 * `values` holds our current value for each contained set.
 */
export function computeBundleValues(
  bundles: BundleItems,
  randomBoxes: string[],
  values: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const known = new Map(values);

  for (const box of randomBoxes) {
    const series = base(box);
    // The largest bundle made only of this series' numbered figures.
    let figures: string[] = [];
    for (const [parent, items] of bundles) {
      if (parent === box || base(parent) !== series) continue;
      if (!items.every(i => base(i.set_num) === series && !i.set_num.endsWith('-0'))) continue;
      if (items.length > figures.length) figures = items.map(i => i.set_num);
    }
    const priced = figures.map(f => values.get(f)).filter((v): v is number => v != null && v > 0);
    if (priced.length < 3 || priced.length * 2 < figures.length) continue;
    const sorted = [...priced].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const capped = priced.map(v => Math.min(v, median * FIGURE_CAP_X_MEDIAN));
    const avg = round(capped.reduce((s, v) => s + v, 0) / capped.length);
    out.set(box, avg);
    known.set(box, avg);
  }

  // Bundles can hold bundles (a sealed box holds 36 random boxes), so settle
  // in a few passes; each pass only adds bundles whose contents are all known.
  for (let pass = 0; pass < 3; pass++) {
    let added = 0;
    for (const [parent, items] of bundles) {
      if (out.has(parent) || items.some(i => i.set_num === parent)) continue;
      let sum = 0;
      let complete = true;
      for (const i of items) {
        const v = known.get(i.set_num);
        if (!(v != null && v > 0)) { complete = false; break; }
        sum += v * i.quantity;
      }
      if (!complete || !(sum > 0)) continue;
      out.set(parent, round(sum));
      known.set(parent, round(sum));
      added++;
    }
    if (!added) break;
  }
  return out;
}

export async function runBundleValues(env: Env): Promise<{
  bundles: number; valued: number; written: number; cleared: number; recomputed: number; skipped?: string;
}> {
  if (!(await pricingWritesAllowed(env.DB))) {
    return { bundles: 0, valued: 0, written: 0, cleared: 0, recomputed: 0, skipped: 'D1 pricing write budget paused non-critical jobs' };
  }
  const [inventories, inventorySets] = await Promise.all([
    fetchGzip(`${CDN}/inventories.csv.gz`, env),
    fetchGzip(`${CDN}/inventory_sets.csv.gz`, env),
  ]);
  const parsed = parseBundleItems(inventories, inventorySets);
  const db = env.DB;

  // Bundles we carry, and minifigure random boxes ("-0") of series we carry.
  const { results: ours } = await db.prepare(
    `SELECT set_num FROM lego_sets WHERE set_num IN (SELECT value FROM json_each(?1))
     UNION SELECT set_num FROM lego_sets WHERE set_num LIKE '%-0' AND theme = 'Collectible Minifigures'`,
  ).bind(JSON.stringify([...parsed.keys()])).all<{ set_num: string }>();
  const ourSets = new Set(ours.map(r => r.set_num));
  const bundles: BundleItems = new Map([...parsed].filter(([p]) => ourSets.has(p)));
  const randomBoxes = [...ourSets].filter(s => s.endsWith('-0') && !bundles.has(s));

  // Current value of everything inside: the fair value, else our model's
  // estimate (which for a nested bundle is its own bundle value).
  const childIds = new Set<string>();
  for (const items of parsed.values()) for (const i of items) childIds.add(i.set_num);
  const { results: priced } = await db.prepare(
    `SELECT ls.set_num, COALESCE(NULLIF(sv.fair_value, 0), NULLIF(ext.model_value, 0)) AS v
       FROM lego_sets ls
       LEFT JOIN set_valuation_state sv ON sv.set_num = ls.set_num AND sv.condition = 'new_sealed'
       LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
      WHERE ls.set_num IN (SELECT value FROM json_each(?1))`,
  ).bind(JSON.stringify([...childIds])).all<{ set_num: string; v: number | null }>();
  const values = new Map<string, number>();
  for (const r of priced) if (r.v != null && r.v > 0) values.set(r.set_num, Number(r.v));

  const computed = computeBundleValues(bundles, randomBoxes, values);

  const { results: current } = await db.prepare(
    'SELECT set_num, bundle_value FROM set_market_ext WHERE bundle_value IS NOT NULL',
  ).all<{ set_num: string; bundle_value: number }>();
  const before = new Map(current.map(r => [r.set_num, Number(r.bundle_value)]));

  const stmts: D1PreparedStatement[] = [];
  const changed: string[] = [];
  for (const [setNum, value] of computed) {
    if (before.get(setNum) === value) continue;
    changed.push(setNum);
    stmts.push(db.prepare(
      `INSERT INTO set_market_ext (set_num, bundle_value, bundle_cached_at, model_value, model_cached_at)
       VALUES (?1, ?2, datetime('now'), ?2, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET bundle_value = ?2, bundle_cached_at = datetime('now'),
         model_value = ?2, model_cached_at = datetime('now')`,
    ).bind(setNum, value));
  }
  // A bundle whose contents lost their value goes back to the value model,
  // which re-estimates it on its next run.
  let cleared = 0;
  for (const setNum of before.keys()) {
    if (computed.has(setNum)) continue;
    cleared++;
    changed.push(setNum);
    stmts.push(db.prepare(
      'UPDATE set_market_ext SET bundle_value = NULL, bundle_cached_at = NULL, model_value = NULL, model_cached_at = NULL WHERE set_num = ?1',
    ).bind(setNum));
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));

  // Show new estimates today instead of waiting for the multi-day recompute
  // rotation: the bundles that moved, then sets the value model priced that
  // still have no valuation.
  const { results: fresh } = await db.prepare(
    `SELECT ext.set_num FROM set_market_ext ext
       LEFT JOIN set_valuation_state sv ON sv.set_num = ext.set_num AND sv.condition = 'new_sealed'
      WHERE ext.model_value > 0 AND (sv.fair_value IS NULL OR sv.fair_value <= 0)
      LIMIT ?1`,
  ).bind(RECOMPUTE_LIMIT).all<{ set_num: string }>();
  const toRecompute = [...new Set([...changed, ...fresh.map(r => r.set_num)])].slice(0, RECOMPUTE_LIMIT);
  const recomputed = await recomputeBlendedValues(db, toRecompute);

  return { bundles: bundles.size + randomBoxes.length, valued: computed.size, written: changed.length - cleared, cleared, recomputed };
}
