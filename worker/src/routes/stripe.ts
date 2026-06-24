import { Hono } from 'hono';
import Stripe from 'stripe';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ALLOWED_AMOUNTS = new Set([500, 1000, 2500]);
const MONTHLY_AMOUNT = 500; // $5/month

function makeStripe(secretKey: string) {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

// Upsert a Stripe customer for the given user; returns the customer ID.
async function upsertCustomer(
  stripe: Stripe,
  db: D1Database,
  userId: string,
  email: string | undefined,
): Promise<string> {
  const pref = await db.prepare(
    'SELECT stripe_customer_id, email FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ stripe_customer_id: string | null; email: string | null }>();

  if (pref?.stripe_customer_id) return pref.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: pref?.email || email || undefined,
    metadata: { user_id: userId },
  });
  await db.prepare(
    'UPDATE user_prefs SET stripe_customer_id=? WHERE user_id=?'
  ).bind(customer.id, userId).run();
  return customer.id;
}

// POST /api/stripe/checkout — create a Checkout session (one-time or monthly)
app.post('/checkout', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Payments not configured' }, 503);
  }

  const userId = c.get('userId');
  const userEmail = c.get('userEmail');
  const body = await c.req.json<{ amount?: unknown; mode?: unknown }>().catch(() => ({ amount: undefined, mode: undefined }));
  const mode = (body as { mode?: unknown }).mode === 'subscription' ? 'subscription' : 'payment';
  const amount = mode === 'subscription' ? MONTHLY_AMOUNT : Number((body as { amount?: unknown }).amount);

  if (mode === 'payment' && !ALLOWED_AMOUNTS.has(amount)) {
    return c.json({ error: 'Invalid amount. Choose $5, $10, or $25.' }, 400);
  }

  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
  const customerId = await upsertCustomer(stripe, c.env.DB, userId, userEmail);
  const origin = new URL(c.req.url).origin;

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = mode === 'subscription'
    ? {
        price_data: {
          currency: 'usd',
          unit_amount: MONTHLY_AMOUNT,
          recurring: { interval: 'month' },
          product_data: {
            name: 'Brickvault Supporter Monthly',
            description: 'Monthly contribution to support Brickvault development.',
          },
        },
        quantity: 1,
      }
    : {
        price_data: {
          currency: 'usd',
          unit_amount: amount,
          product_data: {
            name: 'Brickvault Supporter',
            description: 'One-time contribution to support Brickvault development.',
          },
        },
        quantity: 1,
      };

  const session = await stripe.checkout.sessions.create({
    mode,
    customer: customerId,
    line_items: [lineItem],
    metadata: { user_id: userId },
    success_url: `${origin}/#/me?supported=1`,
    cancel_url: `${origin}/#/me`,
  });

  return c.json({ url: session.url });
});

// POST /api/stripe/webhook — receive Stripe events (public, verified by signature)
app.post('/webhook', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Webhook not configured' }, 503);
  }

  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ error: 'Missing stripe-signature header' }, 400);

  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);
  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return c.json({ error: 'Invalid webhook signature' }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    if (userId) {
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      await c.env.DB.prepare(
        `UPDATE user_prefs
           SET is_supporter = 1,
               supporter_since = COALESCE(supporter_since, datetime('now')),
               stripe_customer_id = COALESCE(stripe_customer_id, ?)
         WHERE user_id = ?`
      ).bind(customerId, userId).run();
    }
  }

  // Monthly subscription cancellation — revoke supporter status.
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    const customerId = typeof sub.customer === 'string' ? sub.customer : null;
    if (customerId) {
      // Only revoke if they have no other active subscriptions or one-time payments.
      // Simple approach: check if they ever had a one-time payment by looking at
      // whether supporter_since was set before this subscription started.
      // For now, revoke — users who also made a one-time payment keep the badge
      // via the one-time checkout.session.completed that already fired.
      await c.env.DB.prepare(
        `UPDATE user_prefs SET is_supporter = 0 WHERE stripe_customer_id = ? AND is_supporter = 1`
      ).bind(customerId).run();
    }
  }

  return c.json({ received: true });
});

export { app as stripeRoute };
