// RevenueCat — native Google Play (and later Apple) billing.
//
// WHY THE BRIDGE, NOT AN IMPORT: Brickvault ships as unbundled ES modules, so we
// can't `import { Purchases } from '@revenuecat/purchases-capacitor'` (bare
// specifier won't resolve in the browser). Inside the Capacitor Android build the
// plugins are reachable through the Capacitor runtime bridge, so we grab them via
// `Capacitor.registerPlugin(name)`. On the web these functions are safe no-ops, so
// importing this module never affects the PWA.
//
// ⚠️ VERIFY ON-DEVICE: this code can't run in the browser. After
// `npm i @revenuecat/purchases-capacitor @revenuecat/purchases-capacitor-ui`
// and `npx cap sync android`, confirm the plugin names + method shapes below
// against node_modules/@revenuecat/purchases-capacitor*/dist/esm/index.js
// (look for the `registerPlugin('…')` calls) and RevenueCat's Capacitor docs.

import { getSessionUserId } from '../api.js';

// Entitlement identifier — must match the RevenueCat dashboard exactly.
const ENTITLEMENT_ID = 'BricksVault Pro';
// Capacitor plugin registration names (verify against the installed plugin).
const PURCHASES_PLUGIN = 'Purchases';
const UI_PLUGIN = 'RevenueCatUI';

let _configured = false;

export function isNativeBilling() {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  } catch { return false; }
}

function plugin(name) {
  try { return window.Capacitor?.registerPlugin?.(name) || window.Capacitor?.Plugins?.[name] || null; }
  catch { return null; }
}

// Configure once, keyed to the signed-in Supabase user so the entitlement follows
// the account (purchasing is gated behind login). Returns the Purchases plugin or null.
async function configure() {
  if (!isNativeBilling()) return null;
  const Purchases = plugin(PURCHASES_PLUGIN);
  const apiKey = window.RC_PLAY_BILLING_KEY;   // goog_… key, set in env.js
  const userId = getSessionUserId();
  if (!Purchases || !apiKey || !userId) return null;
  try {
    if (!_configured) {
      await Purchases.configure({ apiKey, appUserID: userId });
      _configured = true;
    } else {
      // Keep the RC identity in sync if the signed-in user changed.
      await Purchases.logIn?.({ appUserID: userId }).catch?.(() => {});
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
    await UI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: ENTITLEMENT_ID });
    const active = await nativeIsPro();
    return { ok: true, active };
  } catch (e) {
    console.error('[rc-native] presentPaywall', e);
    return { ok: false, reason: 'error' };
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
