// Lazy loader for the camera scanner.
//
// scanner.js carries getUserMedia handling, barcode decoding, AI photo
// identification and the bulk-scan queue — heavy code only needed when the user
// actually scans. We defer its download/parse until openScan() is first called
// instead of pulling it into the initial app bundle.
//
// `closeScan()` is called by the router on every navigation. It's a no-op until
// the scanner module has been requested at least once: the scan overlay can
// only be open after openScan(), which loads the module.
let _mod = null;

function load() {
  return (_mod ||= import('./scanner.js'));
}

export function openScan(mode = 'barcode', options = {}) {
  return load().then(m => m.openScan(mode, options));
}

export function lookupScanInput(value) {
  return load().then(m => m.lookupScanInput(value));
}

export function closeScan() {
  if (!_mod) return; // never opened → nothing to close
  _mod.then(m => m.closeScan()).catch(() => {});
}

export function capturePhoto() {
  return load().then(m => m.capturePhoto());
}
