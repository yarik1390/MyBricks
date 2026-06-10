import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// GET /api/push/vapid-key — return the VAPID public key so the frontend can subscribe
app.get('/vapid-key', (c) => {
  if (!c.env.VAPID_PUBLIC_KEY) return c.json({ error: 'Push not configured' }, 503);
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — save a push subscription
app.post('/subscribe', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ endpoint?: string; p256dh?: string; auth?: string }>()
    .catch(() => ({} as { endpoint?: string; p256dh?: string; auth?: string }));
  const { endpoint, p256dh, auth } = body;
  if (!endpoint || !p256dh || !auth) return c.json({ error: 'endpoint, p256dh, and auth required' }, 400);
  if (!/^https:\/\//.test(endpoint)) return c.json({ error: 'invalid endpoint' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`
  ).bind(userId, endpoint, p256dh, auth).run();
  return c.json({ ok: true });
});

// DELETE /api/push/subscribe — remove a push subscription
app.delete('/subscribe', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ endpoint?: string }>()
    .catch(() => ({} as { endpoint?: string }));
  if (body.endpoint) {
    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?'
    ).bind(userId, body.endpoint).run();
  } else {
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=?').bind(userId).run();
  }
  return c.json({ ok: true });
});

export { app as pushRoute };
