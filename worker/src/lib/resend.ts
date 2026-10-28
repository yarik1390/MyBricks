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
        // Must be on a domain verified in Resend: alerts.bricksvault.app.
        from: 'BricksVault <alerts@alerts.bricksvault.app>',
        to: [to],
        subject,
        html,
      }),
      // No retries: a duplicate alert email is worse than a dropped one.
      signal: AbortSignal.timeout(8000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
