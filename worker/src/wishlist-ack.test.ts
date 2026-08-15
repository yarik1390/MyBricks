import { describe, expect, it } from 'vitest';
import { wishlistRoute } from './routes/wishlist';

/**
 * Route wiring tests for the wishlist target-alert acknowledgement endpoint.
 * Asserts against the Hono router's registered routes (no fs, no DB needed),
 * so it runs in the workerd vitest pool. Behavioral coverage of the alert
 * semantics lives in the frontend unit tests (lib/pure.js helpers) and the
 * guest-mode browser check.
 */
describe('wishlist target-alert acknowledgement route', () => {
  it('registers POST /:id/acknowledge-alert for persistent dismissal', () => {
    const found = wishlistRoute.routes.some(
      (r) => r.method === 'POST' && r.path === '/:id/acknowledge-alert'
    );
    expect(found).toBe(true);
  });

  it('exposes acknowledged_at in the wishlist read projection handler', async () => {
    const getHandler = wishlistRoute.routes.find((r) => r.method === 'GET' && r.path === '/');
    expect(getHandler).toBeTruthy();
    const handlerSrc = getHandler.handler.toString();
    expect(handlerSrc).toMatch(/w\.acknowledged_at/);
    const ackHandler = wishlistRoute.routes.find(
      (r) => r.method === 'POST' && r.path === '/:id/acknowledge-alert'
    );
    const ackSrc = ackHandler.handler.toString();
    expect(ackSrc).toMatch(/acknowledged_at = CURRENT_TIMESTAMP/);
    expect(ackSrc).toMatch(/WHERE id = \? AND user_id = \?/);
  });
});
