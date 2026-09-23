// Insights (#/insights) — the Vault hero's detail screen: value history with
// ranges, what was paid, paper and realized gains, allocation by theme,
// retirement radar, gainers and losers and pricing confidence. The investor
// toolkit (market signals, S&P comparison, 90-day movers, part-out and the
// retirement-risk list) stays a Pro perk, exactly as it was on the old Vault
// "Insights" tab.
import { $, $$, escapeHtml, fmtMoney, fmtShortDate, haptic, snackbar } from '../utils.js';
import { state } from '../state.js';
import { getSessionUserId } from '../api.js';
import { t, tPlural } from '../lib/i18n.js';
import { computeSpreadSignals } from '../lib/pure.js';
import { vaultTotals, themeAllocation, retirementRadar, gainersAndLosers, clipHistory } from '../lib/vault-insights.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { openLegalSheet } from '../components/legal-sheet.js';
import { isNativeBilling } from '../lib/revenuecat-native.js';
import { topbar, iconBtn, icon, seg, card, sectionTitle, emptyState, btn, bar, delta as deltaChip, skeletonRows, sheetBody } from '../ui/kit.js';
import { setThumb, setColor } from '../ui/set-ui.js';
import { moneyWhole, moneyWholeSigned } from '../ui/vault-ui.js';

const RANGES = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '1Y', days: 365, pro: true },
  { key: 'ALL', days: 100000, pro: true },
];
let range = '3M';

const esc = (v) => escapeHtml(v == null ? '' : String(v));

export async function renderInsights() {
  const root = $('#root');
  if (!root) return;
  if (!state.portfolio) root.innerHTML = `<main class="bv-page no-nav vault-insights" aria-busy="true">${topbar({ title: t('bvVault.insights'), back: 'history' })}${skeletonRows(4)}</main>`;
  const { loadPortfolioData, fetchVaultChanges, pval } = await import('./portfolio.js');
  await loadPortfolioData();
  if (location.hash.split('?')[0] !== '#/insights') return;
  paint(pval);
  // Realized gains and sale markers come from the What changed digest.
  fetchVaultChanges().then((data) => {
    if (!data || location.hash.split('?')[0] !== '#/insights') return;
    paint(pval);
  }).catch(() => {});
}

function realized() {
  const r = state.vaultChanges?.owner === getSessionUserId() ? state.vaultChanges.data?.realized : null;
  if (r) return r;
  const p = state.portfolio || {};
  return p.realized_gain != null ? { gain: p.realized_gain, sales: p.realized_sales ?? 1, items: [] } : null;
}

function paint(pval) {
  const p = state.portfolio || { items: [] };
  const items = p.items || [];
  const totals = vaultTotals(items, pval);
  const sub = t('bvVault.insightsSubtitle', { sets: tPlural('bvVault.footSets', totals.sets) });
  const canShare = !!(state.me?.handle && state.me?.is_public);
  const share = canShare ? iconBtn({ icon: 'share', label: t('bvVault.sharePublicProfile'), id: 'insightsShare' }) : '';
  const scroll = window.scrollY;
  if (!items.length) {
    $('#root').innerHTML = `<main class="bv-page no-nav vault-insights" id="insightsPage">${topbar({ title: t('bvVault.insights'), back: 'history', actionsHtml: share })}
      ${emptyState({ icon: 'pie', title: t('bvVault.insightsEmptyTitle'), body: t('bvVault.insightsEmptyBody'), actionsHtml: btn(t('bvVault.emptyBrowse'), { href: '#/add', kind: 'primary', icon: 'search' }) })}</main>`;
    wire(pval);
    return;
  }
  $('#root').innerHTML = `<main class="bv-page no-nav vault-insights" id="insightsPage">
    ${topbar({ title: t('bvVault.insights'), sub, back: 'history', actionsHtml: share })}
    <div class="insights-range">${rangeSeg()}</div>
    ${chartCard()}
    ${statsGrid(totals)}
    ${themeCard(items, pval)}
    ${radarCard(items)}
    ${gainersCard(items, pval)}
    ${confidenceCard(p)}
    <section class="insights-toolkit" aria-labelledby="insightsToolkitTitle">
      ${sectionTitle(t('bvVault.toolkitTitle'), { id: 'insightsToolkitTitle' })}
      <div id="insightsPanelContent">${renderInsightsTab(items, state.historyPro)}</div>
    </section>
  </main>`;
  wire(pval);
  if (scroll > 0) requestAnimationFrame(() => window.scrollTo(0, scroll));
}

/* ---------------------------------------------------------------- range + chart */
function rangeSeg() {
  return seg(RANGES.map(r => {
    const locked = r.pro && !state.historyPro;
    const label = r.key === 'ALL' ? t('bvVault.rangeAll') : r.key;
    return {
      value: r.key, label, icon: locked ? 'lock' : undefined, current: range === r.key,
      ariaLabel: locked ? t('bvVault.rangeLocked', { range: label }) : label,
      attrs: { 'data-r': r.key, 'data-locked': locked ? 'true' : 'false' },
    };
  }), { label: t('bvVault.rangeLabel'), id: 'rangePills' });
}

function rangeDays() { return (RANGES.find(r => r.key === range) || RANGES[1]).days; }

function chartCard() {
  const days = rangeDays();
  const series = clipHistory(state.portfolioHistory || [], days)
    .map(s => ({ date: String(s.snapshot_date), value: Number(s.total_value), paid: Number(s.total_paid) }))
    .filter(s => Number.isFinite(s.value));
  if (series.length < 2) {
    return card(`<p class="insights-chart__empty">${esc(t('bvVault.chartEmpty'))}</p>`, { cls: 'insights-chart' });
  }
  const sales = (realized()?.items || []).filter(s => s.sold_at && s.sold_at >= series[0].date && s.sold_at <= series.at(-1).date);
  const first = series[0].value, last = series.at(-1).value;
  const change = last - first;
  const pct = first > 0 ? (change / first) * 100 : null;
  const rangeLabel = t(`bvVault.rangeSpan${range}`);
  const summary = t('bvVault.chartSummary', { change: moneyWholeSigned(change), range: rangeLabel });
  const soldLegend = sales.length === 1 ? t('bvVault.legendSold', { name: sales[0].name }) : sales.length > 1 ? tPlural('bvVault.legendSales', sales.length) : '';
  return `<section class="bv-card insights-chart" aria-labelledby="insightsChartSummary">
    <p class="insights-chart__summary" id="insightsChartSummary"><span>${esc(summary)}</span>${pct != null ? deltaChip(pct, { srUp: t('bvCommon.upPct', { pct: Math.abs(pct).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(pct).toFixed(1) }) }) : ''}</p>
    <div class="insights-chart__plot" id="insightsChart">${chartSvg(series, sales)}</div>
    <p class="insights-legend"><span class="insights-legend__value">${esc(t('bvVault.legendValue'))}</span><span class="insights-legend__paid">${esc(t('bvVault.legendPaid'))}</span>${soldLegend ? `<span class="insights-legend__sold">${esc(soldLegend)}</span>` : ''}</p>
  </section>`;
}

const W = 340, H = 130, PAD_Y = 12;
function chartSvg(series, sales) {
  const values = series.map(s => s.value);
  const paids = series.map(s => s.paid).filter(v => Number.isFinite(v) && v > 0);
  const lo = Math.min(...values, ...paids), hi = Math.max(...values, ...paids);
  const span = hi - lo || Math.max(1, hi * 0.05);
  const x = (i) => (series.length === 1 ? W / 2 : (i / (series.length - 1)) * W);
  const y = (v) => H - PAD_Y - ((v - lo) / span) * (H - PAD_Y * 2);
  const valuePts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ');
  const paidPts = series.map((s, i) => (Number.isFinite(s.paid) && s.paid > 0 ? `${x(i).toFixed(1)},${y(s.paid).toFixed(1)}` : null)).filter(Boolean).join(' ');
  const grid = [0.2, 0.5, 0.8].map(f => `<line class="insights-grid" x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join('');
  const markers = sales.map((sale) => {
    let idx = series.findIndex(s => s.date >= sale.sold_at);
    if (idx < 0) idx = series.length - 1;
    return `<circle class="insights-sale" cx="${x(idx).toFixed(1)}" cy="${(y(series[idx].value) - 12).toFixed(1)}" r="5"/>`;
  }).join('');
  return `<svg class="insights-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grid}
    ${paidPts ? `<polyline class="insights-paid" points="${paidPts}"/>` : ''}<polyline class="insights-value" points="${valuePts}"/>${markers}
    <line class="insights-guide" x1="0" x2="0" y1="0" y2="${H}" opacity="0"/><circle class="insights-cursor" r="5" opacity="0"/></svg>
    <div class="insights-scrub" role="status" aria-live="off"></div>`;
}

function wireChartScrub() {
  const wrap = $('#insightsChart');
  const days = rangeDays();
  const series = clipHistory(state.portfolioHistory || [], days).map(s => ({ date: String(s.snapshot_date), value: Number(s.total_value), paid: Number(s.total_paid) })).filter(s => Number.isFinite(s.value));
  if (!wrap || series.length < 2) return;
  const svg = wrap.querySelector('svg');
  const guide = wrap.querySelector('.insights-guide');
  const cursor = wrap.querySelector('.insights-cursor');
  const scrub = wrap.querySelector('.insights-scrub');
  const values = series.map(s => s.value);
  const paids = series.map(s => s.paid).filter(v => Number.isFinite(v) && v > 0);
  const lo = Math.min(...values, ...paids), hi = Math.max(...values, ...paids);
  const span = hi - lo || Math.max(1, hi * 0.05);
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const i = Math.round(ratio * (series.length - 1));
    const cx = (i / (series.length - 1)) * W;
    const cy = H - PAD_Y - ((series[i].value - lo) / span) * (H - PAD_Y * 2);
    guide.setAttribute('x1', cx); guide.setAttribute('x2', cx); guide.setAttribute('opacity', '1');
    cursor.setAttribute('cx', cx); cursor.setAttribute('cy', cy); cursor.setAttribute('opacity', '1');
    scrub.textContent = `${fmtShortDate(series[i].date)} · ${moneyWhole(series[i].value)}`;
    scrub.style.left = `${Math.min(rect.width - 8, Math.max(8, (cx / W) * rect.width))}px`;
    scrub.classList.add('show');
  };
  const leave = () => { guide.setAttribute('opacity', '0'); cursor.setAttribute('opacity', '0'); scrub.classList.remove('show'); };
  wrap.addEventListener('pointermove', e => move(e.clientX));
  wrap.addEventListener('pointerleave', leave);
  wrap.addEventListener('touchmove', e => move(e.touches[0].clientX), { passive: true });
  wrap.addEventListener('touchend', leave);
}

/* ---------------------------------------------------------------- stats + cards */
function statsGrid(totals) {
  const r = realized();
  const stat = (label, value, cls = '') => `<div class="insights-stat"><span class="bv-label">${esc(label)}</span><span class="bv-num insights-stat__value${cls ? ` ${cls}` : ''}">${esc(value)}</span></div>`;
  const tone = (v) => (v > 0.5 ? 'bv-up' : v < -0.5 ? 'bv-down' : '');
  return `<div class="insights-stats">
    ${stat(t('bvVault.statValue'), moneyWhole(state.portfolio?.total_value ?? totals.value))}
    ${stat(t('bvVault.statPaid'), totals.paid > 0 || totals.pricedValue > 0 ? moneyWhole(totals.paid) : '—')}
    ${stat(t('bvVault.statPaper'), totals.paid > 0 || totals.pricedValue > 0 ? moneyWholeSigned(totals.paperGain) : '—', tone(totals.paperGain))}
    ${stat(r && r.sales ? tPlural('bvVault.statRealized', Number(r.sales)) : t('bvVault.statRealizedNone'), r && r.sales ? moneyWholeSigned(Number(r.gain) || 0) : '—', r ? tone(Number(r.gain)) : '')}
  </div>`;
}

function themeCard(items, pval) {
  const alloc = themeAllocation(items, pval, { limit: 6, otherLabel: t('room.otherTheme') });
  if (!alloc.rows.length) return '';
  const rows = alloc.rows.map(r => {
    const color = setColor({ theme: r.theme });
    const pct = Math.round(r.share);
    return `<div class="insights-theme"><span class="insights-theme__dot" style="background:${esc(color)}"></span><span class="insights-theme__name">${esc(r.theme)}</span><span class="bv-num insights-theme__pct">${pct}%</span>
      <span class="bv-bar insights-theme__bar" role="img" aria-label="${esc(t('bvVault.themeShare', { theme: r.theme, pct }))}"><span style="width:${Math.max(2, r.share).toFixed(1)}%;background:${esc(color)}"></span></span></div>`;
  }).join('');
  return `${sectionTitle(t('bvVault.byTheme'))}${card(`${rows}${alloc.rest ? `<p class="insights-note">${esc(tPlural('portfolio.moreThemes', alloc.rest))}</p>` : ''}`, { cls: 'insights-themes' })}`;
}

function radarCard(items) {
  const r = retirementRadar(items);
  if (!r.total) return '';
  const retired = tPlural('bvVault.radarRetired', r.total, { retired: r.retired });
  const retiring = tPlural('bvVault.radarRetiring', r.retiring);
  return `${sectionTitle(t('bvVault.radarTitle'))}<a class="bv-card insights-radar" href="#/retiring">${icon('clock', { size: 22 })}<span class="insights-radar__text">${esc(retired)}; ${esc(retiring)}</span>${icon('chev', { size: 20 })}</a>`;
}

function gainersCard(items, pval) {
  const { gainers, losers } = gainersAndLosers(items, pval, { limit: 3 });
  if (!gainers.length && !losers.length) return '';
  const rowHtml = (g) => `<a class="insights-mover" href="#/set/${encodeURIComponent(g.row.set_num)}">${setThumb(g.row, { size: 40 })}<span class="insights-mover__name">${esc(g.row.name || g.row.set_num)}</span><span class="bv-num insights-mover__gain ${g.gain >= 0 ? 'bv-up' : 'bv-down'}">${esc(moneyWholeSigned(g.gain))}</span>${deltaChip(g.pct, { srUp: t('bvCommon.upPct', { pct: Math.abs(g.pct).toFixed(1) }), srDown: t('bvCommon.downPct', { pct: Math.abs(g.pct).toFixed(1) }) })}</a>`;
  return `${gainers.length ? `${sectionTitle(t('bvVault.topGainers'))}<div class="insights-movers">${gainers.map(rowHtml).join('')}</div>` : ''}
    ${losers.length ? `${sectionTitle(t('bvVault.topLosers'))}<div class="insights-movers">${losers.map(rowHtml).join('')}</div>` : ''}`;
}

function confidenceCard(p) {
  const conf = p.pricing_confidence;
  if (!conf?.priced) return '';
  const pct = Number(conf.pct) || 0;
  return `${sectionTitle(t('bvVault.confidenceTitle'))}${card(`<p class="insights-confidence__line">${esc(t('market.confidentlyPriced', { pct }))}</p>${bar(pct, { label: t('market.confidentlyPriced', { pct }) })}
    <p class="insights-note">${esc(t('market.estimatedNotRealized'))}</p>
    <button type="button" class="bv-btn bv-btn--text bv-btn--sm insights-confidence__link" data-legal-sheet="partners">${esc(t('bvVault.howWePrice'))}</button>`, { cls: 'insights-confidence' })}`;
}

/* ---------------------------------------------------------------- Pro toolkit */
// Free users see an honest teaser of what's inside instead of the toolkit.
// This is product framing (the server already caps history depth and export
// columns); the insights themselves are computed client-side from the user's
// own collection, so the gate is a paywall card, not DRM.
function insightsTeaserHTML() {
  return `<section class="bv-card insights-teaser" data-testid="insights-teaser">
    <span class="insights-teaser__icon">${icon('trend', { size: 24 })}</span>
    <h3 class="bv-card__title">${esc(t('bvVault.teaserTitle'))}</h3>
    <ul class="insights-teaser__perks">
      <li>${esc(t('bvVault.teaserSignals'))}</li><li>${esc(t('bvVault.teaserMovers'))}</li><li>${esc(t('bvVault.teaserRadar'))}</li>
      <li>${esc(t('bvVault.teaserSp500'))}</li><li>${esc(t('bvVault.teaserHistory'))}</li>
    </ul>
    ${btn(t('bvVault.teaserCta'), { id: 'insightsUpgradeBtn', full: true })}
    <p class="insights-note">${esc(t('bvVault.teaserFree'))}</p>
  </section>`;
}

function renderInsightsTab(items, pro) {
  if (!pro) return insightsTeaserHTML();
  const withSlope = items.filter(item => item.slope_90d != null && !Number.isNaN(Number(item.slope_90d)));
  const rising = [...withSlope].sort((a, b) => b.slope_90d - a.slope_90d).slice(0, 3).filter(x => x.slope_90d > 0.05);
  const falling = [...withSlope].sort((a, b) => a.slope_90d - b.slope_90d).slice(0, 3).filter(x => x.slope_90d < -0.05);
  const radar = items.filter(item => !item.retired && (item.retirement_risk_score || 0) >= 70)
    .sort((a, b) => b.retirement_risk_score - a.retirement_risk_score);
  const signals = computeSpreadSignals(items);
  const signalRow = (s, hot) => `<a class="insights-mover insight-set-row" href="#/set/${encodeURIComponent(s.item.set_num)}" data-set="${esc(s.item.set_num)}">${setThumb(s.item, { size: 40 })}
      <span class="insights-mover__text"><span class="insights-mover__name">${esc(s.item.name)}</span><span class="insights-mover__sub">${esc(t('portfolio.insightSignal', (() => {
        const direction = hot ? '+' : '−';
        const pct = Math.abs(s.spread * 100).toFixed(0);
        const basis = s.item.bl_new_value ? t('portfolio.insightMarket') : t('portfolio.insightValue');
        const quantity = s.item.quantity > 1 ? t('portfolio.insightQuantity', { count: s.item.quantity }) : '';
        return { direction, pct, basis, quantity };
      })()))}</span></span>
      <span class="bv-num ${hot ? 'bv-up' : 'bv-down'}">${hot ? '+' : '−'}${esc(moneyWhole(s.gap))}</span></a>`;
  const signalsCard = (signals.hot.length || signals.cold.length) ? `
    <h3 class="insights-subhead">${esc(t('bvVault.signalsTitle'))}</h3>
    ${signals.totalUpside > 0 ? `<p class="insights-note">${esc(tPlural('portfolio.insightHeadline', signals.hot.length, { value: fmtMoney(signals.totalUpside) }))}</p>` : ''}
    ${signals.hot.length ? `<p class="insights-group-label bv-up">${esc(t('bvVault.signalsHot'))}</p><div class="insights-movers">${signals.hot.slice(0, 3).map(s => signalRow(s, true)).join('')}</div>` : ''}
    ${signals.cold.length ? `<p class="insights-group-label bv-down">${esc(t('bvVault.signalsCold'))}</p><div class="insights-movers">${signals.cold.slice(0, 3).map(s => signalRow(s, false)).join('')}</div>` : ''}` : '';

  // Part-out opportunities: holdings worth materially more sold as parts than
  // sealed. part_out_value is only present when coverage is high (gated
  // server-side), so this stays empty until the part-price data fills.
  const baseVal = (it) => Number(it.market_value) || Number(it.blended_value) || Number(it.current_value) || 0;
  const partOut = items
    .map(it => ({ it, po: Number(it.part_out_value), mv: baseVal(it), cov: Number(it.part_out_coverage) }))
    .filter(x => x.po > 0 && x.mv > 0 && x.po / x.mv >= 1.15)
    .sort((a, b) => (b.po / b.mv) - (a.po / a.mv))
    .slice(0, 3);
  const partOutCard = partOut.length ? `<h3 class="insights-subhead">${esc(t('bvVault.partOutTitle'))}</h3><p class="insights-note">${esc(t('bvVault.partOutBody'))}</p>
    <div class="insights-movers">${partOut.map(({ it, po, mv, cov }) => {
      const isApprox = cov >= 0.2 && cov < 0.4;
      return `<a class="insights-mover insight-set-row" href="#/set/${encodeURIComponent(it.set_num)}" data-set="${esc(it.set_num)}">${setThumb(it, { size: 40 })}<span class="insights-mover__text"><span class="insights-mover__name">${esc(it.name)}</span><span class="insights-mover__sub">${esc(t('portfolio.sealedParts', { sealed: fmtMoney(mv), approximate: isApprox ? '~' : '', parts: fmtMoney(po) }))}</span></span><span class="bv-num bv-up">+${(((po / mv) - 1) * 100).toFixed(0)}%</span></a>`;
    }).join('')}</div>` : '';

  const moverList = (list, up) => (list.length ? list.map(item => `<a class="insights-slope insight-set-link" href="#/set/${encodeURIComponent(item.set_num)}" data-set="${esc(item.set_num)}"><span>${esc(item.name)}</span><strong class="bv-num ${up ? 'bv-up' : 'bv-down'}">${esc(t('bvVault.perWeek', { pct: `${up ? '+' : ''}${item.slope_90d.toFixed(1)}` }))}</strong></a>`).join('')
    : `<p class="insights-note">${esc(t(up ? 'bvVault.noRising' : 'bvVault.noFalling'))}</p>`);

  return `<div class="bv-card insights-pro">
    ${signalsCard}
    <h3 class="insights-subhead">${esc(t('bvVault.sp500Title'))}</h3>
    <p class="insights-note">${esc(t('bvVault.sp500Body'))}</p>
    <div class="insights-sp500" id="insightsDoubleChart"></div>
    <h3 class="insights-subhead">${esc(t('bvVault.slopeTitle'))}</h3>
    <div class="insights-slopes"><div><p class="insights-group-label bv-up">${icon('trend', { size: 16 })}${esc(t('bvVault.topRising'))}</p>${moverList(rising, true)}</div>
      <div><p class="insights-group-label bv-down">${icon('trendDown', { size: 16 })}${esc(t('bvVault.topFalling'))}</p>${moverList(falling, false)}</div></div>
    ${partOutCard}
    <h3 class="insights-subhead">${esc(t('bvVault.riskTitle'))}</h3>
    ${radar.length === 0 ? `<p class="insights-note">${esc(t('bvVault.riskNone'))}</p>` : `<div class="insights-movers">${radar.map(item => `<a class="insights-mover insight-set-row" href="#/set/${encodeURIComponent(item.set_num)}" data-set="${esc(item.set_num)}">${setThumb(item, { size: 40 })}<span class="insights-mover__text"><span class="insights-mover__name">${esc(item.name)}</span><span class="insights-mover__sub">${esc([item.set_num, item.theme, item.year].filter(Boolean).join(' · '))}</span></span><span class="bv-pill bv-pill--loss">${esc(t('bvVault.riskScore', { score: item.retirement_risk_score }))}</span></a>`).join('')}</div>`}
  </div>`;
}

function drawDoubleSparkline(container, data) {
  if (!container || !data || data.length < 2) return;
  const Wd = container.clientWidth || 300;
  const Hd = container.clientHeight || 120;
  const vals = data.map(d => d.total_value ?? d.current_value ?? d);
  const dates = data.map(d => (d && d.snapshot_date) || null);
  // S&P 500 overlay: the same money, compounding at 8%/year with each new
  // purchase added on the day it was paid (dollar-cost averaging).
  const spVals = [];
  let currentSP = data[0].total_paid ?? 0;
  spVals.push(currentSP);
  for (let i = 1; i < data.length; i++) {
    const d1 = data[i - 1].snapshot_date ? new Date(data[i - 1].snapshot_date) : null;
    const d2 = data[i].snapshot_date ? new Date(data[i].snapshot_date) : null;
    const dt = d1 && d2 ? (d2.getTime() - d1.getTime()) / (365.25 * 24 * 3600 * 1000) : 1 / 365.25;
    const paidDiff = (data[i].total_paid ?? 0) - (data[i - 1].total_paid ?? 0);
    currentSP = currentSP * Math.pow(1.08, dt) + paidDiff;
    spVals.push(currentSP);
  }
  const mn = Math.min(...vals, ...spVals), mx = Math.max(...vals, ...spVals);
  const pad = 6;
  const xs = (i) => pad + (i / (data.length - 1)) * (Wd - pad * 2);
  const ys = (v) => Hd - pad - ((v - mn) / ((mx - mn) || 1)) * (Hd - pad * 2);
  let path1 = `M${xs(0).toFixed(1)} ${ys(vals[0]).toFixed(1)}`;
  let path2 = `M${xs(0).toFixed(1)} ${ys(spVals[0]).toFixed(1)}`;
  for (let i = 1; i < data.length; i++) {
    path1 += ` L${xs(i).toFixed(1)} ${ys(vals[i]).toFixed(1)}`;
    path2 += ` L${xs(i).toFixed(1)} ${ys(spVals[i]).toFixed(1)}`;
  }
  container.innerHTML = `<svg viewBox="0 0 ${Wd} ${Hd}" preserveAspectRatio="none" aria-hidden="true" focusable="false" style="display:block;overflow:visible;width:100%;height:100%;">
    <path d="${path2}" fill="none" stroke="var(--bv-mute)" stroke-width="1.5" stroke-dasharray="3 3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${path1}" fill="none" stroke="var(--bv-gain)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <p class="insights-sp500__legend"><span class="bv-up">${esc(t('bvVault.sp500Vault', { value: fmtMoney(vals.at(-1), { cents: 0 }) }))}</span> · <span>${esc(t('bvVault.sp500Index', { value: fmtMoney(spVals.at(-1), { cents: 0 }) }))}</span>${dates.at(-1) ? ` · ${esc(fmtShortDate(dates.at(-1)))}` : ''}</p>`;
}

function openProOptions() {
  haptic('light');
  // A guest web profile intentionally has no billing card, so routing there
  // made "See Pro options" look like a no-op. Keep native/account management
  // on Profile, but give web guests an explicit, dismissible fallback.
  if (isNativeBilling()) { location.hash = '#/me'; return; }
  const signedIn = !!getSessionUserId();
  const patreonUrl = state.config?.patreon_url;
  showSheet(sheetBody({
    title: t('bvVault.proTitle'),
    sub: t('bvVault.proBody'),
    inner: `<ul class="insights-teaser__perks"><li>${esc(t('bvVault.proPerkSignals'))}</li><li>${esc(t('bvVault.teaserHistory'))}</li><li>${esc(t('bvVault.proPerkExport'))}</li></ul>
      <div class="bv-sheet__actions">
        ${patreonUrl ? `<a class="bv-btn bv-btn--primary bv-btn--full" href="${esc(patreonUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('bvVault.proWeb'))}</a>` : ''}
        ${btn(signedIn ? t('bvVault.proSettings') : t('bvVault.proSignIn'), { kind: 'tonal', full: true, id: 'proSignInBtn' })}
        ${btn(t('bvVault.proNotNow'), { kind: 'text', full: true, id: 'proOptionsClose' })}
      </div>`,
  }));
  $('#proSignInBtn')?.addEventListener('click', () => { hideSheet(); location.hash = signedIn ? '#/me' : '#/login'; });
  $('#proOptionsClose')?.addEventListener('click', hideSheet);
}

function wire(pval) {
  $('#insightsShare')?.addEventListener('click', async () => { (await import('./portfolio.js')).sharePortfolio(); });
  $$('#rangePills [data-r]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.locked === 'true') {
      haptic('light');
      snackbar(t('bvVault.rangeProToast'), { actions: [{ label: t('bvVault.teaserCta'), onClick: openProOptions }] });
      return;
    }
    if (range === b.dataset.r) return;
    range = b.dataset.r;
    haptic('light');
    paint(pval);
  }));
  $('#insightsUpgradeBtn')?.addEventListener('click', openProOptions);
  $$('#insightsPage [data-legal-sheet]').forEach(el => el.addEventListener('click', () => openLegalSheet(el.dataset.legalSheet)));
  wireChartScrub();
  const container = $('#insightsDoubleChart');
  if (container) {
    const data = clipHistory(state.portfolioHistory || [], rangeDays());
    requestAnimationFrame(() => drawDoubleSparkline(container, data));
  }
}
