import type { Env } from '../types';
import { firecrawlScrape } from '../lib/firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { reserveQuota } from '../lib/api-quota';
import { recordIntegrationHealth } from '../lib/integration-health';

const BRICKSET_SCHEMA = {
  type: 'object',
  properties: {
    msrp_usd: { type: 'number', description: 'Original retail price in USD (MSRP)' },
    launch_date: { type: 'string', description: 'Release/launch date in YYYY-MM-DD format' },
    exit_date: { type: 'string', description: 'Retirement/discontinuation date in YYYY-MM-DD format' },
    theme_group: { type: 'string', description: 'Top-level theme group (e.g. "Licensed", "Action/Adventure")' },
    category: { type: 'string', description: 'Set category as listed on Brickset (e.g. "Normal", "Gift with purchase")' },
    subtheme: { type: 'string', description: 'Sub-theme within the main theme' },
    age_min: { type: 'number', description: 'Minimum recommended age' },
    age_max: { type: 'number', description: 'Maximum recommended age' },
    packaging_type: { type: 'string', description: 'Packaging format (e.g. "Box", "Polybag", "Foil pack")' },
    instructions_count: { type: 'number', description: 'Number of instruction booklets' },
    additional_image_count: { type: 'number', description: 'Count of additional/alternate images beyond the main image' },
    description: { type: 'string', description: 'Official set description or marketing copy' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Tags/labels associated with this set' },
    rating: { type: 'number', description: 'Average community rating out of 5' },
    review_count: { type: 'number', description: 'Number of user reviews' },
    brickset_set_id: { type: 'number', description: 'Brickset internal numeric set ID shown in the URL or page metadata' },
    dimensions: { type: 'string', description: 'Physical dimensions of the packaged set' },
  },
};

/**
 * Backfill Brickset enrichment data for sets whose brickset_enriched_at is
 * NULL or stale (>90 days). Scrapes brickset.com/sets/{setNum} pages via
 * Firecrawl structured extraction, populating the 19 brickset_* columns
 * without burning the Brickset API quota.
 *
 * Prioritises: un-enriched sets first, then modern sets (year DESC), then
 * owned/wishlisted sets ahead of the general catalog.
 */
export async function runBricksetEnrich(env: Env, options: { limit?: number } = {}) {
  if (!firecrawlEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl disabled or no key' };
  }

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 100)
    : 50;

  const grant = (await reserveQuota(env, { firecrawl: limit })).firecrawl ?? 0;
  if (grant <= 0) return { processed: 0, updated: 0, limit, skipped: 'firecrawl quota spent' };

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.year
    FROM lego_sets ls
    WHERE (ls.brickset_enriched_at IS NULL OR ls.brickset_enriched_at < datetime('now', '-90 days'))
      AND ls.year >= 2000
    ORDER BY
      CASE WHEN ls.brickset_enriched_at IS NULL THEN 0 ELSE 1 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.year, 0) DESC
    LIMIT ?
  `).bind(grant).all<{ set_num: string; year: number | null }>();

  if (!results.length) return { processed: 0, updated: 0, limit: grant };

  let processed = 0;
  let updated = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];

  for (const { set_num } of results) {
    processed++;
    const url = `https://brickset.com/sets/${set_num}`;

    const result = await firecrawlScrape<{
      msrp_usd?: number | null;
      launch_date?: string | null;
      exit_date?: string | null;
      theme_group?: string | null;
      category?: string | null;
      subtheme?: string | null;
      age_min?: number | null;
      age_max?: number | null;
      packaging_type?: string | null;
      instructions_count?: number | null;
      additional_image_count?: number | null;
      description?: string | null;
      tags?: string[] | null;
      rating?: number | null;
      review_count?: number | null;
      brickset_set_id?: number | null;
      dimensions?: string | null;
    }>(
      {
        url,
        formats: ['json'],
        jsonOptions: {
          schema: BRICKSET_SCHEMA,
          prompt: `Extract LEGO set details from this Brickset page for set ${set_num}. Extract all available fields: price, dates, theme/subtheme, age range, dimensions, packaging, description, ratings, and tags.`,
        },
        timeoutMs: 20_000,
      },
      env,
    );

    if (!result) {
      health.fail++;
      // Stamp enriched_at even on failure so we don't hammer a 404 every run.
      stmts.push(env.DB.prepare(
        `UPDATE lego_sets SET brickset_enriched_at=datetime('now') WHERE set_num=?`,
      ).bind(set_num));
      continue;
    }

    health.ok++;
    const d = result.data;

    // Build a sparse SET clause — only write non-null values to preserve any
    // existing data from the Brickset API path.
    const fields: string[] = [`brickset_enriched_at=datetime('now')`];
    const binds: (string | number | null)[] = [];

    const maybe = <T extends string | number | null>(col: string, val: T | undefined | null) => {
      if (val != null && val !== '') { fields.push(`${col}=?`); binds.push(val as string | number); }
    };

    maybe('brickset_msrp', d.msrp_usd);
    maybe('launch_date', d.launch_date);
    maybe('exit_date', d.exit_date);
    maybe('theme_group', d.theme_group);
    maybe('category', d.category);
    maybe('subtheme', d.subtheme);
    maybe('age_min', d.age_min);
    maybe('age_max', d.age_max);
    maybe('packaging_type', d.packaging_type);
    maybe('instructions_count', d.instructions_count);
    maybe('additional_image_count', d.additional_image_count);
    maybe('brickset_description', d.description);
    maybe('brickset_rating', d.rating);
    maybe('brickset_review_count', d.review_count);
    maybe('brickset_set_id', d.brickset_set_id);
    maybe('brickset_dimensions', d.dimensions);
    if (Array.isArray(d.tags) && d.tags.length) {
      fields.push('brickset_tags=?');
      binds.push(JSON.stringify(d.tags));
    }

    stmts.push(env.DB.prepare(
      `UPDATE lego_sets SET ${fields.join(', ')} WHERE set_num=?`,
    ).bind(...binds, set_num));
    updated++;
  }

  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }
  await recordIntegrationHealth(env, 'firecrawl', health);

  return { processed, updated, limit: grant };
}
