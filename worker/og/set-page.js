// Crawlable set pages: bricksvault.app/s/:set (Pages Function in
// worker/functions/s). Everyone — people, search engines and link-preview bots —
// gets the same server-rendered HTML: name, photo, facts, our own market value
// estimate, related sets and a button into the app. There is no redirect, so
// the page can be indexed under its own URL (it is its own canonical).
//
// Only BricksVault's own numbers appear here (the blended estimate the public
// API already serves to guests). Partner figures and Brickset's description
// text are never republished.

import { SITE, API_ORIGIN, cleanSetNum } from './og-page.js';

const FALLBACK_IMAGE = `${SITE}/icon-glow-512.png`;
const PLAY_URL = 'https://play.google.com/store/apps/details?id=app.bricksvault';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n).toLocaleString('en-US');
const usd = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

/** JSON for a <script> block: escapes "<" so "</script>" can't end it early. */
export function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function setUrl(setNum) {
  return `${SITE}/s/${encodeURIComponent(setNum)}`;
}

/** Our own market value for a set, with its range, or null. */
export function setValue(set) {
  const value = [set.market_value, set.blended_value, set.current_value].find(positive);
  if (!value) return null;
  const low = positive(set.market_value_low) ? Number(set.market_value_low) : positive(set.blended_low) ? Number(set.blended_low) : null;
  const high = positive(set.market_value_high) ? Number(set.market_value_high) : positive(set.blended_high) ? Number(set.blended_high) : null;
  return { value: Number(value), low, high };
}

function statusLabel(set) {
  if (set.coming_soon) return 'Coming soon';
  if (set.retired) return 'Retired';
  if (set.lego_retiring_soon) return 'Retiring soon';
  return 'Available';
}

/** Plain-language summary written from our own data. */
export function setSummary(set) {
  const parts = [];
  const who = [set.theme && `${set.theme}`, set.year && `set from ${set.year}`].filter(Boolean).join(' ');
  parts.push(`${set.name} (${set.set_num}) is a LEGO ${who || 'set'}${positive(set.pieces) ? ` with ${num(set.pieces)} pieces` : ''}${positive(set.minifigs) ? ` and ${num(set.minifigs)} minifigure${Number(set.minifigs) === 1 ? '' : 's'}` : ''}.`);
  const v = setValue(set);
  if (v) {
    const range = v.low && v.high && v.high > v.low ? ` (typical range ${usd(v.low)}–${usd(v.high)})` : '';
    parts.push(`BricksVault estimates its current market value at about ${usd(v.value)}${range}.`);
  }
  if (positive(set.retail_price)) parts.push(`It launched at ${usd(set.retail_price)} retail.`);
  if (set.retired) parts.push('LEGO no longer makes this set.');
  else if (set.lego_retiring_soon) parts.push('LEGO lists it as retiring soon.');
  return parts.join(' ');
}

function imageOf(set) {
  return typeof set?.image_url === 'string' && set.image_url.startsWith('https://') ? set.image_url : FALLBACK_IMAGE;
}

/** schema.org Product for the set (no offers: we don't sell it). */
export function setStructuredData(set) {
  const props = [];
  if (positive(set.pieces)) props.push({ '@type': 'PropertyValue', name: 'Pieces', value: Number(set.pieces) });
  if (positive(set.minifigs)) props.push({ '@type': 'PropertyValue', name: 'Minifigures', value: Number(set.minifigs) });
  if (set.year) props.push({ '@type': 'PropertyValue', name: 'Release year', value: Number(set.year) });
  if (set.theme) props.push({ '@type': 'PropertyValue', name: 'Theme', value: String(set.theme) });
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: `LEGO ${set.name} ${String(set.set_num).replace(/-1$/, '')}`,
      sku: set.set_num,
      mpn: String(set.set_num).replace(/-\d+$/, ''),
      brand: { '@type': 'Brand', name: 'LEGO' },
      image: imageOf(set),
      description: setSummary(set),
      url: setUrl(set.set_num),
      ...(set.theme ? { category: `LEGO ${set.theme}` } : {}),
      ...(props.length ? { additionalProperty: props } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'BricksVault', item: `${SITE}/` },
        ...(set.theme ? [{ '@type': 'ListItem', position: 2, name: String(set.theme) }] : []),
        { '@type': 'ListItem', position: set.theme ? 3 : 2, name: String(set.name), item: setUrl(set.set_num) },
      ],
    },
  ];
}

const STYLE = `
:root{--bg:#f7f5ee;--s:#fff;--s2:#efede4;--ink:#252820;--mute:#5b5f53;--line:#dadcd1;--y:#ffd23a;--yi:#21241c;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#181b17;--s:#232720;--s2:#2d3228;--ink:#eef0e8;--mute:#a9ad9f;--line:#3a4034}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 Geist,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit}
.wrap{max-width:960px;margin:0 auto;padding:16px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 16px}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;text-decoration:none}
.brand img{width:32px;height:32px;border-radius:8px}
.crumbs{font-size:14px;color:var(--mute);margin:0 0 8px}
h1{font-size:28px;line-height:1.2;margin:0 0 4px}
.sub{color:var(--mute);margin:0 0 16px}
.hero{display:grid;gap:24px;grid-template-columns:1fr}
@media (min-width:760px){.hero{grid-template-columns:1.1fr 1fr}}
.photo{background:var(--s);border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;align-items:center;justify-content:center;aspect-ratio:4/3}
.photo img{max-width:100%;max-height:100%;object-fit:contain}
.value{background:var(--s);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:16px}
.value .label{font-size:14px;color:var(--mute)}
.value .big{font:600 32px/1.2 "IBM Plex Mono",ui-monospace,monospace;margin:4px 0}
.value .range{font-size:14px;color:var(--mute)}
dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0 0 16px;font-size:15px}
dt{color:var(--mute)}dd{margin:0;font-weight:500}
.cta{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;border-radius:999px;font-weight:600;text-decoration:none;border:1px solid var(--line);background:var(--s)}
.btn.primary{background:var(--y);color:var(--yi);border-color:var(--y)}
p.summary{max-width:65ch}
h2{font-size:20px;margin:32px 0 12px}
.related{list-style:none;padding:0;margin:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.related a{display:block;background:var(--s);border:1px solid var(--line);border-radius:12px;padding:12px;text-decoration:none;height:100%}
.related img{width:100%;aspect-ratio:4/3;object-fit:contain}
.related .n{font-size:14px;font-weight:600;margin-top:8px}
.related .m{font-size:13px;color:var(--mute)}
footer{margin:40px 0 16px;font-size:13px;color:var(--mute)}
footer a{margin-right:12px}
`;

function shell({ title, description, canonical, image, body, ld, status }) {
  const noindex = status === 404 ? '<meta name="robots" content="noindex">' : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:site_name" content="BricksVault">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta name="twitter:card" content="${image === FALLBACK_IMAGE ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="/icon-192.png">
<link rel="stylesheet" href="/fonts/fonts-v1.css">
<style>${STYLE}</style>
${(ld || []).map((o) => `<script type="application/ld+json">${jsonLd(o)}</script>`).join('\n')}
</head><body><div class="wrap">
<header><a class="brand" href="/"><img src="/icon-192.png" alt="" width="32" height="32">BricksVault</a>
<a class="btn" href="${esc(PLAY_URL)}" rel="noopener">Get the app</a></header>
<main>${body}</main>
<footer><a href="/">BricksVault</a><a href="/methodology">How we price</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
<p>LEGO® is a trademark of the LEGO Group, which does not sponsor or endorse this site.</p></footer>
</div></body></html>`;
}

/** Full HTML page for a set. related: other sets (same theme) to link to. */
export function setPageHtml(set, related = []) {
  const setNum = set.set_num;
  const short = String(setNum).replace(/-1$/, '');
  const title = `LEGO ${set.name} ${short} — value & price | BricksVault`;
  const summary = setSummary(set);
  const v = setValue(set);
  const facts = [
    ['Set number', setNum],
    set.theme && ['Theme', set.subtheme && set.subtheme !== set.theme ? `${set.theme} · ${set.subtheme}` : set.theme],
    set.year && ['Year', set.year],
    positive(set.pieces) && ['Pieces', num(set.pieces)],
    positive(set.minifigs) && ['Minifigures', num(set.minifigs)],
    positive(set.retail_price) && ['Retail price', usd(set.retail_price)],
    ['Status', statusLabel(set)],
    positive(set.age_min) && ['Age', `${set.age_min}+`],
  ].filter(Boolean);
  const valueCard = v ? `<section class="value" aria-label="Market value">
<div class="label">Market value estimate (new, sealed)</div>
<div class="big">${usd(v.value)}</div>
${v.low && v.high && v.high > v.low ? `<div class="range">Typical range ${usd(v.low)}–${usd(v.high)}. <a href="/methodology">How we price</a></div>` : '<div class="range"><a href="/methodology">How we price</a></div>'}
</section>` : '';
  const others = related.filter((r) => r && r.set_num && r.set_num !== setNum && r.name).slice(0, 12);
  const relatedHtml = others.length ? `<h2>More ${esc(set.theme || 'LEGO')} sets</h2><ul class="related">${others.map((r) => {
    const rv = setValue(r);
    return `<li><a href="/s/${encodeURIComponent(r.set_num)}"><img src="${esc(imageOf(r))}" alt="" loading="lazy" width="150" height="112"><div class="n">${esc(r.name)}</div><div class="m">${esc(r.set_num)}${r.year ? ` · ${esc(r.year)}` : ''}${rv ? ` · ${usd(rv.value)}` : ''}</div></a></li>`;
  }).join('')}</ul>` : '';
  const body = `<p class="crumbs"><a href="/">BricksVault</a>${set.theme ? ` › ${esc(set.theme)}` : ''}</p>
<h1>${esc(set.name)}</h1>
<p class="sub">LEGO ${esc(setNum)}${set.theme ? ` · ${esc(set.theme)}` : ''}${set.year ? ` · ${esc(set.year)}` : ''}</p>
<div class="hero">
<div class="photo"><img src="${esc(imageOf(set))}" alt="LEGO ${esc(set.name)} (${esc(setNum)})" width="640" height="480"></div>
<div>${valueCard}
<dl>${facts.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>
<div class="cta"><a class="btn primary" href="/#/set/${encodeURIComponent(setNum)}">Open in BricksVault</a>
<a class="btn" href="/#/set/${encodeURIComponent(setNum)}">Price history &amp; forecast</a></div>
</div></div>
<p class="summary">${esc(summary)}</p>
<p class="summary">Track this set in your collection, see its price history and get an alert when the price drops or LEGO is about to retire it.</p>
${relatedHtml}`;
  return shell({
    title,
    description: summary.slice(0, 300),
    canonical: setUrl(setNum),
    image: imageOf(set),
    body,
    ld: setStructuredData(set),
  });
}

export function notFoundHtml(setNum) {
  return shell({
    title: 'Set not found | BricksVault',
    description: 'We could not find this LEGO set.',
    canonical: null,
    image: FALLBACK_IMAGE,
    status: 404,
    body: `<h1>Set not found</h1><p class="summary">We couldn't find a LEGO set numbered ${esc(setNum || '')}.</p>
<div class="cta"><a class="btn primary" href="/#/catalog">Browse the catalog</a></div>`,
  });
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (res.status === 404) return { notFound: true };
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const PAGE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/** Pages Function body for /s/:set. */
export async function handleSetPage(context) {
  const { params, env } = context;
  const api = (env && env.API_ORIGIN) || API_ORIGIN;
  const raw = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = cleanSetNum(raw);
  const html = (body, status, cache) => new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache },
  });
  if (!id) return html(notFoundHtml(raw), 404, 'public, max-age=300');
  const detail = await fetchJson(`${api}/api/sets/${encodeURIComponent(id)}`);
  if (detail?.notFound || (detail && !detail.set?.name)) return html(notFoundHtml(id), 404, 'public, max-age=300');
  // API down: a short-lived 503 so crawlers retry instead of indexing an error.
  if (!detail) return html(notFoundHtml(id).replace('Set not found', 'Temporarily unavailable'), 503, 'no-store');
  const set = detail.set;
  // A bare number ("10294") resolves to "10294-1": send it to the canonical URL.
  if (set.set_num && set.set_num !== id && cleanSetNum(set.set_num) === set.set_num) {
    return Response.redirect(setUrl(set.set_num), 301);
  }
  const related = set.theme
    ? (await fetchJson(`${api}/api/sets/search?theme=${encodeURIComponent(set.theme)}&sort=value_desc&limit=13`))?.sets || []
    : [];
  return html(setPageHtml(set, related), 200, PAGE_CACHE);
}
