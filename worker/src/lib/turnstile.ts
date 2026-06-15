// Cloudflare Turnstile server-side verification (Phase 3 #5).
//
// Protects the SHARED server-key photo-scan path (signed-in users with no BYOK
// key, spending our OpenAI quota) from automated abuse. Opt-in: the scan route
// only calls this when TURNSTILE_SECRET_KEY is configured, so the app behaves
// exactly as before until a Turnstile widget is provisioned.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile token with Cloudflare's siteverify endpoint.
 *
 * Fail policy:
 *  - Missing/empty token or a genuine `success:false` (the bot case) -> false
 *    (fail CLOSED — the scan is rejected).
 *  - Network error or a non-2xx siteverify response (a Cloudflare-side outage)
 *    -> true (fail OPEN). The per-user hourly scan rate limit still applies as
 *    the cost backstop, so a Turnstile outage degrades protection without taking
 *    shared-key scanning down entirely.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  secret: string,
  remoteIp?: string | null,
): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const resp = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!resp.ok) {
      console.warn('[turnstile] siteverify HTTP', resp.status, '— failing open');
      return true;
    }
    const data = await resp.json() as { success?: boolean; 'error-codes'?: string[] };
    if (!data.success) {
      console.warn('[turnstile] verification rejected:', (data['error-codes'] || []).join(',') || 'unknown');
    }
    return !!data.success;
  } catch (e) {
    console.warn('[turnstile] siteverify error (failing open):', (e as Error).message);
    return true;
  }
}
