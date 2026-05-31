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

import { runValuateSets } from './jobs/valuate-sets';
import { runSnapshotPortfolios } from './jobs/snapshot-portfolios';
import { runSnapshotSetValues } from './jobs/snapshot-set-values';
import { runWishlistAlerts } from './jobs/wishlist-alerts';
import { runBackfillUpc } from './jobs/backfill-upc';
import { importSets, importFigs } from './jobs/import-catalog';

import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Public config for the frontend (Supabase URL + anon key are client-safe)
app.get('/api/config', (c) => c.json({
  supabase_url: c.env.SUPABASE_URL,
  supabase_anon_key: c.env.SUPABASE_ANON_KEY,
}));

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

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    switch (event.cron) {
      case '0 * * * *': await runValuateSets(env); break;
      case '0 2 * * *': await runSnapshotPortfolios(env); break;
      case '0 3 * * *': await runSnapshotSetValues(env); break;
      case '0 8 * * *': await runWishlistAlerts(env); break;
      // Weekly Sunday 4am: sync Brickset barcodes then re-import Rebrickable catalog
      case '0 4 * * 0':
        await runBackfillUpc(env);
        await importSets(env.DB);
        await importFigs(env.DB);
        break;
    }
  },
};
