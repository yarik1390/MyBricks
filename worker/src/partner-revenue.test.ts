/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTestTables } from './test-schema';
import {
  recordPartnerRevenueEvent,
  partnerRevenueStatus,
  PARTNER_COMMERCIAL_THRESHOLD_USD,
} from './lib/partner-revenue';

const db = (env as any).DB as D1Database;

// PriceCharting's free-use permission ends at $1,000/month of app revenue.
// The meter exists so that trigger is detected, not discovered late — so these
// tests pin dedupe, the no-guessing rule for missing/FX amounts, and the
// boundary itself.
describe('partner revenue meter', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['partner_revenue_events']);
  });

  const thisMonth = () => new Date().toISOString().slice(0, 7);

  it('sums this month only and ignores amounts we never received', async () => {
    const month = thisMonth();
    await recordPartnerRevenueEvent(db, { eventId: 'e1', eventType: 'INITIAL_PURCHASE', amount: 400, currency: 'USD', eventAt: `${month}-02T10:00:00Z` });
    await recordPartnerRevenueEvent(db, { eventId: 'e2', eventType: 'RENEWAL', amount: 250.5, currency: 'USD', eventAt: `${month}-09T10:00:00Z` });
    // A missing amount is NOT zero revenue and must not be counted as money.
    await recordPartnerRevenueEvent(db, { eventId: 'e3', eventType: 'NON_RENEWING_PURCHASE', amount: null, currency: 'USD', eventAt: `${month}-10T10:00:00Z` });
    // Previous month must not leak in.
    await recordPartnerRevenueEvent(db, { eventId: 'e4', eventType: 'RENEWAL', amount: 9000, currency: 'USD', eventAt: '2020-01-15T10:00:00Z' });

    const status = await partnerRevenueStatus(db, month);
    expect(status.usd).toBe(650.5);
    expect(status.exceeded).toBe(false);
    expect(status.remaining_usd).toBeCloseTo(349.5, 2);
    expect(status.events_counted).toBe(3);
  });

  it('counts a redelivered webhook once', async () => {
    const month = thisMonth();
    const event = { eventId: 'dup-1', eventType: 'INITIAL_PURCHASE' as const, amount: 100, currency: 'USD', eventAt: `${month}-03T10:00:00Z` };
    await recordPartnerRevenueEvent(db, event);
    await recordPartnerRevenueEvent(db, event);
    expect((await partnerRevenueStatus(db, month)).usd).toBe(100);
  });

  it('subtracts refunds and deduplicates a redelivered refund', async () => {
    const month = thisMonth();
    await recordPartnerRevenueEvent(db, { eventId: 'buy-1', eventType: 'INITIAL_PURCHASE', amount: 100, currency: 'USD', eventAt: `${month}-03T09:00:00Z` });
    const refund = { eventId: 'refund-1', eventType: 'REFUND' as const, amount: 40, currency: 'USD', eventAt: `${month}-03T10:00:00Z` };
    await recordPartnerRevenueEvent(db, refund);
    await recordPartnerRevenueEvent(db, refund);
    const status = await partnerRevenueStatus(db, month);
    expect(status.usd).toBe(60);
    expect(status.events_counted).toBe(2);
  });

  it('reports non-USD amounts separately instead of converting at a made-up rate', async () => {
    const month = thisMonth();
    await recordPartnerRevenueEvent(db, { eventId: 'fx1', eventType: 'RENEWAL', amount: 500, currency: 'EUR', eventAt: `${month}-04T10:00:00Z` });
    const status = await partnerRevenueStatus(db, month);
    expect(status.usd).toBe(0);
    expect(status.non_usd_events).toBe(1);
  });

  it('fires exactly at the commercial-agreement threshold', async () => {
    const month = thisMonth();
    await recordPartnerRevenueEvent(db, { eventId: 't1', eventType: 'RENEWAL', amount: PARTNER_COMMERCIAL_THRESHOLD_USD - 0.01, currency: 'USD', eventAt: `${month}-05T10:00:00Z` });
    expect((await partnerRevenueStatus(db, month)).exceeded).toBe(false);
    await recordPartnerRevenueEvent(db, { eventId: 't2', eventType: 'RENEWAL', amount: 0.01, currency: 'USD', eventAt: `${month}-05T11:00:00Z` });
    const status = await partnerRevenueStatus(db, month);
    expect(status.usd).toBe(PARTNER_COMMERCIAL_THRESHOLD_USD);
    expect(status.exceeded).toBe(true);
    expect(status.remaining_usd).toBe(0);
  });
});
