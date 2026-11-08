import type { Env } from '../types';
import { appBaseUrl } from './app-url';

// ---------------------------------------------------------------------------
// One-click unsubscribe for alert and digest emails (RFC 8058 + a footer link).
//
// Each email carries a link signed for its recipient: HMAC-SHA256 of the user
// id under a key derived from SUPABASE_JWT_SECRET, with a fixed purpose label
// so the signature can never be mistaken for any other token. No login is
// needed to unsubscribe, which is the point: a mail provider's "Unsubscribe"
// button POSTs straight to the List-Unsubscribe URL.
//
// Unsubscribing sets user_prefs.email_off_at, which turns off every alert and
// digest email for that user (push and Discord keep their own switches). The
// Notifications screen shows it as the "Email alerts" switch.
// ---------------------------------------------------------------------------

/** Public origin of this Worker, for links that must reach the API directly. */
export const DEFAULT_API_ORIGIN = 'https://brickvault-api.zhydenko.workers.dev';

const PURPOSE = 'bricksvault-email-unsubscribe:v1:';

function apiOrigin(env: Env): string {
  const raw = (env.API_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/.test(raw) ? raw : DEFAULT_API_ORIGIN;
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function unsubscribeToken(env: Env, userId: string): Promise<string | null> {
  const secret = env.SUPABASE_JWT_SECRET;
  if (!secret || !userId) return null;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(PURPOSE + userId));
  return b64url(sig).slice(0, 32);
}

export async function verifyUnsubscribeToken(env: Env, userId: string, token: string): Promise<boolean> {
  if (!userId || !token || userId.length > 128 || token.length !== 32) return false;
  const expected = await unsubscribeToken(env, userId);
  if (!expected) return false;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export interface UnsubscribeLinks {
  /** Footer link: a page on the app domain with a confirm button. */
  page: string;
  /** List-Unsubscribe target: accepts the RFC 8058 one-click POST. */
  oneClick: string;
}

export async function unsubscribeLinks(env: Env, userId: string): Promise<UnsubscribeLinks | null> {
  const token = await unsubscribeToken(env, userId);
  if (!token) return null;
  const q = `u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;
  return {
    page: `${appBaseUrl(env)}/unsubscribe.html?${q}`,
    oneClick: `${apiOrigin(env)}/api/email/unsubscribe?${q}`,
  };
}
