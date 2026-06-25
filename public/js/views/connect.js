/**
 * Connect Dashboard — lets authenticated users create a Stripe connected
 * account, complete onboarding, manage products, and subscribe to the
 * Brickvault platform plan.
 *
 * Route: #/connect
 *
 * Stripe Connect setup checklist:
 *   1. wrangler secret put STRIPE_SECRET_KEY
 *   2. Register /api/connect/webhook/connect in Stripe Dashboard
 *      (thin events, Connected accounts, see route file for event list)
 *   3. wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET
 *   4. Create a recurring price in Stripe Dashboard and
 *      wrangler secret put STRIPE_CONNECT_SUBSCRIPTION_PRICE_ID
 *   5. Register /api/connect/webhook/subscriptions in Stripe Dashboard
 *   6. wrangler secret put STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
 */

import { $, $$, toast, escapeHtml, haptic } from '../utils.js';
import { api } from '../api.js';
import { go } from '../router.js';

/** Render the Connect dashboard for the authenticated user. */
export async function renderConnect() {
  const root = $('#root');

  // Show a skeleton while loading.
  root.innerHTML = `
    <div class="page">
      <h1 class="page-title">Connected Account</h1>
      <div class="skel" style="height:120px;border-radius:var(--r-2);margin-bottom:12px;"></div>
      <div class="skel" style="height:200px;border-radius:var(--r-2);"></div>
    </div>`;

  // Check whether the user already has a connected account.
  let account = null;
  try {
    account = await api('/api/connect/accounts/me');
  } catch (e) {
    if (!e.message?.includes('404') && !e.status === 404) {
      toast('Failed to load account status: ' + e.message, 'error');
    }
    // 404 = no account yet — show the creation form.
  }

  // Handle return from Stripe onboarding (return_url includes ?accountId=acct_...)
  const hashParams = new URLSearchParams(location.hash.split('?')[1] || '');
  if (hashParams.get('accountId')) {
    toast('Onboarding submitted! Status updates may take a moment.', 'success');
    // Clean up the URL without triggering a re-render.
    history.replaceState(null, '', '#/connect');
  }
  if (hashParams.get('subscribed')) {
    toast('Subscribed successfully!', 'success');
    history.replaceState(null, '', '#/connect');
  }

  if (!account) {
    renderCreateForm(root);
    return;
  }

  renderDashboard(root, account);
}

// ─── create-account form ─────────────────────────────────────────────────────

function renderCreateForm(root) {
  root.innerHTML = `
    <div class="page">
      <h1 class="page-title">Connected Account</h1>

      <div class="card" style="margin-bottom:12px;">
        <h2 class="section-title" style="margin-top:0;">Become a Seller</h2>
        <p class="u-mute" style="font-size:13px;margin-bottom:16px;line-height:1.5;">
          Create a connected account to sell products, accept card payments, and
          build a public storefront. Brickvault earns a 5% platform fee on each
          transaction.
        </p>

        <label class="field-lbl">Store / Display Name</label>
        <input class="field-input" id="ca-name" placeholder="e.g. Brick Heaven" autocomplete="organization">

        <label class="field-lbl" style="margin-top:10px;">Email for Stripe receipts</label>
        <input class="field-input" id="ca-email" type="email" placeholder="payments@example.com" autocomplete="email">

        <button class="btn-primary" id="create-account-btn" style="margin-top:16px;width:100%;">
          Create Connected Account
        </button>
      </div>

      <p class="u-mute" style="font-size:11px;text-align:center;padding:0 16px;">
        Powered by Stripe. Your financial information is handled directly by Stripe
        and is never stored on Brickvault's servers.
      </p>
    </div>`;

  $('#create-account-btn')?.addEventListener('click', async () => {
    const name = $('#ca-name')?.value?.trim();
    const email = $('#ca-email')?.value?.trim();
    if (!name || !email) { toast('Please fill in both fields.', 'error'); return; }

    haptic('medium');
    const btn = $('#create-account-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      await api('/api/connect/accounts', { method: 'POST', body: { display_name: name, email } });
      toast('Account created! Complete onboarding to start accepting payments.', 'success');
      go('#/connect');
    } catch (e) {
      toast(e.message || 'Could not create account.', 'error');
      btn.disabled = false;
      btn.textContent = 'Create Connected Account';
    }
  });
}

// ─── dashboard (account exists) ──────────────────────────────────────────────

function renderDashboard(root, account) {
  const {
    stripe_account_id,
    display_name,
    ready_to_process,
    onboarding_complete,
    requirements_status,
    card_payments_status,
    subscription_status,
  } = account;

  // Status badge: green when ready, yellow while onboarding, red if issues.
  const badgeClass = ready_to_process
    ? 'status-badge status-active'
    : (requirements_status === 'past_due' ? 'status-badge status-past-due' : 'status-badge status-pending');
  const badgeLabel = ready_to_process ? 'Active' : (onboarding_complete ? 'Pending review' : 'Onboarding needed');

  // Subscription section differs based on current status.
  const subActive = subscription_status === 'active';
  const subCancelAtEnd = subscription_status === 'cancel_at_period_end';
  const subPaused = subscription_status === 'paused';
  const subCanceled = !subscription_status || subscription_status === 'canceled';

  const subscriptionHTML = subCanceled
    ? `<button class="btn-primary" id="subscribe-btn" style="width:100%;">Subscribe — $5 / month</button>`
    : `
      <div class="u-between" style="margin-bottom:12px;">
        <span style="font-size:13px;font-weight:600;">Platform subscription</span>
        <span class="${subActive ? 'status-badge status-active' : 'status-badge status-pending'}">
          ${subPaused ? 'Paused' : subCancelAtEnd ? 'Cancels at period end' : 'Active'}
        </span>
      </div>
      <button class="btn-secondary" id="billing-portal-btn" style="width:100%;">Manage Subscription</button>`;

  root.innerHTML = `
    <div class="page">
      <h1 class="page-title">Connected Account</h1>

      <!-- ── Account status ── -->
      <div class="card" style="margin-bottom:12px;">
        <div class="u-between" style="align-items:flex-start;">
          <div>
            <h2 class="section-title" style="margin:0 0 2px;">${escapeHtml(display_name || 'Your Store')}</h2>
            <!-- TODO: replace raw account ID with a seller handle/slug in production -->
            <div class="connect-account-id">${escapeHtml(stripe_account_id)}</div>
          </div>
          <span class="${badgeClass}">${badgeLabel}</span>
        </div>

        ${!onboarding_complete ? `
          <p class="u-mute" style="font-size:12px;margin:8px 0 12px;line-height:1.4;">
            Complete onboarding to verify your identity and enable card payments.
          </p>
          <button class="btn-primary" id="onboard-btn" style="width:100%;margin-bottom:8px;">
            Complete Onboarding →
          </button>` : ''}

        <a href="#/store/${escapeHtml(stripe_account_id)}"
           class="btn-secondary"
           style="display:block;text-align:center;text-decoration:none;margin-top:${onboarding_complete ? '0' : '0'};">
          View Storefront →
        </a>
      </div>

      <!-- ── Create product ── -->
      <h2 class="section-title">Products</h2>
      <div class="card" style="margin-bottom:12px;">
        <input class="field-input" id="prod-name" placeholder="Product name" style="margin-bottom:8px;">
        <input class="field-input" id="prod-desc" placeholder="Description (optional)" style="margin-bottom:8px;">
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <div style="flex:1;">
            <input class="field-input" id="prod-price" type="number" step="0.01" min="0.50" placeholder="Price (USD)">
          </div>
        </div>
        <button class="btn-primary" id="create-product-btn" style="width:100%;">Add Product</button>
      </div>

      <!-- ── Product list ── -->
      <div id="products-list"></div>

      <!-- ── Platform subscription ── -->
      <h2 class="section-title">Platform Subscription</h2>
      <div class="card" style="margin-bottom:12px;">
        <p class="u-mute" style="font-size:12px;margin-bottom:12px;line-height:1.4;">
          Subscribe to the Brickvault platform plan for priority support and
          additional seller features.
        </p>
        ${subscriptionHTML}
      </div>
    </div>`;

  // Load existing products.
  loadProducts(stripe_account_id);

  // Wire up event listeners.

  $('#onboard-btn')?.addEventListener('click', async () => {
    haptic('medium');
    const btn = $('#onboard-btn');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const { url } = await api('/api/connect/accounts/me/onboard', { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      toast(e.message || 'Could not start onboarding.', 'error');
      btn.disabled = false;
      btn.textContent = 'Complete Onboarding →';
    }
  });

  $('#create-product-btn')?.addEventListener('click', async () => {
    const name = $('#prod-name')?.value?.trim();
    const desc = $('#prod-desc')?.value?.trim();
    const price = parseFloat($('#prod-price')?.value);

    if (!name) { toast('Product name is required.', 'error'); return; }
    if (!price || price < 0.50) { toast('Price must be at least $0.50.', 'error'); return; }

    haptic('medium');
    const btn = $('#create-product-btn');
    btn.disabled = true;
    btn.textContent = 'Creating…';

    try {
      await api('/api/connect/accounts/me/products', {
        method: 'POST',
        body: { name, description: desc || undefined, price },
      });
      toast(`"${name}" added to your store!`, 'success');
      $('#prod-name').value = '';
      $('#prod-desc').value = '';
      $('#prod-price').value = '';
      loadProducts(stripe_account_id);
    } catch (e) {
      toast(e.message || 'Could not create product.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add Product';
    }
  });

  $('#subscribe-btn')?.addEventListener('click', async () => {
    haptic('medium');
    const btn = $('#subscribe-btn');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const { url } = await api('/api/connect/accounts/me/subscribe', { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      toast(e.message || 'Could not start subscription.', 'error');
      btn.disabled = false;
      btn.textContent = 'Subscribe — $5 / month';
    }
  });

  $('#billing-portal-btn')?.addEventListener('click', async () => {
    haptic('light');
    const btn = $('#billing-portal-btn');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const { url } = await api('/api/connect/accounts/me/billing-portal', { method: 'POST' });
      window.location.href = url;
    } catch (e) {
      toast(e.message || 'Could not open billing portal.', 'error');
      btn.disabled = false;
      btn.textContent = 'Manage Subscription';
    }
  });
}

async function loadProducts(stripeAccountId) {
  const list = $('#products-list');
  if (!list) return;

  list.innerHTML = '<div class="skel" style="height:80px;border-radius:var(--r-2);margin-bottom:8px;"></div>';

  try {
    const { products } = await api('/api/connect/accounts/me/products');
    if (!products.length) {
      list.innerHTML = '';
      return;
    }

    list.innerHTML = products.map(p => {
      const price = p.default_price;
      const amount = price?.unit_amount != null ? (price.unit_amount / 100).toFixed(2) : '—';
      const currency = (price?.currency ?? 'usd').toUpperCase();
      // TODO: in production use a seller handle/slug instead of raw account ID
      const storeUrl = `${location.origin}/#/store/${encodeURIComponent(stripeAccountId)}`;
      return `
        <div class="card product-card" style="margin-bottom:8px;">
          <div class="u-between" style="align-items:flex-start;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:15px;margin-bottom:2px;">${escapeHtml(p.name)}</div>
              ${p.description ? `<div class="u-mute" style="font-size:12px;margin-bottom:6px;">${escapeHtml(p.description)}</div>` : ''}
            </div>
            <span class="product-price" style="margin-left:12px;">${currency} ${amount}</span>
          </div>
          <button class="btn-secondary copy-link-btn" data-url="${escapeHtml(storeUrl)}"
                  style="font-size:12px;padding:6px 12px;">
            Copy Store Link
          </button>
        </div>`;
    }).join('');

    $$('.copy-link-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.url).then(() => toast('Store link copied!', 'success'));
      });
    });
  } catch (e) {
    list.innerHTML = `<p class="u-mute" style="font-size:13px;padding:8px 0;">Could not load products: ${escapeHtml(e.message)}</p>`;
  }
}
