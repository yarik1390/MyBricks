import { DEFAULT_APP_ORIGIN } from './app-url';

// ---------------------------------------------------------------------------
// HTML for alert emails (wishlist / collection alerts and the weekly digest).
//
// Email clients are not browsers, so this is deliberately old-fashioned:
//   - table layout + inline styles only (Gmail strips <style> in many cases);
//   - a DARK design by default. Gmail's apps auto-invert light emails in dark
//     mode (unpredictably: the old white card came out grey-on-black), but they
//     leave an already-dark email alone, so it looks the same everywhere;
//   - PNG/JPG over https only (Gmail blocks SVG and data: images);
//   - everything user/DB-sourced is HTML-escaped.
// Pure builders: callers pass appBaseUrl(env) so nothing here reads env.
// ---------------------------------------------------------------------------

export type AlertKind = 'drop' | 'spike' | 'retiring' | 'deal' | 'preorder';

export interface AlertEmailSet {
  setNum: string;
  name: string;
  imageUrl?: string | null;
  theme?: string | null;
  year?: number | null;
  pieces?: number | null;
  retailPrice?: number | null;
  /** The value the app shows (blended, else current), USD. */
  value?: number | null;
}

export interface AlertEmailDetails {
  /** drop: the wishlist target price. */
  targetPrice?: number | null;
  /** spike: what the user paid. */
  purchasePrice?: number | null;
  /** drop: the in-stock store whose offer triggered the alert. */
  merchant?: string | null;
  /** deal: how far below market the cheapest offer is, in %. */
  discountPct?: number | null;
  /** preorder: lego_availability. */
  availability?: string | null;
  /** retiring: LEGO's planned exit date (ISO). */
  exitDate?: string | null;
}

const C = {
  page: '#0F0F14',
  card: '#1F1F26',
  panel: '#2A2A34',
  line: '#34343F',
  ink: '#F2EDE3',
  soft: '#D9D5C8',
  mute: '#9CA3B0',
  gold: '#FFD700',
  up: '#45C77E',
  down: '#FF8A80',
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const KIND_META: Record<AlertKind, { label: string; color: string }> = {
  retiring: { label: 'Retiring soon', color: '#FFB547' },
  drop: { label: 'Price target reached', color: C.up },
  spike: { label: 'Value spike', color: C.up },
  deal: { label: 'Buy window', color: '#6EB6FF' },
  preorder: { label: 'Available soon', color: '#C9A7FF' },
};

/**
 * Placeholder for the recipient's unsubscribe link. The HTML is built before
 * the recipient's signed link is known; sendAlertEmail (lib/resend.ts) swaps it
 * for the real link, or for the Notifications screen when it has none.
 */
export const UNSUBSCRIBE_MARKER = '%%BV_UNSUBSCRIBE_URL%%';

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

const pos = (n: unknown): number | null => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export const money = (n: number) =>
  `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pctText = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(Math.round(p))}%`;

const setNumLabel = (n: string) => n.replace(/-1$/, '');

function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

interface Stat { label: string; value: string; color?: string }

function statsRow(stats: Stat[]): string {
  if (!stats.length) return '';
  const w = Math.floor(100 / stats.length);
  const cells = stats.map((s, i) => `
      <td width="${w}%" valign="top" style="padding:14px 12px;${i ? `border-left:1px solid ${C.line};` : ''}">
        <div style="font-family:${SANS};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.mute};">${escapeHtml(s.label)}</div>
        <div style="font-family:${SANS};font-size:20px;font-weight:700;color:${s.color ?? C.ink};margin-top:4px;white-space:nowrap;">${escapeHtml(s.value)}</div>
      </td>`).join('');
  return `
  <tr><td style="padding:0 28px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="background:${C.panel};border-radius:12px;">
      <tr>${cells}
      </tr>
    </table>
  </td></tr>`;
}

function button(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr><td bgcolor="${C.gold}" style="background:${C.gold};border-radius:10px;">
        <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:700;color:#1C1C1E;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

interface ShellParts {
  preheader: string;
  badge?: { label: string; color: string };
  body: string;
  baseUrl: string;
  footerReason: string;
}

/** The branded frame every BricksVault email shares. */
function shell({ preheader, badge, body, baseUrl, footerReason }: ShellParts): string {
  const logo = `${baseUrl}/icon-192.png`;
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>BricksVault</title>
</head>
<body style="margin:0;padding:0;background:${C.page};" bgcolor="${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};font-size:1px;line-height:1px;">${escapeHtml(preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle"><a href="${escapeHtml(baseUrl)}"><img src="${escapeHtml(logo)}" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></a></td>
        <td valign="middle" style="padding-left:10px;font-family:${SERIF};font-size:20px;font-weight:700;color:${C.ink};">Bricks<span style="color:${C.gold};">Vault</span></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border-radius:18px;border:1px solid ${C.line};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${badge ? `<tr><td style="padding:24px 28px 0;">
          <span style="display:inline-block;padding:5px 12px;border-radius:999px;border:1px solid ${badge.color};font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${badge.color};">${escapeHtml(badge.label)}</span>
        </td></tr>` : ''}
        ${body}
      </table>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.mute};text-align:center;">
      ${escapeHtml(footerReason)}<br>
      <a href="${escapeHtml(baseUrl)}/#/me/notifications" style="color:${C.mute};text-decoration:underline;">Manage alerts</a>
      &nbsp;·&nbsp;
      <a href="${UNSUBSCRIBE_MARKER}" style="color:${C.mute};text-decoration:underline;">Unsubscribe</a>
      &nbsp;·&nbsp;
      <a href="${escapeHtml(baseUrl)}" style="color:${C.mute};text-decoration:underline;">bricksvault.app</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

function heroImage(url: string | null | undefined, alt: string): string {
  if (!url || !/^https:\/\//i.test(url)) return '';
  // White tile: LEGO box/product shots are on white, so this frames them
  // instead of a hard white rectangle on the dark card.
  return `
  <tr><td style="padding:20px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:14px;">
      <tr><td align="center" style="padding:18px;">
        <img src="${escapeHtml(url)}" width="260" alt="${escapeHtml(alt)}" style="display:block;width:100%;max-width:260px;height:auto;border:0;">
      </td></tr>
    </table>
  </td></tr>`;
}

function kindCopy(kind: AlertKind, set: AlertEmailSet, d: AlertEmailDetails): {
  stats: Stat[]; insight: string; preheader: string; secondary?: { href: string; label: string };
} {
  const value = pos(set.value);
  const retail = pos(set.retailPrice);
  const vsRetail = value && retail ? ((value - retail) / retail) * 100 : null;
  const vsRetailStat: Stat | null = vsRetail == null ? null
    : { label: 'vs retail', value: pctText(vsRetail), color: vsRetail >= 0 ? C.up : C.down };
  const name = set.name;

  switch (kind) {
    case 'retiring': {
      const exit = monthYear(d.exitDate);
      const stats = [
        value ? { label: 'Market', value: money(value) } : null,
        retail ? { label: 'Retail', value: money(retail) } : null,
        vsRetailStat,
      ].filter(Boolean) as Stat[];
      const lead = `LEGO has flagged <strong style="color:${C.ink};">${escapeHtml(name)}</strong> as retiring soon${exit ? `, with production expected to end around <strong style="color:${C.ink};">${escapeHtml(exit)}</strong>` : ''}.`;
      const tail = vsRetail == null
        ? ' Sets often climb in value once they leave shelves, so now is a good time to decide whether to buy one more or hold.'
        : vsRetail < -5
          ? ' Right now it sells for less than retail on the aftermarket, so if you want one, a discounted copy is the better buy.'
          : vsRetail > 5
            ? ` It already trades ${Math.round(vsRetail)}% above retail. Sets often climb further once they leave shelves.`
            : ' It trades close to retail today. Sets often climb once they leave shelves, so now is a good time to decide whether to buy or hold.';
      return {
        stats,
        insight: lead + tail,
        preheader: `${name} is retiring soon${value ? ` · market value ${money(value)}` : ''}${retail ? ` · retail ${money(retail)}` : ''}`,
        secondary: { href: '#/retiring', label: 'See all sets retiring soon' },
      };
    }
    case 'drop': {
      const target = pos(d.targetPrice);
      const below = value && target ? target - value : null;
      const stats = [
        value ? { label: d.merchant ? 'Best price' : 'Now', value: money(value), color: C.up } : null,
        target ? { label: 'Target', value: money(target) } : null,
        retail && value ? { label: 'vs retail', value: pctText(((value - retail) / retail) * 100), color: value <= retail ? C.up : C.down } : null,
      ].filter(Boolean) as Stat[];
      const where = d.merchant ? ` at <strong style="color:${C.ink};">${escapeHtml(d.merchant)}</strong>` : '';
      return {
        stats,
        insight: `<strong style="color:${C.ink};">${escapeHtml(name)}</strong> from your wishlist is now ${value ? `<strong style="color:${C.ink};">${money(value)}</strong>` : 'at your price'}${where}${below && below >= 0.5 ? `, ${money(below)} under your target` : ', at or below your target'}. Prices like this tend not to last long.`,
        preheader: `${name} hit your target${value ? `: now ${money(value)}` : ''}${target ? ` (target ${money(target)})` : ''}`,
        secondary: { href: '#/wishlist', label: 'Open your wishlist' },
      };
    }
    case 'spike': {
      const paid = pos(d.purchasePrice);
      const gain = value && paid ? value - paid : null;
      const gainPct = gain != null && paid ? (gain / paid) * 100 : null;
      const stats = [
        paid ? { label: 'You paid', value: money(paid) } : null,
        value ? { label: 'Worth now', value: money(value), color: C.up } : null,
        gainPct != null ? { label: 'Gain', value: pctText(gainPct), color: C.up } : null,
      ].filter(Boolean) as Stat[];
      return {
        stats,
        insight: `Your <strong style="color:${C.ink};">${escapeHtml(name)}</strong> has jumped in value${gain && gain > 0 ? `: it's worth <strong style="color:${C.up};">${money(gain)} more</strong> than you paid` : ''}. If you've been thinking about selling, this is a strong moment to check offers.`,
        preheader: `${name} is up${gainPct != null ? ` ${pctText(gainPct)}` : ''}${value ? ` · now worth ${money(value)}` : ''}`,
      };
    }
    case 'deal': {
      const pct = Number(d.discountPct);
      const hasPct = Number.isFinite(pct) && pct >= 1;
      const stats = [
        value ? { label: 'Market', value: money(value) } : null,
        hasPct ? { label: 'Best offer', value: `−${Math.round(pct)}%`, color: C.up } : null,
        retail ? { label: 'Retail', value: money(retail) } : null,
      ].filter(Boolean) as Stat[];
      return {
        stats,
        insight: `<strong style="color:${C.ink};">${escapeHtml(name)}</strong> from your wishlist is on offer ${hasPct ? `about <strong style="color:${C.up};">${Math.round(pct)}% below</strong>` : '<strong>below</strong>'} its market value${value ? ` of ${money(value)}` : ''}. Compare stores in the app before it's gone.`,
        preheader: `Buy window: ${name}${hasPct ? ` is ~${Math.round(pct)}% below market` : ' is below market'}`,
      };
    }
    case 'preorder': {
      const soon = d.availability === 'coming_soon';
      const stats = [
        retail ? { label: 'Retail', value: money(retail) } : null,
        pos(set.pieces) ? { label: 'Pieces', value: Math.round(Number(set.pieces)).toLocaleString('en-US') } : null,
        { label: 'Status', value: soon ? 'Coming soon' : 'Pre-order', color: KIND_META.preorder.color },
      ].filter(Boolean) as Stat[];
      return {
        stats,
        insight: `<strong style="color:${C.ink};">${escapeHtml(name)}</strong> from your wishlist is ${soon ? 'coming soon' : 'now open for <strong>pre-order</strong>'}. Popular launches can sell out in the first days, so it's worth getting in early.`,
        preheader: `${name} is ${soon ? 'coming soon' : 'available to pre-order'}`,
        secondary: { href: '#/upcoming', label: 'See upcoming sets' },
      };
    }
  }
}

/** One alert email (retiring / target price / spike / deal / pre-order). */
export function alertEmailHTML(
  kind: AlertKind,
  set: AlertEmailSet,
  details: AlertEmailDetails = {},
  baseUrl: string = DEFAULT_APP_ORIGIN,
): string {
  const meta = KIND_META[kind];
  const copy = kindCopy(kind, set, details);
  // The /s/<set> share link opens the set's page: on the web it redirects to
  // #/set/<num>, and on Android it opens in the installed app (App Link).
  const setUrl = `${baseUrl}/s/${encodeURIComponent(set.setNum)}`;
  const facts = [
    setNumLabel(set.setNum),
    set.theme || null,
    pos(set.year) ? String(set.year) : null,
    pos(set.pieces) ? `${Math.round(Number(set.pieces)).toLocaleString('en-US')} pieces` : null,
  ].filter(Boolean).map(escapeHtml).join(' &nbsp;·&nbsp; ');

  const body = `
  ${heroImage(set.imageUrl, set.name)}
  <tr><td style="padding:22px 28px 4px;">
    <div style="font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:700;color:${C.ink};">${escapeHtml(set.name)}</div>
    <div style="font-family:${SANS};font-size:13px;color:${C.mute};margin-top:6px;">${facts}</div>
  </td></tr>
  <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
  ${statsRow(copy.stats)}
  <tr><td style="padding:14px 28px 4px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.soft};">${copy.insight}</td></tr>
  <tr><td align="center" style="padding:20px 28px ${copy.secondary ? '10px' : '28px'};">${button(setUrl, 'Open in BricksVault')}</td></tr>
  ${copy.secondary ? `<tr><td align="center" style="padding:0 28px 26px;font-family:${SANS};font-size:14px;">
    <a href="${escapeHtml(baseUrl + '/' + copy.secondary.href)}" style="color:${C.gold};text-decoration:none;font-weight:600;">${escapeHtml(copy.secondary.label)} &rarr;</a>
  </td></tr>` : ''}`;

  return shell({
    preheader: copy.preheader,
    badge: meta,
    body,
    baseUrl,
    footerReason: "You're getting this because alerts are on in your BricksVault settings.",
  });
}

export interface DigestEmailData {
  nowValue: number;
  delta: number;
  setCount: number;
  mover?: { setNum: string; name: string; delta: number; imageUrl?: string | null } | null;
  wishlistDrops?: number;
}

/** The Sunday weekly vault digest. */
export function weeklyDigestEmailHTML(d: DigestEmailData, baseUrl: string = DEFAULT_APP_ORIGIN): string {
  const up = d.delta >= 0;
  const pct = d.nowValue - d.delta > 0 ? (d.delta / (d.nowValue - d.delta)) * 100 : null;
  const deltaColor = Math.abs(d.delta) < 0.005 ? C.ink : up ? C.up : C.down;
  const stats: Stat[] = [
    { label: 'Vault value', value: money(d.nowValue) },
    { label: 'Sets', value: String(d.setCount) },
    ...(pct != null && Math.abs(d.delta) >= 0.005 ? [{ label: 'This week', value: pctText(pct), color: deltaColor }] : []),
  ];
  const mover = d.mover && Math.abs(d.mover.delta) >= 1 ? d.mover : null;
  const moverImg = mover?.imageUrl && /^https:\/\//i.test(mover.imageUrl)
    ? `<td width="64" valign="middle" style="padding-right:14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:10px;"><tr><td style="padding:6px;"><img src="${escapeHtml(mover.imageUrl)}" width="52" alt="" style="display:block;width:52px;height:auto;border:0;"></td></tr></table></td>`
    : '';
  const moverRow = mover ? `
  <tr><td style="padding:14px 28px 0;">
    <a href="${escapeHtml(`${baseUrl}/s/${encodeURIComponent(mover.setNum)}`)}" style="text-decoration:none;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:12px;">
      <tr><td style="padding:12px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${moverImg}
          <td valign="middle" style="font-family:${SANS};">
            <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.mute};">Top mover</div>
            <div style="font-size:15px;font-weight:700;color:${C.ink};margin-top:2px;">${escapeHtml(mover.name)}</div>
          </td>
          <td valign="middle" align="right" style="font-family:${SANS};font-size:17px;font-weight:700;white-space:nowrap;color:${mover.delta >= 0 ? C.up : C.down};">${mover.delta >= 0 ? '+' : '−'}${money(mover.delta)}</td>
        </tr></table>
      </td></tr>
    </table></a>
  </td></tr>` : '';
  const drops = d.wishlistDrops ?? 0;
  const dropsRow = drops > 0 ? `
  <tr><td style="padding:14px 28px 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.soft};">
    <strong style="color:${C.up};">${drops} wishlist set${drops === 1 ? '' : 's'}</strong> hit your target price this week.
  </td></tr>` : '';

  const body = `
  <tr><td style="padding:26px 28px 0;">
    <div style="font-family:${SANS};font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.mute};">Your week in the vault</div>
    <div style="font-family:${SERIF};font-size:40px;line-height:1.15;font-weight:700;color:${deltaColor};margin-top:6px;">${up ? '+' : '−'}${money(d.delta)}</div>
    <div style="font-family:${SANS};font-size:14px;color:${C.soft};margin-top:4px;">${Math.abs(d.delta) < 0.005 ? 'Your vault held steady this week.' : `Your vault ${up ? 'gained' : 'lost'} value this week.`}</div>
  </td></tr>
  <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
  ${statsRow(stats)}
  ${moverRow}
  ${dropsRow}
  <tr><td align="center" style="padding:24px 28px 28px;">${button(baseUrl + '/#/', 'Open my vault')}</td></tr>`;

  return shell({
    preheader: `Your vault ${up ? 'gained' : 'lost'} ${money(d.delta)} this week · ${money(d.nowValue)} total`,
    body,
    baseUrl,
    footerReason: 'You asked for this weekly summary. Turn it off any time in Settings → Notifications.',
  });
}
