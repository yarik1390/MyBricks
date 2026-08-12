/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { appBaseUrl, appLink, appHost, isAllowedOrigin, DEFAULT_APP_ORIGIN, PAGES_ORIGIN } from './lib/app-url';

const STAGING = 'https://staging.bricksvault.app';

describe('app-url', () => {
  describe('appBaseUrl', () => {
    it('defaults to the canonical domain when unset', () => {
      expect(appBaseUrl({} as any)).toBe(DEFAULT_APP_ORIGIN);
      expect(appBaseUrl({ APP_BASE_URL: '   ' } as any)).toBe(DEFAULT_APP_ORIGIN);
    });

    it('uses a configured https origin', () => {
      expect(appBaseUrl({ APP_BASE_URL: STAGING } as any)).toBe(STAGING);
    });

    it('strips a trailing slash so links never double up', () => {
      expect(appBaseUrl({ APP_BASE_URL: `${STAGING}/` } as any)).toBe(STAGING);
    });

    it('rejects anything that is not a bare https origin', () => {
      // A path, a scheme-less host or plain http would produce broken links in
      // emails we cannot recall, so fall back rather than propagate the mistake.
      for (const bad of [`${STAGING}/app`, 'bricksvault.app', 'http://bricksvault.app', 'javascript:alert(1)']) {
        expect(appBaseUrl({ APP_BASE_URL: bad } as any)).toBe(DEFAULT_APP_ORIGIN);
      }
    });
  });

  describe('appLink', () => {
    it('builds hash-router and path links without doubling separators', () => {
      const env = { APP_BASE_URL: STAGING } as any;
      expect(appLink(env, '#/set/75192-1')).toBe(`${STAGING}#/set/75192-1`);
      expect(appLink(env, '/methodology.html')).toBe(`${STAGING}/methodology.html`);
      expect(appLink(env, 'methodology.html')).toBe(`${STAGING}/methodology.html`);
      expect(appLink(env)).toBe(STAGING);
    });
  });

  it('appHost drops the scheme for display-only use', () => {
    expect(appHost({ APP_BASE_URL: STAGING } as any)).toBe('staging.bricksvault.app');
    expect(appHost({} as any)).toBe('bricksvault.app');
  });

  describe('isAllowedOrigin', () => {
    it('accepts the canonical domain by default', () => {
      expect(isAllowedOrigin(DEFAULT_APP_ORIGIN, {} as any)).toBe(true);
    });

    it('accepts the Pages origin alongside an override, since previews live there', () => {
      const env = { APP_BASE_URL: STAGING } as any;
      expect(isAllowedOrigin(STAGING, env)).toBe(true);
      expect(isAllowedOrigin(PAGES_ORIGIN, env)).toBe(true);
    });

    it('accepts preview deployments and local/native shells', () => {
      const env = {} as any;
      expect(isAllowedOrigin('https://abc123.brickvault-5ub.pages.dev', env)).toBe(true);
      expect(isAllowedOrigin('http://localhost:5173', env)).toBe(true);
      expect(isAllowedOrigin('capacitor://localhost', env)).toBe(true);
    });

    it('still refuses other Cloudflare Pages tenants', () => {
      // The pre-existing security-audit fix: never widen back to *.pages.dev.
      const env = { APP_BASE_URL: STAGING } as any;
      expect(isAllowedOrigin('https://evil.pages.dev', env)).toBe(false);
      expect(isAllowedOrigin('https://bricksvault.app.evil.com', env)).toBe(false);
      expect(isAllowedOrigin('https://notbricksvault.app', env)).toBe(false);
      expect(isAllowedOrigin('https://evil-brickvault-5ub.pages.dev', env)).toBe(false);
    });
  });
});
