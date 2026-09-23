// Device-only UI preferences, explicitly separated for each account and guests.
// `layout` is the Vault Sets tab's List | Grid choice (Room is a route, not a
// layout); `view` records the last collection view link used.
const PREFIX = 'bv_collector_ui_v1:';
export function readCollectorPreferences(owner, storage = localStorage) {
  try {
    const value = JSON.parse(storage.getItem(PREFIX + (owner || 'guest')) || '{}');
    return {
      view: value?.view === 'room' ? 'room' : 'grid',
      layout: value?.layout === 'grid' ? 'grid' : 'list',
      pins: Array.isArray(value?.pins) ? value.pins.filter(x => typeof x === 'string').slice(0, 50) : [],
    };
  } catch { return { view: 'grid', layout: 'list', pins: [] }; }
}
export function writeCollectorPreferences(owner, patch, storage = localStorage) {
  const next = { ...readCollectorPreferences(owner, storage), ...patch };
  try { storage.setItem(PREFIX + (owner || 'guest'), JSON.stringify(next)); return true; }
  catch { return false; }
}
