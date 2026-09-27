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
    assert.match(portfolio, /const items = p\.items \|\| \[\];\s*const isEmptyVault = items\.length === 0;/);

    const paint = portfolio.slice(portfolio.indexOf('function paintPortfolio()'));
    const topbar = paint.indexOf('${vaultTopbar(');
    const emptyBranch = paint.indexOf('${isEmptyVault ? `${emptyVaultHTML()}');
    const hero = paint.indexOf('heroHTML(p, totals)', emptyBranch);
    const toolbar = paint.indexOf('${vaultToolbar(', emptyBranch);

    assert.ok(topbar >= 0 && emptyBranch > topbar, 'top bar must precede the empty-state branch');
    assert.ok(hero > emptyBranch, 'the zero-value hero must live only in the populated branch');
    assert.ok(toolbar > emptyBranch, 'sort and layout controls must live only in the populated branch');
    // The empty vault's actions are the primary actions: no competing Scan FAB.
    assert.match(paint, /if \(isEmptyVault\) setPageFab\(null\);/);
  });

  it('orders shelf photo, import, then a guest-safe barcode scan without financial demo clutter', () => {
    const template = emptyVaultTemplate();
    const shelf = template.indexOf('data-empty-action="shelf"');
    const importList = template.indexOf("href: '#/me/data'");
    const scan = template.indexOf('data-empty-action="scan"');
    const browse = template.indexOf('href="#/add"');
    const demo = template.indexOf('Demo Portfolio Preview');

    assert.ok(shelf >= 0 && importList > shelf && scan > importList, 'activation actions must follow the intended hierarchy');
    assert.ok(browse > scan, 'browsing the catalog stays available as the quiet last option');
    assert.match(template, /primary: true/);
    assert.equal(demo, -1, 'the collector introduction must not present example financial holdings');
    assert.match(template, /t\('bvVault\.emptyTitle'\)/);
    assert.match(template, /t\('bvVault\.emptyScanTitle'\)/);
    assert.doesNotMatch(template, /Shelf Snap|shelfSnapBtn|photoScanNeedsSetup/);
    // Scanner entry points lazy-load the scanner (it works for guests too).
    assert.match(portfolio, /import\('\.\.\/components\/scanner-lazy\.js'\)/);
  });

  it('keeps populated-Vault range controls at the 44px touch target', () => {
    assert.match(css, /\.range-pills button\s*\{[^}]*min-height:\s*44px/s);
  });
});
