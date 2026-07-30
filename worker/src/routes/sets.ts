import { Hono, type Context } from 'hono';
import { optionalMember, requireMember } from '../auth';
import { formulaValuation, valuationExpiryModifier, isPlausibleMarketValue } from '../lib/valuation';
import { fetchSetPricing, fetchUsedPricing } from '../lib/bricklink';
import { SORTS, NON_SET_DEMOTION, CATALOG_COLS, MARKET_EXT_JOIN, attachCatalogValuationState, toFtsPrefixQuery } from './sets-sql';
import { scheduleSetDetailRefresh, pushEbaySoldUpdate } from './set-detail-refresh';
import { generateListingDraft, type ListingDraft } from './listing-draft';
import { fetchBricksetDetails, fetchAdditionalImages } from '../lib/brickset';
import {
  ebaySoldNewValue,
  fetchEbaySoldPrices,
  type EbaySoldPrices,
} from '../lib/ebay';
import { callGeminiValuation } from '../lib/gemini';
import { beDetailsFromRow } from '../lib/brickeconomy-firecrawl';
import { spendQuota } from '../lib/api-quota';
import { getCachedPriceTrend } from '../lib/price-trend';
import { fetchTracked } from '../lib/http';
import { enrichSetRecord, persistBlendedValue } from '../lib/market-sources';
import { applySourceConfig } from '../lib/source-config';
import { recentValueMedian } from '../lib/price-trend';
import { isSearchIndexCorruption, rebuildSearchIndex } from '../lib/search-index';
import { checkLegoStock } from '../lib/lego-stock';
import { fetchSetMinifigs } from '../lib/rebrickable';
import type { Env, Variables } from '../types';
import {
  AMAZON_ASSOCIATE_DISCLOSURE,
  AMAZON_PRICE_DISCLAIMER,
  amazonLinkEnabled,
  amazonMarket,
  amazonPartnerTag,
  buildAmazonSpecialLink,
  getFreshAmazonOffer,
} from '../lib/amazon';


const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', optionalMember);
// Apply admin source-tuning (blend weights) so read-side market values match the
// persisted/tuned blend. Memoized 60s per isolate; fail-open to defaults.
app.use('*', async (c, next) => { await applySourceConfig(c.env).catch(() => {}); await next(); });

// CATALOG_COLS + MARKET_EXT_JOIN live in ./sets-sql; re-exported for scan.ts + tests.
export { CATALOG_COLS, MARKET_EXT_JOIN };


// Auto-repair throttle. A cheap PER-ISOLATE gate (avoid hammering the guard
// table) plus an authoritative GLOBAL cooldown claimed in app_settings.
//
// Why the global claim matters: the per-isolate variables below reset on every
// cold start, and Cloudflare runs many isolates — so each fresh isolate used to
// rebuild the whole ~425k-row FTS index once on the first corrupt search. That
// turned intermittent external-content FTS5 corruption into ~60 full rebuilds =
// ~25M D1 rows written. The app_settings claim caps rebuilds account-wide.
const SEARCH_REPAIR_COOLDOWN_MS = 60 * 60 * 1000;   // per-isolate pre-check
const SEARCH_REPAIR_GLOBAL_COOLDOWN = '-6 hours';   // account-wide cap
let searchRepairLastAt = 0;
let searchRepairInFlight = false;

// Typed by what we actually use (env.DB + executionCtx.waitUntil) rather than the
// full workers-types ExecutionContext, which drifts between type releases (e.g. a
// newly-required `tracing` field) and wouldn't match Hono's context shape.
function scheduleSearchIndexRepair(c: { env: { DB: D1Database }; executionCtx: { waitUntil(p: Promise<unknown>): void } }) {
  const now = Date.now();
  if (searchRepairInFlight || now - searchRepairLastAt < SEARCH_REPAIR_COOLDOWN_MS) return;
  searchRepairInFlight = true;
  searchRepairLastAt = now;
  c.executionCtx.waitUntil(
    repairSearchIndexOnce(c.env.DB)
      .catch(err => console.error('[search-index] auto-repair failed:', (err as Error).message))
      .finally(() => { searchRepairInFlight = false; })
  );
}

// Atomically claim the global rebuild slot, then rebuild only if we won it. The
// UPSERT's WHERE runs the UPDATE (changes=1) only when the last rebuild is older
// than the cooldown; concurrent isolates racing it see changes=0 and skip. Search
// keeps answering via the LIKE fallback in between. Fails open if the guard table
// is unavailable so search is never left permanently degraded.
async function repairSearchIndexOnce(db: D1Database) {
  let claimed = true;
  try {
    const res = await db.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('search_index_rebuilt_at', datetime('now'), datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value=datetime('now'), updated_at=datetime('now')
       WHERE app_settings.updated_at < datetime('now', ?)`
    ).bind(SEARCH_REPAIR_GLOBAL_COOLDOWN).run();
    claimed = (res?.meta?.changes ?? 0) > 0;
  } catch (err) {
    console.warn('[search-index] cooldown guard unavailable, repairing anyway:', (err as Error).message);
  }
  if (!claimed) {
    console.log('[search-index] repair skipped — rebuilt within the global cooldown');
    return;
  }
  const r = await rebuildSearchIndex(db);
  console.log(`[search-index] auto-repaired, ${r.indexed_sets} sets indexed`);
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

  // Trending sort needs a 30-day price history snapshot for momentum computation.
  //
  // INNER join, not LEFT: only ~2,002 of 27,660 sets have a snapshot from exactly
  // 30 days ago, and the LEFT join gave the other 25,658 a -1 sentinel that sorted
  // them to the bottom as filler nobody ever pages to. Keeping them meant scanning
  // the whole catalog and probing history once per row — 57,322 rows read. Driving
  // from the snapshot side instead (idx_svh_date_set makes the date a range scan)
  // costs 6,007 rows for the identical top page.
  //
  // The value guards move into WHERE for the same reason: they are what the old
  // CASE tested for before falling back to -1, so as filters they change nothing
  // about which sets can actually rank — only how many rows we look at.
  // NOTE: these go in `where`, NOT via addFilter — filterWhere feeds the
  // FTS-corruption fallback below, which queries lego_sets alone and would break
  // on an svh30 reference.
  if (sort === 'trending') {
    fromSQL += " JOIN set_value_history svh30 ON svh30.set_num = s.set_num AND svh30.snapshot_date = date('now','-30 days')";
    where.push('svh30.current_value > 0');
    where.push('s.current_value > 0');
  }

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
      // Keyword-search relevance ordering:
      //  1. NON_SET_DEMOTION — real building sets rank above non-building merch.
      //  2. weighted bm25 — boost name/set_num over the long theme_group +
      //     brickset_tags fields that otherwise dilute a flagship set's score and
      //     let sparse merch rows float up. Only 3 weights are supplied so this
      //     stays valid whether the FTS index has 3 columns (minimal/test) or 6
      //     (prod): unspecified columns default to weight 1.0, while supplying
      //     MORE weights than columns is an error.
      //  3. the requested sort (default value_desc) as the final tiebreak.
      orderBySQL = `${NON_SET_DEMOTION}, bm25(lego_sets_fts, 4.0, 8.0, 2.0), ${orderBy}`;
    }
  }
  if (theme) addFilter(`s.theme = ?`, theme);
  const themeGroup = c.req.query('theme_group') || '';
  if (themeGroup) addFilter(`s.theme_group = ?`, themeGroup);
  const category = c.req.query('category') || '';
  if (category) addFilter(`s.category = ?`, category);
  if (retired === '1' || retired === 'true') addFilter(`s.retired = 1`);
  else if (retired === '0' || retired === 'false') addFilter(`s.retired = 0`);
  // Retiring-soon: still-active sets the official flag OR the risk model marks as
  // near retirement. Both are real columns, so this filters/paginates correctly.
  const retiring = c.req.query('retiring') || '';
  if (retiring === '1' || retiring === 'true') {
    addFilter(`s.retired = 0 AND (s.lego_retiring_soon = 1 OR s.retirement_risk_score >= 70)`);
  }
  // Deals: the persisted deal signal (same computeDealSignal as the badge), so
  // the filter and the on-card DEAL badge always agree.
  const deal = c.req.query('deal') || '';
  if (deal === '1' || deal === 'true') addFilter(`s.deal_signal = 'buy'`);

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
  // The unfiltered browse is the app's most-hit query, and its COUNT(*) is a full
  // scan of the catalog on EVERY page — once idx_sets_browse_value reduced the
  // page itself to ~24 rows read, this count was 99.9% of what the request cost
  // (27,660 of 27,684 rows). The catalog only changes on the weekly import, so
  // cache the unfiltered total briefly instead of recounting it per request.
  // Filtered/searched counts are NOT cached — they vary per query and must stay exact.
  const cacheTotal = !q && !whereSQL;
  const TOTAL_KEY = 'catalog:total';
  let cachedTotal: number | null = null;
  if (cacheTotal) {
    const hit = await c.env.CACHE_KV?.get(TOTAL_KEY).catch(() => null);
    const n = Number(hit);
    if (Number.isFinite(n) && n > 0) cachedTotal = n;
  }
  try {
    [pageRes, countRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${CATALOG_COLS} FROM ${fromSQL} ${MARKET_EXT_JOIN} ${whereSQL} ORDER BY ${orderBySQL}, s.set_num LIMIT ? OFFSET ?`
      ).bind(...params, lim, offset).all<Record<string, unknown>>(),
      cachedTotal != null
        ? Promise.resolve({ total: cachedTotal })
        : c.env.DB.prepare(
            `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM ${fromSQL} ${whereSQL}`
          ).bind(...params).first<{ total: number }>(),
    ]);
    if (cacheTotal && cachedTotal == null && countRes?.total && c.env.CACHE_KV) {
      // Best-effort, non-blocking: a missed cache write just means one more count.
      c.executionCtx?.waitUntil?.(
        c.env.CACHE_KV.put(TOTAL_KEY, String(countRes.total), { expirationTtl: 900 }).catch(() => {}),
      );
    }
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
    // This path queries lego_sets ALONE, so it cannot use a sort that references
    // the trending snapshot join — that would throw "no such column: svh30..."
    // and turn a degraded search into a 500. Momentum is meaningless on a
    // keyword-search fallback anyway; rank by value instead.
    const fallbackOrderBy = sort === 'trending' ? SORTS.value_desc : orderBy;
    [pageRes, countRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT ${CATALOG_COLS} FROM lego_sets s ${MARKET_EXT_JOIN} ${fallbackWhereSQL} ORDER BY ${NON_SET_DEMOTION}, ${fallbackOrderBy}, s.set_num LIMIT ? OFFSET ?`
      ).bind(...fallbackParams, lim, offset).all<Record<string, unknown>>(),
      c.env.DB.prepare(
        `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM lego_sets s ${fallbackWhereSQL}`
      ).bind(...fallbackParams).first<{ total: number }>(),
    ]);
  }

  let rows = pageRes.results.map(r => enrichSetRecord(attachCatalogValuationState({ ...r, retired: !!r.retired }))) as Record<string, unknown>[];
  let total = countRes?.total ?? 0;

  if (q && offset === 0 && rows.length < lim && c.env.REBRICKABLE_API_KEY) {
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&key=${c.env.REBRICKABLE_API_KEY}&page_size=20`;
      const rb = await fetchTracked(c.env, 'rebrickable', url, { headers: { 'Accept': 'application/json' } });
      if (rb.ok) {
        const data = await rb.json() as { results?: Array<{ set_num: string; name: string; year: number; theme_id: number; num_parts: number; num_minifigs: number; set_img_url: string }> };
        const setKey = (v: string) => String(v || '').replace(/-1$/, '');
        const altOf = (sn: string) => (sn.endsWith('-1') ? sn.replace(/-1$/, '') : `${sn}-1`);
        const seen = new Set(rows.map(r => setKey(r.set_num as string)));

        // Rebrickable hits we don't already have on the page.
        const freshHits = (data.results || []).filter(s => !seen.has(setKey(s.set_num)));

        // Batch the local-catalog lookup: one IN (...) query covering every
        // candidate set number AND its -1/non-variant alternate, instead of a
        // per-result SELECT inside the loop (the old N+1). page_size is 20, so
        // this binds at most 40 params — well under D1's 100-param limit.
        const lookupNums = freshHits.flatMap(s => [s.set_num, altOf(s.set_num)]);
        const localBySetNum = new Map<string, Record<string, unknown>>();
        if (lookupNums.length) {
          const placeholders = lookupNums.map(() => '?').join(',');
          const { results: locals } = await c.env.DB.prepare(
            `SELECT * FROM lego_sets WHERE set_num IN (${placeholders})`
          ).bind(...lookupNums).all<Record<string, unknown>>();
          for (const row of locals) localBySetNum.set(row.set_num as string, row);
        }

        for (const s of freshHits) {
          const key = setKey(s.set_num);
          if (seen.has(key)) continue; // an earlier hit already resolved this set
          // Prefer the exact set number, fall back to its variant alternate.
          const local = localBySetNum.get(s.set_num) || localBySetNum.get(altOf(s.set_num));
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
app.get('/:setnum/amazon', async (c) => {
  c.header('Cache-Control', 'no-store');
  const requested = c.req.param('setnum');
  const set = await c.env.DB.prepare('SELECT set_num, name FROM lego_sets WHERE set_num=? OR set_num=? LIMIT 1')
    .bind(requested, `${requested}-1`).first<{ set_num: string; name: string }>();
  if (!set) return c.json({ error: 'Set not found' }, 404);

  const platform = c.req.header('X-Brickvault-Platform') === 'android' ? 'android' : 'web';
  const market = amazonMarket(c.req.query('market'), c.env);
  const tag = amazonPartnerTag(c.env, market, platform);
  if (!amazonLinkEnabled(c.env, platform) || !tag) {
    return c.json({
      available: false,
      platform,
      market,
      mode: 'disabled',
      reason: platform === 'android'
        ? 'Amazon purchasing is disabled until Brickvault is approved as an Amazon Mobile Application.'
        : 'Amazon Web affiliate links are not configured.',
    });
  }

  const offer = await getFreshAmazonOffer(c.env, set.set_num, market);
  return c.json({
    available: true,
    platform,
    market,
    currency: offer?.currency || (market === 'FR' || market === 'DE' ? 'EUR' : market === 'GB' ? 'GBP' : market === 'CA' ? 'CAD' : market === 'AU' ? 'AUD' : 'USD'),
    mode: offer ? 'creators_api' : 'link_only',
    url: offer?.url || buildAmazonSpecialLink(set.set_num, set.name, market, tag),
    asin: offer?.asin || null,
    price: offer?.price || null,
    availability: offer?.availability || null,
    checked_at: offer?.fetched_at || null,
    disclosure: AMAZON_ASSOCIATE_DISCLOSURE,
    price_disclaimer: offer ? AMAZON_PRICE_DISCLAIMER : null,
  });
});

app.get('/:setnum/price-history', async (c) => {
  const setNum = c.req.param('setnum');
  const condition = c.req.query('condition') || 'new_sealed';
  if (!['new_sealed', 'used_complete', 'loose'].includes(condition)) {
    return c.json({ error: 'condition must be new_sealed, used_complete, or loose' }, 400);
  }
  const { results } = await c.env.DB.prepare(`
    SELECT snapshot_date, fair_value, low, high, confidence, model_version
    FROM set_valuation_history_v2
    WHERE set_num=? AND condition=?
    ORDER BY snapshot_date ASC LIMIT 400
  `).bind(setNum, condition).all();
  return c.json({ set_num: setNum, condition, currency: 'USD', history: results });
});

app.get('/:setnum/offers', async (c) => {
  const setNum = c.req.param('setnum');
  const market = String(c.req.query('market') || 'FR').toUpperCase();
  const current = await c.env.DB.prepare(`
    SELECT market, currency, item_price, delivered_price, merchant, stock,
           offer_count, msrp, lowest_90d, all_time_low, checked_at, source
    FROM retail_price_current WHERE set_num=? AND market=?
  `).bind(setNum, market).first();
  const stats = await c.env.DB.prepare(`
    SELECT MIN(delivered_price) AS all_time_low,
      MIN(CASE WHEN observed_at >= datetime('now','-90 days') THEN delivered_price END) AS lowest_90d
    FROM retail_price_history WHERE set_num=? AND market=?
  `).bind(setNum, market).first();
  return c.json({ set_num: setNum, market, current: current ? { ...current, ...stats } : null });
});

/**
 * Fetch Brickset details for a set we have never enriched and persist whatever
 * columns are still blank. Runs in waitUntil, off the response path — it is a
 * 200-500ms third-party call and every write below is a fill-the-blank, so
 * nothing here is needed to render the current response.
 *
 * Guards are unchanged from when this ran inline: rating/reviewCount always
 * refresh, everything else only fills a null/empty column, so re-running is safe
 * and never clobbers better data. Stamps brickset_enriched_at last so a failed
 * run retries on the next view rather than latching the set as done.
 */
async function persistBricksetDetails(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  row: Record<string, unknown>,
): Promise<void> {
  const brickset = await fetchBricksetDetails(row.set_num as string, c.env).catch(() => null);
  if (!brickset) return;
  const updates: D1PreparedStatement[] = [];
  if (brickset.minifigs !== null && brickset.minifigs > 0 && !row.minifigs) {
    updates.push(c.env.DB.prepare('UPDATE lego_sets SET minifigs=? WHERE set_num=?').bind(brickset.minifigs, row.set_num));
  }
  if (brickset.retired === true && !row.retired) {
    updates.push(c.env.DB.prepare('UPDATE lego_sets SET retired=1 WHERE set_num=?').bind(row.set_num));
  }
  // Prefer official Brickset MSRP for retail_price (store it separately too).
  if (brickset.msrp) {
    updates.push(c.env.DB.prepare('UPDATE lego_sets SET retail_price=?, brickset_msrp=? WHERE set_num=?')
      .bind(brickset.msrp, brickset.msrp, row.set_num));
  }
  const meta: Record<string, unknown> = {};
  if (brickset.subtheme && !row.subtheme) meta.subtheme = brickset.subtheme;
  if (brickset.ageMin !== null && row.age_min == null) meta.age_min = brickset.ageMin;
  if (brickset.ageMax !== null && row.age_max == null) meta.age_max = brickset.ageMax;
  if (brickset.rating !== null) meta.brickset_rating = brickset.rating;
  if (brickset.reviewCount !== null) meta.brickset_review_count = brickset.reviewCount;
  if (brickset.retiredYear !== null && row.retired_year == null) meta.retired_year = brickset.retiredYear;
  if (brickset.launchDate && !row.launch_date) meta.launch_date = brickset.launchDate;
  if (brickset.exitDate && !row.exit_date) meta.exit_date = brickset.exitDate;
  if (brickset.themeGroup && !row.theme_group) meta.theme_group = brickset.themeGroup;
  if (brickset.category && !row.category) meta.category = brickset.category;
  if (brickset.tags && !row.brickset_tags) meta.brickset_tags = brickset.tags;
  if (brickset.dimensions && !row.brickset_dimensions) meta.brickset_dimensions = brickset.dimensions;
  if (brickset.packagingType && !row.packaging_type) meta.packaging_type = brickset.packagingType;
  if (brickset.instructionsCount !== null && row.instructions_count == null) meta.instructions_count = brickset.instructionsCount;
  if (brickset.additionalImageCount !== null && row.additional_image_count == null) meta.additional_image_count = brickset.additionalImageCount;
  if (brickset.description && !row.brickset_description) meta.brickset_description = brickset.description;
  if (brickset.setId !== null && row.brickset_set_id == null) meta.brickset_set_id = brickset.setId;
  if (Object.keys(meta).length) {
    const clauses = Object.keys(meta).map((k) => `${k}=?`).join(', ');
    updates.push(c.env.DB.prepare(`UPDATE lego_sets SET ${clauses} WHERE set_num=?`)
      .bind(...Object.values(meta), row.set_num));
  }
  updates.push(c.env.DB.prepare(`UPDATE lego_sets SET brickset_enriched_at=datetime('now') WHERE set_num=?`).bind(row.set_num));
  await c.env.DB.batch(updates).catch(() => {});
}

app.get('/:setnum', async (c) => {
  const setnum = c.req.param('setnum');
  const userId = c.get('userId');

  // lego_sets is at D1's 100-column ceiling, so `SELECT *` already returns ~100
  // columns. JOINing the set_market_ext columns into the same SELECT overflows
  // D1's 100-column RESULT-SET limit ("too many columns in result set"), so fetch
  // the extended market fields separately and merge them in.
  // Resolve the set and its "-1" variant in ONE query. The old form issued a
  // second round trip for every set number that lacks the suffix, which is the
  // common case from search results.
  let set = await c.env.DB.prepare(
    'SELECT * FROM lego_sets WHERE set_num IN (?1, ?2) ORDER BY (set_num <> ?1) LIMIT 1',
  ).bind(setnum, `${setnum}-1`).first<Record<string, unknown>>();

  if (set) {
    // This handler used to issue ~12 D1 queries strictly one after another, each
    // paying a full round trip, which is what made set detail the slowest page
    // (~1.1s p50, 2.3s max) — not row counts: every one of these is a keyed
    // lookup reading a handful of rows. They only ever depended on set_num and
    // userId, never on each other, so they now go out in one wave. Only the
    // retail offer genuinely depends on an earlier result (the user's market),
    // so it forms a second, smaller wave.
    const setNum = set.set_num as string;
    const [extRes, prefsRes, valuationRows, upcoming, entry, setMinifigsRes, trend, valueHistory] = await Promise.all([
      c.env.DB.prepare(
        'SELECT pc_loose_value, pc_sales_volume, pa_retail_value, pa_lowest_offer, pa_in_stock, pa_best_merchant, pa_offer_count, pa_market, stockx_ask, stockx_cached_at FROM set_market_ext WHERE set_num=?'
      ).bind(setNum).first<Record<string, unknown>>().catch(() => null),
      userId
        ? c.env.DB.prepare('SELECT retail_market FROM user_prefs WHERE user_id=?')
          .bind(userId).first<{ retail_market?: string }>().catch(() => null)
        : Promise.resolve(null),
      c.env.DB.prepare(`
        SELECT condition, fair_value, low, high, liquidation_value, confidence,
               confidence_score, sample_count, independent_family_count,
               basis_json, flags_json, forecast_json, as_of
        FROM set_valuation_state WHERE set_num=?
      `).bind(setNum).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] })),
      c.env.DB.prepare('SELECT price_usd FROM upcoming_sets WHERE set_num=?')
        .bind(setNum).first<{ price_usd: number | null }>().catch(() => null),
      userId
        ? c.env.DB.prepare('SELECT * FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL')
          .bind(userId, setNum).first().catch(() => null)
        : Promise.resolve(null),
      c.env.DB.prepare(
        'SELECT fig_num, quantity, fig_name, fig_img_url FROM set_minifigs WHERE set_num=? ORDER BY quantity DESC'
      ).bind(setNum).all<{ fig_num: string; quantity: number; fig_name: string; fig_img_url: string | null }>()
        .catch(() => ({ results: [] as Array<{ fig_num: string; quantity: number; fig_name: string; fig_img_url: string | null }> })),
      getCachedPriceTrend(setNum, c.env),
      recentValueMedian(c.env.DB, setNum).catch(() => undefined),
    ]);

    const ext = extRes;
    if (ext) set = { ...set, ...ext };
    const retailMarket = String(prefsRes?.retail_market || 'FR');
    const setMinifigs = setMinifigsRes.results ?? [];
    // Wave 2. Both of these need the user's market and nothing else, so they go
    // together — the Amazon lookup used to wait on the retail offer it is only
    // ever *compared against*.
    //
    // Amazon Creators offer — merged at READ TIME only. It lives in KV with a
    // <24h TTL (Associates terms forbid persisting/republishing prices), so it
    // can sharpen the live acquisition price but is never stored in D1 and
    // never becomes a valuation comp. Wins only when cheaper than (or the only)
    // stored retail offer.
    const [retailOffer, amOffer] = await Promise.all([
      c.env.DB.prepare(`
        SELECT market, currency, item_price, delivered_price, merchant, stock,
               offer_count, msrp, lowest_90d, all_time_low, checked_at, source
        FROM retail_price_current WHERE set_num=? AND market=?
      `).bind(setNum, retailMarket).first<Record<string, unknown>>().catch(() => null),
      getFreshAmazonOffer(c.env, setNum, amazonMarket(retailMarket, c.env)).catch(() => null),
    ]);
    if (retailOffer) set = { ...set, __retail_offer: retailOffer };
    if (amOffer) {
      const storedPrice = Number(retailOffer?.delivered_price ?? retailOffer?.item_price);
      if (!Number.isFinite(storedPrice) || storedPrice <= 0 || amOffer.price < storedPrice) {
        set = {
          ...set,
          __retail_offer: {
            market: amazonMarket(retailMarket, c.env),
            currency: amOffer.currency,
            item_price: amOffer.price,
            delivered_price: amOffer.price,
            merchant: 'Amazon',
            stock: amOffer.availability && /out/i.test(amOffer.availability) ? 'out_of_stock' : 'in_stock',
            offer_count: Number(retailOffer?.offer_count) || 1,
            msrp: retailOffer?.msrp ?? null,
            lowest_90d: retailOffer?.lowest_90d ?? null,
            all_time_low: retailOffer?.all_time_low ?? null,
            checked_at: amOffer.fetched_at,
            source: 'amazon',
          },
        };
      }
    }
    for (const valuationRow of valuationRows.results || []) {
      const parse = (value: unknown, fallback: unknown) => {
        try { return JSON.parse(String(value ?? '')); } catch { return fallback; }
      };
      const state = {
        condition: valuationRow.condition,
        fair_value: valuationRow.fair_value,
        low: valuationRow.low,
        high: valuationRow.high,
        liquidation_value: valuationRow.liquidation_value,
        confidence: valuationRow.confidence,
        confidence_score: valuationRow.confidence_score,
        sample_count: valuationRow.sample_count,
        independent_family_count: valuationRow.independent_family_count,
        basis: parse(valuationRow.basis_json, []),
        flags: parse(valuationRow.flags_json, []),
        as_of: valuationRow.as_of,
        model_version: 'v3',
      };
      if (valuationRow.condition === 'new_sealed') {
        set.__valuation_new = state;
        set.__valuation_forecast = parse(valuationRow.forecast_json, null);
      } else if (valuationRow.condition === 'used_complete') {
        set.__valuation_used = state;
      }
    }

    // Coming-soon: is this set in the upcoming/pre-release feed? If so it hasn't
    // launched yet — it must NOT read as "retiring soon", and its headline value
    // should be the announced retail (price_usd), not a formula market estimate.
    const comingSoon = !!upcoming;
    const upcomingPrice = upcoming?.price_usd ?? null;

    const activeSet = set;
    const resultSet: Record<string, unknown> = set;

    // Non-blocking/blocking BrickLink or Gemini refresh when price is missing or stale
    scheduleSetDetailRefresh(c, activeSet);

    // Brickset enrichment for a set we have never enriched (23% of the catalog).
    // A previous pass narrowed this from every request to only un-enriched sets;
    // it now moves OFF the response path entirely. It is a 200-500ms third-party
    // call whose whole purpose is to persist columns for next time — the guards
    // below only ever fill blanks, so the sole cost of deferring is that the
    // FIRST viewer of an un-enriched set sees the stored (possibly null) values
    // that the frontend already falls back to. Everyone after gets a fast
    // response AND the data. Matches how LEGO stock and minifig population in
    // this same handler already behave.
    if (!resultSet.brickset_enriched_at) {
      c.executionCtx.waitUntil(persistBricksetDetails(c, resultSet));
    }

    // Background LEGO.com stock check — runs for active sets not checked in 24h
    if (!resultSet.retired && (
      !resultSet.lego_checked_at ||
      new Date(resultSet.lego_checked_at as string) < new Date(Date.now() - 86_400_000)
    )) {
      c.executionCtx.waitUntil((async () => {
        const stock = await checkLegoStock(resultSet.set_num as string, c.env).catch(() => null);
        if (stock !== null) {
          await c.env.DB.prepare(
            `UPDATE lego_sets SET lego_in_stock=?, lego_retiring_soon=?, lego_availability=?, lego_checked_at=datetime('now') WHERE set_num=?`
          ).bind(stock.in_stock === null ? null : (stock.in_stock ? 1 : 0), stock.retiring_soon ? 1 : 0, stock.availability ?? null, resultSet.set_num).run();
        }
      })());
    }

    // Background minifig-set relationship population — runs once per set if Rebrickable key is set.
    // The "do we already have them?" check was its own COUNT(*) round trip on the
    // response path; the rows themselves are already in hand from wave 1, so their
    // length answers it for free.
    const minifigCount = Number(resultSet.minifigs ?? 0);
    if (minifigCount > 0 && c.env.REBRICKABLE_API_KEY) {
      if (!setMinifigs.length) {
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

    // set_minifigs, the trend and the trailing-history median were all fetched in
    // the opening wave above; `brickset` is null because enrichment now runs in
    // waitUntil (the frontend reads the persisted brickset_* columns on the set).
    return c.json({
      set: enrichSetRecord(
        { ...resultSet, retired: !!resultSet.retired, coming_soon: comingSoon, upcoming_price: upcomingPrice, trend, brickset: null },
        valueHistory,
      ),
      entry: entry || null,
      set_minifigs: setMinifigs,
    });
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
    console.warn('[sets/:setnum] Rebrickable lookup failed:', (e as Error).message);
    return c.json({ error: 'Could not load that set. Try again in a moment.' }, 500);
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

  // Rate limit the SERVER-key path only (BYOK bypasses) so a user can't loop the
  // shared OpenAI key for free — mirrors /advisor, /scan, /revalue. Atomic
  // increment+read (RETURNING) closes the read-after-write race.
  if (!c.req.header('X-Gemini-Key') && !c.req.header('X-OpenAI-Key')) {
    const LISTING_DRAFT_DAILY_LIMIT = 30;
    const dws = new Date(); dws.setHours(0, 0, 0, 0);
    const rl = await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'listing-draft', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
      RETURNING hit_count
    `).bind(userId, dws.toISOString()).first<{ hit_count: number }>();
    if ((rl?.hit_count ?? 0) > LISTING_DRAFT_DAILY_LIMIT) {
      return c.json({ error: `Rate limit: ${LISTING_DRAFT_DAILY_LIMIT} listing drafts per day. Add your own Gemini or OpenAI key in Settings for unlimited access.` }, 429);
    }
  }

  let draft: ListingDraft;
  try {
    draft = await generateListingDraft(c, set, entry);
  } catch {
    return c.json({ error: 'Could not generate listing. Check your AI key or try again later.' }, 500);
  }
  return c.json(draft);
});

// POST /api/sets/:setnum/revalue
app.post('/:setnum/revalue', requireMember, async (c) => {
  const userId = c.get('userId');
  const setnum = c.req.param('setnum');

  // Rate limiting: 5/hr for free users, 25/hr for supporters.
  const pref = await c.env.DB.prepare(
    'SELECT is_supporter FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ is_supporter: number }>();
  const REVALUE_LIMIT = pref?.is_supporter ? 25 : 5;

  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const ws = windowStart.toISOString();

  // Atomic increment+read (RETURNING) so two concurrent requests can't both slip
  // past the cap (the old increment-then-separate-SELECT had a check-after-write race).
  const rl = await c.env.DB.prepare(`
    INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
    VALUES (?, 'revalue', ?, 1)
    ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
    RETURNING hit_count
  `).bind(userId, ws).first<{ hit_count: number }>();

  if ((rl?.hit_count ?? 0) > REVALUE_LIMIT) {
    return c.json({ error: `Rate limit: ${REVALUE_LIMIT} revaluations per hour.` }, 429);
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

  // BrickEconomy values come from the stored be_* columns (Firecrawl-populated
  // by the brickeconomy-enrich cron) — no on-demand API call.
  const beDetails = beDetailsFromRow(set);

  if (beDetails?.current_value_new != null && c.env.BRICKLINK_CONSUMER_KEY) {
    // Stored BE value present — fetch BrickLink + eBay live alongside it to
    // populate bl_new_value for the price strip and cross-validate.
    const [blp, u, e] = await Promise.all([
      fetchSetPricing(set.set_num as string, c.env).catch(() => null),
      fetchUsedPricing(set.set_num as string, c.env).catch(() => null),
      fetchEbaySoldPrices(set.set_num as string, set.name as string, c.env).catch(() => null),
    ]);
    blPricing = blp;
    usedPricing = u || (beDetails.current_value_used ? { used_value: beDetails.current_value_used } : null);
    ebayPrices = e;

    if (isPlausibleMarketValue(beDetails.current_value_new, { retailPrice: set.retail_price as number, pieces: set.pieces as number, corroborators: [set.ebay_ask_value as number, blPricing?.current_value, set.bl_new_value as number] })) {
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
  // NB: be_cached_at / be_growth_12m are owned by the brickeconomy-enrich
  // Firecrawl cron — the set-detail path only READS the be_* columns.
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
      // Real 5-year forecast from the BrickEconomy scrape when present.
      if (beDetails.forecast_value_new_5_years !== null) {
        forecast_5y = beDetails.forecast_value_new_5_years;
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
