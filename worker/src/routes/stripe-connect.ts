/**
 * Stripe Connect integration.
 *
 * Lets Brickvault users become connected accounts (sellers), create products,
 * and accept direct-charge payments from their own customers, with Brickvault
 * collecting a 5% platform application fee on each transaction.
 *
 * Secrets required (wrangler secret put / GitHub Actions secrets):
 *   STRIPE_SECRET_KEY                    — platform Stripe secret key (sk_live_... / sk_test_...)
 *   STRIPE_CONNECT_WEBHOOK_SECRET        — whsec_... from the V2 thin-event webhook endpoint
 *                                          (account requirements / capability changes)
 *   STRIPE_SUBSCRIPTION_WEBHOOK_SECRET   — whsec_... from the V1 subscription lifecycle endpoint
 *   STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID — price_... for the platform subscription sold to
 *                                          connected accounts (create in Stripe Dashboard)
 *
 * Webhook endpoints to register in Stripe Dashboard → Developers → Webhooks:
 *
 *   1. /api/connect/webhook/connect
 *      Events from: Connected accounts
 *      Payload style: Thin
 *      Events: v2.core.account[requirements].updated
 *              v2.core.account[configuration.merchant].capability_status_updated
 *              v2.core.account[configuration.customer].capability_status_updated
 *
 *   2. /api/connect/webhook/subscriptions
 *      Events from: Your account (platform)
 *      Events: customer.subscription.updated, customer.subscription.deleted,
 *              payment_method.attached, payment_method.detached, customer.updated,
 *              customer.tax_id.created, customer.tax_id.deleted, customer.tax_id.updated,
 *              billing_portal.session.created
 *
 * Local testing with Stripe CLI:
 *   stripe listen --thin-events \
 *     'v2.core.account[requirements].updated,v2.core.account[configuration.merchant].capability_status_updated' \
 *     --forward-thin-to http://localhost:8787/api/connect/webhook/connect
 *   stripe listen --forward-to http://localhost:8787/api/connect/webhook/subscriptions
 */

import { Hono } from 'hono';
import Stripe from 'stripe';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { makeStripe } from '../lib/stripe-client';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── helpers ────────────────────────────────────────────────────────────────

type ConnectAccountRow = {
  stripe_account_id: string;
  subscription_id: string | null;
  subscription_status: string | null;
};

/** Look up the connect_accounts row for the authenticated user. */
async function getAccountForUser(db: D1Database, userId: string): Promise<ConnectAccountRow | null> {
  return db.prepare(
    'SELECT stripe_account_id, subscription_id, subscription_status FROM connect_accounts WHERE user_id = ?'
  ).bind(userId).first<ConnectAccountRow>();
}

// ─── auth-required endpoints ─────────────────────────────────────────────────

/**
 * POST /api/connect/accounts
 * Create a Stripe V2 connected account for the authenticated user and store
 * the account ID so future requests can reference it without re-fetching.
 *
 * Body: { display_name: string, email: string }
 *
 * V2 accounts are created via stripeClient.v2.core.accounts.create().
 * Do NOT pass a top-level `type` field; capabilities come from `configuration`.
 */
app.post('/accounts', requireMember, async (c) => {
  // PLACEHOLDER: add STRIPE_SECRET_KEY via `wrangler secret put STRIPE_SECRET_KEY`
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const userId = c.get('userId');

  // One connected account per platform user — reject if one already exists.
  const existing = await getAccountForUser(c.env.DB, userId);
  if (existing) return c.json({ error: 'A connected account already exists for this user.' }, 409);

  const body = await c.req.json<{ display_name?: string; email?: string }>().catch(() => ({}));
  const { display_name, email } = body as { display_name?: string; email?: string };
  if (!display_name || !email) return c.json({ error: 'display_name and email are required.' }, 400);

  // Create the V2 connected account.
  // - dashboard: 'full'  → account gets access to the full Stripe Dashboard
  // - fees_collector / losses_collector: 'stripe' → Stripe handles fee collection
  //   and loss coverage (not the platform)
  // - card_payments.requested: true → ask Stripe to enable card processing
  const account = await (stripeClient.v2 as any).core.accounts.create({
    display_name,
    contact_email: email,
    identity: { country: 'us' },
    dashboard: 'full',
    defaults: {
      responsibilities: {
        fees_collector: 'stripe',
        losses_collector: 'stripe',
      },
    },
    configuration: {
      customer: {},          // enables customer-facing billing features
      merchant: {
        capabilities: {
          card_payments: { requested: true },
        },
      },
    },
  });

  // Store the mapping so we can look up the account ID from a user ID.
  await c.env.DB.prepare(
    'INSERT INTO connect_accounts (user_id, stripe_account_id, display_name, email) VALUES (?, ?, ?, ?)'
  ).bind(userId, account.id, display_name, email).run();

  return c.json({ account_id: account.id });
});

/**
 * GET /api/connect/accounts/me
 * Return the authenticated user's connected account plus live onboarding
 * status fetched directly from the Stripe V2 API on each request.
 * (Status is intentionally not cached in DB to stay current with Stripe.)
 */
app.get('/accounts/me', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const userId = c.get('userId');
  const row = await getAccountForUser(c.env.DB, userId);
  if (!row) return c.json({ error: 'No connected account found.' }, 404);

  // Retrieve the V2 account with merchant configuration and requirements so we
  // know whether the account can process payments and whether onboarding is done.
  const account = await (stripeClient.v2 as any).core.accounts.retrieve(row.stripe_account_id, {
    include: ['configuration.merchant', 'requirements'],
  });

  // ready_to_process: card_payments capability has been approved and activated.
  const cardStatus = account?.configuration?.merchant?.capabilities?.card_payments?.status;
  const ready_to_process = cardStatus === 'active';

  // onboarding_complete: no requirements are currently_due or past_due.
  const requirementsStatus = account?.requirements?.summary?.minimum_deadline?.status;
  const onboarding_complete =
    requirementsStatus !== 'currently_due' && requirementsStatus !== 'past_due';

  return c.json({
    stripe_account_id: row.stripe_account_id,
    subscription_id: row.subscription_id,
    subscription_status: row.subscription_status,
    display_name: account.display_name ?? null,
    ready_to_process,
    onboarding_complete,
    requirements_status: requirementsStatus ?? null,
    card_payments_status: cardStatus ?? null,
  });
});

/**
 * POST /api/connect/accounts/me/onboard
 * Create a V2 Account Link for the hosted Stripe onboarding flow.
 * Returns { url } — redirect the user's browser to this URL.
 */
app.post('/accounts/me/onboard', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const userId = c.get('userId');
  const row = await getAccountForUser(c.env.DB, userId);
  if (!row) return c.json({ error: 'No connected account found.' }, 404);

  const origin = new URL(c.req.url).origin;

  // account_onboarding covers both merchant (card payments) and customer
  // (billing) configurations in a single Stripe-hosted flow.
  // refresh_url: shown if the link expires before the user finishes
  // return_url:  Stripe redirects here after completion; include accountId
  //              so the frontend can confirm which account was onboarded
  const accountLink = await (stripeClient.v2 as any).core.accountLinks.create({
    account: row.stripe_account_id,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant', 'customer'],
        refresh_url: `${origin}/#/connect`,
        return_url: `${origin}/#/connect?accountId=${row.stripe_account_id}`,
      },
    },
  });

  return c.json({ url: accountLink.url });
});

/**
 * POST /api/connect/accounts/me/products
 * Create a Stripe Product (with an embedded Price) on the connected account.
 * The stripeAccount request option sets the Stripe-Account header, scoping
 * the product to the connected account rather than the platform.
 *
 * Body: { name: string, description?: string, price: number, currency?: string }
 *   price — major currency units (e.g. 9.99 for $9.99)
 */
app.post('/accounts/me/products', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const userId = c.get('userId');
  const row = await getAccountForUser(c.env.DB, userId);
  if (!row) return c.json({ error: 'No connected account found.' }, 404);

  const body = await c.req.json<{ name?: string; description?: string; price?: number; currency?: string }>()
    .catch(() => ({}));
  const { name, description, price, currency = 'usd' } = body as {
    name?: string; description?: string; price?: number; currency?: string;
  };

  if (!name) return c.json({ error: 'Product name is required.' }, 400);
  if (!price || price <= 0) return c.json({ error: 'Price must be a positive number.' }, 400);

  // Stripe stores amounts in minor currency units (cents).
  const unit_amount = Math.round(price * 100);

  // stripeAccount scopes the product to the connected account's Stripe context.
  const product = await stripeClient.products.create(
    {
      name,
      description: description || undefined,
      // Embed the price in the same call so we get a default_price on the product.
      default_price_data: { unit_amount, currency },
    },
    { stripeAccount: row.stripe_account_id }, // sets Stripe-Account header
  );

  return c.json({ product });
});

/**
 * GET /api/connect/accounts/me/products
 * List the connected account's active products, expanding default_price so
 * the dashboard has all pricing info in a single API call.
 */
app.get('/accounts/me/products', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const userId = c.get('userId');
  const row = await getAccountForUser(c.env.DB, userId);
  if (!row) return c.json({ error: 'No connected account found.' }, 404);

  const { data } = await stripeClient.products.list(
    { limit: 20, active: true, expand: ['data.default_price'] },
    { stripeAccount: row.stripe_account_id }, // Stripe-Account header
  );

  return c.json({ products: data });
});

/**
 * POST /api/connect/accounts/me/subscribe
 * Create a Stripe Checkout session to subscribe the connected account to
 * the Brickvault platform plan. The connected account is the customer:
 * customer_account = stripe_account_id (V2 feature — one ID is both the
 * merchant/seller account and the customer for platform billing).
 *
 * PLACEHOLDER: Before using this endpoint:
 *   1. Create a recurring price in the Stripe Dashboard
 *   2. wrangler secret put STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID (price_...)
 */
app.post('/accounts/me/subscribe', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);

  // PLACEHOLDER: set STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID before using this endpoint
  if (!c.env.STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID) {
    return c.json({ error: 'Platform subscription price not configured. Set STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID.' }, 503);
  }

  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);
  const userId = c.get('userId');
  const row = await getAccountForUser(c.env.DB, userId);
  if (!row) return c.json({ error: 'No connected account found.' }, 404);

  const origin = new URL(c.req.url).origin;

  // customer_account uses the connected account ID as both the buyer and the
  // account being billed — a V2-accounts-only feature. Do NOT use .customer
  // (that's for V1 customer objects).
  const session = await stripeClient.checkout.sessions.create({
    customer_account: row.stripe_account_id,
    mode: 'subscription',
    line_items: [{ price: c.env.STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID, quantity: 1 }],
    success_url: `${origin}/#/connect?subscribed=1`,
    cancel_url: `${origin}/#/connect`,
  });

  return c.json({ url: session.url });
});

/**
 * POST /api/connect/accounts/me/billing-portal
 * Create a Stripe Billing Portal session so the connected account can
 * manage (upgrade, downgrade, or cancel) their platform subscription.
 */
app.post('/accounts/me/billing-portal', requireMember, async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const userId = c.get('userId');
  const row = await getAccountForUser(c.env.DB, userId);
  if (!row) return c.json({ error: 'No connected account found.' }, 404);

  const origin = new URL(c.req.url).origin;

  // customer_account: V2 — use the connected account ID, not a v1 customer ID.
  const session = await stripeClient.billingPortal.sessions.create({
    customer_account: row.stripe_account_id,
    return_url: `${origin}/#/connect`,
  });

  return c.json({ url: session.url });
});

// ─── public endpoints ─────────────────────────────────────────────────────────

/**
 * GET /api/connect/storefront/:accountId
 * List the active products for a connected account's public storefront.
 *
 * TODO: In production, route this by a seller handle or slug rather than
 * exposing the raw Stripe account ID (acct_...) in the URL. The raw ID works
 * for a sample/demo but leaks internal identifiers to the public.
 */
app.get('/storefront/:accountId', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const accountId = c.req.param('accountId'); // e.g. acct_1ABC...

  const { data } = await stripeClient.products.list(
    { limit: 20, active: true, expand: ['data.default_price'] },
    { stripeAccount: accountId }, // Stripe-Account header scopes to the seller
  );

  return c.json({ products: data, account_id: accountId });
});

/**
 * POST /api/connect/storefront/:accountId/checkout
 * Create a Stripe Checkout session (Direct Charge) for a customer buying
 * a product from a connected account's storefront.
 *
 * Direct Charge means the payment goes directly to the connected account's
 * Stripe balance; Brickvault earns a 5% application fee transferred back to
 * the platform after each successful payment.
 *
 * Body: { price_id: string, quantity?: number }
 */
app.post('/storefront/:accountId/checkout', async (c) => {
  if (!c.env.STRIPE_SECRET_KEY) return c.json({ error: 'Payments not configured' }, 503);
  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);

  const accountId = c.req.param('accountId');
  const body = await c.req.json<{ price_id?: string; quantity?: number }>().catch(() => ({}));
  const { price_id, quantity = 1 } = body as { price_id?: string; quantity?: number };

  if (!price_id) return c.json({ error: 'price_id is required.' }, 400);

  // Retrieve the price from the connected account to get the unit_amount for
  // the application fee calculation. Must pass stripeAccount to read it.
  const price = await stripeClient.prices.retrieve(
    price_id,
    {},
    { stripeAccount: accountId },
  );

  const unit_amount = price.unit_amount ?? 0;
  // Platform earns 5% of the total charge as an application fee.
  const application_fee_amount = Math.round(unit_amount * quantity * 0.05);

  const origin = new URL(c.req.url).origin;

  // The session is created on the connected account (stripeAccount header),
  // so the customer pays the connected account directly. The application fee
  // is transferred from the connected account to the platform after payment.
  const session = await stripeClient.checkout.sessions.create(
    {
      line_items: [{ price: price_id, quantity }],
      payment_intent_data: {
        // Brickvault's platform fee — transferred from connected account to platform.
        application_fee_amount,
      },
      mode: 'payment',
      success_url: `${origin}/#/store/${accountId}?checkout=success`,
      cancel_url: `${origin}/#/store/${accountId}`,
    },
    { stripeAccount: accountId }, // Direct Charge: session scoped to connected account
  );

  return c.json({ url: session.url });
});

// ─── webhooks ─────────────────────────────────────────────────────────────────

/**
 * POST /api/connect/webhook/connect
 * Receives V2 thin-event notifications for connected account requirement and
 * capability changes. Uses parseEventNotification (the v22 replacement for
 * the former parseThinEvent) to verify the signature.
 *
 * Local testing:
 *   stripe listen --thin-events \
 *     'v2.core.account[requirements].updated,...' \
 *     --forward-thin-to http://localhost:8787/api/connect/webhook/connect
 */
app.post('/webhook/connect', async (c) => {
  // PLACEHOLDER: register this endpoint in Stripe Dashboard and set
  // STRIPE_CONNECT_WEBHOOK_SECRET via `wrangler secret put`
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    return c.json({ error: 'Connect webhook not configured' }, 503);
  }

  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ error: 'Missing stripe-signature header' }, 400);

  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);
  const rawBody = await c.req.text();

  // parseEventNotification validates the webhook signature and returns a minimal
  // EventNotification object with the event ID and type — no sensitive payload.
  // This is the v22 equivalent of the former parseThinEvent.
  let notification: Stripe.V2.Core.EventNotification;
  try {
    notification = stripeClient.parseEventNotification(
      rawBody,
      sig,
      c.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    );
  } catch {
    return c.json({ error: 'Invalid webhook signature' }, 400);
  }

  // Fetch the authoritative full event from the Stripe API using the notification ID.
  // Never trust the thin-event body for business logic — always re-fetch.
  const event = await (stripeClient.v2 as any).core.events.retrieve(notification.id);

  if (event.type === 'v2.core.account[requirements].updated') {
    // Requirements have changed — the connected account may need to complete
    // additional verification. In production, notify the account owner via email
    // or an in-app alert so they can re-enter the onboarding flow.
    const accountId = event.related_object?.id;
    console.log(`[Connect] Requirements updated for account ${accountId}:`, JSON.stringify(event.data));
  } else if (event.type === 'v2.core.account[configuration.merchant].capability_status_updated') {
    // Merchant capability (e.g. card_payments) changed status.
    // The /accounts/me endpoint always reads live status so no DB update needed here.
    const accountId = event.related_object?.id;
    console.log(`[Connect] Merchant capability updated for ${accountId}:`, JSON.stringify(event.data));
  } else if (event.type === 'v2.core.account[configuration.customer].capability_status_updated') {
    // Customer configuration capability changed.
    const accountId = event.related_object?.id;
    console.log(`[Connect] Customer capability updated for ${accountId}:`, JSON.stringify(event.data));
  }

  return c.json({ received: true });
});

/**
 * POST /api/connect/webhook/subscriptions
 * Receives standard V1 subscription lifecycle events (NOT thin events).
 * These handle subscription upgrades, downgrades, cancellations, pauses,
 * and payment method changes for connected accounts subscribed to the platform.
 *
 * Local testing:
 *   stripe listen --forward-to http://localhost:8787/api/connect/webhook/subscriptions
 */
app.post('/webhook/subscriptions', async (c) => {
  // PLACEHOLDER: set STRIPE_SUBSCRIPTION_WEBHOOK_SECRET with the signing secret
  // from the subscription webhook endpoint registered in Stripe Dashboard.
  if (!c.env.STRIPE_SECRET_KEY || !c.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET) {
    return c.json({ error: 'Subscription webhook not configured' }, 503);
  }

  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ error: 'Missing stripe-signature header' }, 400);

  const stripeClient = makeStripe(c.env.STRIPE_SECRET_KEY);
  const rawBody = await c.req.text();

  // Standard V1 webhook verification — this is NOT a thin event, so use
  // constructEventAsync (the Workers-compatible async variant using Web Crypto).
  let event: Stripe.Event;
  try {
    event = await stripeClient.webhooks.constructEventAsync(
      rawBody,
      sig,
      c.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET,
    );
  } catch {
    return c.json({ error: 'Invalid webhook signature' }, 400);
  }

  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;

    // For V2 accounts, use customer_account (not customer) to identify the
    // connected account. The value has shape acct_...
    const accountId = (subscription as any).customer_account as string | undefined;
    if (accountId) {
      const newPriceId = subscription.items.data[0]?.price?.id ?? null;
      let status: string = subscription.status;

      // cancel_at_period_end: subscription will cancel at the billing period end.
      // Distinguish this from an active subscription so the UI can show a warning.
      if (subscription.cancel_at_period_end) status = 'cancel_at_period_end';

      // pause_collection: customer paused via billing portal.
      // behavior must always be 'void' for portal-initiated pauses.
      if (subscription.pause_collection) status = 'paused';

      // TODO: gate any platform features by checking subscription_status here
      await c.env.DB.prepare(
        `UPDATE connect_accounts
            SET subscription_id = ?,
                subscription_status = ?,
                subscription_price_id = ?
          WHERE stripe_account_id = ?`
      ).bind(subscription.id, status, newPriceId, accountId).run();
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object as Stripe.Subscription;
    const accountId = (subscription as any).customer_account as string | undefined;

    if (accountId) {
      // Subscription cancelled — revoke platform access for this connected account.
      // TODO: remove any feature flags or access gated behind the subscription
      await c.env.DB.prepare(
        `UPDATE connect_accounts
            SET subscription_status = 'canceled'
          WHERE stripe_account_id = ?`
      ).bind(accountId).run();
    }
  } else if (event.type === 'payment_method.attached') {
    // A payment method was added to the connected account's customer object.
    // TODO: update billing info in your DB if you track payment methods
    console.log('[Connect] Payment method attached:', (event.data.object as Stripe.PaymentMethod).id);
  } else if (event.type === 'payment_method.detached') {
    // A payment method was removed.
    // TODO: update billing info in your DB if you track payment methods
    console.log('[Connect] Payment method detached:', (event.data.object as Stripe.PaymentMethod).id);
  } else if (event.type === 'customer.updated') {
    // Connected account's billing info changed (e.g. default payment method).
    // IMPORTANT: do NOT use the customer email from this event as a login credential.
    // TODO: update billing-related info in your DB if needed
    console.log('[Connect] Customer updated:', (event.data.object as Stripe.Customer).id);
  } else if (
    event.type === 'customer.tax_id.created' ||
    event.type === 'customer.tax_id.deleted' ||
    event.type === 'customer.tax_id.updated'
  ) {
    // Tax ID changes — Stripe validates some types asynchronously.
    // TODO: update tax status in your DB if you collect tax IDs
    console.log('[Connect] Tax ID event:', event.type);
  } else if (
    event.type === 'billing_portal.configuration.created' ||
    event.type === 'billing_portal.configuration.updated' ||
    event.type === 'billing_portal.session.created'
  ) {
    console.log('[Connect] Billing portal event:', event.type);
  }

  return c.json({ received: true });
});

export { app as stripeConnectRoute };
