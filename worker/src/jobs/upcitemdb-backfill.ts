import type { Env } from '../types';
import { searchUpcItemDb, UPC_THROTTLE_CODES } from '../lib/upcitemdb';
import { reserveQuota } from '../lib/api-quota';
import { integrationRecentlyHealthy } from '../lib/integration-health';

// Categories with no retail barcode — never worth a UPCitemdb call.
const RETAIL_EXCLUDE =
  "('Gear','Books','Educational and Dacta','Service Packs','Universal Building Set','System','LEGO Brand Store')";

// Durable rotation cursor (last set_num attempted) stored in its own
// integration_health row — no schema change, not rendered as an integration.
const CURSOR_SERVICE = 'upcitemdb_cursor';

export function upcItemDbEnabled(env: Env): boolean {
  // Default ON — the trial endpoint needs no key. Set UPCITEMDB_ENABLED=0 to pause.
  return !/^(0|false|no|off)$/i.test(String(env.UPCITEMDB_ENABLED ?? '1'));
}

async function getCursor(env: Env): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT last_error FROM integration_health WHERE service=?')
      .bind(CURSOR_SERVICE).first<{ last_error: string | null }>();
    return row?.last_error ?? '';
  } catch {
    return '';
  }
}

async function setCursor(env: Env, cursor: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO integration_health (service, last_error, ok_count, fail_count, updated_at)
       VALUES (?1, ?2, 0, 0, datetime('now'))
       ON CONFLICT(service) DO UPDATE SET last_error=?2, updated_at=datetime('now')`
    ).bind(CURSOR_SERVICE, cursor).run();
  } catch { /* best-effort */ }
}

async function recordHealth(env: Env, ok: boolean, detail: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO integration_health (service, last_ok_at, last_fail_at, last_error, ok_count, fail_count, updated_at)
       VALUES ('upcitemdb', ?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(service) DO UPDATE SET
         last_error = ?3,
         last_ok_at = CASE WHEN ?6 = 1 THEN datetime('now') ELSE integration_health.last_ok_at END,
         last_fail_at = CASE WHEN ?6 = 1 THEN integration_health.last_fail_at ELSE datetime('now') END,
         ok_count = integration_health.ok_count + ?4,
         fail_count = integration_health.fail_count + ?5,
         updated_at = datetime('now')`
    ).bind(
      ok ? new Date().toISOString() : null,
      ok ? null : new Date().toISOString(),
      detail.slice(0, 250),
      ok ? 1 : 0,
      ok ? 0 : 1,
      ok ? 1 : 0,
    ).run();
  } catch { /* best-effort */ }
}

export interface UpcBackfillResult { processed: number; filled: number; lastCode: string; }

// Small, spaced trickle: rotate through missing modern retail sets by set_num,
// query UPCitemdb, store only validated LEGO barcodes. Sized for a frequent cron
// (a few per run) so it stays inside the trial's per-window search rate limit.
export async function runUpcItemDbBackfill(env: Env, options: { limit?: number } = {}): Promise<UpcBackfillResult> {
  if (!upcItemDbEnabled(env)) return { processed: 0, filled: 0, lastCode: 'disabled' };
  // The trial endpoint has been answering EXCEED_LIMIT since 2026-07-11 — 962
  // failures against 13 lifetime successes — while our own ledger still showed
  // budget, so this fired every 30 minutes to accomplish nothing. Skip while the
  // provider is refusing us; one probe gets through per day once 24h has passed
  // since the last failure, which is enough to notice a recovery.
  if (!(await integrationRecentlyHealthy(env, 'upcitemdb', 24))) {
    return { processed: 0, filled: 0, lastCode: 'provider_unhealthy' };
  }
  const want = Math.min(Math.max(1, Math.floor(options.limit ?? 4)), 10);

  const grant = await reserveQuota(env, { upcitemdb: want });
  const budget = grant.upcitemdb ?? 0;
  if (budget <= 0) return { processed: 0, filled: 0, lastCode: 'quota_exhausted' };

  const baseSql = `
    SELECT set_num, name FROM lego_sets
    WHERE (upc IS NULL OR TRIM(upc) = '')
      AND year >= 2016
      AND (theme IS NULL OR theme NOT IN ${RETAIL_EXCLUDE})`;
  const fetchPage = async (cur: string) => {
    if (cur) {
      const r = await env.DB.prepare(`${baseSql} AND set_num > ?1 ORDER BY set_num ASC LIMIT ?2`)
        .bind(cur, budget).all<{ set_num: string; name: string }>();
      return r.results;
    }
    const r = await env.DB.prepare(`${baseSql} ORDER BY set_num ASC LIMIT ?1`)
      .bind(budget).all<{ set_num: string; name: string }>();
    return r.results;
  };

  let cursor = await getCursor(env);
  let results = await fetchPage(cursor);
  if (!results.length && cursor) {
    // Walked to the end of the pool — wrap around and retry from the start.
    cursor = '';
    results = await fetchPage('');
  }

  let processed = 0, filled = 0, lastCode = 'OK';
  for (let i = 0; i < results.length; i++) {
    if (i > 0) await new Promise((res) => setTimeout(res, 6000)); // space requests for the trial throttle
    const s = results[i];
    const out = await searchUpcItemDb(env, s.set_num, s.name);
    processed++;
    lastCode = out.code;
    if (UPC_THROTTLE_CODES.has(out.code)) break; // window closed — stop; cursor stays before this set
    cursor = s.set_num; // a real response was consumed — advance past it
    if (out.barcode) {
      const w = await env.DB.prepare(
        "UPDATE lego_sets SET upc=? WHERE set_num=? AND (upc IS NULL OR TRIM(upc) = '')"
      ).bind(out.barcode, s.set_num).run();
      filled += w.meta.changes ?? 0;
    }
  }

  await setCursor(env, cursor);
  const ok = !UPC_THROTTLE_CODES.has(lastCode);
  await recordHealth(env, ok, `processed ${processed} · filled ${filled} · last ${lastCode} · cursor ${cursor || '(start)'}`);
  return { processed, filled, lastCode };
}
