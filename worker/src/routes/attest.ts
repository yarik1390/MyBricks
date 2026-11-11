import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import {
  decodeIntegrityToken, integrityProblem, issueAttestation, issueNonce, nonceValid, playIntegrityConfigured,
} from '../lib/play-integrity';

// Play Integrity attestation for the Android app (see lib/play-integrity.ts).
export const attestRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

attestRoute.post('/nonce', requireMember, async (c) => {
  if (!playIntegrityConfigured(c.env)) return c.json({ enabled: false });
  return c.json({ enabled: true, nonce: await issueNonce(c.env, c.get('userId')) });
});

attestRoute.post('/android', requireMember, async (c) => {
  if (!playIntegrityConfigured(c.env)) return c.json({ enabled: false }, 404);
  const userId = c.get('userId');
  const body = await c.req.json<{ token?: unknown }>().catch(() => ({} as { token?: unknown }));
  const token = typeof body.token === 'string' && body.token.length < 8000 ? body.token : '';
  if (!token) return c.json({ error: 'missing token' }, 400);
  const payload = await decodeIntegrityToken(c.env, token);
  if (!payload) return c.json({ error: 'could not verify' }, 502);
  if (!(await nonceValid(c.env, userId, payload.requestDetails?.nonce))) return c.json({ error: 'stale nonce' }, 403);
  const problem = integrityProblem(payload);
  if (problem) {
    console.warn(`[attest] rejected: ${problem}`);
    return c.json({ error: 'integrity check failed' }, 403);
  }
  return c.json({ attested: true, ...(await issueAttestation(c.env, userId)) });
});
