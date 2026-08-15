import { describe, expect, it } from 'vitest';
import { wishlistRoute } from './routes/wishlist';

/**
 * Route wiring tests for the wishlist target-alert acknowledgement endpoint.
 * Behavioral coverage lives in routes.test.ts (wishlist CRUD + mark-read via
 * the real Hono app against a hand-rolled D1 fixture); these assert that the
 * new acknowledgement endpoint is registered with the expected signature.
 */
describe('wishlist target-alert acknowledgement route', () => {
  const routes = wishlistRoute.routes;

  it('registers POST /:id/acknowledge-alert', () => {
    const ack = routes.find((r) => r.method === 'POST' && r.path === '/:id/acknowledge-alert');
    expect(ack).toBeDefined();
  });

  it('keeps the existing mark-read POST /:id registered', () => {
    const markRead = routes.find((r) => r.method === 'POST' && r.path === '/:id');
    expect(markRead).toBeDefined();
  });
});
