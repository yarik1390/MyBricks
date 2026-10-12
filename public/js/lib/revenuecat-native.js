// RevenueCat — native Google Play (and later Apple) billing.
//
// WHY THE BRIDGE, NOT AN IMPORT: BricksVault ships as unbundled ES modules, so we
// can't `import { Purchases } from '@revenuecat/purchases-capacitor'` (bare
// specifier won't resolve in the browser). Inside the Capacitor Android build the
// plugins are reachable through the Capacitor runtime bridge, so we grab them via
// `Capacitor.registerPlugin(name)`. On the web these functions are safe no-ops, so
// importing this module never affects the PWA.
//
// ✅ PLUGIN NAMES VERIFIED (2026-07, @revenuecat/purchases-capacitor@13.2.2):
// registerPlugin('Purchases') and registerPlugin('RevenueCatUI') match the
// constants below exactly. Method SHAPES still need one on-device pass during
// the Play license-tester purchase test (this code can't run in the browser).

import { getSessionUserId } from '../api.js';

// Entitlement identifier — must match the RevenueCat dashboard exactly.
const ENTITLEMENT_ID = 'BricksVault Pro';
// Capacitor plugin registration names (verify against the installed plugin).
const PURCHASES_PLUGIN = 'Purchases';
const UI_PLUGIN = 'RevenueCatUI';

let _configured = false;
let _identifiedUserId = null;

export function isNativeBilling() {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  } catch { return false; }
}

function plugin(name) {
  try { return window.Capacitor?.registerPlugin?.(name) || window.Capacitor?.Plugins?.[name] || null; }
  catch { return null; }
}

// Can a purchase actually be started right now? RevenueCat supports an
// anonymous app user during first-run; once Supabase sign-in happens configure()
// identifies that same customer via logIn(), preserving the purchase.
export function proPurchaseReady() {
  if (!isNativeBilling()) return false;
  try {
    return !!(plugin(PURCHASES_PLUGIN) && plugin(UI_PLUGIN)
      && window.RC_PLAY_BILLING_KEY);
  } catch { return false; }
}

// Configure once. During guest onboarding RevenueCat creates an anonymous app
// user; after Supabase sign-in we identify it with logIn(), which aliases the
// anonymous purchase to that account. Requiring a user ID here made the first-
// run Pro button impossible to use by definition.
async function configure() {
  if (!isNativeBilling()) return null;
  const Purchases = plugin(PURCHASES_PLUGIN);
  const apiKey = window.RC_PLAY_BILLING_KEY;   // goog_… key, set in env.js
  const userId = getSessionUserId();
  if (!Purchases || !apiKey) return null;
  try {
    if (!_configured) {
      await Purchases.configure(userId ? { apiKey, appUserID: userId } : { apiKey });
      _configured = true;
      _identifiedUserId = userId || null;
    } else if (userId && userId !== _identifiedUserId) {
      // RevenueCat aliases an anonymous customer to the signed-in ID so a
      // purchase made during onboarding follows the account.
      await Purchases.logIn?.({ appUserID: userId });
      _identifiedUserId = userId;
    }
    return Purchases;
  } catch (e) { console.error('[rc-native] configure', e); return null; }
}

// True only when a native purchase has granted the entitlement. The server
// webhook (is_supporter) remains the cross-device source of truth; use this for
// an instant local check right after a purchase.
export async function nativeIsPro() {
  const Purchases = await configure();
  if (!Purchases) return false;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  } catch (e) { console.error('[rc-native] getCustomerInfo', e); return false; }
}

// Present the RevenueCat-designed Paywall (fully supported on Capacitor). Returns
// true if the user ends the flow entitled. The server webhook will also flip
// is_supporter; we invalidate state so the UI refreshes either way.
export async function presentProPaywall() {
  const Purchases = await configure();
  const UI = plugin(UI_PLUGIN);
  if (!Purchases || !UI) return { ok: false, reason: 'unavailable' };
  try {
    // presentPaywallIfNeeded shows nothing if the user is already entitled.
    const res = await UI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: ENTITLEMENT_ID });
    if (res?.result === 'CANCELLED') return { ok: false, reason: 'cancelled' };
    if (res?.result === 'ERROR') return { ok: false, reason: 'store' };
    const active = await nativeIsPro();
    return { ok: true, active };
  } catch (e) {
    console.error('[rc-native] presentPaywall', e);
    return { ok: false, reason: 'error' };
  }
}

// Plans from the current Offering, kept so the #/pro screen can buy the plan the
// user picked straight through Google Play (no second, RevenueCat-designed
// paywall in between). Returns [] on the web or when offerings can't be read.
let _packages = [];
const PLAN_TYPES = new Set(['ANNUAL', 'MONTHLY', 'LIFETIME']);
export async function proPlanPrices() {
  const Purchases = await configure();
  if (!Purchases?.getOfferings) return [];
  try {
    const offerings = await Purchases.getOfferings();
    _packages = (offerings?.current?.availablePackages || [])
      .filter((p) => p?.product?.priceString && PLAN_TYPES.has(p.packageType));
    return _packages.map((p) => ({ type: String(p.packageType), price: p.product.priceString }));
  } catch (e) { console.error('[rc-native] offerings', e); return []; }
}

// RevenueCat error codes (PURCHASES_ERROR_CODE) we explain to the user. The
// Capacitor bridge rejects with { code: '<n>', message, data: { readableErrorCode,
// underlyingErrorMessage, userCancelled } }.
const ERROR_REASONS = {
  1: 'cancelled', 2: 'store', 3: 'not_allowed', 4: 'invalid', 5: 'not_available',
  6: 'already_owned', 7: 'already_owned', 10: 'network', 11: 'setup', 23: 'setup', 35: 'network',
};
export function purchaseErrorReason(e) {
  if (e?.data?.userCancelled || e?.userCancelled) return 'cancelled';
  return ERROR_REASONS[Number(e?.code)] || 'store';
}
function purchaseErrorDetail(e) {
  return String(e?.data?.underlyingErrorMessage || e?.message || e?.data?.readableErrorCode || '').slice(0, 160);
}

// Buy one plan ('ANNUAL' | 'MONTHLY' | 'LIFETIME') directly: Google Play's purchase sheet
// opens on top of #/pro. Falls back to the RevenueCat paywall only when the
// Offering couldn't be read (so the button is never a dead end).
export async function purchaseProPlan(type) {
  const Purchases = await configure();
  if (!Purchases) return { ok: false, reason: 'unavailable' };
  if (!_packages.length) await proPlanPrices();
  const pkg = _packages.find((p) => p.packageType === type) || _packages[0];
  if (!pkg) return presentProPaywall();
  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return { ok: true, active: !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID] };
  } catch (e) {
    console.error('[rc-native] purchasePackage', e);
    return { ok: false, reason: purchaseErrorReason(e), detail: purchaseErrorDetail(e) };
  }
}

// Restore previous purchases (App Store / Play require a visible "Restore").
export async function restorePurchases() {
  const Purchases = await configure();
  if (!Purchases) return false;
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  } catch (e) { console.error('[rc-native] restore', e); return false; }
}

// RevenueCat Customer Center — manage/cancel/refund, also Capacitor-supported.
export async function presentCustomerCenter() {
  await configure();
  const UI = plugin(UI_PLUGIN);
  if (!UI) return false;
  try { await UI.presentCustomerCenter(); return true; }
  catch (e) { console.error('[rc-native] customerCenter', e); return false; }
}
