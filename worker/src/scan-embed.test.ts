/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import app from './index';
import { buildEmbedInput, extractVector, l2normalize, bytesToBase64 } from './lib/scan-embed';
import { allowedImageUrl } from './routes/admin-scan-vectors';

const originalAppFetch = app.fetch;
app.fetch = (request: any, e?: any, executionCtx?: any) => originalAppFetch(request, e, executionCtx || {
  waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {},
});

async function jwt(sub: string, secret: string) {
  const b64 = (o: any) => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
}

describe('scan-embed helpers', () => {
  it('builds each input shape and extracts vectors from common replies', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(buildEmbedInput('image_b64', bytes, 'image/jpeg')).toEqual({ image: bytesToBase64(bytes) });
    expect((buildEmbedInput('image_dataurl', bytes, 'image/png') as any).image).toMatch(/^data:image\/png;base64,/);
    const v = Array.from({ length: 32 }, (_, i) => i / 10);
    expect(extractVector({ data: [v] })).toEqual(v);
    expect(extractVector({ data: [{ embedding: v }] })).toEqual(v);
    expect(extractVector({ shape: [1, 32] })).toBeNull();
    const n = l2normalize([3, 4]);
    expect(n[0]).toBeCloseTo(0.6); expect(n[1]).toBeCloseTo(0.8);
  });

  it('only fetches images from catalog / test-photo hosts over https', () => {
    expect(allowedImageUrl('https://cdn.rebrickable.com/media/sets/75192-1.jpg')).not.toBeNull();
    expect(allowedImageUrl('http://cdn.rebrickable.com/x.jpg')).toBeNull();
    expect(allowedImageUrl('https://evil.example/x.jpg')).toBeNull();
    expect(allowedImageUrl('https://cdn.rebrickable.com.evil.example/x.jpg')).toBeNull();
  });
});

describe('POST /api/scan-vectors/embed', () => {
  const SECRET = 'test-secret-at-least-32-chars-long-and-super-secure';
  beforeEach(() => {
    (env as any).SUPABASE_JWT_SECRET = SECRET;
    (env as any).ADMIN_USER_ID = 'admin-1';
    (env as any).AI = { run: vi.fn(async () => ({ data: [Array.from({ length: 64 }, () => 1)] })) };
  });
  afterEach(() => vi.restoreAllMocks());

  it('is admin-only', async () => {
    const res = await app.fetch(new Request('http://x/api/scan-vectors/embed', {
      method: 'POST', headers: { Authorization: `Bearer ${await jwt('user-1', SECRET)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: ['https://cdn.rebrickable.com/media/sets/75192-1.jpg'] }),
    }), env);
    expect(res.status).toBe(403);
  });

  it('embeds allowed URLs and refuses others', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([9, 9, 9]), { headers: { 'content-type': 'image/jpeg' } }));
    const res = await app.fetch(new Request('http://x/api/scan-vectors/embed', {
      method: 'POST', headers: { Authorization: `Bearer ${await jwt('admin-1', SECRET)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: ['https://cdn.rebrickable.com/media/sets/75192-1.jpg', 'https://evil.example/a.jpg'] }),
    }), env);
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.results[0].vector).toHaveLength(64);
    expect(j.results[0].vector[0]).toBeCloseTo(1 / 8);
    expect(j.results[1]).toMatchObject({ vector: null, error: 'url not allowed' });
  });
});
