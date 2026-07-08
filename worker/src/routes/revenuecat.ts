import { Hono } from 'hono';
import type { Env, Variables } from '../types';

// RevenueCat webhook — the authoritative source of truth for the supporter
// entitlement. RevenueCat sends server-to-server events (Google Play / Apple
// StoreKit purchases, renewals, cancellations, refunds) here; we flip
// user_prefs.is_supporter accordingly. Public endpoint, verified by the shared
// secret you set as the webhook's Authorization header (REVENUECAT_WEBHOOK_AUTH).
//
// The native SDK is configured with the Supabase user id as the RevenueCat
// app_user_id (purchase is gated behind login), so event.app_user_id maps
// directly to user_prefs.user_id. aliases are also honored for anonymous→login
// merges.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Grant on any event that means "entitlement is (still) active". Note we do NOT
// revoke on CANCELLATION — a cancelled subscription keeps access until it
// EXPIRES, which arrives as its own event.
const GRANT = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE', // e.g. the "lifetime" one-time product
  'SUBSCRIPTION_EXTENDED',
  'PRODUCT_CHANGE',
  'TRANSFER',
]);
const REVOKE = new Set([
  'EXPIRATION',
  'REFUND',
  'SUBSCRIPTION_PAUSED',
]);

// Constant-time string compare — a plain !== short-circuits on the first
// differing byte, which leaks prefix-match timing to an attacker probing the
// shared webhook secret. XOR-accumulating over the full length doesn't.
// (Only the length is still observable, which is standard and acceptable.)
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

app.post('/webhook', async (c) => {
  const expected = c.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) return c.json({ error: 'RevenueCat webhook not configured' }, 503);
  if (!timingSafeEqual(c.req.header('Authorization') || '', expected)) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = await c.req
    .json<{ event?: { type?: string; app_user_id?: string; aliases?: string[] } }>()
    .catch(() => null);
  const ev = body?.event;
  if (!ev?.type || !ev.app_user_id) return c.json({ error: 'bad payload' }, 400);

  // app_user_id + aliases all reference the same person (Supabase user id).
  const userIds = [...new Set([ev.app_user_id, ...(ev.aliases || [])])].filter(Boolean);

  if (GRANT.has(ev.type)) {
    await c.env.DB.batch(
      userIds.map((uid) =>
        c.env.DB.prepare(
          `INSERT INTO user_prefs (user_id, is_supporter, supporter_since, updated_at)
           VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             is_supporter = 1,
             supporter_since = COALESCE(user_prefs.supporter_since, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP`
        ).bind(uid)
      )
    );
  } else if (REVOKE.has(ev.type)) {
    await c.env.DB.batch(
      userIds.map((uid) =>
        c.env.DB.prepare(
          `UPDATE user_prefs SET is_supporter = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`
        ).bind(uid)
      )
    );
  }
  // CANCELLATION / BILLING_ISSUE / TEST etc. → acknowledge with no change.
  return c.json({ ok: true });
});

export { app as revenuecatRoute };
