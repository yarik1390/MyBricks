import { $, $$, haptic, escapeHtml, toast, fmtMoney, fmtPct, daysAgo, clamp, prefersReducedMotion, confettiBurst, themeHue, setHue, THEME_COLORS, fmtShortDate, fmtDateUpdated, setBtnLoading, drawSparkline, brickTile, slImgHTML, bricklinkBuyURL, trendBadgeHTML, CURRENCY_SYMBOLS, getExchangeRate, fmtMoneyShort, bvIDB, SEARCH_DEBOUNCE_MS } from '../utils.js';
import { computeDealScore, ebaySoldSummary, marketValueForCondition, computeSpreadSignals, buyWindow, pricePerPiece } from '../lib/pure.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, getSessionUserId, _authSession, outboxEnqueue } from '../api.js';
import { I } from '../icons.js';
import { showSheet, hideSheet, confirmSheet, promptSheet } from '../components/sheet.js';
import { trustBadgeHTML, trustPanelHTML } from '../components/trust.js';
import { go } from '../router.js';
import { skelPage, skelHero, skelCardList, skelDetail } from '../components/skeleton.js';

let _swipeAc = null;

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
    if (wl) {
      state.wishlist = wl.wishlist || [];
      state.wishlistAlerts = wl.unread_alerts || [];
    }
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

// Filter + sort the vault items according to current state.filter. Pure — no DOM.
function sortedPortfolioItems() {
  const p = state.portfolio;
  let items = (p.items || []).slice();
  const q = state.filter.q.toLowerCase().trim();
  if (q) items = items.filter(i => i.name?.toLowerCase().includes(q) || i.set_num?.toLowerCase().includes(q) || i.theme?.toLowerCase().includes(q));
  switch (state.filter.sort) {
    case "added_desc": items.sort((a, b) => new Date(b.added_at) - new Date(a.added_at)); break;
    case "value_desc": items.sort((a, b) => b.current_value - a.current_value); break;
    case "roi_desc":   items.sort((a, b) => (b.annualized_roi ?? -1) - (a.annualized_roi ?? -1)); break;
    case "az":         items.sort((a, b) => a.name?.localeCompare(b.name)); break;
  }
  return items;
}

// Re-render ONLY the set list + wire its cards. Used by sort/search so the
// hero, chart and topbar don't flash from a full-page re-render.
let portfolioOffset = 20;
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
        if (state.selectedSets.has(id)) {
          state.selectedSets.delete(id);
        } else {
          state.selectedSets.add(id);
        }
        haptic("light");
        repaintSetList();
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
  const hist = state.portfolioHistory || [];
  const alertsCount = state.wishlistAlerts.length;
  const gain = p.total_value - p.total_paid;
  const gainPct = p.total_paid ? gain / p.total_paid : 0;
  const totalVal = p.total_value_with_figs ?? p.total_value ?? 0;

  let items = sortedPortfolioItems();

  const ranges = { "1W": 7, "1M": 30, "3M": 90, "1Y": 365, "ALL": 999 };
  const days = ranges[state.filter.range] || 30;
  const clipped = hist.slice(-Math.min(days + 1, hist.length));

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="brand">
          <div class="brand-mark"></div>
          <div class="brand-name">Brickvault</div>
        </div>
        <div class="topbar-actions">
          ${(state.me?.handle && state.me?.is_public) ? `<button class="icon-btn" id="portfolioShareBtn" aria-label="Share Portfolio">${I.share()}</button>` : ""}
          ${(state.portfolio?.items?.length) ? `<button class="icon-btn" id="selectToggle" aria-label="Select sets">${I.check()}</button>` : ""}
          <button class="icon-btn" id="layoutToggle" aria-label="Toggle Layout">${state.compactView ? I.grid() : I.list()}</button>
          <button class="icon-btn" id="searchToggle" aria-label="Search">${I.search()}</button>
          <a href="#/wishlist" class="icon-btn" id="wishlistBtn" aria-label="Wishlist">
            ${I.heart()}
            ${state.wishlist.length > 0 ? `<span class="dot">${state.wishlist.length}</span>` : ""}
          </a>
          <button class="icon-btn" id="alertsBtn" aria-label="Alerts">
            ${I.bell()}
            ${alertsCount > 0 ? `<span class="dot">${alertsCount}</span>` : ""}
          </button>
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
          <span class="delta ${gain >= 0 ? "up" : "down"}"><span class="arrow">${gain >= 0 ? "▲" : "▼"}</span>${fmtMoney(Math.abs(gain), { cents: 0 })} (${fmtPct(Math.abs(gainPct))})</span>
        </div>
        <div class="hero-meta u-mono-label" style="letter-spacing:0.06em;">
          <span>Invested ${fmtMoney(p.total_paid)}</span>
          ${p.fig_count > 0 ? `<span style="cursor:help;" title="Minifig collection value tracked separately">· Figs ${p.fig_count} (${fmtMoney(p.fig_value || 0)})</span>` : ""}
        </div>
        <div class="spark-wrap" id="heroChart"></div>
        <div class="range-pills" id="rangePills">
          ${["1W","1M","3M","1Y","ALL"].map(r => `<button data-r="${r}" class="${state.filter.range === r ? "active" : ""}">${r}</button>`).join("")}
        </div>
      </div>

      ${p.items.length > 0 ? `
        <div class="portfolio-tabs">
          <button class="portfolio-tab ${state.portfolioTab === 'items' ? 'active' : ''}" data-tab="items">Your Sets</button>
          <button class="portfolio-tab ${state.portfolioTab === 'insights' ? 'active' : ''}" data-tab="insights">Insights</button>
        </div>
      ` : ''}

      <div id="portfolioTabContent">
        ${state.portfolioTab === "items" ? `
          <div class="filter-row" style="margin-top: 8px;">
            ${[["added_desc","Recent"],["value_desc","By value"],["roi_desc","By ROI"],["az","A–Z"]]
              .map(([k,l]) => `<button class="chip ${state.filter.sort === k ? "active" : ""}" data-sort="${k}">${l}</button>`).join("")}
          </div>
          <div class="set-list ${state.compactView ? 'compact-list' : ''}" id="setList">
            ${items.length === 0 ? emptyVaultHTML() : items.map(setListCardHTML).join("")}
          </div>
        ` : `
          <div id="insightsPanelContent">
            ${renderInsightsTab(p.items || [])}
          </div>
        `}
      </div>
    </div>`;

  setTimeout(() => {
    if (state.portfolioTab === "items") {
      drawSparkline($("#heroChart"), clipped, { up: gain >= 0 });
    } else {
      drawSparkline($("#heroChart"), clipped, { up: gain >= 0 });
      const container = $("#insightsDoubleChart");
      if (container) drawDoubleSparkline(container, clipped);
    }
  }, 40);
  
  animateHeroValue(totalVal);
  if (state.portfolioTab === "insights") wireInsightsTab();

  $$(".portfolio-tab").forEach(tabBtn => {
    tabBtn.addEventListener("click", () => {
      state.portfolioTab = tabBtn.dataset.tab;
      haptic("light");
      paintPortfolio();
    });
  });

  $$("#rangePills button").forEach(b => b.addEventListener("click", () => {
    state.filter.range = b.dataset.r; haptic("light");
    $$("#rangePills button").forEach(x => x.classList.toggle("active", x.dataset.r === state.filter.range));
    const d = ranges[state.filter.range] || 30;
    const freshClipped = hist.slice(-Math.min(d + 1, hist.length));
    drawSparkline($("#heroChart"), freshClipped, { up: gain >= 0 });
    const container = $("#insightsDoubleChart");
    if (container) drawDoubleSparkline(container, freshClipped);
  }));

  $$(".filter-row .chip").forEach(c => c.addEventListener("click", () => {
    state.filter.sort = c.dataset.sort; localStorage.setItem("bv_sort", c.dataset.sort); haptic("light");
    $$(".filter-row .chip").forEach(x => x.classList.toggle("active", x.dataset.sort === state.filter.sort));
    repaintSetList();
  }));

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
    const shareUrl = `${location.origin}/#/u/${encodeURIComponent(handle)}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "My LEGO Brickvault",
          text: `Check out my LEGO collection on Brickvault!`,
          url: shareUrl
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          navigator.clipboard.writeText(shareUrl);
          toast("Link copied to clipboard!", "success");
        }
      }
    } else {
      navigator.clipboard.writeText(shareUrl);
      toast("Link copied to clipboard!", "success");
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

function animateHeroValue(target) {
  const el = $("#heroValue");
  if (!el || target == null || isNaN(target) || target <= 0) return;
  if (prefersReducedMotion()) { el.innerHTML = heroValueHTML(target); return; }
  const dur = 750;
  const start = performance.now();
  const from = target * 0.82;
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
  const delta = item.purchase_price ? (item.current_value - item.purchase_price) / item.purchase_price : null;
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
            ${fmtMoney(item.current_value)}
            ${item.trend ? trendBadgeHTML(item.trend) : ""}
          </div>
          <div class="sl-delta ${cls}">${arrow}${dStr}</div>
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
        <div class="sl-value" style="display:flex;align-items:center;justify-content:flex-end;">
          ${fmtMoney(item.current_value)}
          ${item.trend ? trendBadgeHTML(item.trend) : ""}
        </div>
        <div class="sl-delta ${cls}"><span class="arrow">${arrow}</span>${dStr}</div>
      </div>
    </button>`;
}

function emptyVaultHTML() {
  return `
    <div class="onboarding-empty" style="display:flex;flex-direction:column;gap:16px;margin: 16px 0;">
      <div class="empty-cta-card" style="background:linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%);border:2.5px dashed var(--line);border-radius:var(--r-3);padding:24px 20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;box-shadow:var(--shadow-1);">
        <div class="u-center" style="color:var(--ink-mute);">${I.box({w:36,h:36})}</div>
        <h3 style="font-family:var(--font-heading);font-weight:600;font-size:18px;margin:0;">Start Your Brick Vault</h3>
        <p style="font-size:13px;color:var(--ink-mute);margin:0;line-height:1.4;max-width:280px;">Scan barcode boxes, search the catalog, and track your retirement values and ROI in real time.</p>
        <a href="#/add" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:var(--r-2);font-weight:600;margin-top:8px;text-decoration:none;">
          <span>Add your first set</span> ${I.arrowR({w:14, h:14})}
        </a>
      </div>
      
      <div style="font-family:var(--mono);font-size:10px;color:var(--ink-faint);text-transform:uppercase;letter-spacing:0.1em;margin-top:8px;padding-left:4px;">Demo Portfolio Preview</div>
      
      <div class="set-list compact-list" style="opacity:0.7;pointer-events:none;user-select:none;">
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
      ${spikeAlerts.map(spikeAlertCardHTML).join("")}
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
}

/* ============================================================
   Portfolio Insights Helpers
   ============================================================ */
function renderInsightsTab(items) {
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
        <div class="signal-row-sub">eBay ${hot ? "+" : "−"}${Math.abs(s.spread * 100).toFixed(0)}% vs ${s.item.bl_new_value ? "BrickLink" : "value"}${s.item.quantity > 1 ? ` · ×${s.item.quantity}` : ""}</div>
      </div>
      <strong class="signal-row-gap" style="color:${hot ? "var(--up)" : "var(--bv-red)"};">${hot ? "+" : ""}${fmtMoney(s.gap)}</strong>
    </div>`;
  const signalsCard = (signals.hot.length || signals.cold.length) ? `
      <div class="section-title" style="margin-top:0;">Market Signals</div>
      <div class="card signals-card" style="padding:12px 16px;margin-bottom:18px;">
        ${signals.totalUpside > 0 ? `<div class="signals-headline">≈ ${fmtMoney(signals.totalUpside)} upside across ${signals.hot.length} set${signals.hot.length > 1 ? "s" : ""} if sold on eBay</div>` : ""}
        ${signals.hot.length ? `<div class="signals-group-label" style="color:var(--up);">🔥 Sell signals — eBay running hot</div>${signals.hot.slice(0, 3).map(s => signalRow(s, true)).join("")}` : ""}
        ${signals.cold.length ? `<div class="signals-group-label" style="color:var(--bv-red);">❄️ Buy windows — eBay below market</div>${signals.cold.slice(0, 3).map(s => signalRow(s, false)).join("")}` : ""}
      </div>` : "";

  return `
    <div style="padding:12px 16px;">
      ${signalsCard}
      <div class="section-title" ${signalsCard ? "" : 'style="margin-top:0;"'}>S&P 500 Performance Comparison</div>
      <div class="card" style="padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:12px;color:var(--ink-mute);line-height:1.4;margin-bottom:12px;">
          Compare your LEGO portfolio growth (solid <span style="color:var(--up);font-weight:700;">green</span>) against S&P 500 compounding at 8%/year (dashed <span style="color:var(--ink-soft);font-weight:600;">gray</span>) using dollar-cost averaging.
        </div>
        <div class="spark-wrap" id="insightsDoubleChart" style="height:120px;margin-top:14px;"></div>
      </div>

      <div class="section-title">Top Movers (90-day Slope)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
        <div class="card" style="padding:12px;">
          <div class="u-row u-gap-1" style="font-size:12px;font-family:var(--mono);color:var(--up);margin-bottom:8px;font-weight:700;">${I.trend({w:13,h:13})} TOP RISING</div>
          ${rising.length === 0 ? `<div style="font-size:12px;color:var(--ink-mute);">No significant gainers</div>` : rising.map(item => `
            <div style="margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;">
              <span class="insight-set-link" data-set="${escapeHtml(item.set_num)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;text-decoration:underline;cursor:pointer;">${escapeHtml(item.name)}</span>
              <strong style="color:var(--up);font-family:var(--mono);">+${item.slope_90d.toFixed(1)}%/wk</strong>
            </div>
          `).join("")}
        </div>
        <div class="card" style="padding:12px;">
          <div class="u-row u-gap-1" style="font-size:12px;font-family:var(--mono);color:var(--bv-red);margin-bottom:8px;font-weight:700;">${I.trendDown({w:13,h:13})} TOP FALLING</div>
          ${falling.length === 0 ? `<div style="font-size:12px;color:var(--ink-mute);">No significant decliners</div>` : falling.map(item => `
            <div style="margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center;">
              <span class="insight-set-link" data-set="${escapeHtml(item.set_num)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px;text-decoration:underline;cursor:pointer;">${escapeHtml(item.name)}</span>
              <strong style="color:var(--bv-red);font-family:var(--mono);">${item.slope_90d.toFixed(1)}%/wk</strong>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="section-title">Retirement Radar</div>
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

  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerleave", onLeave);
  container.addEventListener("touchmove", onMove, { passive: true });
  container.addEventListener("touchend", onLeave);
}

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
    paintSetDetail(set, entry);
  } catch (e) {
    $("#root").innerHTML = `<div class="page"><p>Set not found.</p></div>`;
  }
}

function paintSetDetail(set, entry) {
  const isWish = state.wishlist.some(w => w.set_num === set.set_num);
  const owned = !!entry;
  const h = setHue(set);
  const displayImg = set.image_url;
  const hasImg = displayImg && !displayImg.startsWith("data:");

  $("#root").innerHTML = `
    <div class="page no-pad detail-page-container">
      <div class="detail-hero-col">
        <div class="detail-hero${hasImg ? " has-photo" : ""}">
          <button class="detail-back" id="detailBack" aria-label="Back">${I.chevL()}</button>
          ${hasImg
            ? `<div class="detail-hero-bg" style="background-image:url('${escapeHtml(displayImg)}')"></div>`
            : `<div class="detail-hero-bg placeholder" style="--brick-hue:linear-gradient(135deg, oklch(0.72 0.13 ${h}), oklch(0.55 0.13 ${h}));"></div>`}
          <div class="detail-hero-overlay"></div>
          <div class="detail-img${hasImg ? " has-photo" : ""}">
            <div class="brick-art" style="--brick-color:oklch(0.72 0.13 ${h});">${escapeHtml(set.set_num)}</div>
            ${hasImg ? `<img class="set-photo" src="${escapeHtml(displayImg)}" alt="">` : ""}
          </div>
        </div>
      </div>
      <div class="detail-content-col">
        <div class="detail-title-row">
          <div>
            <div class="detail-eyebrow">${escapeHtml(set.theme || "")} · #${escapeHtml(set.set_num)}${set.retired ? " · RETIRED" : ""}${set.lego_retiring_soon ? " · <span style='color:var(--down);font-weight:700;'>RETIRING SOON</span>" : ""}</div>
            <div class="detail-title">${escapeHtml(set.name)}</div>
          </div>
          <button class="detail-share-btn icon-btn" id="shareBtn" aria-label="Share">${I.share()}</button>
        </div>
        <div class="detail-tabs" id="detailTabs">
          ${["info","forecast","manage"].filter(t => t !== "manage" || owned).map(t =>
            `<button data-tab="${t}" class="${state.detail.tab === t ? "active" : ""}">${t[0].toUpperCase()+t.slice(1)}</button>`
          ).join("")}
        </div>
        <div class="detail-tab-panel" id="tabPanels">
          ${state.detail.tab === "info" ? infoTabHTML(set, entry, isWish) :
            state.detail.tab === "forecast" ? forecastTabHTML(set) :
            manageTabHTML(set, entry)}
        </div>
      </div>
    </div>`;

  $("#detailBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });
  $("#shareBtn")?.addEventListener("click", () => shareSet(set));
  $$("#detailTabs button").forEach(b => b.addEventListener("click", () => {
    state.detail.tab = b.dataset.tab; haptic("light"); paintSetDetail(set, entry);
  }));
  if (state.detail.tab === "info") wireInfoTab(set, entry);
  else if (state.detail.tab === "manage") wireManageTab(set, entry);
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

function shareSet(set) {
  const shareUrl = `${location.origin}/#/set/${encodeURIComponent(set.set_num)}`;
  if (navigator.share) {
    navigator.share({
      title: set.name,
      text: `Check out ${set.name} (${set.set_num}) on Brickvault!`,
      url: shareUrl
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(shareUrl);
    toast("Link copied to clipboard!", "success");
  }
}

function infoTabHTML(set, entry, isWish) {
  const owned = !!entry;
  const delta = entry && entry.purchase_price ? (set.current_value - entry.purchase_price) / entry.purchase_price : null;
  const valueSource = set.valuation_method === "market" ? "BrickLink"
    : set.valuation_method === "brickeconomy" ? "BrickEconomy"
    : set.valuation_method === "ai" ? "AI estimate"
    : (set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold") ? "eBay Sold" : "Estimated";

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
    const growthRate = set.be_growth_12m;
    const retiredYear = b.retiredYear ?? set.retired_year;

    const ratingSignal = ratingNum >= 4.0 && reviewCount >= 20
      ? `<span class="signal-hint" style="color:var(--green);font-size:10px;">High demand set</span>`
      : '';
    const growthBadge = growthRate != null
      ? `<div style="grid-column:span 2;display:flex;align-items:center;gap:8px;"><span style="color:var(--ink-mute);">12m growth:</span> <strong style="color:${growthRate >= 0 ? 'var(--up)' : 'var(--down)'};">${growthRate >= 0 ? '+' : ''}${Number(growthRate).toFixed(1)}%/yr</strong></div>`
      : '';
    const retiredYearBadge = retiredYear && set.retired
      ? `<div><span style="color:var(--ink-mute);">Retired:</span> <strong style="color:var(--ink);">${retiredYear}</strong></div>`
      : '';

    const legoStockBadge = set.lego_retiring_soon
      ? `<div style="grid-column:span 2;"><span style="background:rgba(239,68,68,.12);color:var(--down);font-weight:700;border-radius:4px;padding:2px 8px;font-size:11px;">Retiring Soon</span></div>`
      : set.lego_in_stock === 1
      ? `<div style="grid-column:span 2;"><span style="background:rgba(34,197,94,.12);color:var(--up);font-weight:700;border-radius:4px;padding:2px 8px;font-size:11px;">In Stock at LEGO.com</span></div>`
      : '';

    if (ratingNum || ageStr || subthemeStr || growthRate != null || retiredYear || legoStockBadge) {
      bricksetHtml = `
        <div class="card" style="padding:14px 16px;margin-bottom:14px;">
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Catalog Insights</div>
          <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;font-size:12px;">
            ${subthemeStr ? `<div><span style="color:var(--ink-mute);">Subtheme:</span> <strong style="color:var(--ink);">${escapeHtml(subthemeStr)}</strong></div>` : ''}
            ${ageStr ? `<div><span style="color:var(--ink-mute);">Ages:</span> <strong style="color:var(--ink);">${ageStr}</strong></div>` : ''}
            ${retiredYearBadge}
            ${ratingNum ? `<div style="grid-column: span 2; display:flex; align-items:center; gap:8px;"><span style="color:var(--ink-mute);">Community:</span> <strong style="color:var(--ink);">⭐ ${ratingNum.toFixed(1)}</strong> <span style="color:var(--ink-mute);font-size:10px;">${reviewsStr}</span> ${ratingSignal}</div>` : ''}
            ${growthBadge}
            ${legoStockBadge}
          </div>
        </div>
      `;
    }
  }

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
      <div class="card pricing-summary-card" style="margin-bottom:14px; padding:14px 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-family:var(--mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-mute);">eBay Sold Comps</div>
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
            Legacy single-value eBay data is shown until the sold-comps backfill refreshes this set.
          </div>
        ` : ''}
      </div>
    `;
  }
  if (false && ebayPrice > 0) {
    const pricingTreatment = (retailPrice > 0 && ebayPrice < retailPrice) ? 'STP' : (retailPrice > 0 && ebayPrice > retailPrice ? 'APPRECIATED' : 'NONE');
    pricingSummaryHtml = `
      <div class="card pricing-summary-card" style="margin-bottom:14px; padding:14px 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="font-family:var(--mono); font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-mute);">Unused legacy eBay card</div>
          <span class="badge" style="font-size:9px; padding:2px 6px; border-radius:4px; font-family:var(--mono); background:var(--surface-3); color:var(--ink-soft);">${pricingTreatment === 'STP' ? 'STP (Strikethrough)' : pricingTreatment === 'APPRECIATED' ? 'Appreciated' : 'None'}</span>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <div style="font-size:10px; font-family:var(--mono); color:var(--ink-mute); margin-bottom:2px; text-transform:uppercase;">price</div>
            <div style="font-size:18px; font-weight:600; color:var(--ink);">${fmtMoney(ebayPrice)}</div>
          </div>
          
          <div>
            <div style="font-size:10px; font-family:var(--mono); color:var(--ink-mute); margin-bottom:2px; text-transform:uppercase;">Retail (MSRP)</div>
            <div style="font-size:16px; font-weight:500; color:var(--ink-soft); text-decoration: ${pricingTreatment === 'STP' ? 'line-through' : 'none'};">${retailPrice > 0 ? fmtMoney(retailPrice) : "—"}</div>
          </div>
        </div>

        ${pricingTreatment === 'STP' ? `
          <div style="font-size:11px; color:var(--down); margin-top:10px; display:flex; align-items:center; gap:6px;">
            <span style="font-size:8px;">●</span> Pricing Treatment: Save ${fmtMoney(retailPrice - ebayPrice)} (${fmtPct((retailPrice - ebayPrice) / retailPrice)}) below MSRP.
          </div>
        ` : pricingTreatment === 'APPRECIATED' ? `
          <div style="font-size:11px; color:var(--up); margin-top:10px; display:flex; align-items:center; gap:6px;">
            <span style="font-size:8px;">●</span> Pricing Treatment: Appreciated by ${fmtMoney(ebayPrice - retailPrice)} (${fmtPct((ebayPrice - retailPrice) / retailPrice)}) above MSRP.
          </div>
        ` : ''}
      </div>
    `;
  }

  const newVal = set.current_value || 0;
  const usedVal = set.used_value || 0;
  const spreadPct = newVal > 0 && usedVal > 0 ? ((newVal - usedVal) / newVal * 100).toFixed(1) : null;

  const aiDisclaimerHTML = set.valuation_method === "ai" ? `
    <div style="background:rgba(245,158,11,0.1); border:1.5px solid rgba(245,158,11,0.3); color:rgba(245,158,11,1.0); border-radius:var(--r-2); padding:10px 12px; font-size:12px; margin-bottom:14px; display:flex; align-items:center; gap:8px; font-weight: 500;">
      <span class="u-center">${I.alert({w:15,h:15})}</span>
      <span>AI-estimated price — may vary from market.</span>
    </div>
  ` : '';

  return `
    ${priceStripHTML(set, entry)}
    ${marketSpreadHTML(set)}
    ${marketDepthHTML(set)}
    ${marketConfidenceHTML(set)}
    ${aiDisclaimerHTML}
    ${pricingSummaryHtml}
    
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">New vs Used Value</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          <div style="font-size:10px;color:var(--ink-mute);font-family:var(--mono);text-transform:uppercase;">New (In Box)</div>
          <div style="font-size:20px;font-weight:700;color:var(--ink);">${fmtMoney(newVal)}</div>
        </div>
        <div>
          <div style="font-size:10px;color:var(--ink-mute);font-family:var(--mono);text-transform:uppercase;">Used (Loose)</div>
          <div style="font-size:20px;font-weight:700;color:var(--ink);">${usedVal > 0 ? fmtMoney(usedVal) : "—"}</div>
        </div>
      </div>
      ${spreadPct !== null ? `
        <div style="font-size:11px;color:var(--ink-soft);margin-top:8px;border-top:1px solid var(--line-soft);padding-top:8px;">
          Used is <strong>${spreadPct}%</strong> cheaper than New (Spread: ${fmtMoney(newVal - usedVal)}).
        </div>
      ` : ''}
    </div>

    <div class="stat-grid">
      <div class="stat-cell">
        <div class="lbl">${I.dollar()}Market (new)</div>
        <div class="val s">${set.current_value ? fmtMoney(set.current_value) : "—"}</div>
        ${delta != null ? `<div class="delta ${delta >= 0 ? "up" : "down"}" style="margin-top:6px;"><span class="arrow">${delta >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(delta))}</div>` : ""}
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);margin-top:4px;letter-spacing:0.08em;">${valueSource}</div>
      </div>
      <div class="stat-cell">
        <div class="lbl">${I.tag()}Retail</div>
        <div class="val s">${fmtMoney(set.retail_price)}</div>
        <div style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);margin-top:4px;letter-spacing:0.08em;">${set.year || ""} · MSRP</div>
      </div>
      <div class="stat-cell">
        <div class="lbl">${I.box()}Pieces</div>
        <div class="val s">${(set.pieces || 0).toLocaleString()}</div>
        ${(() => { const r = pricePerPiece(set); return r ? `<div style="font-family:var(--mono);font-size:10px;color:${r.delta <= -0.25 ? "var(--up)" : r.delta >= 0.25 ? "var(--down)" : "var(--ink-mute)"};margin-top:4px;letter-spacing:0.08em;">$${r.ppp.toFixed(2)}/pc</div>` : ""; })()}
      </div>
      <div class="stat-cell">
        <div class="lbl">${I.figure()}Minifigs</div>
        <div class="val s">${set.minifigs || 0}</div>
      </div>
    </div>

    ${set.set_minifigs?.length ? `
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:10px;">Minifigs in this set</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${set.set_minifigs.map(f => `
            <div style="display:flex;align-items:center;gap:6px;font-size:12px;" title="${escapeHtml(f.fig_name)}">
              ${f.fig_img_url ? `<img src="${escapeHtml(f.fig_img_url)}" alt="" style="width:32px;height:32px;object-fit:contain;border-radius:4px;background:var(--surface-2);">` : `<div style="width:32px;height:32px;background:var(--surface-2);border-radius:4px;"></div>`}
              <div>
                <div style="color:var(--ink-soft);font-size:11px;font-family:var(--mono);">${escapeHtml(f.fig_num)}</div>
                ${f.quantity > 1 ? `<div style="color:var(--ink-mute);font-size:10px;">×${f.quantity}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Price history · 90d</div>
      <div class="spark-wrap" id="setSpark" style="height:60px;"></div>
      <div class="spark-legend" id="setSparkLegend"></div>
    </div>

    ${bricksetHtml}

    ${owned ? `
      <div class="qty-row">
        <div>
          <div class="qty-row-lbl">In your vault</div>
          <div class="qty-row-val" id="qtyBadgeVal">×${entry.quantity}</div>
        </div>
        <div class="qty-stepper">
          <button class="qty-btn" id="qtyDown">${I.minus()}</button>
          <div class="qty-num" id="qtyNum">${entry.quantity}</div>
          <button class="qty-btn" id="qtyUp">${I.plus()}</button>
        </div>
      </div>
      <div class="btn-row" style="margin-bottom: 8px;">
        <button class="btn-secondary" id="wishToggle">
          ${isWish ? I.heartF() : I.heart()}
          <span>${isWish ? "Wishlisted" : "Wishlist"}</span>
        </button>
        <a class="btn-secondary" href="#/set/${encodeURIComponent(set.set_num)}/manage">
          ${I.gear()}<span>Manage</span>
        </a>
      </div>
      <button class="btn-secondary" id="genListingBtn" style="width:100%; display:flex; align-items:center; justify-content:center; gap:6px;">
        ⚡ <span>Generate eBay Listing</span>
      </button>
    ` : `
      <button class="btn-primary" id="addBtn">${I.plus()}<span>Add to vault · ${fmtMoney(set.current_value, { cents: 0 })}</span></button>
      <button class="btn-secondary" id="wishToggle" style="margin-top:8px;">
        ${isWish ? I.heartF() : I.heart()}
        <span>${isWish ? "Remove from wishlist" : "Add to wishlist"}</span>
      </button>
    `}
    <a class="bl-buy-link" href="${bricklinkBuyURL(set.set_num)}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--ink-mute);text-decoration:underline;margin-top:14px;">
      View on BrickLink ${I.extLink()}
    </a>
    <a class="bl-buy-link" href="https://www.google.com/search?q=LEGO+${encodeURIComponent(set.set_num)}+building+instructions+PDF" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:var(--ink-mute);text-decoration:underline;margin-top:8px;">
      Search Building Instructions PDF ${I.extLink()}
    </a>`;
}

function wireInfoTab(set, entry) {
  loadSetHistory(set.set_num);

  let qty = entry?.quantity || 1;
  $("#qtyDown")?.addEventListener("click", async () => {
    if (qty <= 1) return;
    haptic("medium");
    qty--;
    $("#qtyNum").textContent = qty;
    const badge = $("#qtyBadgeVal");
    if (badge) badge.textContent = `×${qty}`;
    try { await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } }); invalidatePortfolio(); }
    catch (e) { toast("Save failed", "error"); }
  });
  $("#qtyUp")?.addEventListener("click", async () => {
    haptic("medium");
    qty++;
    $("#qtyNum").textContent = qty;
    const badge = $("#qtyBadgeVal");
    if (badge) badge.textContent = `×${qty}`;
    try { await api("/api/collection/" + entry.id, { method: "PATCH", body: { quantity: qty } }); invalidatePortfolio(); }
    catch (e) { toast("Save failed", "error"); }
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
      const prevCount = state.portfolio?.items?.length ?? 0;
      const prevValue = state.portfolio?.total_value ?? 0;
      await api("/api/collection", { method: "POST", body: { set_num: set.set_num, quantity: 1, purchase_price: set.current_value } });
      invalidatePortfolio(); state.catalog.items = [];
      toast("Added to vault", "success");
      const newCount = prevCount + 1;
      const newValue = prevValue + (Number(set.current_value) || 0);
      const countMs = [[1,"Your first set! Welcome to Brickvault!"],[10,"10 sets in the vault!"],[25,"25 sets! Nice collection."],[50,"50 sets! Dedicated collector 🏅"],[100,"100 sets! Elite collector 🏆"]];
      const valueMs = [[1000,"$1,000 portfolio milestone!"],[5000,"$5,000 portfolio!"],[10000,"$10,000 portfolio 💰"],[50000,"$50,000 — serious money 🤑"]];
      for (const [n, msg] of countMs) {
        if (prevCount < n && newCount >= n) { haptic("heavy"); setTimeout(() => { toast(msg, "milestone"); confettiBurst(); }, 700); break; }
      }
      for (const [v, msg] of valueMs) {
        if (prevValue < v && newValue >= v) { haptic("heavy"); setTimeout(() => { toast(msg, "milestone"); confettiBurst(); }, 1100); break; }
      }
      const r = await api("/api/sets/" + encodeURIComponent(set.set_num));
      state.detail.cache[set.set_num] = { set: r.set || r, entry: r.entry || null, ts: Date.now() };
      paintSetDetail(r.set || r, r.entry || null);
    } catch (e) {
      setBtnLoading($("#addBtn"), false);
      if (!navigator.onLine) {
        outboxEnqueue({ path: '/api/collection', method: 'POST', body: { set_num: set.set_num, quantity: 1, purchase_price: set.current_value } });
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

function forecastTabHTML(set) {
  const g2 = set.forecast_2y && set.current_value ? (set.forecast_2y - set.current_value) / set.current_value : 0.18;
  const g5 = set.forecast_5y && set.current_value ? (set.forecast_5y - set.current_value) / set.current_value : 0.45;
  const pct = (g) => Math.min(100, Math.max(8, g * 100 + 12)).toFixed(1);
  const forecastLabel = set.valuation_method === "market" ? "Market value · BrickLink"
    : set.valuation_method === "brickeconomy" ? "Market value · BrickEconomy"
    : set.valuation_method === "ai" ? "AI forecast · GPT-4o-mini"
    : (set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold") ? "Market value · eBay Sold" : "Estimated";
  return `
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        ${I.sparkles()}
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);">${forecastLabel}</div>
      </div>
      <p style="margin:6px 0 0;font-size:13px;color:var(--ink-soft);line-height:1.45;">
        ${set.valuation_method === "market"
          ? "Based on recent completed sales on BrickLink."
          : set.valuation_method === "brickeconomy"
          ? "Based on professional market analysis from BrickEconomy."
          : (set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold")
          ? "Based on recent eBay sold comps."
          : `Based on theme rarity, piece count, retirement status, and market trends for similar ${escapeHtml(set.theme || "")} sets.`}
      </p>
    </div>

    <div class="forecast-card">
      <div class="fh">
        <div class="fh-lbl">2-year forecast</div>
        <div class="fh-val">${fmtMoney(set.forecast_2y)}</div>
      </div>
      <div class="forecast-bar"><div style="--fill:${pct(g2)}%;"></div></div>
      <div class="forecast-pct${g2 < 0 ? " down" : ""}">${g2 >= 0 ? I.arrowU() : I.arrowD()}${fmtPct(g2)} projected</div>
    </div>

    <div class="forecast-card">
      <div class="fh">
        <div class="fh-lbl">5-year forecast</div>
        <div class="fh-val">${fmtMoney(set.forecast_5y)}</div>
      </div>
      <div class="forecast-bar"><div style="--fill:${pct(g5)}%;"></div></div>
      <div class="forecast-pct${g5 < 0 ? " down" : ""}">${g5 >= 0 ? I.arrowU() : I.arrowD()}${fmtPct(g5)} projected</div>
    </div>

    <div class="card" style="background:var(--surface-2);margin-top:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:8px;">Confidence factors</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--ink-soft);line-height:1.55;">
        <li>${set.retired ? "Retired — supply is fixed" : "Active — value tied to retail"}</li>
        <li>${(set.pieces||0) > 2000 ? "Large set, high collector appeal" : (set.pieces||0) > 500 ? "Mid-size set, moderate appeal" : "Compact set, lower aftermarket premium"}</li>
        <li>${(set.minifigs||0) >= 5 ? "Many minifigs — strong parts-out potential" : "Few/no minifigs — value driven by set alone"}</li>
      </ul>
    </div>`;
}

function manageTabHTML(set, entry) {
  if (!entry) return `<p style="color:var(--ink-mute);">Not in your vault.</p>`;
  return `
    <div class="u-between u-mb-2">
      <span class="u-mono-label">Set details</span>
      <span id="manageSaveState" class="badge badge--neutral" aria-live="polite" style="visibility:hidden;">Saved ✓</span>
    </div>
    <fieldset class="form-group" style="border:none;padding:0;margin:0 0 6px;">
      <legend class="u-mono-label u-mb-1">Purchase</legend>
      <div class="field">
        <div class="field-lbl">Purchase price</div>
        <input id="mPrice" type="number" step="0.01" value="${entry.purchase_price ?? ""}" placeholder="0.00">
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
    <fieldset class="form-group" style="border:none;padding:0;margin:0 0 6px;">
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
    <fieldset class="form-group" style="border:none;padding:0;margin:0 0 6px;">
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

    <div class="card" style="padding:14px 16px;margin-bottom:14px;" id="partsCard">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);">Parts completeness</div>
        <button class="btn-secondary" id="loadPartsBtn" style="font-size:11px;padding:4px 10px;">Load parts</button>
      </div>
      <div id="partsContent" style="font-size:13px;color:var(--ink-mute);">Tap "Load parts" to check set completeness.</div>
    </div>

    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:10px;">Custom Photo</div>
      ${entry.custom_image_url ? `
        <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;">
          <img id="customPhotoImg" alt="Custom photo" style="width:80px;height:80px;object-fit:cover;border-radius:var(--r-1);border:1px solid var(--line);background:var(--surface-2);">
          <button id="removePhotoBtn" class="btn-secondary" style="font-size:12px;padding:6px 12px;color:var(--down);">Remove photo</button>
        </div>
      ` : `<p style="font-size:12px;color:var(--ink-mute);margin-bottom:10px;">Upload your own photo for this set.</p>`}
      <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="file" id="photoUpload" accept="image/jpeg,image/png,image/webp" style="display:none;">
        <button class="btn-secondary" id="photoUploadBtn" style="font-size:12px;padding:6px 12px;">${I.camera ? I.camera() : "📷"} Upload photo</button>
      </label>
      <div id="photoUploadStatus" style="font-size:11px;color:var(--ink-mute);margin-top:6px;display:none;"></div>
    </div>

      <button class="btn-danger" id="mRemove" style="margin-top:14px;">${I.trash()}<span>Remove from vault</span></button>
      <button class="btn-secondary" id="mListSale" style="margin-top:8px;">${I.tag()}<span>List for Sale</span></button>`;
}

function wireManageTab(set, entry) {
  if (!entry) return;

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
    if (!(await confirmSheet({ title: "Remove from vault?", message: "This set will be removed from your collection.", confirmLabel: "Remove", danger: true }))) return;
    haptic("heavy");
    try {
      await api("/api/collection/" + entry.id, { method: "DELETE" });
      invalidatePortfolio();
      delete state.detail.cache[set.set_num];
      toast("Removed from vault", "info");
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
    } catch (e) {
      content.textContent = "Failed to load parts.";
      btn.textContent = "Retry";
      btn.disabled = false;
    }
  });
}

function optionalMoneyInput(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function setupTabSwipe(set, entry) {
  const el = $("#tabPanels"); if (!el) return;
  if (_swipeAc) _swipeAc.abort();
  _swipeAc = new AbortController();
  const { signal } = _swipeAc;
  let sx = 0, sy = 0, active = false;
  el.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; active = true; }, { passive: true, signal });
  el.addEventListener("touchend", e => {
    if (!active) return; active = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const owned = !!entry;
      const tabs = owned ? ["info","forecast","manage"] : ["info","forecast"];
      const idx = tabs.indexOf(state.detail.tab);
      const next = clamp(idx + (dx < 0 ? 1 : -1), 0, tabs.length - 1);
      if (next !== idx) { state.detail.tab = tabs[next]; haptic("light"); paintSetDetail(set, entry); }
    }
  }, { signal });
}

/* ============================================================
   Wishlist screen
   ============================================================ */
export async function renderWishlist() {
  if (!state.wishlist?.length) $("#root").innerHTML = skelPage(skelCardList(4));
  try {
    const wl = await api("/api/wishlist");
    const cutoff = Date.now() - 15000;
    for (const [setNum, ts] of Object.entries(state.recentWishlistDeletes || {})) {
      if (ts < cutoff) delete state.recentWishlistDeletes[setNum];
    }
    state.wishlist = (wl.wishlist || []).filter(w => !state.recentWishlistDeletes?.[w.set_num]);
    state.wishlistAlerts = wl.unread_alerts || [];
  } catch (e) { toast("Couldn't load wishlist", "error"); }

  const alerts = [...(state.wishlistAlerts || [])];
  const spikeAlerts = alerts.filter(a => a.alert_type === "spike");
  // Treat legacy null/undefined as drops; exclude spike and any future types.
  const dropAlerts = alerts.filter(a => a.alert_type === "drop" || !a.alert_type);
  const totalAlerts = alerts.length;

  // Sort the list: closest-to-target first, by value, or most recent.
  const wlSort = localStorage.getItem("bv_wl_sort") || "recent";
  const sorted = [...state.wishlist];
  if (wlSort === "gap") {
    const gapOf = w => w.target_price ? (w.current_value - w.target_price) / w.target_price : Infinity;
    sorted.sort((a, b) => gapOf(a) - gapOf(b));
  } else if (wlSort === "value") {
    sorted.sort((a, b) => (b.current_value || 0) - (a.current_value || 0));
  } // "recent" keeps API order (added_at desc)

  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <a href="#/" class="icon-btn" aria-label="Back" style="margin-top:2px;margin-right:8px;">${I.chevL()}</a>
        <div class="topbar-heading">
          <div class="topbar-eyebrow">${state.wishlist.length} sets · ${totalAlerts} alert${totalAlerts !== 1 ? "s" : ""}</div>
          <div class="topbar-title">Wishlist</div>
        </div>
      </div>

      ${totalAlerts > 0 ? `
        <div class="u-between u-mb-2">
          <span class="u-mono-label">${totalAlerts} unread alert${totalAlerts !== 1 ? "s" : ""}</span>
          <button class="btn-secondary" id="wlMarkAllRead" style="padding:6px 12px;font-size:12px;width:auto;">Mark all read</button>
        </div>` : ""}

      ${spikeAlerts.length > 0 ? `
        <div class="section-title">Sell Opportunities 💰</div>
        <div style="margin-bottom:14px;">
          ${spikeAlerts.map(a => spikeAlertCardHTML(a)).join("")}
        </div>` : ""}

      ${dropAlerts.length > 0 ? `
        <div class="section-title u-row u-gap-1">Price Drops ${I.trendDown({w:12,h:12})}</div>
        <div style="margin-bottom:14px;">
          ${dropAlerts.map(a => `
            <div class="alert-card">
              <div class="ah">${I.bell()}Price drop · ${daysAgo(a.triggered_at)}d ago</div>
              <div style="font-weight:600;">${escapeHtml(a.set_name)}</div>
              <div style="font-size:13px;margin-top:4px;">Now <strong>${fmtMoney(a.current_value)}</strong> — your target was ${fmtMoney(a.target_price)}.</div>
            </div>`).join("")}
        </div>` : ""}

      ${state.wishlist.length > 1 ? `
        <div class="filter-row" style="margin-bottom:10px;">
          ${[["recent","Recent"],["gap","Closest to target"],["value","By value"]]
            .map(([k,l]) => `<button class="chip ${wlSort === k ? "active" : ""}" data-wl-sort="${k}">${l}</button>`).join("")}
        </div>` : ""}

      ${state.wishlist.length === 0 ? `
        <div class="empty card">
          <div class="empty-icon">${I.heart()}</div>
          <h3>Nothing wishlisted yet</h3>
          <p>Tap the heart on any set to watch it. We'll alert you when the price hits your target.</p>
        </div>` : `
        <div>${sorted.map(wishlistCardHTML).join("")}</div>`}
    </div>`;

  $("#wlMarkAllRead")?.addEventListener("click", async () => {
    haptic("medium");
    state.wishlistAlerts = [];
    refreshNavBadge();
    await Promise.all(alerts.map(a =>
      api(`/api/wishlist/${a.id}`, { method: "POST" }).catch(err => console.error("Failed to mark alert as read:", err))
    ));
    renderWishlist();
  });

  $$("[data-wl-sort]").forEach(b => b.addEventListener("click", () => {
    localStorage.setItem("bv_wl_sort", b.dataset.wlSort);
    haptic("light");
    renderWishlist();
  }));

  $$(".wishlist-card").forEach(c => c.addEventListener("click", () => {
    location.hash = "#/set/" + encodeURIComponent(c.dataset.set);
  }));
  $$(".wishlist-card .bl-badge").forEach(a => a.addEventListener("click", e => {
    e.stopPropagation();
  }));
  $$(".spike-alert[data-set]").forEach(c => c.addEventListener("click", (e) => {
    if (e.target.tagName === "A") return;
    location.hash = "#/set/" + encodeURIComponent(c.dataset.set);
  }));
}

function wishlistCardHTML(w) {
  const gap = w.target_price ? ((w.current_value - w.target_price) / w.target_price) : null;
  const hit = gap != null && gap <= 0;
  const progress = gap == null ? 100 : Math.min(100, Math.max(0, 100 - gap * 100));
  const h = setHue(w);
  const hasImg = w.image_url && !w.image_url.startsWith("data:");
  return `
    <div class="wishlist-card" data-set="${escapeHtml(w.set_num)}" style="cursor:pointer;position:relative;">
      <div class="sl-img has-tile${hasImg ? " has-photo" : ""}" style="width:72px;height:76px;">
        <div class="brick-tile" style="--h:${h};width:100%;height:76%;margin-top:auto;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(w.image_url)}" alt="" loading="lazy">` : ""}
      </div>
      <div class="sl-body" style="flex:1;text-align:left;padding-right:32px;">
        <div class="sl-name">${escapeHtml(w.name || w.set_num)}</div>
        <div class="sl-meta">
          <span>${escapeHtml(w.theme || "")}</span>
          <span class="dot"></span>
          <span>${escapeHtml(w.set_num)}</span>
        </div>
        <div class="gap-row">
          <span style="color:var(--ink-mute);">Now ${fmtMoney(w.current_value, { cents: 0 })}</span>
          <span style="color:${hit ? "var(--up)" : "var(--ink)"};font-weight:700;">${gap == null ? "No target" : hit ? "AT TARGET" : "Target " + fmtMoney(w.target_price, { cents: 0 })}</span>
        </div>
        <div class="progress${hit ? " over" : ""}"><div style="width:${progress}%;"></div></div>
        ${buyWindowHTML(w)}
        ${(w.retirement_risk_score || 0) >= 70 && !w.retired ? `<div class="u-row u-gap-1" style="font-size:11px;color:var(--down);margin-top:4px;font-family:var(--mono);">${I.alert({w:12,h:12})} Retirement risk: High</div>` : ""}
      </div>
      <a href="${bricklinkBuyURL(w.set_num)}" target="_blank" rel="noopener" class="bl-badge" style="position:absolute;bottom:10px;right:10px;z-index:5;font-size:10px;font-family:var(--mono);font-weight:700;padding:2px 5px;background:var(--bv-yellow);color:#000;border:1.5px solid var(--line);border-radius:var(--r-1);text-decoration:none;">BL ↗</a>
    </div>`;
}

// 30-day trend → actionable hint under the wishlist target progress bar.
function buyWindowHTML(w) {
  const bw = buyWindow(w);
  if (!bw) return "";
  const style = bw.state === "near"
    ? "color:var(--up);font-weight:700;"
    : bw.state === "approaching"
      ? "color:var(--up);"
      : "color:var(--ink-mute);";
  const icon = bw.state === "near" ? "🎯" : bw.state === "approaching" ? "↘" : "↗";
  return `<div style="font-size:11px;margin-top:4px;font-family:var(--mono);${style}">${icon} ${escapeHtml(bw.label)}</div>`;
}

/* ============================================================
   Public collection profile
   ============================================================ */
export async function renderPublicProfile(handle) {
  let profile;
  try {
    const r = await fetch((window.WORKER_BASE || '') + "/api/users/" + encodeURIComponent(handle) + "/profile");
    if (!r.ok) throw new Error(r.status === 404 ? "Profile not found or private" : "Couldn't load profile");
    profile = await r.json();
  } catch (err) {
    const nav = document.getElementById("nav");
    if (nav) nav.style.display = "";
    $("#root").innerHTML = `<div class="page">
      <div class="topbar">
        <div class="topbar-heading"><div class="topbar-title">Profile</div></div>
        <button class="icon-btn" id="pubBack">${I.chevL()}</button>
      </div>
      <div class="empty card">
        <div class="empty-icon">${I.user()}</div>
        <h3>Profile not found</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>
    </div>`;
    document.getElementById("pubBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });
    return;
  }
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "";
  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">@${escapeHtml(profile.handle || handle)}</div>
          <div class="topbar-title">${escapeHtml(profile.display_name || handle)}</div>
        </div>
        <button class="icon-btn" id="pubBack" aria-label="Back">${I.chevL()}</button>
      </div>
      ${publicStatsHTML(profile)}
      ${(profile.showcase || []).length > 0 ? `
        <div class="section-title">Trophy Shelf</div>
        ${trophyShelfHTML(profile.showcase, profile.expose_public_value !== false)}` : ""}
    </div>`;
  document.getElementById("pubBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });
}

function publicStatsHTML(profile) {
  const showVal = profile.expose_public_value !== false;
  const themeTotal = showVal ? (profile.top_themes || []).reduce((s, t) => s + (t.value || 0), 0) : 0;
  return `
    <div class="summary-grid" style="margin-bottom:14px;">
      <div class="summary-cell"><div class="lbl">Sets</div><div class="val">${profile.set_count || 0}</div></div>
      <div class="summary-cell"><div class="lbl">Collection value</div><div class="val">${showVal ? fmtMoneyShort(profile.total_value || 0) : "Private"}</div></div>
    </div>
    ${showVal && (profile.top_themes || []).length > 1 ? `
      <div class="card" style="padding:14px 16px;margin-bottom:14px;">
        <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:10px;">Top themes</div>
        ${profile.top_themes.map(t => {
          const pct = themeTotal > 0 ? (t.value / themeTotal * 100).toFixed(1) : 0;
          const tc = THEME_COLORS[t.theme] || `oklch(0.55 0.18 ${themeHue(t.theme || "")})`;
          return `<div class="theme-bar-row">
            <div class="theme-bar-name">${escapeHtml(t.theme || "Other")}</div>
            <div class="theme-bar-track"><div class="theme-bar-fill" style="width:${pct}%;background:${tc};"></div></div>
            <div class="theme-bar-pct">${pct}%</div>
          </div>`;
        }).join("")}
      </div>` : ""}`;
}

function trophyShelfHTML(sets, showVal = true) {
  return `<div class="trophy-shelf">${(sets || []).map(s => {
    const hasImg = s.image_url && !s.image_url.startsWith("data:");
    const h = setHue(s);
    return `<a href="#/set/${encodeURIComponent(s.set_num)}" class="trophy-card">
      <div class="set-card-img${hasImg ? " has-photo" : ""}">
        <div class="brick-tile" style="--h:${h};width:64%;height:64%;"></div>
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="" loading="lazy">` : ""}
        ${s.retired ? `<span class="retired-tag">RETIRED</span>` : ""}
      </div>
      <div class="trophy-card-name">${escapeHtml(s.name)}</div>
      ${showVal ? `<div class="trophy-card-val">${fmtMoney(s.current_value)}</div>` : ""}
    </a>`;
  }).join("")}</div>`;
}

/* ============================================================
   eBay Listing Generator
   ============================================================ */
async function showListingSheet(set, entry) {
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
  const marketLocal = (set.current_value || 0) * rate;
  const suggestedLocal = marketLocal * 0.85;

  showSheet(`
    <div style="font-family:var(--serif);font-size:22px;font-weight:500;margin:0 4px 14px;">Add to Wishlist</div>
    <div style="font-size:14px;color:var(--ink-mute);margin:0 4px 14px;">${escapeHtml(set.set_num)} — ${escapeHtml(set.name)}</div>
    
    <div class="field">
      <label class="field-lbl">Target Price (${symbol})</label>
      <input type="number" step="0.01" id="wlTargetPrice" class="field-input" placeholder="0.00" autocomplete="off">
      <div id="wlSuggestedChip" style="display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:4px 8px;background:var(--surface-3);border:1px solid var(--line);border-radius:12px;font-size:12px;cursor:pointer;color:var(--ink);">
        💡 Suggested: ${symbol}${suggestedLocal.toFixed(2)}
      </div>
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

  const estPrice = market * rate;
  const ebayFee = estPrice * (feePct / 100);
  const paypalFee = estPrice * (paymentPct / 100) + (0.30 * rate);
  const totalFees = ebayFee + paypalFee + shipping + tax;
  const net = Math.max(0, estPrice - totalFees);
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

function flipCalcHTML(set, entry) {
  const condition = entry?.condition || 'new';
  const market = parseFloat(marketValueForCondition(set, condition) || 0);
  if (market <= 0) return '';
  
  let estPrice = market;
  if (condition.startsWith('used') && !set.ebay_used_value) {
    const ratio = (set.used_value && set.current_value) ? (set.used_value / set.current_value) : 0.75;
    estPrice = market * ratio;
  }

  const feePct = parseFloat(localStorage.getItem("bv_flip_fee_pct") ?? "13.25");
  const paymentPct = parseFloat(localStorage.getItem("bv_flip_payment_pct") ?? "2.9");
  const shipping = parseFloat(localStorage.getItem("bv_flip_shipping") ?? "5.00");
  const ebayFee = estPrice * (feePct / 100);
  const paypalFee = estPrice * (paymentPct / 100) + 0.30;
  const gross = estPrice;
  const totalFees = ebayFee + paypalFee + shipping;
  const net = Math.max(0, gross - totalFees);
  
  const purchasePrice = parseFloat(entry?.purchase_price || 0);
  let roiHTML = '';
  if (purchasePrice > 0) {
    const netRoi = ((net - purchasePrice) / purchasePrice) * 100;
    const roiColor = netRoi >= 0 ? 'var(--up)' : 'var(--bv-red)';
    roiHTML = `<div style="font-size:11px;margin-top:4px;">Net ROI: <strong style="color:${roiColor};">${netRoi >= 0 ? '+' : ''}${netRoi.toFixed(1)}%</strong></div>`;
  }
  
  return `
    <div class="flip-calc-wrap" style="margin-top:12px;padding:12px;background:var(--surface-3);border:1.5px solid var(--line-soft);border-radius:var(--r-2);">
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px;">Flip Calculator ${I.money({w:12,h:12})}</div>
      <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;text-align:center;font-size:12px;">
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Gross</div>
          <strong style="font-size:13px;">${fmtMoney(gross)}</strong>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Fees & Ship</div>
          <span style="color:var(--bv-red);font-weight:600;">-${fmtMoney(totalFees)}</span>
        </div>
        <div>
          <div style="color:var(--ink-mute);font-size:10px;">Est. Net</div>
          <strong style="color:var(--up);font-size:13px;">${fmtMoney(net)}</strong>
        </div>
      </div>
      <div class="flip-result" style="text-align:left;">${roiHTML}</div>
    </div>`;
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
        { key: "bl_value", color: "var(--ink-mute)", dash: "2 3", label: "BrickLink" },
        { key: "ebay_value", color: "var(--bv-yellow-dark)", dash: "5 4", label: "eBay" },
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

function priceStripHTML(set, entry) {
  const delta = entry?.purchase_price ? (set.current_value - entry.purchase_price) / entry.purchase_price : null;

  // Column 1: primary new-condition valuation source
  const isBE = set.valuation_method === "brickeconomy";
  const isBL = set.valuation_method === "market";
  const label1 = isBE ? "BrickEconomy"
    : isBL ? "BrickLink"
    : set.valuation_method === "ai" ? "AI estimate"
    : (set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold") ? "eBay Sold"
    : "Estimated";
  const val1 = set.current_value;

  // Column 2: cross-source BrickLink new (when BE is primary, show BL independently)
  //           or BrickLink used when BL is primary (most useful comparison)
  const showBlCross = isBE && set.bl_new_value;
  const label2 = showBlCross ? "BrickLink" : "Used";
  const val2 = showBlCross ? set.bl_new_value : set.used_value;

  const ebaySold = ebaySoldSummary(set);
  // Column 3: eBay sold new + used sold/used market comparison. When sold
  // comps are unavailable (gated Marketplace Insights), fall back to the
  // Browse API asking price so the column isn't dead.
  const askValue = Number(set.ebay_ask_value) > 0 ? Number(set.ebay_ask_value) : null;
  const showAsk = !ebaySold.newValue && askValue;
  const label3 = showAsk ? "eBay asking" : showBlCross ? "eBay sold" : "eBay sold new";
  const val3 = ebaySold.newValue || askValue;
  const val3sub = showAsk
    ? (Number(set.ebay_ask_qty) > 0 ? `${set.ebay_ask_qty} listings` : null)
    : (ebaySold.usedValue || (showBlCross ? set.used_value : null));

  const hasEbaySold = ebaySold.newValue || ebaySold.usedValue;
  const ebayTag = hasEbaySold ? ' · eBay sold' : showAsk ? ' · eBay asking' : '';
  const sourceSuffix = isBE && set.bl_new_value
    ? `BrickEconomy · BrickLink${ebayTag}`
    : isBE ? `BrickEconomy${ebayTag}`
    : isBL ? `BrickLink${ebayTag}`
    : set.valuation_method === "ai" ? "AI estimate"
    : set.valuation_method === "ebay_sold" ? "eBay sold comps"
    : set.valuation_method === "ebay_rss" ? "legacy eBay"
    : "formula estimate";

  const updateDateStr = set.cached_at ? fmtDateUpdated(set.cached_at) : null;
  const lastUpdatedText = updateDateStr ? `Updated: ${updateDateStr}` : "Update: pending";

  // Lot counts for BrickLink cells — show as confidence indicator
  const blNewQty = set.bl_new_qty;
  const blUsedQty = set.bl_used_qty;
  const lotLabel = (qty, label) => qty ? `${label} <span style="font-size:9px;opacity:.6;">(${qty} lots)</span>` : label;

  // Price ranges — show spread as volatility signal
  const blNewRange = (set.bl_new_min && set.bl_new_max)
    ? `${fmtMoney(set.bl_new_min)}–${fmtMoney(set.bl_new_max)}`
    : null;
  const blUsedRange = (set.bl_used_min && set.bl_used_max)
    ? `${fmtMoney(set.bl_used_min)}–${fmtMoney(set.bl_used_max)}`
    : null;
  const col2Range = showBlCross ? blNewRange : blUsedRange;

  return `
    <div class="price-strip">
      <div class="ps-cell${entry ? " high" : ""}">
        <div class="ps-lbl">${label1} (new)</div>
        <div class="ps-val">${val1 ? fmtMoney(val1) : "—"}${set.trend ? trendBadgeHTML(set.trend) : ""}</div>
        ${delta != null ? `<div class="delta ${delta >= 0 ? "up" : "down"}"><span class="arrow">${delta >= 0 ? "▲" : "▼"}</span>${fmtPct(Math.abs(delta))}</div>` : ""}
      </div>
      <div class="ps-cell">
        <div class="ps-lbl">${showBlCross ? lotLabel(blNewQty, "BrickLink (new)") : lotLabel(blUsedQty, "Used")}</div>
        <div class="ps-val${!val2 ? " muted" : ""}">${val2 ? fmtMoney(val2) : "—"}</div>
        ${col2Range ? `<div class="ps-sub muted" style="font-size:9px;">${col2Range}</div>` : ""}
      </div>
      <div class="ps-cell">
        <div class="ps-lbl">${label3}</div>
        <div class="ps-val${!val3 ? " muted" : ""}">${val3 ? fmtMoney(val3) : "—"}</div>
        ${val3sub ? `<div class="ps-sub muted">${showAsk ? val3sub : `Used: ${fmtMoney(val3sub)}`}</div>` : ""}
      </div>
    </div>
    <div class="ps-footnote" style="display:flex;align-items:center;justify-content:space-between;width:100%;">
      <span>Sources: ${sourceSuffix}</span>
      <span style="font-family:var(--mono);font-size:10px;color:var(--ink-mute);">${lastUpdatedText}</span>
    </div>`;
}

function marketConfidenceHTML(set) {
  const fallbackSources = () => {
    const primaryName = set.valuation_method === 'brickeconomy' ? 'BrickEconomy'
      : set.valuation_method === 'market' ? 'BrickLink'
      : (set.valuation_method === 'ebay_rss' || set.valuation_method === 'ebay_sold') ? 'eBay sold'
      : set.valuation_method === 'ai' ? 'AI estimate'
      : 'Formula estimate';
    const out = [];
    if (set.current_value) out.push({ id: set.primary_value_source || set.valuation_method || 'primary', name: primaryName, value: set.current_value, condition: 'new' });
    if (set.bl_new_value) out.push({ id: 'bricklink_new', name: 'BrickLink', value: set.bl_new_value, condition: 'new', sample_count: set.bl_new_qty });
    if (set.used_value) out.push({ id: 'used', name: 'Used market', value: set.used_value, condition: 'used', sample_count: set.bl_used_qty });
    const ebay = ebaySoldSummary(set);
    if (ebay.newValue) out.push({ id: ebay.legacy ? 'ebay_legacy' : 'ebay_sold_new', name: ebay.legacy ? 'Legacy eBay' : 'eBay sold new', value: ebay.newValue, condition: 'new', sample_count: ebay.newSampleCount });
    if (ebay.usedValue) out.push({ id: 'ebay_sold_used', name: 'eBay sold used', value: ebay.usedValue, condition: 'used', sample_count: ebay.usedSampleCount });
    if (set.bo_new_value) out.push({ id: 'brickowl_new', name: 'BrickOwl', value: set.bo_new_value, condition: 'new' });
    if (set.bo_used_value) out.push({ id: 'brickowl_used', name: 'BrickOwl used', value: set.bo_used_value, condition: 'used' });
    return out;
  };
  const sources = Array.isArray(set.market_sources) && set.market_sources.length
    ? set.market_sources.filter(s => s.id !== 'retail')
    : fallbackSources();
  const confidence = set.confidence || (set.valuation_method === 'formula_bulk' ? 'estimated' : 'medium');
  const freshness = set.freshness || 'fresh';
  const primary = sources.find(s => s.id === set.primary_value_source) || sources[0] || null;
  const color = confidence === 'high' ? 'var(--up)' : confidence === 'medium' ? 'var(--accent)' : confidence === 'low' ? 'var(--bv-yellow)' : 'var(--bv-red)';
  const explanation = set.valuation_explanation || (
    set.valuation_method === 'brickeconomy' ? 'BrickEconomy is primary, with BrickLink/eBay shown when available.'
      : set.valuation_method === 'market' ? 'BrickLink sold data is primary, with eBay shown when available.'
      : set.valuation_method === 'ebay_sold' ? 'eBay US sold comps are the current fallback source.'
      : set.valuation_method === 'ebay_rss' ? 'Legacy eBay completed-listing data is the current fallback source.'
      : set.valuation_method === 'ai' ? 'AI estimated this value because market sources were unavailable.'
      : 'Formula valuation is used until a market refresh completes.'
  );
  const sourceRows = sources.slice(0, 4).map(s => `
    <div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line-soft);padding-top:7px;margin-top:7px;">
      <span style="min-width:0;color:var(--ink-soft);">${escapeHtml(s.name)} ${s.condition ? `(${escapeHtml(s.condition)})` : ''}</span>
      <span style="font-family:var(--mono);font-weight:700;color:var(--ink);white-space:nowrap;">${s.value ? fmtMoney(s.value) : 'pending'}${s.sample_count ? ` / ${s.sample_count} lots` : ''}</span>
    </div>
  `).join('');
  return `
    ${trustPanelHTML(set)}
    <div class="card" style="padding:14px 16px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
        <div>
          <div style="font-family:var(--mono);font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:4px;">Market confidence</div>
          <div style="font-size:13px;color:var(--ink-soft);line-height:1.45;">${escapeHtml(explanation)}</div>
        </div>
        <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;color:${color};font-weight:800;white-space:nowrap;">${escapeHtml(confidence)} / ${escapeHtml(freshness)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;">
        <span style="color:var(--ink-mute);">Primary source</span>
        <strong style="color:var(--ink);text-align:right;">${escapeHtml(primary?.name || 'Pending refresh')}</strong>
      </div>
      ${sourceRows}
    </div>
  `;
}

// Shows a sell/buy signal when eBay and BrickLink prices diverge >10%.
function marketSpreadHTML(set) {
  const ebay = ebaySoldSummary(set);
  const ebayValue = ebay.newValue;
  if (!ebayValue || !set.current_value) return '';
  const spread = (ebayValue - set.current_value) / set.current_value;
  if (Math.abs(spread) < 0.10) return '';
  const hot = spread > 0;
  return `<div class="market-signal ${hot ? "signal-hot" : "signal-cold"}">
    <span>${hot ? "HOT" : "SOFT"} eBay sold-new ${hot ? "running hot" : "below primary value"} · ${fmtPct(Math.abs(spread))} spread</span>
    <span class="signal-hint">${hot ? "Good time to sell" : "Better to buy on BrickLink"}</span>
  </div>`;
}

// Supply side: how many active eBay listings compete and what they ask,
// compared against sold comps. Scarcity + a healthy sold price = sell signal.
function marketDepthHTML(set) {
  const askValue = Number(set.ebay_ask_value);
  const askQty = Number(set.ebay_ask_qty);
  if (!Number.isFinite(askValue) || askValue <= 0 || !Number.isFinite(askQty) || askQty <= 0) return '';
  const sold = ebaySoldSummary(set).newValue;
  let hint = '';
  if (sold) {
    const askVsSold = (askValue - sold) / sold;
    if (askQty <= 5) hint = `Scarce — only ${askQty} listings`;
    else if (askVsSold > 0.20) hint = 'Sellers are ambitious — price near sold comps to move fast';
    else if (askVsSold < 0) hint = 'Listings under sold comps — buying window';
  }
  return `<div class="market-depth">
    <span class="u-row u-gap-1">${I.box({w:13,h:13})} ${askQty} active listing${askQty > 1 ? 's' : ''} · asking ${fmtMoney(askValue)}${sold ? ` vs ${fmtMoney(sold)} sold` : ''}</span>
    ${hint ? `<span class="signal-hint">${escapeHtml(hint)}</span>` : ''}
  </div>`;
}


function dealScoreHTML(set) {
  return `
    <div class="deal-score-wrap" id="dealScoreWrap">
      <div class="deal-score-lbl">In-store price check</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" class="deal-price-input" id="dealPriceInput" placeholder="Enter store price…" min="0" step="0.01">
        <div class="deal-badge" id="dealBadge"></div>
      </div>
    </div>`;
}

function updateDealBadge(set, priceStr) {
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

function spikeAlertCardHTML(a) {
  const gain = a.purchase_price && a.current_value
    ? (a.current_value - (a.purchase_price || 0)) / (a.purchase_price || 1) : 0;
  return `
    <div class="alert-card spike-alert" data-set="${escapeHtml(a.set_num || "")}">
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
  const withPurchaseDate = items.filter(i => i.purchased_at && (Number(i.purchase_price) > 0 || Number(i.current_value) > 0));
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
    cohorts[year].totalCurrent += (Number(item.current_value) || 0) * qty;
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
    themeMap[t] = (themeMap[t] || 0) + (Number(item.current_value) || 0) * (item.quantity || 1);
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

function wireInsightsTabs(items) {
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

function refreshNavBadge() {
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
function enterSelectionMode(firstId) {
  state.selectionMode = true;
  state.selectedSets = new Set();
  if (firstId) state.selectedSets.add(String(firstId));
  haptic("medium");
  repaintSetList();
  showSelectionBar();
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
  toast("Updating locations...", "info");
  try {
    const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(String(item.id)));
    await Promise.all(selectedItems.map(item => 
      api("/api/collection/" + item.id, { method: "PATCH", body: { storage_location: loc || null } })
    ));
    invalidatePortfolio();
    toast("Storage locations updated", "success");
    exitSelectionMode();
    await renderPortfolio();
  } catch (err) {
    toast("Failed to update: " + err.message, "error");
  }
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
  toast("Deleting sets...", "info");
  try {
    const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(String(item.id)));
    await Promise.all(selectedItems.map(item =>
      api("/api/collection/" + item.id, { method: "DELETE" })
    ));
    invalidatePortfolio();
    toast("Sets removed", "success");
    exitSelectionMode();
    await renderPortfolio();
  } catch (err) {
    toast("Failed to delete: " + err.message, "error");
  }
}

function handleBulkExport() {
  const selectedItems = state.portfolio.items.filter(item => state.selectedSets.has(String(item.id)));
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
