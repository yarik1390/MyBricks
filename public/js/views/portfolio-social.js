import { $, escapeHtml, fmtMoney, fmtMoneyShort, themeHue, setHue, THEME_COLORS } from '../utils.js';
import { I } from '../icons.js';
import { state } from '../state.js';
import { skelCardList } from '../components/skeleton.js';

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
        <div class="topbar-heading"><h1 class="topbar-title">Profile</h1></div>
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
          <h1 class="topbar-title">${escapeHtml(profile.display_name || handle)}</h1>
          ${profile.is_supporter ? '<div class="supporter-flair">⭐ Supporter</div>' : ''}
          ${!profile.is_supporter && profile.approved_contributions > 0 ? `<div class="supporter-flair contributor-flair">✦ Contributor · ${profile.approved_contributions}</div>` : ''}
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

export async function renderLeaderboard() {
  const nav = document.getElementById("nav");
  if (nav) nav.style.display = "";
  $("#root").innerHTML = `
    <div class="page">
      <div class="topbar">
        <div class="topbar-heading">
          <div class="topbar-eyebrow">Community</div>
          <h1 class="topbar-title">Leaderboard</h1>
        </div>
        <button class="icon-btn" id="lbBack" aria-label="Back">${I.chevL()}</button>
      </div>
      <p style="font-size:12.5px;color:var(--ink-mute);margin:-2px 2px 12px;line-height:1.5;">Top public collections by value. Make your profile public and expose your value in the <strong>You</strong> tab to join.</p>
      <div id="lbBody">${skelCardList(8)}</div>
    </div>`;
  document.getElementById("lbBack")?.addEventListener("click", () => { if (history.length > 1) history.back(); else location.hash = "#/"; });

  let leaders = [];
  try {
    const r = await fetch((window.WORKER_BASE || '') + "/api/users/leaderboard");
    if (!r.ok) throw new Error("Couldn't load the leaderboard");
    leaders = (await r.json()).leaders || [];
  } catch (err) {
    const b = $("#lbBody");
    if (b) b.innerHTML = `<div class="empty card"><div class="empty-icon">${I.trend()}</div><h3>Couldn't load leaderboard</h3><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const body = $("#lbBody");
  if (!body) return;
  if (!leaders.length) {
    body.innerHTML = `<div class="empty card">
      <div class="empty-icon">${I.trend()}</div>
      <h3>No public collections yet</h3>
      <p>Be the first — make your profile public and expose your value in the You tab.</p>
    </div>`;
    return;
  }

  const myHandle = state.me?.handle || null;
  const medal = (rank) => rank === 1 ? "#f5b301" : rank === 2 ? "#9aa0ab" : rank === 3 ? "#cd7f32" : "var(--ink-mute)";
  body.innerHTML = `<div class="card" style="padding:6px 4px;">
    ${leaders.map(l => {
      const mine = myHandle && l.handle === myHandle;
      return `<a href="#/u/${encodeURIComponent(l.handle)}" class="lb-row" style="display:flex;align-items:center;gap:12px;padding:11px 12px;text-decoration:none;color:inherit;border-radius:12px;${mine ? 'background:color-mix(in oklch, var(--accent) 12%, transparent);' : ''}">
        <div style="width:30px;text-align:center;font-weight:800;font-size:15px;font-family:var(--mono);color:${medal(l.rank)};">${l.rank}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(l.display_name)}${l.is_supporter ? ' <span class="lb-supporter-star" aria-hidden="true">⭐</span>' : ''}${mine ? ' <span style="font-size:11px;color:var(--accent);font-weight:700;">YOU</span>' : ''}</div>
          <div style="font-size:11px;color:var(--ink-mute);">@${escapeHtml(l.handle)} · ${l.set_count} set${l.set_count === 1 ? '' : 's'}</div>
        </div>
        <div style="font-weight:800;font-size:14px;color:var(--up);">${fmtMoneyShort(l.total_value)}</div>
      </a>`;
    }).join("")}
  </div>`;
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
        ${hasImg ? `<img class="set-photo" src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.name || '')}" loading="lazy">` : ""}
        ${s.retired ? `<span class="retired-tag">RETIRED</span>` : ""}
      </div>
      <div class="trophy-card-name">${escapeHtml(s.name)}</div>
      ${showVal ? `<div class="trophy-card-val">${fmtMoney(s.current_value)}</div>` : ""}
    </a>`;
  }).join("")}</div>`;
}
