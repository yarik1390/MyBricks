import type { Env } from '../types';
import {
  decideQuarantinedMatch, parseTitleToken,
  type CatalogSet, type QuarantinedMatch, type TriageDecision,
} from '../lib/pricecharting-identity';

/**
 * Settle the PriceCharting "Quarantined source matches" queue automatically.
 *
 * Each quarantined product is re-pointed to the set its title names, kept on its
 * candidate when only the names agree, or rejected when it is provably another
 * product (lib/pricecharting-identity.ts holds the rules). Rows the rules cannot
 * decide (several variants match, legacy pc_id copies) stay quarantined for a
 * human. A cursor over updated_at means each row is looked at once until the
 * bulk import touches it again, so the hourly run costs one SELECT when idle.
 */

const CURSOR_KEY = 'pc_triage_cursor';
const DEFAULT_LIMIT = 1000;
const BATCH = 50;

export interface TriageResult {
  scanned: number;
  verified: number;
  manual: number;
  rejected: number;
  dropped: number;
  kept: number;
  decisions?: Array<{ source_item_id: string; from: string | null; title: string | null } & TriageDecision>;
}

export async function runPriceChartingTriage(
  env: Env,
  options: { limit?: number; dryRun?: boolean; all?: boolean } = {},
): Promise<TriageResult> {
  const limit = Math.min(Math.max(Number(options.limit) || DEFAULT_LIMIT, 1), 5000);
  const cursor = options.all ? '' : ((await env.DB.prepare(`SELECT value FROM app_settings WHERE key=?1`)
    .bind(CURSOR_KEY).first<{ value: string }>())?.value || '');

  const select = `SELECT source_item_id, set_num, source_title, match_method, match_confidence, updated_at
    FROM pricing_source_map WHERE source='pricecharting' AND status='quarantined'`;
  const first = await env.DB.prepare(`${select} AND updated_at > ?1 ORDER BY updated_at ASC, source_item_id ASC LIMIT ?2`)
    .bind(cursor, limit).all<QuarantinedMatch & { updated_at: string }>();
  let rows = first.results || [];
  const result: TriageResult = { scanned: 0, verified: 0, manual: 0, rejected: 0, dropped: 0, kept: 0 };
  if (!rows.length) return result;
  // Never split one updated_at across two runs: the cursor would skip the rest.
  const last = rows[rows.length - 1].updated_at;
  if (rows.length === limit) {
    const tail = await env.DB.prepare(`${select} AND updated_at = ?1`).bind(last)
      .all<QuarantinedMatch & { updated_at: string }>();
    const seen = new Set(rows.map((r) => r.source_item_id));
    rows = rows.concat((tail.results || []).filter((r) => !seen.has(r.source_item_id)));
  }
  result.scanned = rows.length;

  // Catalog lookups for candidates, explicit title tokens and title base numbers.
  const exact = new Set<string>();
  const bases = new Set<string>();
  for (const row of rows) {
    if (row.set_num) exact.add(row.set_num);
    const token = parseTitleToken(row.source_title);
    if (token.explicit) exact.add(token.explicit);
    else if (token.base) bases.add(token.base);
  }
  const catalog = new Map<string, CatalogSet>();
  const byBase = new Map<string, CatalogSet[]>();
  if (exact.size) {
    const { results } = await env.DB.prepare(`SELECT set_num, name FROM lego_sets
      WHERE set_num IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify([...exact])).all<CatalogSet>();
    for (const s of results || []) catalog.set(s.set_num, s);
  }
  if (bases.size) {
    // Range scan on the primary key: "21256-" <= set_num < "21256." ('.' follows '-').
    const { results } = await env.DB.prepare(`SELECT j.value AS base, ls.set_num, ls.name
      FROM json_each(?1) j JOIN lego_sets ls ON ls.set_num >= j.value || '-' AND ls.set_num < j.value || '.'`)
      .bind(JSON.stringify([...bases])).all<CatalogSet & { base: string }>();
    for (const s of results || []) {
      if (!/^\d+$/.test(s.set_num.slice(s.base.length + 1))) continue;
      const list = byBase.get(s.base) || [];
      list.push({ set_num: s.set_num, name: s.name });
      byBase.set(s.base, list);
    }
  }

  const decided = rows.map((row) => {
    const token = parseTitleToken(row.source_title);
    const titleSets = token.explicit
      ? (catalog.get(token.explicit) ? [catalog.get(token.explicit)!] : [])
      : (token.base ? byBase.get(token.base) || [] : []);
    const candidate = row.set_num ? catalog.get(row.set_num) || null : null;
    return { row, decision: decideQuarantinedMatch(row, candidate, titleSets) };
  });

  // A set already linked to another real product keeps that link: two products
  // on one set would overwrite each other's signals every run.
  const targets = [...new Set(decided.flatMap(({ decision }) =>
    decision.action === 'verify' || decision.action === 'manual' ? [decision.set_num] : []))];
  const claimed = new Map<string, string>();
  if (targets.length) {
    const { results } = await env.DB.prepare(`SELECT set_num, source_item_id FROM pricing_source_map
      WHERE source='pricecharting' AND status IN ('verified','manual') AND source_item_id NOT LIKE 'legacy:%'
        AND set_num IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(targets))
      .all<{ set_num: string; source_item_id: string }>();
    for (const r of results || []) claimed.set(r.set_num, r.source_item_id);
  }
  for (const entry of decided) {
    const d = entry.decision;
    if (d.action !== 'verify' && d.action !== 'manual') continue;
    const owner = claimed.get(d.set_num);
    if (owner && owner !== entry.row.source_item_id) {
      entry.decision = { action: 'reject', reason: `set already linked to product ${owner}` };
    } else {
      claimed.set(d.set_num, entry.row.source_item_id);
    }
  }

  const stmts: D1PreparedStatement[] = [];
  for (const { row, decision } of decided) {
    result[({ verify: 'verified', manual: 'manual', reject: 'rejected', drop: 'dropped', keep: 'kept' } as const)[decision.action]]++;
    if (options.dryRun || (decision.action === 'keep' && !decision.set_num)) continue;
    const id = row.source_item_id;
    if (decision.action === 'drop') {
      // Same rule pricecharting-enrich applies when a real id supersedes one.
      stmts.push(env.DB.prepare(`DELETE FROM pricing_source_map WHERE source='pricecharting'
        AND source_item_id=?1 AND status='quarantined' AND EXISTS (SELECT 1 FROM pricing_source_map real
          WHERE real.source='pricecharting' AND real.set_num=pricing_source_map.set_num
            AND real.status IN ('verified','manual') AND real.source_item_id NOT LIKE 'legacy:%')`).bind(id));
      continue;
    }
    const target = decision.action === 'reject' ? null : decision.set_num!;
    // The wrong set's provider-native columns still feed its legacy blend.
    if (row.set_num && row.set_num !== target) {
      stmts.push(env.DB.prepare(`UPDATE lego_sets SET pc_id=NULL, pc_new_value=NULL,
        pc_complete_value=NULL, pc_cached_at=NULL WHERE set_num=?1 AND pc_id=?2`).bind(row.set_num, id));
      stmts.push(env.DB.prepare(`DELETE FROM pricing_signals WHERE source='pricecharting'
        AND source_item_id=?1 AND set_num=?2`).bind(id, row.set_num));
    }
    if (decision.action === 'reject') {
      // set_num is cleared: the rejection is about this product, and a rejected
      // row still holding the set would bar every other product from it.
      stmts.push(env.DB.prepare(`UPDATE pricing_source_map SET status='rejected', set_num=NULL, match_confidence=0,
        verified_at=NULL, updated_at=datetime('now') WHERE source='pricecharting' AND source_item_id=?1`).bind(id));
      stmts.push(env.DB.prepare(`DELETE FROM pricing_signals WHERE source='pricecharting'
        AND source_item_id=?1`).bind(id));
      continue;
    }
    if (decision.action === 'keep') {
      // Still undecided, but show the reviewer a candidate the title supports.
      stmts.push(env.DB.prepare(`UPDATE pricing_source_map SET set_num=?2, variant_key=?2
        WHERE source='pricecharting' AND source_item_id=?1`).bind(id, target));
      continue;
    }
    const status = decision.action === 'manual' ? 'manual' : 'verified';
    stmts.push(env.DB.prepare(`UPDATE pricing_source_map SET set_num=?2, variant_key=?2, status=?3,
      match_method='title_review', match_confidence=?4, verified_at=datetime('now'), updated_at=datetime('now')
      WHERE source='pricecharting' AND source_item_id=?1`).bind(id, target, status, status === 'manual' ? 1 : 0.9));
    stmts.push(env.DB.prepare(`UPDATE pricing_signals SET match_status=?3, updated_at=datetime('now')
      WHERE source='pricecharting' AND source_item_id=?1 AND set_num=?2`).bind(id, target, status));
  }
  for (let i = 0; i < stmts.length; i += BATCH) await env.DB.batch(stmts.slice(i, i + BATCH));

  if (!options.dryRun && !options.all) {
    await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .bind(CURSOR_KEY, last).run();
  }
  if (options.dryRun) {
    result.decisions = decided.map(({ row, decision }) => ({
      source_item_id: row.source_item_id, from: row.set_num, title: row.source_title, ...decision,
    }));
  }
  return result;
}
