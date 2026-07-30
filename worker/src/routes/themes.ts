import { Hono, type Context } from 'hono';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Three GROUP BYs over the whole catalog — ~83,000 rows read per call — to build
// the filter chips, and the frontend asks for them on every app boot. The result
// is identical for every user and only changes when the weekly catalog import
// adds a theme, so it is cached at the colo for an hour. This was the single
// most expensive read left in the app after the browse indexes landed.
app.get('/', (c) => edgeCached(c, 3600, () => themesHandler(c)));

const themesHandler = async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
  const [themes, groups, cats] = await Promise.all([
    c.env.DB.prepare(`
      SELECT theme, COUNT(*) as cnt
      FROM lego_sets
      WHERE theme IS NOT NULL AND theme != ''
      GROUP BY theme
      ORDER BY cnt DESC
      LIMIT 200
    `).all<{ theme: string }>(),
    c.env.DB.prepare(`
      SELECT theme_group AS g, COUNT(*) as cnt
      FROM lego_sets
      WHERE theme_group IS NOT NULL AND theme_group != ''
      GROUP BY theme_group
      ORDER BY cnt DESC
      LIMIT 40
    `).all<{ g: string }>(),
    c.env.DB.prepare(`
      SELECT category AS cat, COUNT(*) as cnt
      FROM lego_sets
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY cnt DESC
      LIMIT 40
    `).all<{ cat: string }>(),
  ]);
  return c.json({
    themes: themes.results.map(r => r.theme),
    theme_groups: groups.results.map(r => r.g),
    categories: cats.results.map(r => r.cat),
  });
};

export { app as themesRoute };
