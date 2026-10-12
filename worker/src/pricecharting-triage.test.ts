/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { runPriceChartingTriage } from './jobs/pricecharting-triage';
import { decideQuarantinedMatch, namesAgree, parseTitleToken } from './lib/pricecharting-identity';
import { priceChartingTitleFits } from './lib/pricecharting';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

const row = (set_num: string | null, source_title: string, match_method = 'upc', match_confidence = 0.1) =>
  ({ source_item_id: 'p1', set_num, source_title, match_method, match_confidence });

describe('PriceCharting identity rules', () => {
  it('reads one set number from a provider title', () => {
    expect(parseTitleToken('The Frog House #21256')).toEqual({ explicit: null, base: '21256' });
    expect(parseTitleToken('Hero #662406-1')).toEqual({ explicit: '662406-1', base: '662406' });
    expect(parseTitleToken('Set #10001 and #10002').base).toBeNull();
  });

  it('compares names by words, tolerating extra words and near spellings', () => {
    expect(namesAgree('Cassette Player #6471611', 'Portable Cassette Player')).toBe(true);
    expect(namesAgree('Pneumatic Front End Loader #8459', 'Pneumatic Front-End Loader')).toBe(true);
    expect(namesAgree('Smart Play: Darth Vader\'s TIE Fighter #75421', 'Darth Vader’s TIE Fighter')).toBe(true);
    expect(namesAgree('The Frog House #21256', 'Stormtrooper Mech')).toBe(false);
    expect(namesAgree('VW Van #258', 'Zoo with Baseboard', true)).toBe(false);
    expect(namesAgree('Flexible and Straight Tracks #7499', 'Flexible Rails')).toBe(false);
    expect(namesAgree('Flexible and Straight Tracks #7499', 'Flexible Rails', true)).toBe(true);
  });

  it('re-points a contradicted barcode match to the set its title names', () => {
    expect(decideQuarantinedMatch(row('75370-1', 'The Frog House #21256'),
      { set_num: '75370-1', name: 'Stormtrooper Mech' }, [{ set_num: '21256-1', name: 'The Frog House' }]))
      .toMatchObject({ action: 'verify', set_num: '21256-1' });
  });

  it('keeps a candidate whose name agrees when the number is a shop item number', () => {
    expect(decideQuarantinedMatch(row('5007869-1', 'Cassette Player #6471611'),
      { set_num: '5007869-1', name: 'Portable Cassette Player' }, []))
      .toMatchObject({ action: 'verify', set_num: '5007869-1' });
  });

  it('rejects when neither the title number nor the candidate fits', () => {
    expect(decideQuarantinedMatch(row('72168-1', 'Requaza #384'),
      { set_num: '72168-1', name: 'Rayquaza' }, [{ set_num: '384-1', name: 'London Bus' }]))
      .toMatchObject({ action: 'reject' });
  });

  it('leaves several matching variants for a person, pointed at one of them', () => {
    expect(decideQuarantinedMatch(row('4000010-1', 'Jeep #330'), { set_num: '4000010-1', name: 'LEGO House' }, [
      { set_num: '330-1', name: 'Basic Building Set' }, { set_num: '330-3', name: 'Jeep' }, { set_num: '330-4', name: 'Jeep' },
    ])).toEqual({ action: 'keep', reason: 'several variants match the title', set_num: '330-3' });
  });

  it('never verifies a base-number candidate, but rejects a provable mismatch', () => {
    expect(decideQuarantinedMatch(row('1470-1', 'Shell Station #1470', 'base_candidate'),
      { set_num: '1470-1', name: 'Shell Station' }, [{ set_num: '1470-1', name: 'Shell Station' }]))
      .toMatchObject({ action: 'keep' });
    expect(decideQuarantinedMatch(row('258-1', 'VW Van #258', 'base_candidate'),
      { set_num: '258-1', name: 'Zoo with Baseboard' }, [{ set_num: '258-1', name: 'Zoo with Baseboard' }]))
      .toMatchObject({ action: 'reject' });
  });

  it('leaves rows a person parked and legacy copies alone', () => {
    expect(decideQuarantinedMatch(row('75370-1', 'The Frog House #21256', 'upc', 1),
      { set_num: '75370-1', name: 'Stormtrooper Mech' }, [{ set_num: '21256-1', name: 'The Frog House' }]))
      .toMatchObject({ action: 'keep', set_num: '21256-1' });
    expect(decideQuarantinedMatch(row('7951-1', 'XL Bucket', 'legacy_pc_id', 0.2),
      { set_num: '7951-1', name: 'XL Bucket' }, [])).toMatchObject({ action: 'keep' });
  });

  it('refuses a barcode lookup whose title names another set', () => {
    expect(priceChartingTitleFits('75370-1', 'Stormtrooper Mech', 'The Frog House #21256')).toBe(false);
    expect(priceChartingTitleFits('75370-1', 'Stormtrooper Mech', 'Stormtrooper Mech #75370')).toBe(true);
    expect(priceChartingTitleFits('5007869-1', 'Portable Cassette Player', 'Cassette Player #6471611')).toBe(true);
    expect(priceChartingTitleFits('10300-1', 'Back to the Future', 'Back to the Future Time Machine')).toBe(true);
  });
});

describe('runPriceChartingTriage', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'pricing_source_map', 'pricing_signals', 'app_settings']);
    await db.batch([
      db.prepare(`INSERT INTO lego_sets (set_num,name,pc_id,pc_new_value) VALUES ('75370-1','Stormtrooper Mech','6160891',52.72)`),
      db.prepare(`INSERT INTO lego_sets (set_num,name) VALUES ('21256-1','The Frog House'),('72168-1','Rayquaza'),('384-1','London Bus'),
        ('3562-1','NBA Collectors #3'),('3567-1','NBA Collectors #8'),('4572-1','Scratch')`),
      db.prepare(`INSERT INTO pricing_source_map (source,source_item_id,set_num,source_title,match_method,match_confidence,status,updated_at) VALUES
        ('pricecharting','6160891','75370-1','The Frog House #21256','upc',0.1,'quarantined','2026-10-12 06:16:33'),
        ('pricecharting','13982196','72168-1','Requaza #384','upc',0.1,'quarantined','2026-10-12 06:16:33'),
        ('pricecharting','5916371','3562-1','NBA Collectors #3567','upc',0.1,'quarantined','2026-10-12 06:16:33'),
        ('pricecharting','999','3567-1','NBA Collectors #8 Box','upc',1,'verified','2026-01-01'),
        ('pricecharting','legacy:4572-1','4572-1','Scratch','price_agreement',1,'quarantined','2026-10-11 04:30:59'),
        ('pricecharting','4572','4572-1','Scratch #4572','upc',1,'verified','2026-10-11 04:30:59')`),
      db.prepare(`INSERT INTO pricing_signals (set_num,source,source_item_id,provider_family,condition,signal_type,currency,value,source_observed_at,checked_at,match_status,flags_json,updated_at)
        VALUES ('75370-1','pricecharting','6160891','ebay_market','new_sealed','sold','USD',52.72,'2026-10-01','2026-10-01','quarantined','[]','2026-10-01')`),
    ]);
  });

  it('settles the queue: re-points, rejects, drops superseded keys and respects an owned set', async () => {
    const result = await runPriceChartingTriage(env as any);
    expect(result).toMatchObject({ scanned: 4, verified: 1, rejected: 2, dropped: 1, kept: 0 });

    const maps = await db.prepare(`SELECT source_item_id,set_num,status FROM pricing_source_map ORDER BY source_item_id`).all<any>();
    expect(maps.results).toEqual([
      { source_item_id: '13982196', set_num: null, status: 'rejected' },
      { source_item_id: '4572', set_num: '4572-1', status: 'verified' },
      // 3567-1 already has its own product, so the second one is turned away.
      { source_item_id: '5916371', set_num: null, status: 'rejected' },
      { source_item_id: '6160891', set_num: '21256-1', status: 'verified' },
      { source_item_id: '999', set_num: '3567-1', status: 'verified' },
    ]);
    // Stormtrooper Mech no longer carries Frog House prices anywhere.
    expect(await db.prepare(`SELECT pc_id,pc_new_value FROM lego_sets WHERE set_num='75370-1'`).first())
      .toEqual({ pc_id: null, pc_new_value: null });
    expect(await db.prepare(`SELECT count(*) AS n FROM pricing_signals`).first()).toEqual({ n: 0 });
  });

  it('dry run decides without writing, and the cursor makes a second run a no-op', async () => {
    const dry = await runPriceChartingTriage(env as any, { dryRun: true });
    expect(dry.decisions?.find((d) => d.source_item_id === '6160891')).toMatchObject({ action: 'verify', set_num: '21256-1' });
    expect(await db.prepare(`SELECT count(*) AS n FROM pricing_source_map WHERE status='quarantined'`).first()).toEqual({ n: 4 });

    await runPriceChartingTriage(env as any);
    expect(await runPriceChartingTriage(env as any)).toMatchObject({ scanned: 0 });
  });
});
