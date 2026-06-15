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
import { pushRoute } from './routes/push';
import { bricklinkImportRoute } from './routes/bricklink-import';

import { runValuateSets, runValuateMinifigs } from './jobs/valuate-sets';
import { runSnapshotPortfolios } from './jobs/snapshot-portfolios';
import { runSnapshotSetValues } from './jobs/snapshot-set-values';
import { runWishlistAlerts } from './jobs/wishlist-alerts';
import { runDailyCatalogMaintenance } from './jobs/catalog-maintenance';
import { runDbHygiene } from './jobs/db-hygiene';
import { importSets, importFigs } from './jobs/import-catalog';

import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return 'https://brickvault-5ub.pages.dev';
    if (
      origin.startsWith('http://localhost:') ||
      origin.startsWith('http://127.0.0.1:') ||
      origin.endsWith('.pages.dev') ||
      origin === 'https://brickvault-5ub.pages.dev'
    ) {
      return origin;
    }
    return 'https://brickvault-5ub.pages.dev';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Gemini-Key', 'X-OpenAI-Key'],
}));

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
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
      case '0 * * * *': await run('valuate-sets', () => runValuateSets(env, {
        scope: 'all',
        limit: 80,
        includeSupplemental: false,
        includeEbay: false,
        includeAiFallback: false,
      })); break;
      case '0 2 * * *': await run('snapshot-portfolios', () => runSnapshotPortfolios(env)); break;
      case '0 3 * * *': await run('snapshot-set-values', () => runSnapshotSetValues(env)); break;
      case '0 8 * * *': await run('wishlist-alerts', () => runWishlistAlerts(env)); break;
      case '0 5 * * *': await run('valuate-minifigs', () => runValuateMinifigs(env)); break;
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
