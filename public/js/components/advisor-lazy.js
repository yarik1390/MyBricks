// Lazy loader for the AI advisor (#/advisor).
//
// advisor.js carries the chat UI, markdown rendering, SSE streaming and the
// on-device AI fallback — heavy code that's only needed once the user opens the
// advisor. We defer its download/parse until first use instead of pulling it
// into the initial app bundle. The page loads it through here too, so
// cancelActiveStream() always sees the module that owns the stream.
//
// `cancelActiveStream()` is called by the router on every navigation. It's a
// no-op until the advisor module has been requested at least once: an active
// stream can only exist after the advisor was opened, which loads the module.
let _mod = null;

function load() {
  return (_mod ||= import('./advisor.js'));
}

export function toggleAdvisor() {
  return load().then(m => m.toggleAdvisor());
}

export function renderAdvisorPage() {
  return load().then(m => m.renderAdvisorPage());
}

export function cancelActiveStream() {
  if (!_mod) return; // never opened → no stream to cancel
  _mod.then(m => m.cancelActiveStream()).catch(() => {});
}
