import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const minifigsJs = read('public/js/views/minifigs.js');
const minifigsRoute = read('worker/src/routes/minifigs.ts');
const detailJs = read('public/js/views/portfolio-detail.js');
const meJs = read('public/js/views/me.js');
const routerJs = read('public/js/router.js');

function extractBody(source, funcName) {
  const start = source.indexOf(`function ${funcName}(`);
  assert.notEqual(start, -1, `${funcName}() must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  assert.fail(`${funcName}() body must be brace-balanced`);
}

describe('late-review Minifigs regressions', () => {
  it('uses API/local collection aggregates rather than the loaded result page for global stats', () => {
    assert.match(minifigsJs, /res\.aggregates/);
    assert.match(minifigsRoute, /FROM user_minifigs um\s+JOIN minifigs m/s);
    assert.match(minifigsRoute, /SUM\(um\.quantity\)/);
    assert.match(minifigsRoute, /aggregates:\s*\{/);
    const statsBody = extractBody(minifigsJs, 'updateFigStats');
    assert.doesNotMatch(statsBody, /state\.blind\.items\.filter/);
    assert.match(statsBody, /ownedCount/);
    assert.match(statsBody, /ownedValue/);
  });

  it('reloads filtered results after an ownership change', () => {
    assert.match(minifigsJs, /figOwned\s*!==\s*["']all["'][\s\S]{0,180}loadBlind\(\{\s*reset:\s*true\s*\}\)/);
  });

  it('keeps both sort directions selectable in the advanced filter sheet', () => {
    assert.match(minifigsJs, /FIG_SORTS\.flatMap\([^\n]+o\.asc[^\n]+o\.desc/);
  });

  it('guards detail history and set-list writes by fig identity generation', () => {
    assert.match(minifigsJs, /_figDetailGen/);
    assert.match(minifigsJs, /const detailGen\s*=\s*\+\+_figDetailGen/);
    assert.match(minifigsJs, /detailGen\s*!==\s*_figDetailGen\s*\|\|\s*detailFigNum\s*!==\s*f\.fig_num/g);
  });
});

describe('late-review set-detail regressions', () => {
  it('completes ARIA tabs: roving tabindex, arrow/home/end movement, associated panels', () => {
    assert.match(detailJs, /role="tablist"[\s\S]{0,700}tabindex="\$\{state\.detail\.tab === tab \? "0" : "-1"\}"/);
    assert.match(detailJs, /aria-controls="panel-\$\{tab\}"/);
    const keyBody = detailJs.slice(detailJs.indexOf('Keyboard activation of the tabs'), detailJs.indexOf('Keyboard activation of the tabs') + 900);
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(keyBody, new RegExp(key));
    const switchBody = extractBody(detailJs, 'switchDetailTab');
    assert.match(switchBody, /setAttribute\("tabindex", on \? "0" : "-1"\)/);
  });

  it('falls back to info for unknown or unavailable tabs, including manage for unowned sets', () => {
    const paintBody = extractBody(detailJs, 'paintSetDetail');
    assert.match(detailJs, /const tabs = owned \? \["info", "forecast", "community", "manage"\] : \["info", "forecast", "community"\]/);
    assert.match(paintBody, /detailTabs\(owned\)\.includes\(state\.detail\.tab\)/);
  });

  it('synchronizes a click-selected tab into the hash route', () => {
    assert.match(detailJs, /replaceState\(null, "", `#\/set\/\$\{encodeURIComponent\(set\.set_num\)\}\/\$\{tab\}`\)/);
  });

  it('binds Manage field labels to their controls via label-for', () => {
    const defPos = detailJs.lastIndexOf('function manageTabHTML');
    const manageBlock = detailJs.slice(defPos, detailJs.lastIndexOf('function wireManageTab'));
    const labelTags = (manageBlock.match(/<label\b[^>]*\sfor=/g) || []).length;
    assert.ok(labelTags >= 3, `expected label-for associations, found ${labelTags}`);
    assert.doesNotMatch(manageBlock, /<div class="field-lbl">Purchase price<\/div>\s*<input id="mPrice"/);
    assert.doesNotMatch(manageBlock, /<div class="field-lbl">Notes<\/div>/);
  });
});

describe('late-review profile settings regressions', () => {
  it('does not swallow notification/digest save failures or fake success', () => {
    assert.match(meJs, /catch \(err\)\s*\{[\s\S]{0,260}toast\(t\('common\.errorWithDetails'/);
    assert.doesNotMatch(meJs, /catch \{\}\s*\n\s*toast\(notifyOn \? "Alerts on"/);
    assert.doesNotMatch(meJs, /catch \{\}\s*\n\s*toast\(digestOn \? "Weekly digest on/);
  });

  it('disables toggles while saving and rolls back state on failure', () => {
    assert.match(meJs, /disabled/);
    assert.match(meJs, /aria-checked/);
    assert.match(meJs, /on\s*=\s*!on/);
    assert.match(meJs, /catch \(err\)[\s\S]{0,120}on\s*=\s*!on/);
  });

  it('does not imply weekly digest persistence for guests', () => {
    assert.match(meJs, /isGuestMode\(\)/);
    const digestRow = meJs.slice(meJs.indexOf('Weekly vault digest'), meJs.indexOf('Weekly vault digest') + 1200);
    assert.match(digestRow, /guest/);
    assert.match(digestRow, /disabled|Sign in/);
  });
});
