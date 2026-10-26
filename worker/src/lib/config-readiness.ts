// Integration readiness: which server secrets/bindings are configured.
// Admin-only (served by GET /api/admin/integrations) — the public /api/config
// gets just the few booleans the client UI branches on (publicConfigStatus),
// so an anonymous caller can't read the integration map or missing-secret
// names (security review 2026-10-26).
import type { Env } from '../types';
import { firebasePushConfigured } from './firebase-push';
import { amazonReadiness } from './amazon';

export function integrationReadiness(env: Env) {
  const missing = (entries: Array<[string, string | undefined]>) => entries
    .filter(([, value]) => !value || value.includes('dummy'))
    .map(([name]) => name);
  const googleMissing = missing([
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
  ]);
  const ebayMissing = missing([
    ['EBAY_APP_ID', env.EBAY_APP_ID],
    ['EBAY_CLIENT_SECRET', env.EBAY_CLIENT_SECRET],
  ]);
  const pushMissing = missing([
    ['VAPID_PUBLIC_KEY', env.VAPID_PUBLIC_KEY],
    ['VAPID_PRIVATE_KEY', env.VAPID_PRIVATE_KEY],
    ['VAPID_SUBJECT', env.VAPID_SUBJECT],
  ]);
  const nativePushMissing = firebasePushConfigured(env) ? [] : ['FIREBASE_SERVICE_ACCOUNT_JSON'];
  const geminiMissing = missing([['GEMINI_API_KEY', env.GEMINI_API_KEY]]);
  const emailMissing = missing([['RESEND_API_KEY', env.RESEND_API_KEY]]);
  const status = {
    supabase: !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_JWT_SECRET),
    d1: !!env.DB,
    // Usage analytics (logEvent). The deploy strips this binding unless the
    // ENABLE_ANALYTICS_ENGINE secret is true — surface it so "is my usage data
    // actually being collected?" is answerable from Admin > Services, not CI logs.
    analytics: !!env.ANALYTICS,
    openai: !!env.OPENAI_API_KEY,
    gemini: geminiMissing.length === 0,
    email: emailMissing.length === 0,
    push: pushMissing.length === 0,
    native_push: nativePushMissing.length === 0,
    google: googleMissing.length === 0,
    ebay: ebayMissing.length === 0,
    bricklink: !!(env.BRICKLINK_CONSUMER_KEY && env.BRICKLINK_TOKEN),
    brickeconomy: !!env.BRICKECONOMY_API_KEY,
    brickset: !!env.BRICKSET_API_KEY,
    rebrickable: !!env.REBRICKABLE_API_KEY,
    firecrawl: !!env.FIRECRAWL_API_KEY,
    turnstile: !!env.TURNSTILE_SITE_KEY,
    amazon: amazonReadiness(env).web_links_ready,
    // Stripe is parked as legacy/internal — Patreon is the public supporter flow,
    // so Stripe is intentionally omitted from public readiness. Re-add this line
    // to surface it again if Stripe checkout is brought back.
  };
  return {
    status,
    setup: {
      google: {
        configured: googleMissing.length === 0,
        missing_secrets: googleMissing,
        recommended_action: googleMissing.length
          ? `Add ${googleMissing.join(' and ')} as GitHub Actions secrets; the deploy workflow uploads them to Worker secrets.`
          : 'Google Sheets OAuth is ready.',
      },
      ebay: {
        configured: ebayMissing.length === 0,
        missing_secrets: ebayMissing,
        recommended_action: ebayMissing.length
          ? `Add ${ebayMissing.join(' and ')} as GitHub Actions secrets; eBay asking prices stay disabled until both are present.`
          : 'eBay US/USD asking prices are ready.',
      },
      gemini: {
        configured: geminiMissing.length === 0,
        missing_secrets: geminiMissing,
        recommended_action: geminiMissing.length
          ? 'Add GEMINI_API_KEY as a GitHub Actions secret to enable server-side Gemini fallback; user BYOK Gemini keys still work without it.'
          : 'Server-side Gemini fallback is ready.',
      },
      email: {
        configured: emailMissing.length === 0,
        missing_secrets: emailMissing,
        recommended_action: emailMissing.length
          ? 'Add RESEND_API_KEY as a GitHub Actions secret to enable email wishlist alerts.'
          : 'Email wishlist alerts are ready.',
      },
      push: {
        configured: pushMissing.length === 0,
        missing_secrets: pushMissing,
        recommended_action: pushMissing.length
          ? `Add ${pushMissing.join(', ')} as GitHub Actions secrets to enable browser push alerts.`
          : 'Browser push alerts are ready.',
      },
      native_push: {
        configured: nativePushMissing.length === 0,
        missing_secrets: nativePushMissing,
        recommended_action: nativePushMissing.length
          ? 'Add FIREBASE_SERVICE_ACCOUNT_JSON as a Worker secret and include android/app/google-services.json in the Android build to enable native notifications.'
          : 'Firebase native push delivery is ready.',
      },
      amazon: {
        ...amazonReadiness(env),
        recommended_action: amazonReadiness(env).web_links_ready
          ? 'Amazon Web Special Links are ready. Android and Creators API remain separately policy-gated.'
          : 'Add AMAZON_PARTNER_TAG_FR_WEB and set AMAZON_WEB_ENABLED=1 to enable link-only Web CTAs.',
      },
    },
  };
}

// Only what the client actually reads: d1 (deploy smoke check), google (Sheets
// card for guests), native_push (push setup), and the three pricing sources a
// guest's Me payload mirrors. Everything else stays behind admin auth.
const PUBLIC_STATUS_KEYS = ['d1', 'google', 'native_push', 'ebay', 'bricklink', 'brickeconomy'] as const;

export function publicConfigStatus(status: Record<string, boolean>) {
  return Object.fromEntries(PUBLIC_STATUS_KEYS.map((k) => [k, !!status[k]]));
}
