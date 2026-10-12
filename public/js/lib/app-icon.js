import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// Android launcher icon: the classic Vault Dial or the gold one (a Pro perk).
// Backed by AppIconPlugin, which enables one of two activity-aliases. On the
// web, or in an app build without the plugin, every call is a safe no-op.
function plugin() {
  try { return isNativeCapacitor() ? getCapacitorPlugin('AppIcon') : null; } catch { return null; }
}

export function appIconAvailable() {
  return !!plugin()?.set;
}

export async function getAppIcon() {
  try { return (await plugin()?.get?.())?.icon === 'gold' ? 'gold' : 'default'; } catch { return 'default'; }
}

export async function setAppIcon(icon) {
  try { return (await plugin()?.set?.({ icon: icon === 'gold' ? 'gold' : 'default' }))?.icon || null; } catch { return null; }
}

// The gold icon goes back to classic once Pro has lapsed.
export async function syncAppIconWithPro(isPro) {
  if (isPro || !appIconAvailable()) return;
  if (await getAppIcon() === 'gold') await setAppIcon('default');
}
