// Link previews for shared BricksVault links. The app routes by URL hash
// (#/u/handle, #/set/10182-1), which chat apps and social sites never see, so
// shares use path URLs (/u/handle, /s/10182-1) served by the Pages Functions
// in worker/functions. Preview bots get a small page with Open Graph tags;
// people are redirected straight into the app's hash route.

export const SITE = 'https://bricksvault.app';
export const API_ORIGIN = 'https://brickvault-api.zhydenko.workers.dev';
const FALLBACK_IMAGE = `${SITE}/icon-glow-512.png`;

const PREVIEW_BOT = /bot|crawl|spider|facebookexternalhit|facebookcatalog|whatsapp|telegram|slack|discord|twitter|linkedin|embedly|pinterest|skypeuripreview|vkshare|redditbot|applebot|google-inspectiontool|iframely|mastodon|signal|viber|line\//i;

/** True for link-preview crawlers (they get Open Graph HTML, not a redirect). */
export function isPreviewBot(userAgent) {
  return PREVIEW_BOT.test(String(userAgent || ''));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;

/** Handle as the app accepts it, or '' when it can't be one. */
export function cleanHandle(raw) {
  const h = String(raw || '').trim().replace(/^@/, '');
  return /^[A-Za-z0-9_.-]{1,40}$/.test(h) ? h : '';
}

/** Set number as the app accepts it ("10182" → "10182-1"), or ''. */
export function cleanSetNum(raw) {
  const s = String(raw || '').trim();
  if (!/^[A-Za-z0-9]{1,20}(-\d{1,3})?$/.test(s)) return '';
  return s.includes('-') ? s : `${s}-1`;
}

/** Open Graph fields for a public profile (null profile → generic card). */
export function profileOg(handle, profile) {
  const url = `${SITE}/u/${encodeURIComponent(handle)}`;
  if (!profile || profile.is_public === false) {
    return { title: `@${handle} on BricksVault`, description: 'A LEGO collection on BricksVault, the set tracker for collectors.', image: FALLBACK_IMAGE, url };
  }
  const name = profile.display_name && profile.display_name !== handle ? `${profile.display_name} (@${handle})` : `@${handle}`;
  const bits = [];
  const sets = Number(profile.set_count) || 0;
  if (sets) bits.push(`${sets.toLocaleString('en-US')} ${sets === 1 ? 'set' : 'sets'}`);
  if (Number(profile.piece_count) > 0) bits.push(`${Number(profile.piece_count).toLocaleString('en-US')} pieces`);
  if (profile.expose_public_value && Number(profile.total_value) > 0) bits.push(`worth ${usd(profile.total_value)}`);
  const themes = (profile.top_themes || []).map((t) => t?.theme).filter((t) => t && t !== 'Other').slice(0, 3);
  const description = [bits.join(' · '), themes.length ? `Top themes: ${themes.join(', ')}` : ''].filter(Boolean).join('. ');
  const top = (profile.showcase || []).find((s) => s && typeof s.image_url === 'string' && s.image_url.startsWith('https://'));
  return {
    title: `${name}'s LEGO vault`,
    description: description || 'A LEGO collection on BricksVault.',
    image: top ? top.image_url : FALLBACK_IMAGE,
    url,
  };
}

/** Open Graph fields for a set (null set → generic card). */
export function setOg(setNum, set) {
  const url = `${SITE}/s/${encodeURIComponent(setNum)}`;
  if (!set || !set.name) {
    return { title: `LEGO ${setNum} on BricksVault`, description: 'Market value, price history and forecasts for LEGO sets.', image: FALLBACK_IMAGE, url };
  }
  const value = Number(set.market_value) || Number(set.blended_value) || Number(set.current_value) || 0;
  const bits = [setNum, set.theme, set.year, Number(set.pieces) > 0 ? `${Number(set.pieces).toLocaleString('en-US')} pieces` : '', set.retired ? 'Retired' : ''].filter(Boolean);
  const description = `${bits.join(' · ')}${value > 0 ? `. Market value about ${usd(value)}.` : '.'}`;
  const image = typeof set.image_url === 'string' && set.image_url.startsWith('https://') ? set.image_url : FALLBACK_IMAGE;
  return { title: `${set.name} (${setNum})`, description, image, url };
}

/** Small HTML page carrying the Open Graph / Twitter tags. */
export function ogHtml({ title, description, image, url }, appHash) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="BricksVault">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="${image.endsWith('icon-glow-512.png') ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
</head><body><p><a href="${esc(`${SITE}/${appHash}`)}">${esc(title)}</a></p></body></html>`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Shared Pages Function body for /u/:handle and /s/:set. */
export async function handleShareLink(kind, context) {
  const { request, params, env } = context;
  const api = (env && env.API_ORIGIN) || API_ORIGIN;
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = kind === 'u' ? cleanHandle(raw) : cleanSetNum(raw);
  const appHash = !id ? '#/' : kind === 'u' ? `#/u/${encodeURIComponent(id)}` : `#/set/${encodeURIComponent(id)}`;
  if (!id || !isPreviewBot(request.headers.get('user-agent'))) {
    return Response.redirect(`${SITE}/${appHash}`, 302);
  }
  const og = kind === 'u'
    ? profileOg(id, await fetchJson(`${api}/api/users/${encodeURIComponent(id)}/profile`))
    : setOg(id, (await fetchJson(`${api}/api/sets/${encodeURIComponent(id)}`))?.set || null);
  return new Response(ogHtml(og, appHash), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
}
