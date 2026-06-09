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
  const market = set.ebay_value || set.current_value;
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

export function valuationTrust(set = {}) {
  const freshness = set.freshness || (set.cached_at && Date.now() - new Date(set.cached_at).getTime() > 60 * 86400000 ? "stale" : "fresh");
  const confidence = set.confidence || (set.valuation_method === "formula_bulk" || set.valuation_method === "local" ? "estimated" : "medium");
  const source = set.primary_value_source || set.valuation_method || "unknown";
  if (freshness === "expired") {
    return { tone: "danger", label: "Refresh due", detail: "Market value is expired and should be refreshed.", confidence, freshness, source };
  }
  if (freshness === "stale") {
    return { tone: "warn", label: "Stale value", detail: "Market value is older than 60 days.", confidence, freshness, source };
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
  return { tone: "ok", label: "Market checked", detail: "Fresh value from a configured market source.", confidence, freshness, source };
}

export function catalogFilterSummary(filter = {}) {
  const parts = [];
  if (filter.catalogQ) parts.push(`Search "${filter.catalogQ}"`);
  if (filter.catalogTheme && filter.catalogTheme !== "all") parts.push(filter.catalogTheme);
  if (filter.catalogRetired) parts.push("Retired only");
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
