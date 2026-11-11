import { describe, expect, it } from 'vitest';
import type { Env } from './types';
import {
  attestationValid, integrityProblem, issueAttestation, issueNonce, nonceValid, playIntegrityConfigured, playIntegrityEnforced,
} from './lib/play-integrity';

const env = { SUPABASE_JWT_SECRET: 'test-secret' } as unknown as Env;
const configured = { ...env, PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'a@b', private_key: 'k' }) } as Env;

describe('play integrity attestation', () => {
  it('is off until a service account is configured, enforced only with the switch', () => {
    expect(playIntegrityConfigured(env)).toBe(false);
    expect(playIntegrityConfigured(configured)).toBe(true);
    expect(playIntegrityEnforced(configured)).toBe(false);
    expect(playIntegrityEnforced({ ...configured, PLAY_INTEGRITY_ENFORCED: '1' } as Env)).toBe(true);
    expect(playIntegrityEnforced({ ...env, PLAY_INTEGRITY_ENFORCED: '1' } as Env)).toBe(false);
  });

  it('binds nonces to the user and expires them', async () => {
    const now = Date.now();
    const nonce = await issueNonce(env, 'user-1', now);
    expect(nonce.length).toBeGreaterThanOrEqual(16);
    expect(nonce).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(await nonceValid(env, 'user-1', nonce, now)).toBe(true);
    expect(await nonceValid(env, 'user-2', nonce, now)).toBe(false);
    expect(await nonceValid(env, 'user-1', nonce, now + 11 * 60_000)).toBe(false);
    expect(await nonceValid(env, 'user-1', `${nonce}x`, now)).toBe(false);
    expect(await nonceValid(env, 'user-1', undefined, now)).toBe(false);
  });

  it('issues attestations that only hold for the same user until expiry', async () => {
    const now = Date.now();
    const { token } = await issueAttestation(env, 'user-1', now);
    expect(await attestationValid(env, 'user-1', token, now)).toBe(true);
    expect(await attestationValid(env, 'user-2', token, now)).toBe(false);
    expect(await attestationValid(env, 'user-1', token, now + 25 * 3600_000)).toBe(false);
    expect(await attestationValid(env, 'user-1', 'forged.sig', now)).toBe(false);
    expect(await attestationValid(env, undefined, token, now)).toBe(false);
  });

  it('accepts only the Play-recognized app on a device with integrity', () => {
    const ok = {
      requestDetails: { requestPackageName: 'app.bricksvault', nonce: 'n' },
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    };
    expect(integrityProblem(ok)).toBeNull();
    expect(integrityProblem({ ...ok, requestDetails: { requestPackageName: 'evil.app' } })).toBe('wrong package');
    expect(integrityProblem({ ...ok, appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } })).toMatch(/^app/);
    expect(integrityProblem({ ...ok, deviceIntegrity: { deviceRecognitionVerdict: [] } })).toBe('device integrity');
    expect(integrityProblem(null)).toBe('no payload');
  });
});
