import Stripe from 'stripe';

// Shared factory — Cloudflare Workers require the fetch-based HTTP client.
export function makeStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}
