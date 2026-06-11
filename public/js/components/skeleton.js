// Skeleton loaders — paint these into #root before the first await when a
// view has no cached data, so cold loads shimmer instead of sitting blank.
// They use the existing .skel/.skel.line shimmer rules in app.css.

export function skelHero() {
  return `
    <div class="card" style="padding:18px;margin-bottom:14px;">
      <div class="skel line" style="width:90px;"></div>
      <div class="skel" style="height:44px;width:60%;margin-top:12px;"></div>
      <div class="u-row u-mt-3">
        <div class="skel line" style="width:80px;"></div>
        <div class="skel line" style="width:64px;"></div>
        <div class="skel line" style="width:72px;"></div>
      </div>
      <div class="skel" style="height:72px;margin-top:16px;"></div>
    </div>`;
}

export function skelCardList(n = 6) {
  return Array.from({ length: n }, () => `
    <div class="card u-row" style="padding:12px;margin-bottom:10px;gap:12px;">
      <div class="skel" style="width:64px;height:64px;flex-shrink:0;"></div>
      <div class="u-flex1">
        <div class="skel line" style="width:70%;"></div>
        <div class="skel line" style="width:45%;margin-top:8px;"></div>
      </div>
      <div class="skel line" style="width:56px;"></div>
    </div>`).join("");
}

export function skelStatGrid(n = 4) {
  return `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px;">
      ${Array.from({ length: n }, () => `
        <div class="card" style="padding:12px;">
          <div class="skel line" style="width:60%;"></div>
          <div class="skel" style="height:26px;width:80%;margin-top:8px;"></div>
        </div>`).join("")}
    </div>`;
}

export function skelDetail() {
  return `
    <div class="page">
      <div class="skel" style="height:220px;margin:0 -22px 16px;border-radius:0;"></div>
      <div class="skel line" style="width:65%;height:22px;"></div>
      <div class="skel line" style="width:40%;margin-top:10px;"></div>
      <div class="skel" style="height:90px;margin-top:18px;"></div>
      ${skelStatGrid(4)}
    </div>`;
}

export function skelSettingRows(n = 4) {
  return Array.from({ length: n }, () => `
    <div class="setting-row">
      <div class="u-flex1">
        <div class="skel line" style="width:40%;"></div>
        <div class="skel line" style="width:70%;margin-top:7px;"></div>
      </div>
    </div>`).join("");
}

/** Full-page skeleton wrapper with a topbar placeholder. */
export function skelPage(inner) {
  return `
    <div class="page" aria-busy="true">
      <div class="topbar"><div class="topbar-heading">
        <div class="skel line" style="width:70px;"></div>
        <div class="skel" style="height:24px;width:140px;margin-top:8px;"></div>
      </div></div>
      ${inner}
    </div>`;
}
