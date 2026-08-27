import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// Push the latest vault totals to the Android home-screen widget. No-op on
// web/PWA. Values arrive pre-formatted (user currency) so the widget never
// needs rates or network. Fire-and-forget — a widget miss must never surface.
export function updateVaultWidget({ value, delta, deltaUp, sets, owner }) {
  try {
    if (!isNativeCapacitor()) return;
    const WidgetBridge = getCapacitorPlugin('WidgetBridge');
    if (!WidgetBridge?.updateWidget) return;
    WidgetBridge.updateWidget({
      value: String(value ?? '—'),
      delta: String(delta ?? ''),
      deltaUp: deltaUp !== false,
      sets: Number.isFinite(Number(sets)) ? Number(sets) : 0,
      owner: String(owner || ''),
    }).catch(() => {});
  } catch { /* widget is best-effort */ }
}

// Clear account-specific values before web auth/session state disappears. This
// returns a promise so sign-out and account deletion can wait for native state
// to be removed instead of racing navigation or process suspension.
export async function clearVaultWidget() {
  try {
    if (!isNativeCapacitor()) return;
    const WidgetBridge = getCapacitorPlugin('WidgetBridge');
    if (!WidgetBridge?.clearWidget) return;
    await WidgetBridge.clearWidget();
  } catch { /* widget is best-effort */ }
}
