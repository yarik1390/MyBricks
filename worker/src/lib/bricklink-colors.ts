import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Rebrickable ↔ BrickLink color-id translation.
//
// Rebrickable and BrickLink use DIFFERENT color-numbering systems (e.g.
// Rebrickable Black = 0 but BrickLink Black = 11; Rebrickable White = 15 but
// BrickLink White = 1). Our set_parts rows carry Rebrickable color ids, so a
// BrickLink part-price lookup that passes the Rebrickable id straight through
// queries the WRONG color — returning a mispriced part or (usually) nothing.
//
// Rebrickable's colors API publishes each color's BrickLink id under
// external_ids.BrickLink.ext_ids, so we fetch that once (~200 colors, one page),
// cache it in KV + per-isolate memo, and translate before every BrickLink call.
// The part_prices table stays keyed on the Rebrickable color id (what the
// part-out compute joins on) — only the outbound BrickLink query is translated.
// ---------------------------------------------------------------------------

const KV_KEY = 'bl_color_map_v1';
const TTL_SECONDS = 30 * 24 * 60 * 60; // colors change ~never; refresh monthly

interface RbColor {
  id: number;
  external_ids?: { BrickLink?: { ext_ids?: number[] } };
}

let memo: Record<number, number> | null = null;

/** Pure: build a Rebrickable-id → BrickLink-id map from the colors API results. */
export function buildColorMap(results: RbColor[] | undefined | null): Record<number, number> {
  const map: Record<number, number> = {};
  for (const c of results ?? []) {
    const bl = c?.external_ids?.BrickLink?.ext_ids?.[0];
    if (typeof c?.id === 'number' && typeof bl === 'number') map[c.id] = bl;
  }
  return map;
}

/** Pure: resolve a Rebrickable color id against a (possibly missing) map.
 *  - map missing  → passthrough the input id (fail-open, preserves prior behavior)
 *  - id in map    → the BrickLink id
 *  - id not in map (known map) → null (this color has no BrickLink equivalent; skip) */
export function lookupBlColor(map: Record<number, number> | null, rbColorId: number): number | null {
  if (!map) return rbColorId;
  return rbColorId in map ? map[rbColorId] : null;
}

async function loadMap(env: Env): Promise<Record<number, number> | null> {
  if (memo) return memo;
  if (env.CACHE_KV) {
    try {
      const cached = await env.CACHE_KV.get(KV_KEY, 'json') as Record<number, number> | null;
      if (cached && Object.keys(cached).length) { memo = cached; return memo; }
    } catch { /* fall through to fetch */ }
  }
  if (!env.REBRICKABLE_API_KEY) return null;
  try {
    const resp = await fetch('https://rebrickable.com/api/v3/lego/colors/?page_size=1000', {
      headers: { Authorization: `key ${env.REBRICKABLE_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: RbColor[] };
    const map = buildColorMap(data.results);
    if (Object.keys(map).length) {
      memo = map;
      if (env.CACHE_KV) env.CACHE_KV.put(KV_KEY, JSON.stringify(map), { expirationTtl: TTL_SECONDS }).catch(() => {});
      return memo;
    }
  } catch { /* fail open */ }
  return null;
}

/** Translate a Rebrickable color id to its BrickLink equivalent for a price
 *  lookup. Returns null when the color has no BrickLink counterpart (skip it);
 *  fails open to the input id when the map can't be loaded (no regression). */
export async function toBrickLinkColorId(env: Env, rbColorId: number): Promise<number | null> {
  return lookupBlColor(await loadMap(env), rbColorId);
}

/** Test hook: reset the per-isolate memo. */
export function __resetColorMapForTests(): void {
  memo = null;
}
