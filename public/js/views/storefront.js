/**
 * Public storefront — displays a connected account's products and lets
 * customers buy them via Stripe Checkout (Direct Charge).
 *
 * Route: #/store/:accountId
 *
 * TODO: In production, route storefronts by a seller handle or slug rather
 * than the raw Stripe account ID (acct_...) in the URL. The account ID works
 * for a demo but exposes internal identifiers publicly. Example:
 *   Current:    #/store/acct_1ABC...
 *   Production: #/store/brickheavenstore   (resolved server-side to acct_...)
 */

import { $, $$, toast, escapeHtml, haptic } from '../utils.js';

/** Render the public storefront for a connected account.
 *  @param {string} accountId — raw Stripe account ID (acct_...)
 */
export async function renderStorefront(accountId) {
  const root = $('#root');
  if (!accountId) {
    root.innerHTML = '<div class="page"><div class="card"><p>Invalid store URL.</p></div></div>';
    return;
  }

  // Skeleton while loading.
  root.innerHTML = `
    <div class="page">
      <div class="storefront-header">
        <h1 class="page-title" style="margin-bottom:4px;">Store</h1>
        <p class="u-mute connect-account-id">${escapeHtml(accountId)}</p>
      </div>
      <div class="skel" style="height:100px;border-radius:var(--r-2);margin-bottom:8px;"></div>
      <div class="skel" style="height:100px;border-radius:var(--r-2);margin-bottom:8px;"></div>
    </div>`;

  // Check for purchase success flag from the Stripe redirect.
  const hashParams = new URLSearchParams(location.hash.split('?')[1] || '');
  if (hashParams.get('checkout') === 'success') {
    toast('Purchase complete! Thank you.', 'success');
    history.replaceState(null, '', `#/store/${accountId}`);
  }

  // Load products from the public storefront endpoint (no auth required).
  let products = [];
  try {
    const result = await fetch(
      `/api/connect/storefront/${encodeURIComponent(accountId)}`
    ).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));
    products = result.products ?? [];
  } catch (e) {
    root.innerHTML = `
      <div class="page">
        <div class="card">
          <p class="u-mute">Could not load store: ${escapeHtml(e.message)}</p>
        </div>
      </div>`;
    return;
  }

  // Render the product grid (or empty state).
  root.innerHTML = `
    <div class="page">
      <div class="storefront-header" style="margin-bottom:16px;">
        <h1 class="page-title" style="margin-bottom:4px;">Store</h1>
        <!-- TODO: replace with the seller's display name once you have a handle/slug lookup -->
        <p class="u-mute connect-account-id">${escapeHtml(accountId)}</p>
      </div>

      ${products.length === 0 ? `
        <div class="card" style="text-align:center;padding:32px;">
          <p class="u-mute">No products available yet.</p>
          <p class="u-mute" style="font-size:12px;">Check back soon.</p>
        </div>` : `
        <div class="product-grid" id="product-grid">
          ${products.map(p => {
            const price = p.default_price;
            const priceId = price?.id ?? '';
            const unitAmount = price?.unit_amount ?? 0;
            const amount = unitAmount ? (unitAmount / 100).toFixed(2) : '—';
            const currency = (price?.currency ?? 'usd').toUpperCase();

            return `
              <div class="card product-card">
                <div style="margin-bottom:10px;">
                  <h2 style="margin:0 0 4px;font-size:16px;font-weight:700;">${escapeHtml(p.name)}</h2>
                  ${p.description ? `<p class="u-mute" style="font-size:13px;margin:0 0 8px;line-height:1.4;">${escapeHtml(p.description)}</p>` : ''}
                </div>
                <div class="u-between" style="align-items:center;">
                  <span class="product-price">${currency} ${amount}</span>
                  ${priceId ? `
                    <button
                      class="btn-primary buy-btn"
                      data-price-id="${escapeHtml(priceId)}"
                      data-amount="${unitAmount}"
                      style="padding:8px 18px;">
                      Buy Now
                    </button>` : `<span class="u-mute" style="font-size:12px;">No price set</span>`}
                </div>
              </div>`;
          }).join('')}
        </div>`}
    </div>`;

  // Wire up Buy Now buttons.
  $$('.buy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      haptic('medium');
      const priceId = btn.dataset.priceId;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';

      try {
        const res = await fetch(`/api/connect/storefront/${encodeURIComponent(accountId)}/checkout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price_id: priceId, quantity: 1 }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const { url } = await res.json();
        window.location.href = url;
      } catch (e) {
        toast(e.message || 'Could not start checkout.', 'error');
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  });
}
