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
    return !!r?.isAvailable;
  } catch {
    return false;
  }
}

// Prompt for biometric auth. Resolves true on success, false on cancel/failure.
// allowDeviceCredential lets the user fall back to their PIN/pattern, so a
// broken sensor can never lock them out of their own data.
export async function verifyBiometric(reason, win) {
  const bio = plugin(win);
  if (!bio?.authenticate) return false;
  try {
    await bio.authenticate({
      reason: reason || 'Unlock BricksVault',
      androidTitle: 'BricksVault',
      androidSubtitle: reason || 'Confirm it’s you',
      allowDeviceCredential: true,
      cancelTitle: 'Cancel',
    });
    return true;
  } catch {
    return false; // user cancelled or authentication failed
  }
}
