// Theme quests (#/quests): for each subtheme the member collects ("Modular
// Buildings Collection", "Ultimate Collector Series"…) a progress ring of
// owned / total sets and the missing ones, cheapest first. The Vault shows the
// closest-to-finished quest as a teaser card under the hero.
// Data: GET /api/quests (worker/src/routes/quests.ts). Members only.
import { $, escapeHtml, fmtMoney, proxyImg } from '../utils.js';
import { api, getSessionUserId, isGuestMode } from '../api.js';
import { t, tPlural } from '../lib/i18n.js';
import { topbar, emptyState, skeletonRows } from '../ui/kit.js';

const onScreen = () => location.hash.split('?')[0] === '#/quests';
let cache = null; // { owner, at, quests }
const FRESH_MS = 5 * 60 * 1000;

export async function fetchQuests({ force = false } = {}) {
  const owner = getSessionUserId();
  if (!owner || isGuestMode()) return [];
  if (!force && cache?.owner === owner && Date.now() - cache.at < FRESH_MS) return cache.quests;
  const res = await api('/api/quests');
  cache = { owner, at: Date.now(), quests: Array.isArray(res?.quests) ? res.quests : [] };
  return cache.quests;
}

/** Last fetched quests for the signed-in member (for repaints), else []. */
export function cachedQuests() {
  return cache?.owner === getSessionUserId() ? cache.quests : [];
}

export function ringSVG(owned, total, size = 44) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, owned / total) : 0;
  return `<svg class="bv-quest__ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bv-line)" stroke-width="5"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bv-acc)" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${(c * share).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

const progressText = q => t('fun.questProgress', { owned: String(q.owned), total: String(q.total) });

function nextHTML(q) {
  const next = q.missing?.[0];
  if (!next) return q.owned >= q.total ? `<span class="bv-quest__next">${escapeHtml(t('fun.questDone'))}</span>` : '';
  const price = Number(next.value) > 0 ? ` · ${fmtMoney(Number(next.value), { cents: 0 })}` : '';
  return `<span class="bv-quest__next">${escapeHtml(t('fun.questNext', { set: next.name || next.set_num }))}${escapeHtml(price)}</span>`;
}

/** Vault teaser: the quest closest to finished. Empty when there is none. */
export function questTeaserHTML(quests) {
  const q = quests?.[0];
  if (!q) return '';
  return `<a class="bv-card bv-quest bv-quest--teaser" href="#/quests" id="vaultQuest">
    ${ringSVG(q.owned, q.total)}
    <span class="bv-quest__body">
      <span class="bv-quest__eyebrow">${escapeHtml(t('fun.questsTitle'))}</span>
      <span class="bv-quest__name">${escapeHtml(q.subtheme)} <span class="bv-quest__count">${escapeHtml(progressText(q))}</span></span>
      ${nextHTML(q)}
    </span>
  </a>`;
}

export async function loadQuestTeaser() {
  if (!$('#vaultQuestSlot') || isGuestMode()) return;
  const quests = await fetchQuests().catch(() => []);
  const el = $('#vaultQuestSlot');
  if (el) el.innerHTML = questTeaserHTML(quests);
}

function missingHTML(s) {
  const price = Number(s.value) > 0 ? fmtMoney(Number(s.value), { cents: 0 }) : '';
  return `<li><a class="bv-quest__set" href="#/set/${encodeURIComponent(s.set_num)}">
    ${s.image_url ? `<img src="${escapeHtml(proxyImg(s.image_url))}" alt="" loading="lazy" decoding="async">` : '<span class="bv-quest__ph"></span>'}
    <span class="bv-quest__setname">${escapeHtml(s.name || s.set_num)}<span class="bv-quest__setmeta">${escapeHtml([s.set_num, s.year, Number(s.retired) ? t('fun.questRetired') : ''].filter(Boolean).join(' · '))}</span></span>
    <span class="bv-quest__price">${escapeHtml(price)}</span>
  </a></li>`;
}

function questHTML(q, i) {
  const left = Math.max(0, q.total - q.owned);
  return `<li class="bv-card bv-quest" data-quest="${i}">
    <div class="bv-quest__head">
      ${ringSVG(q.owned, q.total, 52)}
      <span class="bv-quest__body">
        <span class="bv-quest__name">${escapeHtml(q.subtheme)}</span>
        <span class="bv-quest__theme">${escapeHtml(q.theme)} · ${escapeHtml(progressText(q))}</span>
        ${nextHTML(q)}
      </span>
    </div>
    ${q.missing?.length ? `<details class="bv-quest__missing"><summary>${escapeHtml(tPlural('fun.questMissing', left))}</summary><ul>${q.missing.map(missingHTML).join('')}</ul></details>` : ''}
  </li>`;
}

export async function renderQuests() {
  const root = $('#root');
  const head = topbar({ title: t('fun.questsTitle'), back: '#/' });
  root.innerHTML = `<main class="bv-page bv-quests">${head}${skeletonRows(4)}</main>`;
  const quests = await fetchQuests({ force: true }).catch(() => null);
  if (!onScreen()) return;
  const body = quests == null
    ? emptyState({ icon: 'alert', title: t('fun.questsError') })
    : !quests.length
      ? emptyState({ icon: 'box', title: t('fun.questsEmptyTitle'), body: t('fun.questsEmptyBody') })
      : `<p class="bv-quests__intro">${escapeHtml(t('fun.questsIntro'))}</p><ul class="bv-quests__list">${quests.map(questHTML).join('')}</ul>`;
  root.innerHTML = `<main class="bv-page bv-quests">${head}${body}</main>`;
}
