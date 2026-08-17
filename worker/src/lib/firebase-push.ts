import type { Env } from '../types';
import { recordIntegrationHealth } from './integration-health';

interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface NativePushPayload {
  title: string;
  body: string;
  url?: string;
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
  projectId: string;
}

let cachedAccessToken: CachedAccessToken | null = null;

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodeJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function parseServiceAccount(raw?: string): FirebaseServiceAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FirebaseServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed as FirebaseServiceAccount;
  } catch {
    return null;
  }
}

export function firebasePushConfigured(env: Env): boolean {
  return parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON) !== null;
}

function privateKeyBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const raw = atob(body);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

async function createAssertion(account: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const claims = encodeJson({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function getAccessToken(account: FirebaseServiceAccount): Promise<string> {
  if (cachedAccessToken
    && cachedAccessToken.projectId === account.project_id
    && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const assertion = await createAssertion(account);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`Firebase OAuth failed (${response.status})`);
  const result = await response.json<{ access_token?: string; expires_in?: number }>();
  if (!result.access_token) throw new Error('Firebase OAuth returned no access token');
  cachedAccessToken = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(60, result.expires_in || 3600) * 1000,
    projectId: account.project_id,
  };
  return result.access_token;
}

function decodePayload(payload: string): NativePushPayload | null {
  try {
    const parsed = JSON.parse(payload) as Partial<NativePushPayload>;
    if (!parsed.title || !parsed.body) return null;
    return {
      title: String(parsed.title).slice(0, 120),
      body: String(parsed.body).slice(0, 500),
      url: parsed.url ? String(parsed.url).slice(0, 500) : '#/',
    };
  } catch {
    return null;
  }
}

function isDeadToken(status: number, responseText: string): boolean {
  return status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(responseText);
}

export async function sendNativePushToUser(env: Env, userId: string, payloadJson: string): Promise<void> {
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const payload = decodePayload(payloadJson);
  if (!account || !payload) return;

  const { results } = await env.DB.prepare(
    'SELECT token FROM native_push_tokens WHERE user_id=?',
  ).bind(userId).all<{ token: string }>();
  if (!results.length) return;

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account);
  } catch (error) {
    await recordIntegrationHealth(env, 'firebase', {
      ok: 0,
      fail: 1,
      lastError: error instanceof Error ? error.message : 'Firebase OAuth failed',
    });
    return;
  }
  let ok = 0;
  let fail = 0;
  let lastError: string | null = null;
  for (const row of results) {
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: row.token,
              notification: { title: payload.title, body: payload.body },
              data: { url: payload.url || '#/' },
              android: { priority: 'high' },
            },
          }),
        },
      );
      if (response.ok) {
        ok++;
      } else {
        fail++;
        const responseText = await response.text();
        lastError = `FCM HTTP ${response.status}`;
        if (isDeadToken(response.status, responseText)) {
          await env.DB.prepare('DELETE FROM native_push_tokens WHERE token=?').bind(row.token).run();
        }
      }
    } catch (error) {
      fail++;
      lastError = error instanceof Error ? error.message : 'FCM request failed';
      // Notification delivery is best-effort and must never fail the alert job.
    }
  }
  await recordIntegrationHealth(env, 'firebase', { ok, fail, lastError });
}
