// Sitemap index for bricksvault.app: /sitemap.xml lists /sitemaps/static.xml
// and one /sitemaps/sets-N.xml shard per 10,000 sets (the sitemap protocol's
// limit is 50,000; smaller shards keep each response light). Set numbers come
// from the Worker's public /api/seo/sitemap-sets, edge-cached for a day.

import { SITE, API_ORIGIN } from './og-page.js';

export const STATIC_PATHS = ['/', '/methodology', '/data-partners', '/privacy', '/terms'];
const DAY_CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const xml = (body, status = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
  status,
  headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': status === 200 ? DAY_CACHE : 'no-store' },
});

async function setsPage(api, page) {
  try {
    const res = await fetch(`${api}/api/seo/sitemap-sets?page=${page}`, { cf: { cacheTtl: 86400, cacheEverything: true } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function sitemapIndexXml(pages, today) {
  const locs = ['static', ...Array.from({ length: pages }, (_, i) => `sets-${i + 1}`)];
  return `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locs.map((l) => `  <sitemap><loc>${SITE}/sitemaps/${l}.xml</loc><lastmod>${today}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>`;
}

export function staticSitemapXml() {
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${STATIC_PATHS.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>`;
}

export function setsSitemapXml(sets) {
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sets.map((s) => `  <url><loc>${SITE}/s/${xmlEsc(encodeURIComponent(s.set_num))}</loc>${valid.test(s.updated || '') ? `<lastmod>${s.updated}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`;
}

/** /sitemap.xml */
export async function handleSitemapIndex(context) {
  const api = context.env?.API_ORIGIN || API_ORIGIN;
  const first = await setsPage(api, 1);
  // API down: still list the static pages rather than fail the whole index.
  const pages = Math.max(0, Math.min(100, Number(first?.pages) || 0));
  return xml(sitemapIndexXml(pages, new Date().toISOString().slice(0, 10)));
}

/** /sitemaps/static.xml and /sitemaps/sets-N.xml */
export async function handleSitemapFile(context) {
  const raw = String(Array.isArray(context.params.file) ? context.params.file[0] : context.params.file || '');
  if (raw === 'static.xml') return xml(staticSitemapXml());
  const m = /^sets-(\d{1,3})\.xml$/.exec(raw);
  if (!m) return new Response('Not found', { status: 404 });
  const api = context.env?.API_ORIGIN || API_ORIGIN;
  const data = await setsPage(api, Number(m[1]));
  if (!data) return new Response('Temporarily unavailable', { status: 503, headers: { 'retry-after': '3600' } });
  if (!Array.isArray(data.sets) || data.sets.length === 0) return new Response('Not found', { status: 404 });
  return xml(setsSitemapXml(data.sets));
}
