import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { meRoute } from './routes/me';
import { collectionRoute } from './routes/collection';
import { wishlistRoute } from './routes/wishlist';
import { setsRoute } from './routes/sets';
import { themesRoute } from './routes/themes';
import { minifigsRoute } from './routes/minifigs';
import { scanRoute } from './routes/scan';
import { adminRoute } from './routes/admin';
import { advisorRoute } from './routes/advisor';
import { profileRoute } from './routes/profile';
import { googleSyncRoute } from './routes/google-sync';
import { ratesRoute } from './routes/rates';
import { bricksetSyncRoute } from './routes/brickset-sync';
import { photosRoute } from './routes/photos';
import { imgRoute } from './routes/img';
import { pushRoute } from './routes/push';
import { bricklinkImportRoute } from './routes/bricklink-import';
import { buildRoute } from './routes/build';

import { runValuateSets, runValuateMinifigs, runEbayAskBackfill } from './jobs/valuate-sets';
import { runSnapshotPortfolios } from './jobs/snapshot-portfolios';
import { runSnapshotSetValues } from './jobs/snapshot-set-values';
import { runPartPriceBackfill } from './jobs/part-price-backfill';
import { runPartOutCompute } from './jobs/part-out-compute';
import { runWishlistAlerts } from './jobs/wishlist-alerts';
import { runDailyCatalogMaintenance } from './jobs/catalog-maintenance';
import { runDbHygiene } from './jobs/db-hygiene';
import { importSets, importFigs } from './jobs/import-catalog';
import { runBrickInsightsBackfill } from './jobs/brickinsights';
import { runEbaySoldScrape } from './jobs/ebay-sold-scrape';
import { runUpcItemDbBackfill } from './jobs/upcitemdb-backfill';
import { runLegoStockRefresh } from './jobs/lego-stock-refresh';
import { runBricksetEnrich } from './jobs/brickset-enrich';
import { runBrickEconomyEnrich } from './jobs/brickeconomy-enrich';

import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Browser origins we reflect for CORS. Restricted to localhost (dev) and this
// project's own Cloudflare Pages deployments: the production alias and its
// preview deployments, which all live under the `brickvault-5ub.pages.dev`
// subdomain. (The previous `*.pages.dev` check reflected EVERY Cloudflare Pages
// tenant's origin — an over-broad CORS surface; tightened per the security
// audit follow-up.)
const PROD_ORIGIN = 'https://brickvault-5ub.pages.dev';
const isAllowedOrigin = (origin: string): boolean =>
  origin.startsWith('http://localhost:') ||
  origin.startsWith('http://127.0.0.1:') ||
  origin === PROD_ORIGIN ||
  origin.endsWith('.brickvault-5ub.pages.dev');

app.use('*', cors({
  origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : PROD_ORIGIN),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Gemini-Key', 'X-OpenAI-Key', 'cf-turnstile-token'],
}));

// Public, anonymous catalog GETs (sets / themes / minifigs / rates / config) are
// shared reference data that only changes on the hourly cron, so let browsers,
// proxies and the edge cache them briefly instead of forcing a D1 round-trip on
// every view. Any authenticated request (Authorization present), any mutation,
// and every non-catalog path (/api/me, /api/collection, /api/admin, ...) keep
// the hard no-store. We set Vary: Authorization (so a shared cache can never
// hand an anonymous-cached body to a signed-in request) and let the CORS
// middleware append Origin itself — setting "Origin, Authorization" here
// produced a duplicate "Origin" token once CORS appended its own.
const PUBLIC_CACHEABLE_GET = /^\/api\/(sets|themes|minifigs|rates|config)(?:\/|$)/;

app.use('*', async (c, next) => {
  await next();
  const publicCacheableGet =
    c.req.method === 'GET' &&
    !c.req.header('authorization') &&
    c.res.status === 200 &&
    PUBLIC_CACHEABLE_GET.test(new URL(c.req.url).pathname);
  if (publicCacheableGet) {
    c.header('Cache-Control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=600');
    c.header('Vary', 'Authorization');
  } else {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    c.header('Pragma', 'no-cache');
    c.header('Expires', '0');
  }
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
});

// Public config for the frontend (Supabase URL + anon key are client-safe)
app.get('/api/config', (c) => {
  const missing = (entries: Array<[string, string | undefined]>) => entries
    .filter(([, value]) => !value || value.includes('dummy'))
    .map(([name]) => name);
  const googleMissing = missing([
    ['GOOGLE_CLIENT_ID', c.env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', c.env.GOOGLE_CLIENT_SECRET],
  ]);
  const ebayMissing = missing([
    ['EBAY_APP_ID', c.env.EBAY_APP_ID],
    ['EBAY_CLIENT_SECRET', c.env.EBAY_CLIENT_SECRET],
  ]);
  const pushMissing = missing([
    ['VAPID_PUBLIC_KEY', c.env.VAPID_PUBLIC_KEY],
    ['VAPID_PRIVATE_KEY', c.env.VAPID_PRIVATE_KEY],
    ['VAPID_SUBJECT', c.env.VAPID_SUBJECT],
  ]);
  const geminiMissing = missing([['GEMINI_API_KEY', c.env.GEMINI_API_KEY]]);
  const emailMissing = missing([['RESEND_API_KEY', c.env.RESEND_API_KEY]]);
  const status = {
    supabase: !!(c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY && c.env.SUPABASE_JWT_SECRET),
    d1: !!c.env.DB,
    openai: !!c.env.OPENAI_API_KEY,
    gemini: geminiMissing.length === 0,
    email: emailMissing.length === 0,
    push: pushMissing.length === 0,
    google: googleMissing.length === 0,
    ebay: ebayMissing.length === 0,
    bricklink: !!(c.env.BRICKLINK_CONSUMER_KEY && c.env.BRICKLINK_TOKEN),
    brickeconomy: !!c.env.BRICKECONOMY_API_KEY,
    brickset: !!c.env.BRICKSET_API_KEY,
    brickowl: !!c.env.BRICKOWL_API_KEY,
    rebrickable: !!c.env.REBRICKABLE_API_KEY,
    firecrawl: !!c.env.FIRECRAWL_API_KEY,
    turnstile: !!c.env.TURNSTILE_SITE_KEY,
  };
  return c.json({
    supabase_url: c.env.SUPABASE_URL,
    supabase_anon_key: c.env.SUPABASE_ANON_KEY,
    api_base: new URL(c.req.url).origin,
    // Public Turnstile site key (safe to expose). When present, the scanner adds
    // a Turnstile token to shared server-key scans; null leaves scanning as-is.
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
    status,
    setup: {
      google: {
        configured: googleMissing.length === 0,
        missing_secrets: googleMissing,
        recommended_action: googleMissing.length
          ? `Add ${googleMissing.join(' and ')} as GitHub Actions secrets; the deploy workflow uploads them to Worker secrets.`
          : 'Google Sheets OAuth is ready.',
      },
      ebay: {
        configured: ebayMissing.length === 0,
        missing_secrets: ebayMissing,
        recommended_action: ebayMissing.length
          ? `Add ${ebayMissing.join(' and ')} as GitHub Actions secrets; eBay sold comps stay disabled until both are present.`
          : 'eBay US/USD sold comps are ready.',
      },
      gemini: {
        configured: geminiMissing.length === 0,
        missing_secrets: geminiMissing,
        recommended_action: geminiMissing.length
          ? 'Add GEMINI_API_KEY as a GitHub Actions secret to enable server-side Gemini fallback; user BYOK Gemini keys still work without it.'
          : 'Server-side Gemini fallback is ready.',
      },
      email: {
        configured: emailMissing.length === 0,
        missing_secrets: emailMissing,
        recommended_action: emailMissing.length
          ? 'Add RESEND_API_KEY as a GitHub Actions secret to enable email wishlist alerts.'
          : 'Email wishlist alerts are ready.',
      },
      push: {
        configured: pushMissing.length === 0,
        missing_secrets: pushMissing,
        recommended_action: pushMissing.length
          ? `Add ${pushMissing.join(', ')} as GitHub Actions secrets to enable browser push alerts.`
          : 'Browser push alerts are ready.',
      },
    },
  });
});

app.route('/api/me', meRoute);
app.route('/api/collection', collectionRoute);
app.route('/api/wishlist', wishlistRoute);
app.route('/api/sets', setsRoute);
app.route('/api/themes', themesRoute);
app.route('/api/minifigs', minifigsRoute);
app.route('/api/scan', scanRoute);
app.route('/api/admin', adminRoute);
app.route('/api/advisor', advisorRoute);
app.route('/api/users', profileRoute);
app.route('/api/google', googleSyncRoute);
app.route('/api/rates', ratesRoute);
app.route('/api/brickset', bricksetSyncRoute);
app.route('/api/collection', photosRoute);
app.route('/api/push', pushRoute);
app.route('/api/bricklink', bricklinkImportRoute);
app.route('/api/build', buildRoute);
// Public image proxy (no auth — images load via <img src>). R2-backed + edge-cached.
app.route('/api/img', imgRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try { await fn(); }
      catch (e) { console.error(`[cron] ${name} failed:`, (e as Error).message); }
    };
    switch (event.cron) {
      // Hourly: BrickLink-primary catalog sweep. scope:'all' so idle capacity
      // (once owned/wishlisted are fresh) steadily converts the formula_bulk
      // catalog to real market prices. BrickEconomy is rationed by the daily
      // ledger (80/day) and BrickLink (4000/day) carries the rest. On Workers
      // Paid the packer can fit a much larger batch under the 1,000-subrequest
      // cap, so we lift the per-run limit to 80 (was the ~5 the free 50-cap
      // allowed); reserveQuota gates it to the remaining daily BrickLink budget
      // (~80/run × 24h ≈ within 4,000/day). Source-light (no supplemental/eBay/
      // AI) to maximize sets/run; those run in daily maintenance + on-demand.
      case '0 * * * *': {
        // Pass 1 — user-visible slice. Fan out every working source
        // (BrickLink, BrickEconomy, BrickOwl, eBay *ask*, AI fallback) over
        // owned/wishlisted sets still on a formula/stale value so the sets
        // users actually see get real-market coverage within the hour.
        // eBay sold-comps stays OFF (includeEbaySold:false — needs Marketplace
        // Insights approval); the basic-scope Browse ask runs regardless. The
        // slice is tiny and prioritized, so its own subrequest budget bounds it.
        await run('valuate-owned-deep', () => runValuateSets(env, {
          scope: 'owned',
          limit: 14,
          includeSupplemental: true,
          includeEbay: true,
          includeEbaySold: false,
          includeAiFallback: true,
          subrequestBudget: 240,
        }));
        // Pass 2 — catalog sweep. BrickLink-primary, source-light; idle
        // capacity steadily converts the formula_bulk catalog to real prices.
        // Capped budget so both passes share one invocation's subrequest cap.
        await run('valuate-sets', () => runValuateSets(env, {
          scope: 'all',
          limit: 80,
          includeSupplemental: false,
          includeEbay: false,
          includeAiFallback: false,
          subrequestBudget: 360,
        }));
        // Pass 3 — eBay ASK backfill (Browse basic scope; sold stays off).
        // Refreshes the free active-listing ask signal for ask-stale sets
        // (owned/wishlist + retired first), feeding the persisted blended
        // value. Small + bounded so all three passes fit one invocation's
        // subrequest cap; the eBay daily quota is wide open.
        await run('valuate-ebay-ask', () => runEbayAskBackfill(env, { limit: 40 }));
        // Pass 4 — high-value freshness. Real (non-formula) market values
        // worth >= $150 that have gone stale/expired, refreshed most-valuable
        // first so the visible top of the catalog (and the Value sort) reads
        // "Market price", not "Older price". reserveQuota shares the daily
        // BrickLink/BE budget; the pass self-tapers as the head gets fresh.
        await run('valuate-topvalue', () => runValuateSets(env, {
          scope: 'all',
          prioritizeValue: true,
          minValue: 150,
          limit: 30,
          includeSupplemental: true,
          includeEbay: true,
          includeEbaySold: false,
          includeAiFallback: false,
          subrequestBudget: 320,
        }));
        break;
      }
      case '0 2 * * *': await run('snapshot-portfolios', () => runSnapshotPortfolios(env)); break;
      case '0 3 * * *': await run('snapshot-set-values', () => runSnapshotSetValues(env)); break;
      case '0 8 * * *': await run('wishlist-alerts', () => runWishlistAlerts(env)); break;
      // Small UPCitemdb barcode trickle hourly (a few spaced searches/run) — a
      // 2nd barcode source for missing modern retail sets, gentle on the trial's
      // per-window rate limit. Auto-scales if UPCITEMDB_USER_KEY is set.
      case '30 * * * *': await run('upcitemdb-backfill', () => runUpcItemDbBackfill(env, { limit: 4 })); break;
      // Formula-head value converter, hourly at :15 — converts the high-value
      // formula ESTIMATE head (>= $50, value-first, not tried in 3d) to real
      // BrickLink/BE market values using idle BrickLink budget. No AI fallback
      // (keep the formula value if no market data; retry later). Complements
      // Pass 4, which refreshes already-real values.
      case '15 * * * *': await run('valuate-formula-head', () => runValuateSets(env, {
        scope: 'all', formulaHead: true, minValue: 50, limit: 40,
        includeSupplemental: false, includeEbay: false, includeAiFallback: false,
        subrequestBudget: 300,
      })); break;
      // Daily maintenance is split across dedicated slots (Workers Paid: 250-cron
      // cap) so each heavy job runs in its own invocation — own subrequest budget
      // and failure isolation, and each can do more than the old packed 0 4 slot.
      case '0 5 * * *': await run('valuate-minifigs', () => runValuateMinifigs(env, { limit: 80 })); break;
      case '0 6 * * *': await run('brickinsights-ratings', () => runBrickInsightsBackfill(env, { limit: 80 })); break;
      case '0 7 * * *': await run('ebay-sold-scrape', () => runEbaySoldScrape(env, { limit: 30 })); break;
      // Phase-2 lean cadence (ongoing Firecrawl ~25k/mo budget): brickset is
      // mostly-static metadata (trimmed 50->30); LEGO stock is scoped to active
      // owned/wishlisted on a 14-day cycle inside the job (trimmed 100->40, it
      // self-tapers); brickeconomy refreshes/new-sets stay at 40. Ongoing value
      // freshness rides on the free APIs (BrickLink/eBay/BrickOwl), not Firecrawl.
      case '0 9 * * *': await run('brickset-enrich', () => runBricksetEnrich(env, { limit: 30 })); break;
      case '0 10 * * *': await run('lego-stock-refresh', () => runLegoStockRefresh(env, { limit: 40 })); break;
      case '0 11 * * *': await run('brickeconomy-enrich', () => runBrickEconomyEnrich(env, { limit: 40 })); break;
      // Part-out (E1): trickle the shared part_prices cache from BrickLink's NEW
      // price guide, most-shared parts first. Budget-gated (reserveQuota shares
      // the BrickLink cap; never starves valuations). limit 150 → ~150 parts/day.
      case '0 12 * * *': await run('part-price-backfill', () => runPartPriceBackfill(env, { limit: 150 })); break;
      // Part-out (E1): recompute sum-of-parts value from the part_prices cache an
      // hour after the price trickle. Pure D1 (no quota); rolling 7-day refresh.
      case '0 13 * * *': await run('part-out-compute', () => runPartOutCompute(env, { limit: 120 })); break;
      // TEMPORARY one-time bootstrap: fill be_value_new across the year>=2000
      // catalog (~22.4k sets). Runs 4x/hour at limit 150 (concurrency 5); the
      // total spend self-limits at ~112k credits (one scrape per set) and the
      // per-day rate is gated by FIRECRAWL_DAILY_CREDITS. REMOVE this trigger +
      // reset FIRECRAWL_DAILY_CREDITS once be_value_new is filled.
      case '5,20,35,50 * * * *': await run('be-bootstrap', () => runBrickEconomyEnrich(env, { limit: 150, concurrency: 5 })); break;
      case '0 4 * * *': {
        await run('db-hygiene', () => runDbHygiene(env));
        await run('daily-catalog-maintenance', () => runDailyCatalogMaintenance(env));
        const isSunday = new Date(event.scheduledTime).getUTCDay() === 0;
        if (!isSunday) break;
        await run('weekly-import-sets', () => importSets(env.DB, env));
        await run('weekly-import-figs', () => importFigs(env.DB, env));
        break;
      }
    }
  },
};
