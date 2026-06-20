import { Hono } from 'hono';
import OpenAI from 'openai';
import { optionalMember, requireMember } from '../auth';
import { formulaValuation, valuationExpiryModifier, isPlausibleMarketValue } from '../lib/valuation';
import { fetchSetPricing, fetchUsedPricing } from '../lib/bricklink';
import { fetchBricksetDetails, fetchAdditionalImages } from '../lib/brickset';
import {
  buildEbayAskUpdate,
  buildEbaySoldUpdate,
  ebaySoldNewValue,
  fetchEbayActiveListings,
  fetchEbaySoldPrices,
  type EbaySoldPrices,
} from '../lib/ebay';
import { callGeminiValuation } from '../lib/gemini';
import { MODELS, geminiUrl, openAIServerBaseURL, gatewayHeaders } from '../lib/llm';
import { fetchBrickEconomyDetails } from '../lib/brickeconomy';
import { spendQuota } from '../lib/api-quota';
import { getCachedPriceTrend } from '../lib/price-trend';
import { fetchTracked } from '../lib/http';
import { enrichSetRecord, persistBlendedValue } from '../lib/market-sources';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { isSearchIndexCorruption, rebuildSearchIndex } from '../lib/search-index';
import { checkLegoStock } from '../lib/lego-stock';
import { fetchSetMinifigs } from '../lib/rebrickable';
import type { Env, Variables } from '../types';

interface ListingDraft {
  title: string;
  description: string;
  suggested_price: number;
  price_reasoning: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', optionalMember);

const SORTS: Record<string, string> = {
  value_desc: "(CASE WHEN valuation_method IN ('formula_bulk', 'local') THEN 1 ELSE 0 END), COALESCE(NULLIF(blended_value, 0), current_value) DESC",
  roi_desc:   '(current_value / NULLIF(retail_price, 0)) DESC',
  year_desc:  'year DESC',
  az:         'name ASC',
};

// Catalog-card projection for GET /search. The grid + enrichSetRecord only need
// identity, value and the per-source price/cache family — NOT the heavy
// detail-only columns (brickset_description, brickset_image_urls and
// brickset_tags are large text/JSON; ratings, dimensions, dates, age and
// barcodes are detail-page only). Projecting them out trims the search payload
// and D1 serialization on every catalog page; GET /:setnum still SELECT *s the
// full row. (Verified: every column read by enrichSetRecord, the card and its
// helpers is included.)
const CATALOG_COLS =
  's.set_num, s.name, s.year, s.theme, s.pieces, s.minifigs, ' +
  's.image_url, s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y, s.retired, ' +
  's.valuation_method, s.cached_at, s.source, s.valuation_expires_at, s.ebay_value, s.ebay_cached_at, ' +
  's.ebay_new_value, s.ebay_used_value, s.ebay_new_qty, s.ebay_used_qty, s.ebay_new_cached_at, s.ebay_used_cached_at, ' +
  's.used_value, s.bl_new_value, s.bl_new_qty, s.bl_used_qty, s.bl_cached_at, s.be_cached_at, ' +
  's.ebay_ask_value, s.ebay_ask_qty, s.ebay_ask_cached_at, s.retirement_risk_score, s.subtheme, s.be_growth_12m, ' +
  's.bl_new_min, s.bl_new_max, s.bl_used_min, s.bl_used_max, s.lego_in_stock, s.lego_retiring_soon, ' +
  's.bo_new_value, s.bo_used_value, s.bo_cached_at, s.blended_value';

function pushEbaySoldUpdate(
  stmts: D1PreparedStatement[],
  db: D1Database,
  setNum: string,
  prices: EbaySoldPrices | null | undefined,
) {
  const stmt = buildEbaySoldUpdate(db, setNum, prices);
  if (stmt) stmts.push(stmt);
}

// Auto-repair throttle: at most one FTS rebuild per isolate per hour, and
// never two in flight. Corrupted searches still answer via the LIKE fallback
// while the rebuild runs in the background.
const SEARCH_REPAIR_COOLDOWN_MS = 60 * 60 * 1000;
let searchRepairLastAt = 0;
let searchRepairInFlight = false;

function scheduleSearchIndexRepair(c: { env: { DB: D1Database }; executionCtx: ExecutionContext }) {
  const now = Date.now();
  if (searchRepairInFlight || now - searchRepairLastAt < SEARCH_REPAIR_COOLDOWN_MS) return;
  searchRepairInFlight = true;
  searchRepairLastAt = now;
  c.executionCtx.waitUntil(
    rebuildSearchIndex(c.env.DB)
      .then(r => console.log(`[search-index] auto-repaired, ${r.indexed_sets} sets indexed`))
      .catch(err => console.error('[search-index] auto-repair failed:', (err as Error).message))
      .finally(() => { searchRepairInFlight = false; })
  );
}

function toFtsPrefixQuery(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(tok => `${tok}*`)
    .join(' ');
}

// GET /api/sets/search
app.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const theme = c.req.query('theme') || '';
  const retired = c.req.query('retired') || '';
  const sort = c.req.query('sort') || 'value_desc';
  const lim = Math.min(parseInt(c.req.query('limit') || '24', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);
  const orderBy = SORTS[sort] || SORTS.value_desc;

  const where: string[] = [];
  const params: unknown[] = [];
  const filterWhere: string[] = [];
  const filterParams: unknown[] = [];
  let fromSQL = 'lego_sets s';
  let orderBySQL = orderBy;

  const addFilter = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    filterWhere.push(sql);
    params.push(...values);
    filterParams.push(...values);
  };

  if (q) {
    const cleanedQ = toFtsPrefixQuery(q);
    if (cleanedQ) {
      fromSQL = 'lego_sets s JOIN lego_sets_fts f ON s.rowid = f.rowid';
      where.push(`f.lego_sets_fts MATCH ?`);
      params.push(cleanedQ);
      orderBySQL = `f.rank, ${orderBy}`;
    }
  }
  if (theme) addFilter(`s.theme = ?`, theme);
  const themeGroup = c.req.query('theme_group') || '';
  if (themeGroup) addFilter(`s.theme_group = ?`, themeGroup);
  const category = c.req.query('category') || '';
  if (category) addFilter(`s.category = ?`, category);
  if (retired === '1' || retired === 'true') addFilter(`s.retired = 1`);
  else if (retired === '0' || retired === 'false') addFilter(`s.retired = 0`);

  const rangeFilter = (key: string, col: string) => {
    const v = parseInt(c.req.query(key) || '', 10);
    if (!isNaN(v)) {
      const op = key.startsWith('min_') ? '>=' : '<=';
      addFilter(`s.${col} ${op} ?`, v);
    }
  };
  rangeFilter('min_year', 'year');
  rangeFilter('max_year', 'year');
  rangeFilter('min_pieces', 'pieces');
  rangeFilter('max_pieces', 'pieces');
  rangeFilter('min_value', 'current_value');
  rangeFilter('max_value', 'current_value');

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  let searchDegraded = false;
  let pageRes: D1Result<Record<string, unknown>>;
  let countRes: { total: number } | null;
  try {
    [pageRes, countRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${CATALOG_COLS} FROM ${fromSQL} ${whereSQL} ORDER BY ${orderBySQL}, s.set_num LIMIT ? OFFSET ?`
      ).bind(...params, lim, offset).all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM ${fromSQL} ${whereSQL}`
      ).bind(...params).first<{ total: number }>(),
    ]);
  } catch (error) {
    if (!q || !isSearchIndexCorruption(error)) throw error;

    searchDegraded = true;
    scheduleSearchIndexRepair(c);
    const fallbackWhere = [...filterWhere];
    const fallbackParams = [...filterParams];
    for (const token of q.trim().split(/\s+/).filter(Boolean)) {
      fallbackWhere.push(`(s.set_num LIKE ? OR s.name LIKE ? OR COALESCE(s.theme, '') LIKE ? OR COALESCE(s.subtheme, '') LIKE ? OR COALESCE(s.theme_group, '') LIKE ?)`);
      fallbackParams.push(`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`);
    }
    const fallbackWhereSQL = fallbackWhere.length ? `WHERE ${fallbackWhere.join(' AND ')}` : '';
    [pageRes, countRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${CATALOG_COLS} FROM lego_sets s ${fallbackWhereSQL} ORDER BY ${orderBy}, s.set_num LIMIT ? OFFSET ?`
      ).bind(...fallbackParams, lim, offset).all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM lego_sets s ${fallbackWhereSQL}`
      ).bind(...fallbackParams).first<{ total: number }>(),
    ]);
  }

  let rows = pageRes.results.map(r => enrichSetRecord({ ...r, retired: !!r.retired })) as Record<string, unknown>[];
  let total = countRes?.total ?? 0;

  if (q && offset === 0 && rows.length < lim && c.env.REBRICKABLE_API_KEY) {
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&key=${c.env.REBRICKABLE_API_KEY}&page_size=20`;
      const rb = await fetchTracked(c.env, 'rebrickable', url, { headers: { 'Accept': 'application/json' } });
      if (rb.ok) {
        const data = await rb.json() as { results?: Array<{ set_num: string; name: string; year: number; theme_id: number; num_parts: number; num_minifigs: number; set_img_url: string }> };
        const setKey = (v: string) => String(v || '').replace(/-1$/, '');
        const seen = new Set(rows.map(r => setKey(r.set_num as string)));
        for (const s of (data.results || [])) {
          const key = setKey(s.set_num);
          if (seen.has(key)) continue;
          const alt = s.set_num.endsWith('-1') ? s.set_num.replace(/-1$/, '') : `${s.set_num}-1`;
          const local = await c.env.DB.prepare(
            'SELECT * FROM lego_sets WHERE set_num IN (?, ?) ORDER BY CASE WHEN set_num=? THEN 0 ELSE 1 END LIMIT 1'
          ).bind(s.set_num, alt, s.set_num).first<Record<string, unknown>>();
          if (local) {
            rows.push(enrichSetRecord({ ...local, retired: !!local.retired }));
            seen.add(key);
            continue;
          }
          const vals = formulaValuation({ pieces: s.num_parts, year: s.year, theme: null, retired: false, minifigs: s.num_minifigs || 0 });
          rows.push(enrichSetRecord({
            set_num: s.set_num, name: s.name, year: s.year, theme: null,
            pieces: s.num_parts, minifigs: s.num_minifigs || 0,
            image_url: s.set_img_url, retired: false, ...vals,
          }));
          seen.add(key);
        }
        rows = rows.slice(0, lim);
        total = Math.max(total, offset + rows.length);
      }
    } catch (_) { /* non-critical */ }
  }

  return c.json({ sets: rows, total, hasMore: offset + rows.length < total, search_degraded: searchDegraded });
});

// GET /api/sets/:setnum
app.get('/:setnum', async (c) => {
  const setnum = c.req.param('setnum');
  const userId = c.get('userId');

  let set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum).first<Record<string, unknown>>();
  if (!set) set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum + '-1').first<Record<string, unknown>>();

  if (set) {
    const activeSet = set;
    let resultSet: Record<string, unknown> = set;

    const entry = userId
      ? await c.env.DB.prepare('SELECT * FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL').bind(userId, activeSet.set_num).first()
      : null;

    const trend = await getCachedPriceTrend(activeSet.set_num as string, c.env);

    // Non-blocking/blocking BrickLink or Gemini refresh when price is missing or stale
    const geminiKey = c.req.header('X-Gemini-Key');
    const isBulk = (activeSet.valuation_method === 'formula_bulk');
    const missingEbaySoldComps =
      (!activeSet.ebay_new_value && !activeSet.ebay_new_cached_at)
      || (!activeSet.ebay_used_value && !activeSet.ebay_used_cached_at);
    const askStale = !activeSet.ebay_ask_cached_at
      || Date.now() - new Date(activeSet.ebay_ask_cached_at as string).getTime() > 7 * 24 * 3600 * 1000;
    const needsRefresh = isBulk
      || !activeSet.valuation_expires_at
      || new Date(activeSet.valuation_expires_at as string) < new Date()
      || missingEbaySoldComps;

    if (needsRefresh) {
      if (c.env.BRICKECONOMY_API_KEY) {
        // Fetch BrickEconomy + BrickLink + eBay in parallel for cross-validation.
        // BrickEconomy is ledger-gated (80/day budget of a 100/day hard cap) so
        // browsing traffic can never exhaust the provider quota — on a denied
        // grant the refresh proceeds with BrickLink/eBay only.
        const refreshPromise = Promise.all([
          spendQuota(c.env, 'brickeconomy')
            .then((ok) => (ok ? fetchBrickEconomyDetails(activeSet.set_num as string, c.env) : null))
            .catch(() => null),
          fetchSetPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchUsedPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null),
          askStale ? fetchEbayActiveListings(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null) : Promise.resolve(null),
        ]).then(async ([be, blp, u, ebayPrices, askListings]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          const askStmt = buildEbayAskUpdate(c.env.DB, activeSet.set_num as string, askListings);
          if (askStmt) supplementStmts.push(askStmt);

          if (be && be.current_value_new !== null
              && isPlausibleMarketValue(be.current_value_new, { retailPrice: activeSet.retail_price as number, pieces: activeSet.pieces as number, corroborators: [activeSet.ebay_ask_value as number, blp?.current_value, activeSet.bl_new_value as number] })) {
            const defaultYr = activeSet.retired ? 0.15 : 0.10;
            const yr = (be.rolling_growth_12months != null)
              ? Math.min(0.25, Math.max(0.02, be.rolling_growth_12months / 100))
              : defaultYr;
            const forecast_2y = be.forecast_value_new_2_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(be.current_value_new * Math.pow(1 + yr, 5) * 100) / 100;

            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=COALESCE(?, ?, used_value),
                bl_new_value=COALESCE(?, bl_new_value),
                bl_new_qty=COALESCE(?, bl_new_qty),
                bl_used_qty=COALESCE(?, bl_used_qty),
                bl_cached_at=CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE bl_cached_at END,
                be_cached_at=datetime('now'),
                retail_price=COALESCE(?, retail_price),
                forecast_2y=?, forecast_5y=?,
                valuation_method='brickeconomy',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(
              be.current_value_new,
              u?.used_value ?? null, be.current_value_used,
              blp?.current_value ?? null,
              blp?.lot_count ?? null,
              u?.lot_count ?? null,
              blp?.current_value ?? u?.used_value ?? null,
              be.retail_price_us,
              forecast_2y, forecast_5y,
              activeSet.set_num
            ));
          } else {
            // BE unavailable — persist BL/eBay cross-source data regardless
            if (blp?.current_value) {
              supplementStmts.push(c.env.DB.prepare(
                `UPDATE lego_sets SET bl_new_value=?, bl_new_qty=COALESCE(?, bl_new_qty), bl_cached_at=datetime('now') WHERE set_num=?`
              ).bind(blp.current_value, blp.lot_count ?? null, activeSet.set_num));
            }
            if (u?.used_value) {
              supplementStmts.push(c.env.DB.prepare(
                `UPDATE lego_sets SET used_value=?, bl_used_qty=COALESCE(?, bl_used_qty), bl_cached_at=datetime('now') WHERE set_num=?`
              ).bind(u.used_value, u.lot_count ?? null, activeSet.set_num));
            }
            if (be) {
              supplementStmts.push(c.env.DB.prepare(
                `UPDATE lego_sets SET be_cached_at=datetime('now') WHERE set_num=?`
              ).bind(activeSet.set_num));
            }
          }

          if (supplementStmts.length) await c.env.DB.batch(supplementStmts);
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-brickeconomy-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else if (c.env.BRICKLINK_CONSUMER_KEY) {
        const refreshPromise = Promise.all([
          fetchSetPricing(activeSet.set_num as string, c.env),
          fetchUsedPricing(activeSet.set_num as string, c.env),
          fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null),
          askStale ? fetchEbayActiveListings(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null) : Promise.resolve(null),
        ]).then(async ([p, u, ebayPrices, askListings]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          const askStmt = buildEbayAskUpdate(c.env.DB, activeSet.set_num as string, askListings);
          if (askStmt) supplementStmts.push(askStmt);
          if (u) {
            supplementStmts.push(c.env.DB.prepare(`UPDATE lego_sets SET used_value=?, bl_used_qty=COALESCE(?, bl_used_qty), bl_cached_at=datetime('now') WHERE set_num=?`).bind(u.used_value, u.lot_count ?? null, activeSet.set_num));
          }
          if (p) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(p.current_value * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(p.current_value * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, bl_new_value=?, bl_new_qty=?, bl_cached_at=datetime('now'),
                forecast_2y=?, forecast_5y=?,
                valuation_method='market',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(p.current_value, p.current_value, p.lot_count, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) {
            await c.env.DB.batch(supplementStmts);
          }
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else if (geminiKey) {
        const refreshPromise = Promise.all([
          callGeminiValuation(activeSet.set_num as string, activeSet.name as string, geminiKey, c.env).catch(() => null),
          fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null)
        ]).then(async ([gemVal, ebayPrices]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          const ebayVal = ebaySoldNewValue(ebayPrices);
          if (gemVal && isPlausibleMarketValue(gemVal.current_value, { retailPrice: activeSet.retail_price as number, pieces: activeSet.pieces as number, corroborators: [activeSet.ebay_ask_value as number, ebayVal, activeSet.bl_new_value as number] })) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(gemVal.current_value * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(gemVal.current_value * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=?, forecast_2y=?, forecast_5y=?,
                valuation_method='ai',
                valuation_expires_at=datetime('now', '+12 hours'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(gemVal.current_value, gemVal.used_value, forecast_2y, forecast_5y, activeSet.set_num));
          } else if (ebayVal !== null) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(ebayVal * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(ebayVal * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, forecast_2y=?, forecast_5y=?,
                valuation_method='ebay_sold',
                valuation_expires_at=datetime('now', '+7 days'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(ebayVal, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) {
            await c.env.DB.batch(supplementStmts);
          }
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-gemini-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else {
        const refreshPromise = fetchEbaySoldPrices(activeSet.set_num as string, activeSet.name as string, c.env).then(async (ebayPrices) => {
          const ebayVal = ebaySoldNewValue(ebayPrices);
          const yr = activeSet.retired ? 0.15 : 0.10;
          const hasVal = (ebayVal !== null && ebayVal !== undefined);
          const forecast_2y = hasVal ? Math.round(ebayVal * Math.pow(1 + yr, 2) * 100) / 100 : null;
          const forecast_5y = hasVal ? Math.round(ebayVal * Math.pow(1 + yr, 5) * 100) / 100 : null;
          const supplementStmts: D1PreparedStatement[] = [];
          pushEbaySoldUpdate(supplementStmts, c.env.DB, activeSet.set_num as string, ebayPrices);
          if (hasVal) {
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value = COALESCE(?, current_value),
                forecast_2y = COALESCE(?, forecast_2y),
                forecast_5y = COALESCE(?, forecast_5y),
                valuation_method = 'ebay_sold',
                valuation_expires_at = datetime('now', '+7 days'),
                cached_at = datetime('now')
              WHERE set_num=?
            `).bind(ebayVal, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) await c.env.DB.batch(supplementStmts);
          await persistBlendedValue(c.env.DB, activeSet.set_num as string);
        }).catch(err => console.error('[bg-ebay-sold-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      }
    }

    // Only call Brickset live when the set hasn't been enriched yet. Enriched sets
    // already have their brickset_* columns persisted, and the fill-guards below
    // (!resultSet.X) would set nothing on a re-fetch — so the ~200-500ms blocking
    // call was pure latency on the set-detail response path. Stored columns are
    // returned via resultSet either way; the frontend already falls back to them.
    const brickset = resultSet.brickset_enriched_at
      ? null
      : await fetchBricksetDetails(resultSet.set_num as string, c.env).catch(() => null);
    if (brickset) {
      const bsUpdates: D1PreparedStatement[] = [];
      if (brickset.minifigs !== null && brickset.minifigs > 0 && !resultSet.minifigs) {
        bsUpdates.push(c.env.DB.prepare('UPDATE lego_sets SET minifigs=? WHERE set_num=?').bind(brickset.minifigs, resultSet.set_num));
        resultSet.minifigs = brickset.minifigs;
      }
      if (brickset.retired === true && !resultSet.retired) {
        bsUpdates.push(c.env.DB.prepare('UPDATE lego_sets SET retired=1 WHERE set_num=?').bind(resultSet.set_num));
        resultSet.retired = 1;
      }
      // Prefer official Brickset MSRP for retail_price (store it separately too).
      if (brickset.msrp) {
        bsUpdates.push(c.env.DB.prepare('UPDATE lego_sets SET retail_price=?, brickset_msrp=? WHERE set_num=?').bind(brickset.msrp, brickset.msrp, resultSet.set_num));
        resultSet.retail_price = brickset.msrp;
        resultSet.brickset_msrp = brickset.msrp;
      }
      // Persist rich Brickset metadata fields that were previously discarded
      const bsMeta: Record<string, unknown> = {};
      if (brickset.subtheme && !resultSet.subtheme) bsMeta.subtheme = brickset.subtheme;
      if (brickset.ageMin !== null && resultSet.age_min == null) bsMeta.age_min = brickset.ageMin;
      if (brickset.ageMax !== null && resultSet.age_max == null) bsMeta.age_max = brickset.ageMax;
      if (brickset.rating !== null) bsMeta.brickset_rating = brickset.rating;
      if (brickset.reviewCount !== null) bsMeta.brickset_review_count = brickset.reviewCount;
      if (brickset.retiredYear !== null && resultSet.retired_year == null) bsMeta.retired_year = brickset.retiredYear;
      if (brickset.launchDate && !resultSet.launch_date) bsMeta.launch_date = brickset.launchDate;
      if (brickset.exitDate && !resultSet.exit_date) bsMeta.exit_date = brickset.exitDate;
      if (brickset.themeGroup && !resultSet.theme_group) bsMeta.theme_group = brickset.themeGroup;
      if (brickset.category && !resultSet.category) bsMeta.category = brickset.category;
      if (brickset.tags && !resultSet.brickset_tags) bsMeta.brickset_tags = brickset.tags;
      if (brickset.dimensions && !resultSet.brickset_dimensions) bsMeta.brickset_dimensions = brickset.dimensions;
      if (brickset.packagingType && !resultSet.packaging_type) bsMeta.packaging_type = brickset.packagingType;
      if (brickset.instructionsCount !== null && resultSet.instructions_count == null) bsMeta.instructions_count = brickset.instructionsCount;
      if (brickset.additionalImageCount !== null && resultSet.additional_image_count == null) bsMeta.additional_image_count = brickset.additionalImageCount;
      if (brickset.description && !resultSet.brickset_description) bsMeta.brickset_description = brickset.description;
      if (brickset.setId !== null && resultSet.brickset_set_id == null) bsMeta.brickset_set_id = brickset.setId;
      if (Object.keys(bsMeta).length) {
        const setClauses = Object.keys(bsMeta).map(k => `${k}=?`).join(', ');
        bsUpdates.push(c.env.DB.prepare(`UPDATE lego_sets SET ${setClauses} WHERE set_num=?`)
          .bind(...Object.values(bsMeta), resultSet.set_num));
        Object.assign(resultSet, bsMeta);
      }
      if (bsUpdates.length) await c.env.DB.batch(bsUpdates);
    }

    // Background LEGO.com stock check — runs for active sets not checked in 24h
    if (!resultSet.retired && (
      !resultSet.lego_checked_at ||
      new Date(resultSet.lego_checked_at as string) < new Date(Date.now() - 86_400_000)
    )) {
      c.executionCtx.waitUntil((async () => {
        const stock = await checkLegoStock(resultSet.set_num as string).catch(() => null);
        if (stock !== null) {
          await c.env.DB.prepare(
            `UPDATE lego_sets SET lego_in_stock=?, lego_retiring_soon=?, lego_checked_at=datetime('now') WHERE set_num=?`
          ).bind(stock.in_stock === null ? null : (stock.in_stock ? 1 : 0), stock.retiring_soon ? 1 : 0, resultSet.set_num).run();
        }
      })());
    }

    // Background minifig-set relationship population — runs once per set if Rebrickable key is set
    const minifigCount = Number(resultSet.minifigs ?? 0);
    if (minifigCount > 0 && c.env.REBRICKABLE_API_KEY) {
      const existing = await c.env.DB.prepare(
        'SELECT COUNT(*) as n FROM set_minifigs WHERE set_num=?'
      ).bind(resultSet.set_num).first<{ n: number }>();
      if (!existing?.n) {
        c.executionCtx.waitUntil((async () => {
          const figs = await fetchSetMinifigs(resultSet.set_num as string, c.env).catch(() => null);
          if (!figs?.length) return;
          const stmts = figs.map(f =>
            c.env.DB.prepare(
              `INSERT OR IGNORE INTO set_minifigs (set_num, fig_num, quantity, fig_name, fig_img_url) VALUES (?,?,?,?,?)`
            ).bind(resultSet.set_num, f.fig_num, f.quantity, f.fig_name, f.fig_img_url)
          );
          // Process in batches of 100
          for (let i = 0; i < stmts.length; i += 100) {
            await c.env.DB.batch(stmts.slice(i, i + 100));
          }
        })());
      }
    }

    // Fetch stored set_minifigs to include in response
    const { results: setMinifigs } = await c.env.DB.prepare(
      'SELECT fig_num, quantity, fig_name, fig_img_url FROM set_minifigs WHERE set_num=? ORDER BY quantity DESC'
    ).bind(resultSet.set_num).all<{ fig_num: string; quantity: number; fig_name: string; fig_img_url: string | null }>();

    return c.json({ set: enrichSetRecord({ ...resultSet, retired: !!resultSet.retired, trend, brickset }), entry: entry || null, set_minifigs: setMinifigs });
  }

  if (!c.env.REBRICKABLE_API_KEY) return c.json({ error: 'Set not found' }, 404);

  try {
    const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(setnum)}/`;
    const rb = await fetchTracked(c.env, 'rebrickable', url, { headers: { 'Authorization': `key ${c.env.REBRICKABLE_API_KEY}` } });
    if (!rb.ok) return c.json({ error: 'Set not found' }, 404);
    const s = await rb.json() as { set_num: string; name: string; year: number; num_parts: number; num_minifigs: number; set_img_url: string };
    const vals = formulaValuation({ pieces: s.num_parts, year: s.year, retired: false, minifigs: s.num_minifigs || 0 });
    const row = {
      set_num: s.set_num, name: s.name, year: s.year, theme: null,
      pieces: s.num_parts, minifigs: s.num_minifigs || 0, image_url: s.set_img_url,
      ...vals, valuation_method: 'formula_bulk', retired: false,
    };
    await c.env.DB.prepare(`
      INSERT INTO lego_sets (set_num,name,year,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,cached_at,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,'formula_bulk',datetime('now'),'rebrickable')
      ON CONFLICT (set_num) DO UPDATE SET cached_at=datetime('now')
    `).bind(row.set_num, row.name, row.year, row.pieces, row.minifigs, row.image_url,
            row.retail_price, row.current_value, row.forecast_2y, row.forecast_5y).run();
    const brickset = await fetchBricksetDetails(row.set_num, c.env).catch(() => null);
    if (brickset && brickset.minifigs !== null && brickset.minifigs > 0) {
      await c.env.DB.prepare('UPDATE lego_sets SET minifigs=? WHERE set_num=?')
        .bind(brickset.minifigs, row.set_num)
        .run();
      row.minifigs = brickset.minifigs;
    }
    return c.json({ set: enrichSetRecord({ ...row, brickset }), entry: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/sets/:setnum/history
// GET /api/sets/:setnum/images — lazy, cached, quota-gated Brickset photo gallery.
// getAdditionalImages costs Brickset quota (the getSets enrichment is free), so it
// runs only when a set with extra images is opened, caches 30d, and is gated by the
// daily Brickset budget. additional_image_count + brickset_set_id come from enrichment.
app.get('/:setnum/images', async (c) => {
  const setnum = c.req.param('setnum');
  const cols = 'set_num, brickset_set_id, additional_image_count, brickset_image_urls, brickset_images_cached_at';
  let row = await c.env.DB.prepare(`SELECT ${cols} FROM lego_sets WHERE set_num=?`).bind(setnum).first<Record<string, unknown>>();
  if (!row) row = await c.env.DB.prepare(`SELECT ${cols} FROM lego_sets WHERE set_num=?`).bind(setnum + '-1').first<Record<string, unknown>>();
  if (!row) return c.json({ images: [] });

  const parseUrls = (s: unknown): string[] => {
    if (typeof s !== 'string' || !s) return [];
    try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
  };
  const cachedAtRaw = row.brickset_images_cached_at as string | null;
  const cachedMs = cachedAtRaw ? Date.parse(cachedAtRaw) : NaN;
  const fresh = Number.isFinite(cachedMs) && (Date.now() - cachedMs) < 30 * 24 * 3600 * 1000;
  if (cachedAtRaw && fresh) return c.json({ images: parseUrls(row.brickset_image_urls) });

  const count = Number(row.additional_image_count);
  if (!Number.isFinite(count) || count <= 0) {
    await c.env.DB.prepare("UPDATE lego_sets SET brickset_image_urls='[]', brickset_images_cached_at=datetime('now') WHERE set_num=?").bind(row.set_num).run();
    return c.json({ images: [] });
  }
  const setId = Number(row.brickset_set_id);
  if (!Number.isFinite(setId) || setId <= 0) return c.json({ images: parseUrls(row.brickset_image_urls), pending: true });

  // Paid call — gate against the Brickset daily budget; serve stale/empty if exhausted.
  const ok = await spendQuota(c.env, 'brickset');
  if (!ok) return c.json({ images: parseUrls(row.brickset_image_urls), quotaExhausted: true });

  const urls = await fetchAdditionalImages(setId, c.env).catch(() => null);
  if (urls === null) return c.json({ images: parseUrls(row.brickset_image_urls), error: true });
  await c.env.DB.prepare("UPDATE lego_sets SET brickset_image_urls=?, brickset_images_cached_at=datetime('now') WHERE set_num=?")
    .bind(JSON.stringify(urls), row.set_num).run();
  return c.json({ images: urls });
});

// GET /api/sets/:setnum/parts — returns stored parts list, triggers Rebrickable fetch if empty
app.get('/:setnum/parts', async (c) => {
  const setNum = c.req.param('setnum');
  const userId = c.get('userId'); // optional — needed for user_missing_parts

  const { results: parts } = await c.env.DB.prepare(
    `SELECT part_num, color_id, color_name, quantity, is_spare, part_name, part_img_url
     FROM set_parts WHERE set_num=? ORDER BY is_spare ASC, quantity DESC LIMIT 2000`
  ).bind(setNum).all<{
    part_num: string; color_id: number; color_name: string; quantity: number;
    is_spare: number; part_name: string; part_img_url: string | null;
  }>();

  let missing: Record<string, number> = {};
  if (userId) {
    const { results: missingRows } = await c.env.DB.prepare(
      'SELECT part_num, color_id, missing_qty FROM user_missing_parts WHERE user_id=? AND set_num=?'
    ).bind(userId, setNum).all<{ part_num: string; color_id: number; missing_qty: number }>();
    for (const r of missingRows) missing[`${r.part_num}:${r.color_id}`] = r.missing_qty;
  }

  // Trigger background fetch if parts list is empty and Rebrickable key is set
  if (!parts.length && c.env.REBRICKABLE_API_KEY) {
    c.executionCtx.waitUntil((async () => {
      const { fetchSetParts } = await import('../lib/rebrickable');
      const fetched = await fetchSetParts(setNum, c.env).catch(() => null);
      if (!fetched?.length) return;
      const stmts = fetched.map(p =>
        c.env.DB.prepare(
          `INSERT OR IGNORE INTO set_parts (set_num, part_num, color_id, color_name, quantity, is_spare, part_name, part_img_url) VALUES (?,?,?,?,?,?,?,?)`
        ).bind(setNum, p.part_num, p.color_id, p.color_name, p.quantity, p.is_spare ? 1 : 0, p.part_name, p.part_img_url)
      );
      for (let i = 0; i < stmts.length; i += 100) {
        await c.env.DB.batch(stmts.slice(i, i + 100));
      }
    })());
  }

  const owned = parts.filter(p => !p.is_spare).reduce((s, p) => s + p.quantity, 0);
  const totalMissing = Object.values(missing).reduce((s, v) => s + v, 0);
  const completeness = owned > 0 ? Math.round((owned - totalMissing) / owned * 100) : null;

  return c.json({
    parts: parts.map(p => ({
      ...p,
      missing_qty: missing[`${p.part_num}:${p.color_id}`] ?? 0,
    })),
    completeness,
    total_owned: owned,
    total_missing: totalMissing,
    pending: parts.length === 0,
  });
});

// PATCH /api/sets/:setnum/parts/:partNum — update missing qty for a part
app.patch('/:setnum/parts/:partNumColor', requireMember, async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setnum');
  const rawParam = c.req.param('partNumColor') ?? '';
  const [partNum = '', colorId = '0'] = rawParam.split(':');
  const { missing_qty } = await c.req.json<{ missing_qty: number }>();
  const qty = Math.max(0, Math.floor(Number(missing_qty) || 0));
  if (qty === 0) {
    await c.env.DB.prepare(
      'DELETE FROM user_missing_parts WHERE user_id=? AND set_num=? AND part_num=? AND color_id=?'
    ).bind(userId, setNum, partNum, Number(colorId) || 0).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO user_missing_parts (user_id, set_num, part_num, color_id, missing_qty) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, set_num, part_num, color_id) DO UPDATE SET missing_qty=excluded.missing_qty`
    ).bind(userId, setNum, partNum, Number(colorId) || 0, qty).run();
  }
  return c.json({ ok: true });
});

app.get('/:setnum/history', async (c) => {
  const setNum = c.req.param('setnum');
  const days = Math.min(parseInt(c.req.query('days') || '90', 10), 365);
  const { results } = await c.env.DB.prepare(`
    SELECT snapshot_date, current_value, ebay_value, bl_value
    FROM set_value_history
    WHERE set_num = ? AND snapshot_date >= DATE('now', ?)
    ORDER BY snapshot_date ASC
  `).bind(setNum, `-${days} days`).all();
  return c.json({ history: results, days });
});

// POST /api/sets/:setnum/listing-draft — generate eBay listing copy via AI
app.post('/:setnum/listing-draft', requireMember, async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setnum');

  const [set, entry] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setNum).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      'SELECT condition, purchase_price, notes, is_complete, missing_pieces FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL'
    ).bind(userId, setNum).first<Record<string, unknown>>(),
  ]);
  if (!set) return c.json({ error: 'Set not found' }, 404);

  const condition = (entry?.condition as string) || 'used_good';
  const conditionLabel: Record<string, string> = {
    sealed: 'Factory Sealed', new: 'New / Open Box',
    used_good: 'Used - Good', used_acceptable: 'Used - Acceptable',
  };
  const blPrice = set.current_value ? `$${Number(set.current_value).toFixed(0)}` : 'unknown';
  const ebayNew = Number(set.ebay_new_value ?? set.ebay_value ?? 0);
  const ebayUsed = Number(set.ebay_used_value ?? 0);
  const ebayPrice = condition.startsWith('used') && ebayUsed > 0
    ? `$${ebayUsed.toFixed(0)} used sold`
    : ebayNew > 0
      ? `$${ebayNew.toFixed(0)} new sold`
      : null;

  const sourceName = set.valuation_method === 'market' ? 'BrickLink'
    : set.valuation_method === 'brickeconomy' ? 'BrickEconomy'
    : set.valuation_method === 'ai' ? 'AI estimate'
    : (set.valuation_method === 'ebay_rss' || set.valuation_method === 'ebay_sold') ? 'eBay Sold' : 'Estimated';
  const marketMeta = enrichSetRecord({ ...set });

  const prompt = `Generate an eBay listing for this LEGO set. Return JSON only with keys: title, description, suggested_price (number), price_reasoning (string).

Set: ${set.name}
Set number: ${set.set_num}
Theme: ${set.theme || 'LEGO'}
Year: ${set.year}
Pieces: ${set.pieces}
Minifigs: ${set.minifigs || 0}
Condition: ${conditionLabel[condition] || condition}
Is complete: ${entry?.is_complete !== 0 ? 'Yes' : `No (${entry?.missing_pieces || '?'} pieces missing)`}
${sourceName} market price (new): ${blPrice}${ebayPrice ? `\neBay recent sales: ${ebayPrice}` : ''}
Market confidence: ${marketMeta.confidence}; freshness: ${marketMeta.freshness}
Notes from owner: ${entry?.notes || 'none'}

Title: max 80 characters, include set number and name.
Description: 3-5 sentences covering set highlights, condition, and what's included.
suggested_price: a specific dollar amount number (no $ sign).
price_reasoning: one sentence explaining the price.`;

  const geminiKey = c.req.header('X-Gemini-Key');
  const openaiKey = c.req.header('X-OpenAI-Key');
  let draft: ListingDraft;

  try {
    if (geminiKey) {
      const resp = await fetchTracked(
        c.env,
        'gemini',
        // BYOK listing draft: call Google directly with the user's key.
        geminiUrl(MODELS.listing),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 400, responseMimeType: 'application/json' },
          }),
        }
      );
      if (!resp.ok) throw new Error('Gemini request failed');
      const body = await resp.json() as Record<string, unknown>;
      const text = (body['candidates'] as { content: { parts: { text: string }[] } }[])?.[0]?.content?.parts?.[0]?.text ?? '{}';
      draft = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as ListingDraft;
    } else {
      const finalOpenAIKey = openaiKey || c.env.OPENAI_API_KEY;
      if (!finalOpenAIKey) throw new Error('OpenAI is not configured');
      const openai = new OpenAI({
        apiKey: finalOpenAIKey,
        // Server-key calls route through the gateway; BYOK OpenAI stays direct.
        baseURL: openaiKey ? undefined : openAIServerBaseURL(c.env),
        defaultHeaders: openaiKey ? undefined : gatewayHeaders(c.env),
      });
      const result = await openai.chat.completions.create({
        model: MODELS.openaiFallback,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert eBay seller specializing in LEGO. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      await recordIntegrationAttempt(c.env, 'openai', true);
      draft = JSON.parse(result.choices[0].message.content!.trim()) as ListingDraft;
    }
  } catch (e) {
    await recordIntegrationAttempt(c.env, geminiKey ? 'gemini' : 'openai', false, e);
    console.warn('[listing-draft] AI failed:', (e as Error).message);
    return c.json({ error: 'Could not generate listing. Check your AI key or try again later.' }, 500);
  }

  return c.json(draft);
});

// POST /api/sets/:setnum/revalue
app.post('/:setnum/revalue', requireMember, async (c) => {
  const userId = c.get('userId');
  const setnum = c.req.param('setnum');

  // Rate limiting (5 per hour)
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const ws = windowStart.toISOString();

  await c.env.DB.prepare(`
    INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
    VALUES (?, 'revalue', ?, 1)
    ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
  `).bind(userId, ws).run();

  const rl = await c.env.DB.prepare(
    'SELECT hit_count FROM rate_limits WHERE user_id=? AND endpoint=? AND window_start=?'
  ).bind(userId, 'revalue', ws).first<{ hit_count: number }>();

  if (rl && rl.hit_count > 5) {
    return c.json({ error: 'Rate limit: 5 revaluations per hour.' }, 429);
  }

  let set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum).first<Record<string, unknown>>();
  if (!set) {
    set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum + '-1').first<Record<string, unknown>>();
  }
  if (!set) {
    return c.json({ error: 'Set not found' }, 404);
  }

  let pricing: { current_value: number } | null = null;
  let blPricing: { current_value: number; lot_count?: number } | null = null;
  let usedPricing: { used_value: number; lot_count?: number } | null = null;
  let ebayPrices: EbaySoldPrices | null = null;
  let valMethod = 'market';

  const geminiKey = c.req.header('X-Gemini-Key');

  let beDetails: Awaited<ReturnType<typeof fetchBrickEconomyDetails>> = null;

  if (c.env.BRICKECONOMY_API_KEY) {
    // Run all market sources in parallel — BrickEconomy is primary but BL is
    // fetched alongside it to populate bl_new_value for the price strip.
    // BrickEconomy is ledger-gated; a denied grant degrades to BL/eBay.
    const [be, blp, u, e] = await Promise.all([
      spendQuota(c.env, 'brickeconomy')
        .then((ok) => (ok ? fetchBrickEconomyDetails(set.set_num as string, c.env) : null))
        .catch(() => null),
      fetchSetPricing(set.set_num as string, c.env).catch(() => null),
      fetchUsedPricing(set.set_num as string, c.env).catch(() => null),
      fetchEbaySoldPrices(set.set_num as string, set.name as string, c.env).catch(() => null),
    ]);
    beDetails = be;
    blPricing = blp;
    usedPricing = u || (be?.current_value_used ? { used_value: be.current_value_used } : null);
    ebayPrices = e;

    if (beDetails?.current_value_new != null
        && isPlausibleMarketValue(beDetails.current_value_new, { retailPrice: set.retail_price as number, pieces: set.pieces as number, corroborators: [set.ebay_ask_value as number, blPricing?.current_value, set.bl_new_value as number] })) {
      pricing = { current_value: beDetails.current_value_new };
      valMethod = 'brickeconomy';
    }
  }

  if (!pricing) {
    if (c.env.BRICKLINK_CONSUMER_KEY) {
      const [p, u, e] = await Promise.all([
        blPricing ? Promise.resolve(blPricing) : fetchSetPricing(set.set_num as string, c.env).catch(() => null),
        usedPricing ? Promise.resolve(usedPricing) : fetchUsedPricing(set.set_num as string, c.env).catch(() => null),
        ebayPrices !== null ? Promise.resolve(ebayPrices) : fetchEbaySoldPrices(set.set_num as string, set.name as string, c.env).catch(() => null),
      ]);
      blPricing = p as typeof blPricing;
      usedPricing = u as typeof usedPricing;
      ebayPrices = e as typeof ebayPrices;
      pricing = blPricing;
      valMethod = 'market';
    } else {
      if (geminiKey) {
        const gemVal = await callGeminiValuation(set.set_num as string, set.name as string, geminiKey, c.env);
        if (gemVal) {
          pricing = { current_value: gemVal.current_value };
          usedPricing = { used_value: gemVal.used_value };
          valMethod = 'ai';

          if (pricing && set.retail_price) {
            const pieceCount = Number(set.pieces ?? 0);
            const maxCapMultiplier = pieceCount > 500 ? 8 : 15;
            if (pricing.current_value < 0.3 * Number(set.retail_price) || pricing.current_value > maxCapMultiplier * Number(set.retail_price)) {
              pricing.current_value = Number(set.retail_price);
            }
          }
        }
      }
      if (ebayPrices === null) {
        ebayPrices = await fetchEbaySoldPrices(set.set_num as string, set.name as string, c.env).catch(() => null);
      }
    }
  }

  const ebayPrice = ebaySoldNewValue(ebayPrices);
  if (!pricing && ebayPrice !== null) {
    pricing = { current_value: ebayPrice };
    valMethod = 'ebay_sold';
  }

  const supplementStmts: D1PreparedStatement[] = [];
  pushEbaySoldUpdate(supplementStmts, c.env.DB, set.set_num as string, ebayPrices);
  if (usedPricing) {
    supplementStmts.push(
      c.env.DB.prepare('UPDATE lego_sets SET used_value=? WHERE set_num=?')
        .bind(usedPricing.used_value, set.set_num)
    );
  }
  if (blPricing) {
    supplementStmts.push(
      c.env.DB.prepare(`UPDATE lego_sets SET bl_new_value=?, bl_new_qty=?, bl_cached_at=datetime('now') WHERE set_num=?`)
        .bind(blPricing.current_value, blPricing.lot_count, set.set_num)
    );
  }
  if (usedPricing?.lot_count) {
    supplementStmts.push(
      c.env.DB.prepare(`UPDATE lego_sets SET bl_used_qty=?, bl_cached_at=datetime('now') WHERE set_num=?`)
        .bind(usedPricing.lot_count, set.set_num)
    );
  }
  if (beDetails) {
    supplementStmts.push(
      c.env.DB.prepare(`UPDATE lego_sets SET be_cached_at=datetime('now') WHERE set_num=?`)
        .bind(set.set_num)
    );
  }
  if (pricing) {
    // Use rolling 12-month growth from BrickEconomy when available for dynamic forecasts.
    const defaultYr = set.retired ? 0.15 : 0.10;
    const yr = (beDetails?.rolling_growth_12months != null)
      ? Math.min(0.25, Math.max(0.02, (beDetails.rolling_growth_12months as number) / 100))
      : defaultYr;

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

    supplementStmts.push(
      c.env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          retail_price=COALESCE(?, retail_price),
          valuation_method=?,
          valuation_expires_at=datetime('now', ?),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(pricing.current_value, forecast_2y, forecast_5y, retailPrice, valMethod, valuationExpiryModifier(valMethod), set.set_num)
    );
  }

  if (supplementStmts.length) {
    await c.env.DB.batch(supplementStmts);
  }

  // Persist the blended fair value alongside the refreshed current_value so the
  // portfolio basis stays consistent (Approach A). Fails open; runs before the
  // re-read so the returned set carries the fresh blended_value too.
  await persistBlendedValue(c.env.DB, set.set_num as string);

  const updatedSet = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(set.set_num).first<Record<string, unknown>>();
  const trend = updatedSet ? await getCachedPriceTrend(updatedSet.set_num as string, c.env) : null;
  return c.json({ set: updatedSet ? enrichSetRecord({ ...updatedSet, retired: !!updatedSet.retired, trend }) : null });
});

export { app as setsRoute };
