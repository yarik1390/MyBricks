import type { Env } from '../types';
import { imageR2Key } from '../lib/img-proxy';
import { brightDataUnlock } from '../lib/brightdata';
import { backupFetch } from '../lib/backup-scrapers';
import { firecrawlScrape } from '../lib/firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';

/**
 * Fill in set photos Rebrickable doesn't have.
 *
 * Rebrickable's sets.csv lists an img_url for EVERY set, including brand-new
 * ones (BIOGLOW 45832-45835, store promos, Duplo singles) whose photo hasn't
 * been uploaded yet, so lego_sets.image_url is never NULL but the file 404s and
 * the app draws its brick placeholder. Measured 2026-11-06: ~20% of 2025+ rows
 * (most are gear/books, but real sets too).
 *
 * Three steps per run, all bounded:
 *  1. probe   — find which Rebrickable photos are missing (the R2 mirror first,
 *               free; then a HEAD to the CDN). Results land in set_image_checks.
 *  2. resolve — for a missing photo try Brickset's CDN (free), then the
 *               LEGO.com product photo (Bright Data -> Decodo/ZenRows ->
 *               Firecrawl, the LEGO.com scraping order), then the first stored
 *               Brickset gallery image. A hit is written into lego_sets.image_url
 *               so every screen picks it up with no read-path changes.
 *  3. recheck — fallbacks older than 30 days: if Rebrickable has since added
 *               the photo, switch back to it (the canonical catalog image).
 * The weekly Rebrickable import keeps fallback URLs (import-catalog.ts).
 */

const RB_PREFIX = 'https://cdn.rebrickable.com/media/sets/';
// LEGO.com product URLs use the plain set number; ISBNs, gear codes
// (TSHIRT-1, LGLKE234B-1) and the like have no product page worth paying for.
const LEGO_PRODUCT_NUM = /^(\d{4,7})-\d+$/;

export interface SetImageBackfillOptions {
  probeLimit?: number;
  resolveLimit?: number;
  scrapeLimit?: number;
  recheckLimit?: number;
}

async function headOk(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { Accept: 'image/*' }, signal: AbortSignal.timeout(8000) });
    if (r.ok && (r.headers.get('content-type') || 'image/').startsWith('image/')) return 200;
    return r.status === 200 ? 415 : r.status;
  } catch {
    return 0; // network failure: unknown, retried later
  }
}

/** Main product photo on a LEGO.com product page, scoped to this set number. */
export function parseLegoProductImage(html: string, num: string): string | null {
  if (!html) return null;
  const ok = (u: unknown): string | null => {
    if (typeof u !== 'string') return null;
    const url = u.replace(/&amp;/g, '&').trim();
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== 'https:' || !/(^|\.)lego\.com$/i.test(parsed.hostname)) return null;
    // Identity check: LEGO's asset file names carry the set number
    // (…/45833_Prod.png). Anything else may be a banner or another set.
    if (!parsed.pathname.includes(num)) return null;
    return parsed.toString();
  };
  const metas = [
    ...html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi),
    ...html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url)?["']/gi),
  ].map((m) => m[1]);
  for (const m of metas) {
    const hit = ok(m);
    if (hit) return hit;
  }
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try { parsed = JSON.parse(script[1]); } catch { continue; }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes as Array<Record<string, unknown>>) {
      if (!node || typeof node !== 'object') continue;
      const ids = [node.sku, node.productID, node.mpn].map((v) => String(v ?? ''));
      if (!ids.includes(num)) continue;
      const imgs = Array.isArray(node.image) ? node.image : [node.image];
      for (const i of imgs) {
        const hit = ok(typeof i === 'object' && i ? (i as Record<string, unknown>).url : i);
        if (hit) return hit;
      }
    }
  }
  return null;
}

async function legoProductImage(setNum: string, env: Env): Promise<string | null> {
  const num = setNum.match(LEGO_PRODUCT_NUM)?.[1];
  if (!num) return null;
  const url = `https://www.lego.com/en-us/product/${num}`;
  if (await sourceEnabled(env, 'brightdata')) {
    const html = await brightDataUnlock(url, env, { timeoutMs: 25_000 }).catch(() => null);
    const hit = html ? parseLegoProductImage(html, num) : null;
    if (hit) return hit;
  }
  const backup = await backupFetch(url, env, { timeoutMs: 25_000 }).catch(() => ({ html: null, missing: false }));
  if (backup.missing) return null; // no LEGO.com page: Firecrawl would hit the same 404
  if (backup.html) {
    const hit = parseLegoProductImage(backup.html, num);
    if (hit) return hit;
  }
  if ((await sourceEnabled(env, 'firecrawl')) && firecrawlEnabled(env)) {
    const res = await firecrawlScrape<{ rawHtml?: string; metadata?: { ogImage?: string } }>(
      { url, formats: ['rawHtml'], waitFor: 1500, timeoutMs: 25_000 },
      env,
    ).catch(() => null);
    const data = res?.data;
    const hit = (data?.rawHtml && parseLegoProductImage(data.rawHtml, num))
      || (data?.metadata?.ogImage && parseLegoProductImage(`<meta property="og:image" content="${data.metadata.ogImage}">`, num));
    if (hit) return hit;
  }
  return null;
}

function firstGalleryImage(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    const u = Array.isArray(arr) ? arr.find((x) => typeof x === 'string' && x.startsWith('https://')) : null;
    return u ?? null;
  } catch { return null; }
}

// Owned/wishlisted first (people are looking at them), then newest.
const PRIORITY = `
  CASE WHEN EXISTS (SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL)
         OR EXISTS (SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num)
       THEN 0 ELSE 1 END,
  COALESCE(ls.year, 0) DESC`;

export async function runSetImageBackfill(env: Env, options: SetImageBackfillOptions = {}) {
  const probeLimit = Math.max(0, Math.min(options.probeLimit ?? 150, 300));
  const resolveLimit = Math.max(0, Math.min(options.resolveLimit ?? 40, 100));
  const scrapeLimit = Math.max(0, Math.min(options.scrapeLimit ?? 12, 40));
  const recheckLimit = Math.max(0, Math.min(options.recheckLimit ?? 20, 100));
  const out = { probed: 0, missing: 0, resolved: 0, brickset: 0, lego: 0, gallery: 0, scraped: 0, restored: 0 };

  // 1) Probe. Never-checked Rebrickable images, plus known-missing ones every
  //    14 days (Rebrickable uploads photos for new sets over time).
  const { results: probe } = await env.DB.prepare(`
    SELECT ls.set_num, ls.image_url FROM lego_sets ls
    LEFT JOIN set_image_checks c ON c.set_num = ls.set_num
    WHERE ls.image_url LIKE '${RB_PREFIX}%'
      AND (c.set_num IS NULL
           OR (c.rb_status <> 200 AND c.fallback_url IS NULL
               AND datetime(c.checked_at) < datetime('now', '-14 days')))
    ORDER BY CASE WHEN c.set_num IS NULL THEN 0 ELSE 1 END, ${PRIORITY}, ls.set_num
    LIMIT ?`).bind(probeLimit).all<{ set_num: string; image_url: string }>();

  const writes: D1PreparedStatement[] = [];
  for (let i = 0; i < probe.length; i += 5) {
    const batch = probe.slice(i, i + 5);
    const statuses = await Promise.all(batch.map(async (r) => {
      if (env.PHOTO_BUCKET) {
        const key = await imageR2Key(r.image_url).catch(() => null);
        if (key && await env.PHOTO_BUCKET.head(key).catch(() => null)) return 200;
      }
      return headOk(r.image_url);
    }));
    batch.forEach((r, j) => {
      const status = statuses[j];
      out.probed++;
      if (status === 0) return; // unknown: leave unchecked
      if (status !== 200) out.missing++;
      writes.push(env.DB.prepare(`
        INSERT INTO set_image_checks (set_num, rb_url, rb_status, checked_at)
        VALUES (?1, ?2, ?3, datetime('now'))
        ON CONFLICT(set_num) DO UPDATE SET rb_url = ?2, rb_status = ?3, checked_at = datetime('now')`)
        .bind(r.set_num, r.image_url, status));
    });
  }
  for (let i = 0; i < writes.length; i += 90) await env.DB.batch(writes.slice(i, i + 90));

  // 2) Resolve missing photos. A miss waits 7 days before the next attempt.
  const { results: missing } = await env.DB.prepare(`
    SELECT ls.set_num, ls.image_url, ls.brickset_image_urls FROM set_image_checks c
    JOIN lego_sets ls ON ls.set_num = c.set_num
    WHERE c.rb_status <> 200 AND c.fallback_url IS NULL
      AND ls.image_url = c.rb_url
      AND COALESCE(c.attempts, 0) < 8
      AND (c.fallback_checked_at IS NULL OR datetime(c.fallback_checked_at) < datetime('now', '-7 days'))
    ORDER BY ${PRIORITY}, ls.set_num
    LIMIT ?`).bind(resolveLimit).all<{ set_num: string; image_url: string; brickset_image_urls: string | null }>();

  let scrapes = 0;
  for (const r of missing) {
    let url: string | null = null;
    let source: string | null = null;
    const bs = `https://images.brickset.com/sets/images/${r.set_num}.jpg`;
    if (await headOk(bs) === 200) { url = bs; source = 'brickset'; }
    if (!url && scrapes < scrapeLimit && LEGO_PRODUCT_NUM.test(r.set_num)) {
      scrapes++;
      url = await legoProductImage(r.set_num, env);
      if (url) source = 'lego';
    }
    if (!url) {
      url = firstGalleryImage(r.brickset_image_urls);
      if (url) source = 'brickset_gallery';
    }
    const stmts = [env.DB.prepare(`
      UPDATE set_image_checks SET fallback_url = ?2, fallback_source = ?3,
        fallback_checked_at = datetime('now'), attempts = COALESCE(attempts, 0) + 1
      WHERE set_num = ?1`).bind(r.set_num, url, source)];
    if (url) {
      // Guard on the old URL so a concurrent change (import, admin edit) wins.
      stmts.push(env.DB.prepare(`UPDATE lego_sets SET image_url = ?2 WHERE set_num = ?1 AND image_url = ?3`)
        .bind(r.set_num, url, r.image_url));
      out.resolved++;
      if (source === 'brickset') out.brickset++;
      else if (source === 'lego') out.lego++;
      else out.gallery++;
    }
    await env.DB.batch(stmts);
  }
  out.scraped = scrapes;

  // 3) Recheck: switch back to Rebrickable once it has the photo.
  const { results: recheck } = await env.DB.prepare(`
    SELECT c.set_num, c.rb_url, c.fallback_url FROM set_image_checks c
    WHERE c.fallback_url IS NOT NULL AND c.rb_url IS NOT NULL
      AND datetime(c.checked_at) < datetime('now', '-30 days')
    ORDER BY c.checked_at
    LIMIT ?`).bind(recheckLimit).all<{ set_num: string; rb_url: string; fallback_url: string }>();
  for (const r of recheck) {
    const status = await headOk(r.rb_url);
    if (status === 0) continue;
    if (status === 200) {
      await env.DB.batch([
        env.DB.prepare(`UPDATE lego_sets SET image_url = ?2 WHERE set_num = ?1 AND image_url = ?3`).bind(r.set_num, r.rb_url, r.fallback_url),
        env.DB.prepare(`UPDATE set_image_checks SET rb_status = 200, checked_at = datetime('now'), fallback_url = NULL, fallback_source = NULL WHERE set_num = ?1`).bind(r.set_num),
      ]);
      out.restored++;
    } else {
      await env.DB.prepare(`UPDATE set_image_checks SET rb_status = ?2, checked_at = datetime('now') WHERE set_num = ?1`).bind(r.set_num, status).run();
    }
  }

  return out;
}

/**
 * Called by /api/img when Rebrickable answers 404 for a set photo, so a missing
 * photo someone is looking at jumps the queue. Only records URLs that really
 * are a catalog set's current image (no rows for arbitrary request strings).
 */
export function recordMissingRebrickableImage(env: Env, src: string): Promise<unknown> {
  const setNum = src.startsWith(RB_PREFIX) ? decodeURIComponent(src.slice(RB_PREFIX.length)).replace(/\.(jpe?g|png|webp)$/i, '') : '';
  if (!setNum || setNum.includes('/')) return Promise.resolve();
  return env.DB.prepare(`
    INSERT INTO set_image_checks (set_num, rb_url, rb_status, checked_at)
    SELECT set_num, image_url, 404, datetime('now') FROM lego_sets WHERE set_num = ?2 AND image_url = ?1
    ON CONFLICT(set_num) DO UPDATE SET rb_status = 404, checked_at = datetime('now')
      WHERE set_image_checks.fallback_url IS NULL AND set_image_checks.rb_status <> 404`)
    .bind(src, setNum).run().catch(() => null);
}
