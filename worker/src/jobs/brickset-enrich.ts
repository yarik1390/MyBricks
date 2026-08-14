import type { Env } from '../types';
import { firecrawlScrape } from '../lib/firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';
import { quotaRemaining } from '../lib/api-quota';
import { brightDataUnlock } from '../lib/brightdata';
import { brightDataEnabled } from '../lib/brightdata-keys';
import { parseBricksetHtml, type BricksetScrape } from '../lib/brightdata-parsers';
import { scrapingAntEnabled, scrapingAntFetchHtml } from '../lib/scrapingant';

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

// Plausibility gates for scraped Brickset values — the LLM extraction can
// occasionally grab the wrong number (e.g. a piece count as the price, or a free
// gift-with-purchase $0 MSRP), so each numeric/date field is range-checked before
// it's written. Out-of-range values are dropped so they can't corrupt downstream
// valuations (brickset_msrp can feed retail_price, a plausibility corroborator).
const inRange = (v: unknown, min: number, max: number): number | null =>
  (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const intInRange = (v: unknown, min: number, max: number): number | null => {
  const n = inRange(v, min, max);
  return n == null ? null : Math.round(n);
};
const plausibleDate = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  return y >= 1949 && y <= 2035 ? s : null;
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
  const hasScrapingAnt = (await sourceEnabled(env, 'scrapingant')) && scrapingAntEnabled(env);
  const hasBrightData = (await sourceEnabled(env, 'brightdata')) && brightDataEnabled(env);
  const hasFirecrawl = (await sourceEnabled(env, 'firecrawl')) && firecrawlEnabled(env);
  if (!hasScrapingAnt && !hasBrightData && !hasFirecrawl) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'ScrapingAnt, Bright Data, and Firecrawl disabled or unconfigured' };
  }

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 100)
    : 50;

  // Size to remaining daily credits WITHOUT reserving — the per-scrape guard in
  // firecrawlScrape is the sole real-credit meter (worst-case 5cr/json divisor).
  const remaining = await quotaRemaining(env, 'firecrawl');
  if (!hasScrapingAnt && !hasBrightData && remaining < 5) return { processed: 0, updated: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
  const effLimit = (hasScrapingAnt || hasBrightData) ? limit : Math.min(limit, Math.floor(remaining / 5));

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.year, ls.brickset_enriched_at
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
  `).bind(effLimit).all<{ set_num: string; year: number | null; brickset_enriched_at: string | null }>();

  if (!results.length) return { processed: 0, updated: 0, limit: effLimit };

  let processed = 0;
  let updated = 0;
  let unchanged = 0;
  const stmts: D1PreparedStatement[] = [];

  for (const { set_num, brickset_enriched_at } of results) {
    processed++;
    const url = `https://brickset.com/sets/${set_num}`;

    // Refresh of an already-enriched set: a cheap (1-credit) change-tracking
    // probe first. Brickset metadata is static, so most refreshes are unchanged
    // → skip the 5-credit json re-extract and just refresh freshness. New sets
    // extract directly; changed/new/removed/probe-failure all fall through to a
    // full extract. (Only applied here — BrickEconomy values, LEGO stock and eBay
    // listings change between scrapes, so a probe there would just add cost.)
    if (!hasScrapingAnt && !hasBrightData && hasFirecrawl && brickset_enriched_at) {
      const probe = await firecrawlScrape<{ changeTracking?: { changeStatus?: string } }>(
        { url, formats: ['markdown', 'changeTracking'], timeoutMs: 20_000 },
        env,
      );
      if (probe?.data?.changeTracking?.changeStatus === 'same') {
        stmts.push(env.DB.prepare(
          `UPDATE lego_sets SET brickset_enriched_at=datetime('now') WHERE set_num=?`,
        ).bind(set_num));
        unchanged++;
        continue;
      }
    }

    let data: BricksetScrape | null = null;
    if (hasScrapingAnt) {
      const html = await scrapingAntFetchHtml(url, env, { timeoutMs: 20_000 });
      if (html) data = parseBricksetHtml(html);
    }
    if (!data && hasBrightData) {
      const html = await brightDataUnlock(url, env, { timeoutMs: 20_000 });
      if (html) data = parseBricksetHtml(html);
    }

    const result = (data || !hasFirecrawl) ? null : await firecrawlScrape<{
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

    if (!data && !result) {
      // A null result is a provider/network failure, not verified no-data.
      // Leave freshness untouched so the next run can retry after recovery.
      continue;
    }

    const d = data ?? result!.data;

    // Build a sparse SET clause — only write non-null values to preserve any
    // existing data from the Brickset API path.
    const fields: string[] = [`brickset_enriched_at=datetime('now')`];
    const binds: (string | number | null)[] = [];

    const maybe = <T extends string | number | null>(col: string, val: T | undefined | null) => {
      if (val != null && val !== '') { fields.push(`${col}=?`); binds.push(val as string | number); }
    };

    const msrp = inRange(d.msrp_usd, 1, 2000);
    maybe('brickset_msrp', msrp);
    // Also seed the canonical ROI field (retail_price) when it has no real value
    // yet — the cron used to fill brickset_msrp only, leaving retail_price null so
    // ROI/discount math fell back to estimates. COALESCE never clobbers an existing
    // (market-derived) retail.
    if (msrp != null) { fields.push('retail_price=COALESCE(retail_price, ?)'); binds.push(msrp); }
    maybe('launch_date', plausibleDate(d.launch_date));
    maybe('exit_date', plausibleDate(d.exit_date));
    maybe('theme_group', d.theme_group);
    maybe('category', d.category);
    maybe('subtheme', d.subtheme);
    maybe('age_min', intInRange(d.age_min, 0, 99));
    maybe('age_max', intInRange(d.age_max, 0, 99));
    maybe('packaging_type', d.packaging_type);
    maybe('instructions_count', intInRange(d.instructions_count, 0, 100));
    maybe('additional_image_count', intInRange(d.additional_image_count, 0, 2000));
    maybe('brickset_description', d.description);
    maybe('brickset_rating', inRange(d.rating, 0, 5));
    maybe('brickset_review_count', intInRange(d.review_count, 0, 1_000_000));
    maybe('brickset_set_id', intInRange(d.brickset_set_id, 1, 100_000_000));
    maybe('brickset_dimensions', d.dimensions);
    if (Array.isArray(d.tags) && d.tags.length) {
      // Scraped tags can carry a "|x" metadata suffix ("Harry Potter|n") that
      // must never reach the UI — store the bare label.
      const tags = d.tags.map((t) => String(t).split('|')[0].trim()).filter(Boolean);
      if (tags.length) {
        fields.push('brickset_tags=?');
        binds.push(JSON.stringify(tags));
      }
    }

    stmts.push(env.DB.prepare(
      `UPDATE lego_sets SET ${fields.join(', ')} WHERE set_num=?`,
    ).bind(...binds, set_num));
    updated++;
  }

  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }
  // No aggregate health write — firecrawlScrape records each scrape attempt
  // (real ok/fail + error message) inside the wrapper; a batch tally here would
  // double-count and clobber the real error with "unknown error".
  return { processed, updated, unchanged, limit: effLimit };
}
