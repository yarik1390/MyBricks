// First run (#/welcome, #/welcome/fill, #/welcome/import, #/welcome/ready) —
// 2026 redesign (canvas: Welcome, FillVault, ImportProgress, VaultReady).
//
// Step 1 shows what was set from the phone (language, currency, market, look,
// how you'll use it) and lets any of it change in place. Step 2 offers the
// fastest ways to fill the vault. The Brickset import shows its progress and
// can be left while it runs; Vault ready sums up what arrived and offers
// price alerts. Finishing anywhere marks the first run done (bv_setup_v1), the
// same flag the old setup wizard used, so returning users never see it again.
import { $, $$, escapeHtml, haptic, toast, CURRENCY_SYMBOLS, bvIDB } from '../utils.js';
import { state, invalidatePortfolio } from '../state.js';
import { api, isGuestMode } from '../api.js';
import { go } from '../router.js';
import { t, tPlural, SUPPORTED, getLocale, setLocale, applyUiDictionary, translateDOM, intlLocale } from '../lib/i18n.js';
import { getThemePref, setThemePref, getSkinPref, setSkinPref, getModePref, setModePref } from '../theme.js';
import { icon, row, btn, sheetBody, seg, iconBtn, pill } from '../ui/kit.js';
import { showSheet, hideSheet } from '../components/sheet.js';
import { setThumb, money0 } from '../ui/set-ui.js';
import { displayValueOf } from '../lib/pure.js';

const SETUP_FLAG = 'bv_setup_v1';
const DETECT_FLAG = 'bv_first_detected';
const CURRENCIES = ['USD', 'GBP', 'EUR', 'CAD', 'AUD'];
const MARKETS = ['FR', 'US', 'GB', 'DE', 'CA', 'AU', 'NL'];
const EURO = new Set(['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']);
const onWelcome = () => location.hash.split('?')[0].startsWith('#/welcome');

const brick = (c = '#c8431f', w = 40, h = 32) => `<svg viewBox="0 0 40 32" width="${w}" height="${h}" aria-hidden="true" focusable="false"><rect x="7" y="0" width="9" height="7" rx="2" fill="${c}"/><rect x="24" y="0" width="9" height="7" rx="2" fill="${c}"/><rect x="0" y="5" width="40" height="27" rx="4" fill="${c}"/></svg>`;

/** Currency and retail market for a BCP-47 tag (pure: exported for tests). */
export function detectRegionDefaults(tag) {
  let region = '';
  try { region = new Intl.Locale(tag || 'en-US').maximize().region || ''; } catch { region = String(tag || '').split('-')[1] || ''; }
  region = region.toUpperCase();
  const currency = region === 'GB' ? 'GBP' : region === 'CA' ? 'CAD' : region === 'AU' ? 'AUD' : EURO.has(region) ? 'EUR' : region === 'US' ? 'USD' : null;
  const market = MARKETS.includes(region) ? region : null;
  return { region, currency, market };
}

function marketName(code) {
  try { return new Intl.DisplayNames([getLocale()], { type: 'region' }).of(code) || code; } catch { return code; }
}
const nativeName = (code) => (SUPPORTED.find((l) => l.code === code) || SUPPORTED[0]).native;
const themeKey = { light: 'bvFirst.themeLight', dark: 'bvFirst.themeDark', auto: 'bvFirst.themeAuto' };
const skinKey = { retro: 'bvFirst.skinRetro', modular: 'bvFirst.skinModular', vivid: 'bvFirst.skinVivid', premium: 'bvFirst.skinPremium', gold: 'bvFirst.skinGold' };
const modeKey = { pro: 'setup.investor', simple: 'bvFirst.modeSimple', kids: 'bvFirst.modeKids' };

async function savePrefs(body) {
  try {
    await api('/api/me', { method: 'PATCH', body });
    const me = state.me;
    if (body.currency) {
      try { localStorage.setItem('bv_currency', body.currency); } catch { /* storage blocked */ }
      bvIDB.del('portfolio').catch(() => {});
      invalidatePortfolio();   // also drops state.me — keep ours, updated
      state.portfolioHistory = null;
    }
    if (me) state.me = Object.assign(me, body);
    return true;
  } catch (e) {
    toast(t('common.errorWithDetails', { error: e.message || e }), 'error');
    return false;
  }
}

// Once per device: set currency and retail market from the phone's region
// unless the collector already chose them.
async function applyDetectedDefaults() {
  try { if (localStorage.getItem(DETECT_FLAG)) return; localStorage.setItem(DETECT_FLAG, '1'); } catch { return; }
  const d = detectRegionDefaults(navigator.language);
  const me = state.me || {};
  const chose = (() => { try { return !!localStorage.getItem('bv_currency'); } catch { return false; } })();
  const body = {};
  if (d.currency && !chose && (me.currency || 'USD') === 'USD' && d.currency !== 'USD') body.currency = d.currency;
  if (d.market && (!me.retail_market || me.retail_market === 'FR') && d.market !== (me.retail_market || 'FR')) body.retail_market = d.market;
  if (Object.keys(body).length) await savePrefs(body);
}

/** Leave the first run: mark it done and go where the choice leads. */
export function finishFirstRun(dest = '#/') {
  try { localStorage.setItem(SETUP_FLAG, '1'); } catch { /* storage blocked */ }
  if (getModePref() === 'kids') {
    go('#/kids');
    // No parent PIN yet → offer it now (signed-in only; guests can't pick Kids).
    if (state.me && !state.me.has_kids_pin && !isGuestMode()) {
      import('../components/kids-pin.js')
        .then(({ showKidsPinSetup }) => showKidsPinSetup({ onSuccess: () => { state.me = null; } }))
        .catch(() => {});
    }
    return;
  }
  go(dest);
}

/* ------------------------------------------------------------ step 1 */

function prefsHTML() {
  const me = state.me || {};
  const guest = isGuestMode() || me.is_guest;
  const first = String(me.display_name || '').trim().split(/\s+/)[0];
  const name = !guest && first && me.display_name !== 'Guest Collector' ? first : '';
  const cur = me.currency || 'USD';
  const mode = getModePref();
  const rows = [
    row({ icon: 'globe', title: t('bvFirst.language'), sub: t('bvFirst.languageSub'), trail: nativeName(getLocale()), id: 'welLanguage' }),
    row({ icon: 'tag', title: t('bvFirst.currency'), sub: t('bvFirst.currencySub'), trail: `${cur} ${CURRENCY_SYMBOLS[cur] || ''}`.trim(), id: 'welCurrency' }),
    row({ icon: 'room', title: t('bvFirst.market'), sub: t('bvFirst.marketSub'), trail: marketName(me.retail_market || 'FR'), id: 'welMarket' }),
    row({ icon: 'palette', title: t('bvFirst.look'), sub: t(getThemePref() === 'auto' ? 'bvFirst.lookSubAuto' : 'bvFirst.lookSub'), trail: `${t(themeKey[getThemePref()] || 'bvFirst.themeAuto')} · ${t(skinKey[getSkinPref()] || 'bvFirst.skinRetro')}`, id: 'welLook' }),
    row({ icon: mode === 'kids' ? 'kid' : 'trend', title: t('bvFirst.use'), sub: t('bvFirst.useSub'), trail: t(modeKey[mode] || 'setup.investor'), id: 'welMode' }),
    `<div class="bv-row bv-row--static">${icon('bell', { size: 22 })}<span class="bv-row__text"><span class="bv-row__title">${escapeHtml(t('bvFirst.alerts'))}</span><span class="bv-row__sub">${escapeHtml(t('bvFirst.alertsSub'))}</span></span><span class="bv-row__trail">${escapeHtml(t('bvFirst.later'))}</span></div>`,
  ].join('');
  return `<main class="bv-wel" id="welcomePage" aria-labelledby="welTitle">
    <div class="bv-wel__top">${btn(t('bvFirst.skip'), { kind: 'text', id: 'welSkip' })}</div>
    <div class="bv-wel__body">
      <span class="bv-wel__mark">${brick()}</span>
      <h1 class="bv-wel__title" id="welTitle">${escapeHtml(name ? t('bvFirst.welcomeName', { name }) : t('bvFirst.welcome'))}</h1>
      <p class="bv-wel__lead">${escapeHtml(t('bvFirst.welcomeLead'))}</p>
      ${guest ? `<p class="bv-wel__note bv-note">${escapeHtml(t('setup.privacy'))} <a href="#/login">${escapeHtml(t('bvFirst.signIn'))}</a></p>` : ''}
      <div class="bv-group__box bv-wel__prefs">${rows}</div>
    </div>
    <div class="bv-wel__foot">
      ${btn(t('bvFirst.continue'), { id: 'welContinue', full: true, size: 'lg' })}
      <p class="bv-wel__step">${escapeHtml(t('bvFirst.stepOf', { n: 1, total: 2 }))}</p>
    </div>
  </main>`;
}

function repaintPrefs() {
  const root = $('#root');
  if (!root || location.hash.split('?')[0] !== '#/welcome') return;
  root.innerHTML = prefsHTML();
  wirePrefs();
}

function wirePrefs() {
  $('#welSkip')?.addEventListener('click', () => { haptic('light'); finishFirstRun('#/'); });
  // Kids Mode skips the grown-up import choices and goes straight to the kids
  // home (with the parent PIN offer) — the Kids route guard would bounce step 2.
  $('#welContinue')?.addEventListener('click', () => {
    haptic('light');
    if (getModePref() === 'kids') finishFirstRun('#/kids');
    else go('#/welcome/fill');
  });
  $('#welLanguage')?.addEventListener('click', openLanguageSheet);
  $('#welCurrency')?.addEventListener('click', () => openSelectSheet('currency'));
  $('#welMarket')?.addEventListener('click', () => openSelectSheet('market'));
  $('#welLook')?.addEventListener('click', openLookSheet);
  $('#welMode')?.addEventListener('click', openModeSheet);
}

function openLanguageSheet() {
  haptic('light');
  const active = getLocale();
  // Each language in its own language: someone who can't read the current one
  // must still find theirs.
  const chips = SUPPORTED.map((l) => `<button type="button" class="bv-chip bv-lang${l.code === active ? ' sel' : ''}" data-lang="${l.code}" lang="${l.code}" aria-pressed="${l.code === active}" data-no-i18n><span>${escapeHtml(l.native)}</span></button>`).join('');
  showSheet(sheetBody({ title: t('bvFirst.language'), id: 'welLanguageSheet', inner: `<div class="bv-wel__langs" role="group" aria-label="${escapeHtml(t('bvFirst.language'))}">${chips}</div>` }));
  $$('#welLanguageSheet [data-lang]').forEach((b) => b.addEventListener('click', async () => {
    haptic('light');
    await setLocale(b.dataset.lang);
    await applyUiDictionary().catch(() => {});
    hideSheet();
    repaintPrefs();
    translateDOM($('#root'));
  }));
}

function openSelectSheet(kind) {
  haptic('light');
  const me = state.me || {};
  const isCur = kind === 'currency';
  const id = isCur ? 'welCurrencySelect' : 'welMarketSelect';
  const opts = isCur
    ? CURRENCIES.map((c) => `<option value="${c}"${(me.currency || 'USD') === c ? ' selected' : ''}>${c} ${CURRENCY_SYMBOLS[c] || ''}</option>`).join('')
    : MARKETS.map((c) => `<option value="${c}"${(me.retail_market || 'FR') === c ? ' selected' : ''}>${escapeHtml(marketName(c))}</option>`).join('');
  const label = t(isCur ? 'bvFirst.currency' : 'bvFirst.market');
  showSheet(sheetBody({
    title: label,
    inner: `<div class="bv-field"><label for="${id}">${escapeHtml(label)}</label><div class="bv-field__box"><select id="${id}">${opts}</select></div><span class="bv-field__help">${escapeHtml(t(isCur ? 'bvFirst.currencyHelp' : 'bvFirst.marketHelp'))}</span></div>`,
  }));
  $(`#${id}`)?.addEventListener('change', async (e) => {
    haptic('medium');
    if (await savePrefs(isCur ? { currency: e.target.value } : { retail_market: e.target.value })) {
      hideSheet();
      repaintPrefs();
    }
  });
}

function openLookSheet() {
  haptic('light');
  const locked = (v) => !state.me?.is_supporter && (v === 'premium' || v === 'gold');
  const skins = ['retro', 'modular', 'vivid', 'premium', 'gold'].map((v) => `<button type="button" class="bv-chip" data-skin="${v}" aria-pressed="${getSkinPref() === v}"${locked(v) ? ' data-locked="1"' : ''}>${locked(v) ? icon('lock', { size: 16 }) : ''}<span>${escapeHtml(t(skinKey[v]))}</span></button>`).join('');
  showSheet(sheetBody({
    title: t('bvFirst.look'),
    id: 'welLookSheet',
    inner: `<div class="bv-wel__sheet">
      <span class="bv-field__label">${escapeHtml(t('bvFirst.theme'))}</span>
      ${seg(['light', 'auto', 'dark'].map((v) => ({ label: t(themeKey[v]), value: v, current: getThemePref() === v, attrs: { 'data-theme-val': v } })), { label: t('bvFirst.theme'), id: 'welThemeSeg' })}
      <span class="bv-field__label">${escapeHtml(t('bvFirst.style'))}</span>
      <div class="bv-wel__skins" role="group" aria-label="${escapeHtml(t('bvFirst.style'))}">${skins}</div>
      <p class="bv-field__help">${escapeHtml(t('bvFirst.styleHelp'))}</p>
    </div>`,
  }));
  $$('#welLookSheet [data-theme-val]').forEach((b) => b.addEventListener('click', () => {
    haptic('light');
    setThemePref(b.dataset.themeVal);
    $$('#welLookSheet [data-theme-val]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    repaintPrefs();
  }));
  $$('#welLookSheet [data-skin]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.locked) { toast(t('bvFirst.styleLocked'), 'info'); return; }
    haptic('light');
    setSkinPref(b.dataset.skin);
    $$('#welLookSheet [data-skin]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    repaintPrefs();
  }));
}

function openModeSheet() {
  haptic('light');
  const m = getModePref();
  const kidsLocked = isGuestMode() || state.me?.is_guest;
  // Same choices (and English source strings) as the old setup wizard, so the
  // existing translations carry over.
  const opt = (id, title, desc, locked = false) => `<button type="button" class="bv-opt bv-wel__opt${m === id ? ' sel' : ''}" data-mode="${id}" aria-pressed="${m === id}"${locked ? ' data-locked="1"' : ''}><span class="bv-opt-txt"><b>${title}</b><span class="bv-opt-desc">${desc}</span></span>${m === id ? icon('check', { size: 20 }) : ''}</button>`;
  showSheet(sheetBody({
    title: t('bvFirst.use'),
    sub: t('bvFirst.useChange'),
    id: 'welModeSheet',
    inner: `<div class="bv-wel__opts">
      ${opt('pro', escapeHtml(t('setup.investor')), 'Full investor view — market value, ROI and 2-year projections.')}
      ${opt('simple', 'Simple', escapeHtml(t('setup.simpleDescription')))}
      ${opt('kids', 'Kids', kidsLocked ? 'Sign in first — a parent PIN keeps kids from exiting.' : 'Playful, price-free mode with XP and badges.', kidsLocked)}
    </div>`,
  }));
  $$('#welModeSheet [data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.locked) { toast('Sign in to use Kids Mode — the parent PIN needs an account.', 'info'); return; }
    haptic('light');
    setModePref(b.dataset.mode);
    if (b.dataset.mode !== 'kids' && getSkinPref() === 'kids') setSkinPref('retro');
    hideSheet();
    repaintPrefs();
  }));
}

/* ------------------------------------------------------------ step 2 */

function fillHTML() {
  const choice = (id, ico, title, sub, { accent = false, tag = '' } = {}) => `<button type="button" class="bv-fillopt${accent ? ' bv-fillopt--acc' : ''}" id="${id}">
      <span class="bv-fillopt__ico">${icon(ico, { size: 22 })}</span>
      <span class="bv-fillopt__text"><span class="bv-fillopt__title">${escapeHtml(title)}${tag ? ` ${pill(tag, 'ink')}` : ''}</span><span class="bv-fillopt__sub">${escapeHtml(sub)}</span></span>
      ${icon('chev', { size: 20 })}
    </button>`;
  return `<main class="bv-wel bv-wel--fill" aria-labelledby="fillTitle">
    <div class="bv-wel__top">${iconBtn({ icon: 'back', label: t('common.back'), href: '#/welcome', id: 'fillBack' })}</div>
    <div class="bv-wel__body">
      <p class="bv-wel__step bv-wel__step--top">${escapeHtml(t('bvFirst.stepOf', { n: 2, total: 2 }))}</p>
      <h1 class="bv-wel__title" id="fillTitle">${escapeHtml(t('bvFirst.fillTitle'))}</h1>
      <p class="bv-wel__lead">${escapeHtml(t('bvFirst.fillLead'))}</p>
      <div class="bv-fillopts">
        ${choice('fillShelf', 'camera', t('bvFirst.fillShelf'), t('bvFirst.fillShelfSub'), { accent: true, tag: t('bvFirst.fastest') })}
        ${choice('fillBrickset', 'brick', t('bvFirst.fillBrickset'), t('bvFirst.fillBricksetSub'))}
        ${choice('fillBricklink', 'upload', t('bvFirst.fillBricklink'), t('bvFirst.fillBricklinkSub'))}
        ${choice('fillScan', 'scan', t('bvFirst.fillScan'), t('bvFirst.fillScanSub'))}
        ${choice('fillSearch', 'search', t('bvFirst.fillSearch'), t('bvFirst.fillSearchSub'))}
      </div>
    </div>
    <div class="bv-wel__foot">${btn(t('bvFirst.laterDo'), { kind: 'text', id: 'fillLater', full: true })}</div>
  </main>`;
}

function wireFill() {
  const to = (dest) => () => { haptic('light'); finishFirstRun(dest); };
  $('#fillShelf')?.addEventListener('click', to('#/pile?scan=shelf'));
  $('#fillScan')?.addEventListener('click', to('#/pile?scan=barcode'));
  $('#fillSearch')?.addEventListener('click', to('#/add'));
  $('#fillBricklink')?.addEventListener('click', to('#/me/data'));
  $('#fillLater')?.addEventListener('click', to('#/'));
  $('#fillBrickset')?.addEventListener('click', () => { haptic('light'); go('#/welcome/import'); });
}

/* ------------------------------------------------------------ import */

// One run per session: leaving the screen doesn't stop it, and coming back
// shows the same run.
let importRun = null;

function startImport() {
  if (importRun?.status === 'running') return importRun;
  importRun = { status: 'running', result: null, error: null };
  const run = importRun;
  api('/api/brickset/sync', { method: 'POST' })
    .then((res) => {
      run.status = 'done';
      run.result = res || {};
      invalidatePortfolio();
      if (location.hash.split('?')[0] !== '#/welcome/import') {
        toast(tPlural('bvFirst.importDoneToast', Number(res?.added) || 0, { count: Number(res?.added) || 0 }), 'success');
      } else renderWelcome('import');
    })
    .catch((e) => {
      run.status = 'error';
      run.error = e?.message || String(e);
      if (location.hash.split('?')[0] === '#/welcome/import') renderWelcome('import');
      else toast(t('bvFirst.importFailedToast'), 'error');
    });
  return run;
}

function ringHTML({ value = null, total = null, busy = false }) {
  const pct = value != null && total ? Math.max(0, Math.min(1, value / total)) : 0;
  const C = 2 * Math.PI * 52;
  const label = busy ? t('bvFirst.importing') : t('bvFirst.importOf', { total: Number(total || 0).toLocaleString(intlLocale()) });
  return `<div class="bv-ring${busy ? ' is-busy' : ''}" role="${busy ? 'progressbar' : 'img'}" aria-label="${escapeHtml(busy ? label : `${value} ${label}`)}">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="bv-ring__track"/><circle cx="60" cy="60" r="52" class="bv-ring__fill" style="stroke-dasharray:${busy ? `${C * 0.28} ${C}` : `${C * pct} ${C}`}"/></svg>
    <span class="bv-ring__text">${busy ? '' : `<span class="bv-ring__num">${escapeHtml(Number(value || 0).toLocaleString(intlLocale()))}</span>`}<span class="bv-ring__sub">${escapeHtml(label)}</span></span>
  </div>`;
}

async function importHTML() {
  const guest = isGuestMode() || state.me?.is_guest;
  const head = (sub) => `<div class="bv-wel__top">${iconBtn({ icon: 'back', label: t('common.back'), href: '#/welcome/fill' })}<span class="bv-wel__toptext"><span class="bv-wel__toptitle" id="importTitle">${escapeHtml(t('bvFirst.importTitle'))}</span>${sub ? `<span class="bv-wel__topsub">${escapeHtml(sub)}</span>` : ''}</span></div>`;
  if (guest) {
    return `<main class="bv-wel bv-wel--import" aria-labelledby="importTitle">${head('')}
      <div class="bv-wel__body"><section class="bv-empty"><div class="bv-empty__art">${icon('lock')}</div><h2>${escapeHtml(t('bvFirst.importSignInTitle'))}</h2><p>${escapeHtml(t('bvFirst.importSignInBody'))}</p><div class="bv-empty__actions">${btn(t('bvFirst.signIn'), { href: '#/login' })}</div></section></div></main>`;
  }
  if (!state.me?.brickset_connected && !importRun) {
    return `<main class="bv-wel bv-wel--import" aria-labelledby="importTitle">${head(t('bvFirst.importConnectSub'))}
      <div class="bv-wel__body">
        <form class="bv-wel__form" id="bricksetForm" novalidate>
          <div class="bv-field"><label for="welBsUser">${escapeHtml(t('bvFirst.bsUser'))}</label><div class="bv-field__box"><input id="welBsUser" autocomplete="username" autocapitalize="none"></div></div>
          <div class="bv-field"><label for="welBsPass">${escapeHtml(t('bvFirst.bsPass'))}</label><div class="bv-field__box"><input id="welBsPass" type="password" autocomplete="current-password"></div><span class="bv-field__help">${escapeHtml(t('bvFirst.bsHelp'))}</span></div>
          <p class="bv-field__error" id="welBsErr" role="alert" hidden></p>
          ${btn(t('bvFirst.bsConnect'), { id: 'welBsConnect', type: 'submit', full: true, size: 'lg' })}
        </form>
      </div></main>`;
  }
  const run = importRun || startImport();
  if (run.status === 'running') {
    return `<main class="bv-wel bv-wel--import" aria-labelledby="importTitle" aria-busy="true">${head(t('bvFirst.importLeave'))}
      <div class="bv-wel__body bv-wel__center">${ringHTML({ busy: true })}<p class="bv-wel__lead">${escapeHtml(t('bvFirst.importWorking'))}</p></div>
      <div class="bv-wel__foot">${btn(t('bvFirst.keepUsing'), { kind: 'outline', id: 'importLeave', full: true, size: 'lg' })}</div></main>`;
  }
  if (run.status === 'error') {
    return `<main class="bv-wel bv-wel--import" aria-labelledby="importTitle">${head('')}
      <div class="bv-wel__body"><section class="bv-empty" role="alert"><div class="bv-empty__art">${icon('cloudOff')}</div><h2>${escapeHtml(t('bvFirst.importFailedTitle'))}</h2><p>${escapeHtml(run.error || '')}</p><div class="bv-empty__actions">${btn(t('bvFirst.retry'), { id: 'importRetry', icon: 'refresh' })}${btn(t('bvFirst.laterDo'), { kind: 'text', id: 'importSkip' })}</div></section></div></main>`;
  }
  // Done: what arrived, what needs a look, what it's worth.
  const res = run.result || {};
  let coll = null;
  try { coll = await api('/api/collection'); state.portfolio = coll; } catch { /* the counts above still stand */ }
  const items = (coll?.items || []).slice().sort((a, b) => String(b.added_at || '').localeCompare(String(a.added_at || ''))).slice(0, 4);
  const added = Number(res.added) || 0;
  const skipped = Number(res.skipped) || 0;
  const total = Number(res.total) || added + skipped;
  return `<main class="bv-wel bv-wel--import" aria-labelledby="importTitle">${head(t('bvFirst.importDoneSub'))}
    <div class="bv-wel__body">
      <div class="bv-wel__center">${ringHTML({ value: added, total })}</div>
      <section class="bv-card bv-importsum">
        <div class="bv-importsum__row"><span>${escapeHtml(t('bvFirst.valueSoFar'))}</span><span class="bv-num">${escapeHtml(money0(coll?.total_value ?? 0))}</span></div>
        ${skipped ? `<div class="bv-importsum__row"><span>${escapeHtml(t('bvFirst.notInCatalog'))}</span><span>${escapeHtml(tPlural('bvFirst.reviewLater', skipped, { count: skipped }))}</span></div>` : ''}
      </section>
      ${items.length ? `<h2 class="bv-h2">${escapeHtml(t('bvFirst.justAdded'))}</h2><section class="bv-card bv-card--flush bv-justadded">${items.map((s) => `<a class="bv-justadded__row" href="#/set/${encodeURIComponent(s.set_num)}">${setThumb(s, { size: 40, radius: 10 })}<span class="bv-justadded__name">${escapeHtml(s.name || s.set_num)}</span><span class="bv-num">${escapeHtml(money0(displayValueOf(s)))}</span>${icon('check', { size: 18 })}</a>`).join('')}</section>` : ''}
    </div>
    <div class="bv-wel__foot">${btn(t('bvFirst.seeVault'), { href: '#/welcome/ready', full: true, size: 'lg' })}</div>
  </main>`;
}

function wireImport() {
  $('#importLeave')?.addEventListener('click', () => { haptic('light'); toast(t('bvFirst.importBackground'), 'info'); finishFirstRun('#/'); });
  $('#importRetry')?.addEventListener('click', () => { importRun = null; startImport(); renderWelcome('import'); });
  $('#importSkip')?.addEventListener('click', () => finishFirstRun('#/'));
  $('#bricksetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = ($('#welBsUser')?.value || '').trim();
    const pass = $('#welBsPass')?.value || '';
    const err = $('#welBsErr');
    if (!user || !pass) { if (err) { err.hidden = false; err.textContent = t('bvFirst.bsMissing'); } return; }
    const button = $('#welBsConnect');
    if (button) button.disabled = true;
    try {
      await api('/api/brickset/login', { method: 'POST', body: { username: user, password: pass } });
      if (state.me) state.me.brickset_connected = true;
      startImport();
      renderWelcome('import');
    } catch (ex) {
      if (err) { err.hidden = false; err.textContent = ex?.message || String(ex); }
      if (button) button.disabled = false;
    }
  });
}

/* ------------------------------------------------------------ ready */

async function readyHTML() {
  let coll = state.portfolio;
  if (!coll) { try { coll = await api('/api/collection'); state.portfolio = coll; } catch { coll = { items: [] }; } }
  const items = coll.items || [];
  const sets = items.reduce((n, s) => n + (Number(s.quantity) || 1), 0);
  const unpriced = items.filter((s) => !(Number(displayValueOf(s)) > 0)).length;
  const figs = Number(coll.fig_count) || 0;
  const top = items.slice().sort((a, b) => (Number(displayValueOf(b)) || 0) - (Number(displayValueOf(a)) || 0)).slice(0, 3);
  const summary = [tPlural('bvFirst.readySets', sets, { count: sets.toLocaleString(intlLocale()) })];
  if (figs) summary.push(tPlural('bvFirst.readyFigs', figs, { count: figs }));
  if (unpriced) summary.push(tPlural('bvFirst.readyLook', unpriced, { count: unpriced }));
  const confetti = ['#5aa6f0', '#ffda47', '#d9502f', '#72b35e', '#a6ad3f', '#c9a57a', '#5aa6f0', '#ffda47']
    .map((c, i) => `<span class="bv-confetti__bit" style="--c:${c};--x:${(i * 13 + 7) % 96}%;--d:${(i % 4) * 0.18}s;--r:${(i * 37) % 90 - 45}deg"></span>`).join('');
  return `<main class="bv-wel bv-wel--ready" aria-labelledby="readyTitle">
    <div class="bv-confetti" aria-hidden="true">${confetti}</div>
    <div class="bv-wel__body">
      <div class="bv-ready__hero">
        <h1 class="bv-ready__title" id="readyTitle">${escapeHtml(t('bvFirst.readyTitle'))}</h1>
        <span class="bv-ready__value">${escapeHtml(money0(coll.total_value ?? items.reduce((v, s) => v + (Number(displayValueOf(s)) || 0) * (Number(s.quantity) || 1), 0)))}</span>
        <span class="bv-ready__sub">${escapeHtml(summary.join(' · '))}</span>
      </div>
      ${top.length ? `<h2 class="bv-h2">${escapeHtml(t('bvFirst.mostValuable'))}</h2><section class="bv-card bv-card--flush bv-justadded">${top.map((s, i) => `<a class="bv-justadded__row" href="#/set/${encodeURIComponent(s.set_num)}"><span class="bv-justadded__rank">${i + 1}</span>${setThumb(s, { size: 40, radius: 10 })}<span class="bv-justadded__name">${escapeHtml(s.name || s.set_num)}</span><span class="bv-num">${escapeHtml(money0(displayValueOf(s)))}</span></a>`).join('')}</section>` : ''}
      <div id="readyAlertsSlot"></div>
    </div>
    <div class="bv-wel__foot">${btn(t('bvFirst.openVault'), { kind: 'ink', id: 'readyOpen', full: true, size: 'lg' })}</div>
  </main>`;
}

function alertsCardHTML() {
  return `<section class="bv-card bv-ready__alerts" id="readyAlerts">
        <span class="bv-ready__alertshead">${icon('bell', { size: 18 })}<strong>${escapeHtml(t('bvFirst.alertsAsk'))}</strong></span>
        <p>${escapeHtml(t('bvFirst.alertsAskBody'))}</p>
        <span class="bv-ready__alertsbtns">${btn(t('bvFirst.notNow'), { kind: 'outline', id: 'readyNotNow' })}${btn(t('bvFirst.turnOnAlerts'), { id: 'readyAlertsOn' })}</span>
      </section>`;
}

function wireReady() {
  $('#readyOpen')?.addEventListener('click', () => { haptic('medium'); finishFirstRun('#/'); });
  // Offer alerts only when push is available and still off; checking can take
  // a moment (service worker), so the card arrives after the summary.
  import('../lib/push-delivery.js').then((m) => m.pushStatus()).then((push) => {
    const slot = $('#readyAlertsSlot');
    if (!slot || push !== 'off') return;
    slot.innerHTML = alertsCardHTML();
    wireAlertsCard();
  }).catch(() => {});
}

function wireAlertsCard() {
  $('#readyNotNow')?.addEventListener('click', () => { $('#readyAlerts')?.remove(); });
  $('#readyAlertsOn')?.addEventListener('click', async () => {
    const button = $('#readyAlertsOn');
    if (button) button.disabled = true;
    try {
      await (await import('../lib/push-delivery.js')).turnOnPush();
      toast(t('bvFirst.alertsOnToast'), 'success');
      $('#readyAlerts')?.remove();
    } catch (e) {
      if (button) button.disabled = false;
      toast(t(e?.code === 'denied' ? 'bvFirst.alertsBlocked' : 'bvFirst.alertsFailed'), 'info');
    }
  });
}

/* ------------------------------------------------------------ route */

export async function renderWelcome(step = '') {
  const root = $('#root');
  if (!root) return;
  const s = ['fill', 'import', 'ready'].includes(step) ? step : '';
  if (!s) {
    await applyDetectedDefaults();
    if (!onWelcome()) return;
    root.innerHTML = prefsHTML();
    wirePrefs();
    return;
  }
  if (s === 'fill') { root.innerHTML = fillHTML(); wireFill(); return; }
  const html = s === 'import' ? await importHTML() : await readyHTML();
  if (location.hash.split('?')[0] !== `#/welcome/${s}`) return;
  root.innerHTML = html;
  if (s === 'import') wireImport(); else wireReady();
}
