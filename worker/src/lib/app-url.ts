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
// The default is the custom domain. APP_BASE_URL stays available as an override
// (a staging domain, say) but should not be needed in production.
// ---------------------------------------------------------------------------

/** Canonical public domain. */
export const DEFAULT_APP_ORIGIN = 'https://bricksvault.app';

/**
 * The Cloudflare Pages origin. NOT legacy cruft: Pages always serves the project
 * here whatever custom domain is attached, and preview deployments exist ONLY
 * under this host — so it stays in the CORS allowlist as a live deployment
 * surface, not for backwards compatibility.
 */
export const PAGES_ORIGIN = 'https://brickvault-5ub.pages.dev';
const PREVIEW_SUFFIX = '.brickvault-5ub.pages.dev';

/** Canonical origin for links we GENERATE (emails, push, exports). */
export function appBaseUrl(env: Env): string {
  const raw = (env.APP_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+$/.test(raw) ? raw : DEFAULT_APP_ORIGIN;
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
 * Browser origins reflected for CORS: localhost/native shells, the canonical
 * domain, and this project's Pages deployments (production alias + previews).
 *
 * The Pages origins are included because they are a real, permanent deployment
 * surface — Cloudflare serves the project there regardless of custom domain, and
 * previews live nowhere else. Still NOT `*.pages.dev`: that would reflect every
 * Cloudflare tenant's origin, which the security audit called out.
 */
export function isAllowedOrigin(origin: string, env: Env): boolean {
  if (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin === 'https://localhost' ||
    origin === 'capacitor://localhost' ||
    origin === appBaseUrl(env) ||
    origin === PAGES_ORIGIN
  ) {
    return true;
  }
  // Preview deployments under our Pages host: require HTTPS, no userinfo, no
  // path, and at least one real label before the suffix (a bare
  // `https://brickvault-5ub.pages.dev` is already handled by the exact match
  // above). Nested labels are intentionally allowed — Cloudflare names some
  // preview deployments with extra subdomain labels.
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    if (u.pathname && u.pathname !== '/') return false;
    return u.hostname.endsWith(PREVIEW_SUFFIX) && u.hostname !== PREVIEW_SUFFIX.slice(1);
  } catch {
    return false;
  }
}
