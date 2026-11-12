// ---------------------------------------------------------------------------
// Cloudflare AI Gateway safety net.
//
// Server-key AI calls go through the gateway (caching, spend cap, analytics).
// When the gateway itself refuses the call (its "Authenticated Gateway" switch
// is on and AI_GATEWAY_TOKEN is missing or stale) it answers 401 with its own
// error code 2009. That 401 used to be recorded against the PROVIDER, so Admin
// said "Gemini needs a new key" and routing paused Gemini for 24 hours while
// the Gemini key was fine (2026-11-12). The gateway is an optional layer: when
// it refuses us, the same request goes straight to the provider instead.
// ---------------------------------------------------------------------------

const GATEWAY_PREFIX = /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[^/]+\/[^/]+\//;

const DIRECT_BASE: Record<string, string> = {
  'google-ai-studio': 'https://generativelanguage.googleapis.com/',
  openai: 'https://api.openai.com/v1/',
  openrouter: 'https://openrouter.ai/api/v1/',
};

/** The provider's own URL for a gateway URL, or null when it is not one we can map. */
export function gatewayDirectUrl(url: string): string | null {
  const m = GATEWAY_PREFIX.exec(url);
  if (!m) return null;
  const rest = url.slice(m[0].length);
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const base = DIRECT_BASE[rest.slice(0, slash)];
  return base ? base + rest.slice(slash + 1) : null;
}

/** True when the 401 came from the gateway's own auth, not from the provider. */
export async function isGatewayAuthRejection(url: string, resp: Response): Promise<boolean> {
  if (resp.status !== 401 || !GATEWAY_PREFIX.test(url)) return false;
  try {
    const body = await resp.clone().text();
    return /"code"\s*:\s*2009\b/.test(body);
  } catch {
    return false;
  }
}

/** Request init without the gateway-only headers (never sent to a provider). */
export function withoutGatewayHeaders(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('cf-aig-')) headers.delete(name);
  }
  return { ...init, headers };
}

let warnedAt = 0;
export function warnGatewayRejected(): void {
  if (Date.now() - warnedAt < 60_000) return;
  warnedAt = Date.now();
  console.warn('[ai-gateway] gateway refused the call (auth, code 2009): calling the provider directly. Check AI_GATEWAY_TOKEN or the gateway\'s Authenticated Gateway setting.');
}

/**
 * fetch() that retries directly against the provider when the gateway refuses
 * the call. Drop-in for the OpenAI SDK's `fetch` option and for plain fetch.
 */
export const gatewayFallbackFetch: typeof fetch = async (input, init) => {
  const resp = await fetch(input as RequestInfo, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
  if (!url || !(await isGatewayAuthRejection(url, resp))) return resp;
  const direct = gatewayDirectUrl(url);
  if (!direct) return resp;
  warnGatewayRejected();
  return fetch(direct, withoutGatewayHeaders(init));
};
