import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { verifyUnsubscribeToken } from '../lib/email-unsubscribe';

// Email unsubscribe (mounted at /api/email). PUBLIC: authenticated by the
// signed per-user token in each email (lib/email-unsubscribe.ts), not a login.
//
// POST /api/email/unsubscribe?u=&t=   one-click (RFC 8058 List-Unsubscribe-Post)
//                                     and the bricksvault.app/unsubscribe.html button
// POST /api/email/resubscribe?u=&t=   "Turn emails back on" on the same page
//
// Only POST changes anything: mail scanners prefetch GET links, so a GET must
// never unsubscribe anyone.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function readCreds(c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined; json: () => Promise<unknown> } }) {
  let u = c.req.query('u') || '';
  let t = c.req.query('t') || '';
  if ((!u || !t) && (c.req.header('content-type') || '').includes('application/json')) {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    u = u || String(body.u ?? '');
    t = t || String(body.t ?? '');
  }
  return { u, t };
}

async function setEmailOff(c: any, off: boolean) {
  const { u, t } = await readCreds(c);
  if (!(await verifyUnsubscribeToken(c.env, u, t))) return c.json({ error: 'This link is not valid.' }, 400);
  await c.env.DB.prepare(
    `UPDATE user_prefs SET email_off_at = ${off ? "COALESCE(email_off_at, datetime('now'))" : 'NULL'}, updated_at = datetime('now') WHERE user_id = ?`,
  ).bind(u).run();
  return c.json({ ok: true, email_alerts: !off });
}

app.post('/unsubscribe', (c) => setEmailOff(c, true));
app.post('/resubscribe', (c) => setEmailOff(c, false));

export { app as emailRoute };
