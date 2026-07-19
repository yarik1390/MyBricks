import { $, $$, haptic, escapeHtml, toast, undoToast, fmtMoney, fmtPct, clamp, celebrate, setHue, fmtDateUpdated, setBtnLoading, drawSparkline, bricklinkBuyURL, CURRENCY_SYMBOLS, getExchangeRate, mount, cacheSetDetail, getCachedSetDetail, lastPortfolioMilestone, recordPortfolioMilestone, publicOrigin, proxyImg } from '../utils.js';
import { priceStripHTML, marketConfidenceHTML, marketSpreadHTML, marketDepthHTML, dealSignalHTML, partOutHTML, investmentPricingHTML, investmentPricingDetailHTML } from './portfolio-detail-market.js';
import { computeDealScore, computeSellSignal, ebaySoldSummary, marketValueForCondition, estMark, displayValueOf, flipEconomics, cleanTagLabel, sanitizeMoneyInput } from '../lib/pure.js';
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
function detailTabs(owned) {
  const tabs = owned ? ["info", "forecast", "community", "manage"] : ["info", "forecast", "community"];
  return isSimpleMode() ? tabs.filter(t => t !== "forecast") : tabs;
}

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
          if (location.hash.includes(setNum)) paintSetDetail(set, entry);
        }).catch(() => {});
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
        if (!navigator.onLine) toast("You're offline — showing cached data", "info");
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
        if (!navigator.onLine) toast("You're offline — showing bundled data", "info");
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

function paintSetDetail(set, entry) {
  const isWish = state.wishlist.some(w => w.set_num === set.set_num);
  const owned = !!entry;
  // Simple mode has no forecast tab — don't let a deep link (/set/x/forecast)
  // strand the panel on a hidden tab.
  if (isSimpleMode() && state.detail.tab === "forecast") state.detail.tab = "info";
  const h = setHue(set);
  const displayImg = proxyImg(set.image_url);
  const hasImg = displayImg && !displayImg.startsWith("data:");

  $("#root").innerHTML = `
    <div class="page no-pad detail-page-container" data-detail-tab="${escapeHtml(state.detail.tab)}">
      <div class="detail-hero-col">
        <div class="detail-hero${hasImg ? " has-photo" : ""}">
          <button class="detail-back" id="detailBack" aria-label="Back">${I.chevL()}</button>
          ${hasImg
            ? `<div class="detail-hero-bg" style="background-image:url('${escapeHtml(displayImg)}')"></div>`
            : `<div class="detail-hero-bg placeholder" style="--brick-hue:linear-gradient(135deg, oklch(0.72 0.13 ${h}), oklch(0.55 0.13 ${h}));"></div>`}
          <div class="detail-hero-overlay"></div>
          <div class="detail-img${hasImg ? " has-photo" : ""}">
            ${hasImg ? "" : `<div class="brick-art" style="--brick-color:oklch(0.72 0.13 ${h});">${escapeHtml(set.set_num)}</div>`}
            ${hasImg ? `<img class="set-photo" src="${escapeHtml(displayImg)}" alt="${escapeHtml(set.name)}">` : ""}
          </div>
        </div>
      </div>
      <div class="detail-content-col">
        <div class="detail-title-row">
          <div>
            <div class="detail-eyebrow">${escapeHtml(set.theme || "")} · #${escapeHtml(set.set_num)}${set.coming_soon ? " · <span style='color:var(--accent);font-weight:700;'>COMING SOON</span>" : `${set.retired ? " · RETIRED" : ""}${set.lego_retiring_soon ? " · <span style='color:var(--down);font-weight:700;'>RETIRING SOON</span>" : ""}`}</div>
            <h1 class="detail-title">${escapeHtml(set.name)}</h1>
          </div>
          <button class="detail-share-btn icon-btn" id="shareBtn" aria-label="Share">${I.share()}</button>
        </div>
        <div class="detail-tabs" id="detailTabs" role="tablist" aria-label="Set detail sections">
          ${detailTabs(owned).map(t =>
            `<button data-tab="${t}" role="tab" aria-selected="${state.detail.tab === t}" aria-controls="tabPanels" class="${state.detail.tab === t ? "active" : ""}">${t[0].toUpperCase()+t.slice(1)}</button>`
          ).join("")}
        </div>
        <div class="detail-tab-panel" id="tabPanels" role="tabpanel">
          ${state.detail.tab === "info" ? infoTabHTML(set, entry, isWish) :
            state.detail.tab === "forecast" ? forecastTabHTML(set) :
            state.detail.tab === "community" ? communityTabHTML(set) :
            manageTabHTML(set, entry)}
        </div>
      </div>
      ${detailActionBarHTML(set, entry, isWish)}
    </div>`;

  _detailCtx = { set, entry };
  ensureDetailDelegation();
  if (state.detail.tab === "info") wireInfoTab(set);
  else if (state.detail.tab === "manage") wireManageTab(set, entry);
  else if (state.detail.tab === "community") wireCommunityTab(set);
  wireDetailActions(set, entry); // sticky action bar — present on every tab
  setupTabSwipe(set, entry);

  // Custom photos live behind the authed worker API, so an <img src> can't
  // load them directly — fetch with the bearer token and swap in a blob URL.
  if (entry?.custom_image_url) {
    customPhotoObjectURL(entry.custom_image_url).then(url => {
      if (!url) return;
      const bg = document.querySelector(".detail-hero-bg");
      if (bg) { bg.style.backgroundImage = `url('${url}')`; bg.classList.remove("placeholder"); }
      let img = document.querySelector(".detail-img .set-photo");
      if (!img) {
        img = document.createElement("img");
        img.className = "set-photo";
        img.alt = "";
        document.querySelector(".detail-img")?.appendChild(img);
        document.querySelector(".detail-img")?.classList.add("has-photo");
        document.querySelector(".detail-hero")?.classList.add("has-photo");
      }
      img.src = url;
    });
  }
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
    text: `Check out ${set.name} (${set.set_num}) on BricksVault!`,
    url: shareUrl,
    dialogTitle: `Share ${set.name}`,
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
  if (set.coming_soon) return Number(set.upcoming_price) || Number(set.retail_price) || 0;
  return (set.valuation?.read_enabled && Number(set.valuation?.new?.fair_value)) || displayValueOf(set);
}

// Plain-language confidence chip (no "high/medium/low signal" jargon).
function confidenceChip(set) {
  // Not released yet: the headline is the announced retail, not a market estimate.
  if (set.coming_soon) return `<span class="detail-chip detail-chip--ok" title="Not released yet — showing the announced retail price">Coming soon</span>`;
  const conf = String((set.valuation?.read_enabled && set.valuation?.new?.confidence) || set.market_value_confidence || set.confidence || '').toLowerCase();
  const method = set.valuation_method;
  if (set.valuation?.read_enabled && set.valuation?.new) {
    if (conf === 'high') return `<span class="detail-chip detail-chip--good" title="Multiple fresh independent sold markets agree on this price">Reliable price</span>`;
    if (conf === 'medium') return `<span class="detail-chip detail-chip--ok" title="Recent market evidence supports this price">Good estimate</span>`;
    if (conf === 'low') return `<span class="detail-chip detail-chip--low" title="Limited, stale, or conflicting market evidence">Low confidence</span>`;
    return `<span class="detail-chip detail-chip--low" title="No sufficient verified sold evidence yet">Estimated</span>`;
  }
  if (method === 'ai') return `<span class="detail-chip detail-chip--low" title="Estimated by AI because fresh market data wasn't available">Estimated</span>`;
  if (method === 'formula_bulk') return `<span class="detail-chip detail-chip--low" title="Estimated from the set's attributes until a market refresh runs">Rough estimate</span>`;
  if (conf === 'high') return `<span class="detail-chip detail-chip--good" title="Multiple fresh market sources agree on this price">Reliable price</span>`;
  if (conf === 'medium') return `<span class="detail-chip detail-chip--ok" title="Based on recent market data with limited corroboration">Good estimate</span>`;
  if (conf === 'low') return `<span class="detail-chip detail-chip--low" title="Limited recent market data — treat as a rough guide">Rough estimate</span>`;
  return '';
}

// One-line key facts row: Pieces · Year · Minifigs · Retail. Replaces the old
// 3-col stat grid and the duplicate pieces row in Set Facts.
function summaryFactsHTML(set) {
  const figs = set.set_minifigs?.length || set.minifigs || 0;
  const parts = [];
  if (set.pieces) parts.push(`<span class="f"><b>${Number(set.pieces).toLocaleString()}</b> pieces</span>`);
  if (set.year) parts.push(`<span class="f"><b>${set.year}</b></span>`);
  if (figs) parts.push(`<span class="f"><b>${figs}</b> minifig${figs === 1 ? '' : 's'}</span>`);
  // Unreleased sets: stored retail can be a formula placeholder; the
  // BrickEconomy RRP is authoritative until release.
  const retailShown = (set.coming_soon && set.be_retail) ? set.be_retail : set.retail_price;
  if (retailShown) parts.push(`<span class="f">Retail <b>${fmtMoney(retailShown)}</b></span>`);
  return parts.length ? `<div class="detail-summary-facts">${parts.join('')}</div>` : '';
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
    const range = lo > 0 && hi > 0 ? ` · likely ${fmtMoney(lo, { cents: 0 })}-${fmtMoney(hi, { cents: 0 })}` : '';
    return `<div class="detail-summary-src">${families} independent market famil${families === 1 ? 'y' : 'ies'} · ${sales} verified sale${sales === 1 ? '' : 's'}${range} · <a href="/methodology.html" style="color:inherit;text-decoration:underline;">How we price</a></div>`;
  }
  if (Number(set.market_value) > 0) {
    const n = Array.isArray(set.market_value_basis) ? set.market_value_basis.length : 0;
    const lo = Number(set.market_value_low), hi = Number(set.market_value_high);
    const range = lo > 0 && hi > 0 && hi > lo ? ` · typically ${fmtMoney(lo, { cents: 0 })}–${fmtMoney(hi, { cents: 0 })}` : '';
    return n > 0 ? `<div class="detail-summary-src">From ${n} market source${n === 1 ? '' : 's'}${range}</div>` : '';
  }
  if (estMark(set)) return `<div class="detail-summary-src">Estimate — no recent market sales for this set yet</div>`;
  return '';
}

// Compact summary header: the value + a plain-language confidence chip + key
// facts. Leads the Info tab in every mode (chip is Pro-only). Estimated values
// read humbler than market ones: "Estimated value ~$120" vs "Value $120".
function detailSummaryHTML(set) {
  const v = setDisplayValue(set);
  const est = !(set.valuation?.read_enabled && Number(set.valuation?.new?.fair_value) > 0) && !!estMark(set);
  const chip = isSimpleMode() ? '' : confidenceChip(set);
  return `
    <div class="detail-summary">
      <div class="detail-summary-top">
        <div style="min-width:0;">
          <div class="detail-summary-lbl">${est ? 'Estimated value' : 'Value'}</div>
          <div class="detail-summary-val">${v > 0 ? `${est ? '~' : ''}${fmtMoney(v)}` : '—'}</div>
          ${valueProvenanceHTML(set)}
        </div>
        ${chip}
      </div>
      ${summaryFactsHTML(set)}
    </div>`;
}

// Sticky action bar pinned above the bottom nav — keeps the primary action
// reachable without scrolling. Owned: qty stepper + Manage. Not owned: Add to
// vault + a wishlist heart. IDs match the handlers in wireDetailActions.
function detailActionBarHTML(set, entry, isWish) {
  const owned = !!entry;
  if (owned) {
    return `
      <div class="detail-action-bar">
        <div class="ab-qty">
          <span class="qty-row-lbl">In vault</span>
          <div class="qty-stepper">
            <button class="qty-btn" id="qtyDown" aria-label="Decrease quantity">${I.minus()}</button>
            <div class="qty-num" id="qtyNum">${entry.quantity}</div>
            <button class="qty-btn" id="qtyUp" aria-label="Increase quantity">${I.plus()}</button>
          </div>
        </div>
        <button class="btn-secondary" id="manageBtn" style="flex:1;">${I.gear()}<span>Manage</span></button>
      </div>`;
  }
  const displayVal = setDisplayValue(set);
  return `
    <div class="detail-action-bar">
      <button class="btn-primary" id="addBtn" style="flex:1;">${I.plus()}<span>Add to vault · ${estMark(set)}${fmtMoney(displayVal, { cents: 0 })}</span></button>
      <button class="btn-secondary ab-wish" id="wishToggle" aria-label="${isWish ? 'Remove from wishlist' : 'Add to wishlist'}">${isWish ? I.heartF() : I.heart()}</button>
    </div>`;
}

function infoTabHTML(set, entry, isWish) {
  const owned = !!entry;

  let bricksetHtml = '';
  {
    // Merge live brickset API data with stored DB columns (DB columns are fallback)
    const b = set.brickset || {};
    const ratingNum = b.rating ?? set.brickset_rating ?? 0;
    const reviewCount = b.reviewCount ?? set.brickset_review_count ?? 0;
    const reviewsStr = reviewCount ? `${reviewCount} review${reviewCount > 1 ? 's' : ''}` : '';
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
      ? `<div class="detail-kv span2"><span class="k" title="Change in market value over the past 12 months">Past year</span> <span class="v" style="color:${growthRate >= 0 ? 'var(--up)' : 'var(--down)'};">${growthRate >= 0 ? 'Up ' : 'Down '}${Math.abs(Number(growthRate)).toFixed(1)}%</span></div>`
      : '';
    const fmtMonthYear = (d) => { const t = d ? Date.parse(d) : NaN; return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
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
      ? `<div class="detail-tag-row"><span class="detail-tag-label">Tags:</span> ${visibleTags.map(t => `<span class="detail-tag-chip">${escapeHtml(String(t))}</span>`).join('')}${hiddenTagCount ? `<span class="detail-tag-more">+${hiddenTagCount} more</span>` : ''}</div>`
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
    const biReviewsStr = biReviewCount ? `${biReviewCount} review${biReviewCount > 1 ? 's' : ''}` : '';
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
    const cleanFact = (v) => { const s = String(v ?? '').trim(); return /^\{.*\}$/.test(s) || /^(not specified|n\/?a|unknown|none|null|-)$/i.test(s) ? '' : s; };
    const packaging = cleanFact(b3.packagingType || set.packaging_type || '');
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

  const ebaySold = ebaySoldSummary(set);
  const ebayPrice = ebaySold.newValue || 0;
  const ebayUsedPrice = ebaySold.usedValue || 0;
  const retailPrice = set.retail_price || 0;
  let pricingSummaryHtml = '';
  if (ebayPrice > 0 || ebayUsedPrice > 0) {
    const pricingTreatment = (retailPrice > 0 && ebayPrice > 0 && ebayPrice < retailPrice) ? 'STP' : (retailPrice > 0 && ebayPrice > retailPrice ? 'APPRECIATED' : 'NONE');
    const newQty = ebaySold.newSampleCount ? ` / ${ebaySold.newSampleCount} sales` : '';
    const usedQty = ebaySold.usedSampleCount ? ` / ${ebaySold.usedSampleCount} sales` : '';
    pricingSummaryHtml = `
      <div class="detail-card pricing-summary-card">
        <div class="detail-card-title" style="justify-content:space-between;">
          <span>Recently sold</span>
          <span class="badge" style="font-size:9px; padding:2px 6px; border-radius:4px; font-family:var(--mono); background:var(--surface-3); color:var(--ink-soft);">${ebaySold.legacy ? 'Legacy' : pricingTreatment === 'STP' ? 'Below MSRP' : pricingTreatment === 'APPRECIATED' ? 'Appreciated' : 'Sold data'}</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <div style="font-size:10px; font-family:var(--mono); color:var(--ink-mute); margin-bottom:2px; text-transform:uppercase;">New sold${newQty}</div>
            <div style="font-size:18px; font-weight:600; color:var(--ink);">${ebayPrice > 0 ? fmtMoney(ebayPrice) : "Pending"}</div>
          </div>
          <div>
            <div style="font-size:10px; font-family:var(--mono); color:var(--ink-mute); margin-bottom:2px; text-transform:uppercase;">Used sold${usedQty}</div>
            <div style="font-size:16px; font-weight:500; color:var(--ink-soft);">${ebayUsedPrice > 0 ? fmtMoney(ebayUsedPrice) : "Pending"}</div>
          </div>
        </div>
        ${retailPrice > 0 && ebayPrice > 0 ? `
          <div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line-soft);margin-top:10px;padding-top:10px;font-size:11px;">
            <span style="color:var(--ink-mute);">Retail MSRP</span>
            <strong style="color:var(--ink-soft);">${fmtMoney(retailPrice)}</strong>
          </div>
        ` : ''}
        ${!ebaySold.legacy && pricingTreatment === 'STP' ? `
          <div style="font-size:11px; color:var(--down); margin-top:10px; display:flex; align-items:center; gap:6px;">
            <span style="font-size:8px;">*</span> New sold comps are ${fmtMoney(retailPrice - ebayPrice)} (${fmtPct((retailPrice - ebayPrice) / retailPrice)}) below MSRP.
          </div>
        ` : !ebaySold.legacy && pricingTreatment === 'APPRECIATED' ? `
          <div style="font-size:11px; color:var(--up); margin-top:10px; display:flex; align-items:center; gap:6px;">
            <span style="font-size:8px;">*</span> New sold comps are ${fmtMoney(ebayPrice - retailPrice)} (${fmtPct((ebayPrice - retailPrice) / retailPrice)}) above MSRP.
          </div>
        ` : ebaySold.legacy ? `
          <div style="font-size:11px; color:var(--ink-mute); margin-top:10px; line-height:1.4;">
            Legacy single-value data is shown until the latest sold comps refresh this set.
          </div>
        ` : ''}
      </div>
    `;
  }

  const aiDisclaimerHTML = set.valuation_method === "ai" ? `
    <div style="background:rgba(245,158,11,0.1); border:1.5px solid rgba(245,158,11,0.3); color:rgba(245,158,11,1.0); border-radius:var(--r-2); padding:10px 12px; font-size:12px; margin-bottom:14px; display:flex; align-items:center; gap:8px; font-weight: 500;">
      <span class="u-center">${I.alert({w:15,h:15})}</span>
      <span>AI-estimated price — may vary from market.</span>
    </div>
  ` : '';

  const minifigsCard = set.set_minifigs?.length ? `
      <div class="detail-card">
        <div class="detail-card-title">Minifigs in this set</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${set.set_minifigs.map(f => `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;max-width:100%;" title="${escapeHtml(f.fig_name || f.fig_num)}">
              ${f.fig_img_url ? `<img src="${escapeHtml(f.fig_img_url)}" alt="${escapeHtml(f.fig_name || '')}" style="width:36px;height:36px;object-fit:contain;border-radius:4px;background:var(--surface-2);flex-shrink:0;">` : `<div style="width:36px;height:36px;background:var(--surface-2);border-radius:4px;flex-shrink:0;"></div>`}
              <div style="min-width:0;">
                <div style="color:var(--ink-soft);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">${escapeHtml(f.fig_name || 'Minifig')}${f.quantity > 1 ? ` <span style="color:var(--ink-mute);">×${f.quantity}</span>` : ''}</div>
                <div style="color:var(--ink-mute);font-size:10px;font-family:var(--mono);">${escapeHtml(f.fig_num)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : '';

  const externalLinks = `
    <a class="bl-buy-link" href="${bricklinkBuyURL(set.set_num)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--ink-mute);text-decoration:underline;margin-top:14px;">
      View on BrickLink ${I.extLink()}
    </a>
    <a class="bl-buy-link" href="https://www.google.com/search?q=LEGO+${encodeURIComponent(set.set_num)}+building+instructions+PDF" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--ink-mute);text-decoration:underline;margin-top:8px;">
      Building instructions (PDF) ${I.extLink()}
    </a>`;

  // Secondary owned-set actions (wishlist + sell) live in the content; the
  // primary add / qty controls live in the sticky action bar (paintSetDetail).
  const ownedSecondary = owned ? `
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn-secondary" id="wishToggle">
        ${isWish ? I.heartF() : I.heart()}<span>${isWish ? "Wishlisted" : "Wishlist"}</span>
      </button>
      <button class="btn-secondary" id="genListingBtn">⚡ <span>Sell on eBay</span></button>
    </div>` : '';

  return `
    ${detailSummaryHTML(set)}
    ${isSimpleMode() || isKidsMode() || !set.valuation?.read_enabled ? '' : investmentPricingHTML(set)}
    ${isSimpleMode() ? '' : `
    ${aiDisclaimerHTML}
    <button type="button" class="detail-disclose" id="pricingDetailsBtn" aria-haspopup="dialog">
        <span>Pricing details</span>
        <span class="detail-disclose-chev">▾</span>
    </button>
    <template id="pricingDetailsTemplate">
      <div class="pricing-details-sheet-body">
        ${set.valuation?.read_enabled ? investmentPricingDetailHTML(set) : ''}
        ${dealSignalHTML(set)}
        ${priceStripHTML(set, entry)}
        ${marketSpreadHTML(set)}
        ${marketDepthHTML(set)}
        ${partOutHTML(set)}
        ${pricingSummaryHtml}
        ${marketConfidenceHTML(set)}
      </div>
    </template>`}

    <div class="detail-card">
      <div class="detail-card-title">${I.tag()}Price history · 90 days</div>
      <div class="spark-wrap" id="setSpark" style="height:60px;"></div>
      <div class="spark-legend" id="setSparkLegend"></div>
    </div>

    ${(bricksetHtml.trim() || setFactsHtml.trim()) ? `
      <div class="detail-card">
        <div class="detail-card-title">Details</div>
        <div class="detail-kv-grid">${bricksetHtml}${setFactsHtml}</div>
      </div>` : ''}

    ${aboutHtml}

    ${minifigsCard}

    ${galleryHtml}

    ${ownedSecondary}
    ${externalLinks}`;
}

function wireInfoTab(set) {
  loadSetHistory(set.set_num);
  loadSetImages(set.set_num);
  hydrateAmazonSlots(document, state.me?.retail_market || 'FR');

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

  $("#pricingDetailsBtn")?.addEventListener("click", () => {
    const content = $("#pricingDetailsTemplate")?.innerHTML || "";
    showSheet(`
      <div class="sheet-title-row pricing-details-sheet-head">
        <div>
          <div class="u-mono-label">Market evidence</div>
          <h2 id="pricingDetailsSheetTitle" class="u-serif-h pricing-details-sheet-title">Pricing details</h2>
        </div>
        <button type="button" class="icon-btn" id="pricingDetailsClose" aria-label="Close">${I.close()}</button>
      </div>
      <div class="pricing-details-sheet">${content}</div>`);
    $("#sheet")?.setAttribute("aria-labelledby", "pricingDetailsSheetTitle");
    $("#pricingDetailsClose")?.addEventListener("click", hideSheet);
  });
}

// Action handlers for the sticky action bar (add / qty / wishlist / sell).
// Wired from paintSetDetail on every tab so the bar always works — the bar
// lives outside the swappable tab panel.
function wireDetailActions(set, entry) {
  let qty = entry?.quantity || 1;
  // "Manage" in the action bar: switch to the Manage tab in place instead of a
  // hash navigation. The hash route re-runs renderSetDetail (cache paint + a
  // background refresh paint) which visibly blinks; an in-place switch doesn't.
  // Scroll the tab bar into view so it's obvious the section changed, and keep
  // the URL in sync without triggering the router.
  $("#manageBtn")?.addEventListener("click", () => {
    haptic("light");
    switchDetailTab("manage", set, entry);
    history.replaceState(null, "", `#/set/${encodeURIComponent(set.set_num)}/manage`);
    document.querySelector("#detailTabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#qtyDown")?.addEventListener("click", async () => {
    haptic("medium");
    // At one, minus removes the set from the vault (with a confirm) rather than
    // being a dead no-op — that was the only way people expected to remove a set.
    if (qty <= 1) {
      const ok = await confirmSheet({
        title: "Remove from vault?",
        message: `Remove ${set.name} from your vault? Your notes and quantity for this set will be cleared.`,
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      try {
        // Keep the payload so a mis-tap after the confirm is still recoverable
        // — soft deletes make re-POSTing the entry a faithful restore.
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
            const r2 = await api("/api/sets/" + encodeURIComponent(set.set_num));
            state.detail.cache[set.set_num] = { set: r2.set || r2, entry: r2.entry || null, ts: Date.now() };
            paintSetDetail(r2.set || r2, r2.entry || null);
            toast("Restored to vault", "success");
          } catch { toast("Couldn't restore — add it again from the catalog.", "error"); }
        });
        const r = await api("/api/sets/" + encodeURIComponent(set.set_num));
        state.detail.tab = "info";
        state.detail.cache[set.set_num] = { set: r.set || r, entry: r.entry || null, ts: Date.now() };
        paintSetDetail(r.set || r, r.entry || null);
      } catch (_e) { toast("Remove failed", "error"); }
      return;
    }
    qty--;
    $("#qtyNum").textContent = qty;
    const badge = $("#qtyBadgeVal");
    if (badge) badge.textContent = `×${qty}`;
    // Lowering quantity lowers the total — refresh the milestone baseline (won't
    // celebrate on a decrease) so re-raising it can cross a threshold again.
    try { await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } }); invalidatePortfolio(); maybeCelebrateMilestone(setHue(set)); }
    catch (_e) { toast("Save failed", "error"); }
  });
  $("#qtyUp")?.addEventListener("click", async () => {
    haptic("medium");
    qty++;
    $("#qtyNum").textContent = qty;
    const badge = $("#qtyBadgeVal");
    if (badge) badge.textContent = `×${qty}`;
    // Raising quantity raises the total — this can cross a value milestone, so
    // run the same milestone check the Add button does.
    try { await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } }); invalidatePortfolio(); maybeCelebrateMilestone(setHue(set)); }
    catch (_e) { toast("Save failed", "error"); }
  });
  $("#genListingBtn")?.addEventListener("click", () => {
    haptic("medium");
    openListingDraftSheet(set.set_num);
  });
  $("#addBtn")?.addEventListener("click", async (e) => {
    if (state.pendingRequests.has(set.set_num)) return;
    state.pendingRequests.add(set.set_num);
    haptic("heavy");
    setBtnLoading(e.currentTarget, true);
    try {
      const displayVal = setDisplayValue(set);
      const addResult = await api("/api/collection", { method: "POST", body: { set_num: set.set_num, quantity: 1, purchase_price: displayVal } });
      invalidatePortfolio(); state.catalog.items = []; markSetOwned(set.set_num, true);
      toast("Added to vault", "success");
      if (addResult?.kids?.xp_gained > 0) {
        const { xp_gained, new_level, new_badges } = addResult.kids;
        setTimeout(() => toast(`+${xp_gained} XP!`, "success"), 500);
        // A new badge or level-up is a real win — give it the celebration popup
        // (kid-friendly copy). Routine XP stays a quick toast.
        const badge = new_badges?.[0];
        const kidHue = setHue(set);
        if (badge) setTimeout(() => celebrate(`New badge: ${badge.replace(/_/g, " ")}! 🎉`, { quip: "You're a building superstar! 🌟", hue: kidHue }), 900);
        else if (new_level) setTimeout(() => celebrate(`Level ${new_level} reached! 🎉`, { quip: "Keep on building! 🧱", hue: kidHue }), 900);
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
        outboxEnqueue({ path: '/api/collection', method: 'POST', body: { set_num: set.set_num, quantity: 1, purchase_price: setDisplayValue(set) } });
        toast('Saved offline — will sync when connected', 'info');
      } else { toast("Error: " + e.message, "error"); }
    } finally { state.pendingRequests.delete(set.set_num); }
  });
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
            toast("Error: " + err.message, "error");
          }
        });
      }
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { state.pendingRequests.delete(wishKey); }
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
      ${set.be_growth_12m != null ? `<p style="margin:8px 0 0;font-size:12px;color:var(--ink-soft);">Past year: <strong style="color:${set.be_growth_12m >= 0 ? 'var(--up)' : 'var(--down)'};">${set.be_growth_12m >= 0 ? 'Up ' : 'Down '}${Math.abs(Number(set.be_growth_12m)).toFixed(1)}%</strong></p>` : ''}
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

function manageTabHTML(set, entry) {
  if (!entry) return `<p style="color:var(--ink-mute);">Not in your vault.</p>`;
  return `
    <div class="manage-save-bar">
      <span class="u-mono-label">Set details</span>
      <span id="manageSaveState" class="badge badge--neutral" aria-live="polite" style="visibility:hidden;">Saved ✓</span>
    </div>
    <fieldset class="form-group manage-group">
      <legend class="u-mono-label u-mb-1">Purchase</legend>
      <div class="field">
        <div class="field-lbl">Purchase price</div>
        <input id="mPrice" type="number" step="0.01" value="${moneyInputValue(entry.purchase_price)}" placeholder="0.00" inputmode="decimal">
        <div class="field-err" id="mPriceErr"></div>
      </div>
      <div class="field">
        <div class="field-lbl">Purchase date</div>
        <input id="mDate" type="date" value="${entry.purchased_at ? entry.purchased_at.slice(0,10) : ""}">
      </div>
      <div class="field">
        <div class="field-lbl">Acquisition source</div>
        <select id="mAcquisition">
          <option value="" ${!entry.acquisition_source ? "selected" : ""}>— select —</option>
          ${["Store","BrickLink","eBay","Facebook Marketplace","Trade","Gift","Other"].map(s =>
            `<option value="${s}" ${entry.acquisition_source === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </div>
    </fieldset>
    <fieldset class="form-group manage-group">
      <legend class="u-mono-label u-mb-1">Condition</legend>
      <div class="field">
        <div class="field-lbl">Condition</div>
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
          <input type="number" id="mMissing" min="0" value="${entry.missing_pieces || 0}" placeholder="0">
          <span style="font-size:13px;color:var(--ink-mute);">pieces missing</span>
        </div>
      </div>
    </fieldset>
    <fieldset class="form-group manage-group">
      <legend class="u-mono-label u-mb-1">Storage &amp; notes</legend>
      <div class="field">
        <div class="field-lbl">Storage location</div>
        <input id="mStorage" type="text" value="${escapeHtml(entry.storage_location || "")}" placeholder="e.g. Display shelf A3, Attic box 2" list="storageLocations">
        <datalist id="storageLocations"></datalist>
      </div>
      <div class="field">
        <div class="field-lbl">Notes</div>
        <textarea id="mNotes" placeholder="Story, details, anything…">${escapeHtml(entry.notes || "")}</textarea>
      </div>
    </fieldset>
    <details class="card" style="padding:12px 16px;margin-bottom:14px;" ${entry.purchase_price ? "open" : ""}>
      <summary class="u-mono-label" style="cursor:pointer;list-style-position:inside;">Flip calculator</summary>
      <div id="mFlipCalcContainer">${flipCalcHTML(set, entry)}</div>
    </details>

    <div class="detail-card" id="partsCard">
      <div class="detail-card-title" style="justify-content:space-between;">
        <span>Parts completeness</span>
        <button class="btn-secondary" id="loadPartsBtn" style="font-size:11px;padding:4px 10px;">Refresh parts</button>
      </div>
      <div id="partsContent" style="font-size:13px;color:var(--ink-mute);line-height:1.45;">
        Compares the official parts list with missing pieces you mark for this set. 100% means no missing parts are recorded.
      </div>
    </div>

    <div class="detail-card">
      <div class="detail-card-title">Custom photo</div>
      ${entry.custom_image_url ? `
        <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;">
          <img id="customPhotoImg" alt="Custom photo" style="width:80px;height:80px;object-fit:cover;border-radius:var(--r-1);border:1px solid var(--line);background:var(--surface-2);">
          <button id="removePhotoBtn" class="btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--down);">Remove photo</button>
        </div>
      ` : `<p style="font-size:12px;color:var(--ink-mute);margin-bottom:10px;">Upload your own photo for this set.</p>`}
      <input type="file" id="photoUpload" accept="image/jpeg,image/png,image/webp" style="display:none;">
      <button class="btn-secondary" id="photoUploadBtn" style="font-size:12px;padding:6px 12px;">${I.camera ? I.camera() : "📷"} Upload photo</button>
      <div id="photoUploadStatus" style="font-size:11px;color:var(--ink-mute);margin-top:6px;display:none;"></div>
    </div>

    ${isGuestMode() ? "" : `
    <div class="detail-card" id="storyCard">
      <div class="detail-card-title">Story</div>
      <div id="storyTimeline" style="display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--ink-mute);">Loading…</div>
      <div class="field" style="margin-top:10px;">
        <input id="storyInput" type="text" maxlength="1000" placeholder="Add a memory — a gift, a build day, a great find…">
      </div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn-secondary" id="storyAddNote" style="font-size:12px;padding:6px 12px;">${I.plus()}<span>Add memory</span></button>
        <button class="btn-secondary" id="storyAddPhoto" style="font-size:12px;padding:6px 12px;">${I.camera ? I.camera() : "📷"}<span>Add photo</span></button>
        <input type="file" id="storyPhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none;">
      </div>
    </div>`}
      ${sellTimingHTML(set, entry)}
      <button class="btn-secondary" id="mSold" style="margin-top:14px;">${I.tag()}<span>Sell this set…</span></button>
      <button class="btn-danger" id="mRemove" style="margin-top:8px;">${I.trash()}<span>Remove from vault</span></button>
      <button class="btn-secondary" id="mListSale" style="margin-top:8px;">${I.tag()}<span>List for Sale</span></button>`;
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
      <div style="font-size:12px;color:var(--ink-mute);line-height:1.5;">${escapeHtml(s.reasons.join(" · "))}</div>
    </div>`;
}

// Story timeline: the set's memories (notes + photos) plus the automatic
// lifecycle events. Signed-in only — stories live on the account.
async function wireStoryCard(_set, entry) {
  const timeline = $("#storyTimeline");
  if (!timeline || !entry?.id) return;

  const render = (stories) => {
    const items = stories.map(s => `
      <div class="story-item" data-story="${s.id}" style="display:flex;gap:8px;align-items:flex-start;background:var(--surface-2);border:1px solid var(--line-soft);border-radius:var(--r-1);padding:8px 10px;">
        <div style="flex:1;min-width:0;">
          ${s.kind === "photo" ? `<img class="story-photo" data-story-photo="${s.id}" alt="" style="max-width:100%;border-radius:var(--r-1);margin-bottom:${s.body ? "6px" : "0"};">` : ""}
          ${s.body ? `<div style="color:var(--ink);line-height:1.45;">${escapeHtml(s.body)}</div>` : ""}
          <div style="font-size:10px;color:var(--ink-faint);font-family:var(--mono);margin-top:3px;">${escapeHtml(String(s.created_at || "").slice(0, 10))}</div>
        </div>
        <button class="story-del" data-story-del="${s.id}" aria-label="Delete memory" style="border:none;background:none;color:var(--ink-faint);cursor:pointer;padding:2px;">${I.close({ w: 14, h: 14 })}</button>
      </div>`).join("");
    const auto = `
      <div style="font-size:11px;color:var(--ink-faint);">
        ${entry.purchased_at ? `${I.check({ w: 12, h: 12 })} Acquired ${escapeHtml(String(entry.purchased_at).slice(0, 10))}${entry.acquisition_source ? ` · ${escapeHtml(entry.acquisition_source)}` : ""}` : `${I.check({ w: 12, h: 12 })} In your vault`}
      </div>`;
    timeline.innerHTML = (items || `<div style="font-size:12px;">No memories yet — the story starts with you.</div>`) + auto;

    timeline.querySelectorAll("[data-story-photo]").forEach(img => {
      customPhotoObjectURL(`/api/collection/story/${img.dataset.storyPhoto}/photo`).then(url => { if (url) img.src = url; });
    });
    timeline.querySelectorAll("[data-story-del]").forEach(btn => btn.addEventListener("click", async () => {
      haptic("light");
      try {
        await api(`/api/collection/story/${btn.dataset.storyDel}`, { method: "DELETE" });
        btn.closest(".story-item")?.remove();
      } catch (e) { toast("Couldn't delete: " + e.message, "error"); }
    }));
  };

  const load = async () => {
    try {
      const r = await api(`/api/collection/${entry.id}/story`);
      render(r.stories || []);
    } catch { timeline.innerHTML = `<div style="font-size:12px;">Story unavailable right now.</div>`; }
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
    } catch (e) { toast("Couldn't save: " + e.message, "error"); }
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
    } catch (err) { toast("Couldn't upload: " + err.message, "error"); }
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
      toast("Save failed: " + e.message, "error");
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
      } else { toast("Error: " + e.message, "error"); }
    }
  });
  $("#mSold")?.addEventListener("click", () => showExitCopilotSheet(set, entry));
  $("#mListSale")?.addEventListener("click", () => showListingSheet(set, entry));

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
    if (statusEl) { statusEl.textContent = "Uploading…"; statusEl.style.display = "block"; }
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
      if (statusEl) { statusEl.textContent = "Upload failed: " + err.message; statusEl.style.display = "block"; }
      toast("Upload failed: " + err.message, "error");
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
    } catch (err) { toast("Remove failed: " + err.message, "error"); }
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
          <span style="color:var(--ink-mute);font-size:12px;">complete${total_missing > 0 ? ` · ${total_missing} parts missing` : " · all parts present"}</span>
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
            ${missingParts.length > 20 ? `<div style="color:var(--ink-mute);font-size:11px;">+${missingParts.length - 20} more</div>` : ''}
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
      const tb = e.target.closest("#detailTabs button");
      if (tb) { haptic("light"); switchDetailTab(tb.dataset.tab, _detailCtx.set, _detailCtx.entry); }
    } catch (err) { console.warn("[detail-delegation]", err); }
  });
}

function switchDetailTab(tab, set, entry) {
  state.detail.tab = tab;
  const isWish = state.wishlist.some(w => w.set_num === set.set_num);
  $$("#detailTabs button").forEach(x => {
    const on = x.dataset.tab === tab;
    x.classList.toggle("active", on);
    x.setAttribute("aria-selected", on ? "true" : "false");
  });
  const panel = $("#tabPanels");
  if (!panel) return;
  mount(panel, tab === "info" ? infoTabHTML(set, entry, isWish)
    : tab === "forecast" ? forecastTabHTML(set)
    : tab === "community" ? communityTabHTML(set)
    : manageTabHTML(set, entry));
  if (tab === "info") wireInfoTab(set, entry);
  else if (tab === "manage") wireManageTab(set, entry);
  else if (tab === "community") wireCommunityTab(set);
}

/* ============================================================
   Community tab — reviews, photo gallery, data-fix contributions
   ============================================================ */
function communityTabHTML(set) {
  const guest = isGuestMode();
  return `
    <div class="tab-section community-tab" data-set="${escapeHtml(set.set_num)}">
      <div class="community-actions">
        <button class="btn-secondary contrib-act" data-act="review">★ Write a review</button>
        <button class="btn-secondary contrib-act" data-act="photo">📷 Add photo</button>
        <button class="btn-secondary contrib-act" data-act="fix">🛠 Suggest a fix</button>
      </div>
      <div class="community-mode-note ${guest ? "guest" : "member"}">
        ${guest
          ? "Guest mode can browse community content. Sign in before contributing so your review, photo, or fix can be reviewed and credited."
          : "Contributions are reviewed before becoming public, keeping shared set data trustworthy."}
      </div>
      <div id="communityBody" class="community-body">
        <div class="u-mute" style="text-align:center;padding:24px 0;">Loading community content…</div>
      </div>
    </div>`;
}

function starRow(n) {
  const full = Math.round(n);
  return `<span class="star-row" aria-label="${n} out of 5">${[1,2,3,4,5].map(i => `<span style="opacity:${i <= full ? 1 : 0.25};">★</span>`).join("")}</span>`;
}

async function wireCommunityTab(set) {
  const refresh = () => wireCommunityTab(set);
  const labels = {
    review: `${I.star({w:16})}<span>Write a review</span>`,
    photo: `${I.camera({w:16})}<span>Add photo</span>`,
    fix: `${I.pencil({w:16})}<span>Suggest a fix</span>`,
  };
  $$(".community-tab .contrib-act").forEach(b => {
    if (labels[b.dataset.act] && !b.querySelector("svg")) b.innerHTML = labels[b.dataset.act];
    b.addEventListener("click", () => {
      haptic("light");
      const act = b.dataset.act;
      if (act === "review") openReviewSheet(set.set_num, refresh);
      else if (act === "photo") openPhotoSheet(set.set_num, refresh);
      else openDataFixSheet(set.set_num, refresh);
    });
  });

  const body = $("#communityBody");
  if (!body) return;
  let data;
  try {
    data = await api("/api/contributions/sets/" + encodeURIComponent(set.set_num));
  } catch {
    body.innerHTML = `<div style="text-align:center;padding:24px 0;">
      <div class="u-mute" style="margin-bottom:12px;">Couldn't load community content.</div>
      <button class="btn-secondary" id="communityRetry" style="width:auto;padding:8px 18px;">Retry</button>
    </div>`;
    $("#communityRetry")?.addEventListener("click", () => wireCommunityTab(set));
    return;
  }
  if (!location.hash.includes(set.set_num) || state.detail.tab !== "community") return;

  const pending = (data.mine || []).filter(m => m.status === "pending").length;
  const ratingHTML = data.rating?.count
    ? `<div class="community-rating">${starRow(data.rating.avg)} <b>${data.rating.avg.toFixed(1)}</b> <span class="u-mute">· ${data.rating.count} review${data.rating.count === 1 ? "" : "s"}</span></div>`
    : `<div class="u-mute community-rating">No ratings yet — be the first.</div>`;

  const reviewsHTML = (data.reviews || []).length
    ? data.reviews.map(r => `
        <div class="community-review">
          <div class="cr-head">${starRow(r.rating)}${r.title ? `<b>${escapeHtml(r.title)}</b>` : ""}</div>
          ${r.body ? `<div class="cr-body">${escapeHtml(r.body)}</div>` : ""}
          <div class="cr-meta u-mute">${r.author ? `${escapeHtml(r.author)} · ` : ""}${fmtDateUpdated(r.created_at)}</div>
        </div>`).join("")
    : "";

  const photosHTML = (data.photos || []).length
    ? `<div class="bs-gallery community-gallery no-tab-swipe">${data.photos.map(p =>
        `<figure class="community-photo"><img loading="lazy" src="${(window.WORKER_BASE || "") + p.url}" alt="${escapeHtml(p.caption || set.name)}">${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}</figure>`
      ).join("")}</div>`
    : "";

  const pricesHTML = (data.prices || []).length
    ? `<div class="community-prices"><div class="cs-title">Community-reported sales</div>${data.prices.map(p =>
        `<div class="cp-row"><span>${fmtMoney(p.price)} <span class="u-mute">(${escapeHtml(p.condition || "new")})</span></span><span class="u-mute">${fmtDateUpdated(p.at)}</span></div>`
      ).join("")}</div>`
    : "";

  body.innerHTML = `
    ${ratingHTML}
    ${pending ? `<div class="community-pending">⏳ You have ${pending} submission${pending === 1 ? "" : "s"} awaiting approval.</div>` : ""}
    ${photosHTML ? `<div class="cs-title">Photos</div>${photosHTML}` : ""}
    ${reviewsHTML ? `<div class="cs-title">Reviews</div>${reviewsHTML}` : ""}
    ${pricesHTML}
    ${!reviewsHTML && !photosHTML && !pricesHTML ? `<div class="u-mute" style="text-align:center;padding:18px 0;">No community content yet. Add the first review, photo, or fix above.</div>` : ""}`;
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
// Exit copilot: one sheet that answers "how do I sell this well?" — the
// timing read, a price recommendation with the fee math, a jump into the AI
// listing generator, and finally logging the real sale (which feeds the
// anonymized community comps).
function showExitCopilotSheet(set, entry) {
  const signal = isSimpleMode() || isKidsMode() ? null : sellSignalFor(set, entry);
  const market = marketValueForCondition(set, entry?.condition || "new");
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const calc = market ? flipEconomics({ marketUsd: market, rate, feePct, paymentPct, shipping }) : null;
  const paid = Number(entry?.purchase_price) || 0;

  const look = signal ? {
    sell: { label: "Good time to sell", color: "var(--up)" },
    watch: { label: "Worth watching", color: "var(--accent)" },
    hold: { label: "Consider holding", color: "var(--ink-mute)" },
  }[signal.signal] : null;

  showSheet(`
    <div style="font-family:var(--serif);font-size:20px;font-weight:500;margin:0 4px 12px;">Sell ${escapeHtml(set.name || set.set_num)}</div>
    ${signal ? `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span class="badge" style="background:${look.color};color:#fff;">${look.label}</span>
        <span style="font-size:12px;color:var(--ink-mute);">${escapeHtml(signal.reasons.join(" · "))}</span>
      </div>` : ""}
    ${market ? `
      <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;background:var(--surface-2);border:1.5px solid var(--line-soft);border-radius:var(--r-2);padding:12px 14px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;"><span style="color:var(--ink-mute);">Ask around</span><strong>${estMark(set)}${fmtMoney(market)}</strong></div>
        ${calc ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--ink-mute);">≈ in your pocket after fees</span><strong>${fmtMoney(calc.net / rate)}</strong></div>` : ""}
        ${paid > 0 && calc ? `<div style="display:flex;justify-content:space-between;"><span style="color:var(--ink-mute);">vs what you paid</span><strong style="color:${calc.net / rate >= paid ? "var(--up)" : "var(--down)"};">${calc.net / rate >= paid ? "+" : ""}${fmtMoney(calc.net / rate - paid)}</strong></div>` : ""}
      </div>` : ""}
    <button class="btn-secondary" id="exitGenListing" style="width:100%;margin-bottom:14px;">${I.sparkles()}<span>Generate eBay listing</span></button>
    <div class="field">
      <div class="field-lbl">Sold price (before fees)</div>
      <input id="exitSoldPrice" type="number" step="0.01" inputmode="decimal" placeholder="e.g. ${market ? Math.round(market) : "189.99"}">
      <div style="font-size:11px;color:var(--ink-mute);margin-top:4px;">Real sale prices power the community price signal — anonymized, never shown individually.</div>
    </div>
    <div class="btn-row" style="margin-top:12px;">
      <button class="btn-secondary" id="exitCancel">Cancel</button>
      <button class="btn-primary" id="exitConfirmSold">${I.tag()}<span>Mark sold</span></button>
    </div>`);

  $("#exitCancel")?.addEventListener("click", hideSheet);
  $("#exitGenListing")?.addEventListener("click", () => { hideSheet(); showListingSheet(set, entry); });
  $("#exitConfirmSold")?.addEventListener("click", async () => {
    const price = sanitizeMoneyInput(String($("#exitSoldPrice")?.value ?? ""));
    if (price == null || price <= 0) { toast("Enter the sale price as a number", "error"); return; }
    haptic("heavy");
    try {
      await api("/api/collection/sell", { method: "POST", body: { set_num: set.set_num, sold_price: price } });
      hideSheet();
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      markSetOwned(set.set_num, false);
      toast(`Sold for ${fmtMoney(price)} — removed from vault`, "success");
      go("#/");
    } catch (e) { toast("Error: " + e.message, "error"); }
  });
}

async function showListingSheet(set, _entry) {
  showSheet(`
    <div style="font-family:var(--serif);font-size:20px;font-weight:500;margin:0 4px 12px;">Generate eBay Listing</div>
    <div class="listing-sheet" id="listingContent">
      <div style="text-align:center;padding:40px 0;color:var(--ink-mute);">
        ${I.sparkles()}
        <div style="margin-top:8px;font-size:13px;">Generating listing…</div>
      </div>
    </div>`);

  try {
    const geminiKey = localStorage.getItem('bv_gemini_key');
    const openaiKey = localStorage.getItem('bv_openai_key');
    const extraHeaders = {};
    if (geminiKey) extraHeaders['X-Gemini-Key'] = geminiKey;
    else if (openaiKey) extraHeaders['X-OpenAI-Key'] = openaiKey;
    const draft = await api("/api/sets/" + encodeURIComponent(set.set_num) + "/listing-draft", {
      method: "POST", headers: extraHeaders,
    });

    const content = document.getElementById("listingContent");
    if (!content) return;

    content.innerHTML = `
      <div class="listing-field-label">Title</div>
      <input class="listing-title-input" id="listTitle" type="text" value="${escapeHtml(draft.title || "")}">

      <div class="listing-field-label" style="margin-top:14px;">Description</div>
      <textarea class="listing-desc-textarea" id="listDesc" rows="6">${escapeHtml(draft.description || "")}</textarea>

      <div class="listing-price-row">
        <div>
          <div class="listing-field-label">Suggested price</div>
          <div style="font-family:var(--mono);font-size:22px;font-weight:600;">${fmtMoney(draft.suggested_price)}</div>
        </div>
      </div>
      ${draft.price_reasoning ? `<div class="listing-reasoning">${escapeHtml(draft.price_reasoning)}</div>` : ""}

      <div class="listing-actions">
        <button class="btn-secondary" id="copyListTitle">${I.check()}<span>Copy title</span></button>
        <button class="btn-secondary" id="copyListDesc">${I.check()}<span>Copy description</span></button>
        <a class="btn-primary listing-ebay-btn" href="${escapeHtml(`https://www.ebay.com/sl/list?title=${encodeURIComponent((draft.title || "").slice(0, 80))}`)}" target="_blank" rel="noopener">${I.arrowR()}<span>Open eBay</span></a>
      </div>`;

    document.getElementById("copyListTitle")?.addEventListener("click", () => copyListingField(draft.title || "", "Title"));
    document.getElementById("copyListDesc")?.addEventListener("click", () => copyListingField(draft.description || "", "Description"));
  } catch (err) {
    const content = document.getElementById("listingContent");
    if (content) content.innerHTML = `<p style="color:var(--down);font-size:13px;padding:16px 0;">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function copyListingField(text, label) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast(`${label} copied`, "success"))
      .catch(() => _fallbackCopy(text, label));
  } else {
    _fallbackCopy(text, label);
  }
}

function _fallbackCopy(text, label) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast(`${label} copied`, "success"); } catch {}
  document.body.removeChild(ta);
}

async function openListingDraftSheet(setNum) {
  try {
    let cached = state.detail.cache[setNum];
    if (!cached) {
      const res = await api("/api/sets/" + encodeURIComponent(setNum));
      cached = { set: res.set || res, entry: res.entry || null };
    }
    await showListingSheet(cached.set, cached.entry);
  } catch (err) {
    toast("Error loading set details: " + err.message, "error");
  }
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
      <label class="field-lbl">Target Price (${symbol})</label>
      <input type="number" step="0.01" id="wlTargetPrice" class="field-input" placeholder="0.00" autocomplete="off" value="${suggestedLocal > 0 ? suggestedLocal.toFixed(2) : ''}">
      <div id="wlSuggestedChip" style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:4px 8px;background:var(--surface-3);border:1px solid var(--line);border-radius:12px;font-size:12px;cursor:pointer;color:var(--ink);">
        ${I.sparkles({ w: 14 })} Suggested: ${symbol}${suggestedLocal.toFixed(2)}
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
        <span style="color:var(--ink-mute);">Marketplace Fee (${feePct}%)</span>
        <span style="color:var(--bv-red); font-family: var(--mono); font-weight: 500;">-${symbol}${ebayFee.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line-soft);padding-bottom:6px;">
        <span style="color:var(--ink-mute);">Payment Fee (${paymentPct}% + fixed)</span>
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


async function loadSetHistory(setNum) {
  const el = $("#setSpark");
  if (!el) return;
  try {
    const res = await api("/api/sets/" + encodeURIComponent(setNum) + "/history?days=90");
    const hist = res.history || [];
    if (hist.length >= 2) {
      const up = Number(hist[hist.length - 1].current_value) >= Number(hist[0].current_value);
      const hasPts = (key) => hist.filter(h => Number(h?.[key]) > 0).length >= 2;
      const series = [
        { key: "bl_value", color: "var(--ink-mute)", dash: "2 3", label: "Market" },
        { key: "ebay_value", color: "var(--bv-yellow-dark)", dash: "5 4", label: "Resale" },
      ].filter(s => hasPts(s.key));
      drawSparkline(el, hist, { up, series });
      const legendEl = $("#setSparkLegend");
      if (legendEl) {
        legendEl.innerHTML = series.length
          ? [{ color: up ? "var(--up)" : "var(--down)", dash: "", label: "Value" }, ...series]
              .map(s => `<span class="spark-key"><svg width="14" height="4" viewBox="0 0 14 4"><line x1="0" y1="2" x2="14" y2="2" stroke="${s.color}" stroke-width="2"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/></svg>${s.label}</span>`)
              .join("")
          : "";
      }
    } else {
      el.style.height = "auto";
      el.innerHTML = `<div class="spark-empty">${I.info()}<span>Price tracking just started — check back soon for a trend.</span></div>`;
    }
  } catch {
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
    const res = await api("/api/sets/" + encodeURIComponent(setNum) + "/images");
    const imgs = (res && Array.isArray(res.images)) ? res.images.filter(u => typeof u === "string") : [];
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
