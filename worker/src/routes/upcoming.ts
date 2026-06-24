import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/upcoming — public coming-soon / pre-order LEGO release feed (G2b).
// No auth (browsable like the catalog). Highest-ticket first.
app.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT set_num, name, price_usd, availability, first_seen_at
       FROM upcoming_sets
       ORDER BY COALESCE(price_usd, 0) DESC, name ASC
       LIMIT 100`,
    ).all<Record<string, unknown>>();
    return c.json({ upcoming: results || [] });
  } catch {
    // Table may not exist yet on a fresh DB — degrade to an empty feed.
    return c.json({ upcoming: [] });
  }
});

export { app as upcomingRoute };
