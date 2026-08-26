// Shared host allowlist + URL rewriting for the R2 image proxy (/api/img).
// Single source of truth so the proxy's SSRF guard (routes/img.ts) and the
// response rewriter (the API middleware) agree on exactly which hosts proxy.

// Rebrickable explicitly permits caching Set / Part / Minifig images (they even
// recommend it over hotlinking). MOC images, though also on this CDN, are
// excluded at the field level (see IMG_KEYS) — Rebrickable prohibits using MOC
// images for any purpose.
//
// images.brickset.com joined 2026-08: Brickset's CDN rejects BROWSER image
// loads outright (verified live 2026-08-26 — every <img> fails in ~30ms while
// the same URL returns 200 to a server-side fetch), so hotlinking produced a
// dead photo gallery: thumbnails collapsed to 2px until each errored and the
// Photos card silently dropped itself. Serving through /api/img keeps the
// gallery functional; the required attribution is already rendered directly
// under the gallery ("Images courtesy of Brickset" link, portfolio-detail.js),
// and stays attached wherever these images appear.
export const ALLOWED_IMG_HOSTS = new Set<string>([
  'cdn.rebrickable.com',
  'images.brickset.com',
]);

// Stable R2 object key for a source image URL. Normalizes via URL.toString()
// so the proxy (serve path) and the pre-warm cron (fill path) derive the SAME
// key for the same image — otherwise warmed objects wouldn't be found on read.
export async function imageR2Key(url: string): Promise<string> {
  const norm = new URL(url).toString();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `img/${hex}`;
}

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

// Image-URL field names the API emits. moc_img_url is intentionally EXCLUDED —
// Rebrickable prohibits using MOC images for any purpose, so they are never
// proxied/cached (they remain hotlinked in the build view, a separate decision).
const IMG_KEYS = new Set(['image_url', 'fig_img_url', 'part_img_url', 'set_img_url']);

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
