import { canonicalSetNum } from './subcollections.js';

// This view uses catalog facts only. Never copy costs, notes or account IDs
// into scene objects, textures or links.
export function roomImageUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\\]/.test(value)) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

export function collectionRoomCatalog(holdings = []) {
  const distinct = new Map();
  for (const row of Array.isArray(holdings) ? holdings : []) {
    if (!row || row.deleted_at || row._pendingCollectionNew) continue;
    const quantity = Number(row.quantity ?? 1);
    const setNum = canonicalSetNum(row.set_num);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(setNum)) continue;
    const existing = distinct.get(setNum);
    if (existing) { existing.quantity += quantity; continue; }
    distinct.set(setNum, {
      set_num: setNum,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : setNum,
      theme: typeof row.theme === 'string' ? row.theme.trim() : '',
      image_url: roomImageUrl(row.image_url),
      quantity,
    });
  }
  return [...distinct.values()].sort((a, b) => a.theme.localeCompare(b.theme) || a.name.localeCompare(b.name) || a.set_num.localeCompare(b.set_num));
}

// Four images per shelf and three shelves per room page bound GPU/image work.
export function collectionRoomPage(catalog, theme = null, requestedPage = 0) {
  const items = theme === null ? catalog : catalog.filter(item => item.theme === theme);
  const shelves = [];
  for (const item of items) {
    let shelf = shelves[shelves.length - 1];
    if (!shelf || shelf.theme !== item.theme || shelf.items.length === 4) {
      shelf = { theme: item.theme, items: [] };
      shelves.push(shelf);
    }
    shelf.items.push(item);
  }
  const pages = Math.max(1, Math.ceil(shelves.length / 3));
  const page = Math.min(pages - 1, Math.max(0, Number.isSafeInteger(requestedPage) ? requestedPage : 0));
  return { shelves: shelves.slice(page * 3, page * 3 + 3), count: items.length, page, pages };
}
