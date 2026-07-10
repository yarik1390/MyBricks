// Injected by CI. When Pages and the Worker share a domain this stays empty.
// Pages deployment rewrites this file with the deployed Worker URL. The native
// bundle needs an absolute fallback because its own origin is https://localhost.
window.WORKER_BASE = 'https://brickvault-api.zhydenko.workers.dev';
