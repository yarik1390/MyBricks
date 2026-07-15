import { Hono } from 'hono';
import { CATALOG_COLS, MARKET_EXT_JOIN, attachCatalogValuationState } from './sets-sql';
import { enrichSetRecord } from '../lib/market-sources';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Compact seed catalog for OFFLINE use. The native app bundles public/, so a
// snapshot of this endpoint (public/data/seed-catalog.json, generated at build
// time by scripts/gen-seed-catalog.mjs) ships INSIDE the app — a fresh install
// with no network can still browse/search the top sets. Public: no user data,
// just catalog rows the /search endpoint already exposes to guests.
//
// Only the fields the catalog card + basic offline detail render are kept, so
// the payload stays small (~200 bytes/set gzipped). Everything else still
// resolves online and caches per-view as it does today.
const SEED_FIELDS = [
  'set_num', 'name', 'year', 'theme', 'subtheme', 'pieces', 'minifigs',
  'image_url', 'retired', 'retirement_risk_score', 'lego_retiring_soon',
  'market_value', 'market_value_confidence', 'retail_price',
  'forecast_2y', 'forecast_5y', 'deal_signal', 'deal_strong', 'deal_discount_pct',
] as const;

const DEFAULT_LIMIT = 2000;
const MAX_PAGE = 5000; // per-request cap; the generator pages through with offset for the full catalog.
const KV_TTL = 86_400; // 24h — the catalog head moves slowly; the build snapshot is the real cache.

function pick(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SEED_FIELDS) {
    const v = row[k];
    // Drop null/0/empty to shrink the payload; the client treats missing as absent.
    if (v !== null && v !== undefined && v !== 0 && v !== '') out[k] = v;
  }
  // Guarantee a display value offline: the blend can return null when a row has
  // no live price signals, so fall back to the persisted blended/current value.
  if (out.market_value == null) {
    const fallback = Number(row.blended_value) || Number(row.current_value) || 0;
    if (fallback > 0) out.market_value = fallback;
  }
  return out;
}

app.get('/seed', async (c) => {
  const requested = Number(c.req.query('limit'));
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_PAGE)
    : DEFAULT_LIMIT;
  const requestedOffset = Number(c.req.query('offset'));
  const offset = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset) : 0;

  // v3 invalidates seed pages cached before PriceCharting quarantine became a
  // mandatory read-path override. Android builds must never bundle those
  // legacy values for offline use.
  const kvKey = `catalog:seed:v3:${limit}:${offset}`;
  const kv = c.env.CACHE_KV;
  if (kv) {
    const cached = await kv.get(kvKey);
    if (cached) {
      const etag = `"seed-${limit}-${offset}-${cached.length}"`;
      if (c.req.header('if-none-match') === etag) return c.body(null, 304);
      c.header('ETag', etag);
      c.header('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      c.header('Content-Type', 'application/json');
      return c.body(cached);
    }
  }

  // Sets by market value, image-backed — value DESC so the "head" (the sets
  // people actually browse) comes first; set_num tiebreak makes the ordering
  // deterministic so offset pagination is stable across pages during a build.
  // enrichSetRecord derives market_value etc. exactly as /search does, so seed
  // rows are drop-in for the catalog card.
  const { results } = await c.env.DB.prepare(
    `SELECT ${CATALOG_COLS} FROM lego_sets s ${MARKET_EXT_JOIN}
     WHERE s.image_url IS NOT NULL
     ORDER BY COALESCE(NULLIF(s.blended_value, 0), s.current_value, 0) DESC, s.set_num
     LIMIT ? OFFSET ?`,
  ).bind(limit, offset).all<Record<string, unknown>>();

  const sets = (results || []).map((r) => pick(enrichSetRecord(attachCatalogValuationState({ ...r, retired: !!r.retired }))));
  const body = JSON.stringify({ generated_at: new Date().toISOString(), count: sets.length, offset, sets });

  if (kv) c.executionCtx.waitUntil(kv.put(kvKey, body, { expirationTtl: KV_TTL }));
  const etag = `"seed-${limit}-${offset}-${body.length}"`;
  c.header('ETag', etag);
  c.header('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  c.header('Content-Type', 'application/json');
  return c.body(body);
});

export { app as catalogSeedRoute };
