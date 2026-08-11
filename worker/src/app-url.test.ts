/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { appBaseUrl, appLink, appHost, isAllowedOrigin, LEGACY_APP_ORIGIN } from './lib/app-url';

const NEW = 'https://bricksvault.app';

describe('app-url', () => {
  describe('appBaseUrl', () => {
    it('falls back to the origin the app shipped on when unset', () => {
      expect(appBaseUrl({} as any)).toBe(LEGACY_APP_ORIGIN);
      expect(appBaseUrl({ APP_BASE_URL: '   ' } as any)).toBe(LEGACY_APP_ORIGIN);
    });

    it('uses a configured https origin', () => {
      expect(appBaseUrl({ APP_BASE_URL: NEW } as any)).toBe(NEW);
    });

    it('strips a trailing slash so links never double up', () => {
      expect(appBaseUrl({ APP_BASE_URL: `${NEW}/` } as any)).toBe(NEW);
    });

    it('rejects anything that is not a bare https origin', () => {
      // A path, a scheme-less host or plain http would produce broken links in
      // emails we cannot recall, so fall back rather than propagate the mistake.
      for (const bad of [`${NEW}/app`, 'bricksvault.app', 'http://bricksvault.app', 'javascript:alert(1)']) {
        expect(appBaseUrl({ APP_BASE_URL: bad } as any)).toBe(LEGACY_APP_ORIGIN);
      }
    });
  });

  describe('appLink', () => {
    it('builds hash-router and path links without doubling separators', () => {
      const env = { APP_BASE_URL: NEW } as any;
      expect(appLink(env, '#/set/75192-1')).toBe(`${NEW}#/set/75192-1`);
      expect(appLink(env, '/methodology.html')).toBe(`${NEW}/methodology.html`);
      expect(appLink(env, 'methodology.html')).toBe(`${NEW}/methodology.html`);
      expect(appLink(env)).toBe(NEW);
    });
  });

  it('appHost drops the scheme for display-only use', () => {
    expect(appHost({ APP_BASE_URL: NEW } as any)).toBe('bricksvault.app');
  });

  describe('isAllowedOrigin', () => {
    it('accepts the legacy origin AND the configured one at the same time', () => {
      // The point of the migration design: a cutover must not strand tabs and
      // installed PWAs still on the old origin.
      const env = { APP_BASE_URL: NEW } as any;
      expect(isAllowedOrigin(LEGACY_APP_ORIGIN, env)).toBe(true);
      expect(isAllowedOrigin(NEW, env)).toBe(true);
    });

    it('accepts preview deployments and local/native shells', () => {
      const env = {} as any;
      expect(isAllowedOrigin('https://abc123.brickvault-5ub.pages.dev', env)).toBe(true);
      expect(isAllowedOrigin('http://localhost:5173', env)).toBe(true);
      expect(isAllowedOrigin('capacitor://localhost', env)).toBe(true);
    });

    it('still refuses other Cloudflare Pages tenants', () => {
      // The pre-existing security-audit fix: never widen back to *.pages.dev.
      const env = { APP_BASE_URL: NEW } as any;
      expect(isAllowedOrigin('https://evil.pages.dev', env)).toBe(false);
      expect(isAllowedOrigin('https://bricksvault.app.evil.com', env)).toBe(false);
      expect(isAllowedOrigin('https://notbricksvault.app', env)).toBe(false);
    });
  });
});
