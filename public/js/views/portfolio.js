import { vaultNavigation, setNavBadge, setPageFab, resetPageFab, syncCollectorChrome } from '../components/collector-shell.js';
import { routeMetaFor } from '../route-meta.js';
import { $, $$, haptic, escapeHtml, toast, undoToast, fmtMoney, daysAgo, prefersReducedMotion, themeHue, getExchangeRate, CURRENCY_SYMBOLS, ratesUnavailable, bvIDB, SEARCH_DEBOUNCE_MS, recordPortfolioMilestone, publicOrigin, celebrate, fmtPct, advisorEnabled, fmtDateUpdated, parseUTCDate } from '../utils.js';
import { displayValueOf } from '../lib/pure.js';
import { state, invalidatePortfolio, markSetOwned } from '../state.js';
import { api, getSessionUserId, isGuestMode, getSessionOwnerSnapshot } from '../api.js';
import { shareContent } from '../lib/native-share.js';
import { I } from '../icons.js';
import { confirmSheet, promptSheet } from '../components/sheet.js';
import { openLegalSheet } from '../components/legal-sheet.js';
import { getModePref } from '../theme.js';
import { t, tPlural, getLocale } from '../lib/i18n.js';
import { pricechartingSourceLinkLabel } from '../lib/partner-attribution.js';
import { readCollectorPreferences, writeCollectorPreferences } from '../lib/collector-preferences.js';
import { vaultTotals, changesWindowDays, changeSinceFromSnapshots, changeItems, clipHistory } from '../lib/vault-insights.js';
import { icon, sparkline, delta as deltaChip, emptyState, btn, banner, skeletonRows, chip } from '../ui/kit.js';
import { setTile, gainPct } from '../ui/set-ui.js';
import { vaultTopbar, vaultSearchRow, sortButton, layoutSeg, vaultToolbar, openChoiceSheet, openActionSheet, vaultSetRow, moneyWhole, moneyWholeSigned, holdingValue } from '../ui/vault-ui.js';

// Concise portfolio source credit: PriceCharting is named only when it
// contributes to the blended portfolio; otherwise a generic source link.
function portfolioSourceLinkLabel(portfolio) {
  const basis = Array.isArray(portfolio?.market_value_basis)
    ? portfolio.market_value_basis
    : (Array.isArray(portfolio?.pricing_basis) ? portfolio.pricing_basis : null);
  return pricechartingSourceLinkLabel(basis) || t('market.sourcesGeneric');
}

/* ============================================================
   Vault · Sets (route #/)
   ============================================================ */
const ownerKey = () => getSessionUserId() || 'guest';
// The Vault opens sorted by value unless the collector chose another order.
try { if (!localStorage.getItem('bv_sort')) state.filter.sort = 'value_desc'; } catch { /* storage blocked: keep the default */ }
// Search is open while a query is active, so a remembered query is visible.
let searchOpen = false;

export async function renderPortfolio() {
  const servedFromCache = !!state.portfolio;
  if (!state.portfolio) $("#root").innerHTML = vaultSkeleton();
  await loadPortfolioData();
  if (!onVaultRoute()) return;
  paintPortfolio();
  loadVaultChanges();
  // Stale-while-revalidate: when painted from in-memory cache, refresh in the
  // background so cron/valuation price updates surface without a manual reload.
  if (servedFromCache) _revalidatePortfolio();
}

/**
 * Make sure the collection, its value history and the wishlist are in state
 * (Vault, Insights and What changed all read them). No-op when already loaded.
 */
export async function loadPortfolioData() {
  if (state.portfolio) return state.portfolio;
  // Fetch collection independently — if history or wishlist fail the vault
  // still renders correctly (they were in one Promise.all before, causing any
  // single failure to blank the whole vault while /api/me still showed the count).
  try {
    state.portfolio = await api("/api/collection");
    bvIDB.set('portfolio', { data: state.portfolio, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } catch (e) {
    toast(t('portfolio.collectionLoadFailed', { error: e.message || e }), "error");
    state.portfolio = { items: [], total_value: 0, total_paid: 0, count: 0, _loadFailed: true };
  }
  // History + wishlist are supplementary — fetch best-effort.
  const [hist, wl] = await Promise.all([
    api("/api/collection/history?days=365").catch(() => null),
    api("/api/wishlist").catch(() => null),
  ]);
  state.portfolioHistory = hist ? (hist.snapshots || []) : (state.portfolioHistory || []);
  // Server-declared tier for the history window (free = 90 days, Pro = 365).
  // Drives the Insights range gate instead of silently truncating the chart.
  // Falsy for guests (local vaults have no entitlement).
  if (hist) state.historyPro = !!hist.pro;
  if (wl) {
    state.wishlist = wl.wishlist || [];
    state.wishlistAlerts = wl.unread_alerts || [];
  }
  // Persist the supplementary data too, so a cold offline launch shows the
  // full vault (chart + wishlist), not just the holdings list. Hydrated by
  // hydrateFromIDB with the same userId + freshness guard as the portfolio.
  const _uid = getSessionUserId();
  if (hist) bvIDB.set('history', { data: state.portfolioHistory, ts: Date.now(), userId: _uid }).catch(() => {});
  if (wl) bvIDB.set('wishlist', { data: { wishlist: state.wishlist, alerts: state.wishlistAlerts }, ts: Date.now(), userId: _uid }).catch(() => {});
  return state.portfolio;
}

let _revalidating = false;
async function _revalidatePortfolio() {
  if (_revalidating) return;
  _revalidating = true;
  const token = state._revalToken || 0;
  try {
    const fresh = await api("/api/collection");
    if ((state._revalToken || 0) !== token) return; // mutation happened mid-flight
    const prev = state.portfolio;
    const changed = !prev
      || prev.count !== fresh.count
      || Math.abs((prev.total_value ?? 0) - (fresh.total_value ?? 0)) > 0.005;
    state.portfolio = fresh;
    bvIDB.set('portfolio', { data: fresh, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
    if (changed && onVaultRoute() && !state.selectionMode) paintPortfolio();
  } catch {
    // network / offline — keep stale data
  } finally {
    _revalidating = false;
  }
}

const onVaultRoute = () => { const hash = location.hash.replace("#", "").split("?")[0] || "/"; return hash === "/" || hash === ""; };

// Portfolio value basis (see holdingValue): used holdings are worth their
// used-market price; new/sealed keep the blended fair value.
export function pval(x) {
  return holdingValue(x);
}

/* ---------------------------------------------------------------- "What changed" data */
// The "Since …" card and the What changed screen share one read of
// /api/changes per window. Guests (no server history) and offline sessions fall
// back to the local daily snapshots; movers then stay hidden.
const SEEN_KEY = 'bv_changes_seen_v1:';
export function readChangesSeen(owner = ownerKey()) {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY + owner) || 'null');
    return v && typeof v === 'object' ? { at: v.at || null, retiring: Array.isArray(v.retiring) ? v.retiring : [] } : { at: null, retiring: [] };
  } catch { return { at: null, retiring: [] }; }
}
export function markChangesSeen(retiring = [], owner = ownerKey()) {
  try { localStorage.setItem(SEEN_KEY + owner, JSON.stringify({ at: new Date().toISOString(), retiring: retiring.slice(0, 200) })); } catch { /* storage full: the card simply stays */ }
}
export function changesWindow() {
  return changesWindowDays(readChangesSeen().at);
}

/** Shared "What changed" read: `{ since, days, delta, pct, movers, realized, source }`. */
export async function fetchVaultChanges(days = changesWindow(), { force = false } = {}) {
  const owner = getSessionOwnerSnapshot();
  const cached = state.vaultChanges;
  if (!force && cached && cached.days === days && cached.owner === owner.userId && Date.now() - cached.ts < 5 * 60_000) return cached.data;
  let data = null;
  if (!isGuestMode()) {
    try { data = { ...(await api(`/api/changes?days=${days}`)), source: 'server' }; } catch { data = null; }
  }
  const now = getSessionOwnerSnapshot();
  if (now.userId !== owner.userId || now.generation !== owner.generation) return null;
  if (!data) {
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const local = changeSinceFromSnapshots(state.portfolioHistory || [], since, Number(state.portfolio?.total_value) || 0);
    data = { since: local?.since || since, days, delta: local ? local.delta : null, pct: local ? local.pct : null, movers: [], realized: null, source: 'local' };
  }
  state.vaultChanges = { data, days, ts: Date.now(), owner: owner.userId };
  return data;
}

async function loadVaultChanges() {
  const data = await fetchVaultChanges().catch(() => null);
  if (!data || !onVaultRoute()) return;
  const hero = $('#vaultHeroSub');
  if (hero) hero.innerHTML = heroSubHTML(vaultTotals(state.portfolio?.items || [], pval));
  const slot = $('#vaultSinceSlot');
  if (slot) slot.innerHTML = sinceCardHTML(data);
}

/** Retiring-soon holdings and wishlist sets (LEGO.com flag, not yet retired). */
export function retiringSets() {
  const flag = (r) => !(r.retired === 1 || r.retired === true) && (Number(r.lego_retiring_soon) === 1 || r.lego_retiring_soon === true);
  const owned = new Map();
  for (const r of state.portfolio?.items || []) if (flag(r) && !owned.has(r.set_num)) owned.set(r.set_num, r);
  const ownedNums = new Set(owned.keys());
  const wished = (state.wishlist || []).filter(r => flag(r) && !ownedNums.has(r.set_num));
  return { owned: [...owned.values()], wished };
}

/** "Since Monday" / "Since yesterday" / "Since 12 Sep" for an ISO date. */
export function sinceLabel(isoDate) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return t('bvVault.sinceYesterday');
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days <= 1) return t('bvVault.sinceYesterday');
  if (days < 7) return t(`bvVault.sinceWeekday${d.getDay()}`);
  let date = String(isoDate);
  try { date = d.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' }); } catch { /* keep ISO */ }
  return t('bvVault.sinceDate', { date });
}

/** One short line per change for summaries ("Starry Night hit your target"). */
export function changeLine(item) {
  const name = item.name || item.set_num || '';
  if (item.kind === 'drop') return t('bvVault.changeDrop', { name });
  if (item.kind === 'sell_target') return t('bvVault.changeSellTarget', { name });
  if (item.kind === 'spike') return t('bvVault.changeSpike', { name });
  return t('bvVault.changeRetiring', { name });
}

function currentChangeItems() {
  const { owned, wished } = retiringSets();
  const seen = new Set(readChangesSeen().retiring);
  return {
    all: changeItems({ alerts: state.wishlistAlerts || [], retiringOwned: owned, retiringWished: wished }),
    fresh: changeItems({ alerts: state.wishlistAlerts || [], retiringOwned: owned.filter(r => !seen.has(r.set_num)), retiringWished: wished.filter(r => !seen.has(r.set_num)) }),
  };
}

function sinceCardHTML(data) {
  const { fresh } = currentChangeItems();
  const d = Number(data?.delta);
  const moved = data && data.delta != null && Number.isFinite(d) && Math.abs(d) >= 1;
  // Hide when nothing changed: no unread alerts, no new retirement news and no
  // value movement worth a dollar.
  if (!fresh.length && !moved) return '';
  const since = sinceLabel(data?.since || new Date(Date.now() - 7 * 86400000).toISOString());
  const title = moved ? t('bvVault.sinceWithAmount', { since, amount: moneyWholeSigned(d) }) : since;
  const lines = fresh.slice(0, 2).map(changeLine);
  if (fresh.length > 2) lines.push(tPlural('bvVault.changeMore', fresh.length - 2));
  const sub = lines.length ? lines.join(' · ') : (data?.pct != null ? t('bvVault.sinceValueMoved', { pct: fmtPct(Number(data.pct) / 100) }) : '');
  return `<a class="vault-since" href="#/changes" id="vaultSince">${icon('bell', { size: 20 })}<span class="vault-since__text"><span class="vault-since__title">${escapeHtml(title)}</span>${sub ? `<span class="vault-since__sub">${escapeHtml(sub)}</span>` : ''}</span>${icon('chev', { size: 20 })}</a>`;
}

/* ---------------------------------------------------------------- list state */
const SORTS = [
  { value: 'added_desc', key: 'sortRecent' },
  { value: 'value_desc', key: 'sortValue' },
  { value: 'roi_desc', key: 'sortGrowth' },
  { value: 'az', key: 'sortAz' },
];
const sortKeyOf = (value) => (SORTS.find(s => s.value === value) || SORTS[0]).key;

// Filter + sort the vault items according to current state.filter. Pure — no DOM.
function sortedPortfolioItems() {
  // Null-safe: invalidatePortfolio() sets state.portfolio to null between a
  // mutation and the refetch, and any repaint in that window must not throw.
  const p = state.portfolio || { items: [] };
  let items = (p.items || []).slice();
  const q = state.filter.q.toLowerCase().trim();
  if (q) items = items.filter(i => i.name?.toLowerCase().includes(q) || i.set_num?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q));
  switch (state.filter.sort) {
    case "added_desc": items.sort((a, b) => new Date(b.added_at || 0) - new Date(a.added_at || 0)); break;
    case "value_desc": items.sort((a, b) => pval(b) - pval(a)); break;
    case "roi_desc":   items.sort((a, b) => (b.annualized_roi ?? -1) - (a.annualized_roi ?? -1)); break;
    case "az":         items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))); break;
  }
  return items;
}

const currentLayout = () => (state.selectionMode ? 'list' : readCollectorPreferences(getSessionUserId()).layout);

function rowHTML(item) {
  const value = pval(item);
  const qty = Number(item.quantity) || 1;
  const known = item.purchase_price != null && item.purchase_price !== '' && Number(item.purchase_price) >= 0;
  const pct = known ? gainPct(value, item.purchase_price) : null;
  const ref = String(item.id || item.set_num);
  return vaultSetRow(item, {
    value, qty, id: ref,
    deltaPct: pct,
    hintHref: known ? null : `#/set/${encodeURIComponent(item.set_num)}/edit`,
    selecting: state.selectionMode,
    selected: state.selectedSets.has(ref),
  });
}

function tileHTML(item) {
  const qty = Number(item.quantity) || 1;
  return setTile(item, { value: pval(item), tagHtml: qty > 1 ? `<span class="bv-pill bv-pill--ink">×${qty}</span>` : '' });
}

/* ---------------------------------------------------------------- list rendering */
// Progressive mount: the first rows paint immediately, the rest in animation
// frame slices, and further pages load as the sentinel nears the viewport.
let portfolioOffset = 20;
const PAGE = 20;

function repaintSetList() {
  const list = $("#setList");
  if (!list) return;
  const items = sortedPortfolioItems();
  if (state._portfolioObserver) { state._portfolioObserver.disconnect(); state._portfolioObserver = null; }
  if (items.length === 0) {
    list.className = 'vault-list';
    list.innerHTML = `<div class="collector-no-results">${emptyState({ icon: 'search', title: t('collector.noResults'), actionsHtml: btn(t('collector.clearSearch'), { kind: 'tonal', id: 'clearVaultSearch' }) })}</div>`;
    // Keep focus in search until activation: collapsing the mobile keyboard
    // during pointerdown can move this button before pointerup arrives.
    $('#clearVaultSearch')?.addEventListener('pointerdown', event => event.preventDefault());
    $('#clearVaultSearch')?.addEventListener('click', () => { state.filter.q = ''; if ($('#portfolioSearch')) $('#portfolioSearch').value = ''; repaintSetList(); });
    return;
  }
  const grid = currentLayout() === 'grid';
  list.className = grid ? 'vault-list bv-grid' : 'vault-list';
  const render = grid ? tileHTML : rowHTML;
  portfolioOffset = PAGE;
  const firstPage = items.slice(0, portfolioOffset);
  const SLICE = 8;
  const mountSlice = (start) => {
    if (!list.isConnected) return;
    const chunk = firstPage.slice(start, start + SLICE).map(render).join("");
    if (start === 0) list.innerHTML = chunk;
    else list.insertAdjacentHTML("beforeend", chunk);
    const next = start + SLICE;
    if (next < firstPage.length) requestAnimationFrame(() => mountSlice(next));
    else setupPortfolioSentinel(items, render);
  };
  mountSlice(0);
}

function setupPortfolioSentinel(items, render) {
  const list = $("#setList");
  const sentinel = $("#portfolioSentinel");
  if (!list || !sentinel) return;
  if (state._portfolioObserver) state._portfolioObserver.disconnect();
  sentinel.hidden = items.length <= portfolioOffset;
  if (items.length <= portfolioOffset) return;
  state._portfolioObserver = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting || items.length <= portfolioOffset) return;
    const nextPage = items.slice(portfolioOffset, portfolioOffset + PAGE);
    portfolioOffset += PAGE;
    list.insertAdjacentHTML("beforeend", nextPage.map(render).join(""));
    if (portfolioOffset >= items.length) {
      sentinel.hidden = true;
      state._portfolioObserver?.disconnect();
    }
  }, { rootMargin: "400px" });
  state._portfolioObserver.observe(sentinel);
}

// One delegated handler for the list: selection toggles, long-press to select
// (with the visible "Select sets" twin in More options).
function wireSetList() {
  const list = $("#setList");
  if (!list || list._wired) return;
  list._wired = true;
  let longPressAt = 0;
  list.addEventListener("click", (e) => {
    const rowEl = e.target.closest('.vault-row, .bv-tile');
    if (!rowEl) return;
    if (!state.selectionMode) { haptic("light"); return; }
    e.preventDefault();
    // The click that ends a long-press must not immediately un-select the row.
    if (Date.now() - longPressAt < 450) return;
    const id = rowEl.dataset.id;
    if (!id) return;
    const nowSelected = !state.selectedSets.has(id);
    if (nowSelected) state.selectedSets.add(id); else state.selectedSets.delete(id);
    haptic("light");
    rowEl.classList.toggle('is-selected', nowSelected);
    rowEl.querySelector('[role="checkbox"]')?.setAttribute('aria-checked', String(nowSelected));
    const mark = rowEl.querySelector('.vault-row__check');
    if (mark) mark.innerHTML = nowSelected ? icon('check', { size: 16, stroke: 3 }) : '';
    updateSelectionBar();
  });
  let timer = null;
  const start = (e) => {
    const rowEl = e.target.closest('.vault-row');
    if (!rowEl || state.selectionMode) return;
    timer = setTimeout(() => { timer = null; longPressAt = Date.now(); enterSelectionMode(rowEl.dataset.id); }, 600);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  list.addEventListener("touchstart", start, { passive: true });
  list.addEventListener("touchend", cancel, { passive: true });
  list.addEventListener("touchmove", cancel, { passive: true });
  list.addEventListener("contextmenu", (e) => {
    const rowEl = e.target.closest('.vault-row');
    if (!rowEl) return;
    e.preventDefault();
    if (!state.selectionMode) { longPressAt = Date.now(); enterSelectionMode(rowEl.dataset.id); }
  });
}

/* ---------------------------------------------------------------- page */
function vaultSkeleton() {
  return `<main class="bv-page has-fab vault-page" aria-busy="true">${vaultTopbar()}<div class="bv-card bv-hero vault-hero" aria-hidden="true"><span class="bv-skel" style="height:14px;width:40%"></span><span class="bv-skel" style="height:40px;width:60%"></span><span class="bv-skel" style="height:14px;width:75%"></span></div>${vaultNavigation('sets')}${skeletonRows(5)}</main>`;
}

function heroValueText(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return moneyWhole(n);
}

function heroSubHTML(totals) {
  const parts = [];
  if (totals.paid > 0 || totals.pricedValue > 0) parts.push(t('bvVault.onPaper', { amount: moneyWholeSigned(totals.paperGain) }));
  const realized = state.vaultChanges?.data?.realized || (state.portfolio?.realized_gain != null ? { gain: state.portfolio.realized_gain, sales: state.portfolio.realized_sales ?? 1 } : null);
  if (realized && Number(realized.sales) > 0) parts.push(tPlural('bvVault.realizedFrom', Number(realized.sales), { amount: moneyWholeSigned(Number(realized.gain) || 0) }));
  if (!parts.length) return escapeHtml(t('bvVault.addPricesForGain'));
  return escapeHtml(parts.join(' · '));
}

function heroStatusHTML(p) {
  const notes = [];
  if (document.body.classList.contains('offline') || navigator.onLine === false) notes.push({ icon: 'cloudOff', text: t('bvVault.heroOffline') });
  if (ratesUnavailable() && (state.me?.currency || "USD") !== "USD") notes.push({ icon: 'info', text: t('bvVault.heroUsd') });
  if (p._loadFailed) notes.push({ icon: 'alert', text: t('bvVault.heroLoadFailed') });
  return notes.map(n => `<span class="vault-hero__status">${icon(n.icon, { size: 14 })}<span>${escapeHtml(n.text)}</span></span>`).join('');
}

function heroHTML(p, totals) {
  const hist = clipHistory(state.portfolioHistory || [], 90).map(s => Number(s.total_value)).filter(v => Number.isFinite(v));
  const spark = sparkline(hist, { width: 340, height: 40 });
  const chip = totals.gainPct != null
    ? deltaChip(totals.gainPct, { srUp: t('bvCommon.upPct', { pct: Math.abs(totals.gainPct).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(totals.gainPct).toFixed(1) }) })
    : '';
  const value = p.total_value ?? totals.value;
  return `<a class="bv-card bv-hero vault-hero" href="#/insights" id="vaultHero">
    <span class="vault-hero__head"><span class="vault-hero__label">${escapeHtml(t('bvVault.collectionValue'))}</span><span class="bv-card__link">${escapeHtml(t('bvVault.insights'))}${icon('chev', { size: 16 })}</span></span>
    <span class="bv-hero__line"><span class="bv-hero__value" id="heroValue" aria-label="${escapeHtml(heroValueText(value))}" aria-live="off">${escapeHtml(heroValueText(value))}</span>${chip}</span>
    <span class="vault-hero__sub" id="vaultHeroSub">${heroSubHTML(totals)}</span>
    ${spark || (hist.length ? `<span class="vault-hero__note">${escapeHtml(t('bvVault.trendSoon'))}</span>` : '')}
    ${heroStatusHTML(p)}
  </a>`;
}

function saveStatusHTML() {
  const pending = state.pendingCollectionOperationList || [];
  if (!pending.length) return '';
  const failed = pending.some(item => item.state === 'failed');
  return banner({ icon: failed ? 'alert' : 'cloud', kind: failed ? 'loss' : 'neutral', text: t(failed ? 'collector.saveFailed' : 'collector.savePending'), id: 'vaultSaveStatus' });
}

// "values updated today 06:00" / "… yesterday 22:10" / "… 12 Sep".
function updatedLabel(stamp) {
  const d = parseUTCDate(stamp);
  if (!d) return t('bvVault.footUpdatedDate', { date: fmtDateUpdated(stamp) });
  const now = new Date();
  const dayKey = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const yesterday = new Date(now.getTime() - 86400000);
  let time = '';
  try { time = d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }); } catch { time = ''; }
  if (dayKey(d) === dayKey(now)) return t('bvVault.footUpdatedToday', { time });
  if (dayKey(d) === dayKey(yesterday)) return t('bvVault.footUpdatedYesterday', { time });
  let date = '';
  try { date = d.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' }); } catch { date = String(stamp).slice(0, 10); }
  return t('bvVault.footUpdatedDate', { date });
}

function footHTML(p, totals) {
  const stamps = (p.items || []).map(i => i.cached_at).filter(Boolean).sort();
  const parts = [tPlural('bvVault.footSets', totals.sets), tPlural('bvVault.footPieces', totals.pieces, { count: totals.pieces.toLocaleString(getLocale()) })];
  if (stamps.length) parts.push(updatedLabel(stamps.at(-1)));
  const conf = p.pricing_confidence?.priced ? t('market.confidentlyPriced', { pct: p.pricing_confidence.pct }) : '';
  return `<div class="bv-foot vault-foot"><p>${escapeHtml(parts.join(' · '))}</p>
    <p>${conf ? `${escapeHtml(conf)} · ` : ''}${escapeHtml(t('market.estimatedNotRealized'))} · <button type="button" class="vault-foot__link" data-legal-sheet="partners">${escapeHtml(portfolioSourceLinkLabel(p))}</button></p></div>`;
}

async function loadPinnedLists() {
  const host = $('#collectorPinned');
  const owner = getSessionOwnerSnapshot();
  const pins = readCollectorPreferences(owner.userId).pins;
  if (!host || !pins.length) return;
  try {
    const { subcollectionRequest } = await import('../lib/subcollection-storage.js');
    const result = await subcollectionRequest();
    const now = getSessionOwnerSnapshot();
    if (!host.isConnected || now.userId !== owner.userId || now.generation !== owner.generation) return;
    const lists = (result.subcollections || []).filter(list => pins.includes(list.id));
    if (!lists.length) return;
    host.innerHTML = `<nav class="collector-pins bv-chips" aria-label="${escapeHtml(t('bvVault.pinnedLists'))}">${lists.map(list => chip(list.name, { icon: 'star', href: `#/collections?list=${encodeURIComponent(list.id)}` })).join('')}</nav>`;
  } catch { /* Pins are optional shortcuts; a failed read never hides the vault. */ }
}

function paintPortfolio() {
  const p = state.portfolio;
  if (!p) return;
  // Full repaints reset the scroll position — a state change while deep in a
  // long vault list used to jump the user back to the top. Save and restore.
  const scrollYBefore = window.scrollY;
  const items = p.items || [];
  const isEmptyVault = items.length === 0;
  const totals = vaultTotals(items, pval);
  // Record the current totals as the milestone baseline so deleting sets lowers
  // it — re-crossing a threshold later celebrates again (uses total_value, the
  // same basis the add-flow milestone check reads from /api/collection).
  recordPortfolioMilestone(p.count ?? items.length, p.total_value ?? 0);
  if (state.filter.q) searchOpen = true;
  const showSearch = searchOpen && !isEmptyVault;
  const layout = currentLayout();
  const hasFigs = Number(p.fig_count) > 0;

  $("#root").innerHTML = `
    <main class="bv-page ${isEmptyVault ? '' : 'has-fab '}vault-page${state.selectionMode ? ' has-bar' : ''}" id="vaultPage">
      ${vaultTopbar({ searchOpen: showSearch })}
      ${showSearch ? vaultSearchRow({ id: 'portfolioSearch', name: 'vault_search', value: state.filter.q, placeholder: t('bvVault.searchPlaceholder'), label: t('collector.search') }) : ''}
      ${saveStatusHTML()}
      ${isEmptyVault ? `${emptyVaultHTML()}${hasFigs ? vaultNavigation('sets') : ''}` : `
      ${showSearch ? '' : heroHTML(p, totals)}
      ${showSearch ? '' : `<div id="vaultSinceSlot">${state.vaultChanges?.owner === getSessionUserId() ? sinceCardHTML(state.vaultChanges.data) : ''}</div>`}
      ${showSearch ? '' : '<div id="collectorPinned"></div>'}
      ${vaultNavigation('sets')}
      ${vaultToolbar(sortButton(t(`bvVault.${sortKeyOf(state.filter.sort)}`)), layoutSeg(layout))}
      <div id="setList" class="vault-list" aria-live="polite"></div>
      <div id="portfolioSentinel" class="vault-sentinel" hidden><span class="bv-skel"></span></div>
      ${footHTML(p, totals)}`}
    </main>`;

  // The empty vault's actions ARE the primary actions: no Scan FAB there. A
  // first add repaints into the populated vault, which gets the route's FAB back.
  if (isEmptyVault) setPageFab(null);
  else if (!document.getElementById('bvFab')?._bvFab) { resetPageFab(); syncCollectorChrome(routeMetaFor(location.hash.replace('#', '') || '/')); }
  wireVaultChrome();
  if (!isEmptyVault) {
    wireSetList();
    // Mount the first card slice synchronously. Deferring the *first* call left a
    // data-populated vault visually blank when a guest added their first set and
    // the browser throttled/dropped the scheduled frame.
    repaintSetList();
    if (!showSearch) { animateHeroValue(p.total_value ?? totals.value); loadPinnedLists(); }
  } else {
    wireEmptyVaultBrick3D();
  }
  if (state.selectionMode) showSelectionBar();
  if (scrollYBefore > 0) requestAnimationFrame(() => window.scrollTo(0, scrollYBefore));
  // Mirror the fresh totals to the Android home-screen widget (no-op on web).
  import('../lib/native-widget.js').then(m => m.updateVaultWidget({
    value: fmtMoney(p.total_value ?? totals.value, { cents: 0 }),
    delta: totals.gainPct == null ? '' : `${totals.paperGain >= 0 ? "▲" : "▼"} ${fmtMoney(Math.abs(totals.paperGain), { cents: 0 })} (${fmtPct(Math.abs(totals.gainPct) / 100)})`,
    deltaUp: totals.paperGain >= 0,
    sets: p.set_count ?? items.length,
    owner: getSessionUserId() || 'guest',
  })).catch(() => {});
  checkAnniversaries(items);
  refreshNavBadge();
}

function wireVaultChrome() {
  $("#vaultSearchBtn")?.addEventListener("click", () => {
    haptic("light");
    searchOpen = !searchOpen;
    if (!searchOpen) state.filter.q = '';
    paintPortfolio();
    if (searchOpen) $("#portfolioSearch")?.focus();
  });
  let portfolioSearchTimer = null;
  $("#portfolioSearch")?.addEventListener("input", (e) => {
    const input = e.target;
    state.filter.q = input.value;
    clearTimeout(portfolioSearchTimer);
    portfolioSearchTimer = setTimeout(() => { if (input.isConnected) repaintSetList(); }, SEARCH_DEBOUNCE_MS);
  });
  $("#portfolioSearch")?.addEventListener("keydown", (e) => { if (e.key === 'Escape' && !state.filter.q) { searchOpen = false; paintPortfolio(); } });
  $("#vaultSortBtn")?.addEventListener("click", openSortSheet);
  $$('#vaultPage [data-layout]').forEach(b => b.addEventListener('click', () => {
    const layout = b.dataset.layout;
    if (layout === currentLayout()) return;
    haptic("light");
    if (!writeCollectorPreferences(getSessionUserId(), { layout })) toast(t('collector.preferenceFailed'), 'error');
    $$('#vaultPage [data-layout]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.layout === layout)));
    repaintSetList();
  }));
  $("#vaultMoreBtn")?.addEventListener("click", openVaultMoreSheet);
  $$("#vaultPage [data-legal-sheet]").forEach(link => link.addEventListener("click", () => openLegalSheet(link.dataset.legalSheet)));
  $$("#vaultPage [data-empty-action]").forEach(b => b.addEventListener("click", async () => {
    haptic("light");
    const { openScan } = await import('../components/scanner-lazy.js');
    if (b.dataset.emptyAction === 'shelf') openScan('image', { shelf: true });
    else openScan('barcode');
  }));
}

function openSortSheet() {
  haptic("light");
  const simple = getModePref() === 'simple';
  openChoiceSheet({
    title: t('bvVault.sortTitle'),
    current: state.filter.sort,
    options: SORTS.filter(s => !(simple && s.value === 'roi_desc')).map(s => ({ value: s.value, label: t(`bvVault.${s.key}`), sub: t(`bvVault.${s.key}Sub`) })),
    onPick: (value) => {
      if (value === state.filter.sort) return;
      state.filter.sort = value;
      try { localStorage.setItem("bv_sort", value); } catch { /* per-session only */ }
      const btnEl = $("#vaultSortBtn");
      if (btnEl) btnEl.outerHTML = sortButton(t(`bvVault.${sortKeyOf(value)}`));
      $("#vaultSortBtn")?.addEventListener("click", openSortSheet);
      repaintSetList();
    },
  });
}

// Daily price-game state for the More options row (the game lives at #/game).
function gameTeaserSub() {
  let played = false;
  let score = 0;
  try {
    const r = JSON.parse(localStorage.getItem("bv_game_result") || "null");
    const today = new Date().toISOString().slice(0, 10);
    if (r?.day === today) { played = true; score = (r.results || []).filter(x => x.correct).length; }
  } catch { /* no local game state */ }
  let streak = 0;
  try { streak = JSON.parse(localStorage.getItem("bv_game_streak") || "null")?.streak || 0; } catch { /* none */ }
  const base = played ? t('bvVault.gamePlayed', { score }) : t('bvVault.gameSub');
  return streak > 1 ? `${base} · ${tPlural('bvVault.gameStreak', streak)}` : base;
}

export async function sharePortfolio() {
  const handle = state.me?.handle;
  if (!handle) return;
  haptic("light");
  const shareUrl = `${publicOrigin()}/#/u/${encodeURIComponent(handle)}`;
  const outcome = await shareContent({
    title: t('share.portfolioTitle'),
    text: t('share.portfolioText'),
    url: shareUrl,
    dialogTitle: t('share.portfolioDialogTitle'),
  });
  if (outcome === 'unsupported') {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast(t('bvVault.linkCopied'), "success");
    } catch {
      toast(t('bvVault.shareUnavailable'), "error");
    }
  }
}

function openVaultMoreSheet() {
  haptic("light");
  const items = state.portfolio?.items || [];
  const alertsCount = (state.wishlistAlerts || []).length;
  const layout = currentLayout();
  openActionSheet({
    title: t('bvVault.moreOptions'),
    groups: [
      { rows: [
        items.length ? { id: 'vaultMoreSelect', icon: 'check', label: t('bvVault.selectSets'), sub: t('bvVault.selectSetsSub'), onClick: () => enterSelectionMode() } : null,
        { id: 'vaultMoreAlerts', icon: 'bell', label: t('bvVault.whatChanged'), sub: alertsCount ? tPlural('bvVault.unreadAlerts', alertsCount) : t('bvVault.whatChangedSub'), href: '#/changes' },
        items.length ? { id: 'vaultMoreInsights', icon: 'pie', label: t('bvVault.insights'), sub: t('bvVault.insightsSub'), href: '#/insights' } : null,
        items.length ? { id: 'vaultMoreLayout', icon: layout === 'grid' ? 'list' : 'grid', label: t(layout === 'grid' ? 'bvVault.showAsList' : 'bvVault.showAsGrid'), onClick: () => { $(`#vaultPage [data-layout="${layout === 'grid' ? 'list' : 'grid'}"]`)?.click(); } } : null,
        { id: 'vaultMoreRoom', icon: 'room', label: t('bvVault.collectionRoom'), sub: t('bvVault.collectionRoomSub'), href: '#/room', },
      ] },
      { title: t('bvVault.moreGroupShare'), rows: [
        { id: 'vaultMoreWishlist', icon: 'heart', label: t('collector.wishlist'), trail: state.wishlist.length ? String(state.wishlist.length) : '', href: '#/wishlist' },
        items.length ? { id: 'vaultMoreExport', icon: 'download', label: t('bvVault.exportCollection'), sub: t('bvVault.exportCollectionSub'), href: '#/me/data' } : null,
        (state.me?.handle && state.me?.is_public) ? { id: 'vaultMoreShare', icon: 'share', label: t('bvVault.sharePublicProfile'), onClick: sharePortfolio } : null,
        { id: 'vaultMoreGame', icon: 'game', label: t('bvVault.priceGame'), sub: gameTeaserSub(), href: '#/game' },
        advisorEnabled() ? { id: 'vaultMoreAdvisor', icon: 'chat', label: t('collector.advisor'), href: '#/advisor' } : null,
        { id: 'vaultMoreSources', icon: 'info', label: t('bvVault.howWePrice'), onClick: () => openLegalSheet('partners') },
      ] },
    ],
  });
}

// Set anniversaries: exactly N years to the day since a set was purchased →
// a one-time celebration with the gain since. At most one per page load, each
// (set, year) fires once ever (localStorage de-dup).
function checkAnniversaries(items) {
  const today = new Date();
  for (const it of items || []) {
    if (!it.purchased_at) continue;
    const d = new Date(it.purchased_at);
    if (Number.isNaN(d.getTime())) continue;
    const years = today.getUTCFullYear() - d.getUTCFullYear();
    if (years < 1) continue;
    if (d.getUTCMonth() !== today.getUTCMonth() || d.getUTCDate() !== today.getUTCDate()) continue;
    const key = `bv_anniv_${it.set_num}_${years}`;
    if (localStorage.getItem(key)) continue;
    try { localStorage.setItem(key, "1"); } catch {}
    const paid = Number(it.purchase_price) || 0;
    const now = Number(displayValueOf(it)) || 0;
    const gain = paid > 0 && now > 0 ? now - paid : null;
    const quip = gain != null
      ? (gain >= 0 ? t('portfolio.anniversaryGain', { paid: fmtMoney(paid), gain: fmtMoney(gain) }) : t('portfolio.anniversaryNoGain', { paid: fmtMoney(paid) }))
      : t('portfolio.anniversaryQuip');
    setTimeout(() => celebrate(tPlural('portfolio.anniversaryCelebration', years, { set: it.name || it.set_num }), { quip, hue: themeHue(it.theme || "") }), 1200);
    break;
  }
}

function heroValueHTML(n) {
  if (n == null || isNaN(n)) return `—`;
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  const converted = n * rate;
  const whole = Math.round(Math.abs(converted)).toLocaleString("en-US");
  return `${converted < 0 ? "-" : ""}${symbol}${whole}`;
}

let _lastHeroValue = 0;
let _heroAnimationFrame = 0;

function animateHeroValue(target) {
  const el = $("#heroValue");
  if (!el || target == null || isNaN(target) || target <= 0) return;
  cancelAnimationFrame(_heroAnimationFrame);
  // Keep the final amount in the accessibility tree while the visible digits
  // interpolate. Screen readers should not announce dozens of frame updates.
  el.setAttribute("aria-label", heroValueText(target));
  el.setAttribute("aria-live", "off");
  if (prefersReducedMotion() || _lastHeroValue === target) { el.style.removeProperty("min-width"); el.textContent = heroValueHTML(target); _lastHeroValue = target; return; }
  // The template initially contains the final value. Preserve that exact width
  // while counting from the previous total so the neighbouring delta chip
  // cannot re-wrap and vertically recenter the amount mid-animation.
  el.style.minWidth = `${el.getBoundingClientRect().width}px`;
  const dur = 750;
  const start = performance.now();
  const from = _lastHeroValue;
  _lastHeroValue = target;
  const tick = (now) => {
    // A callback queued during an active frame can receive that frame's start
    // timestamp, slightly earlier than performance.now() above. Clamp both ends
    // so the first value cannot extrapolate below `from`.
    const p = Math.max(0, Math.min(1, (now - start) / dur));
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = heroValueHTML(from + (target - from) * eased);
    if (p < 1) _heroAnimationFrame = requestAnimationFrame(tick);
    else { _heroAnimationFrame = 0; el.style.removeProperty("min-width"); }
  };
  _heroAnimationFrame = requestAnimationFrame(tick);
}

/* ---------------------------------------------------------------- empty vault */
function wireEmptyVaultBrick3D() {
  const trigger = document.querySelector('.empty-vault-brick-3d-trigger');
  const stage = document.querySelector('.empty-vault-brick-stage');
  if (!trigger || !stage || trigger.dataset.wired === 'true') return;
  const hideEmptyVaultBrick3d =
    Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory) <= 2;
  if (hideEmptyVaultBrick3d) {
    trigger.hidden = true;
    return;
  }
  trigger.dataset.wired = 'true';
  const activationLabel = trigger.textContent;
  trigger.addEventListener('click', async () => {
    const status = stage.querySelector('.empty-vault-brick-3d-status');
    trigger.disabled = true;
    trigger.textContent = t('portfolio.loadingBrick3d');
    stage.classList.add('is-crack-vault-open');
    try {
      const { startEmptyVaultBrick3D } = await import('../components/empty-vault-brick-3d.js');
      const controller = await startEmptyVaultBrick3D(stage, {
        play: t('portfolio.crackVaultInstructions'),
        watch: t('portfolio.crackVaultWatch'),
        repeat: t('portfolio.crackVaultRepeat'),
        progress: t('portfolio.crackVaultProgress'),
        wrong: t('portfolio.crackVaultWrong'),
        unlocked: t('portfolio.crackVaultUnlocked'),
        stud: t('portfolio.crackVaultStud'),
        reward: t('portfolio.crackVaultReward'),
        replay: t('portfolio.crackVaultReplay'),
      });
      if (controller) trigger.hidden = true;
    } catch (error) {
      stage.dataset.emptyVault3dError = 'true';
      stage.classList.remove('is-crack-vault-active');
      stage.querySelector('.empty-vault-brick-fallback')?.removeAttribute('hidden');
      if (status) status.textContent = error instanceof Error ? error.message : t('bvVault.brick3dUnavailable');
    } finally {
      trigger.disabled = false;
      trigger.textContent = activationLabel;
    }
  });
}

// Empty vault (new collector, 0 sets): the shelf card, then the three ways in —
// photograph a whole shelf, import an existing list, or scan one box. The
// "Crack the Brickvault" 3D mini-game stays behind an explicit text button and
// loads Three.js only when asked.
function emptyVaultHTML() {
  const action = ({ icon: name, title, sub, href, attr, primary = false }) => {
    const tag = href ? 'a' : 'button';
    return `<${tag} class="vault-empty-action${primary ? ' is-primary' : ''}" ${href ? `href="${href}"` : `type="button" ${attr}`}>${icon(name, { size: 26 })}<span class="vault-empty-action__text"><span class="vault-empty-action__title">${escapeHtml(title)}</span><span class="vault-empty-action__sub">${escapeHtml(sub)}</span></span>${icon('chev', { size: 20 })}</${tag}>`;
  };
  return `
    <section class="bv-card vault-empty" aria-labelledby="vaultEmptyTitle">
      <div class="empty-vault-brick-stage">
        <div class="vault-empty__shelf" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="vault-empty__plank" aria-hidden="true"></div>
        <img class="empty-vault-brick-fallback" src="/brand-brick-transparent.png" alt="" width="144" height="144" aria-hidden="true" hidden>
        <p class="empty-vault-brick-3d-status bv-sr" role="status" aria-live="polite">${escapeHtml(t('portfolio.crackVaultInstructions'))}</p>
      </div>
      <h2 id="vaultEmptyTitle">${escapeHtml(t('bvVault.emptyTitle'))}</h2>
      <p>${escapeHtml(t('bvVault.emptyBody'))}</p>
      <button type="button" class="empty-vault-brick-3d-trigger bv-btn bv-btn--text bv-btn--sm" aria-label="${escapeHtml(t('portfolio.crackVaultLabel'))}">${escapeHtml(t('portfolio.crackVault'))}</button>
    </section>
    <div class="vault-empty-actions">
      ${action({ icon: 'camera', title: t('bvVault.emptyShelfTitle'), sub: t('bvVault.emptyShelfSub'), attr: 'data-empty-action="shelf"', primary: true })}
      ${action({ icon: 'box', title: t('bvVault.emptyImportTitle'), sub: t('bvVault.emptyImportSub'), href: '#/me/data' })}
      ${action({ icon: 'scan', title: t('bvVault.emptyScanTitle'), sub: t('bvVault.emptyScanSub'), attr: 'data-empty-action="scan"' })}
      <a class="vault-empty-link" href="#/add">${icon('search', { size: 20 })}<span>${escapeHtml(t('bvVault.emptyBrowse'))}</span></a>
    </div>`;
}

/* ============================================================
   Alerts (shared with the Wishlist view)
   ============================================================ */
export function spikeAlertCardHTML(a, { dismiss = false } = {}) {
  const gain = a.purchase_price && a.current_value
    ? (a.current_value - (a.purchase_price || 0)) / (a.purchase_price || 1) : 0;
  return `
    <div class="alert-card spike-alert" data-set="${escapeHtml(a.set_num || "")}">
      ${dismiss && a.id ? `<button class="alert-dismiss" data-alert-id="${escapeHtml(String(a.id))}" aria-label="Mark this alert read" title="Mark read">✓</button>` : ""}
      <div class="ah">${I.dollar()}${escapeHtml(tPlural('alerts.sellOpportunity', daysAgo(a.triggered_at)))}</div>
      <div style="font-weight:600;">${escapeHtml(a.set_name || a.name || "")}</div>
      <div style="font-size:13px;margin-top:4px;">
        ${escapeHtml(t('bvVault.alertSpikeSub', { price: fmtMoney(a.current_value), paid: fmtMoney(a.purchase_price || 0) }))}
        <span style="color:var(--up);font-weight:700;">${escapeHtml(t('bvVault.spikeGain', { pct: `+${fmtPct(Math.abs(gain))}` }))}</span>
      </div>
      <a href="#/set/${encodeURIComponent(a.set_num || "")}" class="btn-secondary" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;padding:6px 14px;text-decoration:none;">${escapeHtml(t('bvVault.considerSelling'))}${I.arrowR()}</a>
    </div>`;
}

export function refreshNavBadge() {
  const alerts = state.wishlistAlerts || [];
  const spikes = alerts.filter(a => a.alert_type === 'spike').length;
  const drops = alerts.filter(a => a.alert_type === 'drop' || !a.alert_type).length;
  const total = spikes + drops;
  // Bottom-bar Wishlist badge (2026 shell).
  setNavBadge('/wishlist', total);

  const el = document.getElementById("wishlistBtn");
  if (!el) return;

  let badge = el.querySelector(".dot");
  if (total > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "dot";
      el.appendChild(badge);
    }
    badge.style.display = "inline-flex";
    badge.textContent = total;
    const alertTooltip = {
      spikes: tPlural('portfolio.wishlistAlertSpikes', spikes),
      drops: tPlural('portfolio.wishlistAlertDrops', drops),
    };
    el.title = t('portfolio.wishlistAlertsTooltip', alertTooltip);
  } else {
    if (badge) badge.style.display = "none";
    el.removeAttribute("title");
  }
}

/* ============================================================
   Selection & bulk actions
   ============================================================ */
// A row renders data-id="${item.id || item.set_num}" — so a selection key can
// be a collection-row id OR (for legacy/imported items with no id) a set_num.
// Bulk actions MUST resolve the selected items and address the API the SAME
// way, otherwise a selected set matches nothing, gets skipped, and the action
// still reports success (the "Sets removed but nothing deleted" bug).
const selRef = (item) => String(item.id || item.set_num);
const apiRef = (item) => encodeURIComponent(item.id || item.set_num);

function enterSelectionMode(firstId) {
  if (state.selectionMode || !(state.portfolio?.items || []).length) return;
  state.selectionMode = true;
  state.selectedSets = new Set();
  if (firstId) state.selectedSets.add(String(firstId));
  haptic("medium");
  // The class hides the bar and FAB and reserves room for the action bar.
  document.body.classList.add("selection-mode");
  $("#vaultPage")?.classList.add("has-bar");
  repaintSetList();
  showSelectionBar();
  if (!localStorage.getItem("bv_sel_hint")) {
    try { localStorage.setItem("bv_sel_hint", "1"); } catch { /* hint shows again */ }
    toast(t('bvVault.selectHint'), "info");
  }
  if (firstId) {
    const rowEl = document.querySelector(`.vault-row[data-id="${CSS.escape(String(firstId))}"]`);
    rowEl?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
}

function showSelectionBar() {
  let bar = document.getElementById("selectionBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "selectionBar";
    bar.className = "selection-bar vault-selection-bar";
    bar.setAttribute('role', 'toolbar');
    document.body.appendChild(bar);
  }
  updateSelectionBar();
  setTimeout(() => bar.classList.add("show"), 10);
}

function updateSelectionBar() {
  const bar = document.getElementById("selectionBar");
  if (!bar) return;
  const count = state.selectedSets.size;
  bar.setAttribute('aria-label', tPlural('bvVault.selectedCount', count));
  bar.innerHTML = `
    <div class="vault-selection-bar__head">
      <strong role="status">${escapeHtml(tPlural('bvVault.selectedCount', count))}</strong>
      <button type="button" class="bv-btn bv-btn--text bv-btn--sm" id="selCancel">${escapeHtml(t('common.cancel'))}</button>
    </div>
    <div class="bv-btn-row">
      ${btn(t('bvVault.bulkLocation'), { kind: 'tonal', id: 'selBulkLocation', disabled: count === 0, icon: 'box' })}
      ${btn(t('bvVault.bulkCsv'), { kind: 'tonal', id: 'selBulkExport', disabled: count === 0, icon: 'download' })}
      ${btn(t('common.delete'), { kind: 'danger-fill', id: 'selBulkDelete', disabled: count === 0, icon: 'trash' })}
    </div>`;
  document.getElementById("selCancel").addEventListener("click", exitSelectionMode);
  document.getElementById("selBulkLocation")?.addEventListener("click", handleBulkLocation);
  document.getElementById("selBulkExport")?.addEventListener("click", handleBulkExport);
  document.getElementById("selBulkDelete")?.addEventListener("click", handleBulkDelete);
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedSets = new Set();
  document.body.classList.remove("selection-mode");
  $("#vaultPage")?.classList.remove("has-bar");
  const bar = document.getElementById("selectionBar");
  if (bar) {
    bar.classList.remove("show");
    setTimeout(() => bar.remove(), 250);
  }
  repaintSetList();
}

async function handleBulkLocation() {
  const ids = Array.from(state.selectedSets);
  if (!ids.length) return;
  const loc = await promptSheet({ title: t('bvVault.bulkLocationTitle'), label: t('bvVault.bulkLocationLabel'), value: "", placeholder: t('bvVault.bulkLocationPlaceholder'), confirmLabel: t('common.save') });
  if (loc === null) return;
  const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(selRef(item)));
  if (!selectedItems.length) { toast(t('bvVault.bulkNoMatch'), "error"); return; }
  toast(t('bvVault.bulkLocationUpdating'), "info");
  const results = await Promise.allSettled(selectedItems.map(item =>
    api("/api/collection/" + apiRef(item), { method: "PATCH", body: { storage_location: loc || null } })
  ));
  const failed = results.filter(r => r.status === "rejected").length;
  // Tear down selection UI BEFORE invalidating — exitSelectionMode repaints the
  // list and must read a valid state.portfolio, not the null invalidate leaves.
  toast(failed === 0 ? t('bvVault.bulkLocationDone')
    : tPlural('portfolio.bulkLocationPartial', failed, { updated: results.length - failed, total: results.length, failed }), failed ? "error" : "success");
  exitSelectionMode();
  invalidatePortfolio();
  await renderPortfolio();
}

async function handleBulkDelete() {
  const ids = Array.from(state.selectedSets);
  if (!ids.length) return;
  const confirmed = await confirmSheet({
    title: t('bvVault.bulkDeleteTitle'),
    message: tPlural('bvVault.bulkDeleteMessage', ids.length),
    confirmLabel: t('bvVault.bulkDeleteConfirm'),
    danger: true,
  });
  if (!confirmed) return;
  const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(selRef(item)));
  if (!selectedItems.length) { toast(t('bvVault.bulkNoMatch'), "error"); return; }
  // allSettled + per-item accounting: with Promise.all one failure reported
  // "Failed to delete" even though earlier deletes already landed server-side.
  const results = await Promise.allSettled(selectedItems.map(item =>
    api("/api/collection/" + apiRef(item), { method: "DELETE" })
  ));
  const removed = selectedItems.filter((_, i) => results[i].status === "fulfilled");
  const failed = selectedItems.length - removed.length;
  // Sync the client-side owned set + drop cached detail snapshots + force a
  // catalog refetch, so the OWNED badge and set pages don't stay stale.
  for (const item of removed) markSetOwned(item.set_num, false);
  state.catalog.items = [];
  if (failed > 0) {
    toast(tPlural('portfolio.bulkRemovePartial', failed, { removed: removed.length, total: selectedItems.length, failed }), "error");
  } else if (removed.length) {
    // Soft deletes make a bulk restore a straight re-POST of the kept payloads.
    const restorePayloads = removed.map(item => ({
      set_num: item.set_num, quantity: item.quantity || 1,
      condition: item.condition || undefined, purchase_price: item.purchase_price ?? undefined,
      purchased_at: item.purchased_at || undefined, notes: item.notes || undefined,
    }));
    undoToast(tPlural('bvVault.bulkRemoved', removed.length), async () => {
      const res = await Promise.allSettled(restorePayloads.map(b => api("/api/collection", { method: "POST", body: b })));
      const back = res.filter(r => r.status === "fulfilled").length;
      for (const p of restorePayloads) markSetOwned(p.set_num, true);
      state.catalog.items = [];
      invalidatePortfolio();
      await renderPortfolio();
      toast(back === restorePayloads.length ? t('bvVault.restored') : tPlural('portfolio.restoredCount', back, { restored: back, total: restorePayloads.length }), back ? "success" : "error");
    });
  }
  exitSelectionMode();
  invalidatePortfolio();
  await renderPortfolio();
}

function handleBulkExport() {
  const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(selRef(item)));
  if (!selectedItems.length) return;
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Set Number,Name,Theme,Year,Pieces,Quantity,Purchase Price,Current Value,Storage Location\n";
  selectedItems.forEach(item => {
    const csvRow = [
      item.set_num,
      `"${(item.name || '').replace(/"/g, '""')}"`,
      `"${(item.theme || '').replace(/"/g, '""')}"`,
      item.year,
      item.pieces,
      item.quantity,
      item.purchase_price ?? '',
      item.current_value || '',
      `"${(item.storage_location || '').replace(/"/g, '""')}"`
    ].join(",");
    csvContent += csvRow + "\n";
  });
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", `brickvault_bulk_export_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast(t('bvVault.csvExported'), "success");
  exitSelectionMode();
}

// Leaving the Vault while selecting drops the selection (the router also
// clears it); the action bar must not float over the next screen.
window.addEventListener('bv:owner-changed', () => { state.vaultChanges = null; searchOpen = false; });
window.addEventListener('hashchange', () => {
  if (!onVaultRoute()) {
    document.getElementById('selectionBar')?.remove();
    searchOpen = !!state.filter.q;
  }
});
