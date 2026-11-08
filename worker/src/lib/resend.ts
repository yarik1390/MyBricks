import type { Env } from '../types';
import { UNSUBSCRIBE_MARKER } from './alert-email';
import { appBaseUrl } from './app-url';
import { unsubscribeLinks } from './email-unsubscribe';

const FROM = 'BricksVault <alerts@alerts.bricksvault.app>';

async function postToResend(env: Env, payload: Record<string, unknown>): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      // Must be on a domain verified in Resend: alerts.bricksvault.app.
      body: JSON.stringify({ from: FROM, ...payload }),
      // No retries: a duplicate alert email is worse than a dropped one.
      signal: AbortSignal.timeout(8000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Alert or digest email to a user. With the recipient's userId, the email gets
 * a signed one-click unsubscribe: a List-Unsubscribe header (RFC 8058, so mail
 * apps show their own Unsubscribe button) and the footer "Unsubscribe" link.
 */
export async function sendAlertEmail(
  to: string,
  subject: string,
  html: string,
  env: Env,
  userId?: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const links = userId ? await unsubscribeLinks(env, userId).catch(() => null) : null;
  const unsubHref = links?.page ?? `${appBaseUrl(env)}/#/me/notifications`;
  const body = html.split(UNSUBSCRIBE_MARKER).join(unsubHref.replace(/&/g, '&amp;'));
  return postToResend(env, {
    to: [to],
    subject,
    html: body,
    ...(links ? {
      headers: {
        'List-Unsubscribe': `<${links.oneClick}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    } : {}),
  });
}

/** Plain operational email to the admin (no unsubscribe: it is not marketing). */
export async function sendAdminEmail(to: string, subject: string, html: string, env: Env): Promise<boolean> {
  return postToResend(env, { to: [to], subject, html });
}
