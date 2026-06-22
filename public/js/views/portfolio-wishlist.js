import { $, $$, haptic, escapeHtml, toast, fmtMoney, daysAgo, setHue, bricklinkBuyURL, bvIDB } from '../utils.js';
import { state } from '../state.js';
import { api, getSessionUserId } from '../api.js';
import { I } from '../icons.js';
import { skelPage, skelCardList } from '../components/skeleton.js';
import { buyWindow } from '../lib/pure.js';
// spikeAlertCardHTML + refreshNavBadge are shared with the vault view, so they
// stay in portfolio.js (this is the only back-import; portfolio.js never imports
// this module, so there is no cycle — the router lazy-loads each view).
import { spikeAlertCardHTML, refreshNavBadge } from './portfolio.js';

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
    bvIDB.set('wishlist', { data: { wishlist: state.wishlist, alerts: state.wishlistAlerts }, ts: Date.now(), userId: getSessionUserId() }).catch(() => {});
  } catch (e) {
    // Offline: render whatever hydrateFromIDB restored rather than erroring out.
    if (!navigator.onLine) toast(state.wishlist?.length ? "You're offline — showing cached wishlist" : "You're offline — wishlist isn't cached yet", "info");
    else toast("Couldn't load wishlist", "error");
  }

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
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(w.image_url)}" alt="${escapeHtml(w.name || '')}" loading="lazy">` : ""}
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
