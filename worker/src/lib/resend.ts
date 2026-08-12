import { DEFAULT_APP_ORIGIN } from './app-url';
import type { Env } from '../types';

export async function sendAlertEmail(
  to: string,
  subject: string,
  html: string,
  env: Env,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'BricksVault <alerts@brickvault.app>',
        to: [to],
        subject,
        html,
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function wishlistAlertEmailHTML(
  setName: string,
  setNum: string,
  targetPrice: number,
  currentValue: number,
  alertType: 'drop' | 'spike' | 'retiring' | 'deal' | 'preorder' = 'drop',
  // Passed in rather than read from env so this stays a pure builder. Callers
  // hand it appBaseUrl(env); the default keeps existing call sites correct.
  baseUrl: string = DEFAULT_APP_ORIGIN,
): string {
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const headline = alertType === 'spike'
    ? `Value spike: ${setName}`
    : alertType === 'retiring'
      ? `Retiring soon: ${setName}`
      : alertType === 'deal'
        ? `Buy window: ${setName}`
        : alertType === 'preorder'
          ? `Available soon: ${setName}`
          : `Price target reached: ${setName}`;
  const body = alertType === 'spike'
    ? `Your set <strong>${setName}</strong> (${setNum}) has spiked to <strong>${fmt(currentValue)}</strong> — that's over 30% above your purchase price of ${fmt(targetPrice)}.`
    : alertType === 'retiring'
      ? `<strong>${setName}</strong> (${setNum}) is now flagged as <strong>retiring soon</strong>${currentValue > 0 ? `, with a current market value of <strong>${fmt(currentValue)}</strong>` : ''}. Sets often appreciate once they leave production — a good moment to decide whether to buy or hold.`
      : alertType === 'deal'
        ? `<strong>${setName}</strong> (${setNum}) from your wishlist is currently available <strong>below its market value</strong>${currentValue > 0 ? ` of <strong>${fmt(currentValue)}</strong>` : ''} — a potential buy window.`
        : alertType === 'preorder'
          ? `<strong>${setName}</strong> (${setNum}) from your wishlist is now available to <strong>pre-order</strong> or coming soon. Lock in launch-day availability before it sells out.`
          : `<strong>${setName}</strong> (${setNum}) is now at <strong>${fmt(currentValue)}</strong>, which is at or below your target of ${fmt(targetPrice)}.`;

  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f5f5f5;margin:0;padding:24px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 2px 8px rgba(0,0,0,.08);">
  <div style="font-size:22px;font-weight:700;color:#111;margin-bottom:16px;">${headline}</div>
  <p style="color:#444;line-height:1.6;margin:0 0 20px;">${body}</p>
  <a href="${baseUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;">Open BricksVault</a>
  <p style="color:#999;font-size:11px;margin-top:24px;">You're receiving this because alerts are enabled in your BricksVault settings. <a href="${baseUrl}#/me" style="color:#999;">Manage alerts</a></p>
</div></body></html>`;
}
