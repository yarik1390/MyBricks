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

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const daysAgo = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

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

export function valuationTrust(set = {}) {
  const freshness = set.freshness || (set.cached_at && Date.now() - new Date(set.cached_at).getTime() > 60 * 86400000 ? "stale" : "fresh");
  const confidence = set.confidence || (set.valuation_method === "formula_bulk" || set.valuation_method === "local" ? "estimated" : "medium");
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

export function catalogFilterSummary(filter = {}) {
  const parts = [];
  if (filter.catalogQ) parts.push(`Search "${filter.catalogQ}"`);
  if (filter.catalogTheme && filter.catalogTheme !== "all") parts.push(filter.catalogTheme);
  if (filter.catalogThemeGroup && filter.catalogThemeGroup !== "all") parts.push(filter.catalogThemeGroup);
  if (filter.catalogCategory && filter.catalogCategory !== "all") parts.push(filter.catalogCategory);
  if (filter.catalogRetired === "retired" || filter.catalogRetired === true) parts.push("Retired only");
  else if (filter.catalogRetired === "active") parts.push("Active only");
  const ranges = filter.catalogRanges || {};
  const valueLabel = (value, unit = "") => unit === "$" ? `$${value}` : `${value}${unit}`;
  const rangeLabel = (label, minKey, maxKey, unit = "") => {
    const min = ranges[minKey];
    const max = ranges[maxKey];
    if (min !== "" && min != null && max !== "" && max != null) parts.push(`${label} ${valueLabel(min, unit)}-${valueLabel(max, unit)}`);
    else if (min !== "" && min != null) parts.push(`${label} >= ${valueLabel(min, unit)}`);
    else if (max !== "" && max != null) parts.push(`${label} <= ${valueLabel(max, unit)}`);
  };
  rangeLabel("Year", "min_year", "max_year");
  rangeLabel("Pieces", "min_pieces", "max_pieces", "pc");
  rangeLabel("Value", "min_value", "max_value", "$");
  return parts.length ? `${parts.length} active: ${parts.join(" · ")}` : "No filters active";
}

export function classifyJobRun(run = {}) {
  const error = String(run.error || "");
  const status = String(run.status || "unknown").toLowerCase();
  const retryable = /retry|no data|worker run stopped|timed out|timeout|operation was aborted|too many subrequests|brickset/i.test(error)
    && !/database disk image|sqlite_corrupt|malformed/i.test(error);
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
    return retryable
      ? { tone: "warn", label: "Retry needed", needsAttention: false, retryable: true }
      : { tone: "danger", label: "Hard error", needsAttention: true, retryable: false };
  }
  return { tone: "neutral", label: status || "Unknown", needsAttention: false, retryable: false };
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
 * Extract the `sub` (user id) claim from a JWT access token. Returns null when
 * the token is missing/malformed. JWT segments are base64url with no padding,
 * so normalize before decoding — plain atob() can choke on missing padding,
 * which previously made account-switch detection silently fail (two valid
 * tokens both resolving to null and comparing "equal").
 */
export function jwtSub(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    let s = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = s.length % 4;
    if (pad) s += "=".repeat(4 - pad);
    const payload = JSON.parse(atob(s));
    return payload.sub || null;
  } catch {
    return null;
  }
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
  const setNumIdx = findIdx("set_num", "set_number");
  if (setNumIdx === -1) return [];

  const quantityIdx = findIdx("quantity");
  const priceIdx = findIdx("purchase_price");
  const condIdx = findIdx("condition");
  const dateIdx = findIdx("purchased_at", "date_added");
  const notesIdx = findIdx("notes");
  const storageIdx = findIdx("storage_location");
  const sourceIdx = findIdx("acquisition_source");
  const completeIdx = findIdx("is_complete");
  const missingIdx = findIdx("missing_pieces");

  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const parts = table[i].map(p => String(p || "").trim());
    if (!parts.some(Boolean)) continue;
    const set_num = parts[setNumIdx];
    if (!set_num) continue;
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
 * Pure state machine for the offline banner's show/cancel debounce. Kept here
 * (and unit-tested) so the "never flash on load" logic has a single source of
 * truth; app.js maps the returned state onto a real grace timer + the
 * `body.offline` class.
 *
 * States: 'online' (hidden), 'pending' (hidden, grace timer running),
 *         'offline' (banner shown).
 * Events: 'offline' (a we-might-be-offline signal), 'online' (confirmed online),
 *         'grace'   (the grace window elapsed).
 *
 * The flash is prevented by 'pending' + 'online' → 'online': a transient offline
 * blip (e.g. a cold-load navigator.onLine=false quirk) is cancelled before the
 * grace window elapses, so the banner never paints. 'pending' + 'grace' →
 * 'offline' promotes a *persistent* offline state to shown. Any state + 'online'
 * clears immediately. An unknown `current` is treated as 'online'.
 */
export function nextOfflineBannerState(current, event) {
  const state = current === "pending" || current === "offline" ? current : "online";
  if (event === "online") return "online";
  if (event === "offline") return state === "offline" ? "offline" : "pending";
  if (event === "grace") return state === "pending" ? "offline" : state;
  return state;
}
