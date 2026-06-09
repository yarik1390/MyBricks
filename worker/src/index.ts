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

import { runValuateSets } from './jobs/valuate-sets';
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
  const googleMissing = [
    !c.env.GOOGLE_CLIENT_ID || c.env.GOOGLE_CLIENT_ID.includes('dummy') ? 'GOOGLE_CLIENT_ID' : null,
    !c.env.GOOGLE_CLIENT_SECRET || c.env.GOOGLE_CLIENT_SECRET.includes('dummy') ? 'GOOGLE_CLIENT_SECRET' : null,
  ].filter((name): name is string => !!name);
  const ebayMissing = [
    !c.env.EBAY_APP_ID || c.env.EBAY_APP_ID.includes('dummy') ? 'EBAY_APP_ID' : null,
    !c.env.EBAY_CLIENT_SECRET || c.env.EBAY_CLIENT_SECRET.includes('dummy') ? 'EBAY_CLIENT_SECRET' : null,
  ].filter((name): name is string => !!name);
  const status = {
    supabase: !!(c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY && c.env.SUPABASE_JWT_SECRET),
    d1: !!c.env.DB,
    openai: !!c.env.OPENAI_API_KEY,
    google: googleMissing.length === 0,
    ebay: ebayMissing.length === 0,
    bricklink: !!(c.env.BRICKLINK_CONSUMER_KEY && c.env.BRICKLINK_TOKEN),
    brickeconomy: !!c.env.BRICKECONOMY_API_KEY,
    brickset: !!c.env.BRICKSET_API_KEY,
    brickowl: !!c.env.BRICKOWL_API_KEY,
    rebrickable: !!c.env.REBRICKABLE_API_KEY,
  };
  return c.json({
    supabase_url: c.env.SUPABASE_URL,
    supabase_anon_key: c.env.SUPABASE_ANON_KEY,
    api_base: new URL(c.req.url).origin,
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

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try { await fn(); }
      catch (e) { console.error(`[cron] ${name} failed:`, (e as Error).message); }
    };
    switch (event.cron) {
      case '0 * * * *': await run('valuate-sets', () => runValuateSets(env)); break;
      case '0 2 * * *': await run('snapshot-portfolios', () => runSnapshotPortfolios(env)); break;
      case '0 3 * * *': await run('snapshot-set-values', () => runSnapshotSetValues(env)); break;
      case '0 8 * * *': await run('wishlist-alerts', () => runWishlistAlerts(env)); break;
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
