import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const portfolio = readFileSync(new URL('../../public/js/views/portfolio.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../public/app.css', import.meta.url), 'utf8');

function emptyVaultTemplate() {
  const match = portfolio.match(/function emptyVaultHTML\(\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'emptyVaultHTML must remain a focused, deterministic template');
  return match[1];
}

describe('empty guest Vault activation hierarchy', () => {
  it('renders the top bar before the empty activation card and omits populated-Vault controls', () => {
    assert.match(portfolio, /const isEmptyVault = \(p\.items \|\| \[\]\)\.length === 0;/);

    const topbar = portfolio.indexOf('<div class="topbar">');
    const emptyBranch = portfolio.indexOf('${isEmptyVault ? emptyVaultHTML() : `');
    const hero = portfolio.indexOf('<div class="card hero"', emptyBranch);
    const filterRow = portfolio.indexOf('<div class="filter-row"', emptyBranch);

    assert.ok(topbar >= 0 && emptyBranch > topbar, 'top bar must precede the empty-state branch');
    assert.ok(hero > emptyBranch, 'the zero-value hero must live only in the populated branch');
    assert.ok(filterRow > emptyBranch, 'sort controls must live only in the populated branch');
  });

  it('orders Add, guest-safe Scan, then Demo Portfolio without Shelf Snap', () => {
    const template = emptyVaultTemplate();
    const add = template.indexOf('href="#/add"');
    const scan = template.indexOf('href="#/pile"');
    const demo = template.indexOf('Demo Portfolio Preview');

    assert.ok(add >= 0 && scan > add && demo > scan, 'activation actions and demo must follow the intended hierarchy');
    assert.match(template, /Add your first set/);
    assert.match(template, /Scan a set/);
    assert.doesNotMatch(template, /Shelf Snap|shelfSnapBtn|photoScanNeedsSetup/);
  });

  it('keeps populated-Vault range controls at the 44px touch target', () => {
    assert.match(css, /\.range-pills button\s*\{[^}]*min-height:\s*44px/s);
  });
});
