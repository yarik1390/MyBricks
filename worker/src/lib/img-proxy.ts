// Shared host allowlist + URL rewriting for the R2 image proxy (/api/img).
// Single source of truth so the proxy's SSRF guard (routes/img.ts) and the
// response rewriter (the API middleware) agree on exactly which hosts proxy.

export const ALLOWED_IMG_HOSTS = new Set<string>([
  'cdn.rebrickable.com',
  'm.rebrickable.com',
  'images.brickset.com',
  'img.bricklink.com',
  'images.lego.com',
]);

// Rewrite one external image URL to the proxy, or return it unchanged when it
// isn't a proxiable external image (relative / data: / our own /api path /
// non-allowlisted host). origin is the API worker origin (absolute, since images
// load cross-origin from the Pages app).
export function proxyImageUrl(value: string, origin: string): string {
  if (!value || !value.startsWith('https://')) return value;
  let host: string;
  try { host = new URL(value).hostname; } catch { return value; }
  if (!ALLOWED_IMG_HOSTS.has(host)) return value;
  return `${origin}/api/img?u=${encodeURIComponent(value)}`;
}

// Image-URL field names the API emits (set / minifig / MOC / part thumbnails).
const IMG_KEYS = new Set(['image_url', 'fig_img_url', 'moc_img_url', 'part_img_url', 'set_img_url']);

// Recursively rewrite known image-URL fields (and the gallery `images` string
// array) in a parsed JSON response so clients load images via our Cloudflare
// proxy. Only allowlisted external hosts are rewritten; everything else (incl.
// our own /api/collection/:id/photo custom photos) passes through. Mutates and
// returns the node.
export function rewriteImages(node: unknown, origin: string): unknown {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = rewriteImages(node[i], origin);
    return node;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && IMG_KEYS.has(k)) {
        obj[k] = proxyImageUrl(v, origin);
      } else if (k === 'images' && Array.isArray(v)) {
        obj[k] = v.map((x) => (typeof x === 'string' ? proxyImageUrl(x, origin) : rewriteImages(x, origin)));
      } else if (v && typeof v === 'object') {
        obj[k] = rewriteImages(v, origin);
      }
    }
    return obj;
  }
  return node;
}
