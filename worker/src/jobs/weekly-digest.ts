import type { Env } from '../types';
import { sendAlertEmail } from '../lib/resend';
import { sendPushToUser } from './wishlist-alerts';

// Sunday-morning vault digest (opt-in): "your vault moved +$X this week, top
// mover, wishlist drops". Retention is a reliability feature here — the more
// collectors keep their vault current, the more first-party comps exist, and
// the better every valuation gets. All numbers come from data that already
// exists (portfolio_snapshots, set_value_history, wishlist_alerts): the job
// only reads + notifies, no new value computation.

interface DigestRow {
  user_id: string;
  email: string | null;
  now_value: number | null;
  week_ago_value: number | null;
  set_count: number | null;
}

const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

export async function runWeeklyDigest(env: Env) {
  // Opted-in users with a snapshot this week. week_ago falls back to the
  // OLDEST snapshot in the window so brand-new users still get a sane delta.
  const { results: users } = await env.DB.prepare(`
    SELECT p.user_id, p.email,
      (SELECT total_value FROM portfolio_snapshots s WHERE s.user_id = p.user_id ORDER BY snapshot_date DESC LIMIT 1) AS now_value,
      (SELECT set_count  FROM portfolio_snapshots s WHERE s.user_id = p.user_id ORDER BY snapshot_date DESC LIMIT 1) AS set_count,
      (SELECT total_value FROM portfolio_snapshots s WHERE s.user_id = p.user_id AND s.snapshot_date >= date('now','-8 days') ORDER BY snapshot_date ASC LIMIT 1) AS week_ago_value
    FROM user_prefs p
    WHERE p.notify_weekly_digest = 1
  `).all<DigestRow>();

  let sent = 0;
  for (const u of users) {
    if (u.now_value == null) continue; // nothing snapshotted yet — nothing to say
    const delta = u.now_value - (u.week_ago_value ?? u.now_value);

    // Top mover across the user's owned sets, today vs 7 days ago.
    const mover = await env.DB.prepare(`
      SELECT t.set_num, ls.name, (t.current_value - y.current_value) AS delta
      FROM user_collection uc
      JOIN set_value_history t ON t.set_num = uc.set_num AND t.snapshot_date = (
        SELECT MAX(snapshot_date) FROM set_value_history WHERE set_num = uc.set_num
      )
      JOIN set_value_history y ON y.set_num = uc.set_num AND y.snapshot_date = (
        SELECT MIN(snapshot_date) FROM set_value_history
        WHERE set_num = uc.set_num AND snapshot_date >= date('now','-8 days')
      )
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL AND t.snapshot_date != y.snapshot_date
      ORDER BY ABS(t.current_value - y.current_value) DESC
      LIMIT 1
    `).bind(u.user_id).first<{ set_num: string; name: string; delta: number }>().catch(() => null);

    const drops = await env.DB.prepare(`
      SELECT COUNT(*) AS n FROM wishlist_alerts
      WHERE user_id = ? AND alert_type = 'drop' AND created_at >= datetime('now','-7 days')
    `).bind(u.user_id).first<{ n: number }>().catch(() => null);

    const sign = delta >= 0 ? '+' : '−';
    const lines = [
      `Your vault ${delta >= 0 ? 'gained' : 'lost'} ${sign}${fmt(delta)} this week (${u.set_count ?? 0} sets, ${fmt(u.now_value)} total).`,
    ];
    if (mover && Math.abs(mover.delta) >= 1) {
      lines.push(`Top mover: ${mover.name} (${mover.delta >= 0 ? '+' : '−'}${fmt(mover.delta)}).`);
    }
    if (drops && drops.n > 0) {
      lines.push(`${drops.n} wishlist set${drops.n === 1 ? '' : 's'} hit your target price.`);
    }
    const body = lines.join(' ');

    sendPushToUser(env, u.user_id, JSON.stringify({
      title: 'Your weekly vault digest',
      body,
      url: '#/',
    })).catch(() => {});
    if (u.email && env.RESEND_API_KEY) {
      const html = `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="font-family:Georgia,serif;">Your weekly vault digest</h2>
        ${lines.map((l) => `<p>${l}</p>`).join('')}
        <p style="font-size:12px;color:#888;">You asked for this weekly summary — turn it off any time in Settings → Notifications.</p>
      </div>`;
      sendAlertEmail(u.email, 'Your weekly vault digest', html, env).catch(() => {});
    }
    sent++;
  }
  return { eligible: users.length, sent };
}
