import type { Env } from '../types';
import { sendAlertEmail, wishlistAlertEmailHTML } from '../lib/resend';
import { sendDiscordAlert } from '../lib/discord';
import { sendWebPush } from '../lib/webpush';

async function sendPushToUser(env: Env, userId: string, payload: string) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const { results } = await env.DB.prepare(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?'
  ).bind(userId).all<{ endpoint: string; p256dh: string; auth: string }>();
  const subject = env.VAPID_SUBJECT || 'mailto:alerts@brickvault.app';
  for (const sub of results) {
    try {
      const ok = await sendWebPush(sub, payload, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY, subject);
      if (!ok) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(sub.endpoint).run().catch(() => {});
      }
    } catch { /* non-fatal */ }
  }
}

interface AlertPrefs { email: string | null; discord_webhook_url: string | null; notify_price_drops: number }

// Batch-load notification prefs for many users in chunked IN(...) queries (one
// query per 100 users) instead of one query per user inside the send loops.
async function loadAlertPrefs(env: Env, userIds: string[]): Promise<Map<string, AlertPrefs>> {
  const byId = new Map<string, AlertPrefs>();
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    if (!chunk.length) continue;
    const ph = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT user_id, email, discord_webhook_url, notify_price_drops FROM user_prefs WHERE user_id IN (${ph})`
    ).bind(...chunk).all<AlertPrefs & { user_id: string }>();
    for (const r of results) byId.set(r.user_id, r);
  }
  return byId;
}

export async function runWishlistAlerts(env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT w.id, w.user_id, w.set_num, w.target_price, w.alerted_at,
           s.name as set_name, s.current_value, s.image_url
    FROM user_wishlist w
    JOIN lego_sets s ON s.set_num = w.set_num
    WHERE w.target_price IS NOT NULL
      AND s.current_value <= w.target_price
      AND (w.alerted_at IS NULL OR w.alerted_at < datetime('now', '-7 days'))
  `).all<{ id: number; user_id: string; set_num: string; target_price: number; set_name: string; current_value: number; image_url: string | null }>();

  if (!results.length) {
    const spike = await runSpikeAlerts(env);
    const retiring = await runRetirementAlerts(env);
    const deals = await runDealAlerts(env);
    return { fired: 0, spikes: spike.fired, retiring: retiring.fired, deals: deals.fired };
  }

  const stmts: D1PreparedStatement[] = [];
  for (const row of results) {
    stmts.push(
      env.DB.prepare(`
        INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value)
        VALUES (?, ?, ?, ?, ?)
      `).bind(row.user_id, row.set_num, row.set_name, row.target_price, row.current_value),
      env.DB.prepare(
        `UPDATE user_wishlist SET alerted_at=datetime('now') WHERE id=?`
      ).bind(row.id),
    );
  }

  await env.DB.batch(stmts);

  // Group by user_id and send notifications
  const byUser = new Map<string, typeof results>();
  for (const row of results) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row);
    byUser.set(row.user_id, arr);
  }

  const prefsByUser = await loadAlertPrefs(env, [...byUser.keys()]);
  for (const [userId, rows] of byUser) {
    const prefs = prefsByUser.get(userId);
    if (!prefs || !prefs.notify_price_drops) continue;

    for (const row of rows) {
      if (prefs.email && env.RESEND_API_KEY) {
        const html = wishlistAlertEmailHTML(row.set_name, row.set_num, row.target_price, row.current_value, 'drop');
        sendAlertEmail(prefs.email, `${row.set_name} hit your target price`, html, env).catch(() => {});
      }
      if (prefs.discord_webhook_url) {
        const fmt = (n: number) => `$${n.toFixed(2)}`;
        sendDiscordAlert(prefs.discord_webhook_url, {
          title: `Price target reached: ${row.set_name}`,
          description: `**${row.set_num}** is now at **${fmt(row.current_value)}**, at or below your target of ${fmt(row.target_price)}.`,
          color: 0x22c55e,
          imageUrl: row.image_url ?? undefined,
          url: `https://brickvault-5ub.pages.dev#/set/${encodeURIComponent(row.set_num)}`,
        }).catch(() => {});
      }
      sendPushToUser(env, row.user_id, JSON.stringify({
        title: 'Price target reached',
        body: `${row.set_name} is now $${row.current_value.toFixed(2)} — at or below your target.`,
        url: `#/set/${encodeURIComponent(row.set_num)}`,
      })).catch(() => {});
    }
  }

  const spike = await runSpikeAlerts(env);
  const retiring = await runRetirementAlerts(env);
  const deals = await runDealAlerts(env);
  return { fired: results.length, spikes: spike.fired, retiring: retiring.fired, deals: deals.fired };
}

async function runSpikeAlerts(env: Env): Promise<{ fired: number }> {
  const { results } = await env.DB.prepare(`
    SELECT uc.id as collection_id, uc.user_id, uc.set_num, uc.purchase_price,
           ls.name as set_name, ls.current_value, ls.image_url
    FROM user_collection uc
    JOIN lego_sets ls ON ls.set_num = uc.set_num
    WHERE uc.purchase_price > 0
      AND ls.current_value > 1.30 * uc.purchase_price
      AND uc.deleted_at IS NULL
      AND (uc.spike_alerted_at IS NULL OR uc.spike_alerted_at < datetime('now', '-30 days'))
  `).all<{
    collection_id: number; user_id: string; set_num: string;
    purchase_price: number; set_name: string; current_value: number; image_url: string | null;
  }>();

  if (!results.length) return { fired: 0 };

  const stmts: D1PreparedStatement[] = [];
  for (const row of results) {
    stmts.push(
      env.DB.prepare(`
        INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value, alert_type)
        VALUES (?, ?, ?, ?, ?, 'spike')
      `).bind(row.user_id, row.set_num, row.set_name, row.purchase_price, row.current_value),
      env.DB.prepare(
        `UPDATE user_collection SET spike_alerted_at=datetime('now') WHERE id=?`
      ).bind(row.collection_id),
    );
  }
  await env.DB.batch(stmts);

  // Notifications for spike alerts
  const byUser = new Map<string, typeof results>();
  for (const row of results) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row);
    byUser.set(row.user_id, arr);
  }
  const prefsByUser = await loadAlertPrefs(env, [...byUser.keys()]);
  for (const [userId, rows] of byUser) {
    const prefs = prefsByUser.get(userId);
    if (!prefs || !prefs.notify_price_drops) continue;
    for (const row of rows) {
      if (prefs.email && env.RESEND_API_KEY) {
        const html = wishlistAlertEmailHTML(row.set_name, row.set_num, row.purchase_price, row.current_value, 'spike');
        sendAlertEmail(prefs.email, `${row.set_name} is up +30% — spike alert`, html, env).catch(() => {});
      }
      if (prefs.discord_webhook_url) {
        const fmt = (n: number) => `$${n.toFixed(2)}`;
        const pct = ((row.current_value - row.purchase_price) / row.purchase_price * 100).toFixed(0);
        sendDiscordAlert(prefs.discord_webhook_url, {
          title: `Value spike: ${row.set_name}`,
          description: `**${row.set_num}** spiked to **${fmt(row.current_value)}** (+${pct}% above your purchase price of ${fmt(row.purchase_price)}).`,
          color: 0xf97316,
          imageUrl: row.image_url ?? undefined,
          url: `https://brickvault-5ub.pages.dev#/set/${encodeURIComponent(row.set_num)}`,
        }).catch(() => {});
      }
      const pct2 = ((row.current_value - row.purchase_price) / row.purchase_price * 100).toFixed(0);
      sendPushToUser(env, row.user_id, JSON.stringify({
        title: 'Value spike!',
        body: `${row.set_name} is up +${pct2}% — now worth $${row.current_value.toFixed(2)}.`,
        url: `#/set/${encodeURIComponent(row.set_num)}`,
      })).catch(() => {});
    }
  }

  return { fired: results.length };
}

// Retirement alerts: an owned OR wishlisted set that's still active becomes
// flagged "retiring soon" — a discrete, act-now event (production ending often
// precedes price increases). Deduped against wishlist_alerts itself (the
// inserted row is the 30-day cooldown), so no per-row cooldown column is needed.
async function runRetirementAlerts(env: Env): Promise<{ fired: number }> {
  const { results } = await env.DB.prepare(`
    SELECT u.user_id, ls.set_num, ls.name AS set_name, ls.current_value, ls.image_url
    FROM lego_sets ls
    JOIN (
      SELECT user_id, set_num FROM user_collection WHERE deleted_at IS NULL
      UNION
      SELECT user_id, set_num FROM user_wishlist
    ) u ON u.set_num = ls.set_num
    WHERE ls.retired = 0 AND ls.lego_retiring_soon = 1
      AND NOT EXISTS (
        SELECT 1 FROM wishlist_alerts wa
        WHERE wa.user_id = u.user_id AND wa.set_num = ls.set_num
          AND wa.alert_type = 'retiring' AND wa.triggered_at > datetime('now', '-30 days')
      )
  `).all<{ user_id: string; set_num: string; set_name: string; current_value: number | null; image_url: string | null }>();

  if (!results.length) return { fired: 0 };

  const stmts: D1PreparedStatement[] = results.map(row =>
    env.DB.prepare(`
      INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value, alert_type)
      VALUES (?, ?, ?, ?, ?, 'retiring')
    `).bind(row.user_id, row.set_num, row.set_name, 0, row.current_value ?? 0),
  );
  await env.DB.batch(stmts);

  const byUser = new Map<string, typeof results>();
  for (const row of results) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row);
    byUser.set(row.user_id, arr);
  }
  const prefsByUser = await loadAlertPrefs(env, [...byUser.keys()]);
  for (const [userId, rows] of byUser) {
    const prefs = prefsByUser.get(userId);
    if (!prefs || !prefs.notify_price_drops) continue;
    for (const row of rows) {
      const cv = Number(row.current_value) || 0;
      if (prefs.email && env.RESEND_API_KEY) {
        const html = wishlistAlertEmailHTML(row.set_name, row.set_num, 0, cv, 'retiring');
        sendAlertEmail(prefs.email, `${row.set_name} is retiring soon`, html, env).catch(() => {});
      }
      if (prefs.discord_webhook_url) {
        sendDiscordAlert(prefs.discord_webhook_url, {
          title: `Retiring soon: ${row.set_name}`,
          description: `**${row.set_num}** is now flagged as retiring soon${cv > 0 ? ` · current value $${cv.toFixed(2)}` : ''}. Production is ending — a good time to decide buy vs. hold.`,
          color: 0xef4444,
          imageUrl: row.image_url ?? undefined,
          url: `https://brickvault-5ub.pages.dev#/set/${encodeURIComponent(row.set_num)}`,
        }).catch(() => {});
      }
      sendPushToUser(env, row.user_id, JSON.stringify({
        title: 'Retiring soon',
        body: `${row.set_name} is retiring soon — production is ending.`,
        url: `#/set/${encodeURIComponent(row.set_num)}`,
      })).catch(() => {});
    }
  }

  return { fired: results.length };
}

// Deal / buy-window alerts: a WISHLISTED set whose persisted deal signal is
// 'buy' (cheapest buyable price materially below market) — the same signal
// behind the on-card badge and the catalog deal filter, so all three agree.
// Deduped against wishlist_alerts (alert_type='deal', 30-day cooldown).
async function runDealAlerts(env: Env): Promise<{ fired: number }> {
  const { results } = await env.DB.prepare(`
    SELECT w.user_id, ls.set_num, ls.name AS set_name,
           COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) AS market_value,
           ls.image_url, ls.deal_discount_pct
    FROM user_wishlist w
    JOIN lego_sets ls ON ls.set_num = w.set_num
    WHERE ls.deal_signal = 'buy'
      AND NOT EXISTS (
        SELECT 1 FROM wishlist_alerts wa
        WHERE wa.user_id = w.user_id AND wa.set_num = ls.set_num
          AND wa.alert_type = 'deal' AND wa.triggered_at > datetime('now', '-30 days')
      )
  `).all<{ user_id: string; set_num: string; set_name: string; market_value: number | null; image_url: string | null; deal_discount_pct: number | null }>();

  if (!results.length) return { fired: 0 };

  const stmts: D1PreparedStatement[] = results.map(row =>
    env.DB.prepare(`
      INSERT INTO wishlist_alerts (user_id, set_num, set_name, target_price, current_value, alert_type)
      VALUES (?, ?, ?, ?, ?, 'deal')
    `).bind(row.user_id, row.set_num, row.set_name, 0, row.market_value ?? 0),
  );
  await env.DB.batch(stmts);

  const byUser = new Map<string, typeof results>();
  for (const row of results) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row);
    byUser.set(row.user_id, arr);
  }
  const prefsByUser = await loadAlertPrefs(env, [...byUser.keys()]);
  for (const [userId, rows] of byUser) {
    const prefs = prefsByUser.get(userId);
    if (!prefs || !prefs.notify_price_drops) continue;
    for (const row of rows) {
      const mv = Number(row.market_value) || 0;
      const pct = Number(row.deal_discount_pct);
      const pctStr = Number.isFinite(pct) && pct >= 1 ? `~${Math.round(pct)}% below market` : 'below market';
      if (prefs.email && env.RESEND_API_KEY) {
        const html = wishlistAlertEmailHTML(row.set_name, row.set_num, 0, mv, 'deal');
        sendAlertEmail(prefs.email, `Buy window: ${row.set_name}`, html, env).catch(() => {});
      }
      if (prefs.discord_webhook_url) {
        sendDiscordAlert(prefs.discord_webhook_url, {
          title: `Buy window: ${row.set_name}`,
          description: `**${row.set_num}** from your wishlist is available ${pctStr}${mv > 0 ? ` (market value $${mv.toFixed(2)})` : ''}.`,
          color: 0x22c55e,
          imageUrl: row.image_url ?? undefined,
          url: `https://brickvault-5ub.pages.dev#/set/${encodeURIComponent(row.set_num)}`,
        }).catch(() => {});
      }
      sendPushToUser(env, row.user_id, JSON.stringify({
        title: 'Buy window',
        body: `${row.set_name} is available ${pctStr}.`,
        url: `#/set/${encodeURIComponent(row.set_num)}`,
      })).catch(() => {});
    }
  }

  return { fired: results.length };
}
