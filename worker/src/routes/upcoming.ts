import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/upcoming — public coming-soon / pre-order LEGO release feed (G2b).
// No auth (browsable like the catalog). Highest-ticket first.
app.get('/', async (c) => {
  try {
    // The scrape carries no images; the catalog usually already has the set
    // (Rebrickable lists announced sets), so borrow its photo and theme. A set
    // the catalog marks retired has plainly released — a stale scrape row.
    const { results } = await c.env.DB.prepare(
      `SELECT u.set_num, u.name, u.price_usd, u.availability, u.first_seen_at,
              ls.image_url, ls.theme
       FROM upcoming_sets u
       LEFT JOIN lego_sets ls ON ls.set_num = u.set_num
       WHERE COALESCE(ls.retired, 0) = 0
       ORDER BY COALESCE(u.price_usd, 0) DESC, u.name ASC
       LIMIT 100`,
    ).all<Record<string, unknown>>();
    return c.json({ upcoming: results || [] });
  } catch {
    // Table may not exist yet on a fresh DB — degrade to an empty feed.
    return c.json({ upcoming: [] });
  }
});

export { app as upcomingRoute };
