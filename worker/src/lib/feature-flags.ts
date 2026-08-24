import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Runtime feature flags. Stored as one DB row (app_settings['feature_flags'], a
// JSON map of flag -> boolean) so an admin can flip a capability on/off from the
// console with NO code change or redeploy. These OVERRIDE the env-var defaults in
// pricing-flags.ts; an unset flag falls back to the env behavior. A prerequisite
// (a required token/key) is checked separately in pricing-flags and a flag can
// never conjure a missing secret — it only expresses intent.
//
// Leaf module: imports only the Env type, so pricing-flags and source-config can
// both depend on it without an import cycle. Reads fail-open (undefined override
// => use the env default) and are memoized per isolate for 60s.
// ---------------------------------------------------------------------------

export type FeatureFlag =
  | 'ebay_sold_comps'
  | 'brickowl'
  | 'brickinsights'
  | 'firecrawl'
  | 'stockx';

export const FEATURE_FLAGS: FeatureFlag[] = [
  'ebay_sold_comps',
  'brickowl',
  'brickinsights',
  'firecrawl',
  'stockx',
];

const FLAGS_KEY = 'feature_flags';
const MEMO_TTL_MS = 60_000;

let memo: Partial<Record<FeatureFlag, boolean>> | null = null;
let memoAt = 0;

// Sync override store for pricing-flags. Populated by applyFeatureFlags() at the
// start of each request / cron invocation (via applySourceConfig).
let overrides: Partial<Record<FeatureFlag, boolean>> = {};

/** Sync accessor: the runtime override for a flag, or undefined (use env default). */
export function flagOverride(name: FeatureFlag): boolean | undefined {
  return overrides[name];
}

function sanitize(raw: unknown): Partial<Record<FeatureFlag, boolean>> {
  const out: Partial<Record<FeatureFlag, boolean>> = {};
  if (raw && typeof raw === 'object') {
    for (const f of FEATURE_FLAGS) {
      const v = (raw as Record<string, unknown>)[f];
      if (typeof v === 'boolean') out[f] = v;
    }
  }
  return out;
}

/** Stored flag overrides (memoized 60s, fail-open to {}). */
export async function getFeatureFlags(env: Env): Promise<Partial<Record<FeatureFlag, boolean>>> {
  if (memo && Date.now() - memoAt < MEMO_TTL_MS) return memo;
  let stored: Partial<Record<FeatureFlag, boolean>> = {};
  try {
    const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key=?`)
      .bind(FLAGS_KEY).first<{ value: string }>();
    if (row?.value) stored = sanitize(JSON.parse(row.value));
  } catch { /* fail-open to no overrides */ }
  memo = stored;
  memoAt = Date.now();
  return memo;
}

/** Load the overrides into the sync store for this isolate. */
export async function applyFeatureFlags(env: Env): Promise<void> {
  overrides = await getFeatureFlags(env);
}

/** Admin write: validate + persist + refresh caches. Returns the saved map. */
export async function saveFeatureFlags(env: Env, incoming: unknown): Promise<Partial<Record<FeatureFlag, boolean>>> {
  const clean = sanitize(incoming);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=datetime('now')`,
  ).bind(FLAGS_KEY, JSON.stringify(clean)).run();
  memo = clean;
  memoAt = Date.now();
  overrides = clean;
  return clean;
}

/** Clear the per-isolate memo + sync store (tests / after an external write). */
export function clearFeatureFlagsCache(): void {
  memo = null;
  memoAt = 0;
  overrides = {};
}
