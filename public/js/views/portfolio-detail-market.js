// Pure market/price HTML builders for the set-detail page — the price strip,
// PriceCharting comps, confidence/spread/depth panels, deal signal and part-out.
// Extracted from portfolio-detail.js; stateless (set-in, HTML-out), so they carry
// no module state. The main view imports the six the info tab renders.
import { I } from '../icons.js';
import { amazonSlotHTML } from '../lib/amazon-affiliate.js';
import { ebaySoldSummary } from '../lib/pure.js';
import { escapeHtml, fmtMoney, fmtPct, fmtDateUpdated, trendBadgeHTML } from '../utils.js';

function genericSourceLabel(s) {
  const id = String((s && s.id) || '');
  const cond = String((s && s.condition) || '');
  const name = String((s && s.name) || '');
  if (id.includes('ask')) return 'eBay asking';
  if (id.includes('ebay_legacy')) return 'Legacy eBay avg';
  if (id.includes('sold') || id.includes('ebay')) return cond === 'used' ? 'eBay sold used' : 'eBay sold new';
  if (id.includes('bricklink') || id === 'market' || /bricklink/i.test(name)) return cond === 'used' ? 'BrickLink used' : 'BrickLink new';
  if (id.includes('brickeconomy') || /brickeconomy/i.test(name)) return 'Market guide';
  if (id.includes('brickowl') || /brickowl/i.test(name)) return cond === 'used' ? 'BrickOwl used' : 'BrickOwl new';
  if (id.includes('formula')) return 'Formula fallback';
  if (id.includes('ai')) return 'AI estimate';
  if (id === 'retail') return 'MSRP';
  if (cond === 'used' || id.includes('used')) return 'Used market';
  return 'Market value';
}

export function priceStripHTML(set, entry) {
  const delta = entry?.purchase_price ? (set.current_value - entry.purchase_price) / entry.purchase_price : null;

  // Column 1: primary new-condition valuation source
  const isBE = set.valuation_method === "brickeconomy";
  const isBL = set.valuation_method === "market";
  const label1 = isBL ? "BrickLink"
    : isBE ? "Market guide"
    : set.valuation_method === "ai" ? "AI estimate"
    : (set.valuation_method === "ebay_rss" || set.valuation_method === "ebay_sold") ? "eBay sold"
    : set.valuation_method === "formula_bulk" ? "Formula"
    : "Market";
  const val1 = (set.valuation?.read_enabled && Number(set.valuation?.new?.fair_value)) || set.current_value;

  // Column 2: cross-source BrickLink new (when BE is primary, show BL independently)
  //           or BrickLink used when BL is primary (most useful comparison)
  const showBlCross = isBE && set.bl_new_value;
  const label2 = showBlCross ? "BrickLink new" : "Used market";
  const val2 = showBlCross ? set.bl_new_value : set.used_value;

  const ebaySold = ebaySoldSummary(set);
  // Column 3: eBay sold new + used sold/used market comparison. When sold
  // comps are unavailable (gated Marketplace Insights), fall back to the
  // Browse API asking price so the column isn't dead.
  const askValue = Number(set.ebay_ask_value) > 0 ? Number(set.ebay_ask_value) : null;
  const showAsk = !ebaySold.newValue && askValue;
  const label3 = showAsk ? "eBay asking" : ebaySold.legacy ? "Legacy eBay avg" : "eBay sold new";
  const val3 = ebaySold.newValue || askValue;
  const soldSampleText = ebaySold.newSampleCount ? `${ebaySold.newSampleCount} comps` : null;
  const val3sub = showAsk
    ? (Number(set.ebay_ask_qty) > 0 ? `${set.ebay_ask_qty} listings` : null)
    : (ebaySold.usedValue
      ? `${soldSampleText ? `${soldSampleText} / ` : ""}Used: ${fmtMoney(ebaySold.usedValue)}`
      : soldSampleText || (showBlCross && set.used_value ? `Used: ${fmtMoney(set.used_value)}` : null));

  const hasEbaySold = ebaySold.newValue || ebaySold.usedValue;
  // Plain-language basis for the active valuation mix.
  const sourceSuffix = set.valuation_method === "ai" ? "AI estimate"
    : set.valuation_method === "formula_bulk" ? "Estimated from set details"
    : hasEbaySold && !ebaySold.legacy ? "From recent sales + market guide"
    : ebaySold.legacy ? "Older eBay average"
    : showAsk ? "From current listings (not yet sold)"
    : isBL ? "BrickLink market guide"
    : "Market guide value";

  const updateDateStr = set.cached_at ? fmtDateUpdated(set.cached_at) : null;
  // Surface data staleness from the enrichment freshness field.
  const freshColor = set.freshness === 'expired' ? 'var(--down)' : set.freshness === 'stale' ? 'var(--bv-yellow)' : 'var(--ink-mute)';
  const freshNote = set.freshness === 'expired' ? ' · needs refresh' : set.freshness === 'stale' ? ' · over 2 months old' : '';
  const lastUpdatedText = (updateDateStr ? `Updated ${updateDateStr}` : "Updating soon") + freshNote;

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
        <div class="ps-lbl">${showBlCross ? lotLabel(blNewQty, label2) : lotLabel(blUsedQty, label2)}</div>
        <div class="ps-val${!val2 ? " muted" : ""}">${val2 ? fmtMoney(val2) : "—"}</div>
        ${col2Range ? `<div class="ps-sub muted" style="font-size:9px;">${col2Range}</div>` : ""}
      </div>
      <div class="ps-cell">
        <div class="ps-lbl">${label3}</div>
        <div class="ps-val${!val3 ? " muted" : ""}">${val3 ? fmtMoney(val3) : "—"}</div>
        ${val3sub ? `<div class="ps-sub muted">${val3sub}</div>` : ""}
      </div>
    </div>
    <div class="ps-footnote" style="display:flex;align-items:center;justify-content:space-between;width:100%;">
      <span>${sourceSuffix}</span>
      <span style="font-family:var(--mono);font-size:10px;color:${freshColor};">${lastUpdatedText}</span>
    </div>`;
}

function localMoney(value, currency = 'USD') {
  if (!(Number(value) > 0)) return 'Not available';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value)); }
  catch { return `${currency} ${Number(value).toFixed(2)}`; }
}

function confidenceLabel(value) {
  return ({ high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence', estimated: 'Estimated' })[value] || 'Pending';
}

function sourceTypeLabel(value) {
  return ({ sold: 'Verified sold data', modeled: 'Market guides (not live sales)', asking: 'Active asking data', estimate: 'Estimated only' })[value] || 'Market signal';
}

function conditionStateHTML(state, label) {
  if (!state) return '';
  const basis = Array.isArray(state.basis) ? state.basis : [];
  const primaryType = basis.find((item) => item.signal_type === 'sold')?.signal_type || basis[0]?.signal_type || 'estimate';
  const flags = Array.isArray(state.flags) ? state.flags : [];
  const range = Number(state.low) > 0 && Number(state.high) > 0
    ? `${fmtMoney(state.low)} - ${fmtMoney(state.high)}`
    : 'Range pending';
  return `
    <article class="pricing-condition-card">
      <div class="pricing-condition-head">
        <span>${escapeHtml(label)}</span>
        <span class="pricing-confidence pricing-confidence--${escapeHtml(state.confidence || 'estimated')}">${escapeHtml(confidenceLabel(state.confidence))}</span>
      </div>
      <strong class="pricing-condition-value">${Number(state.fair_value) > 0 ? fmtMoney(state.fair_value) : 'Not enough verified data'}</strong>
      <span class="pricing-condition-range">${escapeHtml(range)}</span>
      <dl class="pricing-metrics">
        <div><dt>Basis</dt><dd>${escapeHtml(sourceTypeLabel(primaryType))}</dd></div>
        <div><dt>Sales</dt><dd>${Number(state.sample_count || 0).toLocaleString()}</dd></div>
        <div><dt>Independent families</dt><dd>${Number(state.independent_family_count || 0)}</dd></div>
        <div><dt>As of</dt><dd>${state.as_of ? escapeHtml(fmtDateUpdated(state.as_of)) : 'Pending'}</dd></div>
      </dl>
      ${flags.length ? `<div class="pricing-flags">${flags.map((flag) => `<span>${escapeHtml(String(flag).replaceAll('_', ' '))}</span>`).join('')}</div>` : ''}
    </article>`;
}

function announcedRetailPrice(set) {
  return Number(set.upcoming_price) || Number(set.be_retail) || Number(set.retail_price) || 0;
}

// Derive the five valuation numbers (with legacy fallbacks) once, so the
// compact "More prices" card and the full expander grid stay consistent.
function deriveV3States(set) {
  const valuation = set.valuation || {};
  const legacyValue = Number(set.market_value) || Number(set.blended_value) || Number(set.current_value) || 0;
  const newState = valuation.new || (legacyValue > 0 ? {
    fair_value: legacyValue, low: null, high: null, confidence: 'estimated',
    sample_count: 0, independent_family_count: 0, basis: [], flags: ['legacy_estimate'],
    as_of: set.cached_at || null,
  } : null);
  const legacyUsed = Number(set.used_value) || 0;
  const usedState = valuation.used || (legacyUsed > 0 ? {
    fair_value: legacyUsed, low: null, high: null, confidence: 'low',
    sample_count: Number(set.bl_used_qty || 0), independent_family_count: 1, basis: [], flags: ['legacy_signal'],
    as_of: set.bl_cached_at || set.cached_at || null,
  } : null);
  const acquisition = valuation.acquisition || {};
  const partOut = valuation.part_out || {};
  const forecast = valuation.forecast || {};
  return {
    valuation, newState, usedState, acquisition, partOut, forecast,
    fairValue: Number(newState?.fair_value) || legacyValue,
    liquidation: Number(newState?.liquidation_value) || 0,
    delivered: Number(acquisition.delivered_price) || 0,
    usedValue: Number(usedState?.fair_value) || 0,
    partOutValue: Number(partOut.value) > 0 && Number(partOut.coverage) >= 0.6 ? Number(partOut.value) : 0,
    forecastReady: forecast.status === 'ready' || forecast.status === 'external',
  };
}

// Compact "More prices" card shown on the Info tab. The headline New & sealed
// value already lives in the top summary card, so this only lists the OTHER
// numbers — and only the ones that actually exist. Everything empty collapses
// into a single honest footnote instead of four jargon cards. The full
// evidence grid moves into the "Pricing details" expander (see below).
export function investmentPricingHTML(set) {
  // An unreleased set has no honest resale scenarios yet. The headline already
  // shows its announced retail price; don't follow it with modeled market rows.
  if (set.coming_soon) return '';
  const d = deriveV3States(set);
  const rows = [];
  if (d.usedValue > 0) {
    rows.push(['Used &amp; complete', fmtMoney(d.usedValue), 'what a used, complete copy resells for']);
  }
  if (d.liquidation > 0) {
    const pct = d.fairValue > 0 ? ` · ${Math.round((d.liquidation / d.fairValue) * 100)}% of value` : '';
    rows.push(['Sell now', `${fmtMoney(d.liquidation)}`, `fast sale after fees${pct}`]);
  }
  if (d.delivered > 0) {
    const merchant = d.acquisition.merchant ? escapeHtml(d.acquisition.merchant) : 'retail';
    rows.push(['Buy now', escapeHtml(localMoney(d.delivered, d.acquisition.currency || 'USD')), `today at ${merchant}`]);
  }
  if (d.partOutValue > 0) {
    const cov = Number(d.partOut.coverage) > 0 ? ` · ${Math.round(Number(d.partOut.coverage) * 100)}% coverage` : '';
    rows.push(['Part out', fmtMoney(d.partOutValue), `parts &amp; minifigs sold separately${cov}`]);
  }
  if (d.forecastReady && Number(d.forecast.base) > 0) {
    rows.push(['2-year forecast', fmtMoney(d.forecast.base), `range ${fmtMoney(d.forecast.bear)}–${fmtMoney(d.forecast.bull)}`]);
  }

  // Which of the four scenario numbers are still missing → one honest line.
  const missing = [];
  if (!(d.liquidation > 0)) missing.push('sell-now');
  if (!(d.partOutValue > 0)) missing.push('part-out');
  if (!(d.forecastReady && Number(d.forecast.base) > 0)) missing.push('forecast');
  const missingLine = missing.length
    ? `<div class="more-price-note">${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')} ${missing.length === 1 ? 'estimate' : 'estimates'} unlock as more sold data arrives.</div>`
    : '';

  const rowsHTML = rows.map(([label, value, sub]) => `
    <div class="more-price-row">
      <div class="more-price-label">${label}<span class="more-price-sub">${sub}</span></div>
      <div class="more-price-value">${value}</div>
    </div>`).join('');

  return `
    <div class="detail-card">
      <div class="detail-card-title" style="justify-content:space-between;">
        <span>More prices</span>
        <span class="pricing-model-badge">${escapeHtml(d.valuation.model_version || 'legacy')}</span>
      </div>
      ${rowsHTML || ''}
      ${d.delivered > 0 ? amazonSlotHTML(set.set_num) : ''}
      ${missingLine}
      <div class="more-price-hint">Open <em>Pricing details</em> below for the full evidence and sources.</div>
    </div>`;
}

// The original "Five numbers, five different jobs" grid — full evidence, now
// tucked inside the Pricing details expander for anyone who wants the depth.
export function investmentPricingDetailHTML(set) {
  if (set.coming_soon) {
    const retail = announcedRetailPrice(set);
    const releaseDate = set.launch_date ? new Date(set.launch_date) : null;
    const release = releaseDate && !Number.isNaN(releaseDate.getTime())
      ? releaseDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    return `
      <section class="investment-pricing investment-pricing--upcoming" aria-labelledby="investmentPricingTitle">
        <div class="investment-pricing-head">
          <div>
            <span class="u-mono-label">Before release</span>
            <h2 id="investmentPricingTitle">Retail price, not resale value</h2>
          </div>
          <span class="pricing-model-badge">Coming soon</span>
        </div>
        <div class="pricing-block">
          <div class="pricing-block-title"><span>1</span><div><h3>Announced retail price</h3><p>The expected price at launch. This is not a secondary-market valuation.</p></div></div>
          <article class="pricing-condition-card pricing-upcoming-card">
            <div class="pricing-condition-head">
              <span>New from retail</span>
              <span class="pricing-confidence pricing-confidence--estimated">Pre-release</span>
            </div>
            <strong class="pricing-condition-value">${retail > 0 ? fmtMoney(retail) : 'Price not announced'}</strong>
            <span class="pricing-condition-range">${release ? `Expected ${escapeHtml(release)}` : 'Release date pending'}</span>
          </article>
          <p class="more-price-note">Resale pricing, used value, sell-now estimates, and forecasts begin only after verified market evidence arrives.</p>
        </div>
      </section>`;
  }
  const d = deriveV3States(set);
  const { newState, usedState, acquisition, partOut, forecast, fairValue, liquidation, delivered, forecastReady } = d;
  if (!newState && !usedState) return '';
  return `
    <section class="investment-pricing" aria-labelledby="investmentPricingTitle">
      <div class="investment-pricing-head">
        <div>
          <span class="u-mono-label">Full breakdown</span>
          <h2 id="investmentPricingTitle">Five numbers, five different jobs</h2>
        </div>
        <span class="pricing-model-badge">${escapeHtml(d.valuation.model_version || 'legacy')}</span>
      </div>

      <div class="pricing-block">
        <div class="pricing-block-title"><span>1</span><div><h3>Market value</h3><p>Expected resale value, separated by condition.</p></div></div>
        <div class="pricing-condition-grid">
          ${conditionStateHTML(newState, 'New and sealed')}
          ${conditionStateHTML(usedState, 'Used and complete')}
        </div>
      </div>

      <div class="pricing-block pricing-block--split">
        <div>
          <div class="pricing-block-title"><span>2</span><div><h3>Sell now</h3><p>Fast-sale estimate after fees and a liquidity haircut.</p></div></div>
          <strong class="pricing-block-value">${liquidation > 0 ? fmtMoney(liquidation) : 'Not enough sold data yet'}</strong>
          ${liquidation > 0 && fairValue > 0 ? `<small>${Math.round((liquidation / fairValue) * 100)}% of fair value</small>` : ''}
        </div>
        <div>
          <div class="pricing-block-title"><span>3</span><div><h3>Buy now</h3><p>Current retail acquisition price, never part of resale value.</p></div></div>
          <strong class="pricing-block-value">${delivered > 0 ? escapeHtml(localMoney(delivered, acquisition.currency || 'USD')) : 'No current retail offer'}</strong>
          ${acquisition.merchant ? `<small>${escapeHtml(acquisition.merchant)}${acquisition.checked_at ? ` · ${escapeHtml(fmtDateUpdated(acquisition.checked_at))}` : ''}</small>` : ''}
        </div>
      </div>

      <div class="pricing-block pricing-block--split">
        <div>
          <div class="pricing-block-title"><span>4</span><div><h3>Part out</h3><p>Value of parts and minifigures sold separately.</p></div></div>
          <strong class="pricing-block-value">${Number(partOut.value) > 0 ? fmtMoney(partOut.value) : 'Not enough parts data yet'}</strong>
          ${Number(partOut.coverage) > 0 ? `<small>${Math.round(Number(partOut.coverage) * 100)}% parts coverage</small>` : ''}
        </div>
        <div>
          <div class="pricing-block-title"><span>5</span><div><h3>Forecast</h3><p>Scenario range based on the current fair value.</p></div></div>
          <strong class="pricing-block-value">${forecastReady && Number(forecast.base) > 0 ? fmtMoney(forecast.base) : 'Not enough history yet'}</strong>
          ${forecastReady ? `<small>Bear ${fmtMoney(forecast.bear)} · Base ${fmtMoney(forecast.base)} · Bull ${fmtMoney(forecast.bull)}</small>` : `<small>${escapeHtml(forecast.methodology || 'Unlocks after 180 days and 12 recorded values.')}</small>`}
        </div>
      </div>
    </section>`;
}

export function marketConfidenceHTML(set) {
  const fallbackSources = () => {
    const primaryName = set.valuation_method === 'brickeconomy' ? 'Market guide'
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
    if (set.bo_new_value) out.push({ id: 'brickowl_new', name: 'BrickOwl', value: set.bo_new_value, condition: 'new', sample_count: set.bo_new_qty });
    if (set.bo_used_value) out.push({ id: 'brickowl_used', name: 'BrickOwl used', value: set.bo_used_value, condition: 'used', sample_count: set.bo_used_qty });
    return out;
  };
  const v3State = set.valuation?.read_enabled ? set.valuation?.new : null;
  const sources = Array.isArray(v3State?.basis) && v3State.basis.length
    ? v3State.basis.map((basis) => ({
        id: basis.provider_family,
        name: basis.provider_family,
        value: basis.value,
        condition: 'new',
        sample_count: basis.sample_count,
        note: sourceTypeLabel(basis.signal_type),
      }))
    : Array.isArray(set.market_sources) && set.market_sources.length
      ? set.market_sources.filter(s => s.id !== 'retail')
      : fallbackSources();
  const confidence = String(v3State?.confidence || set.market_value_confidence || set.confidence || (set.valuation_method === 'formula_bulk' ? 'estimated' : 'medium')).toLowerCase();
  const freshness = set.freshness || 'fresh';
  const primary = sources.find(s => s.id === set.primary_value_source) || sources[0] || null;
  const color = confidence === 'high' ? 'var(--up)' : confidence === 'medium' ? 'var(--accent)' : confidence === 'low' ? 'var(--bv-yellow)' : 'var(--bv-red)';
  // Generic, provider-anonymous explanation derived from confidence (we never
  // surface the backend's named valuation_explanation to users).
  const explanation = set.valuation_method === 'ai'
      ? 'Estimated by AI because fresh market data was unavailable.'
    : set.valuation_method === 'formula_bulk'
      ? 'Estimated from set attributes until a market refresh completes.'
    : confidence === 'high' ? 'Several recent sources agree on this price.'
    : confidence === 'medium' ? 'Based on recent market data, with a little disagreement.'
    : confidence === 'low' ? 'Limited recent data — treat this as a rough guide.'
    : 'Based on the latest available market data.';
  // Plain-language freshness + source-role wording (no "primary/fallback/stale").
  const freshLabel = { fresh: 'Up to date', stale: 'A bit old', expired: 'Needs refresh' }[freshness] || freshness;
  const relColor = (r) => r === 'primary' ? 'var(--up)' : r === 'fallback' ? 'var(--bv-yellow)' : 'var(--ink-mute)';
  const relLabel = (r) => r === 'primary' ? 'Main' : r === 'fallback' ? 'Backup' : r;
  const sampleLabel = (s) => {
    const count = Number(s.sample_count || 0);
    if (!count) return '';
    const id = String(s.id || '');
    if (id.includes('ask')) return ` / ${count} listings`;
    if (id.includes('sold') || id.includes('ebay')) return ` / ${count} comps`;
    if (id.includes('bricklink') || id.includes('brickowl')) return ` / ${count} lots`;
    return ` / ${count} samples`;
  };
  const sourceRows = sources.slice(0, 6).map(s => {
    const rel = s.reliability
      ? `<span style="font-size:8px;letter-spacing:.04em;text-transform:uppercase;border:1px solid ${relColor(s.reliability)};color:${relColor(s.reliability)};border-radius:6px;padding:0 5px;margin-left:6px;white-space:nowrap;">${escapeHtml(relLabel(s.reliability))}</span>`
      : '';
    const upd = s.last_updated ? fmtDateUpdated(s.last_updated) : '';
    const sub = (s.note || upd)
      ? `<div style="display:flex;justify-content:space-between;gap:8px;margin-top:2px;font-size:9px;color:var(--ink-mute);line-height:1.3;">${s.note ? `<span style="min-width:0;">${escapeHtml(s.note)}</span>` : '<span></span>'}${upd ? `<span style="white-space:nowrap;">updated ${escapeHtml(upd)}</span>` : ''}</div>`
      : '';
    return `
    <div style="border-top:1px solid var(--line-soft);padding-top:7px;margin-top:7px;">
      <div style="display:flex;justify-content:space-between;gap:10px;">
        <span style="min-width:0;color:var(--ink-soft);">${escapeHtml(genericSourceLabel(s))}${rel}</span>
        <span style="font-family:var(--mono);font-weight:700;color:var(--ink);white-space:nowrap;">${s.value ? fmtMoney(s.value) : 'pending'}${sampleLabel(s)}</span>
      </div>
      ${sub}
    </div>`;
  }).join('');
  return `
    <div class="detail-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;">
        <div>
          <div class="detail-card-title" style="margin-bottom:4px;">How we priced this</div>
          <div style="font-size:13px;color:var(--ink-soft);line-height:1.45;">${escapeHtml(explanation)}</div>
        </div>
        <div style="font-family:var(--mono);font-size:10px;text-transform:uppercase;color:${color};font-weight:800;white-space:nowrap;">${escapeHtml(freshLabel)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;">
        <span style="color:var(--ink-mute);">Primary signal</span>
        <strong style="color:var(--ink);text-align:right;">${primary ? escapeHtml(genericSourceLabel(primary)) : 'Pending refresh'}</strong>
      </div>
      ${sourceRows}
    </div>
  `;
}

// Shows a sell/buy signal when recent resale and the primary market value diverge >10%.
export function marketSpreadHTML(set) {
  const ebay = ebaySoldSummary(set);
  const ebayValue = ebay.newValue;
  if (!ebayValue || !set.current_value) return '';
  const spread = (ebayValue - set.current_value) / set.current_value;
  if (Math.abs(spread) < 0.10) return '';
  const hot = spread > 0;
  return `<div class="market-signal ${hot ? "signal-hot" : "signal-cold"}">
    <span>${hot ? `Selling about ${fmtPct(Math.abs(spread))} above this value` : `Selling about ${fmtPct(Math.abs(spread))} below this value`}</span>
    <span class="signal-hint">${hot ? "Good time to sell" : "Good time to buy"}</span>
  </div>`;
}

// Supply side: how many active eBay listings compete and what they ask,
// compared against sold comps. Scarcity + a healthy sold price = sell signal.
export function marketDepthHTML(set) {
  const askValue = Number(set.ebay_ask_value);
  const askQty = Number(set.ebay_ask_qty);
  if (!Number.isFinite(askValue) || askValue <= 0 || !Number.isFinite(askQty) || askQty <= 0) return '';
  const sold = ebaySoldSummary(set).newValue;
  let hint = '';
  if (sold) {
    const askVsSold = (askValue - sold) / sold;
    if (askQty <= 5) hint = `Only ${askQty} for sale right now`;
    else if (askVsSold > 0.20) hint = 'Sellers are asking high — list near the recent sold price to sell fast';
    else if (askVsSold < 0) hint = 'Listed below recent sold prices — good time to buy';
  }
  return `<div class="market-depth">
    <span class="u-row u-gap-1">${I.box({w:13,h:13})} ${askQty} for sale now · asking ${fmtMoney(askValue)}${sold ? ` vs ${fmtMoney(sold)} recently sold` : ''}</span>
    ${hint ? `<span class="signal-hint">${escapeHtml(hint)}</span>` : ''}
  </div>`;
}

// Buy / fair / above-value verdict (E3a) — compares the authoritative market
// value against the cheapest price you could pay now. The reason text is
// produced server-side and is already source-anonymized (retail vs resale, no
// provider names); we only choose the badge styling here.
export function dealSignalHTML(set) {
  const confidence = String(set.valuation?.new?.confidence || set.market_value_confidence || '').toLowerCase();
  if (!confidence || confidence === 'low' || confidence === 'estimated') return '';
  const sig = set.deal_signal;
  if (sig !== 'buy' && sig !== 'fair' && sig !== 'premium') return '';
  const reason = set.deal_reason || '';
  const strong = !!set.deal_strong;
  const cfg = {
    buy: { label: strong ? 'STRONG BUY' : 'BUY', color: 'var(--up)', bg: 'rgba(34,197,94,.10)' },
    fair: { label: 'FAIR PRICE', color: 'var(--ink-soft)', bg: 'var(--surface-2)' },
    premium: { label: 'ABOVE VALUE', color: 'var(--down)', bg: 'rgba(239,68,68,.10)' },
  }[sig];
  const pct = Number(set.deal_discount_pct);
  const pctStr = (sig !== 'fair' && Number.isFinite(pct) && Math.abs(pct) >= 1) ? ` · ${Math.abs(Math.round(pct))}%` : '';
  // Live buy destination: when the cheapest channel is an in-stock pricesAPI
  // retail offer, name where to buy it (naming a buy destination is allowed even
  // though valuation sources stay anonymized).
  const merchant = set.deal_available_merchant;
  const buyPrice = Number(set.deal_available_price);
  const buyLine = merchant && Number.isFinite(buyPrice) && buyPrice > 0
    ? `<div style="margin-top:6px;font-size:12px;color:${cfg.color};font-weight:700;">In stock — ${fmtMoney(buyPrice)} at ${escapeHtml(String(merchant))}</div>`
    : '';
  return `
    <div class="detail-card" style="border:1px solid ${cfg.color};background:${cfg.bg};">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
        <div style="min-width:0;">
          <div class="detail-card-title" style="margin-bottom:3px;">Deal check</div>
          <div style="font-size:13px;color:var(--ink-soft);line-height:1.45;">${escapeHtml(reason)}</div>
          ${buyLine}
        </div>
        <span style="flex-shrink:0;font-family:var(--mono);font-size:11px;font-weight:800;text-transform:uppercase;color:${cfg.color};border:1px solid ${cfg.color};border-radius:8px;padding:4px 10px;white-space:nowrap;">${cfg.label}${pctStr}</span>
      </div>
    </div>`;
}

// Liquidity badge (PriceCharting yearly units sold) — how fast the set turns
// over on the market. A small, source-anonymized pill.
// Sum-of-parts (part-out) value (E1) — the floor value if the set were sold as
// individual parts. Only present when piece-price coverage is high (gated
// server-side in enrichSetRecord), so a shown figure is trustworthy.
export function partOutHTML(set) {
  const po = Number(set.valuation?.part_out?.value || set.part_out_value);
  if (!Number.isFinite(po) || po <= 0) return '';
  const mv = Number(set.market_value) || Number(set.current_value) || 0;
  let note = 'Estimated value if sold as individual parts.';
  if (mv > 0) {
    const ratio = po / mv;
    if (ratio >= 1.15) note = `Parting out could yield roughly ${fmtPct(ratio - 1)} more than the sealed value.`;
    else if (ratio <= 0.85) note = 'The sealed set is worth more than its individual parts.';
    else note = 'Roughly in line with the sealed value.';
  }
  return `
    <div class="detail-card">
      <div class="detail-card-title" style="margin-bottom:3px;">Part-out value</div>
      <div style="font-size:22px;font-weight:800;line-height:1.05;">${fmtMoney(po)}</div>
      <div style="margin-top:6px;font-size:12px;color:var(--ink-mute);line-height:1.45;">${escapeHtml(note)}</div>
    </div>`;
}
