import { api, isGuestMode, getSessionOwnerSnapshot } from '../api.js';
import { normalizeSubcollection } from './subcollections.js';

export const GUEST_SUBCOLLECTIONS_KEY = 'bv_guest_subcollections';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure = (status) => Object.assign(new Error('subcollections'), { status });

function readGuestLists() {
  const value = JSON.parse(localStorage.getItem(GUEST_SUBCOLLECTIONS_KEY) || '[]');
  // A damaged store must not silently become empty and overwrite saved lists.
  if (!Array.isArray(value) || value.length > 50) throw failure(400);
  return value.map(row => {
    if (!UUID.test(row.id) || row.revision < 1) throw failure(400);
    return { ...normalizeSubcollection(row), id: row.id, updated_at: row.updated_at };
  });
}

export async function subcollectionRequest(id = '', options = {}) {
  const owner = getSessionOwnerSnapshot();
  const assertOwner = () => {
    const now = getSessionOwnerSnapshot();
    if (owner.userId !== now.userId || owner.generation !== now.generation) throw failure(409);
  };
  if (!isGuestMode()) {
    const result = await api(`/api/subcollections${id ? `/${encodeURIComponent(id)}` : ''}`, { ...options, offlineQueue: false, retry: false });
    assertOwner();
    return result;
  }
  const method = options.method || 'GET';
  const perform = () => {
    assertOwner();
    const rows = readGuestLists();
    if (method === 'GET' && !id) return { subcollections: rows };
    if (!UUID.test(id)) throw failure(400);
    const index = rows.findIndex(row => row.id === id);
    const previous = rows[index];
    if (!Number.isSafeInteger(options.body?.revision) || options.body.revision < 0) throw failure(400);
    if ((previous?.revision ?? 0) !== options.body.revision) throw failure(409);
    if (method === 'DELETE') {
      if (!previous) throw failure(404);
      rows.splice(index, 1);
      localStorage.setItem(GUEST_SUBCOLLECTIONS_KEY, JSON.stringify(rows));
      return { ok: true };
    }
    if (method !== 'PUT') throw failure(400);
    if (options.body.revision >= Number.MAX_SAFE_INTEGER) throw failure(400);
    let normalized;
    try { normalized = normalizeSubcollection(options.body); } catch { throw failure(400); }
    if (!previous && rows.length >= 50) throw failure(400);
    const row = { ...normalized, id, revision: normalized.revision + 1, updated_at: new Date().toISOString() };
    if (previous) rows[index] = row;
    else rows.push(row);
    localStorage.setItem(GUEST_SUBCOLLECTIONS_KEY, JSON.stringify(rows));
    return { subcollection: row };
  };
  return navigator.locks?.request
    ? navigator.locks.request(GUEST_SUBCOLLECTIONS_KEY, perform)
    : perform();
}
