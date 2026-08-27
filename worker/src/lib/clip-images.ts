// Official catalog image URLs eligible for the CLIP set-ID index.
//
// Rebrickable permits caching Set (not MOC) images on external apps with
// credit. Brickset additional shots already stored on lego_sets are official
// pack photography. BrickLink images and MOCs are never indexed.

export const CLIP_MAX_VIEWS = 3;

export type ClipImageView = {
  setNum: string;
  view: string;
  imageUrl: string;
  source: 'rebrickable' | 'brickset';
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function isOfficialCatalogImageUrl(url: string): boolean {
  if (!url || !url.startsWith('https://')) return false;
  const host = hostOf(url);
  const path = pathOf(url);
  if (/\/media\/mocs\//i.test(path)) return false;
  if (/bricklink\.com$/i.test(host) || host.endsWith('.bricklink.com')) return false;
  if (host === 'cdn.rebrickable.com') {
    // Rebrickable set shots live under /media/sets/; some older rows omit the
    // folder but are still catalog set images. Reject minifig/part/MOC paths.
    if (/\/media\/(minifigs|parts|mocs)\//i.test(path)) return false;
    return true;
  }
  if (host === 'images.brickset.com') return true;
  return false;
}

function parseBricksetUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.startsWith('https://'));
  } catch {
    return [];
  }
}

/**
 * 1–3 official views already stored on the catalog row: the Rebrickable
 * `image_url` plus up to two Brickset additional URLs from D1. Does not fetch.
 */
export function officialCatalogViews(row: {
  set_num: string;
  image_url?: string | null;
  brickset_image_urls?: string | null;
}): ClipImageView[] {
  const setNum = String(row.set_num || '').trim();
  if (!setNum) return [];
  const out: ClipImageView[] = [];
  const seen = new Set<string>();
  const push = (imageUrl: string, view: string, source: ClipImageView['source']) => {
    if (out.length >= CLIP_MAX_VIEWS) return;
    if (!isOfficialCatalogImageUrl(imageUrl)) return;
    const key = imageUrl.split('?')[0];
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ setNum, view, imageUrl, source });
  };

  if (row.image_url) push(row.image_url, 'official', 'rebrickable');
  let bricksetIdx = 0;
  for (const url of parseBricksetUrls(row.brickset_image_urls)) {
    if (out.length >= CLIP_MAX_VIEWS) break;
    if (hostOf(url) !== 'images.brickset.com') continue;
    push(url, `brickset-${bricksetIdx}`, 'brickset');
    bricksetIdx += 1;
  }
  return out;
}
