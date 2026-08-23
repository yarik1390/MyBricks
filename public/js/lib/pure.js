// Boot-critical helpers live in lib/pure-core.js (jwtSub, displayValueOf,
// nextOfflineBannerState, upsertDetailCache) so the app-shell boot graph
// doesn't parse this whole module; re-exported here so every existing
// `from '../lib/pure.js'` import keeps working.
export { jwtSub, displayValueOf, withDisplayValue, shouldUseKeyboardShell, nextOfflineBannerState, upsertDetailCache, isCredentialAuthFailure } from './pure-core.js';
// A re-export does NOT bind the name in this module's scope, so anything USED
// here (not merely forwarded) needs a real import as well. canonicalSetMarketMeta
// called displayValueOf and threw "displayValueOf is not defined" at runtime,
// in the browser as well as in tests.
import { displayValueOf } from './pure-core.js';

/**
 * Pure, stateless helper functions with no DOM, state, or network dependencies.
 * Canonical implementations — edit here and the tests will catch regressions.
 * Imported by utils.js and portfolio.js (see those files for DOM-aware wrappers).
 */

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function fmtPct(n) {
  return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%";
}

/**
 * Summarize a meaningful displayed-value move and any correlated market signal.
 * Source movement is corroborating context, not a causal claim.
 */
export function priceMovementSummary(history) {
  if (!Array.isArray(history)) return null;
  const validRows = history.filter(row => Number(row?.current_value) > 0);
  if (validRows.length < 2) return null;

  const first = validRows[0];
  const last = validRows[validRows.length - 1];
  const startMs = Date.parse(String(first.snapshot_date || ''));
  const endMs = Date.parse(String(last.snapshot_date || ''));
  const days = Math.round((endMs - startMs) / 86_400_000);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || days < 1) return null;

  const movementPct = ((Number(last.current_value) - Number(first.current_value)) / Number(first.current_value)) * 100;
  if (!Number.isFinite(movementPct) || Math.abs(movementPct) < 5) return null;
  // A baseline backfill (value jumped from a stale formula estimate to real
  // market data) can produce absurd headline percentages — "Up 5317%" — that
  // erode trust even when the confidence badge already says ROUGH ESTIMATE.
  // Cap what we're willing to advertise as a "move": anything beyond ±200%
  // over the window is almost always a data-arrival artifact, not demand.
  if (Math.abs(movementPct) > 200) return null;
  const direction = movementPct > 0 ? 'up' : 'down';

  const sourceMove = key => {
    const points = history.filter(row => Number(row?.[key]) > 0);
    if (points.length < 2) return null;
    const pct = ((Number(points[points.length - 1][key]) - Number(points[0][key])) / Number(points[0][key])) * 100;
    if (!Number.isFinite(pct) || Math.abs(pct) < 5 || (pct > 0 ? 'up' : 'down') !== direction) return null;
    return pct;
  };

  const resalePct = sourceMove('ebay_value');
  const marketPct = sourceMove('bl_value');
  let driver = null;
  if (resalePct != null && marketPct != null) {
    driver = Math.abs(resalePct - movementPct) <= Math.abs(marketPct - movementPct) ? 'resale' : 'market';
  } else if (resalePct != null) driver = 'resale';
  else if (marketPct != null) driver = 'market';

  return { direction, pct: Math.round(Math.abs(movementPct)), days, driver };
}

/** Brickset tag strings arrive as "Label|t" ("Harry Potter|n") — the suffix is
 *  scraper metadata, never meant for display. Strip it and trim. */
export function cleanTagLabel(tag) {
  return String(tag ?? "").split("|")[0].trim();
}

/** "1 set", "2 sets" — count labels that read like a human wrote them. */
export function pluralize(n, singular, plural = singular + "s") {
  return `${n} ${n === 1 ? singular : plural}`;
}

// Placeholder/junk values that leak into theme/theme_group/category columns from
// upstream catalog imports and must never appear as a pickable filter facet.
const JUNK_FACET_RE = /^(:?\s*null|n\/?a|unknown|random|undefined|none|tbd|tba|t\.?\s*b\.?\s*a\.?|\{.*\}|:.*|\?+|-+|\.+)$/i;
/**
 * Clean a list of facet values (themes / theme groups / categories): drop empty
 * and junk placeholders, de-dupe (case-insensitively, keeping first spelling),
 * and — when `sort` is true — return them A→Z. Keeps real values untouched.
 */
export function cleanFacetList(list, { sort = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v || JUNK_FACET_RE.test(v)) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  if (sort) out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/**
 * Turn provider/auth failures into a user-facing scanner state. A missing AI
 * provider is setup work, not a visual "no match" from the photo.
 * @param {unknown} value
 */
export function classifyScanFailure(value) {
  const message = String(value || "");
  if (/rate.?limit|quota|limit reached|too many|429/i.test(message)) {
    return { kind: "limit", label: "Limit reached", retryable: false };
  }
  if (/sign in|add your own|api key|not configured|provider unavailable|setup/i.test(message)) {
    return { kind: "setup", label: "Setup needed", retryable: false };
  }
  if (/offline|network|fetch/i.test(message)) {
    return { kind: "offline", label: "Connection needed", retryable: true };
  }
  if (/timed? out|took too long|abort/i.test(message)) {
    return { kind: "timeout", label: "Timed out", retryable: true };
  }
  if (/not (?:a )?lego|doesn.t look like (?:a )?lego|pointing me at some bricks/i.test(message)) {
    return { kind: "notlego", label: "Not LEGO", retryable: true };
  }
  return { kind: "nomatch", label: "Not found", retryable: true };
}

/**
 * Short relative time ("just now", "3m ago", "2h ago", "5d ago") for the admin
 * Activity feed. Handles SQLite's UTC "YYYY-MM-DD HH:MM:SS" (no zone) and ISO.
 * Returns "—" for missing/unparseable values.
 */
export function formatRelativeTime(value, now = Date.now(), locale = 'en') {
  if (!value) return "—";
  let s = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z";
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (locale === 'en') {
    if (sec < 10) return "just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return `${Math.floor(hr / 24)}d ago`;
  }
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (sec < 10) return relative.format(0, 'second');
  if (sec < 60) return relative.format(-sec, 'second');
  const min = Math.floor(sec / 60);
  if (min < 60) return relative.format(-min, 'minute');
  const hr = Math.floor(min / 60);
  if (hr < 24) return relative.format(-hr, 'hour');
  return relative.format(-Math.floor(hr / 24), 'day');
}

/**
 * Maps a process's run status to a UI badge { tone, label }.
 * tone is one of: running | danger | ok | idle.
 */
export function processRunBadge(proc = {}) {
  const status = proc.status || "idle";
  if (status === "running") return { tone: "running", label: "Running" };
  if (status === "failed") return { tone: "danger", label: "Failed" };
  if (status === "ok") return { tone: "ok", label: "OK" };
  return { tone: "idle", label: "Not run yet" };
}

export function themeHue(theme = "") {
  let h = 0;
  for (let i = 0; i < theme.length; i++) h = (h * 31 + theme.charCodeAt(i)) & 0xFFFF;
  return h % 360;
}

export function bricklinkBuyURL(setNum) {
  const base = setNum.includes("-") ? setNum : setNum + "-1";
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${base}`;
}

/**
 * Computes deal quality for an in-store price check against market value.
 * Returns null when insufficient data.
 * verdict: 'great' | 'fair' | 'over'
 */
export function computeDealScore(set, storePrice) {
  const market = marketValueForCondition(set, set?.condition || "new");
  if (!market || !storePrice || storePrice <= 0) return null;
  const pct = (market - storePrice) / market;
  const greatThreshold = set.retired ? 0.05 : 0.15;
  let verdict, label;
  if (pct >= greatThreshold) {
    verdict = "great";
    label = `${fmtPct(pct)} below market — great deal!`;
  } else if (pct <= -0.05) {
    verdict = "over";
    label = `${fmtPct(Math.abs(pct))} above market — overpriced`;
  } else {
    verdict = "fair";
    label = `Within ${fmtPct(Math.abs(pct))} of market price`;
  }
  return { verdict, pct, label };
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * In-store verdict: "should I buy this set at the price on the shelf in front
 * of me?" Wraps computeDealScore's thresholds into an actionable answer, and
 * — unlike computeDealScore — still answers WITHOUT a store price by telling
 * the shopper what a grab-worthy price would be.
 * Returns null without a market value, otherwise:
 *   { verdict: 'grab'|'fair'|'walk'|'guide', market, grabUnder,
 *     deltaUsd?, deltaPct?, estimated }
 * deltaUsd is the saving (positive) or overpayment (negative) vs market.
 * All values USD; the caller converts/formats for display.
 */
export function computeStoreVerdict(set = {}, storePrice) {
  const market = marketValueForCondition(set, set?.condition || "new");
  if (!market) return null;
  const estimated = isEstimatedValue(set);
  // Retired sets rarely discount, so a small cut is already a grab (mirrors
  // computeDealScore's greatThreshold).
  const greatThreshold = set.retired ? 0.05 : 0.15;
  const grabUnder = market * (1 - greatThreshold);
  const price = Number(storePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { verdict: "guide", market, grabUnder, estimated };
  }
  const deltaUsd = market - price;
  const deltaPct = deltaUsd / market;
  const verdict = deltaPct >= greatThreshold ? "grab" : deltaPct <= -0.05 ? "walk" : "fair";
  return { verdict, market, grabUnder, deltaUsd, deltaPct, estimated };
}

/**
 * Sell-timing signal for an OWNED set: is now a good moment to exit?
 * Inputs mirror what the set-detail payload already carries:
 *   purchasePrice (entry), currentValue, retired, forecast2y,
 *   trend ('rising'|'stable'|'falling'), slopePctPerWeek, salesVolume.
 * Returns null without a current value, otherwise
 *   { signal: 'sell'|'watch'|'hold', roiPct, upsidePct,
 *     reasons: Array<{ id: string, vars: object }> }.
 * Deliberately conservative: 'sell' needs BOTH a healthy realized gain AND
 * evidence the run is ending (falling/flat trend or thin remaining upside).
 */
export function computeSellSignal({ purchasePrice, currentValue, retired, forecast2y, trend, slopePctPerWeek, salesVolume } = {}) {
  const value = positiveNumber(currentValue);
  if (!value) return null;
  const paid = positiveNumber(purchasePrice);
  const roiPct = paid ? ((value - paid) / paid) * 100 : null;
  const fc = positiveNumber(forecast2y);
  const upsidePct = fc ? ((fc - value) / value) * 100 : null;
  const slope = Number(slopePctPerWeek);
  const falling = trend === "falling" || (Number.isFinite(slope) && slope < -0.5);
  const rising = trend === "rising" || (Number.isFinite(slope) && slope > 0.5);
  const liquidity = liquidityLabel(salesVolume);

  const reason = (id, vars = {}) => ({ id, vars });
  const reasons = [];
  if (roiPct != null && roiPct >= 5) reasons.push(reason("gainSincePurchase", { roiPct }));
  if (falling) reasons.push(reason("trendDown"));
  else if (!rising && roiPct != null && roiPct >= 30) reasons.push(reason("climbFlattened"));
  if (upsidePct != null && upsidePct <= 10) reasons.push(reason("littleUpside", { upsidePct }));
  if (liquidity?.level === "fast") reasons.push(reason("sellsFast", { salesVolume: liquidity.volume }));

  if (roiPct != null && roiPct >= 30 && (falling || (!rising && upsidePct != null && upsidePct <= 10))) {
    return { signal: "sell", roiPct, upsidePct, reasons };
  }
  if (falling || (roiPct != null && roiPct >= 30 && upsidePct != null && upsidePct <= 20)) {
    return { signal: "watch", roiPct, upsidePct, reasons: reasons.length ? reasons : [reason("watchClosely")] };
  }
  const holdReasons = [];
  if (rising) holdReasons.push(reason("stillClimbing"));
  if (upsidePct != null && upsidePct > 10) holdReasons.push(reason("forecastUpside", { upsidePct }));
  if (!retired) holdReasons.push(reason("notRetired"));
  return { signal: "hold", roiPct, upsidePct, reasons: holdReasons.length ? holdReasons : [reason("noSellTrigger")] };
}

/** Select the correct localized scan-result noun without rendering UI prose. */
export function scanResultHeading(setsCount, minifigCount) {
  const sets = Math.max(0, Number(setsCount) || 0);
  const minifigs = Math.max(0, Number(minifigCount) || 0);
  if (sets && minifigs) return { key: "mixedResultsFound", count: sets + minifigs };
  if (sets) return { key: "setsFound", count: sets };
  return { key: "minifigsFound", count: minifigs };
}

export function ebaySoldSummary(set = {}) {
  const explicitNew = positiveNumber(set.ebay_new_value);
  const legacy = !explicitNew ? positiveNumber(set.ebay_value) : null;
  return {
    newValue: explicitNew || legacy,
    usedValue: positiveNumber(set.ebay_used_value),
    newSampleCount: positiveNumber(set.ebay_new_qty),
    usedSampleCount: positiveNumber(set.ebay_used_qty),
    newUpdatedAt: set.ebay_new_cached_at || (legacy ? set.ebay_cached_at : null) || null,
    usedUpdatedAt: set.ebay_used_cached_at || null,
    legacy: !!legacy,
  };
}

export function marketValueForCondition(set = {}, condition = "new") {
  const summary = ebaySoldSummary(set);
  const isUsed = String(condition || "").startsWith("used");
  if (isUsed) {
    return summary.usedValue
      || positiveNumber(set.used_value)
      || summary.newValue
      || positiveNumber(set.current_value);
  }
  return summary.newValue || positiveNumber(set.current_value);
}

/**
 * Price-per-piece with a delta against the formula baseline ($0.11/pc retail,
 * mirrors formulaValuation in worker/src/lib/valuation.ts; retired sets carry
 * a 1.4x premium). Returns null for tiny sets or missing data.
 */
export function pricePerPiece(set = {}) {
  const pieces = Number(set.pieces);
  const value = positiveNumber(set.current_value);
  if (!Number.isFinite(pieces) || pieces < 20 || !value) return null;
  const ppp = value / pieces;
  const baseline = 0.11 * (set.retired ? 1.4 : 1.0);
  return { ppp, delta: (ppp - baseline) / baseline };
}

/**
 * Turns a wishlist item's 30-day trend into a "buy window" hint.
 * item needs: target_price, current_value, trend_weekly (USD/week, may be null).
 * Returns null when there's nothing actionable to say, otherwise
 * { state: 'near' | 'approaching' | 'away', label, weeks? }.
 */
export function buyWindow(item = {}) {
  const target = positiveNumber(item.target_price);
  const current = positiveNumber(item.current_value);
  if (!target || !current) return null;
  if (current <= target) return { state: "near", label: "at your target price" };
  if (current <= target * 1.05) return { state: "near", label: "almost at your target" };
  const slope = Number(item.trend_weekly);
  if (!Number.isFinite(slope) || slope === 0) return null;
  if (slope < 0) {
    const weeks = Math.ceil((current - target) / -slope);
    if (weeks > 52) return null;
    return { state: "approaching", label: `trending to your target · ~${weeks} wk${weeks > 1 ? "s" : ""}`, weeks };
  }
  return { state: "away", label: "moving away from your target" };
}

/**
 * Classify a set's market liquidity from PriceCharting's yearly units-sold
 * (sales_volume). Returns null when unknown so callers can hide the badge.
 *   >= 30/yr → fast   ·   >= 6/yr → steady   ·   > 0 → slow
 */
export function liquidityLabel(salesVolume) {
  const v = Number(salesVolume);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v >= 30) return { level: "fast", label: "Sells fast", volume: Math.round(v) };
  if (v >= 6) return { level: "steady", label: "Steady demand", volume: Math.round(v) };
  return { level: "slow", label: "Sells slowly", volume: Math.round(v) };
}

/**
 * Aggregates eBay-vs-BrickLink spread signals across a collection.
 * Returns { hot, cold, totalUpside }: hot = sets where eBay sold prices run
 * >= threshold above the BrickLink/primary value (sell opportunities), cold =
 * the inverse (buying windows), both sorted by absolute dollar gap x quantity.
 */
export function computeSpreadSignals(items = [], { threshold = 0.15 } = {}) {
  const hot = [], cold = [];
  for (const it of items) {
    const ebay = ebaySoldSummary(it).newValue;
    const ref = positiveNumber(it.bl_new_value) || positiveNumber(it.current_value);
    if (!ebay || !ref) continue;
    const spread = (ebay - ref) / ref;
    if (Math.abs(spread) < threshold) continue;
    const qty = Math.max(1, Number(it.quantity) || 1);
    (spread > 0 ? hot : cold).push({ item: it, spread, gap: Math.abs(ebay - ref) * qty });
  }
  hot.sort((a, b) => b.gap - a.gap);
  cold.sort((a, b) => b.gap - a.gap);
  return { hot, cold, totalUpside: hot.reduce((s, x) => s + x.gap, 0) };
}

// Flip (resale) economics in the user's DISPLAY currency. Values are stored in
// USD, so the market price and the marketplace's fixed payment fee (USD $0.30)
// are converted at `rate`; percentage fees apply to the converted price;
// shipping/tax are flat amounts the user entered in their own currency.
// Returns null when there is no usable market value. Single source for BOTH
// the deal-breakdown sheet and the flip calculator — they once diverged (the
// calculator skipped the rate entirely), showing non-USD users a wrong ROI.
export function flipEconomics({ marketUsd, rate = 1, feePct = 13.25, paymentPct = 2.9, fixedFeeUsd = 0.30, shipping = 0, tax = 0 } = {}) {
  const r = Number(rate) > 0 ? Number(rate) : 1;
  const gross = Number(marketUsd) * r;
  if (!(gross > 0)) return null;
  const marketplaceFee = gross * ((Number(feePct) || 0) / 100);
  const paymentFee = gross * ((Number(paymentPct) || 0) / 100) + (Number(fixedFeeUsd) || 0) * r;
  const ship = Number(shipping) || 0;
  const taxAmt = Number(tax) || 0;
  const totalFees = marketplaceFee + paymentFee + ship + taxAmt;
  return { gross, marketplaceFee, paymentFee, shipping: ship, tax: taxAmt, totalFees, net: Math.max(0, gross - totalFees) };
}

// A displayed value is an ESTIMATE (not market-derived) when no blended market
// value survived and the stored value came from the attribute formula, a local
// guess, or an AI gap-fill. Drives the "~" prefix on prices so estimates never
// read with the same authority as real market values. Coming-soon sets show the
// announced retail, which is a fact, not an estimate.
export function isEstimatedValue(set = {}) {
  if (set.coming_soon) return false;
  if (Number(set.market_value) > 0 || Number(set.blended_value) > 0) return false;
  const m = String(set.valuation_method || "");
  return m === "formula_bulk" || m === "local" || m === "ai" || m === "";
}

// "~" for estimated values, "" for market-derived ones — prepend to fmtMoney.
export const estMark = (set) => (isEstimatedValue(set) ? "~" : "");

// One vocabulary for the confidence badge on every set surface. Catalog cards
// used valuationTrust() ("Market price") while detail used its own wording
// ("Good estimate") for the same medium-confidence row.
export function valuationConfidencePresentation(set = {}) {
  if (set.coming_soon) {
    return { label: "Coming soon", tone: "ok", detail: "Not released yet — showing the announced retail price" };
  }
  const v3 = set.valuation?.read_enabled && set.valuation?.new ? set.valuation.new : null;
  const method = set.valuation_method;
  // Mirror valuationTrust's defaulting when the API sends no explicit
  // confidence: a lone BrickEconomy scrape stays "low" so it can never be
  // presented as a corroborated market price.
  const confidence = String(
    v3?.confidence || set.market_value_confidence || set.confidence
    || (method === "brickeconomy" ? "low" : "")
  ).toLowerCase();
  if (method === "ai") {
    return { label: "Estimated", tone: "low", detail: "Estimated by AI because fresh market data wasn't available" };
  }
  if (method === "formula_bulk" || method === "local") {
    return { label: "Rough estimate", tone: "low", detail: "Estimated from the set's attributes until a market refresh runs" };
  }
  if (confidence === "high") {
    return { label: "Reliable price", tone: "good", detail: "Multiple fresh market sources agree on this price" };
  }
  if (confidence === "medium") {
    return { label: "Good estimate", tone: "ok", detail: "Based on recent market data with limited corroboration" };
  }
  if (confidence === "low") {
    return { label: "Rough estimate", tone: "low", detail: "Limited recent market data — treat as a rough guide" };
  }
  return { label: "Market price", tone: "ok", detail: "Fresh price from a market source" };
}

export function valuationTrust(set = {}) {
  const freshness = set.freshness || (set.cached_at && Date.now() - new Date(set.cached_at).getTime() > 60 * 86400000 ? "stale" : "fresh");
  // Without an explicit confidence from the API, only sold-comp methods may
  // default to "medium" — a lone BrickEconomy scrape defaults to "low" so it
  // can never wear the green "Market price" badge uncorroborated.
  const confidence = set.confidence
    || (set.valuation_method === "formula_bulk" || set.valuation_method === "local" ? "estimated"
      : set.valuation_method === "brickeconomy" ? "low" : "medium");
  const source = set.primary_value_source || set.valuation_method || "unknown";
  // AI-estimated values are a guess until a market source answers — always flag
  // them as such so they never read as a real "Market price".
  if (set.valuation_method === "ai") {
    return { tone: "warn", label: "AI estimate", detail: "AI-estimated value, shown until a market source is available.", confidence, freshness, source };
  }
  if (freshness === "expired") {
    return { tone: "warn", label: "Older price", detail: "This price hasn't refreshed in a while.", confidence, freshness, source };
  }
  if (freshness === "stale") {
    return { tone: "warn", label: "Older price", detail: "This price is over 60 days old.", confidence, freshness, source };
  }
  if (confidence === "estimated") {
    return { tone: "warn", label: "Estimate", detail: "Formula or local estimate until market data is available.", confidence, freshness, source };
  }
  if (confidence === "low") {
    return { tone: "warn", label: "Low confidence", detail: "Only one weak market signal is available.", confidence, freshness, source };
  }
  if (confidence === "high") {
    return { tone: "ok", label: "High confidence", detail: "Fresh value with corroborating market signals.", confidence, freshness, source };
  }
  return { tone: "ok", label: "Market price", detail: "Fresh price from a market source.", confidence, freshness, source };
}

// Normalize the scanner's manual-entry field without coupling the Scan route
// to camera/UI code. A bare LEGO number means the standard -1 variant; longer
// digit-only values are treated as retail barcodes.
export function manualScanTarget(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (/^\d{3,7}-\d+$/.test(raw)) return { kind: 'set', value: raw };
  if (/^\d{3,7}$/.test(raw)) return { kind: 'set', value: `${raw}-1` };
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) return { kind: 'barcode', value: digits };
  return { kind: 'invalid', value: '' };
}

export function catalogFilterSummary(filter = {}) {
  const parts = [];
  if (filter.catalogQ) parts.push({ kind: "search", value: String(filter.catalogQ) });
  if (filter.catalogTheme && filter.catalogTheme !== "all") parts.push({ kind: "value", value: String(filter.catalogTheme) });
  if (filter.catalogThemeGroup && filter.catalogThemeGroup !== "all") parts.push({ kind: "value", value: String(filter.catalogThemeGroup) });
  if (filter.catalogCategory && filter.catalogCategory !== "all") parts.push({ kind: "value", value: String(filter.catalogCategory) });
  if (filter.catalogRetired === "retired" || filter.catalogRetired === true) parts.push({ kind: "status", value: "retired" });
  else if (filter.catalogRetired === "active") parts.push({ kind: "status", value: "active" });
  else if (filter.catalogRetired === "retiring") parts.push({ kind: "status", value: "retiring" });
  if (filter.catalogDeal) parts.push({ kind: "deal" });
  const ranges = filter.catalogRanges || {};
  const range = (field, minKey, maxKey) => {
    const min = ranges[minKey];
    const max = ranges[maxKey];
    if (min !== "" && min != null && max !== "" && max != null) parts.push({ kind: "range", field, min, max });
    else if (min !== "" && min != null) parts.push({ kind: "range", field, min });
    else if (max !== "" && max != null) parts.push({ kind: "range", field, max });
  };
  range("year", "min_year", "max_year");
  range("pieces", "min_pieces", "max_pieces");
  range("value", "min_value", "max_value");
  return { count: activeCatalogFilterCount(filter), parts };
}

export function activeCatalogFilterCount(filter = {}) {
  const ranges = filter.catalogRanges || {};
  let n = 0;
  if (filter.catalogQ) n++;
  if (filter.catalogTheme && filter.catalogTheme !== "all") n++;
  if (filter.catalogThemeGroup && filter.catalogThemeGroup !== "all") n++;
  if (filter.catalogCategory && filter.catalogCategory !== "all") n++;
  if (filter.catalogRetired && filter.catalogRetired !== "all") n++;
  if (filter.catalogDeal) n++;
  n += Object.values(ranges).filter(v => v !== "" && v != null).length;
  return n;
}

export function figFilterSummary(filter = {}) {
  const parts = [];
  if (filter.figQ) parts.push({ kind: "search", value: String(filter.figQ) });
  if (filter.figRarity && filter.figRarity !== "all") parts.push({ kind: "rarity", value: String(filter.figRarity) });
  if (filter.figOwned === "owned") parts.push({ kind: "ownership", value: "owned" });
  else if (filter.figOwned === "unowned") parts.push({ kind: "ownership", value: "unowned" });
  if (filter.figSeries && filter.figSeries !== "all") parts.push({ kind: "series", value: String(filter.figSeries) });
  return { count: activeFigFilterCount(filter), parts };
}

const ADMIN_BACKGROUND_STATUS_KEYS = {
  pricechartingBulk: 'admin.pricechartingBulkAccepted',
  pricechartingVerify: 'admin.pricechartingVerifyAccepted',
  pricesapi: 'admin.pricesapiAccepted',
};

// Background endpoints can acknowledge work before a tracked import-run exists.
// Return only message keys/variables so callers never render raw server prose.
export function adminJobStartFeedback(type, response = {}, translate, label = '') {
  if (response.run_id != null && response.run_id !== '') {
    return { message: translate('admin.jobStarted', { id: response.run_id }), pollsRun: true };
  }
  const statusKey = ADMIN_BACKGROUND_STATUS_KEYS[type];
  if (statusKey && (response.status === 'running' || response.ok || response.message)) {
    return { message: translate(statusKey), pollsRun: false };
  }
  return { message: translate('admin.jobAccepted', { label }), pollsRun: false };
}

export function activeFigFilterCount(filter = {}) {
  let n = 0;
  if (filter.figQ) n++;
  if (filter.figRarity && filter.figRarity !== "all") n++;
  if (filter.figOwned && filter.figOwned !== "all") n++;
  if (filter.figSeries && filter.figSeries !== "all") n++;
  return n;
}

export function classifyJobRun(run = {}) {
  const error = String(run.error || "");
  const status = String(run.status || "unknown").toLowerCase();
  const quotaLimited = /HTTP 429|EXCEED_LIMIT|quota|rate limit|daily cap|too many requests/i.test(error);
  const providerBlocked = /HTTP 401|HTTP 403|unauthorized|not authorized|access denied|insufficient permissions|invalid[_ -]?scope|Marketplace Insights/i.test(error);
  const retryable = /retry|no data|worker run stopped|timed out|timeout|operation was aborted|too many subrequests|brickset/i.test(error)
    && !/database disk image|sqlite_corrupt|malformed/i.test(error)
    && !providerBlocked;
  if (status === "running" && isStalledJobRun(run)) {
    return { tone: "warn", label: "Stalled", needsAttention: false, retryable: true };
  }
  if (status === "running") return { tone: "warn", label: "Running", needsAttention: false, retryable: false };
  if (status === "completed") {
    return retryable
      ? { tone: "warn", label: "Retryable no-op", needsAttention: false, retryable: true }
      : { tone: "ok", label: "Completed", needsAttention: false, retryable: false };
  }
  if (status === "expired") return { tone: "neutral", label: "Stopped", needsAttention: false, retryable: true };
  if (status === "error") {
    if (quotaLimited) return { tone: "warn", label: "Quota limited", needsAttention: false, retryable: true };
    if (providerBlocked) return { tone: "danger", label: "Provider blocked", needsAttention: true, retryable: false };
    return retryable
      ? { tone: "warn", label: "Retry needed", needsAttention: false, retryable: true }
      : { tone: "danger", label: "Hard error", needsAttention: true, retryable: false };
  }
  return { tone: "neutral", label: status || "Unknown", needsAttention: false, retryable: false };
}

export function classifyProviderHealth(row = {}) {
  const service = String(row.service || row.name || "unknown").toLowerCase();
  const configured = row.configured !== false && row.configured !== 0;
  const status = String(row.status || "unknown").toLowerCase();
  const error = String(row.last_error || row.error || "");
  const latestFail = (() => {
    const okAt = dbTimestampMs(row.last_ok_at);
    const failAt = dbTimestampMs(row.last_fail_at);
    return !!failAt && (!okAt || failAt >= okAt);
  })();
  // `error` is the LAST error ever recorded, not necessarily a current one, so
  // this must be gated on that failure actually being the latest event — exactly
  // as `blocked` below already is. Without the gate a provider that 429'd once
  // and has succeeded ever since stayed badged "Quota limited" forever (seen on
  // BrickEconomy: last OK 30m ago, last fail 47d ago, 0/80 of quota used).
  const quotaLimited = latestFail && /HTTP 429|EXCEED_LIMIT|quota|rate limit|daily cap|too many requests/i.test(error);
  const blocked = latestFail && /HTTP 401|HTTP 403|unauthorized|not authorized|access denied|insufficient permissions|invalid[_ -]?scope|Marketplace Insights/i.test(error);
  // amazon/stockx are explicitly non-core — Amazon is an acquisition link that
  // never feeds valuation (weight pinned at 0) and StockX is a corroborating
  // probe — so neither should be triaged as if the app depended on it.
  const optional = !!row.optional || /brickowl|pricecharting|pricesapi|firecrawl|brightdata|amazon|stockx|discord|openrouter|openai|gemini|resend|push|vapid|google/.test(service);
  // A source the admin has deliberately switched OFF needs nothing, whatever its
  // last recorded error says. BrickOwl sat in "Needs action" as "Needs access"
  // over a 403 from 46 days ago while its own switch read "off" — an alert about
  // a source nobody is calling. Checked first: "off" outranks unconfigured,
  // quota-limited and failing alike.
  if (row.disabled) {
    return {
      tone: "neutral",
      label: "Off",
      priority: 5,
      actionable: false,
      optional: true,
      quotaLimited: false,
      blocked: false,
      ready: false,
      action: "Switched off — turn the source on if you want it used.",
    };
  }
  if (!configured) {
    return {
      tone: optional ? "neutral" : "warn",
      label: optional ? "Optional setup" : "Needs setup",
      priority: optional ? 4 : 2,
      actionable: !optional,
      optional,
      quotaLimited: false,
      blocked: false,
      ready: false,
      action: row.recommended_action || row.recommendedAction || (optional ? "Configure only if you want this feature." : "Add the required secret or binding."),
    };
  }
  if (quotaLimited) {
    return {
      tone: "warn",
      label: "Quota limited",
      priority: 3,
      actionable: false,
      optional,
      quotaLimited: true,
      blocked: false,
      ready: false,
      action: row.recommended_action || row.recommendedAction || "Wait for the daily quota to reset or reduce batch size.",
    };
  }
  if (blocked) {
    return {
      tone: "danger",
      label: service === "ebay" ? "Sold comps blocked" : "Needs access",
      priority: 1,
      actionable: true,
      optional,
      quotaLimited: false,
      blocked: true,
      ready: false,
      action: row.recommended_action || row.recommendedAction || "Check provider credentials, scopes, and account access.",
    };
  }
  // When the server already classified the provider healthy ("ok"), trust it —
  // don't second-guess a recovered provider back into "Degraded" off a stale
  // last_fail timestamp (e.g. a transient scrape timeout it has since recovered from).
  if (status === "down" || (status !== "ok" && latestFail && !/no data|not found|empty/i.test(error))) {
    return {
      tone: optional ? "warn" : "danger",
      label: optional ? "Degraded" : "Failing",
      priority: optional ? 3 : 1,
      actionable: true,
      optional,
      quotaLimited: false,
      blocked: false,
      ready: false,
      action: row.recommended_action || row.recommendedAction || "Check the latest failure and retry after provider status is healthy.",
    };
  }
  if (status === "degraded") {
    return {
      tone: "warn",
      label: "Degraded",
      priority: 3,
      actionable: true,
      optional,
      quotaLimited: false,
      blocked: false,
      ready: false,
      action: row.recommended_action || row.recommendedAction || "Keep monitoring; retry a smaller batch if needed.",
    };
  }
  if (status === "unknown") {
    return {
      tone: "neutral",
      label: "Ready / no calls",
      priority: 4,
      actionable: false,
      optional,
      quotaLimited: false,
      blocked: false,
      ready: true,
      action: row.recommended_action || row.recommendedAction || "No action needed until this provider is used.",
    };
  }
  return {
    tone: "ok",
    label: "Ready",
    priority: 5,
    actionable: false,
    optional,
    quotaLimited: false,
    blocked: false,
    ready: true,
    action: row.recommended_action || row.recommendedAction || "No action needed.",
  };
}

export function validateSourceTuningInput(config = {}) {
  const errors = {};
  const normalized = {};
  const parseNumber = (value) => {
    if (typeof value === "string") return Number(value.trim().replace(",", "."));
    return Number(value);
  };
  const parseNullableInt = (value) => {
    if (value === "" || value == null) return null;
    const n = parseNumber(value);
    return Number.isFinite(n) ? Math.round(n) : NaN;
  };
  for (const [name, src] of Object.entries(config || {})) {
    const sourceErrors = [];
    const weight = parseNumber(src?.weight);
    const dailyCap = parseNullableInt(src?.dailyCap);
    const refreshDays = parseNullableInt(src?.refreshDays);
    if (!Number.isFinite(weight) || weight < 0) sourceErrors.push("Weight must be a non-negative number.");
    if (!(dailyCap == null || (Number.isInteger(dailyCap) && dailyCap > 0))) sourceErrors.push("Daily cap must be a positive integer or blank.");
    if (!(refreshDays == null || (Number.isInteger(refreshDays) && refreshDays > 0))) sourceErrors.push("Refresh days must be a positive integer or blank.");
    normalized[name] = {
      enabled: !!src?.enabled,
      weight: Number.isFinite(weight) && weight >= 0 ? weight : 0,
      dailyCap: dailyCap == null || Number.isNaN(dailyCap) ? null : dailyCap,
      refreshDays: refreshDays == null || Number.isNaN(refreshDays) ? null : refreshDays,
    };
    if (sourceErrors.length) errors[name] = sourceErrors;
  }
  return { ok: Object.keys(errors).length === 0, config: normalized, errors };
}

export function groupAdminJobRuns(runs = []) {
  const groups = [];
  for (const run of runs || []) {
    const state = classifyJobRun(run);
    const key = `${run.job_type || "job"}|${state.label}|${state.tone}|${state.retryable ? "retry" : "plain"}`;
    const previous = groups[groups.length - 1];
    if (previous && previous.key === key && state.label === "Completed") {
      previous.runs.push(run);
      previous.count += 1;
      previous.latest = previous.latest || run;
    } else {
      groups.push({ key, state, runs: [run], latest: run, count: 1 });
    }
  }
  return groups;
}

function dbTimestampMs(value) {
  if (!value) return null;
  const text = String(value);
  const ms = Date.parse(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function isStalledJobRun(run = {}, { now = Date.now(), staleMinutes = 10 } = {}) {
  if (String(run.status || "").toLowerCase() !== "running") return false;
  const heartbeat = dbTimestampMs(run.updated_at) || dbTimestampMs(run.started_at);
  return !!heartbeat && now - heartbeat >= staleMinutes * 60000;
}

export function jobProgressSummary(run = {}) {
  const status = String(run.status || "").toLowerCase();
  const current = Math.max(0, Number(run.progress_current ?? 0) || 0);
  const rawTotal = Number(run.progress_total ?? 0) || 0;
  const total = rawTotal > 0 ? rawTotal : 0;
  const completed = status === "completed";
  const pct = total > 0
    ? Math.round(clamp((current / total) * 100, completed ? 100 : 2, 100))
    : completed ? 100 : null;
  const label = String(run.progress_label || "")
    || (status === "running" ? "Working" : status === "completed" ? "Completed" : status || "Waiting");
  const countText = total > 0
    ? `${Math.min(current, total).toLocaleString()} / ${total.toLocaleString()}`
    : current > 0
      ? current.toLocaleString()
      : "";
  return {
    current,
    total,
    pct,
    label,
    countText,
    determinate: total > 0,
    active: status === "running" && !isStalledJobRun(run),
  };
}

/**
 * Converts an annualized ROI rate and years owned into an annualized percentage.
 * Pure arithmetic wrapper used by portfolio ROI badge rendering.
 */
export function annualizedROI(purchasePrice, currentValue, yearsOwned) {
  if (!purchasePrice || purchasePrice <= 0 || !currentValue || yearsOwned <= 0) return null;
  const ratio = currentValue / purchasePrice;
  return (Math.pow(ratio, 1 / yearsOwned) - 1) * 100;
}

/**
 * Parses a subset of Markdown into safe HTML.
 * Escapes the input first, so XSS via user-controlled text is prevented.
 */
export function parseMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
  html = html.replace(/^### (.*?)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*?)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*?)$/gm, "<h1>$1</h1>");
  const lines = html.split("\n");
  let inList = false;
  const processed = lines.map(line => {
    const cleanLine = line.trim();
    if (cleanLine.startsWith("- ") || cleanLine.startsWith("* ")) {
      let listContent = cleanLine.slice(2);
      let out = "";
      if (!inList) { inList = true; out += '<ul style="margin: 4px 0; padding-left: 20px;">'; }
      out += `<li>${listContent}</li>`;
      return out;
    } else {
      let out = "";
      if (inList) { inList = false; out += "</ul>"; }
      out += line;
      return out;
    }
  });
  if (inList) processed.push("</ul>");
  return processed.join("<br>").replace(/<\/ul><br>/g, "</ul>").replace(/<br><ul/g, "<ul");
}

/**
 * Parse raw CSV text into a 2D array of cells. Handles quoted cells with
 * embedded commas/newlines and doubled-quote escapes. Pure — no DOM.
 */
export function parseCSVTable(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(v => String(v).trim() !== "")) rows.push(row);
  return rows;
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a collection-import CSV into row objects ready for
 * POST /api/collection/import. Header names are matched loosely
 * ("set_num"/"Set Number", "purchased_at"/"date_added", …); conditions map
 * onto the schema enum; unparseable dates become null. Returns [] when the
 * set_num column is missing.
 */
export function parseCollectionCSV(text) {
  const table = parseCSVTable(text);
  if (!table.length) return [];
  const header = table[0].map(h => h.trim().replace(/^["']|["']$/g, ""));
  const normHeader = header.map(h => h.toLowerCase().replace(/\s+/g, "_"));
  const findIdx = (...names) => {
    const wanted = names.map(n => n.toLowerCase().replace(/\s+/g, "_"));
    return normHeader.findIndex(h => wanted.includes(h));
  };
  // Header synonyms cover Brickset ("Number", "QtyOwned", "PricePaid",
  // "DateAcquired") and BrickEconomy ("Number", "Qty", "Paid", "Purchase Date")
  // exports, so collectors can import their existing lists without editing the
  // file. "Value"-style columns are deliberately NOT mapped to purchase price —
  // that's a market estimate, not what the user paid.
  const setNumIdx = findIdx("set_num", "set_number", "number", "set", "setnumber", "item_number");
  if (setNumIdx === -1) return [];

  const quantityIdx = findIdx("quantity", "qty", "qtyowned", "qty_owned", "quantity_owned", "owned");
  const priceIdx = findIdx("purchase_price", "pricepaid", "price_paid", "paid", "purchase_cost", "cost", "my_price");
  const condIdx = findIdx("condition");
  const dateIdx = findIdx("purchased_at", "date_added", "dateacquired", "date_acquired", "purchase_date", "acquired");
  const notesIdx = findIdx("notes");
  const storageIdx = findIdx("storage_location");
  const sourceIdx = findIdx("acquisition_source");
  const completeIdx = findIdx("is_complete");
  const missingIdx = findIdx("missing_pieces");

  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const parts = table[i].map(p => String(p || "").trim());
    if (!parts.some(Boolean)) continue;
    let set_num = parts[setNumIdx];
    if (!set_num) continue;
    // Brickset/BrickEconomy often export bare numbers ("75192"); the catalog's
    // canonical form carries the variant suffix ("75192-1").
    if (/^\d{3,7}$/.test(set_num)) set_num = `${set_num}-1`;
    const quantity = quantityIdx !== -1 ? (parseInt(parts[quantityIdx], 10) || 1) : 1;
    const purchase_price = priceIdx !== -1 ? optionalNumber(parts[priceIdx]) : null;
    let condition = condIdx !== -1 ? parts[condIdx].toLowerCase() : "new";
    if (condition.includes("accept")) condition = "used_acceptable";
    else if (condition.includes("good") || condition.includes("used")) condition = "used_good";
    else if (condition.includes("seal")) condition = "sealed";
    else condition = "new";

    let purchased_at = dateIdx !== -1 ? parts[dateIdx] : null;
    if (purchased_at) {
      const parsed = Date.parse(purchased_at);
      if (!isNaN(parsed)) {
        purchased_at = new Date(parsed).toISOString().slice(0, 10);
      } else {
        purchased_at = null;
      }
    }
    const row = { set_num, quantity, purchase_price, condition, purchased_at };
    if (notesIdx !== -1) row.notes = parts[notesIdx] || null;
    if (storageIdx !== -1) row.storage_location = parts[storageIdx] || null;
    if (sourceIdx !== -1) row.acquisition_source = parts[sourceIdx] || null;
    if (completeIdx !== -1) row.is_complete = parts[completeIdx] === "" ? true : !/^(false|0|no)$/i.test(parts[completeIdx]);
    if (missingIdx !== -1) row.missing_pieces = parseInt(parts[missingIdx], 10) || 0;
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a user-typed money amount: strips currency symbols, spaces, and
 * thousands separators; accepts "1,234.56", "$ 1299", "1.299,50" (EU style
 * when both separators present and comma is last). Returns a finite
 * non-negative number or null.
 */
export function sanitizeMoneyInput(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // Comma only: decimal if exactly 1–2 trailing digits, else thousands.
    const after = s.length - lastComma - 1;
    s = (after >= 1 && after <= 2 && s.indexOf(",") === lastComma)
      ? s.replace(",", ".")
      : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Given saved download metadata and the server's response to a Range request,
 * returns the byte offset to resume from (> 0) or 0 to restart from scratch.
 *   meta          — { url, etag?, loadedBytes, complete } saved in localStorage
 *   responseStatus — HTTP status code (206 = partial, 200 = full)
 *   responseEtag   — ETag / Last-Modified from the response headers (or null)
 */
export function resolveDownloadResume(meta, responseStatus, responseEtag) {
  if (!meta || !(meta.loadedBytes > 0) || meta.complete) return 0;
  if (responseStatus !== 206) return 0;
  // Mismatched etag means the content changed — must restart.
  if (meta.etag && responseEtag && meta.etag !== responseEtag) return 0;
  return meta.loadedBytes;
}


/**
 * Pure filter+sort over the bundled offline seed catalog. Mirrors the subset of
 * /api/sets/search semantics that offline browsing needs (text search, theme,
 * retired/retiring, deal, numeric ranges, and the catalog sort keys). Kept
 * DOM-free and state-free so it's unit-tested in pure.test.js.
 *
 *   rows   — array of compact seed rows (see routes/catalog-seed.ts SEED_FIELDS)
 *   params — plain object with the same keys catalogQuery() emits
 * Returns a new sorted+filtered array (does not mutate rows).
 */
export function seedFilterSort(rows, params = {}) {
  const val = (s) => Number(s.market_value) || 0;
  const num = (v) => (v === "" || v == null ? null : Number(v));

  const q = (params.q || "").trim().toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const theme = params.theme && params.theme !== "all" ? String(params.theme) : null;
  const minYear = num(params.min_year), maxYear = num(params.max_year);
  const minPieces = num(params.min_pieces), maxPieces = num(params.max_pieces);
  const minValue = num(params.min_value), maxValue = num(params.max_value);

  let out = rows.filter((s) => {
    if (tokens.length) {
      const hay = `${s.set_num || ""} ${s.name || ""} ${s.theme || ""} ${s.subtheme || ""}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    if (theme && String(s.theme) !== theme) return false;
    if (params.retired === "1" && !s.retired) return false;
    if (params.retired === "0" && s.retired) return false;
    if (params.retiring === "1" && !s.lego_retiring_soon) return false;
    if (params.deal === "1" && !(s.deal_strong || s.deal_signal)) return false;
    if (minYear != null && Number(s.year) < minYear) return false;
    if (maxYear != null && Number(s.year) > maxYear) return false;
    if (minPieces != null && Number(s.pieces || 0) < minPieces) return false;
    if (maxPieces != null && Number(s.pieces || 0) > maxPieces) return false;
    if (minValue != null && val(s) < minValue) return false;
    if (maxValue != null && val(s) > maxValue) return false;
    return true;
  });

  const roi = (s) => {
    const r = Number(s.retail_price) || 0;
    return r > 0 ? (val(s) - r) / r : -Infinity;
  };
  const cmp = {
    value_desc: (a, b) => val(b) - val(a),
    value_asc: (a, b) => val(a) - val(b),
    roi_desc: (a, b) => roi(b) - roi(a),
    roi_asc: (a, b) => roi(a) - roi(b),
    year_desc: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0),
    year_asc: (a, b) => (Number(a.year) || 0) - (Number(b.year) || 0),
    az: (a, b) => String(a.name || "").localeCompare(String(b.name || "")),
    za: (a, b) => String(b.name || "").localeCompare(String(a.name || "")),
    trending: (a, b) => (Number(b.retirement_risk_score) || 0) - (Number(a.retirement_risk_score) || 0) || val(b) - val(a),
  }[params.sort] || cmpValueDescFallback;
  return out.sort(cmp);
}
function cmpValueDescFallback(a, b) {
  return (Number(b.market_value) || 0) - (Number(a.market_value) || 0);
}

/**
 * Hand-picked accent colour per LEGO theme, for the set-detail number badge.
 *
 * themeHue() (above) hashes the theme NAME to a hue. That is stable and needs no
 * maintenance, but the hue it lands on is arbitrary: "Modular Buildings" hashes
 * to 57 (yellow), which cannot legibly carry white text. These are chosen for
 * brand association AND contrast — every `c` below holds white text at >= 4.5:1.
 *
 * `d` is a deeper shade of the same colour, used for the badge's darker details.
 *
 * Coverage is the catalogue's real head by set count. Deliberately NOT mapped:
 * Gear (5,882), Books (1,435) and Educational and Dacta (1,113) are the three
 * biggest "themes" by row count but are bulk non-set records, so a curated
 * colour would be spent on rows a user never opens. Anything unmapped falls
 * back to themeHue(), so no set is ever left without an accent.
 */
export const THEME_COLORS = {
  "Star Wars": { c: "#2B4C9B", d: "#1F3A78" },
  "City": { c: "#0E76B8", d: "#0A5C91" },
  "Technic": { c: "#CC3E1A", d: "#A83214" },
  "Ninjago": { c: "#0D7F74", d: "#0A6960" },
  "Friends": { c: "#C8317F", d: "#9C2463" },
  "Creator": { c: "#2A8441", d: "#217036" },
  "Duplo": { c: "#D33A26", d: "#B62E1D" },
  "Bionicle": { c: "#5A6570", d: "#414A53" },
  "Super Heroes Marvel": { c: "#C01E2E", d: "#941623" },
  "Super Heroes DC": { c: "#1B3F8F", d: "#132E6B" },
  "Castle": { c: "#7A5B33", d: "#5B4426" },
  "Space": { c: "#1F2A44", d: "#141C30" },
  "Harry Potter": { c: "#5B2233", d: "#411824" },
  "Minecraft": { c: "#487F2F", d: "#3A6926" },
  "Super Mario": { c: "#D9382E", d: "#B02A21" },
  "Disney": { c: "#8B3FA8", d: "#6A2F81" },
  "Train": { c: "#1E6B4F", d: "#14513B" },
  "Racers": { c: "#B15D15", d: "#8C4A0F" },
  "Town": { c: "#966B0D", d: "#7A5709" },
  "Seasonal": { c: "#B3352F", d: "#8A2823" },
  "Brickheadz": { c: "#7A57B8", d: "#5E4193" },
  "Legends of Chima": { c: "#966D18", d: "#745413" },
  "Sports": { c: "#166B8C", d: "#0F506B" },
  "Collectible Minifigures": { c: "#5C6B7A", d: "#44515D" },
  "Legoland": { c: "#C4452A", d: "#98341F" },
  "System": { c: "#4A5A6B", d: "#35424F" },
  "Promotional": { c: "#7A6A4F", d: "#5B4E3A" },
  "Other": { c: "#6B7280", d: "#4E545C" },
};

/**
 * Accent colours for a theme: the curated pair when we have one, otherwise a
 * hue-derived pair from themeHue(). The fallback pins lightness low enough
 * (38%/28%) that white text stays legible whatever hue the hash produces —
 * that is the whole reason it does not just return `hsl(h 60% 50%)`.
 * Returns CSS colour strings; never throws, never returns null.
 */
export function themeColor(theme) {
  const hit = THEME_COLORS[String(theme || "").trim()];
  if (hit) return hit;
  const h = themeHue(theme || "");
  return { c: `hsl(${h} 42% 38%)`, d: `hsl(${h} 44% 28%)` };
}

/**
 * Whether a wishlist row is currently "alerting": its current value has
 * reached/exceeded the user's target price AND the user has not dismissed
 * the alert (acknowledged_at).
 * Pure, defensive: any missing value means "not alerting".
 */
export function isWishlistAlerting(w) {
  if (!w) return false;
  if (w.target_price == null || w.current_value == null) return false;
  const target = Number(w.target_price);
  const value = Number(w.current_value);
  if (!Number.isFinite(target) || !Number.isFinite(value)) return false;
  return value >= target && !w.acknowledged_at;
}

/** Count of wishlist rows currently alerting (see isWishlistAlerting). */
export function wishlistAlertCount(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((n, w) => n + (isWishlistAlerting(w) ? 1 : 0), 0);
}


const CANONICAL_MARKET_FIELDS = Object.freeze([
  'blended_value', 'blended_confidence', 'primary_value_source',
  'market_sources', 'market_value_note',
  'value_updated_at', 'retirement_date', 'retirement_confidence',
]);

/** Normalize collection/catalog set badges through one shared path. */
export function canonicalSetMarketMeta(row = {}) {
  const condition = String(row.condition || 'new').toLowerCase() === 'used'
    ? 'used'
    : 'sealed';
  const quantity = Math.max(1, Number.parseInt(row.quantity, 10) || 1);
  return {
    setNum: String(row.set_num || row.setNum || ''),
    value: displayValueOf(row),
    condition,
    quantity,
    // valuationTrust returns { tone, label, detail, confidence, freshness,
    // source } — there is no `tier`, so reading one silently yielded undefined.
    // It also reads `confidence`, while the canonical blended row carries
    // `blended_confidence`, so hand it the explicit value when present.
    trust: valuationTrust(
      row.confidence ? row : { ...row, confidence: row.blended_confidence || row.confidence },
    ).confidence,
  };
}

/** Merge only canonical market facts; never overwrite ownership facts. */
export function mergeCanonicalSetMarketData(ownedRows, freshRows) {
  if (!Array.isArray(ownedRows) || !Array.isArray(freshRows) || freshRows.length === 0) {
    return Array.isArray(ownedRows) ? ownedRows : [];
  }
  const freshBySet = new Map(freshRows
    .filter((row) => row && (row.set_num || row.setNum))
    .map((row) => [String(row.set_num || row.setNum), row]));
  return ownedRows.map((owned) => {
    const fresh = freshBySet.get(String(owned?.set_num || owned?.setNum || ''));
    if (!fresh) return owned;
    const market = {};
    for (const key of CANONICAL_MARKET_FIELDS) {
      if (fresh[key] !== undefined && fresh[key] !== null) market[key] = fresh[key];
    }
    return { ...owned, ...market };
  });
}
