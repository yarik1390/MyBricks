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

  // Optional downscale for the catalog grid: ?w=<px> serves a smaller thumbnail
  // (via Cloudflare Image Resizing) so the offline image cache holds far more
  // sets per byte. Best-effort — if Image Resizing isn't enabled on the account
  // the cf.image directive is ignored and the full image is returned, so this
  // never breaks. Thumbnails are keyed separately from the full image so the two
  // never collide in R2 or the edge cache.
  const rawW = Number(c.req.query('w'));
  const width = Number.isFinite(rawW) && rawW >= 64 && rawW <= 1024 ? Math.round(rawW) : 0;

  const cache = (caches as unknown as { default: Cache }).default;

  // 1) Cloudflare edge cache — fastest, shared across users. The request URL
  //    includes ?w=, so thumbnails and full images cache under distinct keys.
  const hit = await cache.match(c.req.raw).catch(() => undefined);
  if (hit) {
    // Responses served from the Cache API arrive with the edge's
    // no-store override; re-assert cacheability so the browser/SW
    // can actually cache product images (repeat views hit local).
    const h = new Headers(hit.headers);
    h.set('Cache-Control', IMMUTABLE);
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: h });
  }

  const baseKey = await imageR2Key(src);
  const key = width ? `${baseKey}@w${width}` : baseKey;

  // 2) Our durable R2 copy — no external dependency once stored.
  if (c.env.PHOTO_BUCKET) {
    const obj = await c.env.PHOTO_BUCKET.get(key).catch(() => null);
    if (obj) {
      const headers = new Headers();
      headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
      headers.set('Cache-Control', IMMUTABLE);
      // Public product images — allow the browser to read pixels on a canvas
      // (the set-detail hero samples the photo's background to pick between the
      // floating-cutout and framed-plate presentation).
      headers.set('Access-Control-Allow-Origin', '*');
      const resp = new Response(obj.body, { headers });
      c.executionCtx.waitUntil(cache.put(c.req.raw, resp.clone()).catch(() => {}));
      return resp;
    }
  }

  // 3) First request: fetch from the source, store in R2, edge-cache, serve.
  //    Any failure → redirect to the source so the image still loads. The one
  //    exception is a DEFINITIVE upstream miss (404/410): the file does not
  //    exist at the source (Rebrickable has no photo for some rare/exclusive
  //    figs), so redirecting just hands the client another failure and every
  //    later view repeats the round-trip. Serve a transparent 1×1 GIF instead —
  //    callers render a real silhouette placeholder behind/instead of it.
  const PLACEHOLDER_GIF = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const placeholderResponse = () => new Response(
    (() => { const bin = atob(PLACEHOLDER_GIF); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i); return buf; })(),
    { headers: { 'Content-Type': 'image/gif', 'Cache-Control': IMMUTABLE } },
  );
  let upstream: Response;
  try {
    // Best-effort resize via Cloudflare Image Resizing; the cf.image directive
    // is ignored (full image returned) when the feature isn't enabled. Cast to
    // any because the workers-types RequestInit.cf expects the inbound-request
    // CfProperties shape, not the fetch-time image-resizing subset.
    const init = { headers: { Accept: 'image/*' } } as RequestInit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (width) (init as any).cf = { image: { width, quality: 82, fit: 'scale-down', format: 'auto' } };
    upstream = await fetch(src, init);
  } catch {
    return redirectToOrigin();
  }
  if (!upstream.ok) return upstream.status === 404 || upstream.status === 410 ? placeholderResponse() : redirectToOrigin();
  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/') || !upstream.body) return redirectToOrigin();

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', IMMUTABLE);
  headers.set('Access-Control-Allow-Origin', '*');

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
