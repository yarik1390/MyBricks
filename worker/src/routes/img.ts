import { Hono } from 'hono';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Reliability + speed: product imagery is hotlinked from external catalog CDNs
// today, so an outage/slowdown/hotlink-block there breaks the bulk of the app's
// images. This route serves a durable copy from our own Cloudflare R2 (fronted
// by the Cloudflare edge cache), fetching + storing each image on first request.
// Image URLs are rewritten through here at the API layer; if R2 or the upstream
// is unavailable it falls back to a redirect to the source, so an image never
// hard-breaks.

// Only these hosts may be proxied — an allowlist prevents this becoming an open
// proxy / SSRF vector. They are the CDNs the catalog currently hotlinks.
const ALLOWED_IMG_HOSTS = new Set<string>([
  'cdn.rebrickable.com',
  'm.rebrickable.com',
  'images.brickset.com',
  'img.bricklink.com',
  'images.lego.com',
]);

// Catalog images are effectively immutable per set/fig, so cache hard at the
// browser + Cloudflare edge.
const IMMUTABLE = 'public, max-age=31536000, immutable';

// Stable R2 key from the full source URL (host-agnostic, collision-safe).
async function r2Key(url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `img/${hex}`;
}

// GET /api/img?u=<external image url> — public (images load without auth).
app.get('/', async (c) => {
  const raw = c.req.query('u');
  if (!raw) return c.json({ error: 'u required' }, 400);

  let target: URL;
  try { target = new URL(raw); } catch { return c.json({ error: 'bad url' }, 400); }
  if (target.protocol !== 'https:' || !ALLOWED_IMG_HOSTS.has(target.hostname)) {
    return c.json({ error: 'host not allowed' }, 400);
  }
  const src = target.toString();
  const redirectToOrigin = () => c.redirect(src, 302);

  const cache = caches.default;

  // 1) Cloudflare edge cache — fastest, shared across users.
  const hit = await cache.match(c.req.raw).catch(() => undefined);
  if (hit) return hit;

  const key = await r2Key(src);

  // 2) Our durable R2 copy — no external dependency once stored.
  if (c.env.PHOTO_BUCKET) {
    const obj = await c.env.PHOTO_BUCKET.get(key).catch(() => null);
    if (obj) {
      const headers = new Headers();
      headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', IMMUTABLE);
      const resp = new Response(obj.body, { headers });
      c.executionCtx.waitUntil(cache.put(c.req.raw, resp.clone()).catch(() => {}));
      return resp;
    }
  }

  // 3) First request: fetch from the source, store in R2, edge-cache, serve.
  //    Any failure → redirect to the source so the image still loads.
  let upstream: Response;
  try {
    upstream = await fetch(src, { headers: { Accept: 'image/*' } });
  } catch {
    return redirectToOrigin();
  }
  if (!upstream.ok) return redirectToOrigin();
  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) return redirectToOrigin();

  const bytes = await upstream.arrayBuffer();
  if (c.env.PHOTO_BUCKET) {
    c.executionCtx.waitUntil(
      c.env.PHOTO_BUCKET.put(key, bytes, { httpMetadata: { contentType } }).catch(() => {}),
    );
  }
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', IMMUTABLE);
  const resp = new Response(bytes, { headers });
  c.executionCtx.waitUntil(cache.put(c.req.raw, resp.clone()).catch(() => {}));
  return resp;
});

export { app as imgRoute };
