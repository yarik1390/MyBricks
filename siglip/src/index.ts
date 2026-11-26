import { Container } from '@cloudflare/containers';

/**
 * bricksvault-siglip: SigLIP image embeddings for BricksVault photo scans.
 * Reachable only through the SIGLIP service binding of brickvault-api (no
 * workers.dev URL, no routes). Requests are spread over a few container
 * instances; each sleeps after 15 idle minutes.
 */
export class SiglipContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '15m';
  enableInternet = true;
}

interface Env {
  SIGLIP_CONTAINER: DurableObjectNamespace<SiglipContainer>;
}

const INSTANCES = 4;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Scans use instance 0 (kept warm by traffic); the backfill spreads over all.
    const n = url.pathname === '/embed' && request.headers.get('X-Siglip-Lane') === 'bulk'
      ? Math.floor(Math.random() * INSTANCES)
      : 0;
    const stub = env.SIGLIP_CONTAINER.get(env.SIGLIP_CONTAINER.idFromName(`instance-${n}`));
    return stub.fetch(request);
  },
};
