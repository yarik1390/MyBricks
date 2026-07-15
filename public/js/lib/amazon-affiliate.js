import { I } from '../icons.js';
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export const AMAZON_OFFER_TTL_MS = 23 * 60 * 60 * 1000;

export function amazonOfferIsFresh(offer, now = Date.now()) {
  if (!offer?.checked_at || !Number(offer.price)) return false;
  const checked = Date.parse(offer.checked_at);
  return Number.isFinite(checked) && now - checked >= 0 && now - checked < AMAZON_OFFER_TTL_MS;
}

export function brickvaultPlatform(win = globalThis.window) {
  return isNativeCapacitor(win) ? 'android' : 'web';
}

function checkedLabel(value) {
  const ts = Date.parse(value || '');
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatOfferMoney(value, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'EUR' }).format(value);
  } catch {
    return `${currency || 'EUR'} ${Number(value).toFixed(2)}`;
  }
}

export function amazonSlotHTML(setNum, { compact = false } = {}) {
  return `<div class="amazon-affiliate-slot${compact ? ' amazon-affiliate-slot--compact' : ''}" data-amazon-slot="${escapeHtml(setNum)}" aria-live="polite"></div>`;
}

export function amazonOfferHTML(offer, { compact = false } = {}) {
  if (!offer?.available || !offer.url) return '';
  const freshOffer = offer.mode === 'creators_api' && amazonOfferIsFresh(offer);
  const price = freshOffer ? Number(offer.price) : null;
  const checked = freshOffer ? checkedLabel(offer.checked_at) : '';
  const priceLine = price
    ? `<strong>${escapeHtml(formatOfferMoney(price, offer.currency))}</strong><span>${escapeHtml(offer.availability || '')}</span>`
    : '<strong>Check current price</strong>';
  return `
    <div class="amazon-affiliate-card${compact ? ' amazon-affiliate-card--compact' : ''}">
      <div class="amazon-affiliate-copy">
        <span class="u-mono-label">Buy now</span>
        <div class="amazon-affiliate-price">${priceLine}</div>
        ${checked ? `<small>Price checked ${escapeHtml(checked)}. ${escapeHtml(offer.price_disclaimer || '')}</small>` : ''}
      </div>
      <a class="btn-secondary amazon-affiliate-link" href="${escapeHtml(offer.url)}" target="_blank" rel="sponsored nofollow noopener" data-amazon-external>
        <span>Amazon</span>${I.extLink({ w: 15, h: 15 })}
      </a>
      ${compact ? '' : `<p class="amazon-affiliate-disclosure">${escapeHtml(offer.disclosure || 'As an Amazon Associate, Brickvault earns from qualifying purchases.')}</p>`}
    </div>`;
}

export async function openExternalCommerce(url, win = globalThis.window) {
  if (!url) return false;
  if (isNativeCapacitor(win)) {
    const Browser = getCapacitorPlugin('Browser', win);
    if (!Browser?.open) return false;
    await Browser.open({ url });
    return true;
  }
  const opened = win?.open?.(url, '_blank', 'noopener,noreferrer');
  return opened !== null && opened !== undefined;
}

function wireExternalLink(container) {
  container.querySelector('[data-amazon-external]')?.addEventListener('click', async (event) => {
    if (!isNativeCapacitor()) return;
    event.preventDefault();
    const href = event.currentTarget.href;
    try {
      const opened = await openExternalCommerce(href);
      if (!opened) {
        const { toast } = await import('../utils.js');
        toast('Could not open Amazon', 'error');
      }
    } catch {
      const { toast } = await import('../utils.js');
      toast('Could not open Amazon', 'error');
    }
  });
}

export async function hydrateAmazonSlot(containerOrSelector, setNum, market = 'FR', options = {}) {
  const container = typeof containerOrSelector === 'string'
    ? document.querySelector(containerOrSelector)
    : containerOrSelector;
  if (!container || !setNum) return null;
  container.setAttribute('aria-busy', 'true');
  try {
    const { api } = await import('../api.js');
    const offer = await api(`/api/sets/${encodeURIComponent(setNum)}/amazon?market=${encodeURIComponent(market || 'FR')}`);
    const html = amazonOfferHTML(offer, options);
    container.innerHTML = html;
    container.hidden = !html;
    if (html) wireExternalLink(container);
    return offer;
  } catch {
    container.innerHTML = '';
    container.hidden = true;
    return null;
  } finally {
    container.removeAttribute('aria-busy');
  }
}

export function hydrateAmazonSlots(root = document, market = 'FR') {
  const tasks = Array.from(root.querySelectorAll('[data-amazon-slot]')).map((slot) =>
    hydrateAmazonSlot(slot, slot.dataset.amazonSlot, market, {
      compact: slot.classList.contains('amazon-affiliate-slot--compact'),
    })
  );
  return Promise.allSettled(tasks);
}
