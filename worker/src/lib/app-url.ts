import type { Env } from '../types';

// ---------------------------------------------------------------------------
// The app's public URL, in ONE place.
//
// It used to be pasted literally into ten files — push-notification deep links,
// the email CTA and unsubscribe link, the export footer, the ops-alert footer
// and the CORS allowlist. Moving domain therefore meant a code change in each,
// and any one of them missed is a dead link in somebody's inbox rather than a
// build failure. Behind APP_BASE_URL it becomes a config change.
//
// The default is the Cloudflare Pages origin the app shipped on. Leaving it as
// the fallback (rather than requiring the var) means nothing breaks if the var
// is unset, and the legacy origin keeps working after a migration — which
// matters because links already sent by email, and public profile links already
// shared, point at it and cannot be recalled.
// ---------------------------------------------------------------------------

/** Origin the app originally shipped on. Kept working indefinitely. */
export const LEGACY_APP_ORIGIN = 'https://brickvault-5ub.pages.dev';

/** Cloudflare preview deployments all live under this host. */
const PREVIEW_SUFFIX = '.brickvault-5ub.pages.dev';

/**
 * Canonical origin for links we GENERATE (emails, push, exports). Set
 * APP_BASE_URL to move new links to a custom domain; old ones keep resolving
 * because the legacy origin stays in the CORS allowlist either way.
 */
export function appBaseUrl(env: Env): string {
  const raw = (env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/.test(raw) ? raw : LEGACY_APP_ORIGIN;
}

/**
 * Absolute link into the app. Accepts '#/set/123', '/methodology.html' or
 * 'methodology.html' — the hash form is what the SPA router uses.
 */
export function appLink(env: Env, path = ''): string {
  const base = appBaseUrl(env);
  if (!path) return base;
  if (path.startsWith('#') || path.startsWith('/')) return `${base}${path}`;
  return `${base}/${path}`;
}

/** Host only, for places that display the domain rather than link to it. */
export function appHost(env: Env): string {
  return appBaseUrl(env).replace(/^https:\/\//, '');
}

/**
 * Browser origins reflected for CORS: localhost/native shells, this project's
 * Pages deployments (production alias + previews) and the configured domain.
 *
 * BOTH the configured and the legacy origin are allowed at once, deliberately.
 * A migration that swapped one for the other would break every already-open tab
 * and every installed PWA still pointing at the old origin the moment it
 * deployed; allowing both makes the cutover a redirect rather than a hard
 * switch. (Still not `*.pages.dev` — that would reflect every Cloudflare Pages
 * tenant's origin, which the security audit called out.)
 */
export function isAllowedOrigin(origin: string, env: Env): boolean {
  return (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin === 'https://localhost' ||
    origin === 'capacitor://localhost' ||
    origin === LEGACY_APP_ORIGIN ||
    origin === appBaseUrl(env) ||
    origin.endsWith(PREVIEW_SUFFIX)
  );
}
