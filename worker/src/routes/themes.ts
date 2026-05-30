import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

app.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT theme, COUNT(*) as cnt
    FROM lego_sets
    WHERE theme IS NOT NULL AND theme != ''
    GROUP BY theme
    ORDER BY cnt DESC
    LIMIT 50
  `).all<{ theme: string }>();
  return c.json({ themes: results.map(r => r.theme) });
});

export { app as themesRoute };
