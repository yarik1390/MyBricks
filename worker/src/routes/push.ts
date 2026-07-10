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

// GET /api/push/status - device-specific subscription state without exposing
// endpoint URLs or FCM registration tokens.
app.get('/status', async (c) => {
  const userId = c.get('userId');
  const [web, native] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id=?')
      .bind(userId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM native_push_tokens WHERE user_id=?')
      .bind(userId).first<{ count: number }>(),
  ]);
  return c.json({
    web: Number(web?.count || 0) > 0,
    native: Number(native?.count || 0) > 0,
  });
});

// POST /api/push/native - upsert a Firebase registration token for this user.
app.post('/native', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ token?: string; platform?: string }>()
    .catch(() => ({} as { token?: string; platform?: string }));
  const token = String(body.token || '').trim();
  const platform = body.platform === 'ios' ? 'ios' : 'android';
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) {
    return c.json({ error: 'invalid device token' }, 400);
  }
  await c.env.DB.prepare(`
    INSERT INTO native_push_tokens (user_id, token, platform, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, token) DO UPDATE SET
      platform=excluded.platform,
      updated_at=CURRENT_TIMESTAMP
  `).bind(userId, token, platform).run();
  // A reinstalled app can leave old FCM tokens behind. Keep only the five most
  // recently refreshed devices so one account cannot grow delivery work forever.
  await c.env.DB.prepare(`
    DELETE FROM native_push_tokens
    WHERE user_id=? AND id NOT IN (
      SELECT id FROM native_push_tokens WHERE user_id=? ORDER BY updated_at DESC, id DESC LIMIT 5
    )
  `).bind(userId, userId).run();
  return c.json({ ok: true });
});

// DELETE /api/push/native - remove one device or every native device for the user.
app.delete('/native', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ token?: string }>()
    .catch(() => ({} as { token?: string }));
  if (body.token) {
    await c.env.DB.prepare('DELETE FROM native_push_tokens WHERE user_id=? AND token=?')
      .bind(userId, body.token).run();
  } else {
    await c.env.DB.prepare('DELETE FROM native_push_tokens WHERE user_id=?').bind(userId).run();
  }
  return c.json({ ok: true });
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
