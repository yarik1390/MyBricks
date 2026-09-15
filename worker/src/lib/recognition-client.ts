export type RecognitionEnv = {
  RECOGNITION_API_URL?: string;
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
  RECOGNITION_ORIGIN_TOKEN?: string;
};

export type RecognitionValidationResult =
  | { ok: true; service: string; version: string }
  | { ok: false; reason: 'not_configured' | 'unavailable' };

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Probe the optional Core01 validation service.
 *
 * This client intentionally has no retry: the call is a non-essential backend
 * capability and must fail quickly without delaying unrelated Brickvault work.
 */
export async function callRecognitionValidation(
  env: RecognitionEnv,
  fetcher: typeof fetch = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RecognitionValidationResult> {
  const { RECOGNITION_API_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, RECOGNITION_ORIGIN_TOKEN } = env;
  if (!RECOGNITION_API_URL || !CF_ACCESS_CLIENT_ID || !CF_ACCESS_CLIENT_SECRET || !RECOGNITION_ORIGIN_TOKEN) {
    return { ok: false, reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL('/version', RECOGNITION_API_URL);
    const response = await fetcher(url, {
      method: 'GET',
      headers: {
        'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET,
        Authorization: `Bearer ${RECOGNITION_ORIGIN_TOKEN}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const payload = await response.json<{ service?: unknown; version?: unknown }>();
    if (typeof payload.service !== 'string' || typeof payload.version !== 'string') {
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, service: payload.service, version: payload.version };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}
