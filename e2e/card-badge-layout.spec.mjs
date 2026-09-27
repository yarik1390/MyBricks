import { test, expect } from './fixtures.mjs';

// A Discover tile carries a status tag over its photo (Retired / Retiring /
// New) and an Owned pill next to the value in its footer. In English both are
// short; translated they are not — Ukrainian renders "Знято з виробництва" and
// "У колекції", German "Nicht mehr erhältlich". A long tag must ellipsize
// inside the photo, and the footer pill must never push the value or itself
// out of the card.
//
// Mounts the real tile markup against the real stylesheet: the bug class is in
// the CSS contract, not in how the catalog fetches sets.
test.use({ viewport: { width: 390, height: 844 } });

const MOUNT = (tag, value, owned) => `
  <div class="bv-discover" style="padding:12px;">
    <div class="bv-grid bv-discover__grid">
      <div class="bv-tile is-owned" data-set="75191-1">
        <div class="bv-tile__media">
          <span class="bv-tile__tag"><span class="bv-pill">${tag}</span></span>
        </div>
        <div class="bv-tile__body">
          <div class="bv-tile__name">Jango Fett's Slave I with Bonus Carrying Case</div>
          <div class="bv-tile__meta">Star Wars · 2015</div>
          <div class="bv-tile__foot">
            <span class="bv-tile__value">${value}</span>
            <span class="bv-pill bv-pill--gain"><svg viewBox="0 0 24 24" width="14" height="14"></svg>${owned}</span>
          </div>
        </div>
      </div>
      <div class="bv-tile"><div class="bv-tile__media"></div><div class="bv-tile__body"><div class="bv-tile__name">Other</div></div></div>
    </div>
  </div>`;

const CASES = [
  { name: 'English', args: ['Retired', '$1,209', 'Owned'] },
  { name: 'Ukrainian', args: ['Знято з виробництва', '1 209 $', 'У колекції'] },
  // German is the longest of the Latin-script locales.
  { name: 'German', args: ['Nicht mehr erhältlich', '1.209 $', 'Im Besitz'] },
];

for (const { name, args } of CASES) {
  test(`Discover tile tag and owned pill stay inside the card (${name})`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((html) => { document.body.innerHTML = html; }, MOUNT(...args));
    await page.waitForTimeout(120);

    const tile = page.locator('.bv-tile').first();
    const card = await tile.boundingBox();
    const tag = await tile.locator('.bv-tile__tag .bv-pill').boundingBox();
    const value = await tile.locator('.bv-tile__value').boundingBox();
    const owned = await tile.locator('.bv-tile__foot .bv-pill').boundingBox();
    expect(card && tag && value && owned, 'tile parts render').toBeTruthy();

    for (const [label, box] of [['status tag', tag], ['value', value], ['owned pill', owned]]) {
      expect(box.x, `${name}: ${label} spills off the left of the card`).toBeGreaterThanOrEqual(card.x - 0.5);
      expect(box.x + box.width, `${name}: ${label} spills off the right of the card`).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    // The value and the pill share the footer row without drawing over each other.
    expect(value.x + value.width, `${name}: value runs into the Owned pill`).toBeLessThanOrEqual(owned.x + 0.5);
    // The whole value stays readable.
    const clipped = await tile.locator('.bv-tile__value').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, `${name}: value is clipped`).toBe(false);
  });
}
