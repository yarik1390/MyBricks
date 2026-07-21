import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { meRoute } from './routes/me';
import { collectionRoute } from './routes/collection';
import { wishlistRoute } from './routes/wishlist';
import { setsRoute } from './routes/sets';
import { catalogSeedRoute } from './routes/catalog-seed';
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
import { gameRoute } from './routes/game';
import { contributionsRoute } from './routes/contributions';
import { imgRoute } from './routes/img';
import { rewriteImages } from './lib/img-proxy';
import { runImagePrewarm } from './jobs/image-prewarm';
import { runUpcomingRefresh } from './jobs/upcoming-refresh';
import { upcomingRoute } from './routes/upcoming';
import type { MiddlewareHandler } from 'hono';
import { pushRoute } from './routes/push';
import { firebasePushConfigured } from './lib/firebase-push';
import { bricklinkImportRoute } from './routes/bricklink-import';
import { buildRoute } from './routes/build';
import { stripeRoute } from './routes/stripe';
import { revenuecatRoute } from './routes/revenuecat';

import { runValuateSets, runValuateMinifigs, runEbayAskBackfill } from './jobs/valuate-sets';
import { runSnapshotPortfolios } from './jobs/snapshot-portfolios';
import { runSnapshotSetValues, detectValueMovers } from './jobs/snapshot-set-values';
import { runModelRefresh } from './jobs/model-refresh';
import { runPartPriceBackfill } from './jobs/part-price-backfill';
import { runPartOutCompute } from './jobs/part-out-compute';
import { runWishlistAlerts } from './jobs/wishlist-alerts';
import { runWeeklyDigest } from './jobs/weekly-digest';
import { runCollectionBackups } from './jobs/collection-backups';
import { runDailyCatalogMaintenance } from './jobs/catalog-maintenance';
import { runDbHygiene } from './jobs/db-hygiene';
import { runAmazonOffers } from './jobs/amazon-offers';
import { runPriceChartingVerify } from './jobs/pricecharting-verify';
import { runPriceChartingEnrich } from './jobs/pricecharting-enrich';
import { runCommunityComps } from './jobs/community-comps';
import { runMinifigVerify } from './jobs/minifig-verify';
import { runPriceChartingBulkFetch } from './jobs/pricecharting-bulk';
import { importSets, importFigs } from './jobs/import-catalog';
import { runBrickInsightsBackfill } from './jobs/brickinsights';
import { runEbaySoldScrape } from './jobs/ebay-sold-scrape';
import { runStockXEnrich } from './jobs/stockx-enrich';
import { runUpcItemDbBackfill } from './jobs/upcitemdb-backfill';
import { runLegoStockRefresh } from './jobs/lego-stock-refresh';
import { runBricksetEnrich } from './jobs/brickset-enrich';
import { runBrickEconomyEnrich } from './jobs/brickeconomy-enrich';
import { runPricesApiRetail } from './jobs/pricesapi-retail';
import { runBlendRecomputeBackfill } from './jobs/recompute-blends';
import { applySourceConfig } from './lib/source-config';
import { recordCronStart, recordCronFinish, summarizeResult, isCronRunning } from './lib/cron-runs';
import { amazonReadiness } from './lib/amazon';
import { CLIENT_EVENTS, logClientEvent, mirrorClientMetric } from './lib/analytics';
import { setPricingV3ReadPercent } from './lib/market-sources';

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
  origin === 'https://localhost' ||
  origin === 'capacitor://localhost' ||
  origin === PROD_ORIGIN ||
  origin.endsWith('.brickvault-5ub.pages.dev');

app.use('*', cors({
  origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : PROD_ORIGIN),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Gemini-Key', 'X-OpenAI-Key', 'X-Brickvault-Platform', 'cf-turnstile-token'],
}));

app.use('*', async (c, next) => {
  setPricingV3ReadPercent(c.env.PRICING_V3_READ_PERCENT);
  await next();
});

// Public, anonymous catalog GETs (sets / themes / minifigs / rates / config) are
// shared reference data that only changes on the hourly cron, so let browsers,
// proxies and the edge cache them briefly instead of forcing a D1 round-trip on
// every view. Any authenticated request (Authorization present), any mutation,
// and every non-catalog path (/api/me, /api/collection, /api/admin, ...) keep
// the hard no-store. We set Vary: Authorization (so a shared cache can never
// hand an anonymous-cached body to a signed-in request) and let the CORS
// middleware append Origin itself — setting "Origin, Authorization" here
// produced a duplicate "Origin" token once CORS appended its own.
// users/leaderboard + users/:handle/profile are public GROUP-BY aggregations —
// cacheable for the same short window so they can't be hammered per-request.
const PUBLIC_CACHEABLE_GET = /^\/api\/(sets|themes|minifigs|rates|config|users\/leaderboard|users\/[^/]+\/profile)(?:\/|$)/;

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

// Client telemetry: anonymous, sampled client-side, event names allowlisted,
// detail capped at 120 chars, no user identifiers. Fire-and-forget on the
// client; a 204 either way so the endpoint can't be used as an oracle.
app.post('/api/telemetry', async (c) => {
  try {
    const body = await c.req.json<{ e?: string; d?: string }>();
    const event = String(body.e || '');
    if (CLIENT_EVENTS.has(event)) {
      const detail = String(body.d || '');
      logClientEvent(c.env, event, detail);
      c.executionCtx.waitUntil(mirrorClientMetric(c.env, event, detail));
    }
  } catch { /* ignore malformed */ }
  return c.body(null, 204);
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
  const nativePushMissing = firebasePushConfigured(c.env) ? [] : ['FIREBASE_SERVICE_ACCOUNT_JSON'];
  const geminiMissing = missing([['GEMINI_API_KEY', c.env.GEMINI_API_KEY]]);
  const emailMissing = missing([['RESEND_API_KEY', c.env.RESEND_API_KEY]]);
  const status = {
    supabase: !!(c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY && c.env.SUPABASE_JWT_SECRET),
    d1: !!c.env.DB,
    // Usage analytics (logEvent). The deploy strips this binding unless the
    // ENABLE_ANALYTICS_ENGINE secret is true — surface it so "is my usage data
    // actually being collected?" is answerable from /api/config, not CI logs.
    analytics: !!c.env.ANALYTICS,
    openai: !!c.env.OPENAI_API_KEY,
    gemini: geminiMissing.length === 0,
    email: emailMissing.length === 0,
    push: pushMissing.length === 0,
    native_push: nativePushMissing.length === 0,
    google: googleMissing.length === 0,
    ebay: ebayMissing.length === 0,
    bricklink: !!(c.env.BRICKLINK_CONSUMER_KEY && c.env.BRICKLINK_TOKEN),
    brickeconomy: !!c.env.BRICKECONOMY_API_KEY,
    brickset: !!c.env.BRICKSET_API_KEY,
    brickowl: !!c.env.BRICKOWL_API_KEY,
    rebrickable: !!c.env.REBRICKABLE_API_KEY,
    firecrawl: !!c.env.FIRECRAWL_API_KEY,
    turnstile: !!c.env.TURNSTILE_SITE_KEY,
    amazon: amazonReadiness(c.env).web_links_ready,
    // Stripe is parked as legacy/internal — Patreon is the public supporter flow,
    // so Stripe is intentionally omitted from public readiness. Re-add this line
    // to surface it again if Stripe checkout is brought back.
  };
  return c.json({
    supabase_url: c.env.SUPABASE_URL,
    supabase_anon_key: c.env.SUPABASE_ANON_KEY,
    api_base: new URL(c.req.url).origin,
    // Public Turnstile site key (safe to expose). When present, the scanner adds
    // a Turnstile token to shared server-key scans; null leaves scanning as-is.
    turnstile_site_key: c.env.TURNSTILE_SITE_KEY || null,
    // Patreon creator page URL — set via `wrangler secret put PATREON_URL`.
    // When present, the Me tab Support card shows a "Support on Patreon" button.
    patreon_url: c.env.PATREON_URL || null,
    // Show the "Sign in with Apple" button when APPLE_SIGNIN_ENABLED=1. Gated so
    // the button stays hidden until the Apple provider is actually configured in
    // Supabase (otherwise clicking it would 400 at GoTrue). Required for the iOS
    // build since Apple mandates Sign in with Apple alongside Google (Guideline 4.8).
    apple_signin: c.env.APPLE_SIGNIN_ENABLED === '1',
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
      native_push: {
        configured: nativePushMissing.length === 0,
        missing_secrets: nativePushMissing,
        recommended_action: nativePushMissing.length
          ? 'Add FIREBASE_SERVICE_ACCOUNT_JSON as a Worker secret and include android/app/google-services.json in the Android build to enable native notifications.'
          : 'Firebase native push delivery is ready.',
      },
      amazon: {
        ...amazonReadiness(c.env),
        recommended_action: amazonReadiness(c.env).web_links_ready
          ? 'Amazon Web Special Links are ready. Android and Creators API remain separately policy-gated.'
          : 'Add AMAZON_PARTNER_TAG_FR_WEB and set AMAZON_WEB_ENABLED=1 to enable link-only Web CTAs.',
      },
    },
  });
});

// Rewrite external product-image URLs to our R2-backed proxy (/api/img) on read
// responses, so images serve from Cloudflare (reliable + fast) instead of being
// hotlinked from external CDNs. Gated on R2 being configured; a cheap text probe
// skips responses with no image fields; fails open (leaves the response intact
// on any error). Image URLs the client renders need no change — they arrive
// pre-proxied. The /api/img route itself returns image bytes (not JSON) so it's
// skipped by the content-type guard.
const rewriteImageResponses: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  await next();
  if (c.req.method !== 'GET' || !c.env.PHOTO_BUCKET) return;
  const res = c.res;
  if (!res || res.status !== 200) return;
  if (!(res.headers.get('content-type') || '').includes('application/json')) return;
  try {
    const text = await res.clone().text();
    if (!/image_url|img_url|"images"/.test(text)) return; // no image fields → leave untouched
    const rewritten = rewriteImages(JSON.parse(text), new URL(c.req.url).origin);
    const headers = new Headers(res.headers);
    headers.delete('content-length');
    c.res = new Response(JSON.stringify(rewritten), { status: 200, headers });
  } catch { /* fail open — leave the original response */ }
};
app.use('/api/*', rewriteImageResponses);

app.route('/api/me', meRoute);
app.route('/api/collection', collectionRoute);
app.route('/api/wishlist', wishlistRoute);
app.route('/api/sets', setsRoute);
app.route('/api/catalog', catalogSeedRoute);
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
app.route('/api/game', gameRoute);
app.route('/api/contributions', contributionsRoute);
app.route('/api/push', pushRoute);
app.route('/api/bricklink', bricklinkImportRoute);
app.route('/api/build', buildRoute);
app.route('/api/stripe', stripeRoute);
app.route('/api/revenuecat', revenuecatRoute);
// Public image proxy (no auth — images load via <img src>). R2-backed + edge-cached.
app.route('/api/img', imgRoute);
// Public coming-soon release feed (G2b).
app.route('/api/upcoming', upcomingRoute);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const run = async (name: string, fn: () => Promise<unknown>) => {
      // Track every cron run (running -> ok|failed + summary) for the admin
      // Activity view. Tracking is fail-open and never affects the job.
      const startedMs = Date.now();
      // Overlap guard: if a prior invocation of this cron is still running (and
      // not stale-swept), skip this tick instead of double-running a job that
      // overran its interval. Fails open (proceeds) on any bookkeeping error.
      if (await isCronRunning(env, name).catch(() => false)) {
        console.warn(`[cron] ${name} skipped: previous run still active`);
        return;
      }
      const runId = await recordCronStart(env, name).catch(() => null);
      try {
        const res = await fn();
        await recordCronFinish(env, runId, name, { ok: true, summary: summarizeResult(res), durationMs: Date.now() - startedMs }).catch(() => {});
      } catch (e) {
        console.error(`[cron] ${name} failed:`, (e as Error).message);
        await recordCronFinish(env, runId, name, { ok: false, error: (e as Error).message, durationMs: Date.now() - startedMs }).catch(() => {});
      }
    };
    // Apply admin source-tuning (blend weights + daily-cap overrides) for this
    // cron invocation before any job runs. Fail-open to code defaults.
    await applySourceConfig(env).catch(() => {});
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
        // Change-only v3 shadow sweep. PriceCharting-era records are healed
        // first and the shared D1 pricing ledger can pause it automatically.
        await run('pricing-v3-shadow', () => runBlendRecomputeBackfill(env, { limit: 400 }));
        break;
      }
      case '0 2 * * *': await run('snapshot-portfolios', () => runSnapshotPortfolios(env)); break;
      case '0 3 * * *':
        await run('snapshot-set-values', () => runSnapshotSetValues(env));
        // Day-over-day movers read today's snapshot, so they run right after it.
        await run('pricing-movers', () => detectValueMovers(env));
        // Revalidate the OpenRouter free-model pools against the live catalog
        // so the AI cascades stay on free models as availability churns.
        await run('model-refresh', () => runModelRefresh(env));
        break;
      case '0 8 * * *': await run('wishlist-alerts', () => runWishlistAlerts(env)); break;
      case '0 8 * * SUN': await run('weekly-digest', () => runWeeklyDigest(env)); break;
      case '0 5 * * SUN': await run('collection-backups', () => runCollectionBackups(env)); break;
      // Small UPCitemdb barcode trickle hourly (a few spaced searches/run) — a
      // 2nd barcode source for missing modern retail sets, gentle on the trial's
      // per-window rate limit. Auto-scales if UPCITEMDB_USER_KEY is set.
      case '30 * * * *': await run('upcitemdb-backfill', () => runUpcItemDbBackfill(env, { limit: 4 })); break;
      // Formula-head value converter, hourly at :15 — converts the high-value
      // formula ESTIMATE head (>= $50, value-first, not tried in 3d) to real
      // BrickLink/BE market values using idle BrickLink budget. No AI fallback
      // (keep the formula value if no market data; retry later). Complements
      // Pass 4, which refreshes already-real values.
      case '15 * * * *':
        await run('valuate-formula-head', () => runValuateSets(env, {
          scope: 'all', formulaHead: true, minValue: 50, limit: 40,
          includeSupplemental: false, includeEbay: false, includeAiFallback: false,
          subrequestBudget: 300,
        }));
        // PriceCharting agreement-promotion drain: idempotent and change-only,
        // so once the backlog (couple thousand sets) is promoted, this costs a
        // single empty SELECT per hour (refreshSignals=false skips the signal
        // sweep when nothing promoted). The daily 04:00 run does the full
        // signal refresh.
        await run('pricecharting-verify-drain', () => runPriceChartingVerify(env, { limit: 400, refreshSignals: false }));
        // Image mirror backfill: hourly x100 warms the full ~44k set+minifig
        // catalog in ~3 weeks, then degrades to a no-op SELECT. Shares this
        // invocation comfortably: ~300 subrequests each against the 1000 cap.
        await run('image-prewarm', () => runImagePrewarm(env, { limit: 100, concurrency: 3 }));
        break;
      // Daily maintenance is split across dedicated slots (Workers Paid: 250-cron
      // cap) so each heavy job runs in its own invocation — own subrequest budget
      // and failure isolation, and each can do more than the old packed 0 4 slot.
      // Minifig valuation runs in two daily slots (200 each = ~400 figs/day) to
      // cover the browsable population — owned + Collectible-Minifigures + popular
      // figs — within BrickLink's daily headroom; stale-first cycling (14-day TTL).
      case '0 1 * * *': await run('valuate-minifigs', () => runValuateMinifigs(env, { limit: 200 })); break;
      case '0 5 * * *': await run('valuate-minifigs', () => runValuateMinifigs(env, { limit: 200 })); break;
      case '0 6 * * *': await run('brickinsights-ratings', () => runBrickInsightsBackfill(env, { limit: 80 })); break;
      // eBay sold comps via Bright Data — 8 runs/day (every 3h) at up to 150 each
      // (~1200/day) to BURST through the never-scraped sets fast. It self-tapers:
      // freshly-cached rows aren't due again for 30 days, and no-data sets are also
      // stamped, so once the backfill is done daily volume drops to the refresh
      // rate (~eligible/30) on its own — well within the ~25k/mo token pool.
      case '0 0,3,6,9,12,15,18,21 * * *': await run('ebay-sold-scrape', () => runEbaySoldScrape(env, { limit: 100, concurrency: 8 })); break;
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
      // Image pre-warm: pull Rebrickable set images into the R2 cache so first
      // views are instant. Gentle (limit 100, concurrency 3) to respect
      // Rebrickable's no-automation rule; Rebrickable-only per ToS.
      // Upcoming/coming-soon release feed (G2b): one LEGO.com listing scrape/day.
      case '0 14 * * *': await run('pricecharting-enrich', () => runPriceChartingEnrich(env, { limit: 100, concurrency: 5 })); break;
      case '0 15 * * *': await run('upcoming-refresh', () => runUpcomingRefresh(env)); break;
      case '0 16 * * *': await run('minifig-verify', () => runMinifigVerify(env)); break;
      // pricesAPI live-retail runs in 3 daily slots (~18 sets/day) now that the
      // key pool spreads the monthly budget; cold calls are 30–90s so each slot
      // stays small. The job prioritizes owned/wishlisted sets first.
      // Amazon Creators API offer refresh — KV-only (24h TTL, Associates terms),
      // owned/wishlisted + catalog head. No-ops until AMAZON_CREATORS_ENABLED=1
      // with eligible credentials (>= 10 qualifying sales / 30 days).
      case '30 7 * * *': await run('amazon-offers', () => runAmazonOffers(env, { limit: 60 })); break;
      case '30 16 * * *': await run('amazon-offers', () => runAmazonOffers(env, { limit: 60 })); break;
      case '0 17 * * *': await run('pricesapi-retail', () => runPricesApiRetail(env, { limit: 6 })); break;
      case '0 18 * * *': await run('stockx-enrich', () => runStockXEnrich(env, { limit: 20, concurrency: 3 })); break;
      // TEMPORARY: StockX one-time bulk backfill — every 3 min. Batch kept SMALL
      // (20) so a run reliably finishes inside the Worker invocation window; larger
      // batches (32-40) occasionally overran and zombied the 'running' row, which
      // then blocked ticks for the 30-min overlap-guard window. Overlap-guarded and
      // a fast no-op once everything is cached. REMOVE after the sweep completes.
      case '*/3 * * * *': await run('stockx-backfill', () => runStockXEnrich(env, { limit: 20, concurrency: 8 })); break;
      case '0 19 * * *': await run('pricesapi-retail', () => runPricesApiRetail(env, { limit: 6 })); break;
      case '0 22 * * *': await run('community-comps', () => runCommunityComps(env)); break;
      case '0 23 * * *': await run('pricesapi-retail', () => runPricesApiRetail(env, { limit: 6 })); break;
      // AI gap-fill: high-value formula sets that NO market source can price get a
      // free Gemini estimate (tries market first, AI only on a full miss). Small
      // limit + 3-day formula-head cooldown keep it well under the free tier; the
      // plausibility guard + AI-spend ledger block bad/runaway values. BYOK honored.
      case '0 20 * * *': await run('valuate-ai-gapfill', () => runValuateSets(env, {
        scope: 'all', formulaHead: true, minValue: 50, limit: 30,
        includeSupplemental: false, includeEbay: false, includeAiFallback: true,
        subrequestBudget: 300,
      })); break;
      // NB: the temporary BrickEconomy bootstrap (was "5,20,35,50 * * * *", 4×/hour)
      // was retired once the full year>=2000 catalog was swept (~67% populated =
      // BrickEconomy's real coverage ceiling). Steady-state refresh now rides the
      // daily brickeconomy-enrich (0 11) at limit 40; bootstrap-brickeconomy.yml
      // (manual, budget-capped) fills any later gaps on demand.
      case '0 4 * * *': {
        await run('db-hygiene', () => runDbHygiene(env));
        await run('daily-catalog-maintenance', () => runDailyCatalogMaintenance(env));
        // Promote PriceCharting mappings proven by cross-source price agreement
        // and refresh their sold-comp signals (set-based SQL, subrequest-lean).
        // Full-width run: the hourly drain handles the backlog, this one also
        // refreshes signals for already-verified mappings whose prices moved.
        await run('pricecharting-verify', () => runPriceChartingVerify(env, { limit: 2500 }));
        const isSunday = new Date(event.scheduledTime).getUTCDay() === 0;
        if (!isSunday) break;
        await run('weekly-import-sets', () => importSets(env.DB, env));
        await run('weekly-import-figs', () => importFigs(env.DB, env));
        // Weekly PriceCharting LEGO price-guide CSV (Legendary tier; one ~2 MB
        // download for the whole catalog). Gates itself on token + source config;
        // auto-verifies unique-UPC matches and refreshes verified signals.
        await run('pricecharting-bulk-fetch', () => runPriceChartingBulkFetch(env));
        break;
      }
    }
  },
};
