/**
 * VAPID Web Push for Cloudflare Workers.
 *
 * Implements RFC 8291 (Message Encryption) and RFC 8292 (VAPID) using
 * Web Crypto API — no Node.js dependencies.
 */

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function concat(...arrays: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function hkdfExpand(
  prk: CryptoKey,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const _enc = new TextEncoder();
  const okm = await crypto.subtle.sign('HMAC', prk, concat(info, new Uint8Array([1])));
  return new Uint8Array(okm).slice(0, length);
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const saltKey = await crypto.subtle.importKey('raw', salt as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm as BufferSource));
  const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hkdfExpand(prkKey, info, length);
}

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// Accepts either a PKCS8 private key (from generateVapidKeys below) or a raw
// 32-byte EC scalar (the format `npx web-push generate-vapid-keys` produces).
// For raw keys the x/y coordinates come from the uncompressed public key point.
async function importVapidPrivateKey(privB64: string, pubB64: string): Promise<CryptoKey> {
  const priv = b64urlDecode(privB64);
  if (priv.length === 32) {
    const pub = b64urlDecode(pubB64); // 65 bytes: 0x04 || x(32) || y(32)
    const jwk = {
      kty: 'EC', crv: 'P-256',
      d: privB64.replace(/=+$/, ''),
      x: b64url(pub.slice(1, 33)),
      y: b64url(pub.slice(33, 65)),
    };
    return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return crypto.subtle.importKey('pkcs8', priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

export async function sendWebPush(
  sub: PushSubscription,
  payload: string,
  vapidPrivateKeyB64: string,
  vapidPublicKeyB64: string,
  subject: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const endpointOrigin = new URL(sub.endpoint).origin;

  // --- VAPID JWT ---
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const now = Math.floor(Date.now() / 1000);
  const claims = b64url(enc.encode(JSON.stringify({ aud: endpointOrigin, exp: now + 43200, sub: subject })));
  const sigInput = `${header}.${claims}`;

  const vapidKey = await importVapidPrivateKey(vapidPrivateKeyB64, vapidPublicKeyB64);
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapidKey,
    enc.encode(sigInput),
  );
  const jwt = `${sigInput}.${b64url(sigBuf)}`;
  const vapidPublicKeyHeader = vapidPublicKeyB64.replace(/[+/]/g, c => c === '+' ? '-' : '_').replace(/=+$/, '');

  // --- RFC 8291 content encryption ---
  const recipientPublicKey = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);

  const senderKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const senderPublicKeyBuf = await crypto.subtle.exportKey('raw', senderKeyPair.publicKey) as ArrayBuffer;

  const recipientKey = await crypto.subtle.importKey(
    'raw', recipientPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, [],
  );
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    // Runtime reads `public` (standard WebCrypto); workers-types declares it
    // as `$public` (reserved-word escaping). Set both so either resolves.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { name: 'ECDH', public: recipientKey, $public: recipientKey } as any,
    senderKeyPair.privateKey,
    256,
  ));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK_key
  const keyInfo = concat(enc.encode('WebPush: info\0'), recipientPublicKey, new Uint8Array(senderPublicKeyBuf));
  const prkKey = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // CEK and nonce
  const cekInfo = enc.encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = enc.encode('Content-Encoding: nonce\0');
  const cek = await hkdf(salt, prkKey, cekInfo, 16);
  const nonce = await hkdf(salt, prkKey, nonceInfo, 12);

  const cekKey = await crypto.subtle.importKey('raw', cek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = enc.encode(payload);
  // RFC 8291: pad to multiple of 2, add one 0x02 padding delimiter byte
  const paddedContent = new Uint8Array(plaintext.length + 1);
  paddedContent.set(plaintext);
  paddedContent[plaintext.length] = 0x02;

  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, tagLength: 128 },
    cekKey,
    paddedContent,
  ));

  // RFC 8291 header: salt(16) + rs(4, big-endian) + keyidlen(1) + sender_public_key
  const senderPub = new Uint8Array(senderPublicKeyBuf);
  const rs = ciphertext.length + 1; // record size
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, rs, false);
  const header891 = concat(salt, rsBytes, new Uint8Array([senderPub.length]), senderPub);
  const body = concat(header891, ciphertext);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt},k=${vapidPublicKeyHeader}`,
    },
    body,
  });

  return res.ok || res.status === 201;
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  ) as CryptoKeyPair;
  const pub = b64url(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const priv = b64url(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer);
  return { publicKey: pub, privateKey: priv };
}
