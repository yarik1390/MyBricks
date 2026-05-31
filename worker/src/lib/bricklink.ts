import type { Env } from '../types';

export interface BrickLinkPricing {
  current_value: number;
  lot_count: number;
}

async function oauthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  token: string,
  tokenSecret: string,
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };

  const all = { ...queryParams, ...oauth };
  const paramStr = Object.keys(all).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('&');

  const baseString = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(paramStr)].join('&');
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  oauth.oauth_signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  return 'OAuth ' + Object.entries(oauth)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');
}

export async function fetchSetPricing(setNum: string, env: Env): Promise<BrickLinkPricing | null> {
  if (!env.BRICKLINK_CONSUMER_KEY) return null;

  // BrickLink item numbers always include the variant suffix (e.g. "75192-1")
  const blNum = setNum.includes('-') ? setNum : `${setNum}-1`;

  try {
    const baseUrl = `https://api.bricklink.com/api/store/v1/price_guide/SET/${encodeURIComponent(blNum)}`;
    const queryParams = { guide_type: 'sold', new_or_used: 'N', country_code: 'US', currency_code: 'USD' };

    const authHeader = await oauthHeader(
      'GET', baseUrl, queryParams,
      env.BRICKLINK_CONSUMER_KEY, env.BRICKLINK_CONSUMER_SECRET,
      env.BRICKLINK_TOKEN, env.BRICKLINK_TOKEN_SECRET,
    );

    const resp = await fetch(`${baseUrl}?${new URLSearchParams(queryParams)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!resp.ok) return null;

    const body = await resp.json() as { meta?: { code: number }; data?: Record<string, unknown> };
    if (body.meta?.code !== 200 || !body.data) return null;

    const d = body.data;
    const lotCount = Number(d.unit_quantity ?? 0);
    if (lotCount < 5) return null; // require ≥5 sold lots for reliable pricing

    const current = parseFloat(String(d.qty_avg_price || d.avg_price || '')) || null;
    if (!current) return null;

    return { current_value: current, lot_count: lotCount };
  } catch {
    return null;
  }
}
