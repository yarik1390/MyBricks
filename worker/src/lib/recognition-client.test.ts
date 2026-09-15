import { describe, expect, it, vi } from 'vitest';
import { callRecognitionValidation } from './recognition-client';

const env = {
  RECOGNITION_API_URL: 'https://recognition-api.bricksvault.app',
  CF_ACCESS_CLIENT_ID: 'client-id',
  CF_ACCESS_CLIENT_SECRET: 'client-secret',
  RECOGNITION_ORIGIN_TOKEN: 'origin-token',
};

describe('callRecognitionValidation', () => {
  it('sends both Cloudflare Access and origin authorization credentials', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('CF-Access-Client-Id')).toBe('client-id');
      expect(headers.get('CF-Access-Client-Secret')).toBe('client-secret');
      expect(headers.get('Authorization')).toBe('Bearer origin-token');
      return new Response(JSON.stringify({ service: 'recognition-validation', version: 'validation-1.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(callRecognitionValidation(env, fetcher)).resolves.toEqual({
      ok: true,
      service: 'recognition-validation',
      version: 'validation-1.0.0',
    });
  });

  it('is disabled unless every required binding is present', async () => {
    const fetcher = vi.fn();
    await expect(callRecognitionValidation({}, fetcher)).resolves.toEqual({ ok: false, reason: 'not_configured' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed and does not expose upstream response details', async () => {
    const fetcher = vi.fn(async () => new Response('sensitive upstream text', { status: 503 }));
    await expect(callRecognitionValidation(env, fetcher)).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('times out without retrying the validation call', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const result = callRecognitionValidation(env, fetcher, 25);
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
