import { Hono } from 'hono';
import Stripe from 'stripe';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const ALLOWED_AMOUNTS = new Set([500, 1000, 2500]);

function makeStripe(secretKey: string) {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}

// POST /api/stripe/checkout — create a Stripe Checkout session (one-time payment)
app.post('/checkout', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ error: 'Payments not configured' }, 503);
  }

  const userId = c.get('userId');
  const userEmail = c.get('userEmail');

  const body = await c.req.json<{ amount?: unknown }>().catch(() => ({ amount: undefined }));
  const amount = Number(body.amount);
  if (!ALLOWED_AMOUNTS.has(amount)) {
    return c.json({ error: 'Invalid amount. Choose $5, $10, or $25.' }, 400);
  }

  const stripe = makeStripe(c.env.STRIPE_SECRET_KEY);

  // Upsert Stripe customer so receipts go to the right email.
  const pref = await c.env.DB.prepare(
    'SELECT stripe_customer_id, email FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ stripe_customer_id: string | null; email: string | null }>();

  let customerId = pref?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: pref?.email || userEmail || undefined,
      metadata: { user_id: userId },
    });
    customerId = customer.id;
    await c.env.DB.prepare(
      'UPDATE user_prefs SET stripe_customer_id=? WHERE user_id=?'
    ).bind(customerId, userId).run();
  }

  const origin = new URL(c.req.url).origin;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: amount,
        product_data: {
          name: 'Brickvault Supporter',
          description: 'One-time contribution to support Brickvault development.',
        },
      },
      quantity: 1,
    }],
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

  return c.json({ received: true });
});

export { app as stripeRoute };
