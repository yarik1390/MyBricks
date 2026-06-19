import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get('/', async (c) => {
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
});

export { app as themesRoute };
