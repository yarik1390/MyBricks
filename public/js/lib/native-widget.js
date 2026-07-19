import { getCapacitorPlugin, isNativeCapacitor } from './native-auth.js';

// Push the latest vault totals to the Android home-screen widget. No-op on
// web/PWA. Values arrive pre-formatted (user currency) so the widget never
// needs rates or network. Fire-and-forget — a widget miss must never surface.
export function updateVaultWidget({ value, delta, deltaUp }) {
  try {
    if (!isNativeCapacitor()) return;
    const WidgetBridge = getCapacitorPlugin('WidgetBridge');
    if (!WidgetBridge?.updateWidget) return;
    WidgetBridge.updateWidget({
      value: String(value ?? '—'),
      delta: String(delta ?? ''),
      deltaUp: deltaUp !== false,
    }).catch(() => {});
  } catch { /* widget is best-effort */ }
}
