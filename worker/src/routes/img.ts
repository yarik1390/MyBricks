import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { ALLOWED_IMG_HOSTS, imageR2Key } from '../lib/img-proxy';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Reliability + speed: product imagery is hotlinked from external catalog CDNs
// today, so an outage/slowdown/hotlink-block there breaks the bulk of the app's
// images. This route serves a durable copy from our own Cloudflare R2 (fronted
// by the Cloudflare edge cache), fetching + storing each image on first request.
// Image URLs are rewritten through here at the API layer; if R2 or the upstream
// is unavailable it falls back to a redirect to the source, so an image never
// hard-breaks.

// Host allowlist (ALLOWED_IMG_HOSTS) is shared with the response rewriter so the
// SSRF guard here and the URL rewriting stay in lock-step.

// Catalog images are effectively immutable per set/fig, so cache hard at the
// browser + Cloudflare edge.
const IMMUTABLE = 'public, max-age=31536000, immutable';

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

  const key = await imageR2Key(src);

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
  if (!contentType.startsWith('image/') || !upstream.body) return redirectToOrigin();

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', IMMUTABLE);

  // Stream the image straight to the client instead of buffering the whole file
  // into the Worker first (the old `await arrayBuffer()` made cold images wait
  // for the full upstream download before a single byte reached the browser).
  // A tee lets the second branch fill R2 + the edge cache in the background.
  const [clientStream, storeStream] = upstream.body.tee();
  c.executionCtx.waitUntil((async () => {
    try {
      const buf = await new Response(storeStream).arrayBuffer();
      if (c.env.PHOTO_BUCKET) {
        await c.env.PHOTO_BUCKET.put(key, buf, { httpMetadata: { contentType } }).catch(() => {});
      }
      await cache.put(c.req.raw, new Response(buf, { headers })).catch(() => {});
    } catch { /* best-effort persist — the client already got the bytes */ }
  })());
  return new Response(clientStream, { headers });
});

export { app as imgRoute };
