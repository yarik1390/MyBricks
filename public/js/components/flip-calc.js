import { marketValueForCondition } from '../lib/pure.js';
import { fmtMoney } from '../utils.js';
import { I } from '../icons.js';

/**
 * Flip-calculator card HTML: estimated resale net after eBay/PayPal fees +
 * shipping, with net ROI vs the owner's purchase price. Single source of truth
 * shared by the set-detail view (portfolio.js) and the scan-result card
 * (scanner.js) — previously a byte-identical copy lived in both.
 */
export function flipCalcHTML(set, entry) {
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
      <div style="font-family:var(--mono);font-size:9px;color:var(--ink-mute);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;display:flex;align-items:center;gap:4px;">Flip calculator ${I.money({w:12,h:12})}</div>
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
