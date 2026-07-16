import { $, $$, haptic, escapeHtml, toast, undoToast, fmtMoney, fmtPct, daysAgo, prefersReducedMotion, themeHue, THEME_COLORS, fmtShortDate, drawSparkline, slImgHTML, trendBadgeHTML, CURRENCY_SYMBOLS, getExchangeRate, ratesUnavailable, fmtMoneyShort, bvIDB, SEARCH_DEBOUNCE_MS, recordPortfolioMilestone, publicOrigin } from '../utils.js';
import { marketValueForCondition, computeSpreadSignals, estMark, displayValueOf } from '../lib/pure.js';
import { state, invalidatePortfolio, markSetOwned } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { shareContent } from '../lib/native-share.js';
import { I } from '../icons.js';
import { showSheet, hideSheet, confirmSheet, promptSheet } from '../components/sheet.js';
import { trustBadgeHTML } from '../components/trust.js';
import { skelPage, skelHero, skelCardList } from '../components/skeleton.js';
import { getModePref } from '../theme.js';


/* ============================================================
   Portfolio screen
   ============================================================ */
export async function renderPortfolio() {
  const servedFromCache = !!state.portfolio;
  if (!state.portfolio) {
    $("#root").innerHTML = skelPage(skelHero() + skelCardList(5));
    // Fetch collection independently — if history or wishlist fail the vault
    // still renders correctly (they were in one Promise.all before, causing any
    // single failure to blank the whole vault while /api/me still showed the count).
    try {
      state.portfolio = await api("/api/collection");
      bvIDB.set('portfolio', { data: state.portfolio, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
    } catch (e) {
      toast("Couldn't load collection: " + e.message, "error");
      state.portfolio = { items: [], total_value: 0, total_paid: 0, count: 0 };
    }
    // History + wishlist are supplementary — fetch best-effort.
    const [hist, wl] = await Promise.all([
      api("/api/collection/history?days=365").catch(() => null),
      api("/api/wishlist").catch(() => null),
    ]);
    state.portfolioHistory = hist ? (hist.snapshots || []) : (state.portfolioHistory || []);
    // Server-declared tier for the history window (free = 90 days, Pro = 365).
    // Drives the honest "1Y ⭐" pills + the Insights gate instead of silently
    // truncating the chart. Falsy for guests (local vaults have no entitlement).
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
  }
  paintPortfolio();
  // Stale-while-revalidate: when painted from in-memory cache, refresh in the
  // background so cron/valuation price updates surface without a manual reload.
  if (servedFromCache) _revalidatePortfolio();
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
    const hash = location.hash.replace("#", "") || "/";
    if (changed && (hash === "/" || hash === "")) paintPortfolio();
  } catch {
    // network / offline — keep stale data
  } finally {
    _revalidating = false;
  }
}

// Portfolio value basis (Approach A): prefer the persisted blended market value
// (valuation v2), falling back to the formula current_value. Keeps the vault
// cards, value sort, and analytics consistent with the blended portfolio total
// the server now returns.
function pval(x) {
  // Used holdings are worth their used-market price; new/sealed keep the v2
  // blended fair value via the shared displayValueOf chain (market_value →
  // blended_value → current_value) so vault, catalog and detail show ONE number.
  if (String(x?.condition || '').startsWith('used')) {
    return Number(marketValueForCondition(x, x.condition)) || displayValueOf(x);
  }
  return displayValueOf(x);
}

// Filter + sort the vault items according to current state.filter. Pure — no DOM.
function sortedPortfolioItems() {
  // Null-safe: invalidatePortfolio() sets state.portfolio to null between a
  // mutation and the refetch, and any repaint in that window must not throw.
  const p = state.portfolio || { items: [] };
  let items = (p.items || []).slice();
  const q = state.filter.q.toLowerCase().trim();
  if (q) items = items.filter(i => i.name?.toLowerCase().includes(q) || i.set_num?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q));
  switch (state.filter.sort) {
    case "added_desc": items.sort((a, b) => new Date(b.added_at) - new Date(a.added_at)); break;
    case "value_desc": items.sort((a, b) => pval(b) - pval(a)); break;
    case "roi_desc":   items.sort((a, b) => (b.annualized_roi ?? -1) - (a.annualized_roi ?? -1)); break;
    case "az":         items.sort((a, b) => a.name?.localeCompare(b.name)); break;
  }
  return items;
}

// Re-render ONLY the set list + wire its cards. Used by sort/search so the
// hero, chart and topbar don't flash from a full-page re-render.
let portfolioOffset = 20;
function wireSortChips() {
  $$(".filter-row .chip").forEach(c => c.addEventListener("click", () => {
    state.filter.sort = c.dataset.sort; localStorage.setItem("bv_sort", c.dataset.sort); haptic("light");
    $$(".filter-row .chip").forEach(x => x.classList.toggle("active", x.dataset.sort === state.filter.sort));
    repaintSetList();
  }));
}

function repaintSetList() {
  const list = $("#setList");
  if (!list) return;
  const items = sortedPortfolioItems();
  
  if (items.length === 0) {
    list.innerHTML = emptyVaultHTML();
    if (state._portfolioObserver) {
      state._portfolioObserver.disconnect();
      state._portfolioObserver = null;
    }
    return;
  }
  
  list.className = `set-list ${state.compactView ? 'compact-list' : ''}`;
  
  portfolioOffset = 20;
  const firstPage = items.slice(0, portfolioOffset);
  list.innerHTML = firstPage.map(setListCardHTML).join("") + `
    <div id="portfolioSentinel" style="height: 20px; display: flex; align-items: center; justify-content: center; margin-top: 10px;">
      ${items.length > portfolioOffset ? `<div class="spinner"></div>` : ''}
    </div>
  `;
  
  wirePortfolioCards();
  setupPortfolioSentinel(items);
}

function wirePortfolioCards() {
  $$(".set-list-card").forEach(card => {
    if (card.dataset.wired) return;
    card.dataset.wired = "true";
    
    card.addEventListener("click", (e) => {
      if (state.selectionMode) {
        e.preventDefault();
        e.stopPropagation();
        const id = card.dataset.id;
        const nowSelected = !state.selectedSets.has(id);
        if (nowSelected) state.selectedSets.add(id); else state.selectedSets.delete(id);
        haptic("light");
        // Toggle THIS card's checkbox in place — a full repaintSetList() rebuilds
        // every card's <img>, which makes the set photos blink on each tick.
        const cb = card.querySelector(".card-checkbox");
        if (cb) {
          cb.classList.toggle("checked", nowSelected);
          cb.style.background = nowSelected ? "var(--up)" : "transparent";
          cb.innerHTML = nowSelected ? I.check({ w: 12, h: 12 }) : "";
        }
        card.classList.toggle("selected", nowSelected);
        updateSelectionBar();
      } else {
        haptic("light");
        location.hash = "#/set/" + encodeURIComponent(card.dataset.set);
      }
    });
    
    wireLongPress(card, () => {
      if (!state.selectionMode) {
        enterSelectionMode(card.dataset.id);
      }
    });
  });
}

function wireLongPress(el, callback) {
  let timer = null;
  const start = () => {
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, 700);
  };
  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("touchend", cancel, { passive: true });
  el.addEventListener("touchmove", cancel, { passive: true });
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", cancel);
  el.addEventListener("mouseleave", cancel);
}

function setupPortfolioSentinel(items) {
  const sentinel = $("#portfolioSentinel");
  const list = $("#setList");
  if (!sentinel || !list) return;
  if (state._portfolioObserver) state._portfolioObserver.disconnect();
  if (items.length <= portfolioOffset) {
    sentinel.style.display = "none";
    return;
  }
  
  state._portfolioObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && items.length > portfolioOffset) {
      const nextPage = items.slice(portfolioOffset, portfolioOffset + 20);
      portfolioOffset += 20;
      
      sentinel.remove();
      
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = nextPage.map(setListCardHTML).join("");
      
      while (tempDiv.firstChild) {
        list.appendChild(tempDiv.firstChild);
      }
      
      list.appendChild(sentinel);
      wirePortfolioCards();
      
      if (portfolioOffset >= items.length) {
        sentinel.style.display = "none";
        state._portfolioObserver.disconnect();
      }
    }
  }, { rootMargin: "200px" });
  state._portfolioObserver.observe(sentinel);
}

function paintPortfolio() {
  const p = state.portfolio;
  // Full innerHTML repaints reset the scroll position — a state change while
  // deep in a long vault list used to jump the user back to the top. Save and
  // restore it (the list content is the same page, so the offset stays valid).
  const scrollYBefore = window.scrollY;
  // Simple mode hides the Insights tab switcher, so never leave the user
  // stranded on the (now-unreachable) insights panel.
  if (getModePref() === "simple" && state.portfolioTab !== "items") state.portfolioTab = "items";
  const hist = state.portfolioHistory || [];
  const alertsCount = state.wishlistAlerts.length;
  const gain = p.total_value - p.total_paid;
  const gainPct = p.total_paid ? gain / p.total_paid : 0;
  const totalVal = p.total_value_with_figs ?? p.total_value ?? 0;
  // Record the current totals as the milestone baseline so deleting sets lowers
  // it — re-crossing a threshold later celebrates again (uses total_value, the
  // same basis the add-flow milestone check reads from /api/collection).
  recordPortfolioMilestone(p.count ?? p.items?.length ?? 0, p.total_value ?? 0);

  let items = sortedPortfolioItems();

  const ranges = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365, "ALL": 999 };
  const days = ranges[state.filter.range] || 30;
  const clipped = hist.slice(-Math.min(days + 1, hist.length));

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="brand">
          <div class="brand-mark"></div>
          <h1 class="brand-name">BricksVault</h1>
        </div>
        <div class="topbar-actions">
          ${(state.me?.handle && state.me?.is_public) ? `<button class="icon-btn vault-extra-action" id="portfolioShareBtn" aria-label="Share Portfolio">${I.share()}</button>` : ""}
          ${(state.portfolio?.items?.length) ? `<button class="icon-btn vault-extra-action" id="selectToggle" aria-label="Select sets">${I.check()}</button>` : ""}
          <button class="icon-btn" id="layoutToggle" aria-label="Toggle Layout">${state.compactView ? I.grid() : I.list()}</button>
          <button class="icon-btn" id="searchToggle" aria-label="Search">${I.search()}</button>
          <a href="#/wishlist" class="icon-btn vault-wishlist-action" id="wishlistBtn" aria-label="Wishlist">
            ${I.heart()}
            ${state.wishlist.length > 0 ? `<span class="dot">${state.wishlist.length}</span>` : ""}
          </a>
          <button class="icon-btn vault-extra-action" id="alertsBtn" aria-label="Alerts">
            ${I.bell()}
            ${alertsCount > 0 ? `<span class="dot">${alertsCount}</span>` : ""}
          </button>
          <button class="icon-btn vault-overflow" id="vaultMoreBtn" aria-label="More vault actions">${I.more()}</button>
        </div>
      </div>
      <div class="search-wrap${state.filter.q ? " open" : ""}" id="searchWrap">
        <span class="s-icon">${I.search()}</span>
        <input class="search-input" id="portfolioSearch" placeholder="Search your vault…" autocomplete="off" value="${escapeHtml(state.filter.q)}">
      </div>

      <div class="card hero" data-trend="${gain > 0 ? "up" : gain < 0 ? "down" : "flat"}">
        <div class="hero-eyebrow"><span class="pulse"></span>Vault · LIVE</div>
        <div class="u-row" style="flex-wrap:wrap;column-gap:12px;">
          <div class="hero-value" id="heroValue">${heroValueHTML(totalVal)}</div>
          <span class="delta ${gain >= 0 ? "up" : "down"}" role="img" aria-label="${gain >= 0 ? 'Up' : 'Down'} ${fmtMoney(Math.abs(gain), { cents: 0 })} (${fmtPct(gainPct)})"><span class="arrow" aria-hidden="true">${gain >= 0 ? "▲" : "▼"}</span>${fmtMoney(Math.abs(gain), { cents: 0 })} (${fmtPct(gainPct)})</span>
        </div>
        <div class="hero-meta u-mono-label" style="letter-spacing:0.06em;">
          <span>Invested ${fmtMoney(p.total_paid)}</span>
          ${p.fig_count > 0 ? `<span style="cursor:help;" title="Minifig collection value tracked separately">· Figs ${p.fig_count} (${fmtMoney(p.fig_value || 0)})</span>` : ""}
          ${p.pricing_confidence?.priced ? `<span style="cursor:help;" title="Share of your sets priced from corroborated, fresh market data (high or medium confidence) rather than a thin or estimated value">· ${p.pricing_confidence.pct}% confidently priced</span>` : ""}
          ${ratesUnavailable() && (state.me?.currency || "USD") !== "USD" ? `<span style="color:var(--bv-yellow);cursor:help;" title="Exchange rates couldn't be loaded — values are shown in USD until they refresh">· shown in USD</span>` : ""}
        </div>
        <div class="spark-wrap" id="heroChart">${clipped.length < 2 ? `
          <div class="spark-empty">Your trend appears after the next daily valuation snapshot.</div>` : ""}</div>
        <div class="range-pills" id="rangePills">
          ${["1W","1M","3M","1Y","ALL"].map(r => {
            const locked = !state.historyPro && (r === "1Y" || r === "ALL");
            return `<button data-r="${r}" data-locked="${locked}" aria-pressed="${state.filter.range === r ? "true" : "false"}" class="${state.filter.range === r ? "active" : ""}">${r}${locked ? " ⭐" : ""}</button>`;
          }).join("")}
        </div>
      </div>

      ${p.items.length > 0 ? `
        <div class="portfolio-tabs" role="tablist" aria-label="Portfolio views">
          <button class="portfolio-tab ${state.portfolioTab === 'items' ? 'active' : ''}" data-tab="items" role="tab" aria-selected="${state.portfolioTab === 'items'}" aria-controls="portfolioTabContent">Your Sets</button>
          <button class="portfolio-tab ${state.portfolioTab === 'insights' ? 'active' : ''}" data-tab="insights" role="tab" aria-selected="${state.portfolioTab === 'insights'}" aria-controls="portfolioTabContent">Insights${state.historyPro ? '' : ' ⭐'}</button>
        </div>
      ` : ''}

      <div id="portfolioTabContent" role="tabpanel">
        ${state.portfolioTab === "items" ? `
          <div class="filter-row" style="margin-top: 8px;">
            ${[["added_desc","Recent"],["value_desc","Value"],["roi_desc","Growth"],["az","A–Z"]]
              .map(([k,l]) => `<button class="chip ${state.filter.sort === k ? "active" : ""}" data-sort="${k}">${l}</button>`).join("")}
          </div>
          <div class="set-list ${state.compactView ? 'compact-list' : ''}" id="setList">
            ${items.length === 0 ? emptyVaultHTML() : items.map(setListCardHTML).join("")}
          </div>
        ` : `
          <div id="insightsPanelContent">
            ${renderInsightsTab(p.items || [], state.historyPro)}
          </div>
        `}
      </div>
    </div>`;

  // Restore the pre-repaint scroll offset (see note at the top of this fn).
  if (scrollYBefore > 0) window.scrollTo(0, scrollYBefore);

  setTimeout(() => {
    drawSparkline($("#heroChart"), clipped, { up: gain >= 0 });
    // Day-one vaults have snapshots but no movement yet — a bare flat line
    // reads as "broken chart". Say what's actually happening.
    const flatSoFar = clipped.length >= 2 && new Set(clipped.map(d => d.total_value ?? d.current_value ?? d)).size === 1;
    if (flatSoFar) $("#heroChart")?.insertAdjacentHTML("beforeend", `<div class="spark-note">Tracking has begun — your curve builds with each daily snapshot</div>`);
    if (state.portfolioTab !== "items") {
      const container = $("#insightsDoubleChart");
      if (container) drawDoubleSparkline(container, clipped);
    }
  }, 40);
  
  animateHeroValue(totalVal);
  if (state.portfolioTab === "insights") wireInsightsTab();

  const switchPortfolioTab = (tab) => {
    state.portfolioTab = tab;
    $$(".portfolio-tab").forEach(x => {
      const on = x.dataset.tab === tab;
      x.classList.toggle("active", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
    });
    const panel = $("#portfolioTabContent");
    if (!panel) return;
    if (tab === "items") {
      panel.innerHTML = `
          <div class="filter-row" style="margin-top: 8px;">
            ${[["added_desc","Recent"],["value_desc","Value"],["roi_desc","Growth"],["az","A\u2013Z"]]
              .map(([k,l]) => `<button class="chip ${state.filter.sort === k ? "active" : ""}" data-sort="${k}">${l}</button>`).join("")}
          </div>
          <div class="set-list ${state.compactView ? 'compact-list' : ''}" id="setList">
            ${items.length === 0 ? emptyVaultHTML() : items.map(setListCardHTML).join("")}
          </div>`;
      wireSortChips();
      if (items.length) { wirePortfolioCards(); setupPortfolioSentinel(items); }
    } else {
      panel.innerHTML = `<div id="insightsPanelContent">${renderInsightsTab(p.items || [], state.historyPro)}</div>`;
      wireInsightsTab();
      setTimeout(() => { const c = $("#insightsDoubleChart"); if (c) drawDoubleSparkline(c, clipped); }, 40);
    }
  };
  $$(".portfolio-tab").forEach(tabBtn => {
    tabBtn.addEventListener("click", () => { haptic("light"); switchPortfolioTab(tabBtn.dataset.tab); });
  });

  $$("#rangePills button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.locked === "true") {
      haptic("light");
      toast("History beyond 90 days is a Pro perk — showing your last 90 days.", "info");
      return;
    }
    state.filter.range = b.dataset.r; haptic("light");
    $$("#rangePills button").forEach(x => { x.classList.toggle("active", x.dataset.r === state.filter.range); x.setAttribute("aria-pressed", x.dataset.r === state.filter.range ? "true" : "false"); });
    const d = ranges[state.filter.range] || 30;
    const freshClipped = hist.slice(-Math.min(d + 1, hist.length));
    drawSparkline($("#heroChart"), freshClipped, { up: gain >= 0 });
    const container = $("#insightsDoubleChart");
    if (container) drawDoubleSparkline(container, freshClipped);
  }));

  wireSortChips();

  $("#layoutToggle")?.addEventListener("click", () => {
    state.compactView = !state.compactView;
    localStorage.setItem("bv_compact_view", state.compactView);
    haptic("light");
    const toggleBtn = $("#layoutToggle");
    if (toggleBtn) toggleBtn.innerHTML = state.compactView ? I.grid() : I.list();
    repaintSetList();
  });

  // Visible entry point for multi-select (long-press remains a shortcut).
  $("#selectToggle")?.addEventListener("click", () => {
    if (state.selectionMode) { exitSelectionMode(); return; }
    enterSelectionMode();
    if (!localStorage.getItem("bv_sel_hint")) {
      localStorage.setItem("bv_sel_hint", "1");
      toast("Tap sets to select them for bulk actions", "info");
    }
  });

  $("#portfolioShareBtn")?.addEventListener("click", async () => {
    const handle = state.me?.handle;
    if (!handle) return;
    haptic("light");
    const shareUrl = `${publicOrigin()}/#/u/${encodeURIComponent(handle)}`;
    const outcome = await shareContent({
      title: "My LEGO BricksVault",
      text: "Check out my LEGO collection on BricksVault!",
      url: shareUrl,
      dialogTitle: "Share my BricksVault",
    });
    if (outcome === 'unsupported') {
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast("Link copied to clipboard!", "success");
      } catch {
        toast("Sharing isn't available on this device", "error");
      }
    }
  });

  $("#searchToggle")?.addEventListener("click", () => {
    const w = $("#searchWrap");
    w.classList.toggle("open");
    if (w.classList.contains("open")) $("#portfolioSearch")?.focus();
    else { state.filter.q = ""; repaintSetList(); }
  });

  let portfolioSearchTimer = null;
  $("#portfolioSearch")?.addEventListener("input", (e) => {
    const q = e.target.value;
    showSearchSpinner("#searchWrap", true);
    clearTimeout(portfolioSearchTimer);
    portfolioSearchTimer = setTimeout(() => {
      state.filter.q = q;
      repaintSetList();
      showSearchSpinner("#searchWrap", false);
    }, SEARCH_DEBOUNCE_MS);
  });

  $("#alertsBtn")?.addEventListener("click", () => showAlertsSheet(state.wishlistAlerts));
  $("#vaultMoreBtn")?.addEventListener("click", () => {
    haptic("light");
    showSheet(`
      <h2 class="u-serif-h" style="margin:0 4px 12px;">Vault actions</h2>
      ${(state.me?.handle && state.me?.is_public) ? `<button class="sheet-action" id="vaultMoreShare">${I.share()}<span>Share public profile</span></button>` : ""}
      ${(state.portfolio?.items?.length) ? `<button class="sheet-action" id="vaultMoreSelect">${I.check()}<span>Select sets</span></button>` : ""}
      <a class="sheet-action" href="#/wishlist" id="vaultMoreWishlist">${I.heart()}<span>Wishlist${state.wishlist.length ? ` (${state.wishlist.length})` : ""}</span></a>
      <button class="sheet-action" id="vaultMoreAlerts">${I.bell()}<span>Alerts${alertsCount ? ` (${alertsCount})` : ""}</span></button>
    `);
    $("#vaultMoreShare")?.addEventListener("click", () => { hideSheet(); $("#portfolioShareBtn")?.click(); });
    $("#vaultMoreSelect")?.addEventListener("click", () => { hideSheet(); $("#selectToggle")?.click(); });
    $("#vaultMoreWishlist")?.addEventListener("click", () => hideSheet());
    $("#vaultMoreAlerts")?.addEventListener("click", () => { hideSheet(); showAlertsSheet(state.wishlistAlerts); });
  });
  
  if (state.portfolioTab === "items") {
    wirePortfolioCards();
    setupPortfolioSentinel(items);
  }
  
  refreshNavBadge();
}

const showSearchSpinner = (containerSel, active) => {
  const wrap = document.querySelector(containerSel);
  if (!wrap) return;
  const icon = wrap.querySelector(".s-icon");
  if (!icon) return;
  if (active) {
    icon.innerHTML = `<span class="spin" style="display:inline-flex;animation:spin 0.8s linear infinite;">${I.refresh({w: 14, h: 14})}</span>`;
  } else {
    icon.innerHTML = I.search();
  }
};

function heroValueHTML(n) {
  if (n == null || isNaN(n)) return `<span>—</span>`;
  const userCurrency = state.me?.currency || "USD";
  const rate = getExchangeRate(userCurrency);
  const symbol = CURRENCY_SYMBOLS[userCurrency] || "$";
  const converted = n * rate;
  const whole = Math.floor(Math.abs(converted)).toLocaleString("en-US");
  const cents = Math.abs(converted % 1 * 100 | 0).toString().padStart(2, "0");
  const sign = converted < 0 ? "-" : "";
  return `${sign}${symbol}${whole}<span class="cents">.${cents}</span>`;
}

let _lastHeroValue = 0;

function animateHeroValue(target) {
  const el = $("#heroValue");
  if (!el || target == null || isNaN(target) || target <= 0) return;
  if (prefersReducedMotion()) { el.innerHTML = heroValueHTML(target); _lastHeroValue = target; return; }
  const dur = 750;
  const start = performance.now();
  const from = _lastHeroValue;
  _lastHeroValue = target;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    el.innerHTML = heroValueHTML(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function sourceCueHTML(item) { return trustBadgeHTML(item, { compact: true }); }

function setListCardHTML(item) {
  const dispVal = pval(item);
  const delta = item.purchase_price ? (dispVal - item.purchase_price) / item.purchase_price : null;
  const cls = delta == null ? "flat" : delta >= 0 ? "up" : "down";
  const arrow = delta == null ? "" : delta >= 0 ? "▲" : "▼";
  const dStr = delta == null ? "—" : (delta * 100).toFixed(1) + "%";
  const newBadge = item.added_at && daysAgo(item.added_at) < 7;
  const tc = THEME_COLORS[item.theme] || null;
  const borderStyle = tc ? ` style="border-left-color:${tc};"` : "";
  
  const isSelected = state.selectedSets.has(String(item.id || item.set_num));
  const checkboxHTML = state.selectionMode ? `
    <div class="card-checkbox ${isSelected ? 'checked' : ''}" style="margin-right: 8px; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 2px solid var(--line); border-radius: 4px; flex-shrink: 0; background: ${isSelected ? 'var(--up)' : 'transparent'}; color: white;">
      ${isSelected ? I.check({w:12, h:12}) : ''}
    </div>
  ` : '';

  const sourceCue = sourceCueHTML(item);

  if (state.compactView) {
    return `
      <button class="set-list-card compact" data-set="${escapeHtml(item.set_num)}" data-id="${item.id || item.set_num}"${borderStyle}>
        ${checkboxHTML}
        ${slImgHTML(item, { newBadge, qtyBadge: item.quantity || 1 })}
        <div class="sl-body" style="flex: 1; min-width: 0;">
          <div class="sl-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">
            ${(item.retirement_risk_score || 0) >= 70 ? '🔥 ' : ''}${escapeHtml(item.name)}
          </div>
          <div class="sl-meta" style="text-align: left;">
            <span>${escapeHtml(item.set_num)}</span>
            <span class="dot"></span>
            <span>${escapeHtml(item.theme || "")}</span>
            ${sourceCue}
          </div>
        </div>
        <div class="sl-right-compact">
          <div class="sl-value" style="display:flex;align-items:center;">
            ${estMark(item)}${fmtMoney(dispVal)}
            ${item.trend ? trendBadgeHTML(item.trend) : ""}
          </div>
          <div class="sl-delta ${cls}" ${delta != null ? `role="img" aria-label="${cls === 'up' ? 'Up' : 'Down'} ${dStr}"` : ''}><span aria-hidden="true">${arrow}</span>${dStr}</div>
        </div>
      </button>`;
  }

  return `
    <button class="set-list-card" data-set="${escapeHtml(item.set_num)}" data-id="${item.id || item.set_num}"${borderStyle}>
      ${checkboxHTML}
      ${slImgHTML(item, { newBadge, qtyBadge: item.quantity || 1 })}
      <div class="sl-body">
        <div class="sl-name" style="text-align: left;">${(item.retirement_risk_score || 0) >= 70 ? '🔥 ' : ''}${escapeHtml(item.name)}</div>
        <div class="sl-meta" style="text-align: left;">
          <span>${escapeHtml(item.theme || "")}</span>
          <span class="dot"></span>
          <span>${escapeHtml(item.set_num)}</span>
          ${sourceCue}
        </div>
      </div>
      <div class="sl-right">
        <div class="sl-value" style="display:flex;align-items:center;justify-content:flex-end;gap:4px;">
          ${item.market_value_confidence ? `<span title="Market confidence: ${item.market_value_confidence}" style="display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${item.market_value_confidence === 'high' ? 'var(--up)' : item.market_value_confidence === 'medium' ? 'var(--accent)' : 'var(--bv-yellow)'};"></span>` : ''}
          ${estMark(item)}${fmtMoney(dispVal)}
        </div>
        <div class="sl-delta ${cls}" ${delta != null ? `role="img" aria-label="${cls === 'up' ? 'Up' : 'Down'} ${dStr}"` : ''}><span class="arrow" aria-hidden="true">${arrow}</span>${dStr}</div>
        ${item.trend ? `<div class="sl-trend-row">${trendBadgeHTML(item.trend)}</div>` : ""}
        ${item.forecast_2y && dispVal && item.forecast_2y > dispVal ? `<div class="sl-forecast" style="font-size:9px;color:var(--ink-mute);font-family:var(--mono);text-align:right;">→ ${fmtMoneyShort(item.forecast_2y)} 2yr</div>` : ''}
      </div>
    </button>`;
}

function emptyVaultHTML() {
  return `
    <div class="onboarding-empty" style="display:flex;flex-direction:column;gap:16px;margin: 16px 0;">
      <div class="empty-cta-card" style="background:linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%);border:2.5px dashed var(--line);border-radius:var(--r-3);padding:24px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:var(--shadow-1);">
        <div class="u-center" style="color:var(--ink-mute);">${I.box({w:36,h:36})}</div>
        <h2 style="font-family:var(--font-heading);font-weight:600;font-size:18px;margin:0;">Start Your Brick Vault</h2>
        <p style="font-size:13px;color:var(--ink-mute);margin:0;line-height:1.4;max-width:280px;">Scan barcode boxes, search the catalog, and track your retirement values and ROI in real time.</p>
        <a href="#/add" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:var(--r-2);font-weight:600;margin-top:8px;text-decoration:none;">
          <span>Add your first set</span> ${I.arrowR({w:14, h:14})}
        </a>
      </div>
      
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.1em;margin-top:8px;padding-left:4px;" aria-hidden="true">Demo Portfolio Preview</div>
      
      <div class="set-list compact-list" aria-hidden="true" style="opacity:0.7;pointer-events:none;user-select:none;">
        <div class="set-list-card compact ghost-card" style="border-left: 4px solid var(--up);">
          <div class="sl-img"><div class="brick-tile" style="--h:210;width:100%;height:100%;border-radius:var(--r-1);"></div></div>
          <div class="sl-body" style="flex:1;min-width:0;">
            <div class="sl-name" style="text-align:left;">10497 Galaxy Explorer</div>
            <div class="sl-meta" style="text-align:left;"><span>90d Trend</span><span class="stale-dot" style="display:inline-block;width:6px;height:6px;background:var(--bv-yellow);border-radius:50%;margin-left:4px;"></span></div>
          </div>
          <div class="sl-right-compact">
            <div class="sl-value ghost-blur">$99.99</div>
            <div class="sl-delta up">+25.4%</div>
          </div>
        </div>
        
        <div class="set-list-card compact ghost-card" style="border-left: 4px solid var(--bv-yellow);">
          <div class="sl-img"><div class="brick-tile" style="--h:340;width:100%;height:100%;border-radius:var(--r-1);"></div></div>
          <div class="sl-body" style="flex:1;min-width:0;">
            <div class="sl-name" style="text-align:left;">75192 Millennium Falcon</div>
            <div class="sl-meta" style="text-align:left;"><span>90d Trend</span></div>
          </div>
          <div class="sl-right-compact">
            <div class="sl-value ghost-blur">$849.99</div>
            <div class="sl-delta up">+12.1%</div>
          </div>
        </div>
        
        <div class="set-list-card compact ghost-card" style="border-left: 4px solid var(--ink-mute);">
          <div class="sl-img"><div class="brick-tile" style="--h:45;width:100%;height:100%;border-radius:var(--r-1);"></div></div>
          <div class="sl-body" style="flex:1;min-width:0;">
            <div class="sl-name" style="text-align:left;">10305 Lion Knights' Castle</div>
            <div class="sl-meta" style="text-align:left;"><span>90d Trend</span></div>
          </div>
          <div class="sl-right-compact">
            <div class="sl-value ghost-blur">$399.99</div>
            <div class="sl-delta up">+8.7%</div>
          </div>
        </div>
      </div>
    </div>`;
}

function showAlertsSheet(alerts) {
  if (!alerts || !alerts.length) {
    toast("No new alerts", "info");
    return;
  }
  const spikeAlerts = alerts.filter(a => a.alert_type === "spike");
  // Treat legacy null/undefined as drops; exclude spike and any future types.
  const dropAlerts = alerts.filter(a => a.alert_type === "drop" || !a.alert_type);

  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Notifications</div>
    <div class="scrollable" style="max-height: 50vh; overflow-y: auto; display:flex; flex-direction:column; gap:12px; padding:2px;">
      ${spikeAlerts.map(a => spikeAlertCardHTML(a)).join("")}
      ${dropAlerts.map(a => `
        <div class="alert-card">
          <div class="ah">${I.bell()}Price drop · ${daysAgo(a.triggered_at)}d ago</div>
          <div style="font-weight:600;">${escapeHtml(a.set_name)}</div>
          <div style="font-size:13px;margin-top:4px;">Now <strong>${fmtMoney(a.current_value)}</strong> — your target was ${fmtMoney(a.target_price)}.</div>
        </div>
      `).join("")}
    </div>
    <button class="btn-primary" id="alertsClose" style="margin-top:16px;">Dismiss</button>
  `);
  $("#alertsClose").addEventListener("click", hideSheet);
  $$(".spike-alert").forEach(c => c.addEventListener("click", () => {
    hideSheet();
    location.hash = "#/set/" + encodeURIComponent(c.dataset.set);
  }));
  // Viewing IS reading: the badge exists to say "something new" — once the
  // sheet has shown the alerts, clear it (any close path, not just the
  // button). Offline we deliberately skip: the server never learned they were
  // seen, so the badge honestly persists instead of silently un-clearing later.
  if (navigator.onLine) {
    const ids = alerts.map(a => a.id).filter(Boolean);
    state.wishlistAlerts = [];
    refreshNavBadge();
    for (const id of ids) api(`/api/wishlist/${id}`, { method: "POST" }).catch(() => {});
  }
}

/* ============================================================
   Portfolio Insights Helpers
   ============================================================ */
// Free users see an honest teaser of what's inside instead of the toolkit.
// This is product framing (the server already caps history depth and export
// columns); the insights themselves are computed client-side from the user's
// own collection, so the gate is a paywall card, not DRM.
function insightsTeaserHTML() {
  return `
    <div style="padding:12px 16px;">
      <div class="card" style="padding:18px 16px;text-align:center;" data-testid="insights-teaser">
        <div style="font-size:28px;margin-bottom:6px;">📈</div>
        <div style="font-weight:700;font-size:15px;margin-bottom:6px;">Investor insights — a Pro toolkit</div>
        <ul class="support-perks" style="text-align:left;margin:10px auto;max-width:340px;">
          <li>Sell &amp; buy signals across your holdings</li>
          <li>Top movers and underperformers</li>
          <li>Retirement radar &amp; part-out opportunities</li>
          <li>S&amp;P 500 comparison + allocation by theme</li>
          <li>Full 1-year portfolio history</li>
        </ul>
        <button class="btn-primary" id="insightsUpgradeBtn" style="margin-top:6px;">See Pro options</button>
        <div style="font-size:11px;color:var(--ink-mute);margin-top:8px;">Tracking your vault stays free, forever.</div>
      </div>
    </div>`;
}

function renderInsightsTab(items, pro) {
  if (!pro) return insightsTeaserHTML();
  if (!items || !items.length) return `<p style="color:var(--ink-mute);font-size:14px;padding:16px;">Add sets to see insights.</p>`;

  const withSlope = items.filter(item => item.slope_90d != null && !isNaN(item.slope_90d));
  const rising = [...withSlope].sort((a, b) => b.slope_90d - a.slope_90d).slice(0, 3).filter(x => x.slope_90d > 0.05);
  const falling = [...withSlope].sort((a, b) => a.slope_90d - b.slope_90d).slice(0, 3).filter(x => x.slope_90d < -0.05);
  const radar = items.filter(item => !item.retired && (item.retirement_risk_score || 0) >= 70)
                     .sort((a, b) => b.retirement_risk_score - a.retirement_risk_score);
  const signals = computeSpreadSignals(items);
  const signalRow = (s, hot) => `
    <div class="signal-row insight-set-row" data-set="${escapeHtml(s.item.set_num)}">
      ${slImgHTML(s.item)}
      <div class="signal-row-main">
        <div class="signal-row-name">${escapeHtml(s.item.name)}</div>
        <div class="signal-row-sub">Resale ${hot ? "+" : "−"}${Math.abs(s.spread * 100).toFixed(0)}% vs ${s.item.bl_new_value ? "market" : "value"}${s.item.quantity > 1 ? ` · ×${s.item.quantity}` : ""}</div>
      </div>
      <strong class="signal-row-gap" style="color:${hot ? "var(--up)" : "var(--bv-red)"};">${hot ? "+" : ""}${fmtMoney(s.gap)}</strong>
    </div>`;
  const signalsCard = (signals.hot.length || signals.cold.length) ? `
      <h2 class="section-title" style="margin-top:0;">Market Signals</h2>
      <div class="card signals-card" style="padding:12px 16px;margin-bottom:18px;">
        ${signals.totalUpside > 0 ? `<div class="signals-headline">≈ ${fmtMoney(signals.totalUpside)} upside across ${signals.hot.length} set${signals.hot.length > 1 ? "s" : ""} if sold now</div>` : ""}
        ${signals.hot.length ? `<div class="signals-group-label" style="color:var(--up);"><span aria-hidden="true">🔥</span> Sell signals — resale running hot</div>${signals.hot.slice(0, 3).map(s => signalRow(s, true)).join("")}` : ""}
        ${signals.cold.length ? `<div class="signals-group-label" style="color:var(--bv-red);"><span aria-hidden="true">❄️</span> Buy windows — resale below market</div>${signals.cold.slice(0, 3).map(s => signalRow(s, false)).join("")}` : ""}
      </div>` : "";

  // Allocation by theme (diversification) — share of portfolio value per theme,
  // valued the same way the rest of the Vault is (condition-aware × quantity).
  const allocMap = new Map();
  let allocTotal = 0;
  for (const item of items) {
    const v = marketValueForCondition(item) * (Number(item.quantity) || 1);
    if (!(v > 0)) continue;
    const theme = item.theme || 'Other';
    allocMap.set(theme, (allocMap.get(theme) || 0) + v);
    allocTotal += v;
  }
  const alloc = [...allocMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const allocCard = allocTotal > 0 ? `
      <h2 class="section-title">Allocation by theme</h2>
      <div class="card" style="padding:14px 16px;margin-bottom:18px;">
        ${alloc.map(([theme, v]) => {
          const share = v / allocTotal;
          return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;gap:8px;">
              <span style="color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(theme)}</span>
              <strong style="color:var(--ink);font-family:var(--mono);white-space:nowrap;">${fmtMoney(v)} · ${(share * 100).toFixed(0)}%</strong>
            </div>
            <div style="height:6px;background:var(--surface-3);border-radius:3px;overflow:hidden;"><div style="height:100%;width:${(share * 100).toFixed(1)}%;background:${THEME_COLORS[theme] || 'var(--accent)'};"></div></div>
          </div>`;
        }).join('')}
        ${allocMap.size > alloc.length ? `<div style="font-size:11px;color:var(--ink-mute);margin-top:8px;">+${allocMap.size - alloc.length} more theme${allocMap.size - alloc.length > 1 ? 's' : ''}</div>` : ''}
      </div>` : '';

  // Part-out opportunities (E1): holdings worth materially more sold as parts
  // than sealed. part_out_value is only present when coverage is high (gated
  // server-side), so this stays empty until the part-price data fills.
  const baseVal = (it) => Number(it.market_value) || Number(it.blended_value) || Number(it.current_value) || 0;
  const partOut = items
    .map(it => ({ it, po: Number(it.part_out_value), mv: baseVal(it), cov: Number(it.part_out_coverage) }))
    .filter(x => x.po > 0 && x.mv > 0 && x.po / x.mv >= 1.15)
    .sort((a, b) => (b.po / b.mv) - (a.po / a.mv))
    .slice(0, 3);
  const partOutCard = partOut.length ? `
      <h2 class="section-title">Part-out opportunities</h2>
      <div class="card" style="padding:12px 16px;margin-bottom:18px;">
        <div style="font-size:11px;color:var(--ink-mute);margin-bottom:8px;line-height:1.4;">Sets currently worth more sold as individual parts than sealed.</div>
        ${partOut.map(({ it, po, mv, cov }) => {
          const isApprox = cov >= 0.2 && cov < 0.4;
          return `
          <div class="insight-set-row" data-set="${escapeHtml(it.set_num)}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-soft);cursor:pointer;">
            <div style="min-width:0;margin-right:8px;">
              <div style="font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(it.name)}</div>
              <div style="font-size:11px;color:var(--ink-mute);">Sealed ${fmtMoney(mv)} · ${isApprox ? '~' : ''}Parts ${fmtMoney(po)}${isApprox ? ' <span title="Estimate based on partial price coverage">ⓘ</span>' : ''}</div>
            </div>
            <strong style="color:var(--up);font-family:var(--mono);white-space:nowrap;">+${(((po / mv) - 1) * 100).toFixed(0)}%</strong>
          </div>`;
        }).join('')}
      </div>` : '';

  return `
    <div style="padding:12px 16px;">
      ${signalsCard}
      <h2 class="section-title" ${signalsCard ? "" : 'style="margin-top:0;"'}>S&P 500 Performance Comparison</h2>
      <div class="card" style="padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:12px;color:var(--ink-mute);line-height:1.4;margin-bottom:12px;">
          Compare your LEGO portfolio growth (solid <span style="color:var(--up);font-weight:700;">green</span>) against S&P 500 compounding at 8%/year (dashed <span style="color:var(--ink-soft);font-weight:600;">gray</span>) using dollar-cost averaging.
        </div>
        <div class="spark-wrap" id="insightsDoubleChart" style="height:120px;margin-top:14px;"></div>
      </div>

      ${allocCard}

      <h2 class="section-title">Top Movers (90-day Slope)</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
        <div class="card" style="padding:12px;">
          <div class="u-row u-gap-1" style="font-size:12px;font-family:var(--mono);color:var(--up);margin-bottom:8px;font-weight:700;">${I.trend({w:13,h:13})} TOP RISING</div>
          ${rising.length === 0 ? `<div style="font-size:12px;color:var(--ink-mute);">No significant gainers</div>` : rising.map(item => `
            <div style="margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;">
              <span class="insight-set-link" data-set="${escapeHtml(item.set_num)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin-right:8px;text-decoration:underline;cursor:pointer;">${escapeHtml(item.name)}</span>
              <strong style="color:var(--up);font-family:var(--mono);">+${item.slope_90d.toFixed(1)}%/wk</strong>
            </div>
          `).join("")}
        </div>
        <div class="card" style="padding:12px;">
          <div class="u-row u-gap-1" style="font-size:12px;font-family:var(--mono);color:var(--bv-red);margin-bottom:8px;font-weight:700;">${I.trendDown({w:13,h:13})} TOP FALLING</div>
          ${falling.length === 0 ? `<div style="font-size:12px;color:var(--ink-mute);">No significant decliners</div>` : falling.map(item => `
            <div style="margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;">
              <span class="insight-set-link" data-set="${escapeHtml(item.set_num)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;margin-right:8px;text-decoration:underline;cursor:pointer;">${escapeHtml(item.name)}</span>
              <strong style="color:var(--bv-red);font-family:var(--mono);">${item.slope_90d.toFixed(1)}%/wk</strong>
            </div>
          `).join("")}
        </div>
      </div>

      ${partOutCard}

      <h2 class="section-title">Retirement Radar</h2>
      <div class="card" style="padding:12px 16px;">
        ${radar.length === 0 ? `<div style="font-size:12px;color:var(--ink-mute);text-align:center;padding:12px 0;">No active high-risk sets (score ≥ 70)</div>` : radar.map(item => `
          <div class="insight-set-row" data-set="${escapeHtml(item.set_num)}" style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line-soft);cursor:pointer;">
            <div style="display:flex;flex-direction:column;gap:2px;">
              <div style="font-size:13px;font-weight:600;color:var(--ink);">${escapeHtml(item.name)}</div>
              <div style="font-size:11px;color:var(--ink-mute);">${escapeHtml(item.set_num)} · ${escapeHtml(item.theme)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px;font-family:var(--mono);color:var(--bv-red);font-weight:700;">🔥 RISK ${item.retirement_risk_score}%</div>
              <div style="font-size:11px;color:var(--ink-mute);">${item.year} Release</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function wireInsightsTab() {
  $$(".insight-set-link, .insight-set-row").forEach(el => {
    el.addEventListener("click", () => {
      if (!el.dataset.set) return;
      haptic("light");
      location.hash = "#/set/" + encodeURIComponent(el.dataset.set);
    });
  });
  $("#insightsUpgradeBtn")?.addEventListener("click", () => {
    haptic("light");
    location.hash = "#/me";
  });
}

function drawDoubleSparkline(container, data) {
  if (!container || !data || data.length < 2) return;
  const W = container.clientWidth || 300;
  const H = container.clientHeight || 120;
  const vals = data.map(d => d.total_value ?? d.current_value ?? d);
  const dates = data.map(d => (d && d.snapshot_date) || null);

  // Calculate S&P 500 overlay values
  const spVals = [];
  let currentSP = data[0].total_paid ?? 0;
  spVals.push(currentSP);
  for (let i = 1; i < data.length; i++) {
    const d1 = data[i-1].snapshot_date ? new Date(data[i-1].snapshot_date) : null;
    const d2 = data[i].snapshot_date ? new Date(data[i].snapshot_date) : null;
    const dt = d1 && d2 ? (d2.getTime() - d1.getTime()) / (365.25 * 24 * 3600 * 1000) : 1 / 365.25;
    const paidDiff = (data[i].total_paid ?? 0) - (data[i-1].total_paid ?? 0);
    currentSP = currentSP * Math.pow(1.08, dt) + paidDiff;
    spVals.push(currentSP);
  }

  const mn = Math.min(...vals, ...spVals), mx = Math.max(...vals, ...spVals);
  const pad = 6;
  const xs = (i) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const ys = (v) => H - pad - ((v - mn) / ((mx - mn) || 1)) * (H - pad * 2);

  let path1 = `M${xs(0).toFixed(1)} ${ys(vals[0]).toFixed(1)}`;
  let path2 = `M${xs(0).toFixed(1)} ${ys(spVals[0]).toFixed(1)}`;
  for (let i = 1; i < data.length; i++) {
    path1 += ` L${xs(i).toFixed(1)} ${ys(vals[i]).toFixed(1)}`;
    path2 += ` L${xs(i).toFixed(1)} ${ys(spVals[i]).toFixed(1)}`;
  }

  const area1 = path1 + ` L${xs(data.length - 1).toFixed(1)} ${H} L${xs(0).toFixed(1)} ${H} Z`;
  const stroke1 = "var(--up)";
  const stroke2 = "var(--ink-mute)";
  const gid = "sgi" + Math.random().toString(36).slice(2, 8);

  if (getComputedStyle(container).position === "static") container.style.position = "relative";
  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block;overflow:visible;">
      <defs>
        <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${stroke1}" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="${stroke1}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area1}" fill="url(#${gid})" />
      <path d="${path1}" fill="none" stroke="${stroke1}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${path2}" fill="none" stroke="${stroke2}" stroke-width="1.5" stroke-dasharray="3 3" stroke-linecap="round" stroke-linejoin="round"/>
      <line class="spark-guide" x1="0" y1="0" x2="0" y2="${H}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
      <circle class="spark-cursor-1" r="5" fill="${stroke1}" stroke="var(--bg)" stroke-width="2.5" opacity="0"/>
      <circle class="spark-cursor-2" r="4" fill="${stroke2}" stroke="var(--bg)" stroke-width="2" opacity="0"/>
    </svg>
    <div class="spark-scrub" style="font-size:11px;pointer-events:none;"></div>`;

  const guide = container.querySelector(".spark-guide");
  const cursor1 = container.querySelector(".spark-cursor-1");
  const cursor2 = container.querySelector(".spark-cursor-2");
  const scrub = container.querySelector(".spark-scrub");

  const onMove = (e) => {
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (data.length - 1));
    const cx = xs(i), cy1 = ys(vals[i]), cy2 = ys(spVals[i]);

    guide.setAttribute("x1", cx); guide.setAttribute("x2", cx); guide.setAttribute("opacity", "0.6");
    cursor1.setAttribute("cx", cx); cursor1.setAttribute("cy", cy1); cursor1.setAttribute("opacity", "1");
    cursor2.setAttribute("cx", cx); cursor2.setAttribute("cy", cy2); cursor2.setAttribute("opacity", "1");

    scrub.style.left = (cx / W * rect.width) + "px";
    scrub.style.top = (Math.min(cy1, cy2) / H * rect.height - 30) + "px";
    scrub.innerHTML = `<span style="color:var(--up);font-weight:700;">Vault: ${fmtMoney(vals[i], { cents: 0 })}</span> <span style="color:var(--ink-soft);">S&P: ${fmtMoney(spVals[i], { cents: 0 })}</span>${dates[i] ? " · " + fmtShortDate(dates[i]) : ""}`;
    scrub.classList.add("show");
  };

  const onLeave = () => {
    guide.setAttribute("opacity", "0");
    cursor1.setAttribute("opacity", "0");
    cursor2.setAttribute("opacity", "0");
    scrub.classList.remove("show");
  };

  if (container._sparkHandlers) {
    const _h = container._sparkHandlers;
    container.removeEventListener("pointermove", _h.move);
    container.removeEventListener("pointerleave", _h.leave);
    container.removeEventListener("touchmove", _h.move);
    container.removeEventListener("touchend", _h.leave);
  }
  container._sparkHandlers = { move: onMove, leave: onLeave };
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerleave", onLeave);
  container.addEventListener("touchmove", onMove, { passive: true });
  container.addEventListener("touchend", onLeave);
}

export function spikeAlertCardHTML(a, { dismiss = false } = {}) {
  const gain = a.purchase_price && a.current_value
    ? (a.current_value - (a.purchase_price || 0)) / (a.purchase_price || 1) : 0;
  return `
    <div class="alert-card spike-alert" data-set="${escapeHtml(a.set_num || "")}">
      ${dismiss && a.id ? `<button class="alert-dismiss" data-alert-id="${escapeHtml(String(a.id))}" aria-label="Mark this alert read" title="Mark read">✓</button>` : ""}
      <div class="ah">${I.dollar()}Sell opportunity · ${daysAgo(a.triggered_at)}d ago</div>
      <div style="font-weight:600;">${escapeHtml(a.set_name || a.name || "")}</div>
      <div style="font-size:13px;margin-top:4px;">
        Now <strong>${fmtMoney(a.current_value)}</strong> — you paid ${fmtMoney(a.purchase_price || 0)}.
        <span style="color:var(--up);font-weight:700;"> +${fmtPct(Math.abs(gain))} gain</span>
      </div>
      <a href="#/set/${encodeURIComponent(a.set_num || "")}" class="btn-secondary" style="display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;padding:6px 14px;text-decoration:none;">Consider selling ${I.arrowR()}</a>
    </div>`;
}

function cohortROIHTML(items) {
  const withPurchaseDate = items.filter(i => i.purchased_at && (Number(i.purchase_price) > 0 || pval(i) > 0));
  if (!withPurchaseDate.length) {
    return `<p style="color:var(--ink-mute);font-size:12px;text-align:center;padding:16px 0;">No sets with purchase dates in vault.</p>`;
  }
  
  const cohorts = {};
  for (const item of withPurchaseDate) {
    const year = new Date(item.purchased_at).getFullYear();
    if (!cohorts[year]) {
      cohorts[year] = { count: 0, totalPaid: 0, totalCurrent: 0 };
    }
    const qty = Number(item.quantity) || 1;
    cohorts[year].count += qty;
    cohorts[year].totalPaid += (Number(item.purchase_price) || 0) * qty;
    cohorts[year].totalCurrent += pval(item) * qty;
  }
  
  const sortedYears = Object.keys(cohorts).sort((a, b) => b - a);
  let html = `<div class="insights-block" style="padding-top:8px;"><div class="insights-label">Cohort Performance by Purchase Year</div>`;
  
  sortedYears.forEach(year => {
    const c = cohorts[year];
    const gain = c.totalCurrent - c.totalPaid;
    const roi = c.totalPaid > 0 ? (gain / c.totalPaid) * 100 : 0;
    const roiColor = roi >= 0 ? 'var(--up)' : 'var(--bv-red)';
    
    const maxVal = Math.max(...Object.values(cohorts).map(x => x.totalCurrent));
    const pct = maxVal > 0 ? (c.totalCurrent / maxVal * 100).toFixed(1) : 0;
    
    html += `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:between;align-items:center;font-size:12px;margin-bottom:4px;">
          <strong>Year ${year}</strong>
          <span style="color:var(--ink-mute);font-size:11px;margin-left:auto;">${c.count} set${c.count > 1 ? 's' : ''} · Paid ${fmtMoney(c.totalPaid, { cents: 0 })}</span>
        </div>
        <div class="theme-bar-row" style="margin-bottom:2px;">
          <div class="theme-bar-name" style="width:70px;">${fmtMoney(c.totalCurrent, { cents: 0 })}</div>
          <div class="theme-bar-track" style="flex:1;"><div class="theme-bar-fill" style="width:${pct}%;background:var(--bv-yellow);"></div></div>
          <div class="theme-bar-pct" style="color:${roiColor};font-weight:700;">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%</div>
        </div>
      </div>`;
  });
  
  html += `</div>`;
  return html;
}

function insightsGeneralHTML(items) {
  const themeMap = {};
  for (const item of items) {
    const t = item.theme || "Other";
    themeMap[t] = (themeMap[t] || 0) + pval(item) * (item.quantity || 1);
  }
  const themeTotal = Object.values(themeMap).reduce((a, b) => a + b, 0);
  const topThemes = Object.entries(themeMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const withRoi = items.filter(i => i.annualized_roi != null);
  const roiSorted = [...withRoi].sort((a, b) => b.annualized_roi - a.annualized_roi);
  const leaders = roiSorted.slice(0, 3);
  const losers = roiSorted.filter(i => i.annualized_roi < 0).slice(-3).reverse();

  const riskSorted = items
    .filter(i => !i.retired && (i.retirement_risk_score || 0) > 0)
    .sort((a, b) => (b.retirement_risk_score || 0) - (a.retirement_risk_score || 0))
    .slice(0, 5);

  let html = "";
  if (topThemes.length > 1) {
    html += `<div class="insights-block"><div class="insights-label">Value by theme</div>`;
    for (const [theme, val] of topThemes) {
      const pct = themeTotal > 0 ? (val / themeTotal * 100).toFixed(1) : 0;
      const tc = THEME_COLORS[theme] || `oklch(0.55 0.18 ${themeHue(theme)})`;
      html += `<div class="theme-bar-row">
        <div class="theme-bar-name">${escapeHtml(theme)}</div>
        <div class="theme-bar-track"><div class="theme-bar-fill" style="width:${pct}%;background:${tc};"></div></div>
        <div class="theme-bar-pct">${pct}%</div>
      </div>`;
    }
    html += `</div>`;
  }

  if (leaders.length > 0) {
    html += `<div class="insights-block"><div class="insights-label">Top performers (annualized ROI)</div>`;
    for (const item of leaders) {
      html += `<a href="#/set/${encodeURIComponent(item.set_num)}" class="insights-row">
        <span class="ir-name">${escapeHtml(item.name)}</span>
        <span class="ir-roi" style="color:var(--up);">+${(item.annualized_roi * 100).toFixed(1)}% / yr</span>
      </a>`;
    }
    html += `</div>`;
  }

  if (losers.length > 0) {
    html += `<div class="insights-block"><div class="insights-label">Underperformers</div>`;
    for (const item of losers) {
      html += `<a href="#/set/${encodeURIComponent(item.set_num)}" class="insights-row">
        <span class="ir-name">${escapeHtml(item.name)}</span>
        <span class="ir-roi" style="color:var(--down);">${(item.annualized_roi * 100).toFixed(1)}% / yr</span>
      </a>`;
    }
    html += `</div>`;
  }

  if (riskSorted.length > 0) {
    html += `<div class="insights-block"><div class="insights-label">Retirement risk — act now</div>`;
    for (const item of riskSorted) {
      const score = item.retirement_risk_score || 0;
      const barWidth = Math.min(100, score);
      const color = score >= 70 ? "var(--down)" : score >= 40 ? "var(--bv-yellow)" : "var(--up)";
      html += `<a href="#/set/${encodeURIComponent(item.set_num)}" class="insights-row">
        <span class="ir-name">${score >= 70 ? "🔥 " : ""}${escapeHtml(item.name)}</span>
        <div style="display:flex;align-items:center;gap:6px;">
          <div style="width:60px;height:4px;border-radius:2px;background:var(--line);overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:${color};border-radius:2px;"></div>
          </div>
          <span class="ir-roi" style="color:${color};">${score}</span>
        </div>
      </a>`;
    }
    html += `</div>`;
  }
  return html;
}

function _wireInsightsTabs(items) {
  const panel = $("#insightsPanel");
  if (!panel) return;
  panel.querySelectorAll(".insights-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      haptic("light");
      panel.querySelectorAll(".insights-tab").forEach(t => t.classList.toggle("active", t === tab));
      const activeTab = tab.dataset.tab;
      const contentEl = panel.querySelector("#insightsTabContent");
      if (contentEl) {
        if (activeTab === "general") {
          contentEl.innerHTML = insightsGeneralHTML(items);
        } else if (activeTab === "cohort") {
          contentEl.innerHTML = cohortROIHTML(items);
        }
      }
    });
  });
}

export function refreshNavBadge() {
  const alerts = state.wishlistAlerts || [];
  const spikes = alerts.filter(a => a.alert_type === 'spike').length;
  const drops = alerts.filter(a => a.alert_type === 'drop' || !a.alert_type).length;
  const total = spikes + drops;
  
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
    el.title = `Wishlist Alerts (${spikes} spikes, ${drops} price drops)`;
  } else {
    if (badge) badge.style.display = "none";
    el.removeAttribute("title");
  }
}

/* ============================================================
   Selection & Bulk Actions Helpers
   ============================================================ */
// A set card renders data-id="${item.id || item.set_num}" — so a selection key
// can be a collection-row id OR (for legacy/imported items with no id) a
// set_num. Bulk actions MUST resolve the selected items and address the API the
// SAME way, otherwise a selected set matches nothing, gets skipped, and the
// action still reports success (the "Sets removed but nothing deleted" bug).
const selRef = (item) => String(item.id || item.set_num);
const apiRef = (item) => encodeURIComponent(item.id || item.set_num);

function enterSelectionMode(firstId) {
  state.selectionMode = true;
  state.selectedSets = new Set();
  if (firstId) state.selectedSets.add(String(firstId));
  haptic("medium");
  // The class reserves scroll room under the list; without it a short vault's
  // cards sit behind the floating toolbar with no way to scroll them clear.
  document.body.classList.add("selection-mode");
  repaintSetList();
  showSelectionBar();
  if (firstId) {
    const card = document.querySelector(`.set-list-card[data-id="${CSS.escape(String(firstId))}"]`);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function showSelectionBar() {
  let bar = document.getElementById("selectionBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "selectionBar";
    bar.className = "selection-bar";
    document.body.appendChild(bar);
  }
  updateSelectionBar();
  setTimeout(() => bar.classList.add("show"), 10);
}

function updateSelectionBar() {
  const bar = document.getElementById("selectionBar");
  if (!bar) return;
  const count = state.selectedSets.size;
  bar.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <strong style="font-size:14px;color:var(--ink);">${count} set${count !== 1 ? 's' : ''} selected</strong>
      <button class="icon-btn" id="selCancel" style="font-size:12px;color:var(--ink-mute);border:none;background:transparent;cursor:pointer;">Cancel</button>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary compact-btn" id="selBulkLocation" style="flex:1;font-size:12px;" ${count === 0 ? 'disabled' : ''}>Location</button>
      <button class="btn-secondary compact-btn" id="selBulkExport" style="flex:1;font-size:12px;" ${count === 0 ? 'disabled' : ''}>CSV</button>
      <button class="btn-primary compact-btn btn-danger" id="selBulkDelete" style="flex:1;font-size:12px;" ${count === 0 ? 'disabled' : ''}>Delete</button>
    </div>
  `;

  document.getElementById("selCancel").addEventListener("click", exitSelectionMode);
  document.getElementById("selBulkLocation")?.addEventListener("click", handleBulkLocation);
  document.getElementById("selBulkExport")?.addEventListener("click", handleBulkExport);
  document.getElementById("selBulkDelete")?.addEventListener("click", handleBulkDelete);
}

function exitSelectionMode() {
  state.selectionMode = false;
  state.selectedSets = new Set();
  document.body.classList.remove("selection-mode");
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
  const loc = await promptSheet({ title: "Bulk Location", label: "Set storage location for selected sets", value: "", placeholder: "e.g. Closet A, Shelf 2" });
  if (loc === null) return;
  const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(selRef(item)));
  if (!selectedItems.length) { toast("No matching sets to update", "error"); return; }
  toast("Updating locations...", "info");
  const results = await Promise.allSettled(selectedItems.map(item =>
    api("/api/collection/" + apiRef(item), { method: "PATCH", body: { storage_location: loc || null } })
  ));
  const failed = results.filter(r => r.status === "rejected").length;
  // Tear down selection UI BEFORE invalidating — exitSelectionMode repaints the
  // list and must read a valid state.portfolio, not the null invalidate leaves.
  toast(failed === 0 ? "Storage locations updated"
    : `Updated ${results.length - failed} of ${results.length} — ${failed} failed, try those again`, failed ? "error" : "success");
  exitSelectionMode();
  invalidatePortfolio();
  await renderPortfolio();
}

async function handleBulkDelete() {
  const ids = Array.from(state.selectedSets);
  if (!ids.length) return;
  const confirmed = await confirmSheet({
    title: "Bulk Delete",
    message: `Are you sure you want to remove ${ids.length} set${ids.length !== 1 ? 's' : ''} from your vault?`,
    confirmLabel: "Delete All",
    danger: true
  });
  if (!confirmed) return;
  const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(selRef(item)));
  if (!selectedItems.length) { toast("No matching sets to remove", "error"); return; }
  toast("Deleting sets...", "info");
  // allSettled + per-item accounting: with Promise.all one failure reported
  // "Failed to delete" even though earlier deletes already landed server-side.
  const results = await Promise.allSettled(selectedItems.map(item =>
    api("/api/collection/" + apiRef(item), { method: "DELETE" })
  ));
  const removed = selectedItems.filter((_, i) => results[i].status === "fulfilled");
  const failed = selectedItems.length - removed.length;
  // Sync the client-side owned set + drop cached detail snapshots + force a
  // catalog refetch, so the OWNED badge and set pages don't stay stale until
  // a manual refresh.
  for (const item of removed) markSetOwned(item.set_num, false);
  state.catalog.items = [];
  // Tear down selection UI BEFORE invalidating — exitSelectionMode repaints the
  // list and must read a valid state.portfolio, not the null invalidate leaves.
  if (failed > 0) {
    toast(`Removed ${removed.length} of ${selectedItems.length} — ${failed} failed, try those again`, "error");
  } else if (removed.length) {
    // Soft deletes make a bulk restore a straight re-POST of the kept payloads.
    const restorePayloads = removed.map(item => ({
      set_num: item.set_num, quantity: item.quantity || 1,
      condition: item.condition || undefined, purchase_price: item.purchase_price ?? undefined,
      purchased_at: item.purchased_at || undefined, notes: item.notes || undefined,
    }));
    undoToast(`Removed ${removed.length} set${removed.length !== 1 ? "s" : ""}`, async () => {
      const res = await Promise.allSettled(restorePayloads.map(b => api("/api/collection", { method: "POST", body: b })));
      const back = res.filter(r => r.status === "fulfilled").length;
      for (const p of restorePayloads) markSetOwned(p.set_num, true);
      state.catalog.items = [];
      invalidatePortfolio();
      await renderPortfolio();
      toast(back === restorePayloads.length ? "Restored to vault" : `Restored ${back} of ${restorePayloads.length}`, back ? "success" : "error");
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
    const row = [
      item.set_num,
      `"${(item.name || '').replace(/"/g, '""')}"`,
      `"${(item.theme || '').replace(/"/g, '""')}"`,
      item.year,
      item.pieces,
      item.quantity,
      item.purchase_price || '',
      item.current_value || '',
      `"${(item.storage_location || '').replace(/"/g, '""')}"`
    ].join(",");
    csvContent += row + "\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `brickvault_bulk_export_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast("CSV exported", "success");
  exitSelectionMode();
}
