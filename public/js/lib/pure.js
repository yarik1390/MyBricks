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
