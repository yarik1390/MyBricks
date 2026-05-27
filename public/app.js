// =============================================================
// MYBRICKS — mobile-first LEGO portfolio tracker
// Vanilla JS, hash routing, no framework
// =============================================================

const API = (window.__HATCHABLE__ && window.__HATCHABLE__.api) || '/api';

document.addEventListener('error', e => {
  if (e.target.tagName !== 'IMG') return;
  e.target.style.opacity = '0.15';
}, true);

// ===== State =================================================
const state = {
  portfolio: null,
  portfolioHistory: null,
  themes: [],
  themesLoadedAt: 0,
  me: null,
  wishlist: [],
  wishlistAlerts: [],
  filter: {
    range: '1M',
    sort: localStorage.getItem('mb_sort') || 'added_desc',
    catalogYear: 'all',
    catalogRetired: false,
    catalogTheme: '',
    q: '',
  },
  detail: { tab: 'info' },
  camera: { stream: null, mode: 'barcode', detector: null, scanning: false, timer: null },
  toastTimer: null,
};

// ===== Utilities ============================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function fmtMoney(n, dp = 2) {
  if (n == null || isNaN(n)) return '$0.00';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtMoneyShort(n) {
  const f = Number(n) || 0;
  if (Math.abs(f) >= 1_000_000) return '$' + (f / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(f) >= 1_000) return '$' + (f / 1_000).toFixed(1) + 'K';
  return '$' + Math.round(f);
}
function fmtHero(n) {
  if (n == null || isNaN(n)) return '$0<span class="cents">.00</span>';
  const num = Number(n);
  const sign = num < 0 ? '-' : '';
  const [whole, cents] = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split('.');
  return `${sign}$${whole}<span class="cents">.${cents || '00'}</span>`;
}
function pct(a, b) { return !b ? 0 : ((a - b) / b) * 100; }
function haptic(type = 'light') {
  try { navigator.vibrate?.(type === 'heavy' ? 30 : type === 'medium' ? 15 : 8); } catch {}
  try { window.webkit?.messageHandlers?.haptic?.postMessage(type); } catch {}
}
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function toast(msg, type = 'info') {
  const el = $('#toast');
  clearTimeout(state.toastTimer);
  el.textContent = msg;
  el.className = 'toast show ' + type;
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
async function api(path, opts = {}) {
  const { method = 'GET', body, headers = {} } = opts;
  const fetchOpts = { method, headers: { ...headers } };
  if (body) { fetchOpts.headers['Content-Type'] = 'application/json'; fetchOpts.body = JSON.stringify(body); }
  const r = await fetch(API + path, fetchOpts);
  if (r.status === 304) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ===== Icons ================================================
const I = {
  search:  '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="7"/><path stroke-linecap="round" d="M21 21l-4.35-4.35"/></svg>',
  plus:    '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>',
  check:   '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>',
  trash:   '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><polyline points="3 6 5 6 21 6"/><path stroke-linecap="round" d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path stroke-linecap="round" d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>',
  bell:    '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>',
  heart:   '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>',
  heartFill: '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>',
  arrowL:  '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M15 18l-6-6 6-6"/></svg>',
  arrowR:  '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M9 18l6-6-6-6"/></svg>',
  sparkles:'<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M5 3l.914 2.086L8 6l-2.086.914L5 9l-.914-2.086L2 6l2.086-.914L5 3zM19 11l.914 2.086L22 14l-2.086.914L19 17l-.914-2.086L16 14l2.086-.914L19 11zM12 2l1.5 3.5L17 7l-3.5 1.5L12 12l-1.5-3.5L7 7l3.5-1.5L12 2z"/></svg>',
  share:   '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
  eye:     '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  pencil:  '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>',
  camera:  '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7"><path stroke-linecap="round" d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
};

// ===== Router ===============================================
const routes = [
  { pattern: /^\/$/, render: renderPortfolio },
  { pattern: /^\/add$/, render: renderCatalog },
  { pattern: /^\/pile$/, render: renderPile },
  { pattern: /^\/blind$/, render: renderBlind },
  { pattern: /^\/me$/, render: renderMe },
  { pattern: /^\/wishlist$/, render: renderWishlist },
  { pattern: /^\/set\/(.+)$/, render: m => renderSetDetail(decodeURIComponent(m[1])) },
];

function navigate(hash) { location.hash = hash; }

function router() {
  const hash = location.hash.replace('#', '') || '/';
  updateNav(hash);
  for (const route of routes) {
    const m = hash.match(route.pattern);
    if (m) { route.render(m); return; }
  }
  renderPortfolio();
}

function updateNav(hash) {
  $$('.nav-tab').forEach(tab => {
    const r = tab.dataset.route;
    tab.classList.toggle('active', hash === r || (r !== '/' && hash.startsWith(r)));
  });
}

// ===== Portfolio ============================================
async function renderPortfolio() {
  $('#root').innerHTML = `
    <div class="topbar">
      <div class="brand">
        <div class="brand-mark"></div>
        <span class="brand-name">MyBricks</span>
      </div>
      <div class="topbar-actions">
        <div style="position:relative">
          <button class="icon-btn" id="alertsBtn" aria-label="Alerts">${I.bell}</button>
          <span id="alertDot" style="display:none;position:absolute;top:5px;right:5px;width:9px;height:9px;background:var(--bv-red);border-radius:50%;border:2px solid var(--bg)"></span>
        </div>
        <button class="icon-btn" id="searchToggle" aria-label="Search">${I.search}</button>
      </div>
    </div>
    <div class="page" style="padding-top:8px">
      <div class="search-wrap" id="searchWrap">
        <span class="s-icon">${I.search}</span>
        <input class="search-input" id="portfolioSearch" type="search" placeholder="Search your collection…" autocomplete="off">
      </div>
      <div id="heroSection"><div class="skel card mb-16" style="height:210px"></div></div>
      <div class="filter-row" id="sortRow">
        ${[['added_desc','Recent'],['value_desc','By value'],['roi_desc','By ROI'],['name_asc','A–Z']].map(([s,l]) =>
          `<button class="chip${state.filter.sort===s?' active':''}" data-sort="${s}">${l}</button>`
        ).join('')}
      </div>
      <div id="setList">
        <div class="skel card mb-12" style="height:84px"></div>
        <div class="skel card mb-12" style="height:84px"></div>
        <div class="skel card" style="height:84px"></div>
      </div>
    </div>`;

  $('#alertsBtn').addEventListener('click', showAlertsSheet);
  $('#searchToggle').addEventListener('click', () => {
    const wrap = $('#searchWrap');
    wrap.classList.toggle('open');
    if (wrap.classList.contains('open')) $('#portfolioSearch').focus();
    else { state.filter.q = ''; paintPortfolio(); }
  });
  $('#portfolioSearch').addEventListener('input', debounce(e => {
    state.filter.q = e.target.value.trim().toLowerCase();
    paintPortfolio();
  }, 200));
  $$('.chip[data-sort]').forEach(chip => {
    chip.addEventListener('click', () => {
      state.filter.sort = chip.dataset.sort;
      localStorage.setItem('mb_sort', state.filter.sort);
      $$('.chip[data-sort]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      haptic('light');
      paintPortfolio();
    });
  });

  if (!state.portfolio) {
    try {
      const [port, hist, wl] = await Promise.all([
        api('/collection'), api('/collection/history'), api('/wishlist')
      ]);
      state.portfolio = port;
      state.portfolioHistory = hist;
      state.wishlist = wl.wishlist;
      state.wishlistAlerts = wl.unread_alerts;
    } catch (e) { toast(e.message, 'error'); }
  }
  paintPortfolio();
  updateAlertBadge();
}

function paintPortfolio() {
  if (!state.portfolio) return;
  const { items = [], total_value, total_paid } = state.portfolio;
  const gain = total_value - total_paid;
  const gainPct = pct(total_value, total_paid);

  const heroEl = $('#heroSection');
  if (heroEl) {
    heroEl.innerHTML = `
      <div class="hero">
        <div class="hero-eyebrow"><span class="pulse"></span>Portfolio Value</div>
        <div class="hero-value">${fmtHero(total_value)}</div>
        <div class="hero-meta">
          <span>Invested ${fmtMoney(total_paid)}</span>
          <span class="delta ${gain >= 0 ? 'up' : 'down'}">
            ${gain >= 0 ? '+' : ''}${fmtMoney(Math.abs(gain))} (${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%)
          </span>
        </div>
        <div class="spark-wrap"><canvas id="heroChart"></canvas></div>
        <div class="range-pills">
          ${['1W','1M','3M','1Y','ALL'].map(r =>
            `<button class="${state.filter.range===r?'active':''}" data-range="${r}">${r}</button>`
          ).join('')}
        </div>
      </div>`;
    $$('.range-pills button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter.range = btn.dataset.range;
        $$('.range-pills button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        haptic('light');
        drawHeroChart();
      });
    });
    setTimeout(drawHeroChart, 50);
  }

  let display = items.filter(item => {
    if (!state.filter.q) return true;
    return (item.name||'').toLowerCase().includes(state.filter.q) ||
           (item.set_num||'').toLowerCase().includes(state.filter.q);
  });
  switch (state.filter.sort) {
    case 'value_desc': display.sort((a,b) => (b.current_value||0)-(a.current_value||0)); break;
    case 'roi_desc':   display.sort((a,b) => pct(b.current_value,b.purchase_price)-pct(a.current_value,a.purchase_price)); break;
    case 'name_asc':   display.sort((a,b) => (a.name||'').localeCompare(b.name||'')); break;
    default:           display.sort((a,b) => new Date(b.added_at)-new Date(a.added_at));
  }

  const listEl = $('#setList');
  if (!listEl) return;
  if (!display.length) {
    listEl.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 20px">
        <div style="font-size:48px;margin-bottom:12px">&#x1F9F1;</div>
        <h3 style="font-family:var(--serif);font-size:22px;font-weight:500;margin-bottom:8px">
          ${state.filter.q ? 'No matches' : 'Start your collection'}
        </h3>
        <p style="color:var(--ink-mute);margin-bottom:20px;font-size:14px">
          ${state.filter.q ? 'Try a different search.' : 'Add your first LEGO set to track its value and ROI.'}
        </p>
        <button class="btn-primary" id="goAddBtn" style="width:auto;padding:12px 24px">${I.plus} Browse Catalog</button>
      </div>`;
    $('#goAddBtn')?.addEventListener('click', () => navigate('#/add'));
    return;
  }

  const now = Date.now();
  listEl.innerHTML = `<div class="set-list">${display.map(item => setCardHTML(item, now)).join('')}</div>`;
  $$('.set-list-card').forEach(card =>
    card.addEventListener('click', () => navigate('#/set/' + encodeURIComponent(card.dataset.set)))
  );
  wireCardLongPress();
}

function setCardHTML(item, now = Date.now()) {
  const isNew = item.added_at && (now - new Date(item.added_at).getTime()) < 7 * 86400_000;
  const g = item.purchase_price ? pct(item.current_value, item.purchase_price) : null;
  return `
    <div class="set-list-card" data-set="${item.set_num}" data-id="${item.id}">
      <div class="sl-img">
        ${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" loading="lazy">` : '<span style="font-size:28px">&#x1F9E9;</span>'}
        ${isNew ? '<span class="sl-badge new-badge">NEW</span>' : ''}
        ${item.quantity > 1 ? `<span class="sl-badge qty-badge">&times;${item.quantity}</span>` : ''}
      </div>
      <div class="sl-body">
        <div class="sl-name">${item.name}</div>
        <div class="sl-meta">${item.theme||'—'} &middot; ${item.set_num}</div>
      </div>
      <div class="sl-right">
        <div class="sl-value">${fmtMoney(item.current_value)}</div>
        ${g !== null ? `<div class="sl-delta ${g>=0?'up':'down'}">${g>=0?'+':''}${g.toFixed(0)}%</div>` : ''}
      </div>
    </div>`;
}

function drawHeroChart() {
  const canvas = $('#heroChart');
  if (!canvas || !state.portfolioHistory) return;
  const snaps = state.portfolioHistory.snapshots || [];
  const rangeMs = { '1W':7,'1M':30,'3M':90,'1Y':365,'ALL':99999 }[state.filter.range] * 86400_000;
  const now = Date.now();
  const filtered = snaps.filter(s => now - new Date(s.snapshot_date).getTime() <= rangeMs);
  let data = filtered.map(s => parseFloat(s.total_value) || 0);
  if (!data.length) data = [state.portfolio?.total_value||0, state.portfolio?.total_value||0];
  drawSparkline(canvas, data, { up: data[data.length-1] >= data[0] });
}

function drawSparkline(canvas, data, { up = true, dot = false } = {}) {
  if (!canvas || !data.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 60;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  if (data.length < 2) data = [data[0]||0, data[0]||0];
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pad = 4;
  const toX = i => pad + (i / (data.length - 1)) * (w - pad * 2);
  const toY = v => pad + (1 - (v - min) / range) * (h - pad * 2);
  const color = up ? '#1A7F4B' : '#C0392B';
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, up ? 'rgba(26,127,75,0.2)' : 'rgba(192,57,43,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0]));
  data.forEach((v,i) => { if (i) ctx.lineTo(toX(i), toY(v)); });
  ctx.lineTo(toX(data.length-1), h); ctx.lineTo(toX(0), h);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0]));
  data.forEach((v,i) => { if (i) ctx.lineTo(toX(i), toY(v)); });
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  if (dot) {
    const lx = toX(data.length-1), ly = toY(data[data.length-1]);
    ctx.beginPath(); ctx.arc(lx, ly, 4, 0, Math.PI*2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function updateAlertBadge() {
  const dot = $('#alertDot');
  if (dot) dot.style.display = state.wishlistAlerts?.length ? '' : 'none';
}

function showAlertsSheet() {
  if (!state.wishlistAlerts?.length) { toast('No new alerts'); return; }
  showSheet('Price Alerts', state.wishlistAlerts.map(a => `
    <div class="sheet-item" data-aid="${a.id}">
      ${I.bell}
      <div>
        <strong style="display:block">${a.set_name||a.set_num}</strong>
        <span style="font-size:13px;color:var(--ink-mute)">Dropped to ${fmtMoney(a.current_value)} &middot; target ${fmtMoney(a.target_price)}</span>
      </div>
    </div>`).join(''), () => {
    $$('.sheet-item[data-aid]').forEach(item => {
      item.addEventListener('click', async () => {
        const aid = item.dataset.aid;
        try { await api('/wishlist/' + aid, { method: 'POST' }); } catch {}
        state.wishlistAlerts = state.wishlistAlerts.filter(a => a.id != aid);
        updateAlertBadge(); hideSheet();
        navigate('#/wishlist');
      });
    });
  });
}

function showSheet(title, html, afterRender) {
  const sheet = $('#sheet'), bd = $('#sheetBackdrop');
  sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title">${title}</div>${html}`;
  sheet.classList.add('show'); bd.classList.add('show');
  if (afterRender) afterRender();
}
function hideSheet() {
  $('#sheet').classList.remove('show');
  $('#sheetBackdrop').classList.remove('show');
}

function wireCardLongPress() {
  $$('.set-list-card').forEach(card => {
    let timer;
    card.addEventListener('touchstart', () => {
      timer = setTimeout(() => {
        haptic('heavy');
        const setNum = card.dataset.set, id = card.dataset.id;
        showSheet('Quick Actions', `
          <div class="sheet-item" id="qa-view">${I.eye} <span>View details</span></div>
          <div class="sheet-item" id="qa-wishlist">${I.heart} <span>Add to wishlist</span></div>
          <div class="sheet-item danger" id="qa-remove">${I.trash} <span>Remove from collection</span></div>`,
        () => {
          $('#qa-view')?.addEventListener('click', () => { hideSheet(); navigate('#/set/' + encodeURIComponent(setNum)); });
          $('#qa-wishlist')?.addEventListener('click', () => { hideSheet(); quickAddWishlist(setNum); });
          $('#qa-remove')?.addEventListener('click', async () => {
            hideSheet(); haptic('heavy');
            if (!confirm('Remove from collection?')) return;
            try { await api('/collection/' + id, { method: 'DELETE' }); state.portfolio = null; renderPortfolio(); toast('Removed', 'success'); }
            catch (e) { toast(e.message, 'error'); }
          });
        });
      }, 500);
    }, { passive: true });
    card.addEventListener('touchend', () => clearTimeout(timer));
    card.addEventListener('touchmove', () => clearTimeout(timer));
  });
}

async function quickAddWishlist(setNum) {
  try { await api('/wishlist', { method: 'POST', body: { set_num: setNum } }); haptic('medium'); toast('Added to wishlist', 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

// ===== Catalog ==============================================
async function renderCatalog() {
  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Catalog</div></div>
    <div class="page" style="padding-top:8px">
      <button class="scan-cta" id="scanCtaBtn">
        <div class="scan-cta-icon">${I.camera}</div>
        <div class="scan-cta-text">
          <span class="t1">Scan a Set</span>
          <span class="t2">Barcode or photo identification</span>
        </div>
        ${I.arrowR}
      </button>
      <div style="position:relative;margin-bottom:12px">
        <span class="s-icon">${I.search}</span>
        <input class="search-input" id="catalogSearch" type="search" placeholder="Search ~20,000 sets…" autocomplete="off" style="display:block;max-height:none">
      </div>
      <div class="filter-row" id="themeChips">
        <button class="chip${!state.filter.catalogTheme?' active':''}" data-theme="">All</button>
        ${state.themes.slice(0,8).map(t => `<button class="chip${state.filter.catalogTheme===t?' active':''}" data-theme="${t}">${t}</button>`).join('')}
      </div>
      <div class="filter-row" style="margin-bottom:14px">
        <button class="chip${!state.filter.catalogRetired?' active':''}" id="activeToggle">Active</button>
        <button class="chip${state.filter.catalogRetired?' active':''}" id="retiredToggle">Retired</button>
        <select class="chip" id="yearFilter" style="padding:7px 10px">
          <option value="all">All years</option>
          ${Array.from({length:26},(_,i)=>2024-i).map(y=>`<option value="${y}"${state.filter.catalogYear==y?' selected':''}>${y}</option>`).join('')}
        </select>
      </div>
      <div id="catalogGrid" class="grid">
        ${Array(4).fill('<div class="skel card" style="height:200px"></div>').join('')}
      </div>
    </div>`;

  $('#scanCtaBtn').addEventListener('click', openScan);
  $('#activeToggle').addEventListener('click', () => { state.filter.catalogRetired = false; renderCatalog(); });
  $('#retiredToggle').addEventListener('click', () => { state.filter.catalogRetired = true; renderCatalog(); });
  $('#yearFilter').addEventListener('change', e => { state.filter.catalogYear = e.target.value; loadCatalog(); });
  $('#catalogSearch').addEventListener('input', debounce(() => loadCatalog(), 300));

  const wireThemes = () => {
    $$('[data-theme]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.filter.catalogTheme = btn.dataset.theme;
        $$('[data-theme]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        haptic('light'); loadCatalog();
      });
    });
  };
  wireThemes();

  if (!state.themes.length || Date.now() - state.themesLoadedAt > 60_000) {
    try {
      const th = await api('/themes');
      state.themes = th.themes || [];
      state.themesLoadedAt = Date.now();
      const tc = $('#themeChips');
      if (tc) {
        tc.innerHTML = `
          <button class="chip${!state.filter.catalogTheme?' active':''}" data-theme="">All</button>
          ${state.themes.slice(0,8).map(t=>`<button class="chip${state.filter.catalogTheme===t?' active':''}" data-theme="${t}">${t}</button>`).join('')}`;
        wireThemes();
      }
    } catch {}
  }
  loadCatalog();
}

async function loadCatalog() {
  const q = $('#catalogSearch')?.value?.trim() || '';
  const params = new URLSearchParams({ limit: '30' });
  if (q) params.set('q', q);
  if (state.filter.catalogTheme) params.set('theme', state.filter.catalogTheme);
  const grid = $('#catalogGrid');
  if (!grid) return;
  try {
    const data = await api('/sets/search?' + params);
    let sets = data.sets || [];
    if (state.filter.catalogYear !== 'all') sets = sets.filter(s => s.year == state.filter.catalogYear);
    if (state.filter.catalogRetired) sets = sets.filter(s => s.retired);
    const owned = new Set((state.portfolio?.items||[]).map(i => i.set_num));
    grid.innerHTML = sets.length
      ? sets.map(set => `
          <div class="set-card" data-set="${set.set_num}">
            <div class="set-card-img">
              ${set.image_url ? `<img src="${set.image_url}" alt="${set.name}" loading="lazy">` : '<span style="font-size:40px">&#x1F9E9;</span>'}
              ${owned.has(set.set_num) ? '<span class="owned-tag">Owned</span>' : ''}
              ${set.retired ? '<span class="retired-tag">Retired</span>' : ''}
            </div>
            <div class="set-card-body">
              <div class="set-card-name">${set.name}</div>
              <div class="set-card-meta"><span>${set.theme||''}</span><span>${set.year||''}</span><span>${set.pieces||'?'} pcs</span></div>
              <div class="set-card-value">${fmtMoney(set.current_value)}</div>
            </div>
          </div>`).join('')
      : '<p style="color:var(--ink-mute);grid-column:1/-1;text-align:center;padding:32px 0">No sets found</p>';
    $$('.set-card').forEach(c => c.addEventListener('click', () => navigate('#/set/' + encodeURIComponent(c.dataset.set))));
  } catch (e) { toast(e.message, 'error'); }
}

// ===== Set Detail ===========================================
async function renderSetDetail(setNum) {
  $('#root').innerHTML = `<div class="page"><div class="skel card" style="height:280px;margin-bottom:16px"></div><div class="skel line" style="width:200px;margin-bottom:8px"></div></div>`;
  try {
    const [setData, collData] = await Promise.all([
      api('/sets/' + encodeURIComponent(setNum)),
      api('/collection').catch(() => null),
    ]);
    const set = setData.set;
    if (!set) { toast('Set not found', 'error'); history.back(); return; }
    const entry = collData?.items?.find(i => i.set_num === set.set_num) || null;
    paintSetDetail(set, entry);
  } catch (e) { toast(e.message, 'error'); history.back(); }
}

function paintSetDetail(set, entry) {
  const inWishlist = state.wishlist.some(w => w.set_num === set.set_num);
  const tabs = ['info', 'forecast', 'manage'];

  $('#root').innerHTML = `
    <div class="page no-pad">
      <div class="detail-hero">
        ${set.image_url ? `<div class="detail-hero-bg" style="background-image:url('${set.image_url}')"></div>` : ''}
        <div class="detail-img">
          ${set.image_url ? `<img src="${set.image_url}" alt="${set.name}">` : '<span style="font-size:64px">&#x1F9E9;</span>'}
        </div>
        <button class="icon-btn detail-back" id="detailBack" aria-label="Back">${I.arrowL}</button>
        <div class="detail-hero-actions">
          <button class="icon-btn" id="detailShare" aria-label="Share">${I.share}</button>
          <button class="icon-btn" id="wishlistToggle" aria-label="Wishlist" style="color:${inWishlist?'var(--bv-red)':''}">
            ${inWishlist ? I.heartFill : I.heart}
          </button>
        </div>
      </div>

      <div class="detail-title-row">
        <div class="detail-title-inner">
          <div class="detail-eyebrow">${set.theme||'—'} &middot; ${set.set_num} &middot; ${set.year||'—'}</div>
          <div class="detail-title">${set.name}</div>
        </div>
      </div>

      <div class="detail-tabs" style="margin:0 22px">
        ${tabs.map(t => `<button class="detail-tab${state.detail.tab===t?' active':''}" data-tab="${t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('')}
      </div>

      <div id="tabPanels">${renderTabContent(set, entry, state.detail.tab)}</div>
    </div>`;

  $('#detailBack').addEventListener('click', () => history.back());
  $('#detailShare').addEventListener('click', () => {
    const text = `${set.name} (${set.set_num}) — Value: ${fmtMoney(set.current_value)}`;
    if (navigator.share) navigator.share({ title: set.name, text, url: location.href }).catch(()=>{});
    else navigator.clipboard?.writeText(text).then(() => toast('Copied to clipboard'));
  });
  $('#wishlistToggle').addEventListener('click', async () => {
    haptic('medium');
    const inWl = state.wishlist.some(w => w.set_num === set.set_num);
    if (inWl) {
      const wlItem = state.wishlist.find(w => w.set_num === set.set_num);
      try { await api('/wishlist/' + wlItem.id, { method: 'DELETE' }); state.wishlist = state.wishlist.filter(w => w.set_num !== set.set_num); toast('Removed from wishlist'); paintSetDetail(set, entry); }
      catch (e) { toast(e.message, 'error'); }
    } else {
      try { const r = await api('/wishlist', { method: 'POST', body: { set_num: set.set_num } }); state.wishlist.push(r.item); toast('Added to wishlist', 'success'); paintSetDetail(set, entry); }
      catch (e) { toast(e.message, 'error'); }
    }
  });
  $$('.detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.detail.tab = tab.dataset.tab; haptic('light');
      $$('.detail-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $('#tabPanels').innerHTML = renderTabContent(set, entry, state.detail.tab);
      wireTabActions(set, entry);
    });
  });
  wireTabActions(set, entry);

  let sx;
  const panels = $('#tabPanels');
  if (panels) {
    panels.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    panels.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) < 60) return;
      const idx = tabs.indexOf(state.detail.tab);
      const next = dx < 0 ? Math.min(idx+1,tabs.length-1) : Math.max(idx-1,0);
      if (next !== idx) {
        state.detail.tab = tabs[next]; haptic('light');
        $$('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.detail.tab));
        $('#tabPanels').innerHTML = renderTabContent(set, entry, state.detail.tab);
        wireTabActions(set, entry);
      }
    }, { passive: true });
  }
}

function renderTabContent(set, entry, tab) {
  if (tab === 'info') return renderInfoTab(set, entry);
  if (tab === 'forecast') return renderForecastTab(set);
  return renderManageTab(set, entry);
}

function renderInfoTab(set, entry) {
  const qty = entry?.quantity || 0;
  const g = entry?.purchase_price ? pct(set.current_value, entry.purchase_price) : null;
  return `
    <div class="tab-panel">
      <div class="stat-grid mb-12">
        <div class="stat-cell"><div class="lbl">Retail</div><div class="val s">${fmtMoney(set.retail_price)}</div></div>
        <div class="stat-cell high"><div class="lbl">Market Value</div><div class="val s">${fmtMoney(set.current_value)}</div></div>
        <div class="stat-cell"><div class="lbl">Pieces</div><div class="val mono">${(set.pieces||0).toLocaleString()}</div></div>
        <div class="stat-cell"><div class="lbl">Minifigs</div><div class="val mono">${set.minifigs||0}</div></div>
        <div class="stat-cell"><div class="lbl">Year</div><div class="val mono">${set.year||'—'}</div></div>
        <div class="stat-cell"><div class="lbl">Status</div><div class="val" style="font-size:13px">${set.retired?'🛑 Retired':'✅ Active'}</div></div>
      </div>
      ${entry ? `
        <div class="qty-row mb-12">
          <div>
            <div class="qty-row-lbl">In Collection</div>
            ${g !== null ? `<span class="delta ${g>=0?'up':'down'}" style="margin-top:4px;display:inline-flex">${g>=0?'+':''}${g.toFixed(1)}% ROI</span>` : ''}
          </div>
          <div class="qty-stepper">
            <button class="qty-btn" id="qtyMinus">−</button>
            <span class="qty-num" id="qtyDisplay">${qty}</span>
            <button class="qty-btn" id="qtyPlus">+</button>
          </div>
        </div>` : `
        <button class="btn-primary mb-12" id="addToCollBtn">${I.plus} Add to Collection</button>`}
      <canvas id="detailSparkline" style="width:100%;height:48px;display:block;margin-top:4px"></canvas>
    </div>`;
}

function renderForecastTab(set) {
  const val = parseFloat(set.current_value) || 0;
  const f2 = parseFloat(set.forecast_2y) || val * 1.18;
  const f5 = parseFloat(set.forecast_5y) || val * 1.45;
  const p2 = val ? Math.round((f2/val-1)*100) : 0;
  const p5 = val ? Math.round((f5/val-1)*100) : 0;
  return `
    <div class="tab-panel">
      <div class="forecast-card mb-12">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">${I.sparkles}<strong>AI Price Forecast</strong></div>
        <p style="font-size:13px;color:var(--ink-mute);margin-bottom:14px">Based on theme, age, piece count, and market trends.</p>
        <div class="forecast-label"><span>2-Year</span><span>${fmtMoney(f2)} <span style="color:var(--up)">+${p2}%</span></span></div>
        <div class="forecast-track mb-12"><div class="forecast-fill" id="bar2" style="width:0"></div></div>
        <div class="forecast-label"><span>5-Year</span><span>${fmtMoney(f5)} <span style="color:var(--up)">+${p5}%</span></span></div>
        <div class="forecast-track"><div class="forecast-fill" id="bar5" style="width:0"></div></div>
      </div>
      <div class="card">
        <div style="font-size:12px;color:var(--ink-mute);display:flex;align-items:center;gap:6px">${I.sparkles} AI estimates only. Not financial advice.</div>
      </div>
    </div>`;
}

function renderManageTab(set, entry) {
  if (!entry) return `
    <div class="tab-panel" style="text-align:center;padding:40px 0">
      <p style="color:var(--ink-mute);margin-bottom:16px">Not in your collection yet.</p>
      <button class="btn-primary" id="addToCollBtn2" style="width:auto;padding:13px 24px">${I.plus} Add to Collection</button>
    </div>`;
  return `
    <div class="tab-panel">
      <div class="form-group">
        <label class="form-label">Purchase Price</label>
        <input class="form-input" type="number" id="ppInput" value="${entry.purchase_price||''}" placeholder="0.00" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">Purchase Date</label>
        <input class="form-input" type="date" id="pdInput" value="${entry.purchased_at?.split('T')[0]||''}">
      </div>
      <div class="form-group">
        <label class="form-label">Condition</label>
        <select class="form-input" id="condSel">
          ${['new','sealed','used_good','used_acceptable'].map(c =>
            `<option value="${c}"${entry.condition===c?' selected':''}>${c.replace(/_/g,' ')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="notesInput" placeholder="Notes about this set…">${entry.notes||''}</textarea>
        <button class="btn-secondary" id="saveNotes" style="margin-top:6px">${I.check} Save Notes</button>
      </div>
      <div style="padding-top:16px;border-top:1px solid var(--line-soft)">
        <button class="btn-danger" id="removeFromColl">${I.trash} Remove from Collection</button>
      </div>
    </div>`;
}

function wireTabActions(set, entry) {
  const addBtn = $('#addToCollBtn') || $('#addToCollBtn2');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      haptic('heavy');
      try {
        await api('/collection', { method: 'POST', body: { set_num: set.set_num } });
        state.portfolio = null; toast('Added to collection!', 'success');
        const [d, c] = await Promise.all([api('/sets/'+encodeURIComponent(set.set_num)), api('/collection').catch(()=>null)]);
        paintSetDetail(d.set || set, c?.items?.find(i => i.set_num === set.set_num));
      } catch (e) { toast(e.message, 'error'); }
    });
  }
  if (entry) {
    let qty = entry.quantity;
    $('#qtyMinus')?.addEventListener('click', async () => {
      if (qty <= 1) return; haptic('light'); qty--;
      $('#qtyDisplay').textContent = qty;
      try { await api('/collection/'+entry.id, { method:'PATCH', body:{ quantity: qty } }); state.portfolio=null; } catch {}
    });
    $('#qtyPlus')?.addEventListener('click', async () => {
      haptic('light'); qty++;
      $('#qtyDisplay').textContent = qty;
      try { await api('/collection/'+entry.id, { method:'PATCH', body:{ quantity: qty } }); state.portfolio=null; } catch {}
    });
  }
  setTimeout(() => {
    const spark = $('#detailSparkline');
    if (spark && state.portfolioHistory?.snapshots?.length) {
      drawSparkline(spark, state.portfolioHistory.snapshots.map(s => parseFloat(s.total_value)), { up: true, dot: true });
    }
  }, 50);
  setTimeout(() => {
    const val = parseFloat(set.current_value) || 0;
    const f2 = parseFloat(set.forecast_2y) || val*1.18;
    const f5 = parseFloat(set.forecast_5y) || val*1.45;
    const b2 = $('#bar2'), b5 = $('#bar5');
    if (b2 && val) b2.style.width = Math.min((f2/val)*50, 95)+'%';
    if (b5 && val) b5.style.width = Math.min((f5/val)*50, 95)+'%';
  }, 100);
  if (entry) {
    $('#ppInput')?.addEventListener('blur', async e => {
      try { await api('/collection/'+entry.id,{method:'PATCH',body:{purchase_price:parseFloat(e.target.value)||null}}); state.portfolio=null; } catch {}
    });
    $('#pdInput')?.addEventListener('change', async e => {
      try { await api('/collection/'+entry.id,{method:'PATCH',body:{purchased_at:e.target.value||null}}); state.portfolio=null; } catch {}
    });
    $('#condSel')?.addEventListener('change', async e => {
      try { await api('/collection/'+entry.id,{method:'PATCH',body:{condition:e.target.value}}); state.portfolio=null; } catch {}
    });
    $('#saveNotes')?.addEventListener('click', async () => {
      const notes = $('#notesInput')?.value||'';
      try { await api('/collection/'+entry.id,{method:'PATCH',body:{notes}}); toast('Saved','success'); } catch(e){toast(e.message,'error');}
    });
    $('#removeFromColl')?.addEventListener('click', async () => {
      haptic('heavy');
      if (!confirm('Remove from collection?')) return;
      try { await api('/collection/'+entry.id,{method:'DELETE'}); state.portfolio=null; toast('Removed','success'); history.back(); }
      catch(e){toast(e.message,'error');}
    });
  }
}

// ===== Wishlist =============================================
async function renderWishlist() {
  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Wishlist</div></div>
    <div class="page" style="padding-top:8px">
      <div id="wlAlerts"></div>
      <div id="wlList"><div class="skel card" style="height:80px"></div></div>
    </div>`;
  try {
    const data = await api('/wishlist');
    state.wishlist = data.wishlist;
    state.wishlistAlerts = data.unread_alerts;
    updateAlertBadge();
    paintWishlist();
  } catch (e) { toast(e.message, 'error'); }
}

function paintWishlist() {
  const alertsEl = $('#wlAlerts'), listEl = $('#wlList');
  if (!alertsEl || !listEl) return;

  if (state.wishlistAlerts.length) {
    alertsEl.innerHTML = state.wishlistAlerts.map(a => `
      <div class="alert-card mb-12" data-aid="${a.id}">
        ${I.bell}
        <div class="alert-card-text">
          <strong>${a.set_name||a.set_num}</strong>
          Now ${fmtMoney(a.current_value)} &middot; target ${fmtMoney(a.target_price)}
        </div>
      </div>`).join('');
    $$('.alert-card[data-aid]').forEach(card => {
      card.addEventListener('click', async () => {
        const aid = card.dataset.aid;
        try { await api('/wishlist/'+aid,{method:'POST'}); } catch {}
        state.wishlistAlerts = state.wishlistAlerts.filter(a => a.id != aid);
        updateAlertBadge(); card.remove();
      });
    });
  }

  if (!state.wishlist.length) {
    listEl.innerHTML = `
      <div class="card" style="text-align:center;padding:40px 20px">
        <div style="font-size:48px;margin-bottom:12px">&#x2764;&#xFE0F;</div>
        <h3 style="font-family:var(--serif);font-size:22px;font-weight:500;margin-bottom:8px">Wishlist is empty</h3>
        <p style="color:var(--ink-mute);margin-bottom:20px;font-size:14px">Tap the heart on any set page to save it here.</p>
        <button class="btn-secondary" id="wlGoCatalog" style="width:auto;padding:12px 20px">${I.search} Browse Catalog</button>
      </div>`;
    $('#wlGoCatalog')?.addEventListener('click', () => navigate('#/add'));
    return;
  }

  listEl.innerHTML = state.wishlist.map(item => {
    const gap = item.target_price ? item.current_value - item.target_price : null;
    const below = gap !== null && gap <= 0;
    return `
      <div class="wl-card" data-set="${item.set_num}" data-wid="${item.id}">
        <div class="wl-img">${item.image_url ? `<img src="${item.image_url}" alt="${item.name}" loading="lazy">` : '<span style="font-size:28px">&#x1F9E9;</span>'}</div>
        <div class="wl-body">
          <div class="wl-name">${item.name}</div>
          <div class="wl-sub">${item.target_price ? `Target: ${fmtMoney(item.target_price)}` : 'No target set'}</div>
          ${below ? '<span class="wl-badge">&#x2193; Below target!</span>' : ''}
          ${item.forecast_2y ? `<span class="wl-badge" style="margin-left:4px;background:var(--surface-2);color:var(--ink-mute)">&#x2197; 2y: ${fmtMoney(item.forecast_2y)}</span>` : ''}
        </div>
        <div class="wl-right">
          <div class="wl-value">${fmtMoney(item.current_value)}</div>
          <div class="wl-target">${fmtMoney(item.retail_price)} retail</div>
          <button class="btn-danger" style="width:auto;padding:4px 10px;font-size:11px;margin-top:6px" data-wid="${item.id}">${I.trash}</button>
        </div>
      </div>`;
  }).join('');

  $$('.wl-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      navigate('#/set/' + encodeURIComponent(card.dataset.set));
    });
  });
  $$('button[data-wid]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation(); haptic('medium');
      try { await api('/wishlist/'+btn.dataset.wid,{method:'DELETE'}); state.wishlist=state.wishlist.filter(w=>w.id!=btn.dataset.wid); toast('Removed from wishlist'); paintWishlist(); }
      catch(e){toast(e.message,'error');}
    });
  });
}

// ===== Me ===================================================
async function renderMe() {
  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Profile</div></div>
    <div class="page" style="padding-top:8px"><div class="skel card mb-16" style="height:180px"></div></div>`;
  try { if (!state.me) state.me = await api('/me'); paintMe(); }
  catch (e) { toast(e.message, 'error'); }
}

function paintMe() {
  const me = state.me;
  if (!me) return;
  const { set_count=0, total_value=0, total_paid=0 } = me.portfolio_stats || {};
  const gain = total_value - total_paid;
  const gainPct = pct(total_value, total_paid);
  const initials = (me.display_name||'MB').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Profile</div></div>
    <div class="page" style="padding-top:8px">
      <div class="profile-block">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-name">${me.display_name}</div>
        ${me.handle ? `<div class="profile-handle">@${me.handle}</div>` : ''}
        <button class="btn-secondary" id="editNameBtn" style="width:auto;padding:8px 16px;margin-top:10px;font-size:13px">${I.pencil} Edit name</button>
      </div>

      <div class="settings-section">
        <div class="settings-card">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px">
            <div class="stat-cell"><div class="lbl">Sets</div><div class="val mono">${set_count}</div></div>
            <div class="stat-cell"><div class="lbl">Value</div><div class="val s">${fmtMoneyShort(total_value)}</div></div>
            <div class="stat-cell"><div class="lbl">Invested</div><div class="val s">${fmtMoneyShort(total_paid)}</div></div>
            <div class="stat-cell ${gain>=0?'high':''}"><div class="lbl">Gain</div><div class="val s ${gain<0?'down':''}">${gainPct>=0?'+':''}${gainPct.toFixed(1)}%</div></div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-card">
          <div class="settings-row">
            <div><div class="settings-lbl">Currency</div><div class="settings-sub">Display currency</div></div>
            <select class="form-input" id="currencySel" style="width:auto;padding:6px 10px">
              ${['USD','EUR','GBP','CAD','AUD'].map(c=>`<option${me.currency===c?' selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="settings-row">
            <div><div class="settings-lbl">Price drop alerts</div><div class="settings-sub">Notify when wishlist items drop</div></div>
            <div class="toggle${me.notify_price_drops?' on':''}" id="notifyToggle"></div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-card" style="padding:16px">
          <p style="font-size:13px;color:var(--ink-mute);margin-bottom:12px">Signed in via Hatchable. Data stored securely in the cloud.</p>
          <a href="/auth/logout" class="btn-danger" style="text-align:center;display:flex;justify-content:center">Sign out</a>
        </div>
      </div>
    </div>`;

  $('#editNameBtn').addEventListener('click', () => {
    const name = prompt('Display name (max 40 chars):', me.display_name);
    if (!name?.trim()) return;
    api('/me',{method:'PATCH',body:{display_name:name.trim().slice(0,40)}})
      .then(()=>{ state.me.display_name=name.trim().slice(0,40); paintMe(); toast('Saved','success'); })
      .catch(e=>toast(e.message,'error'));
  });
  $('#currencySel').addEventListener('change', e => {
    api('/me',{method:'PATCH',body:{currency:e.target.value}})
      .then(()=>{ state.me.currency=e.target.value; toast('Saved'); })
      .catch(e=>toast(e.message,'error'));
  });
  const toggle = $('#notifyToggle');
  toggle?.addEventListener('click', () => {
    const newVal = !me.notify_price_drops;
    api('/me',{method:'PATCH',body:{notify_price_drops:newVal}})
      .then(()=>{ state.me.notify_price_drops=newVal; toggle.classList.toggle('on',newVal); })
      .catch(e=>toast(e.message,'error'));
  });
}

// ===== Pile =================================================
function renderPile() {
  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Pile Scanner</div></div>
    <div class="page" style="padding-top:8px">
      <div class="pile-intro">
        <h2>Identify a Set</h2>
        <p>Scan a barcode or photograph a built set for instant AI identification.</p>
        <button class="btn-primary" id="openScanBtn" style="width:auto;padding:14px 28px;font-size:16px">${I.camera} Open Camera</button>
      </div>
      <div id="pileResult"></div>
    </div>`;
  $('#openScanBtn').addEventListener('click', openScan);
}

// ===== Blind Bag ============================================
async function renderBlind() {
  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Blind Bag</div></div>
    <div class="page" style="padding-top:8px">
      <div class="skel card mb-12" style="height:80px"></div>
      <div class="blind-grid">${Array(4).fill('<div class="skel card" style="height:160px"></div>').join('')}</div>
    </div>`;
  try { const data = await api('/minifigs'); paintBlind(data.minifigs||[]); }
  catch(e){toast(e.message,'error');}
}

function paintBlind(figs) {
  const order = { legendary:0,rare:1,uncommon:2,common:3 };
  const sorted = [...figs].sort((a,b)=>(order[a.rarity]||3)-(order[b.rarity]||3));
  const ownedCount = figs.filter(f=>f.owned_qty>0).length;
  $('#root').innerHTML = `
    <div class="topbar"><div class="topbar-title">Blind Bag</div></div>
    <div class="page" style="padding-top:8px">
      <div class="card mb-16" style="background:var(--bv-yellow)">
        <div style="font-weight:700;font-size:17px;margin-bottom:4px">&#x1F4E6; Minifig Tracker</div>
        <div style="font-size:13px">${figs.length} in catalog &middot; ${ownedCount} owned</div>
      </div>
      <div class="blind-grid">
        ${sorted.map(fig=>`
          <div class="fig-card ${fig.rarity}" data-fig="${fig.fig_num}">
            <div class="fig-card-img">${fig.image_url?`<img src="${fig.image_url}" alt="${fig.name}" loading="lazy">`:'<span style="font-size:32px">&#x1F9F1;</span>'}</div>
            <div class="fig-card-body">
              <div class="fig-name">${fig.name}</div>
              <div class="fig-series">${fig.series||'Unknown'}</div>
              <div class="fig-value">${fmtMoney(fig.current_value)}</div>
              <span class="fig-rarity">${fig.rarity}</span>
              ${fig.owned_qty>0?`<div style="font-size:10px;color:var(--up);margin-top:2px">&#x2713; &times;${fig.owned_qty}</div>`:''}
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ===== Camera Scanner =======================================
function openScan() {
  $('#scanOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  haptic('medium');
  startCamera();
}
function closeScan() {
  $('#scanOverlay').classList.remove('open');
  document.body.style.overflow = '';
  stopCamera();
}
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    state.camera.stream = stream;
    const video = $('#scanVideo');
    video.srcObject = stream;
    await video.play();
    state.camera.scanning = true;
    setScanMode(state.camera.mode);
    if (state.camera.mode === 'barcode' && typeof BarcodeDetector !== 'undefined') {
      state.camera.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'] });
      state.camera.timer = setInterval(scanBarcode, 400);
    }
  } catch(e) { closeScan(); toast('Camera unavailable: ' + e.message, 'error'); }
}
async function scanBarcode() {
  if (!state.camera.scanning || !state.camera.detector) return;
  const video = $('#scanVideo');
  if (!video?.videoWidth) return;
  try {
    const barcodes = await state.camera.detector.detect(video);
    if (barcodes.length) {
      clearInterval(state.camera.timer); state.camera.scanning = false;
      haptic('heavy'); flashScan();
      await sendScanToAPI({ mode: 'barcode', barcode: barcodes[0].rawValue });
    }
  } catch {}
}
function flashScan() {
  const f = $('#scanFlash'); f.classList.add('flash');
  setTimeout(() => f.classList.remove('flash'), 200);
}
async function capturePhoto() {
  const video = $('#scanVideo');
  if (!video) return;
  const canvas = document.createElement('canvas');
  const MAX = 1024;
  let w = video.videoWidth, h = video.videoHeight;
  if (w > MAX) { h = Math.round(h*MAX/w); w = MAX; }
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  haptic('medium'); flashScan();
  const hint = $('#scanHint'); if (hint) hint.textContent = 'Identifying with AI…';
  await sendScanToAPI({ mode: 'image', image: canvas.toDataURL('image/jpeg', 0.85) });
}
async function sendScanToAPI(body) {
  try { const data = await api('/scan/identify',{method:'POST',body}); closeScan(); showScanResult(data); }
  catch(e) { closeScan(); toast('Scan failed: '+e.message,'error'); }
}
function showScanResult(data) {
  let el = $('#pileResult');
  if (!el) { el = document.createElement('div'); el.id='pileResult'; $('.page')?.appendChild(el); }

  if (!data.identified || !data.set) {
    el.innerHTML = `
      <div class="card">
        <div style="font-weight:700;margin-bottom:6px">&#x2753; Not identified</div>
        <p style="font-size:13px;color:var(--ink-mute);margin-bottom:12px">${data.reasoning||'Could not identify the set.'}</p>
        <button class="btn-secondary" id="tryScanAgain">${I.camera} Try Again</button>
      </div>`;
    $('#tryScanAgain')?.addEventListener('click', () => { el.innerHTML=''; openScan(); });
    return;
  }

  const set = data.set;
  const cc = { high:'var(--up)',medium:'var(--bv-yellow)',low:'var(--down)',none:'var(--ink-mute)' }[data.confidence]||'var(--ink-mute)';
  el.innerHTML = `
    <div class="scan-result-card">
      <div class="scan-result-hdr">
        ${I.sparkles}
        <span>AI matched: <strong style="color:${cc}">${data.confidence} confidence</strong></span>
      </div>
      <div class="scan-result-body">
        <div class="scan-result-img">${set.image_url?`<img src="${set.image_url}" alt="${set.name}">`:'&#x1F9E9;'}</div>
        <div class="scan-result-info">
          <div class="scan-result-name">${set.name}</div>
          <div class="scan-result-meta">${set.set_num} &middot; ${set.theme||''} &middot; ${set.year||''}</div>
          <div style="font-family:var(--serif);font-size:20px;font-weight:500">${fmtMoney(set.current_value)}</div>
        </div>
      </div>
      <div class="scan-result-btns">
        <button class="btn-primary" id="addScanned">${I.plus} Add</button>
        <button class="btn-secondary" id="viewScanned">${I.eye} View</button>
      </div>
    </div>`;
  $('#addScanned').addEventListener('click', async () => {
    haptic('heavy');
    try { await api('/collection',{method:'POST',body:{set_num:set.set_num}}); state.portfolio=null; toast('Added!','success'); el.innerHTML=''; }
    catch(e){toast(e.message,'error');}
  });
  $('#viewScanned').addEventListener('click', () => navigate('#/set/'+encodeURIComponent(set.set_num)));
}
function stopCamera() {
  clearInterval(state.camera.timer);
  state.camera.scanning = false; state.camera.detector = null;
  state.camera.stream?.getTracks().forEach(t=>t.stop());
  state.camera.stream = null;
  const v = $('#scanVideo'); if (v) v.srcObject = null;
}
function setScanMode(mode) {
  state.camera.mode = mode;
  const cap = $('#scanCapture'), hint = $('#scanHint'), sub = $('#scanSub'), title = $('#scanTitle');
  $$('#scanModeToggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'photo') {
    if (cap) cap.style.display = 'block';
    if (hint) hint.textContent = 'Frame the set in view';
    if (sub) sub.textContent = 'Tap capture to identify';
    if (title) title.textContent = 'Photo ID';
    clearInterval(state.camera.timer);
  } else {
    if (cap) cap.style.display = 'none';
    if (hint) hint.textContent = 'Point at a barcode';
    if (sub) sub.textContent = 'Or switch to Photo for AI identification';
    if (title) title.textContent = 'Find a LEGO set';
    clearInterval(state.camera.timer);
    if (state.camera.stream && typeof BarcodeDetector !== 'undefined') {
      state.camera.detector = new BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code'] });
      state.camera.timer = setInterval(scanBarcode, 400);
    }
  }
}

// ===== Pull-to-refresh =====================================
let ptrY = 0, ptrTriggered = false;
document.addEventListener('touchstart', e => { if (window.scrollY <= 0) ptrY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchmove', e => {
  if (!ptrY) return;
  if (e.touches[0].clientY - ptrY > 80 && !ptrTriggered) { ptrTriggered = true; haptic('medium'); $('#ptrIndicator').classList.add('show'); }
}, { passive: true });
document.addEventListener('touchend', async () => {
  if (!ptrTriggered) { ptrY = 0; return; }
  ptrTriggered = false; ptrY = 0;
  state.portfolio = null; state.me = null;
  await router();
  setTimeout(() => $('#ptrIndicator').classList.remove('show'), 600);
}, { passive: true });

// ===== Swipe back ==========================================
let swipeStartX = 0;
document.addEventListener('touchstart', e => { swipeStartX = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  if (swipeStartX < 44 && e.changedTouches[0].clientX - swipeStartX > 60) history.back();
}, { passive: true });

window.addEventListener('offline', () => $('#offlineBanner').classList.add('show'));
window.addEventListener('online', () => $('#offlineBanner').classList.remove('show'));
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ===== Init ================================================
document.addEventListener('DOMContentLoaded', () => {
  $('#scanCloseBtn').addEventListener('click', closeScan);
  $('#scanCapture').addEventListener('click', capturePhoto);
  $('#scanModeToggle').addEventListener('click', e => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    haptic('light'); clearInterval(state.camera.timer); setScanMode(btn.dataset.mode);
  });
  $('#sheetBackdrop').addEventListener('click', hideSheet);
  window.addEventListener('hashchange', router);
  router();
});