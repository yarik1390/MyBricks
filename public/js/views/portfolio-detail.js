import { $, $$, haptic, escapeHtml, toast, undoToast, fmtMoney, fmtPct, clamp, celebrate, setHue, fmtDateUpdated, setBtnLoading, drawSparkline, bricklinkBuyURL, CURRENCY_SYMBOLS, getExchangeRate, mount, cacheSetDetail, getCachedSetDetail, lastPortfolioMilestone, recordPortfolioMilestone, publicOrigin, proxyImg, capturedMoneyContext, advisorEnabled } from '../utils.js';
import { icon as kitIcon, iconBtn as kitIconBtn, row as kitRow, seg as kitSeg, field as kitField, pill as kitPill, delta as kitDelta, topbar as kitTopbar, emptyState as kitEmptyState, sheetBody as kitSheetBody, brickSvg as kitBrick } from '../ui/kit.js';
import { localMoneyToUsd, usdMoneyInputValue } from '../lib/money-input.js';
import { derivePartOutDecision } from '../lib/part-out-decision.js';
import { priceStripHTML, marketConfidenceHTML, marketSpreadHTML, marketDepthHTML, dealSignalHTML, partOutHTML, investmentPricingHTML, investmentPricingDetailHTML, soldEvidenceHTML } from './portfolio-detail-market.js';
import { computeDealScore, computeSellSignal, ebaySoldSummary, marketValueForCondition, estMark, displayValueOf, flipEconomics, cleanTagLabel, priceMovementSummary, valuationConfidencePresentation } from '../lib/pure.js';
import { t, tPlural, getLocale, kidsXpMessage, kidsBadgeLabel } from '../lib/i18n.js';
import { pricechartingAttributionHTML } from '../lib/partner-attribution.js';
import { figAvatarSVG } from '../lib/fig-avatar.js';
import { state, invalidatePortfolio, markSetOwned } from '../state.js';
import { shareContent } from '../lib/native-share.js';
import { api, getSessionUserId, _authSession, outboxEnqueue, isGuestMode } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet, confirmSheet } from '../components/sheet.js';
import { go } from '../router.js';
import { skelDetail } from '../components/skeleton.js';
import { flipCalcHTML } from '../components/flip-calc.js';
import { openReviewSheet, openPhotoSheet, openDataFixSheet } from '../components/contribute.js';
import { refreshNavBadge } from './portfolio.js';
import { getModePref } from '../theme.js';
import { hydrateAmazonSlots } from '../lib/amazon-affiliate.js';
import { getProviderCredential } from '../lib/provider-credentials.js';

// Simple mode hides the forecast (price-projection) tab. Helper centralizes the
// check and the available-tabs list so every tab build stays consistent.
const isSimpleMode = () => getModePref() === "simple";
const isKidsMode = () => getModePref() === "kids";

// A milestone fires when an add CROSSES a threshold upward — prev < threshold <=
// current — comparing against the persisted last-seen total (recordPortfolioMilestone),
// not a stale state.portfolio read. This both stops re-firing on every add of a
// pricey set AND lets a threshold celebrate again after you delete below it and
// re-cross. Returns the highest newly-crossed message (null if none).
function crossedMilestone(list, prev, cur) {
  let msg = null;
  for (const [threshold, m] of list) if (prev < threshold && cur >= threshold) msg = m;
  return msg;
}

// After any vault mutation from the set page (add, or qty +/-), read the
// authoritative totals, celebrate a newly-crossed milestone (once per upward
// crossing), and re-warm the portfolio cache. No-op in Kids mode.
const COUNT_MS = [[1,"Your first set! Welcome to BricksVault!"],[10,"10 sets in the vault!"],[25,"25 sets! Nice collection."],[50,"50 sets! Dedicated collector 🏅"],[100,"100 sets! Elite collector 🏆"]];
const VALUE_MS = [[1000,"$1,000 portfolio milestone!"],[5000,"$5,000 portfolio!"],[10000,"$10,000 portfolio 💰"],[50000,"$50,000 — serious money 🤑"]];
async function maybeCelebrateMilestone(hue) {
  if (isKidsMode()) return;
  try {
    const coll = await api("/api/collection");
    state.portfolio = coll;
    const curCount = coll.count ?? coll.items?.length ?? 0;
    const curValue = coll.total_value ?? 0;
    const prev = lastPortfolioMilestone();
    // Fire at most ONE popup — value takes precedence over count.
    const fire = crossedMilestone(VALUE_MS, prev.value, curValue) || crossedMilestone(COUNT_MS, prev.count, curCount);
    recordPortfolioMilestone(curCount, curValue);
    if (fire) setTimeout(() => celebrate(fire, { hue }), 700);
  } catch {}
}
const TAB_LABEL_KEYS = { info: "bvSet.tabOverview", forecast: "bvSet.tabHistory", community: "bvSet.tabCommunity" };
function tabLabel(tab) {
  return t(TAB_LABEL_KEYS[tab] || "bvSet.tabOverview");
}

// Overview · Price history · Community. The ids stay info/forecast/community so
// every old deep link (#/set/:num/forecast …) keeps landing on the right tab.
function detailTabs() {
  return ["info", "forecast", "community"];
}

// Friendly aliases for the tab hashes, plus the sub-routes that open a sheet
// (edit/sell/why/target/sold) or their own screen (passport/listing).
const TAB_ALIASES = { overview: "info", history: "forecast", manage: "passport" };
const SHEET_ROUTES = new Set(["edit", "sell", "why", "target", "sold"]);

// Module-level detail state (moved verbatim from portfolio.js; used only by
// the set-detail view's tab-swipe + custom-photo + event-delegation wiring).
let _swipeAc = null;

/* ============================================================
   Set detail
   ============================================================ */
export async function renderSetDetail(setNum) {
  const hit = state.detail.cache[setNum];
  const now = Date.now();
  if (hit && now - hit.ts < 300_000) {
    let painted = false;
    try { paintSetDetail(hit.set, hit.entry); painted = true; } catch { delete state.detail.cache[setNum]; }
    if (painted) {
      api("/api/sets/" + encodeURIComponent(setNum))
        .then(data => {
          const set = data.set || data;
          if (data.set_minifigs) set.set_minifigs = data.set_minifigs;
          const entry = data.entry || null;
          state.detail.cache[setNum] = { set, entry, ts: Date.now() };
          cacheSetDetail(setNum, set, entry, getSessionUserId());
          // Don't repaint over an open sheet (the user is mid-edit).
          if (location.hash.includes(setNum) && !document.body.classList.contains("sheet-open")) paintSetDetail(set, entry, { background: true });
        }).catch(() => {
          if (location.hash.includes(setNum)) toast("Showing cached data — live prices are unavailable", "info");
        });
      return;
    }
  }
  $("#root").innerHTML = skelDetail();
  try {
    const data = await api("/api/sets/" + encodeURIComponent(setNum));
    const set = data.set || data;
    if (data.set_minifigs) set.set_minifigs = data.set_minifigs;
    const entry = data.entry || null;
    state.detail.cache[setNum] = { set, entry, ts: Date.now() };
    cacheSetDetail(setNum, set, entry, getSessionUserId());
    paintSetDetail(set, entry);
  } catch (_e) {
    // Offline (or transient) — fall back to the persisted set-detail cache so a
    // previously-viewed set still opens instead of a dead end.
    const cached = await getCachedSetDetail(setNum, getSessionUserId());
    if (cached?.set) {
      try {
        paintSetDetail(cached.set, cached.entry);
        toast("Showing cached data — live prices are unavailable", "info");
        return;
      } catch {}
    }
    // Never opened on this device — fall back to the bundled seed catalog so a
    // top set still opens offline instead of a dead end.
    try {
      const { getSeedSetDetail } = await import("../lib/seed-catalog.js");
      const seed = await getSeedSetDetail(setNum);
      if (seed?.set) {
        paintSetDetail(seed.set, seed.entry);
        toast(navigator.onLine ? "Showing bundled data — live prices are unavailable" : "You're offline — showing bundled data", "info");
        return;
      }
    } catch { /* seed unavailable — fall through to not-found */ }
    $("#root").innerHTML = setNotFoundHTML(setNum, navigator.onLine);
  }
}

function setNotFoundHTML(setNum, online) {
  const title = online ? 'Set not found' : "Set isn't cached";
  const body = online
    ? `BricksVault could not find ${setNum} in the catalog. Check the set number variant, or search the catalog.`
    : `You're offline and ${setNum} has not been opened on this device yet.`;
  return `
    <div class="page">
      <div class="empty-state card" style="padding:18px;margin-top:16px;">
        <div class="empty-state-icon">${I.search()}</div>
        <h1 class="section-title">${escapeHtml(title)}</h1>
        <p style="color:var(--ink-mute);line-height:1.45;">${escapeHtml(body)}</p>
        <div class="empty-actions">
          <a class="btn-primary" href="#/add">${I.search()}<span>Search catalog</span></a>
          <a class="btn-secondary" href="#/pile">${I.scan()}<span>Scan a set</span></a>
        </div>
      </div>
    </div>`;
}

function paintSetDetail(set, entry, { background = false } = {}) {
  let tab = TAB_ALIASES[state.detail.tab] || state.detail.tab || "info";
  // A background refresh must not rebuild a screen the user is typing into
  // (the Passport autosaves on blur) or re-run the paid listing generator.
  if (background && (tab === "passport" || tab === "listing")) { _detailCtx = { set, entry }; return; }
  if (tab === "passport") { state.detail.tab = "passport"; paintPassport(set, entry); return; }
  if (tab === "listing") {
    if (!entry) tab = "info";
    else { state.detail.tab = "listing"; paintListing(set, entry); return; }
  }
  // Sheet deep links paint the page, then open the sheet once; the URL drops
  // back to the set so system back closes the sheet and stays on the page.
  let sheet = null;
  if (SHEET_ROUTES.has(tab)) {
    sheet = tab;
    tab = "info";
    history.replaceState(null, "", `#/set/${encodeURIComponent(set.set_num)}`);
  }
  if (!detailTabs().includes(tab)) tab = "info";
  state.detail.tab = tab;
  const isWish = state.wishlist.some(w => w.set_num === set.set_num);

  $("#root").innerHTML = `
    <main class="bv-page no-nav has-bar bv-setpage detail-page-container" data-detail-tab="${escapeHtml(tab)}" data-set="${escapeHtml(set.set_num)}">
      ${heroHTML(set, isWish)}
      <div class="bv-setpage__body bv-enter">
        ${titleBlockHTML(set)}
        ${valueCardHTML(set, entry)}
        ${signalBannerHTML(set, entry)}
        <div class="bv-tabs bv-settabs" id="detailTabs" role="tablist" aria-label="${escapeHtml(t("bvSet.sections"))}">
          ${detailTabs().map(id => `<button type="button" id="tab-${id}" data-tab="${id}" role="tab" tabindex="${tab === id ? "0" : "-1"}" aria-selected="${tab === id}" aria-controls="panel-${id}" class="${tab === id ? "active" : ""}">${escapeHtml(tabLabel(id))}</button>`).join("")}
        </div>
        <div id="tabPanels" class="bv-setpanels">
          <div class="detail-tab-panel" id="panel-${tab}" role="tabpanel" aria-labelledby="tab-${tab}">${panelHTML(tab, set, entry)}</div>
        </div>
      </div>
      <div id="setBar">${setBarHTML(set, entry, tab)}</div>
    </main>`;

  _detailCtx = { set, entry };
  ensureDetailDelegation();
  wirePanel(tab, set, entry);
  wireDetailActions(set, entry);
  wireSetHero(set, entry);
  setupTabSwipe(set, entry);
  if (sheet) openSetSheet(sheet, set, entry);
}

function panelHTML(tab, set, entry) {
  if (tab === "forecast") return historyTabHTML(set);
  if (tab === "community") return communityTabHTML(set);
  return infoTabHTML(set, entry);
}

function wirePanel(tab, set, entry) {
  if (tab === "forecast") wireHistoryTab(set, entry);
  else if (tab === "community") wireCommunityTab(set);
  else wireInfoTab(set);
}

const money0 = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : fmtMoney(Math.round(Number(v)), { cents: 0 }));
const signedMoney0 = (v) => `${Number(v) < 0 ? "−" : "+"}${money0(Math.abs(Number(v)))}`;
const moneySymbol = (ctx) => CURRENCY_SYMBOLS[ctx.currency] || "$";
const CONDITION_SEG = [["sealed", "bvSet.segSealed"], ["new", "bvSet.segOpened"], ["used_good", "bvSet.segBuilt"], ["used_acceptable", "bvSet.segParts"]];
const CONDITION_WORD = { sealed: "bvSet.condSealed", new: "bvSet.condOpened", used_good: "bvSet.condBuilt", used_acceptable: "bvSet.condParts" };
const conditionWord = (c) => t(CONDITION_WORD[c] || CONDITION_WORD.sealed);

function valueRange(set) {
  const v3 = set.valuation?.read_enabled ? set.valuation?.new : null;
  for (const [lo, hi] of [[v3?.low, v3?.high], [set.market_value_low, set.market_value_high], [set.blended_low, set.blended_high]]) {
    const l = Number(lo), h = Number(hi);
    if (l > 0 && h > l) return { low: l, high: h };
  }
  return null;
}

// Only a real projection is ever shown (same honesty rule as the forecast
// card): ready/external v3 forecasts, else the stored 2-year figure.
function realForecast(set) {
  if (isSimpleMode() || isKidsMode()) return 0;
  const forecast = set.valuation?.read_enabled ? set.valuation?.forecast : null;
  if (forecast && !(forecast.status === "ready" || forecast.status === "external")) return 0;
  const projection = Number(forecast?.base) || Number(set.forecast_2y) || 0;
  return projection > 0 ? projection : 0;
}

const paidOf = (entry) => (Number(entry?.purchase_price) > 0 ? Number(entry.purchase_price) : null);

function heroHTML(set, isWish) {
  const hue = setHue(set);
  const img = proxyImg(set.image_url);
  const hasImg = img && !img.startsWith("data:");
  return `<div class="bv-sethero${hasImg ? " has-photo" : ""}" style="--hue:${Number(hue) || 0}">
    <div class="bv-sethero__media">${kitBrick(`hsl(${Number(hue) || 0} 62% 64%)`)}${hasImg ? `<img class="set-photo" fetchpriority="high" src="${escapeHtml(img)}" alt="${escapeHtml(set.name || set.set_num)}">` : ""}</div>
    <div class="bv-sethero__bar">
      ${kitIconBtn({ icon: "back", label: t("common.back"), id: "detailBack", cls: "bv-sethero__btn" })}
      <span class="bv-sethero__actions">
        ${kitIconBtn({ icon: "share", label: t("common.share"), id: "shareBtn", cls: "bv-sethero__btn" })}
        <button type="button" class="bv-iconbtn bv-sethero__btn${isWish ? " is-on" : ""}" id="wishToggle" aria-pressed="${isWish}" aria-label="${escapeHtml(t(isWish ? "bvSet.wishRemove" : "bvSet.wishAdd"))}">${kitIcon(isWish ? "heartFill" : "heart")}</button>
      </span>
    </div>
    <button type="button" class="bv-pill bv-sethero__photos" id="heroPhotos" hidden></button>
  </div>`;
}

function titleBlockHTML(set) {
  const len = String(set.name || "").length;
  const size = len > 58 ? " is-very-long" : len > 36 ? " is-long" : "";
  const bits = [
    `<span class="bv-num bv-settitle__num">${escapeHtml(set.set_num)}</span>`,
    escapeHtml([set.theme, set.subtheme].filter(Boolean).join(" · ")),
    set.year ? escapeHtml(String(set.year)) : "",
    Number(set.pieces) > 0 ? escapeHtml(t("bvSet.pcs", { count: Number(set.pieces).toLocaleString(getLocale()) })) : "",
  ].filter(Boolean);
  const status = set.coming_soon ? t("bvCommon.comingSoon")
    : set.lego_retiring_soon && !set.retired ? t("bvSet.retiringSoon")
    : set.retired ? t("bvCommon.retired") : "";
  return `<div class="bv-settitle detail-identity-block" aria-label="${escapeHtml(t("bvSet.identity"))}">
    <h1 class="bv-settitle__name${size}">${escapeHtml(set.name || set.set_num)}</h1>
    <p class="bv-settitle__meta">${bits.join(" · ")}${status ? ` · <strong>${escapeHtml(status)}</strong>` : ""}</p>
  </div>`;
}

function valueCardHTML(set, entry) {
  const v = setDisplayValue(set);
  const est = !(set.valuation?.read_enabled && Number(set.valuation?.new?.fair_value) > 0) && !!estMark(set);
  const conf = valuationConfidencePresentation(set);
  const range = set.coming_soon ? null : valueRange(set);
  const forecast = set.coming_soon ? 0 : realForecast(set);
  const label = set.coming_soon ? t("bvSet.announcedRetail")
    : est ? t("bvSet.estimatedValue")
    : t("bvSet.marketValueCond", { condition: conditionWord(entry?.condition || "sealed") });
  const why = v > 0
    ? `<button type="button" class="bv-linkbtn" data-set-sheet="why">${escapeHtml(t("bvSet.whyPrice", { price: money0(v) }))}</button>` : "";
  let rangeHTML = "";
  if (range && v > 0) {
    const pad = (range.high - range.low) * 0.6;
    const lo = Math.min(range.low - pad, v), hi = Math.max(range.high + pad, v);
    const pos = (x) => clamp(((x - lo) / (hi - lo)) * 100, 0, 100);
    rangeHTML = `<div class="bv-range" role="img" aria-label="${escapeHtml(t("bvSet.rangeLabel", { low: money0(range.low), high: money0(range.high) }))}">
        <span class="bv-range__band" style="left:${pos(range.low).toFixed(1)}%;width:${(pos(range.high) - pos(range.low)).toFixed(1)}%"></span>
        <span class="bv-range__mark" style="left:${pos(v).toFixed(1)}%"></span></div>
      <div class="bv-range__legend"><span class="bv-num">${escapeHtml(money0(range.low))} – ${escapeHtml(money0(range.high))}</span>${why}</div>`;
  } else if (why) {
    // No range to draw: say where the number comes from instead.
    const note = set.coming_soon
      ? `<span class="detail-summary-src">Retail price, not resale value</span>`
      : valueProvenanceHTML(set).replace(/^<div class="detail-summary-src">([\s\S]*)<\/div>$/, '<span class="detail-summary-src">$1</span>')
        || `<span class="detail-summary-src">${escapeHtml(t("bvSet.noRange"))}</span>`;
    rangeHTML = `<div class="bv-range__legend">${note}${why}</div>`;
  }
  const facts = [];
  if (forecast) facts.push(`<div class="bv-valuecard__fact"><span class="bv-label">${escapeHtml(t("bvSet.forecast2y"))}</span><span class="bv-num">${escapeHtml(money0(forecast))}</span></div>`);
  if (entry && !isKidsMode()) {
    const target = Number(entry.sell_target) > 0 ? Number(entry.sell_target) : null;
    facts.push(`<button type="button" class="bv-valuecard__fact bv-valuecard__fact--btn" data-set-sheet="target" id="sellTargetBtn"><span class="bv-label">${escapeHtml(t("bvSet.sellTarget"))}</span>
      <span class="bv-valuecard__factval">${target ? `<span class="bv-num">${escapeHtml(money0(target))}</span>` : `<span class="bv-valuecard__hint">${escapeHtml(t("bvSet.setTarget"))}</span>`}${kitIcon("edit", { size: 16 })}</span></button>`);
  } else if (!entry && !set.coming_soon && Number(set.retail_price) > 0) {
    facts.push(`<div class="bv-valuecard__fact"><span class="bv-label">${escapeHtml(t("bvSet.retail"))}</span><span class="bv-num">${escapeHtml(fmtMoney(Number(set.retail_price)))}</span></div>`);
  }
  const chip = isSimpleMode() || set.coming_soon ? "" : `<button type="button" class="bv-conf bv-conf--${escapeHtml(conf.tone)}" data-set-sheet="why" title="${escapeHtml(conf.detail)}">${conf.tone === "good" ? kitIcon("check", { size: 16, stroke: 2.4 }) : ""}<span>${escapeHtml(conf.label)}</span>${kitIcon("chev", { size: 14, stroke: 2.4 })}</button>`;
  return `<section class="bv-card bv-valuecard detail-market-summary" aria-label="Market value summary">
    <div class="bv-valuecard__head"><div class="bv-valuecard__main"><span class="bv-label detail-summary-lbl">${escapeHtml(label)}</span>
      <span class="bv-valuecard__value bv-num detail-summary-val">${v > 0 ? `${est ? "~" : ""}${escapeHtml(money0(v))}` : "—"}</span></div>${chip}</div>
    ${rangeHTML}
    ${facts.length ? `<div class="bv-valuecard__facts">${facts.join("")}</div>` : ""}
  </section>`;
}

const SIGNAL_LEAD = { sell: "bvSet.signalSell", watch: "bvSet.signalWatch", hold: "bvSet.signalHold" };
function signalLine(signal, cls = "") {
  return `<div class="bv-banner bv-banner--neutral bv-setsignal${cls}" role="note">${kitIcon(signal.signal === "sell" ? "tag" : "trend", { size: 20 })}<span class="bv-banner__text"><strong>${escapeHtml(t(SIGNAL_LEAD[signal.signal]))}</strong> ${escapeHtml(localizedSellReasons(signal.reasons).join(" · "))}</span></div>`;
}
function signalBannerHTML(set, entry) {
  if (!entry || isSimpleMode() || isKidsMode()) return "";
  const s = sellSignalFor(set, entry);
  return s ? signalLine(s) : "";
}

// Pinned bottom bar. Owned: your copy (paid + gain, opens the edit sheet),
// Sell, Edit. Not owned: Add to vault. On Community: Add photo / Write review.
function setBarHTML(set, entry, tab) {
  if (tab === "community") {
    return `<div class="bv-setbar detail-action-bar">
      <button type="button" class="bv-btn bv-btn--outline" data-contrib="photo">${kitIcon("camera", { size: 20 })}<span>${escapeHtml(t("bvSet.addPhoto"))}</span></button>
      <button type="button" class="bv-btn bv-btn--primary" data-contrib="review">${kitIcon("edit", { size: 20 })}<span>${escapeHtml(t("bvSet.writeReview"))}</span></button>
    </div>`;
  }
  if (!entry) {
    const displayVal = setDisplayValue(set);
    return `<div class="bv-setbar detail-action-bar">
      <button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="addBtn">${kitIcon("plus", { size: 20, stroke: 2.2 })}<span>${escapeHtml(displayVal > 0 ? t("detail.addToVaultPrice", { price: estMark(set) + fmtMoney(displayVal, { cents: 0 }) }) : t("bvSet.addToVault"))}</span></button>
    </div>`;
  }
  const qty = Number(entry.quantity) || 1;
  const paid = paidOf(entry);
  const value = setDisplayValue(set) * qty;
  const cost = paid != null ? paid * qty : null;
  const gain = cost != null && value > 0 ? value - cost : null;
  const pct = gain != null && cost > 0 ? (gain / cost) * 100 : null;
  const line = `${paid != null ? t("bvSet.yourCopyPaid", { price: money0(paid) }) : t("bvSet.yourCopy")}${qty > 1 ? ` · ×${qty}` : ""}`;
  const sub = gain != null
    ? `<span class="bv-setbar__gain"><span class="bv-num ${gain >= 0 ? "bv-up" : "bv-down"}">${escapeHtml(signedMoney0(gain))}</span>${kitDelta(pct)}</span>`
    : `<span class="bv-setbar__hint">${escapeHtml(t("bvSet.addPricePaid"))}</span>`;
  return `<div class="bv-setbar detail-action-bar">
    <button type="button" class="bv-setbar__copy" data-set-sheet="edit" aria-label="${escapeHtml(t("bvSet.editTitle"))}"><span class="bv-label">${escapeHtml(line)}</span>${sub}</button>
    ${isKidsMode() ? "" : `<button type="button" class="bv-btn bv-btn--outline" id="sellBtn" data-set-sheet="sell">${kitIcon("tag", { size: 20 })}<span>${escapeHtml(t("bvSet.sell"))}</span></button>`}
    <button type="button" class="bv-btn bv-btn--outline" id="manageBtn" data-set-sheet="edit">${kitIcon("edit", { size: 20 })}<span>${escapeHtml(t("common.edit"))}</span></button>
  </div>`;
}

// Hero photo count ("1 / 6 photos") → lightbox, and the owner's own photo.
const _setImages = new Map();
function setImagesFor(setNum) {
  if (!_setImages.has(setNum)) {
    _setImages.set(setNum, api("/api/sets/" + encodeURIComponent(setNum) + "/images")
      .then(res => (res && Array.isArray(res.images) ? res.images.filter(u => typeof u === "string") : []))
      .catch(() => { _setImages.delete(setNum); return []; }));
  }
  return _setImages.get(setNum);
}

function wireSetHero(set, entry) {
  const main = proxyImg(set.image_url);
  const hasMain = main && !main.startsWith("data:");
  // A dead image (or the proxy's 1×1 "no photo" GIF) falls back to the brick.
  const heroImg = $(".bv-sethero__media img.set-photo");
  const dropHeroImg = () => {
    if (entry?.custom_image_url) return;
    heroImg?.remove();
    $(".bv-sethero")?.classList.remove("has-photo");
  };
  heroImg?.addEventListener("error", dropHeroImg, { once: true });
  heroImg?.addEventListener("load", () => { if (heroImg.naturalWidth <= 2) dropHeroImg(); }, { once: true });
  const pill = $("#heroPhotos");
  if (pill && Number(set.additional_image_count) > 0) {
    setImagesFor(set.set_num).then(extra => {
      const urls = [...(hasMain ? [main] : []), ...extra];
      if (urls.length < 2 || !pill.isConnected) return;
      pill.innerHTML = `${kitIcon("photo", { size: 14, stroke: 2.4 })}<span>${escapeHtml(tPlural("bvSet.photos", urls.length, { count: urls.length }))}</span>`;
      pill.hidden = false;
      pill.onclick = async () => {
        haptic("light");
        const { openLightbox } = await import("../components/lightbox.js");
        openLightbox(urls, 0);
      };
    });
  }
  if (entry?.custom_image_url) {
    customPhotoObjectURL(entry.custom_image_url).then(url => {
      const media = $(".bv-sethero__media");
      if (!url || !media) return;
      let img = media.querySelector("img.set-photo");
      if (!img) {
        img = document.createElement("img");
        img.className = "set-photo";
        img.alt = set.name || "";
        media.appendChild(img);
      }
      img.src = url;
      media.closest(".bv-sethero")?.classList.add("has-photo");
    });
  }
}

function overviewRowsHTML(set, entry) {
  const rows = [];
  if (entry) rows.push(kitRow({ icon: "photo", title: t("bvSet.passport"), sub: t("bvSet.passportSub"), href: `#/set/${encodeURIComponent(set.set_num)}/passport`, cls: "collector-passport" }));
  if (advisorEnabled()) rows.push(kitRow({ icon: "sparkle", title: t("bvSet.askAdvisor"), attrs: { "data-collector-advisor": "" } }));
  rows.push(kitRow({ icon: "brick", title: t("collector.buildIdeas"), href: "#/build" }));
  return `<div class="bv-setrows">${rows.join("")}</div>`;
}

function openSetSheet(kind, set, entry) {
  if (kind === "why") return openWhySheet(set, entry);
  if (!entry) return;
  if (kind === "edit") return openEditSheet(set, entry);
  if (kind === "sell") return openSellOptionsSheet(set, entry);
  if (kind === "target") return openSellTargetSheet(set, entry);
  if (kind === "sold") return openRecordSaleSheet(set, entry);
}

// Repaint the set with a changed holding and keep every cache in step.
function repaintWith(set, entry) {
  state.detail.cache[set.set_num] = { set, entry, ts: Date.now() };
  cacheSetDetail(set.set_num, set, entry, getSessionUserId());
  if (location.hash.includes(encodeURIComponent(set.set_num)) || location.hash.includes(set.set_num)) paintSetDetail(set, entry);
}

// "Your copy" — price paid (with RRP / Market / Gift shortcuts), condition,
// date bought and copies. Saves optimistically; offline edits go to the outbox.
function openEditSheet(set, entry) {
  const ctx = capturedMoneyContext();
  const market = setDisplayValue(set);
  const rrp = Number(set.retail_price) || 0;
  const cond = entry.condition || "sealed";
  const chips = [
    rrp > 0 ? { usd: rrp, label: t("bvSet.chipRrp", { price: fmtMoney(rrp) }) } : null,
    market > 0 ? { usd: market, label: t("bvSet.chipMarket", { price: money0(market) }) } : null,
    { usd: 0, label: t("bvSet.chipGift", { price: money0(0) }) },
  ].filter(Boolean);
  showSheet(kitSheetBody({
    title: t("bvSet.editTitle"),
    inner: `<form class="bv-form" id="quickEditForm" novalidate>
      ${kitField({ id: "qePrice", label: t("bvSet.pricePaid"), value: usdMoneyInputValue(entry.purchase_price, ctx), placeholder: "0.00", mono: true, prefix: moneySymbol(ctx), inputmode: "decimal", autocomplete: "off" })}
      <div class="bv-chips bv-chips--wrap">${chips.map(c => `<button type="button" class="bv-chip" data-qe-price="${escapeHtml(usdMoneyInputValue(c.usd, ctx))}">${escapeHtml(c.label)}</button>`).join("")}</div>
      <div class="bv-field"><span class="bv-field__label">${escapeHtml(t("bvSet.condition"))}</span>
        ${kitSeg(CONDITION_SEG.map(([value, key]) => ({ label: t(key), value, current: cond === value })), { label: t("bvSet.condition"), id: "qeCondition" })}</div>
      <div class="bv-form-grid">
        <div class="bv-field"><label for="qeDate">${escapeHtml(t("bvSet.bought"))}</label><div class="bv-field__box">${kitIcon("cal", { size: 20 })}<input id="qeDate" type="date" value="${entry.purchased_at ? escapeHtml(String(entry.purchased_at).slice(0, 10)) : ""}"></div></div>
        <div class="bv-field"><span class="bv-field__label">${escapeHtml(t("bvSet.copies"))}</span>
          <div class="bv-stepper qty-stepper">
            <button type="button" class="bv-iconbtn qty-btn" id="qtyDown" aria-label="${escapeHtml(t("bvSet.fewerCopies"))}">${kitIcon("minus")}</button>
            <span class="bv-num qty-num" id="qtyNum" aria-live="polite">${Number(entry.quantity) || 1}</span>
            <button type="button" class="bv-iconbtn qty-btn" id="qtyUp" aria-label="${escapeHtml(t("bvSet.moreCopies"))}">${kitIcon("plus")}</button>
          </div></div>
      </div>
      <button type="submit" class="bv-btn bv-btn--primary bv-btn--full" id="qeSave">${escapeHtml(t("common.save"))}</button>
      <a class="bv-btn bv-btn--text bv-btn--full" href="#/set/${encodeURIComponent(set.set_num)}/passport" id="qeMore">${escapeHtml(t("bvSet.moreDetails"))}</a>
      <button type="button" class="bv-btn bv-btn--danger bv-btn--full" id="qeRemove">${escapeHtml(t("bvSet.removeFromVault"))}</button>
    </form>`,
  }));
  $$("#sheet [data-qe-price]").forEach(b => b.addEventListener("click", () => { $("#qePrice").value = b.dataset.qePrice; haptic("light"); }));
  $$("#qeCondition [data-value]").forEach(b => b.addEventListener("click", () => {
    $$("#qeCondition [data-value]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    haptic("light");
  }));
  $("#qeMore")?.addEventListener("click", () => hideSheet());
  wireQtyStepper(set, entry);
  // The confirm replaces this sheet in place (showSheet swaps content).
  $("#qeRemove")?.addEventListener("click", () => removeFromVault(set, entry));
  $("#quickEditForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const parsed = localMoneyToUsd($("#qePrice").value, ctx);
    if (!parsed.valid) { toast(t("bvSet.priceInvalid"), "error"); $("#qePrice").focus(); return; }
    const condition = $("#qeCondition [aria-pressed=\"true\"]")?.dataset.value || cond;
    const body = {
      purchase_price: parsed.blank ? null : Math.round(parsed.usd * 100) / 100,
      condition,
      purchased_at: $("#qeDate").value || null,
    };
    haptic("medium");
    hideSheet();
    repaintWith(set, { ...entry, ...body });
    try {
      await api("/api/collection/" + entry.id, { method: "PATCH", body });
      invalidatePortfolio();
      toast(t("bvSet.saved"), "success");
    } catch (err) {
      if (!navigator.onLine) {
        outboxEnqueue({ path: "/api/collection/" + entry.id, method: "PATCH", body });
        toast(t("bvSet.savedOffline"), "info");
      } else {
        repaintWith(set, entry);
        toast(t("common.errorWithDetails", { error: err.message || err }), "error");
      }
    }
  });
}

// Sell target: one notification when the value reaches it (the daily alerts
// job latches it, and re-arms once the value drops back below).
function openSellTargetSheet(set, entry) {
  const ctx = capturedMoneyContext();
  const v = setDisplayValue(set);
  const forecast = realForecast(set);
  const current = Number(entry.sell_target) > 0 ? Number(entry.sell_target) : null;
  const options = [
    v > 0 ? { usd: Math.round(v * 1.1), label: t("bvSet.chipPlus", { pct: 10, price: money0(v * 1.1) }) } : null,
    v > 0 ? { usd: Math.round(v * 1.18), label: t("bvSet.chipPlus", { pct: 18, price: money0(v * 1.18) }) } : null,
    forecast > v * 1.02 ? { usd: Math.round(forecast), label: t("bvSet.chipForecast", { price: money0(forecast) }) } : null,
  ].filter(Boolean);
  const name = set.name || set.set_num;
  const sub = forecast > 0
    ? t("bvSet.targetBodyForecast", { name, value: money0(v), forecast: money0(forecast) })
    : t("bvSet.targetBody", { name, value: money0(v) });
  const isCurrent = (o) => current != null && Math.round(current) === o.usd;
  showSheet(kitSheetBody({
    title: t("bvSet.sellTarget"), sub,
    inner: `<form class="bv-form" id="sellTargetForm" novalidate>
      ${kitField({ id: "stPrice", label: t("bvSet.notifyAt"), value: current ? usdMoneyInputValue(current, ctx) : "", placeholder: v > 0 ? usdMoneyInputValue(Math.round(v * 1.18), ctx) : "", mono: true, prefix: moneySymbol(ctx), inputmode: "decimal", autocomplete: "off", help: t("bvSet.targetHelp") })}
      ${options.length ? `<div class="bv-chips bv-chips--wrap">${options.map(o => `<button type="button" class="bv-chip" data-st="${escapeHtml(usdMoneyInputValue(o.usd, ctx))}" aria-pressed="${isCurrent(o)}">${escapeHtml(o.label)}</button>`).join("")}</div>` : ""}
      <button type="submit" class="bv-btn bv-btn--primary bv-btn--full" id="stSave">${escapeHtml(t("bvSet.saveTarget"))}</button>
      ${current ? `<button type="button" class="bv-btn bv-btn--danger bv-btn--full" id="stRemove">${escapeHtml(t("bvSet.removeTarget"))}</button>` : ""}
    </form>`,
  }));
  $$("#sheet [data-st]").forEach(b => b.addEventListener("click", () => {
    $("#stPrice").value = b.dataset.st;
    $$("#sheet [data-st]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    haptic("light");
  }));
  const save = async (target) => {
    hideSheet();
    repaintWith(set, { ...entry, sell_target: target });
    try {
      await api("/api/collection/" + entry.id, { method: "PATCH", body: { sell_target: target } });
      invalidatePortfolio();
      toast(t(target ? "bvSet.targetSaved" : "bvSet.targetRemoved"), "success");
    } catch (err) {
      repaintWith(set, entry);
      toast(t("common.errorWithDetails", { error: err.message || err }), "error");
    }
  };
  $("#sellTargetForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const parsed = localMoneyToUsd($("#stPrice").value, ctx, { required: true, positive: true });
    if (!parsed.valid) { toast(t("bvSet.priceInvalid"), "error"); $("#stPrice").focus(); return; }
    haptic("medium");
    save(Math.round(parsed.usd * 100) / 100);
  });
  $("#stRemove")?.addEventListener("click", () => { haptic("light"); save(null); });
}

// Fee math shared by "Sell or part out" and the listing screen (same
// marketplace-fee settings the flip calculator uses). All figures are USD.
function saleEconomics(set, entry, marketOverride) {
  const market = marketOverride || marketValueForCondition(set, entry?.condition || "new") || setDisplayValue(set);
  const rate = getExchangeRate(state.me?.currency || "USD");
  const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const calc = market ? flipEconomics({ marketUsd: market, rate, feePct, paymentPct, shipping }) : null;
  const pocket = calc ? calc.net / rate : null;
  return { market, pocket, fees: pocket != null ? market - pocket : null, feePct: feePct + paymentPct };
}

function openSellOptionsSheet(set, entry) {
  const signal = isSimpleMode() || isKidsMode() ? null : sellSignalFor(set, entry);
  const paid = paidOf(entry);
  const { market, pocket, fees, feePct } = saleEconomics(set, entry);
  const part = derivePartOutDecision(set);
  const partValue = Number(part?.partOutValue) || 0;
  const partPocket = partValue > 0 ? partValue * (1 - feePct / 100) : 0;
  const partBest = partPocket > 0 && pocket != null && partPocket > pocket;
  const kv = (label, value, cls = "") => `<div class="bv-kv"><span>${escapeHtml(label)}</span><span class="bv-num ${cls}">${escapeHtml(value)}</span></div>`;
  const vsPaid = (net) => (paid != null && net != null ? kv(t("bvSet.vsPaid", { price: money0(paid) }), signedMoney0(net - paid), net - paid >= 0 ? "bv-up" : "bv-down") : "");
  const best = kitPill(t("bvSet.mostInPocket"), "acc");
  showSheet(kitSheetBody({
    title: t("bvSet.sellTitle"),
    inner: `${signal ? signalLine(signal, " bv-banner--sheet") : ""}
      ${market ? `<section class="bv-sellopt${partBest ? "" : partPocket > 0 ? " is-best" : ""}" aria-label="${escapeHtml(t("bvSet.sellWhole"))}">
        <div class="bv-sellopt__head"><span>${escapeHtml(t("bvSet.sellWhole"))}</span>${!partBest && partPocket > 0 ? best : ""}</div>
        <span class="bv-num bv-sellopt__value">${escapeHtml(`${estMark(set)}${money0(market)}`)}</span>
        ${fees != null ? kv(t("bvSet.feesApprox", { pct: Math.round(feePct) }), `−${money0(fees)}`, "bv-down") : ""}
        ${pocket != null ? kv(t("bvSet.inPocket"), money0(pocket)) : ""}${vsPaid(pocket)}
      </section>` : ""}
      ${partValue > 0 ? `<section class="bv-sellopt${partBest ? " is-best" : ""}" aria-label="${escapeHtml(t("bvSet.partOut"))}">
        <div class="bv-sellopt__head"><span>${escapeHtml(t("bvSet.partOut"))}</span>${partBest ? best : ""}</div>
        <span class="bv-num bv-sellopt__value">${escapeHtml(money0(partValue))}</span>
        ${kv(t("bvSet.partOutSub"), t("bvSet.slower"))}
        ${kv(t("bvSet.inPocketAfterFees"), money0(partPocket))}${vsPaid(partPocket)}
      </section>` : ""}
      <div class="bv-btn-row">
        <a class="bv-btn bv-btn--outline" id="exitGenListing" href="#/set/${encodeURIComponent(set.set_num)}/listing">${kitIcon("wand", { size: 20 })}<span>${escapeHtml(t("bvSet.draftListing"))}</span></a>
        <button type="button" class="bv-btn bv-btn--primary" id="sellMarkSold">${kitIcon("tag", { size: 20 })}<span>${escapeHtml(t("bvSet.markSold"))}</span></button>
      </div>
      <a class="bv-btn bv-btn--text bv-btn--full bl-buy-link" href="${escapeHtml(bricklinkBuyURL(set.set_num))}" target="_blank" rel="noopener">${escapeHtml(t("market.viewOnBrickLink"))}${kitIcon("ext", { size: 18 })}</a>`,
  }));
  $("#exitGenListing")?.addEventListener("click", () => hideSheet());
  $("#sellMarkSold")?.addEventListener("click", () => openRecordSaleSheet(set, entry));
}

// Record the sale: price, date and fees → realized gain (net of fees). The
// holding leaves the vault; the anonymized price feeds community comps.
function openRecordSaleSheet(set, entry) {
  const ctx = capturedMoneyContext();
  const { market, fees } = saleEconomics(set, entry);
  const paid = paidOf(entry);
  const today = new Date().toISOString().slice(0, 10);
  showSheet(kitSheetBody({
    title: t("bvSet.saleTitle"),
    inner: `<form class="bv-form" id="saleForm" novalidate>
      ${kitField({ id: "exitSoldPrice", label: t("bvSet.soldFor"), placeholder: market ? usdMoneyInputValue(Math.round(market), ctx) : "", mono: true, prefix: moneySymbol(ctx), inputmode: "decimal", autocomplete: "off" })}
      <div class="bv-form-grid">
        <div class="bv-field"><label for="saleDate">${escapeHtml(t("bvSet.saleDate"))}</label><div class="bv-field__box">${kitIcon("cal", { size: 20 })}<input id="saleDate" type="date" value="${today}" max="${today}"></div></div>
        ${kitField({ id: "saleFees", label: t("bvSet.fees"), placeholder: fees ? usdMoneyInputValue(Math.round(fees), ctx) : "0", mono: true, prefix: moneySymbol(ctx), inputmode: "decimal", autocomplete: "off" })}
      </div>
      <div class="bv-salegain" id="saleGain" hidden><span class="bv-salegain__text"><strong>${escapeHtml(t("bvSet.realizedGain"))}</strong><small id="saleGainSub"></small></span><span class="bv-num" id="saleGainVal"></span></div>
      <p class="bv-field__help">${escapeHtml(t("bvSet.saleNote"))}</p>
      <button type="submit" class="bv-btn bv-btn--primary bv-btn--full" id="exitConfirmSold">${kitIcon("tag", { size: 20 })}<span>${escapeHtml(t("bvSet.markSold"))}</span></button>
    </form>`,
  }));
  const read = () => ({
    price: localMoneyToUsd($("#exitSoldPrice")?.value, ctx, { required: true, positive: true }),
    fee: localMoneyToUsd($("#saleFees")?.value, ctx),
  });
  const refresh = () => {
    const { price, fee } = read();
    const box = $("#saleGain");
    if (!box) return;
    if (!price.valid || paid == null) { box.hidden = true; return; }
    const received = price.usd - (fee.valid && !fee.blank ? fee.usd : 0);
    const gain = received - paid * (Number(entry.quantity) || 1);
    box.hidden = false;
    box.classList.toggle("is-loss", gain < 0);
    $("#saleGainVal").textContent = signedMoney0(gain);
    $("#saleGainSub").textContent = t("bvSet.realizedSub", { received: money0(received), paid: money0(paid * (Number(entry.quantity) || 1)) });
  };
  ["#exitSoldPrice", "#saleFees"].forEach(s => $(s)?.addEventListener("input", refresh));
  $("#saleForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { price, fee } = read();
    if (!price.valid) { toast(t("bvSet.priceInvalid"), "error"); $("#exitSoldPrice")?.focus(); return; }
    if (!fee.valid || (!fee.blank && fee.usd >= price.usd)) { toast(t("bvSet.feesInvalid"), "error"); $("#saleFees")?.focus(); return; }
    const soldPrice = Math.round(price.usd * 100) / 100;
    const body = { set_num: set.set_num, sold_price: soldPrice, sold_at: $("#saleDate")?.value || today };
    if (!fee.blank && fee.usd > 0) body.sold_fees = Math.round(fee.usd * 100) / 100;
    haptic("heavy");
    const submit = $("#exitConfirmSold");
    setBtnLoading(submit, true);
    try {
      await api("/api/collection/sell", { method: "POST", body });
      hideSheet();
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      markSetOwned(set.set_num, false);
      toast(t("portfolio.soldFor", { price: fmtMoney(soldPrice) }), "success");
      go("#/");
    } catch (err) {
      setBtnLoading(submit, false);
      toast(t("common.errorWithDetails", { error: err.message || err }), "error");
    }
  });
}

// Why this price: the plain-language confidence read, provenance and the full
// market evidence that used to sit behind "Pricing details".
function openWhySheet(set, entry) {
  const v = setDisplayValue(set);
  const conf = valuationConfidencePresentation(set);
  showSheet(kitSheetBody({
    title: t("bvSet.whyPrice", { price: money0(v) }),
    id: "whySheet",
    inner: `<div class="bv-why__head"><span class="bv-num bv-why__value">${escapeHtml(money0(v))}</span>${isSimpleMode() ? "" : `<span class="bv-conf bv-conf--${escapeHtml(conf.tone)}">${escapeHtml(conf.label)}</span>`}</div>
      <p class="bv-sheet__sub bv-why__detail">${escapeHtml(conf.detail)}</p>
      ${valueProvenanceHTML(set)}
      ${isSimpleMode() ? "" : `<div class="pricing-details-sheet bv-why__body">${pricingDetailsHTML(set, entry)}</div>`}
      <div class="bv-btn-row">
        <a class="bv-btn bv-btn--outline" href="/methodology.html">${kitIcon("info", { size: 20 })}<span>${escapeHtml(t("bvSet.howWePrice"))}</span></a>
        ${isGuestMode() ? "" : `<button type="button" class="bv-btn bv-btn--outline" id="whyReportSale">${kitIcon("tag", { size: 20 })}<span>${escapeHtml(t("bvSet.reportSale"))}</span></button>`}
      </div>`,
  }));
  $("#sheet")?.setAttribute("aria-label", t("bvSet.whyPrice", { price: money0(v) }));
  $("#whyReportSale")?.addEventListener("click", () => { hideSheet(); openDataFixSheet(set.set_num); });
}

// Remove this holding (confirm + Undo snackbar) — from the Your copy sheet or
// the copies stepper going below one.
async function removeFromVault(set, entry) {
  const ok = await confirmSheet({
    title: "Remove from vault?",
    message: `Remove ${set.name} from your vault? Your notes and quantity for this set will be cleared.`,
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    // Keep the payload so a mis-tap after the confirm is still recoverable —
    // soft deletes make re-POSTing the entry a faithful restore.
    const restore = {
      set_num: set.set_num, quantity: entry.quantity || 1,
      condition: entry.condition || undefined, purchase_price: entry.purchase_price ?? undefined,
      purchased_at: entry.purchased_at || undefined, notes: entry.notes || undefined,
    };
    await api("/api/collection/" + encodeURIComponent(entry.id || set.set_num), { method: "DELETE" });
    invalidatePortfolio(); state.catalog.items = []; markSetOwned(set.set_num, false);
    undoToast("Removed from vault", async () => {
      try {
        await api("/api/collection", { method: "POST", body: restore });
        invalidatePortfolio(); state.catalog.items = []; markSetOwned(set.set_num, true);
        // Reload the profile before repainting so currency/mode context is
        // coherent with the restored guest collection.
        state.me = await api("/api/me");
        const r2 = await api("/api/sets/" + encodeURIComponent(set.set_num));
        repaintWith(r2.set || r2, r2.entry || null);
        toast("Restored to vault", "success");
      } catch { toast("Couldn't restore — add it again from the catalog.", "error"); }
    });
    const r = await api("/api/sets/" + encodeURIComponent(set.set_num));
    state.detail.tab = "info";
    repaintWith(r.set || r, r.entry || null);
  } catch (_e) {
    if (!navigator.onLine && entry?.id) {
      outboxEnqueue({ path: "/api/collection/" + entry.id, method: "DELETE" });
      invalidatePortfolio();
      toast("Removed offline — will sync when connected", "info");
      go("#/");
    } else toast("Remove failed", "error");
  }
}

// Copies stepper inside "Your copy". Minus at one removes the set (confirmed).
function wireQtyStepper(set, entry) {
  let qty = Number(entry?.quantity) || 1;
  const save = async () => {
    const n = $("#qtyNum");
    if (n) n.textContent = qty;
    try {
      await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } });
      entry.quantity = qty;
      state.detail.cache[set.set_num] = { set, entry, ts: Date.now() };
      mount($("#setBar"), setBarHTML(set, entry, state.detail.tab));
      invalidatePortfolio();
      maybeCelebrateMilestone(setHue(set));
    } catch (_e) { toast("Save failed", "error"); }
  };
  $("#qtyDown")?.addEventListener("click", () => {
    haptic("medium");
    if (qty <= 1) { removeFromVault(set, entry); return; }
    qty--;
    save();
  });
  $("#qtyUp")?.addEventListener("click", () => {
    haptic("medium");
    qty++;
    save();
  });
}

// Collection Passport (#/set/:num/passport): photos and memories first, then
// the full record of this copy. Fields autosave (wireManageTab).
function paintPassport(set, entry) {
  if (!entry) { state.detail.tab = "info"; paintSetDetail(set, entry); return; }
  $("#root").innerHTML = `<main class="bv-page no-nav bv-passport detail-page-container" data-detail-tab="manage" data-set="${escapeHtml(set.set_num)}">
    ${kitTopbar({ title: t("bvSet.passportTitle"), sub: t("bvSet.passportFor", { name: set.name || set.set_num }), back: `#/set/${encodeURIComponent(set.set_num)}`, actionsHtml: kitIconBtn({ icon: "share", label: t("common.share"), id: "shareBtn" }) })}
    <div class="detail-tab-panel" id="panel-manage">${manageTabHTML(set, entry)}</div>
  </main>`;
  _detailCtx = { set, entry };
  ensureDetailDelegation();
  wireManageTab(set, entry);
}

// eBay listing (#/set/:num/listing): generated title, description and price
// with copy buttons, Regenerate, Copy all and Open eBay.
let _listingGen = 0;
function paintListing(set, entry) {
  const setHref = `#/set/${encodeURIComponent(set.set_num)}`;
  const gen = ++_listingGen;
  const shell = (inner, bar = "") => `<main class="bv-page no-nav${bar ? " has-bar" : ""} bv-listing" id="listingPage" data-set="${escapeHtml(set.set_num)}">
    ${kitTopbar({ title: t("bvSet.listingTitle"), sub: t("bvSet.listingSub"), back: setHref, actionsHtml: kitIconBtn({ icon: "refresh", label: t("bvSet.regenerate"), id: "listingRegen" }) })}
    ${inner}${bar}</main>`;
  const stale = () => gen !== _listingGen || !location.hash.includes("/listing");
  const load = async () => {
    $("#root").innerHTML = shell(`<section class="bv-card bv-listing__loading" role="status">${kitIcon("sparkle")}<span>${escapeHtml(t("bvSet.generating"))}</span></section>`);
    try {
      const geminiKey = getProviderCredential("gemini");
      const openaiKey = getProviderCredential("openai");
      const headers = {};
      if (geminiKey) headers["X-Gemini-Key"] = geminiKey;
      else if (openaiKey) headers["X-OpenAI-Key"] = openaiKey;
      const draft = await api("/api/sets/" + encodeURIComponent(set.set_num) + "/listing-draft", { method: "POST", headers });
      if (stale()) return;
      const title = String(draft.title || "");
      const desc = String(draft.description || "");
      const price = Number(draft.suggested_price) || 0;
      const econ = price > 0 ? saleEconomics(set, entry, price) : null;
      const ebay = `https://www.ebay.com/sl/list?title=${encodeURIComponent(title.slice(0, 80))}`;
      const copyBtn = (id) => `<button type="button" class="bv-btn bv-btn--text bv-btn--sm" id="${id}">${kitIcon("copy", { size: 18 })}<span>${escapeHtml(t("bvSet.copy"))}</span></button>`;
      $("#root").innerHTML = shell(`
        <section class="bv-card bv-listing__field"><div class="bv-card__head"><label class="bv-label" for="listTitle" id="listTitleLabel">${escapeHtml(t("bvSet.titleCount", { count: title.length }))}</label>${copyBtn("copyListTitle")}</div>
          <textarea id="listTitle" class="bv-listing__title" rows="2" maxlength="80">${escapeHtml(title)}</textarea></section>
        <section class="bv-card bv-listing__field"><div class="bv-card__head"><label class="bv-label" for="listDesc">${escapeHtml(t("bvSet.description"))}</label>${copyBtn("copyListDesc")}</div>
          <textarea id="listDesc" class="bv-listing__desc" rows="8">${escapeHtml(desc)}</textarea></section>
        ${price > 0 ? `<section class="bv-card bv-listing__price">
          <div class="bv-kv"><span>${escapeHtml(t("bvSet.suggested"))}</span><span class="bv-num">${escapeHtml(fmtMoney(price))}</span></div>
          ${econ?.pocket ? `<div class="bv-kv"><span>${escapeHtml(t("bvSet.afterFees"))}</span><span class="bv-num">${escapeHtml(money0(econ.pocket))}</span></div>` : ""}</section>` : ""}
        ${draft.price_reasoning ? `<p class="bv-foot">${escapeHtml(draft.price_reasoning)}</p>` : ""}`,
      `<div class="bv-setbar detail-action-bar"><button type="button" class="bv-btn bv-btn--outline" id="copyListAll">${kitIcon("copy", { size: 20 })}<span>${escapeHtml(t("bvSet.copyAll"))}</span></button>
        <a class="bv-btn bv-btn--primary listing-ebay-btn" href="${escapeHtml(ebay)}" target="_blank" rel="noopener">${kitIcon("ext", { size: 20 })}<span>${escapeHtml(t("bvSet.openEbay"))}</span></a></div>`);
      $("#listingRegen")?.addEventListener("click", () => { haptic("light"); load(); });
      $("#listTitle")?.addEventListener("input", (e) => { const l = $("#listTitleLabel"); if (l) l.textContent = t("bvSet.titleCount", { count: e.target.value.length }); });
      $("#copyListTitle")?.addEventListener("click", () => copyListingField($("#listTitle").value, t("bvSet.titleLabel")));
      $("#copyListDesc")?.addEventListener("click", () => copyListingField($("#listDesc").value, t("bvSet.description")));
      $("#copyListAll")?.addEventListener("click", () => copyListingField(`${$("#listTitle").value}\n\n${$("#listDesc").value}`, t("bvSet.listingTitle")));
    } catch (err) {
      if (stale()) return;
      $("#root").innerHTML = shell(kitEmptyState({ icon: "alert", title: t("bvSet.listingFailed"), body: String(err?.message || err), actionsHtml: `<button type="button" class="bv-btn bv-btn--primary bv-btn--full" id="listingRetry">${escapeHtml(t("common.retry"))}</button>` }));
      $("#listingRetry")?.addEventListener("click", load);
      $("#listingRegen")?.addEventListener("click", load);
    }
  };
  load();
}

// Track the live blob URL so re-renders and navigation don't leak memory —
// each new photo fetch revokes the previous object URL first.
let _customPhotoURL = null;

async function customPhotoObjectURL(path) {
  try {
    const accessToken = _authSession?.access_token;
    const res = await fetch((window.WORKER_BASE || "") + path, {
      headers: accessToken ? { Authorization: "Bearer " + accessToken } : {},
    });
    if (!res.ok) return null;
    if (_customPhotoURL) URL.revokeObjectURL(_customPhotoURL);
    _customPhotoURL = URL.createObjectURL(await res.blob());
    return _customPhotoURL;
  } catch { return null; }
}

async function shareSet(set) {
  const shareUrl = `${publicOrigin()}/#/set/${encodeURIComponent(set.set_num)}`;
  const outcome = await shareContent({
    title: set.name,
    text: t('share.setText', { name: set.name, setNum: set.set_num }),
    url: shareUrl,
    dialogTitle: t('share.setDialogTitle', { name: set.name }),
  });
  if (outcome === 'unsupported') {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast("Link copied to clipboard!", "success");
    } catch {
      toast("Sharing isn't available on this device", "error");
    }
  }
}

// The value the page actually displays: the shared displayValueOf chain
// (market_value → blended_value → current_value) so the headline, the add
// button, the catalog card and the vault row all show the SAME number.
function setDisplayValue(set) {
  // Coming-soon sets aren't released yet — there's no market, so show the
  // announced retail (from the upcoming feed, else MSRP), not a formula estimate.
  if (set.coming_soon) return Number(set.upcoming_price) || Number(set.be_retail) || Number(set.retail_price) || 0;
  return (set.valuation?.read_enabled && Number(set.valuation?.new?.fair_value)) || displayValueOf(set);
}


// One-line key facts row: Pieces · Year · Minifigs · Retail. Replaces the old
// 3-col stat grid and the duplicate pieces row in Set Facts.
// Brickset's packaging enum, printed verbatim in the Details grid. It is DB
// data, so nothing in the source ever contained the word "Box" and no harvest
// could reach it — the row read "Упаковка Box" in Ukrainian. Naming the values
// here turns them into ordinary UI strings the dictionary can translate.
// Anything outside the enum falls through unchanged rather than being dropped.
const PACKAGING_LABELS = {
  'box': 'Box',
  'polybag': 'Polybag',
  'foil pack': 'Foil pack',
  'tag': 'Tag',
  'paper bag': 'Paper bag',
  'none (loose parts)': 'None (loose parts)',
  'blister pack': 'Blister pack',
  'other': 'Other',
  'bucket': 'Bucket',
  'plastic box': 'Plastic box',
  'tub': 'Tub',
  'box with handle': 'Box with handle',
  'plastic canister': 'Plastic canister',
  'shrink-wrapped': 'Shrink-wrapped',
  'zip-lock bag': 'Zip-lock bag',
  'canister': 'Canister',
  'box with backing card': 'Box with backing card',
  'metal canister': 'Metal canister',
  'wooden box': 'Wooden box',
};
function packagingLabel(v) {
  const s = String(v || '').trim();
  return PACKAGING_LABELS[s.toLowerCase()] || s;
}


// Provenance under the headline value: where the number comes from, in one
// plain line. Market values cite the signal count + range; estimates say so.
function valueProvenanceHTML(set) {
  if (set.coming_soon) return '';
  const v3 = set.valuation?.read_enabled ? set.valuation?.new : null;
  if (Number(v3?.fair_value) > 0) {
    const families = Number(v3.independent_family_count || 0);
    const sales = Number(v3.sample_count || 0);
    const lo = Number(v3.low), hi = Number(v3.high);
    const range = lo > 0 && hi > 0
      ? t('detail.likelyRange', { low: fmtMoney(lo, { cents: 0 }), high: fmtMoney(hi, { cents: 0 }) })
      : '';
    return `<div class="detail-summary-src">${tPlural('market.families', families)} · ${tPlural('market.sales', sales)}${range} · <a href="/methodology.html" style="color:inherit;text-decoration:underline;">How we price</a>${pcCreditHTML(set)}</div>`;
  }
  if (Number(set.market_value) > 0) {
    const n = Array.isArray(set.market_value_basis) ? set.market_value_basis.length : 0;
    const lo = Number(set.market_value_low), hi = Number(set.market_value_high);
    const range = lo > 0 && hi > 0 && hi > lo ? t('detail.typicalRange', { low: fmtMoney(lo, { cents: 0 }), high: fmtMoney(hi, { cents: 0 }) }) : '';
    return n > 0 ? `<div class="detail-summary-src">${tPlural('detail.fromSources', n)}${range}${pcCreditHTML(set)}</div>` : '';
  }
  if (estMark(set)) return `<div class="detail-summary-src">${t('detail.estimateNoSales')}${pcCreditHTML(set)}</div>`;
  return '';
}

// PriceCharting partner credit — renders only when PC actually contributes to
// the valuation basis. Verified numeric id → direct product link; otherwise a
// clearly-labeled homepage fallback. Guest-safe: renders '' without fields.
function pcCreditHTML(set) {
  const attribution = pricechartingAttributionHTML(set);
  return attribution ? ` · <span class="pc-credit">${attribution}</span>` : '';
}



function infoTabHTML(set, entry) {
  let bricksetHtml = '';
  {
    // Merge live brickset API data with stored DB columns (DB columns are fallback)
    const b = set.brickset || {};
    const ratingNum = b.rating ?? set.brickset_rating ?? 0;
    const reviewCount = b.reviewCount ?? set.brickset_review_count ?? 0;
    const reviewsStr = reviewCount
      ? tPlural('detail.reviews', reviewCount)
      : '';
    const ageMin = b.ageMin ?? set.age_min;
    const ageMax = b.ageMax ?? set.age_max;
    const ageStr = ageMin ? (ageMax ? `${ageMin}–${ageMax}` : `${ageMin}+`) : '';
    const subthemeStr = b.subtheme || set.subtheme || '';
    const themeGroupStr = b.themeGroup || set.theme_group || '';
    const categoryStr = b.category || set.category || '';
    let tagsArr = [];
    try { tagsArr = set.brickset_tags ? JSON.parse(set.brickset_tags) : []; } catch { tagsArr = []; }
    if (!Array.isArray(tagsArr)) tagsArr = [];
    // Stored tags may carry scraper metadata suffixes ("Harry Potter|n") — never show them.
    tagsArr = tagsArr.map(cleanTagLabel).filter(Boolean);
    const growthRate = set.be_growth_12m;
    const retiredYear = b.retiredYear ?? set.retired_year;

    const ratingSignal = ratingNum >= 4.0 && reviewCount >= 20
      ? `<span class="signal-hint" style="color:var(--green);font-size:10px;">High demand set</span>`
      : '';
    const growthBadge = (growthRate != null && !isSimpleMode())
      ? `<div class="detail-kv span2"><span class="k" title="Change in market value over the past 12 months">Past year</span> <span class="v" style="color:${growthRate >= 0 ? 'var(--up)' : 'var(--down)'};">${growthRate >= 0 ? t('detail.up', { pct: Math.abs(Number(growthRate)).toFixed(1) }) : t('detail.down', { pct: Math.abs(Number(growthRate)).toFixed(1) })}</span></div>`
      : '';
    const fmtMonthYear = (d) => { const ts = d ? Date.parse(d) : NaN; return Number.isNaN(ts) ? '' : new Date(ts).toLocaleDateString(getLocale(), { month: 'short', year: 'numeric' }); };
    const launchStr = fmtMonthYear(set.launch_date);
    const exitStr = fmtMonthYear(set.exit_date);
    const launchBadge = launchStr
      ? `<div class="detail-kv"><span class="k">Released</span> <span class="v">${launchStr}</span></div>`
      : '';
    const retiredYearBadge = exitStr
      ? `<div class="detail-kv"><span class="k">Retired</span> <span class="v">${exitStr}</span></div>`
      : (retiredYear && set.retired
        ? `<div class="detail-kv"><span class="k">Retired</span> <span class="v">${retiredYear}</span></div>`
        : '');
    const themeGroupBadge = themeGroupStr
      ? `<div class="detail-kv"><span class="k">Theme group</span> <span class="v">${escapeHtml(themeGroupStr)}</span></div>`
      : '';
    const categoryBadge = (categoryStr && categoryStr.toLowerCase() !== 'normal')
      ? `<div class="detail-kv"><span class="k">Category</span> <span class="v">${escapeHtml(categoryStr)}</span></div>`
      : '';
    const visibleTags = tagsArr.slice(0, 10);
    const hiddenTagCount = Math.max(0, tagsArr.length - visibleTags.length);
    const tagsBadge = tagsArr.length
      ? `<div class="detail-tag-row"><span class="detail-tag-label">Tags:</span> ${visibleTags.map(t => `<span class="detail-tag-chip">${escapeHtml(String(t))}</span>`).join('')}${hiddenTagCount ? `<span class="detail-tag-more">${tPlural('detail.tagsMore', hiddenTagCount)}</span>` : ''}</div>`
      : '';

    // Fine-grained LEGO.com status (pre-order/back-order/coming-soon/etc.) when
    // captured, falling back to the legacy retiring/in-stock booleans.
    const legoAvail = set.coming_soon ? 'coming_soon' : (set.lego_availability || (set.lego_retiring_soon ? 'retiring' : set.lego_in_stock === 1 ? 'in_stock' : null));
    const legoBadgeMap = {
      retiring: ['Retiring Soon', 'rgba(239,68,68,.12)', 'var(--down)'],
      pre_order: ['Pre-order at LEGO.com', 'rgba(59,130,246,.12)', 'var(--accent)'],
      coming_soon: ['Coming Soon to LEGO.com', 'rgba(59,130,246,.12)', 'var(--accent)'],
      back_order: ['Back-order at LEGO.com', 'rgba(234,179,8,.14)', 'var(--bv-yellow)'],
      in_stock: ['In Stock at LEGO.com', 'rgba(34,197,94,.12)', 'var(--up)'],
      sold_out: ['Sold Out at LEGO.com', 'rgba(148,163,184,.14)', 'var(--ink-mute)'],
      out_of_stock: ['Out of Stock at LEGO.com', 'rgba(148,163,184,.14)', 'var(--ink-mute)'],
    };
    const lb = legoAvail ? legoBadgeMap[legoAvail] : null;
    const legoStockBadge = lb
      ? `<div class="detail-kv span2"><span style="background:${lb[1]};color:${lb[2]};font-weight:700;border-radius:4px;padding:2px 8px;font-size:11px;">${lb[0]}</span></div>`
      : '';

    // Retirement likelihood (only meaningful while a set is still active) — shown
    // in plain language with the raw % as a tooltip.
    const riskScore = set.retirement_risk_score;
    const riskWord = riskScore >= 70 ? 'Likely soon' : riskScore >= 40 ? 'Possible' : 'Unlikely';
    const riskColor = riskScore >= 70 ? 'var(--down)' : riskScore >= 40 ? 'var(--bv-yellow)' : 'var(--ink)';
    const riskBadge = (riskScore != null && !set.retired && !set.coming_soon)
      ? `<div class="detail-kv"><span class="k" title="Estimated chance this set retires soon (${Math.round(riskScore)}%)">Retiring</span> <span class="v" style="color:${riskColor};">${riskWord}</span></div>`
      : '';

    // BrickInsights aggregate review score (0-100) — distinct from the Brickset
    // community stars above; links out to BrickInsights with attribution.
    const biRating = set.brickinsights_rating != null ? Math.round(Number(set.brickinsights_rating)) : null;
    const biReviewCount = Number(set.brickinsights_review_count) || 0;
    const biReviewsStr = biReviewCount ? tPlural('detail.reviews', biReviewCount) : '';
    const brickInsightsBadge = (biRating && biRating > 0)
      ? `<div class="detail-kv span2" style="display:flex;align-items:center;gap:8px;"><span class="k">Critics' score</span> <span class="v">${biRating}/100</span> <span style="color:var(--ink-mute);font-size:10px;">${biReviewsStr}</span>${set.brickinsights_url ? ` <a href="${escapeHtml(set.brickinsights_url)}" target="_blank" rel="noopener noreferrer" aria-label="View BrickInsights rating" style="color:var(--ink-faint);font-size:10px;">\u2197</a>` : ''}</div>`
      : '';

    if (ratingNum || ageStr || subthemeStr || themeGroupStr || categoryBadge || tagsArr.length || growthRate != null || retiredYear || set.launch_date || set.exit_date || legoStockBadge || riskBadge || brickInsightsBadge) {
      bricksetHtml = `
            ${subthemeStr ? `<div class="detail-kv"><span class="k">Subtheme</span> <span class="v">${escapeHtml(subthemeStr)}</span></div>` : ''}
            ${themeGroupBadge}
            ${categoryBadge}
            ${ageStr ? `<div class="detail-kv"><span class="k">Ages</span> <span class="v">${ageStr}</span></div>` : ''}
            ${launchBadge}
            ${retiredYearBadge}
            ${riskBadge}
            ${ratingNum ? `<div class="detail-kv span2" style="display:flex;align-items:center;gap:8px;"><span class="k">Community</span> <span class="v">⭐ ${ratingNum.toFixed(1)}</span> <span style="color:var(--ink-mute);font-size:10px;">${reviewsStr}</span> ${ratingSignal}</div>` : ''}
            ${brickInsightsBadge}
            ${growthBadge}
            ${legoStockBadge}
            ${tagsBadge}
      `;
    }
  }

  // Phase 3: physical 'Set Facts' + 'About This Set' (Brickset extendedData).
  let setFactsHtml = '';
  let aboutHtml = '';
  {
    const b3 = set.brickset || {};
    let dim = {};
    try {
      const raw = b3.dimensions ?? set.brickset_dimensions;
      dim = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
    } catch { dim = {}; }
    if (!dim || typeof dim !== 'object') dim = {};
    const pnum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
    const dh = pnum(dim.height), dw = pnum(dim.width), dd = pnum(dim.depth), dwt = pnum(dim.weight);
    const dimsStr = (dh && dw && dd) ? `${dh} \u00d7 ${dw} \u00d7 ${dd} cm` : '';
    const weightStr = dwt ? `${dwt} kg` : '';
    // Some sources return literal placeholders like "{Not specified}" — treat
    // those (and N/A / Unknown / brace-wrapped) as empty so they don't render.
    const cleanFact = (v) => { const s = String(v ?? '').trim(); return /^\{.*\}$/.test(s) || /^:?(not specified|n\/?a|unknown|none|null|-|\/)$/i.test(s) ? '' : s; };
    const packaging = packagingLabel(cleanFact(b3.packagingType || set.packaging_type || ''));
    const instrRaw = (b3.instructionsCount != null ? b3.instructionsCount : set.instructions_count);
    const instrStr = (instrRaw != null && Number(instrRaw) > 0) ? String(instrRaw) : '';
    // Pieces intentionally omitted here — it's already in the summary facts row.
    const fact = (label, val) => val ? `<div class="detail-kv"><span class="k">${label}</span> <span class="v">${escapeHtml(String(val))}</span></div>` : '';
    if (dimsStr || weightStr || packaging || instrStr) {
      setFactsHtml = `
            ${fact('Dimensions', dimsStr)}
            ${fact('Weight', weightStr)}
            ${fact('Packaging', packaging)}
            ${fact('Instructions', instrStr)}`;
    }
    const stripHtml = (html) => String(html)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '\u2022 ')
      // Replace any remaining tag with a SPACE, not '' \u2014 an inline
      // <span>/<b>/<a> between two words otherwise fuses them ("withBuild").
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&reg;/gi, '\u00ae')
      .replace(/&trade;/gi, '\u2122').replace(/&rsquo;|&#8217;/gi, '\u2019').replace(/&lsquo;|&#8216;/gi, '\u2018')
      .replace(/&rdquo;|&#8221;/gi, '\u201d').replace(/&ldquo;|&#8220;/gi, '\u201c')
      .replace(/&mdash;|&#8212;/gi, '\u2014').replace(/&ndash;|&#8211;/gi, '\u2013')
      .replace(/&hellip;/gi, '\u2026').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
      // Generic fallback for any remaining named/numeric entity (&iacute; etc.)
      .replace(/&#?\w+;/g, (ent) => { const el = document.createElement("textarea"); el.innerHTML = ent; return el.value; })
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      // Collapse whitespace that pads a newline first, so runs like "\n \n \n"
      // (which \n{3,} misses) don't survive as a huge vertical gap in About.
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    const descr = stripHtml(b3.description || set.brickset_description || '');
    if (descr) {
      const longDesc = descr.length > 220;
      const clampStyle = longDesc ? 'display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;' : '';
      aboutHtml = `
        <div class="detail-card">
          <div class="detail-card-title">About this set</div>
          <p id="aboutText"${longDesc ? ' data-collapsed="1"' : ''} style="margin:0;font-size:13px;line-height:1.55;color:var(--ink-soft);white-space:pre-line;${clampStyle}">${escapeHtml(descr)}</p>
          ${longDesc ? `<button id="aboutToggle" type="button" style="margin-top:8px;background:none;border:none;color:var(--ink);font-weight:600;font-size:12px;cursor:pointer;padding:0;text-decoration:underline;">Show more</button>` : ''}
        </div>`;
    }
  }

  // Brickset's published guidance allows republishing official set images
  // (LEGO fair-play applies) and box scans WITH attribution — so the gallery
  // carries an explicit "courtesy of Brickset.com" credit.
  const galleryHtml = (Number(set.additional_image_count) > 0)
    ? `
      <div class="detail-card">
        <div class="detail-card-title">Photos</div>
        <div id="bsGallery" class="bs-gallery" style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch;">
          <div class="spinner" style="margin:8px auto;"></div>
        </div>
        <div class="u-mute" style="font-size:10px;margin-top:6px;">Images courtesy of <a href="https://brickset.com" target="_blank" rel="noopener noreferrer" style="color:inherit;">Brickset.com</a></div>
      </div>`
    : '';

  const aiDisclaimerHTML = set.valuation_method === "ai"
    ? `<div class="bv-banner bv-banner--neutral" role="note">${kitIcon("alert", { size: 20 })}<span class="bv-banner__text">AI-estimated price — may vary from market.</span></div>`
    : '';

  const minifigsCard = set.set_minifigs?.length ? `
      <div class="detail-card">
        <div class="detail-card-title">Minifigs in this set</div>
        <div class="fig-strip">
          ${set.set_minifigs.map(f => `
            <div class="fig-strip-item" title="${escapeHtml(f.fig_name || f.fig_num)}">
              ${f.fig_img_url
                ? `<img src="${escapeHtml(proxyImg(f.fig_img_url))}" alt="${escapeHtml(f.fig_name || '')}" loading="lazy" decoding="async" data-fig-ph data-fig-name="${escapeHtml(f.fig_name || '')}">`
                : `<div class="fig-ph">${figAvatarSVG(String(f.fig_num), String(f.fig_name || ''))}</div>`}
              <div class="fig-strip-meta">
                <div class="fig-strip-name">${escapeHtml(f.fig_name || 'Minifig')}${f.quantity > 1 ? ` <span>×${f.quantity}</span>` : ''}</div>
                <div class="fig-strip-num">${escapeHtml(f.fig_num)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : '';

  const externalLinks = `
    <div class="bv-setlinks">
      <a class="bl-buy-link bv-btn bv-btn--text" href="${bricklinkBuyURL(set.set_num)}" target="_blank" rel="noopener">${t('market.viewOnBrickLink')}${kitIcon("ext", { size: 18 })}</a>
      <a class="bl-buy-link bv-btn bv-btn--text" href="https://www.google.com/search?q=LEGO+${encodeURIComponent(set.set_num)}+building+instructions+PDF" target="_blank" rel="noopener">Building instructions (PDF)${kitIcon("ext", { size: 18 })}</a>
    </div>`;

  return `
    ${overviewRowsHTML(set, entry)}
    ${isSimpleMode() ? '' : aiDisclaimerHTML}
    ${(bricksetHtml.trim() || setFactsHtml.trim()) ? `
      <div class="detail-card bv-setfacts">
        <div class="detail-card-title">Details</div>
        <div class="detail-kv-grid">${bricksetHtml}${setFactsHtml}</div>
      </div>` : ''}
    ${aboutHtml}
    ${minifigsCard}
    ${galleryHtml}
    ${externalLinks}`;
}

function wireInfoTab(set) {
  loadSetImages(set.set_num);
  hydrateAmazonSlots(document, state.me?.retail_market || 'FR');

  // The set description is catalog DATA, not UI copy — a unique paragraph per
  // set — so the exact-match dictionary can never carry it. Fetch a translation
  // for the active language and swap it in after paint. Deliberately
  // non-blocking and silent on failure: the English text is already on screen,
  // and a set page must not wait on (or break because of) a model call.
  (async () => {
    const p = $("#aboutText");
    if (!p) return;
    const lang = getLocale();
    if (!lang || lang === 'en') return;
    try {
      const r = await api(`/api/sets/${encodeURIComponent(set.set_num)}/description?lang=${encodeURIComponent(lang)}`);
      const text = String(r?.description || '').trim();
      // Only replace when the server actually returned the other language;
      // it falls back to English whenever translation is unavailable.
      if (text && r?.lang === lang && text !== p.textContent.trim()) p.textContent = text;
    } catch { /* English stays — a missing translation is not worth an error */ }
  })();

  // Minifig strip: a dead fig photo (Rebrickable has no file for some rare /
  // exclusive figs) swaps to the fig's mystery-minifig avatar — same
  // character everywhere that fig appears, no broken-image icon, no empty
  // gap. The /api/img proxy answers definitive upstream 404s with a
  // transparent 1×1 GIF, which LOADS fine — so also treat a 1×1 natural
  // size as "no real photo".
  $$(".fig-strip-item img[data-fig-ph]").forEach(img => {
    const toPlaceholder = () => {
      const item = img.closest(".fig-strip-item");
      if (!item || item.querySelector(".fig-ph")) return;
      const ph = document.createElement("div");
      ph.className = "fig-ph";
      const seed = img.dataset.figPh || item.getAttribute("data-fig") || "";
      const label = img.dataset.figName || item.getAttribute("aria-label") || "";
      ph.innerHTML = figAvatarSVG(seed, String(label));
      img.replaceWith(ph);
    };
    img.addEventListener("error", toPlaceholder);
    img.addEventListener("load", () => {
      if (img.naturalWidth <= 2) toPlaceholder();
    });
  });

  const aboutBtn = $("#aboutToggle");
  aboutBtn?.addEventListener("click", () => {
    const p = $("#aboutText");
    if (!p) return;
    const collapsed = p.dataset.collapsed === "1";
    if (collapsed) {
      p.style.display = "block";
      p.style.webkitLineClamp = "unset";
      p.dataset.collapsed = "0";
      aboutBtn.textContent = "Show less";
    } else {
      p.style.display = "-webkit-box";
      p.style.webkitLineClamp = "5";
      p.dataset.collapsed = "1";
      aboutBtn.textContent = "Show more";
    }
    haptic("light");
  });
}

// Hero wishlist heart + the bottom bar. Sheet triggers ([data-set-sheet]) and
// community contributions ([data-contrib]) are delegated in ensureDetailDelegation.
function wireDetailActions(set, entry) {
  wireBarActions(set);
  $("#wishToggle")?.addEventListener("click", async () => {
    const wishKey = 'wish_' + set.set_num;
    if (state.pendingRequests.has(wishKey)) return;
    state.pendingRequests.add(wishKey);
    haptic("medium");
    const alreadyWished = state.wishlist.some(w => w.set_num === set.set_num);
    try {
      if (alreadyWished) {
        const w = state.wishlist.find(x => x.set_num === set.set_num);
        if (w) await api("/api/wishlist/" + w.id, { method: "DELETE" });
        state.wishlist = state.wishlist.filter(x => x.set_num !== set.set_num);
        state.recentWishlistDeletes[set.set_num] = Date.now();
        refreshNavBadge();
        toast("Removed from wishlist", "info");
        paintSetDetail(set, entry);
      } else {
        openAddWishlistSheet(set, async (targetPriceUSD, notes) => {
          try {
            const created = await api("/api/wishlist", {
              method: "POST",
              body: { set_num: set.set_num, target_price: targetPriceUSD, notes: notes || null }
            });
            state.wishlist = [
              { ...set, ...(created.item || {}), set_num: set.set_num, target_price: targetPriceUSD, notes: notes || null },
              ...state.wishlist.filter(w => w.set_num !== set.set_num)
            ];
            delete state.recentWishlistDeletes[set.set_num];
            refreshNavBadge();
            // Keep the previous array readable until the refetch resolves —
            // nulling it here would crash any concurrent `state.wishlist.some(...)`.
            try {
              const wl = await api("/api/wishlist");
              state.wishlist = wl.wishlist || [];
              state.wishlistAlerts = wl.unread_alerts || state.wishlistAlerts;
              refreshNavBadge();
            } catch {}
            toast("Added to wishlist", "success");
            paintSetDetail(set, entry);
          } catch (err) {
            toast(t('common.errorWithDetails', { error: err.message || err }), "error");
          }
        });
      }
    } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
    finally { state.pendingRequests.delete(wishKey); }
  });
}

function wireBarActions(set) {
  $("#addBtn")?.addEventListener("click", async (e) => {
    if (state.pendingRequests.has(set.set_num)) return;
    state.pendingRequests.add(set.set_num);
    haptic("heavy");
    setBtnLoading(e.currentTarget, true);
    try {
      const addResult = await api("/api/collection", { method: "POST", body: { set_num: set.set_num, quantity: 1 } });
      invalidatePortfolio(); state.catalog.items = []; markSetOwned(set.set_num, true);
      toast("Added to vault", "success");
      if (isKidsMode() && addResult?.kids?.xp_gained > 0) {
        const { xp_gained, new_level, new_badges } = addResult.kids;
        // A new badge or level-up is a real win — give it the celebration popup
        // (kid-friendly copy). Routine XP stays a quick toast.
        const badge = new_badges?.[0];
        const xpToast = badge
          ? kidsXpMessage(xp_gained, { level: new_level, badge: kidsBadgeLabel(badge) })
          : kidsXpMessage(xp_gained, { level: new_level });
        setTimeout(() => toast(xpToast, "success"), 500);
        const kidHue = setHue(set);
        if (badge) setTimeout(() => celebrate(t('kids.badgeCelebration', { badge: kidsBadgeLabel(badge) }), { quip: t('kids.badgeQuip'), hue: kidHue }), 900);
        else if (new_level) setTimeout(() => celebrate(t('kids.levelCelebration', { level: new_level }), { quip: t('kids.levelQuip'), hue: kidHue }), 900);
        state.me = null;
      }
      // Portfolio count/value milestones (skipped in Kids mode inside the helper).
      await maybeCelebrateMilestone(setHue(set));
      const r = await api("/api/sets/" + encodeURIComponent(set.set_num));
      state.detail.cache[set.set_num] = { set: r.set || r, entry: r.entry || null, ts: Date.now() };
      paintSetDetail(r.set || r, r.entry || null);
    } catch (e) {
      setBtnLoading($("#addBtn"), false);
      if (!navigator.onLine) {
        outboxEnqueue({ path: '/api/collection', method: 'POST', body: { set_num: set.set_num, quantity: 1 } });
        toast('Saved offline — will sync when connected', 'info');
      } else { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
    } finally { state.pendingRequests.delete(set.set_num); }
  });
}

// Honesty rules: only a real 2-year projection renders (no fabricated default
// growth bars, and the 5-year horizon is gone — nobody can forecast LEGO prices
// 5 years out and pretending otherwise erodes trust in every other number).
function forecastTabHTML(set) {
  const forecast = set.valuation?.read_enabled ? set.valuation?.forecast : null;
  const baseline = Number(forecast?.base_value) || Number(set.valuation?.new?.fair_value) || Number(set.current_value) || 0;
  const projection = Number(forecast?.base) || Number(set.forecast_2y) || 0;
  const hasForecast = (forecast?.status === 'ready' || forecast?.status === 'external') && projection > 0 && baseline > 0;
  const g2 = hasForecast ? (projection - baseline) / baseline : null;
  // Annualized (CAGR) rate — clearer than the total projected % above.
  const ann2 = hasForecast ? Math.pow(projection / baseline, 1 / 2) - 1 : null;
  const pct = (g) => Math.min(100, Math.max(8, g * 100 + 12)).toFixed(1);
  const forecastLabel = set.valuation_method === "ai" ? "AI forecast"
    : (set.valuation_method === "market" || set.valuation_method === "brickeconomy" || set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold") ? "Market forecast"
    : "Estimated";
  const conflictNote = set.be_growth_12m != null && Number(set.be_growth_12m) < 0 && g2 != null && g2 > 0
    ? `<p class="forecast-note">Short-term growth is negative, but the long-range forecast can still be positive when retirement timing, theme demand, or comparable older sets point upward. Treat this as a recovery scenario, not a current momentum signal.</p>`
    : "";
  return `
    <div class="detail-card">
      <div class="detail-card-title">${I.sparkles()}${forecastLabel}</div>
      <p style="margin:6px 0 0;font-size:13px;color:var(--ink-soft);line-height:1.45;">
        ${(set.valuation_method === "market" || set.valuation_method === "brickeconomy" || set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold")
          ? "Based on recent sales and long-term market trends."
          : `Based on theme rarity, piece count, retirement status, and market trends for similar ${escapeHtml(set.theme || "")} sets.`}
      </p>
      ${set.be_growth_12m != null ? `<p style="margin:8px 0 0;font-size:12px;color:var(--ink-soft);">Past year: <strong style="color:${set.be_growth_12m >= 0 ? 'var(--up)' : 'var(--down)'};">${set.be_growth_12m >= 0 ? t('detail.up', { pct: Math.abs(Number(set.be_growth_12m)).toFixed(1) }) : t('detail.down', { pct: Math.abs(Number(set.be_growth_12m)).toFixed(1) })}</strong></p>` : ''}
      ${conflictNote}
    </div>

    ${hasForecast ? `
    <div class="forecast-card">
      <div class="fh">
        <div class="fh-lbl">2-year projection</div>
        <div class="fh-val">~${fmtMoney(projection)}</div>
      </div>
      <div class="forecast-bar"><div style="--fill:${pct(g2)}%;"></div></div>
      <div class="forecast-pct${g2 < 0 ? " down" : ""}">${g2 >= 0 ? I.arrowU() : I.arrowD()}${fmtPct(g2)} projected${ann2 != null ? ` · ${fmtPct(ann2)}/yr` : ''}</div>
    </div>` : `
    <div class="detail-card">
      <div class="detail-card-title">2-year projection</div>
      <p style="margin:6px 0 0;font-size:13px;color:var(--ink-mute);line-height:1.45;">${escapeHtml(forecast?.methodology || 'No projection yet - it appears after at least 180 days and 12 history points.')}</p>
    </div>`}

    <div class="detail-card" style="background:var(--surface-2);">
      <div class="detail-card-title">What drives this</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--ink-soft);line-height:1.55;">
        <li>${set.retired ? "Retired — supply is fixed" : "Active — value tied to retail"}</li>
        <li>${(set.pieces||0) > 2000 ? "Large set, high collector appeal" : (set.pieces||0) > 500 ? "Mid-size set, moderate appeal" : "Compact set, lower aftermarket premium"}</li>
        <li>${(set.minifigs||0) >= 5 ? "Many minifigs — strong parts-out potential" : "Few/no minifigs — value driven by set alone"}</li>
      </ul>
      <p style="margin:10px 0 0;font-size:11px;color:var(--ink-mute);line-height:1.45;">Projections extrapolate current trends and can be wrong — collectible prices depend on future demand nobody can predict. Not financial advice.</p>
    </div>`;
}

// Market evidence behind the headline value (the old "Pricing details" sheet),
// now shown in the "Why $X?" sheet.
function pricingDetailsHTML(set, entry) {
  if (set.coming_soon) return investmentPricingDetailHTML(set);
  return `${set.valuation?.read_enabled ? investmentPricingDetailHTML(set) : ""}
    ${dealSignalHTML(set)}
    ${priceStripHTML(set, entry)}
    ${marketSpreadHTML(set)}
    ${soldEvidenceHTML(set)}
    ${marketDepthHTML(set)}
    ${partOutHTML(set)}
    ${recentlySoldHTML(set)}
    ${marketConfidenceHTML(set)}`;
}

function recentlySoldHTML(set) {
  const ebaySold = ebaySoldSummary(set);
  const ebayPrice = ebaySold.newValue || 0;
  const ebayUsedPrice = ebaySold.usedValue || 0;
  const retailPrice = set.retail_price || 0;
  if (!(ebayPrice > 0 || ebayUsedPrice > 0)) return "";
  const pricingTreatment = (retailPrice > 0 && ebayPrice > 0 && ebayPrice < retailPrice) ? 'STP' : (retailPrice > 0 && ebayPrice > retailPrice ? 'APPRECIATED' : 'NONE');
  const newQty = ebaySold.newSampleCount ? tPlural('market.salesSuffix', ebaySold.newSampleCount) : '';
  const usedQty = ebaySold.usedSampleCount ? tPlural('market.salesSuffix', ebaySold.usedSampleCount) : '';
  return `
    <div class="detail-card pricing-summary-card">
      <div class="detail-card-title" style="justify-content:space-between;">
        <span>Recently sold</span>
        <span class="badge" style="font-size:12px; padding:2px 6px; border-radius:4px; font-family:var(--mono); background:var(--surface-3); color:var(--ink-soft);">${ebaySold.legacy ? 'Legacy' : pricingTreatment === 'STP' ? 'Below MSRP' : pricingTreatment === 'APPRECIATED' ? 'Appreciated' : 'Sold data'}</span>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
        <div>
          <div style="font-size:12px; font-family:var(--mono); color:var(--ink-mute); margin-bottom:2px; text-transform:uppercase;">${t('market.newSold')}${newQty}</div>
          <div style="font-size:18px; font-weight:600; color:var(--ink);">${ebayPrice > 0 ? fmtMoney(ebayPrice) : "Pending"}</div>
        </div>
        <div>
          <div style="font-size:12px; font-family:var(--mono); color:var(--ink-mute); margin-bottom:2px; text-transform:uppercase;">${t('market.usedSold')}${usedQty}</div>
          <div style="font-size:16px; font-weight:500; color:var(--ink-soft);">${ebayUsedPrice > 0 ? fmtMoney(ebayUsedPrice) : "Pending"}</div>
        </div>
      </div>
      ${retailPrice > 0 && ebayPrice > 0 ? `
        <div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line-soft);margin-top:10px;padding-top:10px;font-size:13px;">
          <span style="color:var(--ink-mute);">Retail MSRP</span>
          <strong style="color:var(--ink-soft);">${fmtMoney(retailPrice)}</strong>
        </div>` : ''}
      ${!ebaySold.legacy && pricingTreatment === 'STP' ? `
        <div style="font-size:13px; color:var(--down); margin-top:10px;">${t('market.compsBelowMsrp', { amount: fmtMoney(retailPrice - ebayPrice), pct: fmtPct((retailPrice - ebayPrice) / retailPrice) })}</div>`
      : !ebaySold.legacy && pricingTreatment === 'APPRECIATED' ? `
        <div style="font-size:13px; color:var(--up); margin-top:10px;">${t('market.compsAboveMsrp', { amount: fmtMoney(ebayPrice - retailPrice), pct: fmtPct((ebayPrice - retailPrice) / retailPrice) })}</div>`
      : ebaySold.legacy ? `
        <div style="font-size:13px; color:var(--ink-mute); margin-top:10px; line-height:1.4;">Legacy single-value data is shown until the latest sold comps refresh this set.</div>` : ''}
    </div>`;
}

/* ---------------------------------------------------------------- Price history tab */
const HISTORY_RANGES = [[90, "bvSet.range3m"], [365, "bvSet.range1y"], [1825, "bvSet.rangeAll"]];
let _historyDays = 365;

function historyTabHTML(set) {
  const v = setDisplayValue(set);
  const sold = isSimpleMode() ? "" : soldEvidenceHTML(set);
  return `<div class="bv-sethistory">
    ${kitSeg(HISTORY_RANGES.map(([days, key]) => ({ label: t(key), value: String(days), current: days === _historyDays })), { label: t("bvSet.historyRange"), id: "historyRange", cls: "bv-sethistory__range" })}
    <section class="bv-card bv-histcard" aria-label="${escapeHtml(t("bvSet.tabHistory"))}">
      <div class="bv-histcard__head"><span class="bv-num bv-histcard__value">${v > 0 ? escapeHtml(money0(v)) : "—"}</span><span id="histDelta"></span></div>
      <p class="bv-label spark-movement" id="setMovementSummary" hidden></p>
      <div class="bv-chart no-tab-swipe"><div class="spark-wrap" id="setSpark"></div><span class="bv-chart__mark" id="histBought" hidden><span class="bv-chart__marklabel"></span></span></div>
      <div class="spark-legend" id="setSparkLegend"></div>
    </section>
    ${sold ? `<h2 class="bv-h2">${escapeHtml(t("bvSet.recentSales"))}</h2><div class="bv-setsection">${sold}</div>` : ""}
    ${isSimpleMode() || isKidsMode() || !set.valuation?.read_enabled ? "" : `<div class="bv-setsection">${investmentPricingHTML(set)}</div>`}
    ${isSimpleMode() ? "" : `<div class="bv-setsection">${forecastTabHTML(set)}</div>`}
  </div>`;
}

function wireHistoryTab(set, entry) {
  loadSetHistory(set.set_num, _historyDays, entry);
  $$("#historyRange [data-value]").forEach(b => b.addEventListener("click", () => {
    const days = Number(b.dataset.value);
    if (days === _historyDays) return;
    _historyDays = days;
    haptic("light");
    $$("#historyRange [data-value]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    loadSetHistory(set.set_num, days, entry);
  }));
}

/* ---------------------------------------------------------------- bottom bar */
function paintSetBar(set, entry, tab) {
  const host = $("#setBar");
  if (!host) return;
  host.innerHTML = setBarHTML(set, entry, tab);
  wireBarActions(set);
}

function manageTabHTML(set, entry) {
  if (!entry) return `<p class="bv-foot">Not in your vault.</p>`;
  return `
    <div class="manage-tab bv-passport__body">
      <section class="bv-passport__photos" aria-label="${escapeHtml(t("bvSet.yourPhotos"))}">
        <div class="bv-photostrip no-tab-swipe">
          ${entry.custom_image_url ? `<span class="bv-photostrip__item"><img id="customPhotoImg" alt="${escapeHtml(t("bvSet.yourPhoto"))}"></span>` : ""}
          <button type="button" class="bv-photostrip__add" id="photoUploadBtn" aria-label="${escapeHtml(t(entry.custom_image_url ? "bvSet.replacePhoto" : "bvSet.addPhoto"))}">${kitIcon(entry.custom_image_url ? "refresh" : "plus")}</button>
        </div>
        <input type="file" id="photoUpload" accept="image/jpeg,image/png,image/webp" hidden>
        ${entry.custom_image_url ? `<button type="button" id="removePhotoBtn" class="bv-btn bv-btn--danger bv-btn--sm">${escapeHtml(t("bvSet.removePhoto"))}</button>` : ""}
        <div id="photoUploadStatus" class="bv-field__help" hidden></div>
      </section>
    ${isGuestMode() ? "" : `
      <h2 class="bv-h2">${escapeHtml(t("bvSet.memories"))}</h2>
      <section class="bv-card" id="storyCard">
        <div id="storyTimeline" class="bv-story" aria-live="polite">${escapeHtml(t("common.loading"))}</div>
        <div class="bv-field"><label class="bv-sr" for="storyInput">${escapeHtml(t("bvSet.addMemory"))}</label>
          <div class="bv-field__box"><input id="storyInput" type="text" maxlength="1000" placeholder="${escapeHtml(t("bvSet.memoryPlaceholder"))}"></div></div>
        <div class="bv-btn-row">
          <button type="button" class="bv-btn bv-btn--text" id="storyAddNote">${kitIcon("plus", { size: 20 })}<span>${escapeHtml(t("bvSet.addMemory"))}</span></button>
          <button type="button" class="bv-btn bv-btn--text" id="storyAddPhoto">${kitIcon("camera", { size: 20 })}<span>${escapeHtml(t("bvSet.addPhoto"))}</span></button>
          <input type="file" id="storyPhotoInput" accept="image/jpeg,image/png,image/webp" hidden>
        </div>
      </section>`}
      <h2 class="bv-h2">${escapeHtml(t("bvSet.details"))}</h2>
      <div class="manage-save-bar">
        <span class="manage-save-copy"><strong>Set details</strong><small>Changes save automatically</small></span>
        <span id="manageSaveState" class="badge badge--neutral" aria-live="polite" style="visibility:hidden;">Saved ✓</span>
      </div>
      <fieldset class="form-group manage-group">
        <legend>Purchase</legend>
        <p class="manage-group-description">Record what you paid and where this set joined your collection.</p>
        <div class="manage-field-grid">
          <div class="field">
            <label class="field-lbl" for="mPrice">Purchase price</label>
            <input id="mPrice" type="number" step="0.01" value="${moneyInputValue(entry.purchase_price)}" placeholder="0.00" inputmode="decimal" autocomplete="off">
            <div class="field-err" id="mPriceErr"></div>
          </div>
          <div class="field">
            <label class="field-lbl" for="mDate">Purchase date</label>
            <input id="mDate" type="date" value="${entry.purchased_at ? entry.purchased_at.slice(0,10) : ""}">
          </div>
          <div class="field">
            <label class="field-lbl" for="mAcquisition">Acquisition source</label>
            <select id="mAcquisition">
              <option value="" ${!entry.acquisition_source ? "selected" : ""}>— select —</option>
              ${["Store","BrickLink","eBay","Facebook Marketplace","Trade","Gift","Other"].map(s =>
                `<option value="${s}" ${entry.acquisition_source === s ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </div>
        </div>
      </fieldset>
      <fieldset class="form-group manage-group">
        <legend>Condition</legend>
        <p class="manage-group-description">Track the copy’s condition and whether any pieces are missing.</p>
        <div class="manage-field-grid">
          <div class="field">
            <label class="field-lbl" for="mCondition">Condition</label>
            <select id="mCondition">
              <option value="sealed" ${entry.condition === "sealed" ? "selected" : ""}>Sealed (MISB)</option>
              <option value="new" ${entry.condition === "new" ? "selected" : ""}>New, opened</option>
              <option value="used_good" ${entry.condition === "used_good" ? "selected" : ""}>Used — good</option>
              <option value="used_acceptable" ${entry.condition === "used_acceptable" ? "selected" : ""}>Used — acceptable</option>
            </select>
          </div>
          <div class="field">
            <div class="field-lbl">Completeness</div>
            <div class="completeness-row">
              <label><input type="checkbox" id="mComplete" ${entry.is_complete !== false ? "checked" : ""}>Complete / all pieces present</label>
            </div>
            <div class="missing-pieces-wrap" id="missingWrap" style="${entry.is_complete === false ? "" : "display:none;"}">
              <label for="mMissing" style="font-size:13px;color:var(--ink-mute);">pieces missing</label>
              <input type="number" id="mMissing" min="0" value="${entry.missing_pieces || 0}" placeholder="0">
            </div>
          </div>
        </div>
      </fieldset>
      <fieldset class="form-group manage-group">
        <legend>Storage &amp; notes</legend>
        <p class="manage-group-description">Make this set easy to find and add private context for later.</p>
        <div class="manage-field-grid">
          <div class="field">
            <label class="field-lbl" for="mStorage">Storage location</label>
            <input id="mStorage" type="text" value="${escapeHtml(entry.storage_location || "")}" placeholder="e.g. Display shelf A3, Attic box 2" list="storageLocations">
            <datalist id="storageLocations"></datalist>
          </div>
          <div class="field">
            <label class="field-lbl" for="mNotes">Notes</label>
            <textarea id="mNotes" placeholder="Story, details, anything…">${escapeHtml(entry.notes || "")}</textarea>
          </div>
        </div>
      </fieldset>
    <div class="detail-card" id="partsCard">
      <div class="detail-card-title" style="justify-content:space-between;">
        <span>Parts completeness</span>
        <button class="btn-secondary" id="loadPartsBtn" style="font-size:11px;padding:4px 10px;">Refresh parts</button>
      </div>
      <div id="partsContent" style="font-size:13px;color:var(--ink-mute);line-height:1.45;">
        Compares the official parts list with missing pieces you mark for this set. 100% means no missing parts are recorded.
      </div>
    </div>
    <details class="detail-card bv-passport__flip" ${entry.purchase_price ? "open" : ""}>
      <summary class="u-mono-label" style="cursor:pointer;list-style-position:inside;">Flip calculator</summary>
      <div id="mFlipCalcContainer">${flipCalcHTML(set, entry)}</div>
    </details>
      ${sellTimingHTML(set, entry)}
      <div class="manage-sale-actions bv-btn-row">
        <button type="button" class="bv-btn bv-btn--outline" id="mSold">${kitIcon("tag", { size: 20 })}<span>${escapeHtml(t("bvSet.sellTitle"))}</span></button>
        <button type="button" class="bv-btn bv-btn--outline" id="mListSale">${kitIcon("wand", { size: 20 })}<span>${escapeHtml(t("bvSet.draftListing"))}</span></button>
      </div>
      <section class="manage-danger-zone" aria-labelledby="manageDangerTitle">
        <div>
          <h3 id="manageDangerTitle">Remove from vault</h3>
          <p>Deletes this holding from your vault after confirmation.</p>
        </div>
        <button type="button" class="bv-btn bv-btn--danger" id="mRemove">${kitIcon("trash", { size: 20 })}<span>Remove from vault</span></button>
      </section>
    </div>`;
}

// Sell-timing read for this holding: conservative 'sell' | 'watch' | 'hold'
// with the reasons spelled out. Pure logic lives in computeSellSignal.
function sellSignalFor(set, entry) {
  return computeSellSignal({
    purchasePrice: entry?.purchase_price,
    currentValue: marketValueForCondition(set, entry?.condition || "new"),
    retired: !!set.retired,
    forecast2y: set.forecast_2y,
    trend: set.trend?.trend,
    slopePctPerWeek: set.trend?.slope_pct_per_week,
    salesVolume: set.pc_sales_volume,
  });
}

export function localizedSellReasons(reasons = []) {
  return reasons.map(({ id, vars = {} }) => {
    switch (id) {
      case 'gainSincePurchase': return t('detail.sellReasonGainSincePurchase', { roi: fmtPct(vars.roiPct / 100) });
      case 'trendDown': return t('detail.sellReasonTrendDown');
      case 'climbFlattened': return t('detail.sellReasonClimbFlattened');
      case 'littleUpside': return t('detail.sellReasonLittleUpside', { upside: fmtPct(vars.upsidePct / 100) });
      case 'sellsFast': return tPlural('detail.sellReasonSellsFast', vars.salesVolume, { volume: vars.salesVolume });
      case 'watchClosely': return t('detail.sellReasonWatchClosely');
      case 'stillClimbing': return t('detail.sellReasonStillClimbing');
      case 'forecastUpside': return t('detail.sellReasonForecastUpside', { upside: fmtPct(vars.upsidePct / 100) });
      case 'notRetired': return t('detail.sellReasonNotRetired');
      case 'noSellTrigger': return t('detail.sellReasonNoSellTrigger');
      default: return t('detail.sellReasonNoSellTrigger');
    }
  });
}

function sellTimingHTML(set, entry) {
  // Investment-flavored read — hidden in simple and kids modes, like the rest
  // of the investor toolkit.
  if (isSimpleMode() || isKidsMode()) return "";
  const s = sellSignalFor(set, entry);
  if (!s) return "";
  const look = {
    sell: { label: "Good time to sell", color: "var(--up)" },
    watch: { label: "Worth watching", color: "var(--accent)" },
    hold: { label: "Hold", color: "var(--ink-mute)" },
  }[s.signal];
  return `
    <div class="detail-card" style="margin-top:14px;">
      <div class="detail-card-title" style="justify-content:space-between;">
        <span>Sell timing</span>
        <span class="badge" style="background:${look.color};color:#fff;">${look.label}</span>
      </div>
      <div style="font-size:12px;color:var(--ink-mute);line-height:1.5;">${escapeHtml(localizedSellReasons(s.reasons).join(" · "))}</div>
    </div>`;
}

// Story timeline: the set's memories (notes + photos) plus the automatic
// lifecycle events. Signed-in only — stories live on the account.
async function wireStoryCard(_set, entry) {
  const timeline = $("#storyTimeline");
  if (!timeline || !entry?.id) return;

  const render = (stories) => {
    const items = stories.map(s => `
      <div class="story-item bv-story__item" data-story="${s.id}">
        <div class="bv-story__text">
          ${s.kind === "photo" ? `<img class="story-photo" data-story-photo="${s.id}" alt="">` : ""}
          ${s.body ? `<p>${escapeHtml(s.body)}</p>` : ""}
          <span class="bv-story__date">${escapeHtml(t("bvSet.memoryAdded", { date: String(s.created_at || "").slice(0, 10) }))}</span>
        </div>
        <button type="button" class="bv-iconbtn story-del" data-story-del="${s.id}" aria-label="Delete memory">${kitIcon("x", { size: 18 })}</button>
      </div>`).join("");
    const auto = `<div class="bv-story__auto">${kitIcon("check", { size: 16 })}<span>${entry.purchased_at
      ? escapeHtml(t('detail.acquired', { date: String(entry.purchased_at).slice(0, 10), source: entry.acquisition_source ? ` · ${entry.acquisition_source}` : '' }))
      : escapeHtml(t('detail.inVault'))}</span></div>`;
    timeline.innerHTML = (items || `<p class="bv-story__empty">${escapeHtml(t("bvSet.noMemories"))}</p>`) + auto;

    timeline.querySelectorAll("[data-story-photo]").forEach(img => {
      customPhotoObjectURL(`/api/collection/story/${img.dataset.storyPhoto}/photo`).then(url => { if (url) img.src = url; });
    });
    timeline.querySelectorAll("[data-story-del]").forEach(btn => btn.addEventListener("click", async () => {
      haptic("light");
      try {
        await api(`/api/collection/story/${btn.dataset.storyDel}`, { method: "DELETE" });
        btn.closest(".story-item")?.remove();
      } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
    }));
  };

  const load = async () => {
    try {
      const r = await api(`/api/collection/${entry.id}/story`);
      render(r.stories || []);
    } catch { timeline.innerHTML = `<p class="bv-story__empty">${escapeHtml(t("bvSet.storyUnavailable"))}</p>`; }
  };
  await load();

  $("#storyAddNote")?.addEventListener("click", async () => {
    const input = $("#storyInput");
    const body = (input?.value || "").trim();
    if (!body) { toast("Write the memory first", "info"); return; }
    haptic("medium");
    try {
      await api(`/api/collection/${entry.id}/story`, { method: "POST", body: { body } });
      if (input) input.value = "";
      toast("Memory saved", "success");
      load();
    } catch (e) { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
  });
  $("#storyAddPhoto")?.addEventListener("click", () => $("#storyPhotoInput")?.click());
  $("#storyPhotoInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    haptic("medium");
    try {
      const form = new FormData();
      form.append("photo", file);
      const caption = ($("#storyInput")?.value || "").trim();
      if (caption) form.append("body", caption);
      const accessToken = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + `/api/collection/${entry.id}/story`, {
        method: "POST",
        headers: accessToken ? { Authorization: "Bearer " + accessToken } : {},
        body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const input = $("#storyInput");
      if (input) input.value = "";
      toast("Photo added to the story", "success");
      load();
    } catch (err) { toast(t('common.errorWithDetails', { error: err.message || err }), "error"); }
  });
}

function wireManageTab(set, entry) {
  if (!entry) return;

  if (!isGuestMode()) wireStoryCard(set, entry);

  const container = $("#mFlipCalcContainer");
  if (container) {
    wireFlipCalc(set, entry, container);
  }

  // Populate storage-location datalist from existing collection locations
  const dl = $("#storageLocations");
  if (dl && state.portfolio?.items) {
    const locs = [...new Set((state.portfolio.items).map(i => i.storage_location).filter(Boolean))];
    dl.innerHTML = locs.map(l => `<option value="${escapeHtml(l)}">`).join("");
  }

  function updateLocalFlip() {
    const priceVal = $("#mPrice")?.value || "";
    const condVal = $("#mCondition")?.value || "new";
    const tempEntry = { ...entry, purchase_price: optionalMoneyInput(priceVal) ?? 0, condition: condVal };
    const container = $("#mFlipCalcContainer");
    if (container) {
      container.innerHTML = flipCalcHTML(set, tempEntry);
      wireFlipCalc(set, tempEntry, container);
    }
  }

  // Persistent status chip beats a transient toast for silent blur-saves —
  // the user can always see whether their last edit landed.
  function setSaveState(label, tone) {
    const el = $("#manageSaveState");
    if (!el) return;
    el.style.visibility = "visible";
    el.textContent = label;
    el.className = `badge badge--${tone}`;
  }

  async function persist() {
    setSaveState("Saving…", "neutral");
    try {
      const isComplete = $("#mComplete")?.checked ?? true;
      await api("/api/collection/" + entry.id, {
        method: "PATCH",
        body: {
          purchase_price: optionalMoneyInput($("#mPrice")?.value),
          purchased_at: $("#mDate")?.value || null,
          condition: $("#mCondition")?.value,
          notes: $("#mNotes")?.value || "",
          storage_location: $("#mStorage")?.value || null,
          acquisition_source: $("#mAcquisition")?.value || null,
          is_complete: isComplete,
          missing_pieces: isComplete ? 0 : (parseInt($("#mMissing")?.value) || 0),
        }
      });
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      setSaveState("Saved ✓", "up");
    } catch (e) {
      setSaveState("Save failed — retry", "down");
      toast(t('common.errorWithDetails', { error: e.message || e }), "error");
    }
  }

  // Toggle missing-pieces input when completeness changes
  $("#mComplete")?.addEventListener("change", e => {
    const w = $("#missingWrap");
    if (w) w.style.display = e.target.checked ? "none" : "";
    persist();
  });

  ["#mPrice","#mDate","#mStorage","#mMissing"].forEach(s => $(s)?.addEventListener("blur", persist));
  ["#mCondition","#mAcquisition"].forEach(s => $(s)?.addEventListener("change", persist));
  $("#mNotes")?.addEventListener("blur", persist);

  $("#mPrice")?.addEventListener("input", updateLocalFlip);
  $("#mCondition")?.addEventListener("change", updateLocalFlip);

  $("#mRemove")?.addEventListener("click", async () => {
    if (!(await confirmSheet({ title: "Remove from vault?", message: "This set will be removed from your vault.", confirmLabel: "Remove", danger: true }))) return;
    haptic("heavy");
    try {
      const restore = {
        set_num: set.set_num, quantity: entry.quantity || 1,
        condition: entry.condition || undefined, purchase_price: entry.purchase_price ?? undefined,
        purchased_at: entry.purchased_at || undefined, notes: entry.notes || undefined,
      };
      await api("/api/collection/" + entry.id, { method: "DELETE" });
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      undoToast("Removed from vault", async () => {
        try {
          await api("/api/collection", { method: "POST", body: restore });
          invalidatePortfolio(); markSetOwned(set.set_num, true);
          toast("Restored to vault", "success");
        } catch { toast("Couldn't restore — add it again from the catalog.", "error"); }
      });
      go("#/");
    } catch (e) {
      if (!navigator.onLine && entry?.id) {
        outboxEnqueue({ path: '/api/collection/' + entry.id, method: 'DELETE' });
        invalidatePortfolio();
        toast('Removed offline — will sync when connected', 'info');
        go("#/");
      } else { toast(t('common.errorWithDetails', { error: e.message || e }), "error"); }
    }
  });
  $("#mSold")?.addEventListener("click", () => openSellOptionsSheet(set, entry));
  $("#mListSale")?.addEventListener("click", () => go(`#/set/${encodeURIComponent(set.set_num)}/listing`));

  // Photo upload
  if (entry.custom_image_url) {
    customPhotoObjectURL(entry.custom_image_url).then(url => {
      const img = $("#customPhotoImg");
      if (img && url) img.src = url;
    });
  }
  $("#photoUploadBtn")?.addEventListener("click", () => $("#photoUpload")?.click());
  $("#photoUpload")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const statusEl = $("#photoUploadStatus");
    if (statusEl) { statusEl.textContent = "Uploading…"; statusEl.hidden = false; }
    try {
      const form = new FormData();
      form.append("photo", file);
      const accessToken = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/collection/" + entry.id + "/photo", {
        method: "POST",
        headers: accessToken ? { Authorization: "Bearer " + accessToken } : {},
        body: form,
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || res.statusText); }
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      toast("Photo uploaded", "success");
      await paintSetDetail(set, { ...entry, custom_image_url: "/api/collection/" + entry.id + "/photo" });
    } catch (err) {
      const message = t('detail.uploadFailed', { error: err.message || err });
      if (statusEl) { statusEl.textContent = message; statusEl.hidden = false; }
      toast(message, "error");
    }
  });
  $("#removePhotoBtn")?.addEventListener("click", async () => {
    try {
      const accessToken = _authSession?.access_token;
      const res = await fetch((window.WORKER_BASE || "") + "/api/collection/" + entry.id + "/photo", {
        method: "DELETE",
        headers: accessToken ? { Authorization: "Bearer " + accessToken } : {},
      });
      if (!res.ok && res.status !== 204) { const d = await res.json(); throw new Error(d.error || res.statusText); }
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      toast("Photo removed", "info");
      await paintSetDetail(set, { ...entry, custom_image_url: null });
    } catch (err) { toast(t('detail.removeFailed', { error: err.message || err }), "error"); }
  });

  // Parts completeness
  $("#loadPartsBtn")?.addEventListener("click", async () => {
    const btn = $("#loadPartsBtn");
    const content = $("#partsContent");
    if (!btn || !content) return;
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
      const data = await api("/api/sets/" + encodeURIComponent(set.set_num) + "/parts");
      if (data.pending) {
        content.innerHTML = `<span style="color:var(--ink-mute);">Parts list is being fetched — check back in a moment.</span>`;
        btn.textContent = "Refresh";
        btn.disabled = false;
        return;
      }
      const { parts, completeness, total_owned, total_missing } = data;
      const pct = completeness ?? (total_owned > 0 ? Math.round((total_owned - total_missing) / total_owned * 100) : null);
      const pctStr = pct !== null ? `${pct}%` : "—";
      const color = pct === null ? "var(--ink-mute)" : pct >= 95 ? "var(--up)" : pct >= 80 ? "var(--bv-yellow)" : "var(--down)";
      const missingParts = parts.filter(p => p.missing_qty > 0 && !p.is_spare);
      content.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px;">
          <span style="font-size:22px;font-weight:700;color:${color};">${pctStr}</span>
          <span style="color:var(--ink-mute);font-size:12px;">${t('detail.partsComplete')}${total_missing > 0 ? ` · ${escapeHtml(tPlural('detail.partsMissing', Number(total_missing)))}` : ` · ${t('detail.allPartsPresent')}`}</span>
        </div>
        <div style="color:var(--ink-mute);font-size:12px;line-height:1.45;margin-bottom:8px;">Based on the Rebrickable parts list and your saved missing-parts marks. Spares are ignored.</div>
        ${missingParts.length ? `
          <div style="font-size:12px;color:var(--ink-mute);margin-bottom:4px;">Missing:</div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;">
            ${missingParts.slice(0, 20).map(p => `
              <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
                ${p.part_img_url ? `<img src="${escapeHtml(p.part_img_url)}" alt="" style="width:24px;height:24px;object-fit:contain;">` : `<div style="width:24px;height:24px;background:var(--surface-2);border-radius:3px;"></div>`}
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.part_name || p.part_num)}</span>
                <span style="font-family:var(--mono);color:var(--down);">×${p.missing_qty}</span>
              </div>
            `).join('')}
            ${missingParts.length > 20 ? `<div style="color:var(--ink-mute);font-size:11px;">${tPlural('detail.tagsMore', missingParts.length - 20)}</div>` : ''}
          </div>
        ` : ''}
      `;
      btn.textContent = "Refresh";
      btn.disabled = false;
    } catch (_e) {
      content.textContent = "Failed to load parts.";
      btn.textContent = "Retry";
      btn.disabled = false;
    }
  });
}

function optionalMoneyInput(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function moneyInputValue(value) {
  const n = optionalMoneyInput(value);
  if (n == null) return "";
  return (Math.round(n * 100) / 100).toFixed(2);
}

let _detailCtx = null;
let _detailDelegated = false;
// One delegated click handler on #root for the set-detail back/share/tab controls,
// so morphdom-preserved nodes never accumulate or lose listeners. Reads the
// current set/entry from module state; wrapped so a bug can't break other clicks.
function ensureDetailDelegation() {
  if (_detailDelegated) return;
  const root = document.getElementById("root");
  if (!root) return;
  _detailDelegated = true;
  root.addEventListener("click", (e) => {
    try {
      if (!_detailCtx) return;
      if (e.target.closest("#detailBack")) { if (history.length > 1) history.back(); else location.hash = "#/"; return; }
      if (e.target.closest("#shareBtn")) { shareSet(_detailCtx.set); return; }
      const sheetBtn = e.target.closest("[data-set-sheet]");
      if (sheetBtn && sheetBtn.closest(".bv-setpage")) {
        haptic("light");
        openSetSheet(sheetBtn.dataset.setSheet, _detailCtx.set, _detailCtx.entry);
        return;
      }
      const contrib = e.target.closest("[data-contrib]");
      if (contrib && contrib.closest(".bv-setpage")) {
        haptic("light");
        const { set } = _detailCtx;
        const refresh = () => { if (state.detail.tab === "community") wireCommunityTab(set); };
        const act = contrib.dataset.contrib;
        if (act === "review") openReviewSheet(set.set_num, refresh);
        else if (act === "photo") openPhotoSheet(set.set_num, refresh);
        else openDataFixSheet(set.set_num, refresh);
        return;
      }
      const tb = e.target.closest("#detailTabs button");
      if (tb) { haptic("light"); switchDetailTab(tb.dataset.tab, _detailCtx.set, _detailCtx.entry); }
    } catch (err) { console.warn("[detail-delegation]", err); }
  });
  // Keyboard activation of the tabs (arrow/home/end) — delegated once so
  // morphdom-repainted tab rows keep working without re-wiring.
  root.addEventListener("keydown", (e) => {
    try {
      if (!_detailCtx || !e.target.closest || !e.target.closest("#detailTabs")) return;
      const list = [...document.querySelectorAll("#detailTabs button[role='tab']")];
      if (!list.length) return;
      const cur = list.findIndex(b => b.dataset.tab === state.detail.tab);
      let next = -1;
      if (e.key === "ArrowRight") next = (cur + 1) % list.length;
      else if (e.key === "ArrowLeft") next = (cur - 1 + list.length) % list.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = list.length - 1;
      else return;
      e.preventDefault();
      const target = list[next];
      target.focus();
      switchDetailTab(target.dataset.tab, _detailCtx.set, _detailCtx.entry);
    } catch (err) { console.warn("[detail-delegation]", err); }
  });
}

function switchDetailTab(tab, set, entry) {
  if (!detailTabs().includes(tab)) tab = "info";
  const prev = state.detail.tab;
  state.detail.tab = tab;
  const page = $(".detail-page-container");
  if (page) page.dataset.detailTab = tab;
  $$("#detailTabs button").forEach(x => {
    const on = x.dataset.tab === tab;
    x.classList.toggle("active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
    x.setAttribute("tabindex", on ? "0" : "-1");
  });
  // Keep the URL in sync with the active tab without re-running the router
  // (replaceState, so back/forward history still holds the set itself).
  history.replaceState(null, "", `#/set/${encodeURIComponent(set.set_num)}/${tab}`);
  const panel = $(".detail-tab-panel");
  if (!panel) return;
  panel.id = `panel-${tab}`;
  panel.setAttribute("aria-labelledby", `tab-${tab}`);
  // Fresh markup per tab (not a morph): each tab wires its own listeners.
  panel.innerHTML = panelHTML(tab, set, entry);
  wirePanel(tab, set, entry);
  if ((prev === "community") !== (tab === "community")) paintSetBar(set, entry, tab);
}

/* ============================================================
   Community tab — reviews, photo gallery, data-fix contributions
   ============================================================ */
function communityTabHTML(set) {
  const guest = isGuestMode();
  return `
    <div class="community-tab bv-community" data-set="${escapeHtml(set.set_num)}">
      <h2 class="bv-sr">${escapeHtml(t("bvSet.communityTitle"))}</h2>
      <div id="communityBody" class="community-body">
        <div class="bv-card community-loading" role="status">${escapeHtml(t("bvSet.communityLoading"))}</div>
      </div>
      <div class="bv-setrows bv-community__fix">${kitRow({ icon: "edit", title: t("bvSet.suggestFix"), sub: t("bvSet.suggestFixSub"), attrs: { "data-contrib": "fix" } })}</div>
      <p class="bv-foot community-mode-note ${guest ? "guest" : "member"}" role="note">${escapeHtml(t(guest ? "bvSet.trustGuest" : "bvSet.trustMember"))}</p>
    </div>`;
}

function starRow(n) {
  const full = Math.round(n);
  return `<span class="star-row" role="img" aria-label="${escapeHtml(t("bvSet.starsLabel", { n: Number(n).toFixed(1) }))}">${[1, 2, 3, 4, 5].map(i => `<span class="${i <= full ? "is-on" : ""}" aria-hidden="true">★</span>`).join("")}</span>`;
}

async function wireCommunityTab(set) {
  const body = $("#communityBody");
  if (!body) return;
  let data;
  try {
    data = await api("/api/contributions/sets/" + encodeURIComponent(set.set_num));
  } catch {
    if (!body.isConnected) return;
    body.innerHTML = `<section class="bv-empty" role="status"><h2>${escapeHtml(t("bvSet.communityFailed"))}</h2>
      <div class="bv-empty__actions"><button type="button" class="bv-btn bv-btn--outline bv-btn--full" id="communityRetry">${escapeHtml(t("common.retry"))}</button></div></section>`;
    $("#communityRetry")?.addEventListener("click", () => wireCommunityTab(set));
    return;
  }
  if (!location.hash.includes(set.set_num) || state.detail.tab !== "community" || !body.isConnected) return;

  const pending = (data.mine || []).filter(m => m.status === "pending").length;
  const reviews = data.reviews || [];
  const photos = data.photos || [];
  const prices = data.prices || [];
  const hasContent = Boolean(data.rating?.count || reviews.length || photos.length || prices.length);
  const photoUrl = (p) => (window.WORKER_BASE || "") + p.url;

  const ratingHTML = data.rating?.count
    ? `<section class="bv-card bv-rating community-rating-section" aria-label="${escapeHtml(t("bvSet.collectorRating"))}">
        <span class="bv-rating__value">${escapeHtml(Number(data.rating.avg).toFixed(1))}</span>
        <span class="bv-rating__text">${starRow(data.rating.avg)}<span class="bv-label">${escapeHtml(tPlural("bvSet.ratingReviews", data.rating.count, { count: data.rating.count }))}</span></span>
      </section>`
    : "";
  const photosHTML = photos.length
    ? `<h2 class="bv-h2">${escapeHtml(t("bvSet.collectorPhotos"))}</h2>
      <div class="bv-photogrid community-gallery no-tab-swipe">${photos.map((p, i) =>
        `<button type="button" class="community-photo" data-photo-idx="${i}" aria-label="${escapeHtml(p.caption || set.name || set.set_num)}"><img loading="lazy" src="${escapeHtml(photoUrl(p))}" alt=""></button>`
      ).join("")}</div>`
    : "";
  const reviewsHTML = reviews.length
    ? `<h2 class="bv-h2">${escapeHtml(t("bvSet.reviews"))}</h2>
      <section class="bv-card bv-reviews">${reviews.map(r => `
        <article class="community-review">
          <div class="cr-head"><b>${escapeHtml(r.author || t("bvSet.collector"))}</b>${starRow(r.rating)}</div>
          ${r.title ? `<div class="cr-title">${escapeHtml(r.title)}</div>` : ""}
          ${r.body ? `<div class="cr-body">${escapeHtml(r.body)}</div>` : ""}
          <div class="cr-meta">${escapeHtml(fmtDateUpdated(r.created_at))}</div>
        </article>`).join("")}</section>`
    : "";
  const pricesHTML = prices.length
    ? `<h2 class="bv-h2">${escapeHtml(t("bvSet.reportedSales"))}</h2>
      <section class="bv-card community-prices">${prices.map(p =>
        `<div class="bv-kv cp-row"><span>${escapeHtml(p.condition || "new")} · ${escapeHtml(fmtDateUpdated(p.at))}</span><span class="bv-num">${escapeHtml(fmtMoney(p.price))}</span></div>`
      ).join("")}</section>`
    : "";

  body.innerHTML = `
    ${pending ? `<div class="bv-banner bv-banner--info community-pending" role="status">${kitIcon("clock", { size: 20 })}<span class="bv-banner__text">${escapeHtml(tPlural("community.pendingSubmission", pending))}</span></div>` : ""}
    ${ratingHTML}${photosHTML}${reviewsHTML}${pricesHTML}
    ${hasContent ? "" : `<section class="bv-empty community-empty"><div class="bv-empty__art">${kitIcon("star")}</div>
      <h2>${escapeHtml(t("bvSet.communityEmpty"))}</h2><p>${escapeHtml(t("bvSet.communityEmptyBody"))}</p></section>`}`;

  body.querySelector(".community-gallery")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-photo-idx]");
    if (!btn) return;
    const { openLightbox } = await import("../components/lightbox.js");
    openLightbox(photos.map(photoUrl), Number(btn.dataset.photoIdx) || 0);
  });
}

function setupTabSwipe(set, entry) {
  const el = $("#tabPanels"); if (!el) return;
  if (_swipeAc) _swipeAc.abort();
  _swipeAc = new AbortController();
  const { signal } = _swipeAc;
  let sx = 0, sy = 0, active = false, fromScroller = false;
  el.addEventListener("touchstart", e => {
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; active = true;
    // A horizontal drag inside the Photos gallery or the price sparkline is
    // for scrolling/scrubbing — don't let it flip tabs.
    fromScroller = !!(e.target.closest && e.target.closest('.bs-gallery, .spark-wrap, .no-tab-swipe'));
  }, { passive: true, signal });
  el.addEventListener("touchend", e => {
    if (!active) return; active = false;
    if (fromScroller) { fromScroller = false; return; }
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const owned = !!entry;
      const tabs = detailTabs(owned);
      const idx = tabs.indexOf(state.detail.tab);
      const next = clamp(idx + (dx < 0 ? 1 : -1), 0, tabs.length - 1);
      if (next !== idx) { haptic("light"); switchDetailTab(tabs[next], set, entry); }
    }
  }, { signal });
}

/* ============================================================
   eBay Listing Generator
   ============================================================ */


function copyListingField(text, label) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast(t('common.copied', { label }), "success"))
      .catch(() => _fallbackCopy(text, label));
  } else {
    _fallbackCopy(text, label);
  }
}

function _fallbackCopy(text, label) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast(t('common.copied', { label }), "success"); } catch {}
  document.body.removeChild(ta);
}


function openAddWishlistSheet(set, onConfirm) {
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  const marketLocal = displayValueOf(set) * rate;
  const suggestedLocal = marketLocal * 0.85;

  // Pre-fill the suggested target: a blank target silently produces ZERO
  // price-drop alerts, which contradicts the wishlist's promise — so no-target
  // must be an explicit choice, and the copy says what it means.
  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Add to Wishlist</div>
    <div style="font-size:14px;color:var(--ink-mute);margin:0 4px 14px;">${escapeHtml(set.set_num)} — ${escapeHtml(set.name)}</div>

    <div class="field">
      <label class="field-lbl">${escapeHtml(t('wishlist.targetPriceCurrency', { symbol }))}</label>
      <input type="number" step="0.01" id="wlTargetPrice" class="field-input" placeholder="0.00" autocomplete="off" value="${suggestedLocal > 0 ? suggestedLocal.toFixed(2) : ''}">
      <div id="wlSuggestedChip" style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:4px 8px;background:var(--surface-3);border:1px solid var(--line);border-radius:12px;font-size:12px;cursor:pointer;color:var(--ink);">
        ${I.sparkles({ w: 14 })} ${escapeHtml(t('wishlist.suggestedPrice', { price: `${symbol}${suggestedLocal.toFixed(2)}` }))}
      </div>
      <div style="font-size:11px;color:var(--ink-mute);margin-top:6px;line-height:1.4;">Leave empty to watch without price-drop alerts.</div>
    </div>
    <div class="field" style="margin-top:14px;">
      <label class="field-lbl">Notes</label>
      <textarea id="wlNotes" class="field-input" placeholder="e.g. Look for sealed, boxed only" style="height:60px;resize:none;"></textarea>
    </div>
    
    <button class="btn-primary" id="wlSave" style="margin-top:20px;">Save to Wishlist</button>
    <button class="btn-secondary" id="wlCancel" style="margin-top:8px;">Cancel</button>
  `);

  const priceInp = document.getElementById("wlTargetPrice");
  const notesInp = document.getElementById("wlNotes");
  const suggestedChip = document.getElementById("wlSuggestedChip");

  suggestedChip.addEventListener("click", () => {
    priceInp.value = suggestedLocal.toFixed(2);
    haptic("light");
  });

  document.getElementById("wlSave").addEventListener("click", () => {
    const rawPrice = priceInp.value.trim();
    const val = rawPrice ? parseFloat(rawPrice) : null;
    const usdVal = Number.isFinite(val) ? val / rate : null;
    const notesVal = notesInp.value.trim();
    hideSheet();
    onConfirm(usdVal, notesVal);
  });

  document.getElementById("wlCancel").addEventListener("click", hideSheet);
}

function openDealBreakdownSheet(set, storePrice) {
  const market = parseFloat(marketValueForCondition(set, set?.condition || 'new') || 0);
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  
  const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const tax = parseFloat(localStorage.getItem("bv_flip_tax") ?? "0.00");

  // Shared flip math (lib/pure.js) — same numbers as the scanner's calculator.
  const calc = flipEconomics({ marketUsd: market, rate, feePct, paymentPct, shipping, tax });
  const { marketplaceFee: ebayFee, paymentFee: paypalFee, net } = calc || { marketplaceFee: 0, paymentFee: 0, net: 0 };
  const profit = net - storePrice;
  const roi = storePrice > 0 ? (profit / storePrice) * 100 : 0;

  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Deal Score Breakdown</div>
    <div class="deal-breakdown-details" style="display:flex;flex-direction:column;gap:10px;font-size:14px;padding:4px;">
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Market Value</span>
        <strong>${fmtMoney(market)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Your Store Price</span>
        <strong>${symbol}${storePrice.toFixed(2)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">${t("fees.marketplace", { pct: feePct })}</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${ebayFee.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">${t("fees.payment", { pct: paymentPct })}</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${paypalFee.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Shipping Cost</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${shipping.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Tax / VAT</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${tax.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1.5px solid var(--line);padding-bottom:8px;font-size:16px;">
        <span>Estimated Net Profit</span>
        <strong style="color:${profit >= 0 ? "var(--up)" : "var(--bv-red)"};">${profit >= 0 ? "+" : ""}${symbol}${profit.toFixed(2)}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:16px;">
        <span>Estimated ROI</span>
        <strong style="color:${profit >= 0 ? "var(--up)" : "var(--bv-red)"};">${profit >= 0 ? "+" : ""}${roi.toFixed(1)}%</strong>
      </div>
    </div>
    <button class="btn-primary" id="dbClose" style="margin-top:20px;">Done</button>
  `);

  document.getElementById("dbClose").addEventListener("click", hideSheet);
}

function wireFlipCalc(set, entry, containerEl = document) {
  const inputs = containerEl.querySelectorAll(".flip-input");
  inputs.forEach(inp => {
    inp.addEventListener("input", () => {
      const key = inp.dataset.key;
      const val = parseFloat(inp.value) || 0;
      if (key === "fee_pct") localStorage.setItem("bv_flip_fee_pct", val);
      if (key === "payment_pct") localStorage.setItem("bv_flip_payment_pct", val);
      if (key === "shipping") localStorage.setItem("bv_flip_shipping", val);
      if (key === "tax") localStorage.setItem("bv_flip_tax", val);

      const condition = entry?.condition || 'new';
      const market = parseFloat(marketValueForCondition(set, condition) || 0);
      if (market <= 0) return;

      const userCurrency = state.me?.currency || "USD";
      const rate = getExchangeRate(userCurrency);
      const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
      const convertedMarket = market * rate;

      let estPrice = convertedMarket;
      if (condition.startsWith('used') && !set.ebay_used_value) {
        const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
        estPrice = convertedMarket * ratio;
      }

      const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
      const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
      const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
      const tax = parseFloat(localStorage.getItem("bv_flip_tax") ?? "0.00");

      const ebayFee = estPrice * (feePct / 100);
      const paypalFee = estPrice * (paymentPct / 100) + (0.30 * rate);
      const gross = estPrice;
      const totalFees = ebayFee + paypalFee + shipping + tax;
      const net = Math.max(0, gross - totalFees);

      const grossEl = containerEl.querySelector(".flip-gross-val");
      const feesEl = containerEl.querySelector(".flip-fees-val");
      const netEl = containerEl.querySelector(".flip-net-val");
      if (grossEl) grossEl.textContent = `${symbol}${gross.toFixed(2)}`;
      if (feesEl) feesEl.textContent = `-${symbol}${totalFees.toFixed(2)}`;
      if (netEl) netEl.textContent = `${symbol}${net.toFixed(2)}`;

      const purchasePrice = entry ? parseFloat(entry.purchase_price || 0) * rate : 0;
      const resultEl = containerEl.querySelector(".flip-result");
      if (resultEl) {
        if (purchasePrice > 0) {
          const netRoi = ((net - purchasePrice) / purchasePrice) * 100;
          const roiColor = netRoi >= 0 ? 'var(--up)' : 'var(--bv-red)';
          resultEl.innerHTML = `<div style="font-size:11px;margin-top:4px;">Net ROI: <strong class="flip-roi-val" style="color:${roiColor};">${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(1)}%</strong></div>`;
        } else {
          resultEl.innerHTML = '';
        }
      }
    });
  });
}


let _historyReq = 0;
async function loadSetHistory(setNum, days = 365, entry = null) {
  const el = $("#setSpark");
  if (!el) return;
  const req = ++_historyReq;
  const deltaEl = $("#histDelta");
  const markEl = $("#histBought");
  const movementEl = $("#setMovementSummary");
  try {
    const res = await api("/api/sets/" + encodeURIComponent(setNum) + "/history?days=" + days);
    if (req !== _historyReq || !el.isConnected) return;
    const hist = res.history || [];
    el.innerHTML = "";
    el.style.height = "";
    if (markEl) markEl.hidden = true;
    if (movementEl) movementEl.hidden = true;
    if (hist.length >= 2) {
      const movement = priceMovementSummary(hist);
      if (movement && movementEl) {
        const baseKey = movement.direction === 'up' ? 'detail.movementUp' : 'detail.movementDown';
        const driverKey = movement.driver
          ? `detail.movement${movement.driver === 'resale' ? 'Resale' : 'Market'}${movement.direction === 'up' ? 'Up' : 'Down'}`
          : null;
        movementEl.textContent = t(baseKey, { pct: movement.pct, days: movement.days }) + (driverKey ? t(driverKey) : '');
        movementEl.hidden = false;
      }
      const first = Number(hist[0].current_value), last = Number(hist[hist.length - 1].current_value);
      if (deltaEl) deltaEl.innerHTML = first > 0 && last > 0 ? kitDelta(((last - first) / first) * 100) : "";
      const up = last >= first;
      const hasPts = (key) => hist.filter(h => Number(h?.[key]) > 0).length >= 2;
      const series = [
        { key: "bl_value", color: "var(--ink-mute)", dash: "2 3", label: t('detail.historyMarket') },
        { key: "ebay_value", color: "var(--bv-yellow-dark)", dash: "5 4", label: t('detail.historyResale') },
      ].filter(s => hasPts(s.key));
      drawSparkline(el, hist, { up, series });
      const legendEl = $("#setSparkLegend");
      if (legendEl) {
        legendEl.innerHTML = [{ color: up ? "var(--up)" : "var(--down)", dash: "", label: t('detail.historyValue') }, ...series]
          .map(s => `<span class="spark-key"><svg width="14" height="4" viewBox="0 0 14 4"><line x1="0" y1="2" x2="14" y2="2" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/></svg>${s.label}</span>`)
          .join("") + (series.length ? `<span class="spark-key spark-note-snap">${t('market.historySnapshotNote')}</span>` : "");
      }
      // "You bought" marker at the first snapshot on/after the purchase date.
      const bought = entry?.purchased_at ? String(entry.purchased_at).slice(0, 10) : "";
      const idx = bought ? hist.findIndex(h => String(h.snapshot_date || "") >= bought) : -1;
      if (markEl && idx > 0) {
        const frac = idx / (hist.length - 1);
        markEl.style.left = `calc(4px + (100% - 8px) * ${frac.toFixed(4)})`;
        markEl.classList.toggle("is-end", frac > 0.6);
        const paid = Number(entry.purchase_price) > 0 ? Number(entry.purchase_price) : null;
        markEl.querySelector(".bv-chart__marklabel").textContent = paid ? t("bvSet.youBoughtAt", { price: money0(paid) }) : t("bvSet.youBought");
        markEl.hidden = false;
      }
    } else {
      if (deltaEl) deltaEl.innerHTML = "";
      el.style.height = "auto";
      el.innerHTML = `<div class="spark-empty">${kitIcon("info", { size: 20 })}<span>Price tracking just started — check back soon for a trend.</span></div>`;
    }
  } catch {
    if (req !== _historyReq || !el.isConnected) return;
    el.style.height = "auto";
    el.innerHTML = `<div class="spark-empty"><span>Couldn't load price history.</span></div>`;
  }
}


// Lazy Brickset photo gallery — fetched only for sets with extra images, cached
// server-side + quota-gated. Removes the Photos card if there's nothing to show.
async function loadSetImages(setNum) {
  const el = $("#bsGallery");
  if (!el) return;
  const dropCard = () => { const card = el.closest(".detail-card, .card"); if (card) card.remove(); };
  try {
    const imgs = await setImagesFor(setNum);
    if (!el.isConnected) return;
    if (!imgs.length) { dropCard(); return; }
    el.innerHTML = imgs.map((u, i) => `<button type="button" data-lb-idx="${i}" aria-label="Open photo ${i + 1}" style="flex:0 0 auto;display:block;padding:0;border:none;background:none;cursor:pointer;"><img src="${escapeHtml(u)}" loading="lazy" alt="Set photo" style="height:120px;width:auto;border-radius:var(--r-1);border:1px solid var(--line-soft);object-fit:cover;display:block;"></button>`).join("");
    // Tapping a thumbnail opens the in-app viewer (swipe between photos, back
    // button closes) instead of bouncing the user out to the browser.
    el.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-lb-idx]");
      if (!btn) return;
      const urls = Array.from(el.querySelectorAll("[data-lb-idx] img")).map(im => im.src);
      const idx = Array.from(el.querySelectorAll("[data-lb-idx]")).indexOf(btn);
      const { openLightbox } = await import("../components/lightbox.js");
      openLightbox(urls, Math.max(0, idx));
    });
    // Drop any image Brickset 404s on, so we never show a broken-image icon;
    // if all fail, remove the empty Photos card.
    el.querySelectorAll("img").forEach(img => img.addEventListener("error", () => {
      const a = img.closest("[data-lb-idx]"); if (a) a.remove();
      if (!el.querySelector("[data-lb-idx]")) dropCard();
    }));
  } catch {
    dropCard();
  }
}

// Map pricing sources to collector-friendly labels that distinguish sold comps,
// asking data, BrickLink-style market data, and formula/AI fallbacks.
function _dealScoreHTML(_set) {
  return `
    <div class="deal-score-wrap" id="dealScoreWrap">
      <div class="deal-score-lbl">In-store price check</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" class="deal-price-input" id="dealPriceInput" placeholder="Enter store price…" min="0" step="0.01">
        <div class="deal-badge" id="dealBadge"></div>
      </div>
    </div>`;
}

function _updateDealBadge(set, priceStr) {
  const badge = document.getElementById("dealBadge");
  if (!badge) return;
  const price = parseFloat(priceStr);
  if (!price || price <= 0) { badge.textContent = ""; badge.className = "deal-badge"; return; }
  const score = computeDealScore(set, price);
  if (!score) return;
  badge.className = `deal-badge ${score.verdict}`;
  const labels = { great: "GREAT DEAL", fair: "FAIR PRICE", over: "OVERPRICED" };
  badge.textContent = labels[score.verdict];
  badge.title = score.label;

  // Click handler to open Deal Score breakdown
  badge.style.cursor = "pointer";
  badge.onclick = () => {
    haptic("light");
    openDealBreakdownSheet(set, price);
  };
}
