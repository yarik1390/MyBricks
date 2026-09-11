import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAdminIssues } from '../../public/js/lib/admin-issues.js';

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const fresh = '2026-09-11T11:30:00.000Z';
const stale = '2026-09-08T12:00:00.000Z';

function diagnostic(service, overrides = {}) {
  return {
    service,
    label: service,
    configured: true,
    reachable: true,
    degraded: false,
    status: 'ok',
    last_checked_at: fresh,
    last_ok_at: fresh,
    last_fail_at: null,
    ...overrides,
  };
}

describe('buildAdminIssues', () => {
  it('uses production-shaped source config when diagnostics omit enabled', () => {
    const issues = buildAdminIssues({
      diagnostics: [
        diagnostic('brickpicker', { reachable: false, status: 'down', last_fail_at: fresh }),
        diagnostic('bricklink', { reachable: false, status: 'down', last_fail_at: fresh }),
      ],
      sourceConfig: {
        brickpicker: { enabled: false, weight: 0.5, dailyCap: 900, refreshDays: 14 },
        bricklink: { enabled: true, weight: 1, dailyCap: 4000, refreshDays: 14 },
      },
      now: NOW,
    });

    assert.deepEqual(issues.map(({ service, kind }) => ({ service, kind })), [
      { service: 'bricklink', kind: 'error' },
    ]);
  });

  it('does not assume an opt-in tunable source is enabled while config is unknown', () => {
    const issues = buildAdminIssues({
      diagnostics: [
        diagnostic('brickpicker', { reachable: false, status: 'down', last_fail_at: fresh }),
      ],
      now: NOW,
    });

    assert.deepEqual(issues, []);
  });

  it('never reports an outage for an explicitly disabled status or feature flag', () => {
    const issues = buildAdminIssues({
      diagnostics: [
        diagnostic('ebay', { reachable: false, status: 'down', last_fail_at: fresh }),
        diagnostic('amazon', { reachable: false, status: 'disabled', last_fail_at: fresh }),
      ],
      featureFlags: { ebay_sold_comps: false },
      now: NOW,
    });

    assert.deepEqual(issues, []);
  });

  it('requires a valid current observation before reporting runtime failures', () => {
    const future = '2026-09-12T12:00:00.000Z';
    const issues = buildAdminIssues({
      diagnostics: [
        diagnostic('amazon', { reachable: false, status: 'down', last_checked_at: null, last_fail_at: fresh }),
        diagnostic('bricklink', { reachable: false, status: 'down', last_checked_at: 'not-a-date', last_fail_at: fresh, last_error: 'HTTP 403' }),
        diagnostic('openai', { degraded: true, status: 'degraded', last_checked_at: future }),
      ],
      now: NOW,
    });

    assert.deepEqual(issues.map(({ service, kind, evidenceAt }) => ({ service, kind, evidenceAt })), [
      { service: 'amazon', kind: 'unknown', evidenceAt: null },
      { service: 'bricklink', kind: 'unknown', evidenceAt: null },
      { service: 'openai', kind: 'unknown', evidenceAt: null },
    ]);
  });

  it('does not let updated_at freshen an old observation', () => {
    const issues = buildAdminIssues({
      diagnostics: [diagnostic('bricklink', {
        reachable: false,
        status: 'down',
        last_checked_at: stale,
        last_fail_at: stale,
        updated_at: fresh,
      })],
      now: NOW,
    });

    assert.deepEqual(issues.map(({ kind, evidenceAt }) => ({ kind, evidenceAt })), [
      { kind: 'stale', evidenceAt: stale },
    ]);
  });

  it('separates stale observations from unknown evidence', () => {
    const issues = buildAdminIssues({
      diagnostics: [
        diagnostic('bricklink', { status: 'unknown', reachable: null, last_checked_at: stale, last_ok_at: stale }),
        diagnostic('d1', { status: 'unknown', reachable: null, last_checked_at: null, last_ok_at: null }),
      ],
      now: NOW,
    });

    assert.deepEqual(issues.map(({ service, kind, evidenceAt }) => ({ service, kind, evidenceAt })), [
      { service: 'bricklink', kind: 'stale', evidenceAt: stale },
      { service: 'd1', kind: 'unknown', evidenceAt: null },
    ]);
    assert.equal(issues[0].href, '#/me/admin?hub=pricing&view=center');
  });

  it('returns an unknown issue instead of claiming health when evidence is missing', () => {
    const issues = buildAdminIssues({ diagnostics: null, now: NOW });

    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'unknown');
    assert.match(issues[0].title, /unavailable/i);
  });

  it('prioritizes deterministically and bounds the result', () => {
    const issues = buildAdminIssues({
      diagnostics: [
        diagnostic('brickowl', { status: 'unknown', reachable: null, last_checked_at: null }),
        diagnostic('openai', { status: 'degraded', degraded: true }),
        diagnostic('ebay', { status: 'down', reachable: false, last_fail_at: fresh }),
        diagnostic('bricklink', { configured: true, status: 'down', reachable: false, last_fail_at: fresh, last_error: 'HTTP 403 secret detail' }),
        diagnostic('amazon', { status: 'down', reachable: false, last_fail_at: fresh }),
      ],
      featureFlags: { ebay_sold_comps: true },
      now: NOW,
      maxIssues: 4,
    });

    assert.deepEqual(issues.map((issue) => `${issue.kind}:${issue.service}`), [
      'access:bricklink',
      'error:amazon',
      'error:ebay',
      'degraded:openai',
    ]);
    assert.equal(issues[3].href, '#/me/admin?hub=ai');
    assert.ok(issues.every((issue) => !JSON.stringify(issue).includes('secret detail')));
  });
});
