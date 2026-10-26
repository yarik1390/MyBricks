// Per-IP request ceiling for the whole /api surface (security review
// 2026-10-26). The API is served on workers.dev, outside the bricksvault.app
// zone, so a Cloudflare WAF rule can't cover it — this uses the Workers Rate
// Limiting binding instead (counters are per Cloudflare location, no D1 write).
//
// Signed-out callers get a lower ceiling than signed-in ones. The Authorization
// header isn't verified here (requireMember does that later), so a forged
// header only buys the higher ceiling, never data. /api/img is exempt: one
// catalog grid loads dozens of thumbnails at once, and they're edge-cached.
// Fails open: no binding (tests, local dev) or no client IP means no limit.
import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types';

const EXEMPT = /^\/api\/img(?:\/|$)/;

export const ipRateLimit: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  if (c.req.method === 'OPTIONS' || EXEMPT.test(c.req.path)) return next();
  const ip = c.req.header('cf-connecting-ip');
  const signedIn = !!c.req.header('authorization');
  const limiter = signedIn ? c.env.API_RATE_LIMITER : c.env.PUBLIC_RATE_LIMITER;
  if (!ip || !limiter) return next();
  let ok = true;
  try {
    ({ success: ok } = await limiter.limit({ key: ip }));
  } catch { /* limiter unavailable — fail open */ }
  if (!ok) {
    c.header('Retry-After', '60');
    return c.json({ error: 'Too many requests, please slow down.' }, 429);
  }
  return next();
};
