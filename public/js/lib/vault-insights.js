// Pure Vault maths shared by the Vault, Insights and What changed screens.
// No DOM, no state, no formatting: callers pass rows and a value function and
// get numbers back, so the same totals appear on every surface and the rules
// are unit-tested (public/js/__tests__/vault-insights.test.js).
import { displayValueOf } from './pure-core.js';

/** @typedef {Record<string, any>} Row */

const qtyOf = (/** @type {Row} */ row) => Math.max(1, Math.round(Number(row?.quantity) || 1));

/** A holding's recorded cost is known when it is a finite number ≥ 0 (a gift is 0). */
export function hasKnownCost(/** @type {Row} */ row) {
  const raw = row?.purchase_price;
  if (raw == null || raw === '') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0;
}

/**
 * Collection totals. `value` is every holding's value × quantity; paper gain
 * only compares holdings whose cost is known, so an unpriced set never reads as
 * pure profit.
 * @param {Row[]} items
 * @param {(row: Row) => number} [valueOf]
 */
export function vaultTotals(items = [], valueOf = displayValueOf) {
  let value = 0, pricedValue = 0, paid = 0, pieces = 0, holdings = 0, unpriced = 0;
  const distinct = new Set();
  for (const row of Array.isArray(items) ? items : []) {
    if (!row) continue;
    const qty = qtyOf(row);
    const v = Math.max(0, Number(valueOf(row)) || 0);
    value += v * qty;
    holdings += qty;
    pieces += (Number(row.pieces) || 0) * qty;
    distinct.add(String(row.set_num || ''));
    if (hasKnownCost(row)) {
      pricedValue += v * qty;
      paid += Number(row.purchase_price) * qty;
    } else unpriced++;
  }
  const paperGain = pricedValue - paid;
  return {
    value, pricedValue, paid, paperGain,
    gainPct: paid > 0 ? (paperGain / paid) * 100 : null,
    pieces, holdings, sets: distinct.size, unpriced,
  };
}

/**
 * Share of value per theme, largest first. Themes past `limit` are folded into
 * the returned `rest` count so a long tail never produces a wall of 1% rows.
 * @param {Row[]} items
 * @param {(row: Row) => number} [valueOf]
 */
export function themeAllocation(items = [], valueOf = displayValueOf, { limit = 6, otherLabel = '' } = {}) {
  const byTheme = new Map();
  let total = 0;
  for (const row of items || []) {
    const v = Math.max(0, Number(valueOf(row)) || 0) * qtyOf(row);
    if (!(v > 0)) continue;
    const theme = String(row.theme || '').trim() || otherLabel;
    byTheme.set(theme, (byTheme.get(theme) || 0) + v);
    total += v;
  }
  const rows = [...byTheme.entries()]
    .map(([theme, value]) => ({ theme, value, share: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value || a.theme.localeCompare(b.theme));
  return { total, rows: rows.slice(0, limit), rest: Math.max(0, rows.length - limit) };
}

/**
 * Retirement picture: how many distinct holdings are retired and how many are
 * flagged by LEGO.com as retiring soon (or scored ≥ 70 by the risk model).
 * @param {Row[]} items
 */
export function retirementRadar(items = []) {
  const seen = new Map();
  for (const row of items || []) if (row?.set_num && !seen.has(row.set_num)) seen.set(row.set_num, row);
  const rows = [...seen.values()];
  const retired = rows.filter(r => r.retired === 1 || r.retired === true);
  const retiring = rows.filter(r => !(r.retired === 1 || r.retired === true)
    && (Number(r.lego_retiring_soon) === 1 || r.lego_retiring_soon === true || Number(r.retirement_risk_score) >= 70));
  return { total: rows.length, retired: retired.length, retiring: retiring.length, retiringRows: retiring };
}

/**
 * Best and worst holdings against what was paid (known cost > 0 only).
 * @param {Row[]} items
 * @param {(row: Row) => number} [valueOf]
 */
export function gainersAndLosers(items = [], valueOf = displayValueOf, { limit = 3 } = {}) {
  const rows = [];
  for (const row of items || []) {
    const paid = Number(row?.purchase_price);
    const v = Number(valueOf(row));
    if (!(paid > 0) || !(v > 0)) continue;
    const qty = qtyOf(row);
    rows.push({ row, pct: ((v - paid) / paid) * 100, gain: (v - paid) * qty });
  }
  const gainers = rows.filter(r => r.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, limit);
  const losers = rows.filter(r => r.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, limit);
  return { gainers, losers };
}

/**
 * Collection-record completeness for the Lists tab: how many holdings carry a
 * known cost (the record every gain depends on), plus the gaps to fill.
 * @param {Row[]} items
 */
export function recordCompleteness(items = []) {
  const rows = (items || []).filter(r => r && !r.deleted_at && !r._pendingCollectionNew);
  const missingCost = rows.filter(r => !hasKnownCost(r));
  const missingDate = rows.filter(r => !r.purchased_at);
  const incomplete = rows.filter(r => r.is_complete === false || r.is_complete === 0 || Number(r.missing_pieces) > 0);
  const pct = rows.length ? Math.round(((rows.length - missingCost.length) / rows.length) * 100) : 0;
  return { total: rows.length, pct, missingCost, missingDate, incomplete };
}

/**
 * Clip a daily snapshot series to the last `days` days (inclusive of today).
 * @param {Array<{snapshot_date?: string}>} snapshots
 * @param {number} days
 * @param {Date} [now]
 */
export function clipHistory(snapshots = [], days = 90, now = new Date()) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter(s => s && s.snapshot_date);
  if (!Number.isFinite(days) || days >= 3650) return list;
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - days * 86400000)
    .toISOString().slice(0, 10);
  return list.filter(s => String(s.snapshot_date) >= cutoff);
}

/**
 * Value change since a date from local daily snapshots: the last snapshot on or
 * before `since` against `nowValue`. Used for guests (no server history) and as
 * the offline fallback. Returns null without a baseline.
 * @param {Array<{snapshot_date?: string, total_value?: number}>} snapshots
 * @param {string} since YYYY-MM-DD
 * @param {number} nowValue
 */
export function changeSinceFromSnapshots(snapshots = [], since, nowValue) {
  const list = (Array.isArray(snapshots) ? snapshots : [])
    .filter(s => s && s.snapshot_date && String(s.snapshot_date) <= since && Number(s.total_value) > 0)
    .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
  const base = list.at(-1);
  if (!base || !(Number(nowValue) > 0)) return null;
  const then = Number(base.total_value);
  const delta = Number(nowValue) - then;
  return { since: String(base.snapshot_date), valueThen: then, delta, pct: then > 0 ? (delta / then) * 100 : null };
}

/**
 * The "since you last looked" window: days between the last visit and today,
 * clamped to 1–30. First visit (or a corrupt stamp) looks back one week.
 * @param {string|number|null|undefined} lastSeen ISO time or epoch ms
 * @param {Date} [now]
 */
export function changesWindowDays(lastSeen, now = new Date()) {
  const t = typeof lastSeen === 'number' ? lastSeen : Date.parse(String(lastSeen || ''));
  if (!Number.isFinite(t) || t > now.getTime()) return 7;
  const startOf = (/** @type {number} */ ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const days = Math.round((startOf(now.getTime()) - startOf(t)) / 86400000);
  return Math.min(30, Math.max(1, days));
}

/**
 * Items for the "Since …" card and the What changed inbox, in priority order:
 * target hits and sell targets first, value spikes, then retirement news.
 * @param {{ alerts?: Row[], retiringOwned?: Row[], retiringWished?: Row[] }} input
 */
export function changeItems({ alerts = [], retiringOwned = [], retiringWished = [] } = {}) {
  const rank = { drop: 0, sell_target: 1, spike: 2 };
  const alertItems = (alerts || [])
    .map(a => ({ kind: a.alert_type === 'spike' || a.alert_type === 'sell_target' ? a.alert_type : 'drop', alert: a, set_num: a.set_num, name: a.set_name || a.name || a.set_num }))
    .sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3));
  const seen = new Set(alertItems.map(i => `${i.kind}:${i.set_num}`));
  const owned = (retiringOwned || []).filter(r => !seen.has(`retiring:${r.set_num}`))
    .map(r => ({ kind: 'retiringOwned', row: r, set_num: r.set_num, name: r.name || r.set_num }));
  const wished = (retiringWished || []).map(r => ({ kind: 'retiringWished', row: r, set_num: r.set_num, name: r.name || r.set_num }));
  return [...alertItems, ...owned, ...wished];
}
