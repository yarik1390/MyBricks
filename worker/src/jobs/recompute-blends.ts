import type { Env } from '../types';
import { recomputeBlendedValues } from '../lib/market-sources';
import { pricingWritesAllowed } from '../lib/pricing-budget';

const CURSOR_KEY = 'blend_recompute_cursor_v1';
const DEAL_CURSOR_KEY = 'deal_recheck_cursor_v1';
const DEAL_RECHECK_LIMIT = 100;
const SUSPECT_CURSOR_KEY = 'suspect_recheck_cursor_v1';
const SUSPECT_RECHECK_LIMIT = 100;
const SUSPECT_MIN_VALUE = 500;

// One page of a priority lane walked on its own cursor. A short page means the
// end of the list: the lane restarts from the top next run.
async function lanePage(db: D1Database, key: string, sql: string, limit: number) {
  const checkpoint = await db.prepare('SELECT value FROM app_settings WHERE key=?')
    .bind(key).first<{ value: string | null }>();
  const { results } = await db.prepare(sql).bind(checkpoint?.value || '', limit).all<{ set_num: string }>();
  const setNums = results.map(row => row.set_num);
  const next = setNums.length < limit ? '' : setNums[setNums.length - 1];
  return {
    setNums,
    commit: () => db.prepare(`INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .bind(key, next).run(),
  };
}

// Observe D1 failures even when the shared request-path helper swallows them.
// Zero changed rows can mean success, so it cannot gate checkpoint advancement.
function observeFailures(db: D1Database) {
  let failure: unknown;
  let failed = false;
  const statements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const observe = async <T>(operation: () => Promise<T>): Promise<T> => {
    // Once an input read fails, do not let a catch-and-fallback path persist
    // a valuation derived from incomplete evidence.
    if (failed) throw failure;
    try { return await operation(); }
    catch (error) { failed = true; failure = error; throw error; }
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
        if (property === 'all' || property === 'first' || property === 'run' || property === 'raw') {
          return (...args: unknown[]) => observe(() => Reflect.apply(target[property], target, args));
        }
        return Reflect.get(target, property);
      },
    });
    statements.set(wrapped, statement);
    return wrapped;
  };
  const observed = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (property === 'batch') return (batch: D1PreparedStatement[]) =>
        observe(() => target.batch(batch.map(statement => statements.get(statement) || statement)));
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { db: observed, assertSuccess() { if (failed) throw failure; } };
}

// Keep the public name for hourly/admin callers. Rotate through ALL sets,
// including existing states and rows without evidence, to prevent starvation.
// Only re-derive cached evidence: valuation_expires_at is not evidence freshness
// and is neither used as a scheduling signal nor cleared here.
export async function runBlendRecomputeBackfill(
  env: Env,
  options: { limit?: number } = {},
): Promise<{ candidates: number; recomputed: number; limit: number; paused?: boolean }> {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.max(1, Math.floor(requested)), 400)
    : 100;
  const observed = observeFailures(env.DB);
  const db = observed.db;
  const allowed = await pricingWritesAllowed(db);
  observed.assertSuccess();
  if (!allowed) return { candidates: 0, recomputed: 0, limit, paused: true };

  const checkpoint = await db.prepare('SELECT value FROM app_settings WHERE key=?')
    .bind(CURSOR_KEY).first<{ value: string | null }>();
  const cursor = checkpoint?.value || '';
  const { results } = await db.prepare(`
    SELECT set_num FROM lego_sets WHERE set_num > ? ORDER BY set_num LIMIT ?
  `).bind(cursor, limit).all<{ set_num: string }>();
  // Fill the remainder from the start without visiting a row twice in a run.
  // Two indexed range scans; no OFFSET, joins, or catalog-wide priority sorting.
  if (cursor && results.length < limit) {
    const wrapped = await db.prepare(`
      SELECT set_num FROM lego_sets WHERE set_num <= ? ORDER BY set_num LIMIT ?
    `).bind(cursor, limit - results.length).all<{ set_num: string }>();
    results.push(...wrapped.results);
  }
  const setNums = results.map(row => row.set_num);
  if (!setNums.length) return { candidates: 0, recomputed: 0, limit };

  // Persisted "buy" calls drive the catalog Deals filter and deal alerts, but
  // the full rotation above takes days to come back round to a row. Re-derive
  // a page of current buy rows every run on their own cursor, so a buy call
  // whose evidence no longer holds (e.g. an accessory-contaminated ask) drops
  // out within hours instead of lingering in the Deals list.
  const deal = await lanePage(db, DEAL_CURSOR_KEY,
    `SELECT set_num FROM lego_sets WHERE deal_signal = 'buy' AND set_num > ? ORDER BY set_num LIMIT ?`,
    DEAL_RECHECK_LIMIT);
  // Same idea for valuations most likely to be wrong or most costly when they
  // are: low confidence, conflicting sources, or a high headline. A pricing
  // fix then reaches them within a day instead of waiting a full rotation.
  const suspect = await lanePage(db, SUSPECT_CURSOR_KEY,
    `SELECT set_num FROM set_valuation_state
     WHERE condition = 'new_sealed'
       AND (confidence = 'low' OR flags_json LIKE '%source_conflict%' OR fair_value >= ${SUSPECT_MIN_VALUE})
       AND set_num > ? ORDER BY set_num LIMIT ?`,
    SUSPECT_RECHECK_LIMIT);

  const recomputed = await recomputeBlendedValues(db, [...new Set([...setNums, ...deal.setNums, ...suspect.setNums])]);
  observed.assertSuccess();
  // Partial writes are idempotent: any failure retries this page next time.
  // CAS prevents an overlapping run from overwriting a newer checkpoint.
  if (checkpoint) {
    await db.prepare(`UPDATE app_settings SET value=?, updated_at=datetime('now')
      WHERE key=? AND value IS ?`).bind(setNums[setNums.length - 1], CURSOR_KEY, checkpoint.value).run();
  } else {
    await db.prepare(`INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO NOTHING`)
      .bind(CURSOR_KEY, setNums[setNums.length - 1]).run();
  }
  await deal.commit();
  await suspect.commit();
  return { candidates: setNums.length, recomputed, limit };
}
