// Builds the BricksVault-branded Supabase Auth email templates into
// supabase/templates/*.html. Same dark shell as the alert emails
// (worker/src/lib/alert-email.ts): table layout, inline styles, https PNG logo,
// dark by design so Gmail's dark mode leaves it alone.
//
// The {{ .ConfirmationURL }} / {{ .Email }} / {{ .NewEmail }} / {{ .Token }}
// placeholders are Supabase (Go template) variables, filled in by Supabase Auth.
//
// Run: node scripts/build-auth-emails.mjs   then paste each file into
// Supabase dashboard > Authentication > Emails (see supabase/templates/README.md).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'templates');
const BASE = 'https://bricksvault.app';

const C = {
  page: '#0F0F14', card: '#1F1F26', panel: '#2A2A34', line: '#34343F',
  ink: '#F2EDE3', soft: '#D9D5C8', mute: '#9CA3B0', gold: '#FFD700',
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function button(label) {
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr><td bgcolor="${C.gold}" style="background:${C.gold};border-radius:10px;">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:700;color:#1C1C1E;text-decoration:none;border-radius:10px;">${label}</a>
            </td></tr>
          </table>`;
}

const p = (html) => `<p style="margin:0 0 14px;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.soft};">${html}</p>`;
const strong = (html) => `<strong style="color:${C.ink};">${html}</strong>`;

function shell({ preheader, badge, title, intro, cta, after = '', footerReason }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>BricksVault</title>
</head>
<body style="margin:0;padding:0;background:${C.page};" bgcolor="${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};font-size:1px;line-height:1px;">${preheader}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle"><a href="${BASE}"><img src="${BASE}/icon-192.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></a></td>
        <td valign="middle" style="padding-left:10px;font-family:${SERIF};font-size:20px;font-weight:700;color:${C.ink};">Bricks<span style="color:${C.gold};">Vault</span></td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border-radius:18px;border:1px solid ${C.line};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:24px 28px 0;">
          <span style="display:inline-block;padding:5px 12px;border-radius:999px;border:1px solid ${C.gold};font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.gold};">${badge}</span>
        </td></tr>
        <tr><td style="padding:18px 28px 6px;font-family:${SERIF};font-size:26px;line-height:1.25;font-weight:700;color:${C.ink};">${title}</td></tr>
        <tr><td style="padding:8px 28px 6px;">
          ${intro}
        </td></tr>
        <tr><td align="center" style="padding:10px 28px 22px;">${button(cta)}
        </td></tr>
        <tr><td style="padding:0 28px 24px;">
          ${after}
          <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.mute};">Button not working? Copy this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:${C.mute};word-break:break-all;">{{ .ConfirmationURL }}</a></p>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${C.mute};text-align:center;">
      ${footerReason}<br>
      <a href="${BASE}" style="color:${C.mute};text-decoration:underline;">bricksvault.app</a>
      &nbsp;·&nbsp;
      <a href="mailto:support@bricksvault.app" style="color:${C.mute};text-decoration:underline;">support@bricksvault.app</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>
`;
}

const ignore = `<p style="margin:0 0 14px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.mute};">If you didn't ask for this, you can ignore this email. Nothing changes on your account.</p>`;

const TEMPLATES = {
  confirmation: {
    subject: 'Confirm your BricksVault account',
    preheader: 'One tap to finish signing up and open your vault.',
    badge: 'Welcome',
    title: 'Confirm your email',
    intro: p(`Thanks for joining ${strong('BricksVault')}. Confirm ${strong('{{ .Email }}')} to finish signing up and start tracking what your LEGO collection is worth.`),
    cta: 'Confirm my email',
    after: `<p style="margin:0 0 14px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.mute};">If you didn't create a BricksVault account, ignore this email and no account will be activated.</p>`,
    footerReason: "You're receiving this because someone signed up for BricksVault with this address.",
  },
  recovery: {
    subject: 'Reset your BricksVault password',
    preheader: 'Choose a new password for your BricksVault account.',
    badge: 'Password reset',
    title: 'Reset your password',
    intro: p(`We got a request to reset the password for ${strong('{{ .Email }}')}. Tap the button to choose a new one. The link works once and expires soon.`),
    cta: 'Choose a new password',
    after: ignore,
    footerReason: "You're receiving this because a password reset was requested for your BricksVault account.",
  },
  magic_link: {
    subject: 'Your BricksVault sign-in link',
    preheader: 'Tap to sign in to BricksVault. No password needed.',
    badge: 'Sign in',
    title: 'Sign in to BricksVault',
    intro: p(`Tap the button to sign in as ${strong('{{ .Email }}')}. The link works once and expires soon.`),
    cta: 'Sign in',
    after: ignore,
    footerReason: "You're receiving this because a sign-in link was requested for your BricksVault account.",
  },
  email_change: {
    subject: 'Confirm your new BricksVault email',
    preheader: 'Confirm the new email address for your BricksVault account.',
    badge: 'Email change',
    title: 'Confirm your new email',
    intro: p(`You asked to change your BricksVault email from ${strong('{{ .Email }}')} to ${strong('{{ .NewEmail }}')}. Confirm to make the switch.`),
    cta: 'Confirm new email',
    after: `<p style="margin:0 0 14px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.mute};">If you didn't ask for this, ignore this email and your address stays the same. Consider changing your password too.</p>`,
    footerReason: "You're receiving this because an email change was requested for your BricksVault account.",
  },
  invite: {
    subject: "You're invited to BricksVault",
    preheader: 'Accept your invite and start tracking your LEGO collection.',
    badge: 'Invite',
    title: "You're invited",
    intro: p(`You've been invited to ${strong('BricksVault')}, the LEGO collection tracker. Accept to set up your account for ${strong('{{ .Email }}')}.`),
    cta: 'Accept invite',
    after: '',
    footerReason: "You're receiving this because someone invited this address to BricksVault.",
  },
};

mkdirSync(OUT, { recursive: true });
for (const [name, t] of Object.entries(TEMPLATES)) {
  writeFileSync(join(OUT, `${name}.html`), shell(t));
}
writeFileSync(join(OUT, 'subjects.json'),
  JSON.stringify(Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.subject])), null, 2) + '\n');
console.log(`Wrote ${Object.keys(TEMPLATES).length} templates to ${OUT}`);
