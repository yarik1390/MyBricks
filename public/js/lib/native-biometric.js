// Biometric (fingerprint / face) verification via @aparajita/capacitor-biometric-auth.
// Native app only — the plugin registers as `BiometricAuthNative`. Used by the
// app-lock (lib/app-lock.js): the app has guest use + persisted sessions, so
// "login with fingerprint" is really an optional lock that gates access to the
// app behind the device's biometrics.
import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

function plugin(win) {
  return getCapacitorPlugin('BiometricAuthNative', win);
}

// True when the device has usable biometrics (or, since we allow the device
// PIN/pattern as a fallback, at least a secure lock screen).
export async function biometricAvailable(win) {
  if (!isNativeCapacitor(win)) return false;
  const bio = plugin(win);
  if (!bio?.checkBiometry) return false;
  try {
    const r = await bio.checkBiometry();
    return !!(r?.isAvailable || r?.deviceIsSecure);
  } catch {
    return false;
  }
}

function friendlyBiometryError(error) {
  const code = String(error?.code || '');
  if (code === 'userCancel' || code === 'systemCancel' || code === 'appCancel') return 'Authentication canceled';
  if (code === 'biometryNotEnrolled') return 'Set up fingerprint or face unlock in Android settings first';
  if (code === 'passcodeNotSet' || code === 'noDeviceCredential') return 'Set up a device PIN, pattern, or password first';
  if (code === 'biometryLockout') return 'Biometrics are temporarily locked. Use your device PIN or try again later';
  if (code === 'biometryNotAvailable') return 'Biometric authentication is not available on this device';
  return error?.message ? String(error.message) : "Couldn't verify your identity";
}

export async function verifyBiometricResult(reason, win) {
  const bio = plugin(win);
  // Capacitor.Plugins exposes native @PluginMethod methods directly. The
  // package's public authenticate() wrapper is bundled JavaScript and is not
  // present there; its native counterpart is internalAuthenticate().
  const authenticate = bio?.authenticate || bio?.internalAuthenticate;
  if (typeof authenticate !== 'function') {
    return { ok: false, code: 'biometryNotAvailable', message: 'Biometric authentication is unavailable. Update BricksVault and try again' };
  }
  try {
    await authenticate.call(bio, {
      reason: reason || 'Unlock BricksVault',
      androidTitle: 'BricksVault',
      androidSubtitle: reason || 'Confirm it\u2019s you',
      allowDeviceCredential: true,
      androidConfirmationRequired: false,
    });
    return { ok: true, code: '', message: '' };
  } catch (error) {
    return { ok: false, code: String(error?.code || ''), message: friendlyBiometryError(error) };
  }
}

// Prompt for biometric auth. Resolves true on success, false on cancel/failure.
// allowDeviceCredential lets the user fall back to their PIN/pattern, so a
// broken sensor can never lock them out of their own data.
export async function verifyBiometric(reason, win) {
  return (await verifyBiometricResult(reason, win)).ok;
}
