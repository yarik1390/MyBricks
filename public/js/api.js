import { state, invalidatePortfolio } from './state.js';
import { bvIDB, toast } from './utils.js';
import { jwtSub } from './lib/pure.js';

export let _authSession = null;
export let _sbUrl = "";
export let _sbAnonKey = "";
export let _swipeAc = null;

export function setSupabaseConfig(url, anonKey) {
  _sbUrl = url;
  _sbAnonKey = anonKey;
}

export function getSessionUserId() {
  return jwtSub(_authSession?.access_token);
}

/* ---------- Offline outbox (queue mutations for replay when back online) ---------- */
export const OUTBOX_KEY = 'bv_outbox';

export function outboxEnqueue(item) {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    q.push({ id: Date.now(), ...item });
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q));
  } catch {}
}

export function outboxDequeue(id) {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(q.filter(x => x.id !== id)));
  } catch {}
}

export async function drainOutbox() {
  try {
    const q = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
    if (!q.length) return;
    let synced = 0;
    for (const item of q) {
      try {
        await api(item.path, { method: item.method, ...(item.body ? { body: item.body } : {}) });
        outboxDequeue(item.id);
        synced++;
      } catch {
        // keep failed items for next online event; continue processing the rest
      }
    }
    if (synced) { invalidatePortfolio(); toast(`${synced} offline action${synced > 1 ? 's' : ''} synced`, 'success'); }
  } catch {}
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem("bv_session") || "null");
    _authSession = s;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s, opts = {}) {
  const oldUid = getSessionUserId();
  try {
    if (s) localStorage.setItem("bv_session", JSON.stringify(s));
    else localStorage.removeItem("bv_session");
  } catch {}
  _authSession = s;
  const newUid = getSessionUserId();

  if (newUid !== oldUid) {
    state.portfolio = null;
    state.me = null;
    state.catalog.items = [];
    state.blind.items = [];
    state.wishlist = [];
    state.portfolioHistory = null;
    state.ownedFigs = new Set();
    state.detail.cache = {};
    
    // Clear user specific local DB
    bvIDB.del('portfolio').catch(() => {});
    bvIDB.del('catalog').catch(() => {});
    bvIDB.del('blind').catch(() => {});
    
    // Clear user specific localStorage
    if (!opts.preserveGuestFigs) localStorage.removeItem("bv_figs");
    localStorage.removeItem("bv_chat");
    localStorage.removeItem(OUTBOX_KEY);
  }
}

export async function sbSignIn(email, password) {
  const r = await fetch(`${_sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.msg || d.error_description || (typeof d.error === 'string' ? d.error : (d.error && d.error.message)) || d.message || "Sign in failed";
    throw new Error(msg);
  }
  return d;
}

export async function sbSignUp(email, password) {
  const r = await fetch(`${_sbUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  if (!r.ok || d.error) {
    const msg = d.msg || d.error_description || (typeof d.error === 'string' ? d.error : (d.error && d.error.message)) || d.message || "Sign up failed";
    throw new Error(msg);
  }
  return d;
}

export async function sbRecover(email) {
  const r = await fetch(`${_sbUrl}/auth/v1/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const msg = d.msg || d.error_description || d.message || "Couldn't send the reset email";
    throw new Error(msg);
  }
}

export async function sbRefresh(refreshToken) {
  const r = await fetch(`${_sbUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: _sbAnonKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.msg || d.error_description || (typeof d.error === 'string' ? d.error : (d.error && d.error.message)) || d.message || "Session expired";
    throw new Error(msg);
  }
  return d;
}

export async function sbSignOut() {
  if (!_authSession?.access_token) return;
  await fetch(`${_sbUrl}/auth/v1/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${_authSession.access_token}`, apikey: _sbAnonKey },
  }).catch(() => {});
  saveSession(null);
}

/* ---------- Guest mode (local-only vault) ---------- */
const GUEST_PREFS_KEY = 'bv_guest_prefs';
const GUEST_COLLECTION_KEY = 'bv_guest_collection';
const GUEST_WISHLIST_KEY = 'bv_guest_wishlist';
const GUEST_FIG_DETAILS_KEY = 'bv_guest_fig_details';

const SET_FIELDS = [
  'set_num','name','theme','year','pieces','minifigs','retail_price','current_value',
  'forecast_2y','forecast_5y','image_url','retired','retirement_risk_score','used_value',
  'ebay_value','ebay_new_value','ebay_used_value','ebay_new_qty','ebay_used_qty',
  'ebay_new_cached_at','ebay_used_cached_at','cached_at','valuation_method','bl_new_value','bl_new_qty','bl_used_qty',
  'source','brickset','trend','market_sources','primary_value_source','confidence',
  'freshness','valuation_explanation','valuation_expires_at','ebay_cached_at'
];

export function isGuestMode() {
  return !_authSession?.access_token;
}

function readLocalJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function nowISO() {
  return new Date().toISOString();
}

function numberOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolValue(v, fallback = true) {
  if (v === 0 || v === false || v === 'false') return false;
  if (v === 1 || v === true || v === 'true') return true;
  return fallback;
}

function pickSetFields(set = {}) {
  const out = {};
  for (const k of SET_FIELDS) {
    if (set[k] !== undefined) out[k] = set[k];
  }
  if (!out.set_num && set.set_num) out.set_num = set.set_num;
  return out;
}

function readGuestCollection() {
  return readLocalJSON(GUEST_COLLECTION_KEY, []);
}

function writeGuestCollection(items) {
  writeLocalJSON(GUEST_COLLECTION_KEY, items);
}

function readGuestWishlist() {
  return readLocalJSON(GUEST_WISHLIST_KEY, []);
}

function writeGuestWishlist(items) {
  writeLocalJSON(GUEST_WISHLIST_KEY, items);
}

function readGuestFigDetails() {
  return readLocalJSON(GUEST_FIG_DETAILS_KEY, {});
}

function writeGuestFigDetails(details) {
  writeLocalJSON(GUEST_FIG_DETAILS_KEY, details);
}

function rememberGuestFigDetails(figs = []) {
  const details = readGuestFigDetails();
  let changed = false;
  for (const fig of figs) {
    if (!fig?.fig_num) continue;
    details[fig.fig_num] = fig;
    changed = true;
  }
  if (changed) writeGuestFigDetails(details);
}

function persistOwnedFigs() {
  try { localStorage.setItem("bv_figs", JSON.stringify([...state.ownedFigs])); } catch {}
}

export function snapshotGuestVault() {
  return {
    collection: readGuestCollection(),
    wishlist: readGuestWishlist(),
    ownedFigs: readLocalJSON("bv_figs", []),
    prefs: readLocalJSON(GUEST_PREFS_KEY, {}),
  };
}

function guestSnapshotHasData(snapshot = {}) {
  return !!(
    snapshot.collection?.length ||
    snapshot.wishlist?.length ||
    snapshot.ownedFigs?.length ||
    Object.keys(snapshot.prefs || {}).length
  );
}

function clearGuestVault() {
  try {
    localStorage.removeItem(GUEST_COLLECTION_KEY);
    localStorage.removeItem(GUEST_WISHLIST_KEY);
    localStorage.removeItem(GUEST_FIG_DETAILS_KEY);
    localStorage.removeItem(GUEST_PREFS_KEY);
    localStorage.removeItem('bv_guest_history');
    localStorage.removeItem("bv_figs");
  } catch {}
}

export async function migrateGuestVault(snapshot = snapshotGuestVault()) {
  if (!_authSession?.access_token || !guestSnapshotHasData(snapshot)) return { migrated: 0, errors: [] };
  const result = { migrated: 0, errors: [], collection: null, wishlist: 0, minifigs: 0 };

  if (snapshot.collection?.length) {
    try {
      result.collection = await api("/api/collection/import", {
        method: "POST",
        body: { rows: snapshot.collection, overwrite: false },
      });
      result.migrated += Number(result.collection?.imported || 0);
    } catch (e) {
      result.errors.push(`Collection: ${e.message}`);
    }
  }

  for (const item of snapshot.wishlist || []) {
    const setNum = String(item?.set_num || "").trim();
    if (!setNum) continue;
    try {
      await api("/api/wishlist", {
        method: "POST",
        body: {
          set_num: setNum,
          target_price: numberOrNull(item.target_price),
          notes: item.notes || null,
        },
      });
      result.wishlist++;
      result.migrated++;
    } catch (e) {
      result.errors.push(`Wishlist ${setNum}: ${e.message}`);
    }
  }

  const figNums = [...new Set((snapshot.ownedFigs || []).map(v => String(v || "").trim()).filter(Boolean))];
  for (const figNum of figNums) {
    try {
      await api(`/api/minifigs/${encodeURIComponent(figNum)}`, {
        method: "PUT",
        body: { quantity: 1 },
      });
      result.minifigs++;
      result.migrated++;
    } catch (e) {
      result.errors.push(`Minifig ${figNum}: ${e.message}`);
    }
  }

  const prefs = snapshot.prefs || {};
  const prefPatch = {};
  if (prefs.display_name && prefs.display_name !== "Guest Collector") prefPatch.display_name = prefs.display_name;
  if (prefs.currency) prefPatch.currency = prefs.currency;
  if (prefs.notify_price_drops !== undefined) prefPatch.notify_price_drops = !!prefs.notify_price_drops;
  if (Object.keys(prefPatch).length) {
    try {
      await api("/api/me", { method: "PATCH", body: prefPatch });
    } catch (e) {
      result.errors.push(`Preferences: ${e.message}`);
    }
  }

  if (!result.errors.length) clearGuestVault();
  if (result.migrated) invalidatePortfolio();
  return result;
}

function sameSetNum(a, b) {
  if (!a || !b) return false;
  const clean = s => String(s).replace(/-1$/, '');
  return String(a) === String(b) || clean(a) === clean(b);
}

function nextLocalId(items) {
  return items.reduce((m, item) => Math.max(m, Number(item.id) || 0), 0) + 1;
}

function guestCollectionEntry(setNum) {
  return readGuestCollection().find(item => sameSetNum(item.set_num, setNum)) || null;
}

function normalizeCollectionItem(item) {
  const quantity = Math.max(1, parseInt(String(item.quantity ?? 1), 10) || 1);
  const current = Number(item.current_value) || 0;
  const paid = Number(item.purchase_price) || 0;
  let annualized = null;
  if (item.purchased_at && paid > 0 && current > 0) {
    const years = (Date.now() - new Date(item.purchased_at).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years >= 0.08) annualized = Math.pow(current / paid, 1 / years) - 1;
  }
  return {
    ...item,
    quantity,
    purchase_price: numberOrNull(item.purchase_price),
    retired: !!item.retired,
    is_complete: boolValue(item.is_complete, true),
    missing_pieces: parseInt(String(item.missing_pieces ?? 0), 10) || 0,
    annualized_roi: annualized,
    trend: item.trend || 'stable',
    slope_90d: Number(item.slope_90d) || 0,
  };
}

function guestCollectionPayload() {
  const items = readGuestCollection()
    .map(normalizeCollectionItem)
    .sort((a, b) => new Date(b.added_at || 0) - new Date(a.added_at || 0));
  const totalValue = items.reduce((s, r) => s + (Number(r.current_value) || 0) * Number(r.quantity || 1), 0);
  const totalPaid = items.reduce((s, r) => s + (Number(r.purchase_price) || 0) * Number(r.quantity || 1), 0);
  const minifigCount = items.reduce((s, r) => s + (Number(r.minifigs) || 0) * Number(r.quantity || 1), 0);
  const figDetails = readGuestFigDetails();
  const ownedFigNums = [...state.ownedFigs];
  const figValue = ownedFigNums.reduce((s, num) => {
    const fig = figDetails[num];
    return s + (Number(fig?.current_value ?? fig?.value) || 0);
  }, 0);
  recordGuestSnapshot(totalValue, totalPaid, items.length);
  return {
    items,
    total_value: totalValue,
    total_paid: totalPaid,
    count: items.length,
    minifig_count: minifigCount,
    fig_value: figValue,
    fig_count: ownedFigNums.length,
    total_value_with_figs: totalValue + figValue,
  };
}

// Local daily portfolio snapshots so guests get the same history sparkline as
// members. Today's entry is overwritten on each load (values move during the
// day); older entries are immutable. Capped at a year.
const GUEST_HISTORY_KEY = 'bv_guest_history';

function recordGuestSnapshot(totalValue, totalPaid, setCount) {
  try {
    if (!setCount) return;
    const today = new Date().toISOString().slice(0, 10);
    const snapshots = readLocalJSON(GUEST_HISTORY_KEY, []).filter(s => s && s.snapshot_date);
    const idx = snapshots.findIndex(s => s.snapshot_date === today);
    const entry = { snapshot_date: today, total_value: totalValue, total_paid: totalPaid, set_count: setCount };
    if (idx >= 0) snapshots[idx] = entry;
    else snapshots.push(entry);
    snapshots.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
    writeLocalJSON(GUEST_HISTORY_KEY, snapshots.slice(-365));
  } catch {}
}

function guestHistoryPayload(path) {
  const url = new URL(path, location.origin);
  const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10) || 90, 365);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const snapshots = readLocalJSON(GUEST_HISTORY_KEY, [])
    .filter(s => s && s.snapshot_date >= cutoff);
  return { snapshots };
}

function readGuestPrefs() {
  const prefs = readLocalJSON(GUEST_PREFS_KEY, {});
  return {
    display_name: prefs.display_name || 'Guest Collector',
    currency: prefs.currency || 'USD',
    notify_price_drops: prefs.notify_price_drops !== false,
  };
}

function guestMe() {
  const prefs = readGuestPrefs();
  const p = guestCollectionPayload();
  return {
    ...prefs,
    handle: null,
    is_public: false,
    expose_public_value: false,
    is_admin: false,
    is_guest: true,
    ebay_configured: !!state.config?.status?.ebay,
    bricklink_configured: !!state.config?.status?.bricklink,
    brickeconomy_configured: !!state.config?.status?.brickeconomy,
    portfolio_stats: {
      set_count: p.count,
      total_value: p.total_value,
      total_paid: p.total_paid,
    },
  };
}

async function fetchGuestPublicJSON(path, opts = {}) {
  const geminiKey = localStorage.getItem('bv_gemini_key');
  const openaiKey = localStorage.getItem('bv_openai_key');
  const init = {
    method: opts.method || 'GET',
    headers: {
      "content-type": "application/json",
      ...(geminiKey ? { "X-Gemini-Key": geminiKey } : {}),
      ...(openaiKey ? { "X-OpenAI-Key": openaiKey } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  };
  const r = await fetch((window.WORKER_BASE || '') + path, init);
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const b = await r.json();
      msg = b.error || msg;
      if (b.reason) msg += ': ' + b.reason;
    } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}

async function guestHydrateSet(setNum) {
  const sources = [
    ...Object.values(state.detail.cache || {}).map(hit => hit?.set),
    ...(state.portfolio?.items || []),
    ...(state.catalog?.items || []),
    ...(state.wishlist || []),
  ].filter(Boolean);
  let set = sources.find(s => sameSetNum(s.set_num, setNum));
  if (!set) {
    try {
      const data = await fetchGuestPublicJSON("/api/sets/" + encodeURIComponent(setNum));
      set = data?.set || data;
    } catch {}
  }
  return {
    set_num: set?.set_num || setNum,
    name: set?.name || `LEGO ${setNum}`,
    theme: set?.theme || '',
    year: set?.year || null,
    pieces: set?.pieces || 0,
    minifigs: set?.minifigs || 0,
    current_value: Number(set?.current_value) || 0,
    retail_price: numberOrNull(set?.retail_price),
    forecast_2y: numberOrNull(set?.forecast_2y),
    forecast_5y: numberOrNull(set?.forecast_5y),
    image_url: set?.image_url || null,
    retired: !!set?.retired,
    retirement_risk_score: Number(set?.retirement_risk_score) || 0,
    used_value: numberOrNull(set?.used_value),
    ebay_value: numberOrNull(set?.ebay_value),
    ebay_new_value: numberOrNull(set?.ebay_new_value),
    ebay_used_value: numberOrNull(set?.ebay_used_value),
    ebay_new_qty: numberOrNull(set?.ebay_new_qty),
    ebay_used_qty: numberOrNull(set?.ebay_used_qty),
    valuation_method: set?.valuation_method || 'local',
    ...pickSetFields(set || {}),
  };
}

async function guestAddCollection(body = {}) {
  const setNum = String(body.set_num || '').trim();
  if (!setNum) throw new Error('set_num required');
  const quantity = Math.max(1, parseInt(String(body.quantity ?? 1), 10) || 1);
  const validConditions = ['new', 'used_good', 'used_acceptable', 'sealed'];
  const condition = validConditions.includes(body.condition) ? body.condition : 'new';
  const items = readGuestCollection();
  const idx = items.findIndex(item => sameSetNum(item.set_num, setNum));
  const existing = idx >= 0 ? items[idx] : null;
  const set = await guestHydrateSet(setNum);
  const item = normalizeCollectionItem({
    ...pickSetFields(set),
    ...(existing || {}),
    id: existing?.id || nextLocalId(items),
    set_num: set.set_num || setNum,
    quantity,
    condition,
    purchase_price: body.purchase_price !== undefined ? numberOrNull(body.purchase_price) : (existing?.purchase_price ?? null),
    notes: body.notes !== undefined ? (body.notes || null) : (existing?.notes ?? null),
    purchased_at: body.purchased_at || existing?.purchased_at || null,
    storage_location: existing?.storage_location || null,
    acquisition_source: existing?.acquisition_source || null,
    is_complete: existing?.is_complete ?? true,
    missing_pieces: existing?.missing_pieces ?? 0,
    added_at: existing?.added_at || nowISO(),
    last_modified: nowISO(),
  });
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  writeGuestCollection(items);
  return { item };
}

function guestPatchCollection(id, body = {}) {
  const items = readGuestCollection();
  const idx = items.findIndex(item => String(item.id) === String(id));
  if (idx < 0) throw new Error('Not found');
  const allowed = ['quantity','condition','purchase_price','purchased_at','notes','storage_location','acquisition_source','is_complete','missing_pieces'];
  const next = { ...items[idx] };
  for (const key of allowed) {
    if (!(key in body)) continue;
    next[key] = key === 'purchase_price' ? numberOrNull(body[key]) : body[key];
  }
  next.quantity = Math.max(1, parseInt(String(next.quantity ?? 1), 10) || 1);
  next.is_complete = boolValue(next.is_complete, true);
  next.missing_pieces = parseInt(String(next.missing_pieces ?? 0), 10) || 0;
  next.last_modified = nowISO();
  items[idx] = normalizeCollectionItem(next);
  writeGuestCollection(items);
  return { item: items[idx] };
}

function guestDeleteCollection(id) {
  const items = readGuestCollection();
  writeGuestCollection(items.filter(item => String(item.id) !== String(id)));
  return null;
}

async function guestImportCollection(rows = [], overwrite = false) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('rows array required');
  if (rows.length > 500) throw new Error('max 500 rows per import');
  const before = readGuestCollection();
  const seen = new Set(before.map(item => String(item.set_num || '').replace(/-1$/, '')));
  let imported = 0;
  let skipped = 0;
  const errors = [];
  for (const row of rows) {
    const setNum = String(row?.set_num || '').trim();
    if (!setNum) { errors.push({ row, reason: 'missing set_num' }); continue; }
    const key = setNum.replace(/-1$/, '');
    if (!overwrite && seen.has(key)) { skipped++; continue; }
    try {
      await guestAddCollection(row);
      seen.add(key);
      imported++;
    } catch (e) {
      skipped++;
      errors.push({ set_num: setNum, reason: e.message });
    }
  }
  return { imported, skipped, errors: errors.slice(0, 20), allDuplicates: imported === 0 && skipped === rows.length };
}

function guestCollectionCSV() {
  const headers = [
    'set_num','name','theme','year','pieces','minifigs',
    'condition','quantity','purchase_price','purchased_at',
    'current_value','retail_price','roi_pct',
    'storage_location','acquisition_source',
    'is_complete','missing_pieces','notes','added_at',
  ];
  const csvCell = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = guestCollectionPayload().items.map(r => {
    const pp = Number(r.purchase_price);
    const cv = Number(r.current_value);
    const roi = pp > 0 && cv > 0 ? ((cv - pp) / pp * 100).toFixed(2) : '';
    return [
      r.set_num, r.name, r.theme, r.year, r.pieces, r.minifigs,
      r.condition, r.quantity, r.purchase_price ?? '', r.purchased_at ? String(r.purchased_at).slice(0, 10) : '',
      r.current_value ?? '', r.retail_price ?? '', roi,
      r.storage_location ?? '', r.acquisition_source ?? '',
      r.is_complete == null ? 'true' : String(!!r.is_complete), r.missing_pieces ?? 0,
      r.notes ?? '', r.added_at ? String(r.added_at).slice(0, 10) : '',
    ].map(csvCell).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function guestCollectionCSVBlob() {
  return new Blob([guestCollectionCSV()], { type: 'text/csv' });
}

async function guestAddWishlist(body = {}) {
  const setNum = String(body.set_num || '').trim();
  if (!setNum) throw new Error('set_num required');
  const items = readGuestWishlist();
  const idx = items.findIndex(item => sameSetNum(item.set_num, setNum));
  const existing = idx >= 0 ? items[idx] : null;
  const set = await guestHydrateSet(setNum);
  const item = {
    ...pickSetFields(set),
    ...(existing || {}),
    id: existing?.id || nextLocalId(items),
    set_num: set.set_num || setNum,
    target_price: body.target_price !== undefined ? numberOrNull(body.target_price) : (existing?.target_price ?? null),
    notes: body.notes !== undefined ? (body.notes || null) : (existing?.notes ?? null),
    added_at: existing?.added_at || nowISO(),
    alerted_at: null,
  };
  if (idx >= 0) items[idx] = item;
  else items.unshift(item);
  writeGuestWishlist(items);
  return { item };
}

function guestWishlistPayload() {
  return { wishlist: readGuestWishlist(), unread_alerts: [] };
}

async function guestMinifigs(path) {
  const url = new URL(path, location.origin);
  const ownedFilter = url.searchParams.get('owned');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0);
  const details = readGuestFigDetails();
  if (ownedFilter === 'yes') {
    const owned = [...state.ownedFigs].map(num => details[num]).filter(Boolean);
    const page = owned.slice(offset, offset + limit).map(fig => ({ ...fig, owned_qty: 1 }));
    return { minifigs: page, total: owned.length, hasMore: offset + page.length < owned.length };
  }
  const publicUrl = new URL(path, location.origin);
  publicUrl.searchParams.delete('owned');
  const data = await fetchGuestPublicJSON(publicUrl.pathname + publicUrl.search);
  let figs = (data.minifigs || []).map(fig => ({ ...fig, owned_qty: state.ownedFigs.has(fig.fig_num) ? 1 : 0 }));
  rememberGuestFigDetails(figs);
  if (ownedFilter === 'no') figs = figs.filter(fig => !state.ownedFigs.has(fig.fig_num));
  return { ...data, minifigs: figs, total: ownedFilter === 'no' ? Math.max(0, (data.total || figs.length) - state.ownedFigs.size) : data.total };
}

function guestAdvisorResponse(q = '') {
  const p = guestCollectionPayload();
  const items = p.items || [];
  const topValue = items.slice().sort((a, b) => (Number(b.current_value) || 0) - (Number(a.current_value) || 0)).slice(0, 3);
  const topRoi = items
    .filter(i => Number(i.purchase_price) > 0 && Number(i.current_value) > 0)
    .map(i => ({ ...i, roi: (Number(i.current_value) - Number(i.purchase_price)) / Number(i.purchase_price) }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 3);
  const prompt = String(q || '').toLowerCase();
  let text = '';
  if (!items.length) {
    text = "You are in guest mode, so I can use local data on this device only. Add a few sets to your vault and I can summarize value, themes, ROI, and sell candidates here.";
  } else if (prompt.includes('sell')) {
    text = `Guest-mode readout: your vault has ${p.count} sets worth about $${p.total_value.toFixed(0)}. Start sell reviews with ${topValue.map(s => `${s.name} (${s.set_num})`).join(', ') || 'your highest-value sets'}, then check condition and recent market price before listing.`;
  } else if (prompt.includes('roi') || prompt.includes('gain')) {
    text = topRoi.length
      ? `Your strongest local ROI leaders are ${topRoi.map(s => `${s.name} at ${(s.roi * 100).toFixed(1)}%`).join(', ')}. Sets without a purchase price are excluded from this ROI view.`
      : "I need purchase prices before I can rank ROI. Add purchase prices in each set's Manage tab and I will calculate gains locally.";
  } else {
    const themes = {};
    for (const item of items) themes[item.theme || 'Other'] = (themes[item.theme || 'Other'] || 0) + Number(item.quantity || 1);
    const topTheme = Object.entries(themes).sort((a, b) => b[1] - a[1])[0];
    text = `Guest-mode snapshot: ${p.count} sets, about $${p.total_value.toFixed(0)} market value, and $${p.total_paid.toFixed(0)} invested. ${topTheme ? `Your largest theme is ${topTheme[0]} with ${topTheme[1]} set${topTheme[1] === 1 ? '' : 's'}.` : ''} Sign in when you want AI advice synced across devices.`;
  }
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ text })}\n\n`));
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    }
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function guestSetDetail(path) {
  const setNum = decodeURIComponent(path.split('/').pop() || '');
  const localEntry = guestCollectionEntry(setNum);
  try {
    const data = await fetchGuestPublicJSON(path);
    const set = data?.set || data;
    return { ...data, set, entry: guestCollectionEntry(set?.set_num || setNum) };
  } catch (e) {
    if (localEntry) return { set: pickSetFields(localEntry), entry: localEntry };
    throw e;
  }
}

async function guestApi(path, opts = {}, streamMode = false) {
  const method = (opts.method || 'GET').toUpperCase();
  const url = new URL(path, location.origin);
  const pathname = url.pathname;
  const body = opts.body || {};

  if (pathname === '/api/me') {
    if (method === 'GET') return { handled: true, value: guestMe() };
    if (method === 'PATCH') {
      if ('handle' in body || 'is_public' in body || 'expose_public_value' in body) {
        throw new Error('Sign in to create a public profile');
      }
      const prefs = readGuestPrefs();
      if (body.display_name && String(body.display_name).length > 40) throw new Error('display_name max 40 chars');
      const next = {
        ...prefs,
        ...(body.display_name !== undefined ? { display_name: String(body.display_name || 'Guest Collector') } : {}),
        ...(body.currency !== undefined ? { currency: String(body.currency || 'USD') } : {}),
        ...(body.notify_price_drops !== undefined ? { notify_price_drops: !!body.notify_price_drops } : {}),
      };
      writeLocalJSON(GUEST_PREFS_KEY, next);
      state.me = guestMe();
      return { handled: true, value: { ok: true } };
    }
  }

  if (pathname === '/api/google/status' && method === 'GET') {
    return { handled: true, value: { connected: false, spreadsheet_id: null } };
  }
  if (pathname.startsWith('/api/google/')) {
    throw new Error('Sign in to sync with Google Sheets');
  }

  if (pathname === '/api/collection') {
    if (method === 'GET') return { handled: true, value: guestCollectionPayload() };
    if (method === 'POST') return { handled: true, value: await guestAddCollection(body) };
  }
  if (pathname === '/api/collection/history' && method === 'GET') {
    return { handled: true, value: guestHistoryPayload(path) };
  }
  if (pathname === '/api/collection/import' && method === 'POST') {
    return { handled: true, value: await guestImportCollection(body.rows, !!body.overwrite) };
  }
  const collectionMatch = pathname.match(/^\/api\/collection\/([^/]+)$/);
  if (collectionMatch) {
    if (method === 'PATCH') return { handled: true, value: guestPatchCollection(collectionMatch[1], body) };
    if (method === 'DELETE') return { handled: true, value: guestDeleteCollection(collectionMatch[1]) };
  }

  if (pathname === '/api/wishlist') {
    if (method === 'GET') return { handled: true, value: guestWishlistPayload() };
    if (method === 'POST') return { handled: true, value: await guestAddWishlist(body) };
  }
  const wishlistMatch = pathname.match(/^\/api\/wishlist\/([^/]+)$/);
  if (wishlistMatch) {
    if (method === 'DELETE') {
      writeGuestWishlist(readGuestWishlist().filter(item => String(item.id) !== String(wishlistMatch[1])));
      return { handled: true, value: null };
    }
    if (method === 'POST') return { handled: true, value: { ok: true } };
  }

  if (pathname === '/api/minifigs' && method === 'GET') {
    return { handled: true, value: await guestMinifigs(path) };
  }
  const figMatch = pathname.match(/^\/api\/minifigs\/(.+)$/);
  if (figMatch) {
    const figNum = decodeURIComponent(figMatch[1]);
    if (method === 'PUT') {
      state.ownedFigs.add(figNum);
      const fig = state.blind.items.find(f => f.fig_num === figNum);
      if (fig) rememberGuestFigDetails([{ ...fig, owned_qty: 1 }]);
      persistOwnedFigs();
      return { handled: true, value: { ok: true, fig_num: figNum, quantity: 1 } };
    }
    if (method === 'DELETE') {
      state.ownedFigs.delete(figNum);
      persistOwnedFigs();
      return { handled: true, value: null };
    }
  }

  if (pathname === '/api/advisor' && method === 'POST' && streamMode) {
    return { handled: true, value: guestAdvisorResponse(body.q || '') };
  }

  if (/^\/api\/sets\/[^/]+$/.test(pathname) && method === 'GET') {
    return { handled: true, value: await guestSetDetail(path) };
  }

  if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/users/')) {
    throw new Error('Sign in to use this feature');
  }

  return { handled: false };
}

/* ---------- API ---------- */
export async function api(path, opts = {}) {
  const token = _authSession?.access_token;
  const streamMode = opts.stream === true;
  if (!token) {
    const guest = await guestApi(path, opts, streamMode);
    if (guest.handled) return guest.value;
  }
  const geminiKey = localStorage.getItem('bv_gemini_key');
  const init = {
    ...opts,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(geminiKey ? { "X-Gemini-Key": geminiKey } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  };
  delete init.stream;
  const _url = (window.WORKER_BASE || '') + path;
  let r;
  try {
    r = await fetch(_url, init);
  } catch (e) {
    if (!navigator.onLine && (init.method === "POST" || init.method === "PATCH" || init.method === "DELETE")) {
      outboxEnqueue({ path, method: init.method, body: opts.body });
      toast("Saved offline — will sync when connected", "info");
      return init.method === "DELETE" ? null : { item: opts.body || {} };
    }
    await new Promise(res => setTimeout(res, 600));
    try {
      r = await fetch(_url, init);
    } catch (e2) {
      if (init.method === "POST" || init.method === "PATCH" || init.method === "DELETE") {
        outboxEnqueue({ path, method: init.method, body: opts.body });
        toast("Saved offline — will sync when connected", "info");
        return init.method === "DELETE" ? null : { item: opts.body || {} };
      }
      throw e2;
    }
  }

  if (r.status === 401) {
    if (_authSession?.refresh_token) {
      try {
        const fresh = await sbRefresh(_authSession.refresh_token);
        saveSession(fresh);
        init.headers["Authorization"] = `Bearer ${fresh.access_token}`;
        r = await fetch(_url, init);
      } catch {
        saveSession(null);
        location.hash = "#/login";
        throw new Error("Session expired — please sign in again");
      }
    } else {
      saveSession(null);
      let msg = "Please sign in to sync this feature";
      try {
        const b = await r.json();
        msg = b.error || b.message || msg;
        if (b.reason) msg += ': ' + b.reason;
      } catch {}
      throw new Error(msg);
    }
  }
  if (!r.ok) {
    let msg = r.statusText;
    try { const b = await r.json(); msg = b.error || msg; if (b.reason) msg += ': ' + b.reason; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  if (streamMode) return r;
  return r.json();
}
