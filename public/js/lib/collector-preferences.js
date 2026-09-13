// Device-only UI preferences, explicitly separated for each account and guests.
const PREFIX = 'bv_collector_ui_v1:';
export function readCollectorPreferences(owner, storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + (owner || 'guest')) || '{}');
    return {
      view: value?.view === 'room' ? 'room' : 'grid',
      pins: Array.isArray(value?.pins) ? value.pins.filter(x => typeof x === 'string').slice(0, 50) : [],
    };
  } catch { return { view: 'grid', pins: [] }; }
}
export function writeCollectorPreferences(owner, patch, storage = localStorage) {
  const next = { ...readCollectorPreferences(owner, storage), ...patch };
  try { storage.setItem(PREFIX + (owner || 'guest'), JSON.stringify(next)); return true; }
  catch { return false; }
}
