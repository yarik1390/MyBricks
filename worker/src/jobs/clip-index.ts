import type { Env } from '../types';
import { CLIP_DIM, CLIP_MODEL, clipConfigured, embedImageBytes } from '../lib/clip-embed';
import { officialCatalogViews, type ClipImageView } from '../lib/clip-images';
import { clipVectorId } from '../lib/scan-clip';
import { ALLOWED_IMG_HOSTS, imageR2Key } from '../lib/img-proxy';

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 150;
const FETCH_TIMEOUT_MS = 8_000;

export type ClipIndexResult = {
  processed: number;
  upserted: number;
  skipped: string | number;
  limit: number;
  views: number;
};

type CandidateRow = {
  set_num: string;
  image_url: string | null;
  brickset_image_urls: string | null;
};

async function ensureIndexTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS set_clip_index (
      vector_id TEXT PRIMARY KEY,
      set_num TEXT NOT NULL,
      view TEXT NOT NULL,
      image_url TEXT NOT NULL,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_set_clip_index_set ON set_clip_index(set_num)',
  ).run().catch(() => {});
}

export async function loadClipIndexCandidates(
  db: D1Database,
  limit: number,
): Promise<ClipImageView[]> {
  const { results } = await db.prepare(`
    SELECT s.set_num, s.image_url, s.brickset_image_urls
    FROM lego_sets s
    WHERE s.image_url LIKE 'https://cdn.rebrickable.com/%'
      AND NOT EXISTS (
        SELECT 1 FROM set_clip_index i
        WHERE i.set_num = s.set_num AND i.view = 'official'
      )
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = s.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = s.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(NULLIF(s.blended_value, 0), s.current_value, 0) DESC,
      s.set_num ASC
    LIMIT ?
  `).bind(limit).all<CandidateRow>().catch(async () => {
    // Tests (and a brand-new D1) may not have user_collection / wishlist.
    const fallback = await db.prepare(`
      SELECT s.set_num, s.image_url, s.brickset_image_urls
      FROM lego_sets s
      WHERE s.image_url LIKE 'https://cdn.rebrickable.com/%'
        AND NOT EXISTS (
          SELECT 1 FROM set_clip_index i
          WHERE i.set_num = s.set_num AND i.view = 'official'
        )
      ORDER BY s.set_num ASC
      LIMIT ?
    `).bind(limit).all<CandidateRow>();
    return fallback;
  });

  const views: ClipImageView[] = [];
  for (const row of results) {
    const selected = officialCatalogViews(row);
    // Always require the official Rebrickable view; extra Brickset URLs ride along.
    if (!selected.some((view) => view.view === 'official')) continue;
    views.push(...selected);
  }
  return views;
}

async function readCatalogBytes(
  env: Env,
  imageUrl: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  let host = '';
  try { host = new URL(imageUrl).hostname; } catch { return null; }
  if (!ALLOWED_IMG_HOSTS.has(host)) return null;

  if (env.PHOTO_BUCKET) {
    try {
      const key = await imageR2Key(imageUrl);
      const obj = await env.PHOTO_BUCKET.get(key);
      if (obj) {
        const mime = obj.httpMetadata?.contentType || 'image/jpeg';
        if (mime.startsWith('image/')) {
          return { bytes: new Uint8Array(await obj.arrayBuffer()), mime };
        }
      }
    } catch {
      /* fall through to origin fetch */
    }
  }

  const response = await fetch(imageUrl, {
    headers: { Accept: 'image/*', 'User-Agent': 'BricksVault/1.0 (+https://bricksvault.app)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const mime = response.headers.get('content-type') || 'image/jpeg';
  if (!mime.startsWith('image/')) return null;
  const buf = new Uint8Array(await response.arrayBuffer());
  if (!buf.length) return null;
  return { bytes: buf, mime: mime.split(';')[0] };
}

/**
 * Incrementally embed official catalog images and upsert 512-d vectors.
 * No-op when Vectorize or the owned embedder is unbound. Never downloads in
 * CI — operators run this via cron / admin job / scripts/clip-index.mjs.
 */
export async function runClipIndex(
  env: Env,
  options: { limit?: number } = {},
): Promise<ClipIndexResult> {
  if (!clipConfigured(env) || !env.SET_CLIP) {
    return { processed: 0, upserted: 0, skipped: 'CLIP embedder or Vectorize not configured', limit: 0, views: 0 };
  }
  await ensureIndexTable(env.DB);

  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const views = await loadClipIndexCandidates(env.DB, limit);
  if (!views.length) return { processed: 0, upserted: 0, skipped: 0, limit, views: 0 };

  let processed = 0;
  let upserted = 0;
  const stamps: D1PreparedStatement[] = [];

  for (const view of views) {
    processed += 1;
    const body = await readCatalogBytes(env, view.imageUrl).catch(() => null);
    if (!body) continue;
    const embedded = await embedImageBytes(env, body.bytes, body.mime);
    if (embedded.kind !== 'ok') continue;
    const id = clipVectorId(view.setNum, view.view);
    await env.SET_CLIP.upsert([{
      id,
      values: embedded.vector,
      metadata: {
        set_num: view.setNum,
        view: view.view,
        source: view.source,
        model: CLIP_MODEL,
      },
    }]);
    stamps.push(env.DB.prepare(`
      INSERT OR REPLACE INTO set_clip_index (vector_id, set_num, view, image_url, model, dim, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(id, view.setNum, view.view, view.imageUrl, CLIP_MODEL, CLIP_DIM));
    upserted += 1;
  }

  for (let i = 0; i < stamps.length; i += 90) {
    await env.DB.batch(stamps.slice(i, i + 90));
  }
  return { processed, upserted, skipped: processed - upserted, limit, views: views.length };
}
