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
import { runBackfillUpc } from './jobs/backfill-upc';
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
  const status = {
    supabase: !!(c.env.SUPABASE_URL && c.env.SUPABASE_ANON_KEY && c.env.SUPABASE_JWT_SECRET),
    d1: !!c.env.DB,
    openai: !!c.env.OPENAI_API_KEY,
    google: !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    ebay: !!c.env.EBAY_APP_ID,
    bricklink: !!(c.env.BRICKLINK_CONSUMER_KEY && c.env.BRICKLINK_TOKEN),
    brickeconomy: !!c.env.BRICKECONOMY_API_KEY,
  };
  return c.json({
    supabase_url: c.env.SUPABASE_URL,
    supabase_anon_key: c.env.SUPABASE_ANON_KEY,
    status,
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
      case '0 4 * * SUN':
        await run('backfill-upc', () => runBackfillUpc(env));
        await run('import-sets', () => importSets(env.DB));
        await run('import-figs', () => importFigs(env.DB));
        await run('cleanup-stale-rows', async () => {
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < datetime('now', '-7 days')`),
            env.DB.prepare(`DELETE FROM oauth_sessions WHERE expires_at < unixepoch() - 86400`),
            env.DB.prepare(`DELETE FROM oauth_states WHERE expires_at < unixepoch() - 86400`),
          ]);
        });
        break;
    }
  },
};
