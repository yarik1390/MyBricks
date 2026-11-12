import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAdmin } from '../auth';
import { EMBED_SHAPES, embedImage, type EmbedShape } from '../lib/scan-embed';

/**
 * Admin-only tooling for the scan image index: embed images with the Workers
 * AI multimodal model so the offline eval (scripts/scan-eval) can measure
 * accuracy before the index answers any user scan. Read-only: no D1 writes.
 */
export const adminScanVectorsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
adminScanVectorsRoute.use('*', requireAdmin);

// Images are fetched by the Worker from these hosts only (no open proxy).
const ALLOWED_HOSTS = new Set(['cdn.rebrickable.com', 'live.staticflickr.com', 'images.brickset.com']);
const MAX_BYTES = 3_000_000;
const MAX_ITEMS = 8;

export function allowedImageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) return null;
    return u;
  } catch { return null; }
}

adminScanVectorsRoute.post('/embed', async (c) => {
  const body = await c.req.json<{ urls?: unknown; shape?: unknown; model?: unknown }>().catch(() => null);
  const urls = Array.isArray(body?.urls) ? (body!.urls as unknown[]).filter((u): u is string => typeof u === 'string').slice(0, MAX_ITEMS) : [];
  if (!urls.length) return c.json({ error: 'urls required' }, 400);
  const shape = (EMBED_SHAPES as string[]).includes(String(body?.shape)) ? (body!.shape as EmbedShape) : undefined;
  const model = typeof body?.model === 'string' ? body.model : undefined;
  const results = await Promise.all(urls.map(async (raw) => {
    const u = allowedImageUrl(raw);
    if (!u) return { url: raw, vector: null, error: 'url not allowed', ms: 0 };
    try {
      const res = await fetch(u.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { url: raw, vector: null, error: `fetch ${res.status}`, ms: 0 };
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) return { url: raw, vector: null, error: 'too large', ms: 0 };
      const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const out = await embedImage(c.env, buf, mime, { shape, model });
      return { url: raw, ...out };
    } catch (e) {
      return { url: raw, vector: null, error: String((e as Error)?.message || e).slice(0, 200), ms: 0 };
    }
  }));
  return c.json({ model: model || null, shape: shape || 'image_dataurl', results });
});
