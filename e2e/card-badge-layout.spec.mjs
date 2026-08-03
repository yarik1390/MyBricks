import { test, expect } from './fixtures.mjs';

// A catalog card pins RETIRED to the top-left of its image and OWNED to the
// top-right. Nothing stopped them meeting in the middle — in English they never
// do, because both words are short. Translated they are not: Ukrainian renders
// "ЗНЯТО З ВИРОБНИЦТВА" and "У ВЛАСНОСТІ", and the two badges drew on top of
// each other.
//
// Mounts the real markup and class names against the real stylesheet, which is
// the right target: the bug is in the CSS contract between the two badges, not
// in how the catalog fetches sets. Two cards per case, because the collision
// only happens on a set that is BOTH retired and owned.
test.use({ viewport: { width: 390, height: 844 } });

const MOUNT = (retired, owned, trust, ppp) => `
  <div class="grid" style="padding:12px;">
    <button class="set-card">
      <div class="set-card-img" style="height:120px;position:relative;">
        <span class="retired-tag">${retired}</span>
        <span class="owned-tag"><svg viewBox="0 0 24 24" width="10" height="10"></svg>${owned}</span>
      </div>
      <div class="set-card-body">
        <div class="set-card-name">Jango Fett's Slave I with Bonus Carrying Case</div>
        <div class="set-card-submeta">
          <span class="trust-badge">${trust}</span>
          <span class="ppp-badge">${ppp}</span>
        </div>
      </div>
    </button>
  </div>`;

const CASES = [
  { name: 'English', args: ['RETIRED', 'OWNED', 'LOW TRUST', '$2.09/pc'] },
  // The exact Ukrainian labels that overlapped on a real device.
  { name: 'Ukrainian', args: ['ЗНЯТО З ВИРОБНИЦТВА', 'У ВЛАСНОСТІ', 'НИЗЬКА ДОВІРА', '$2.09/дет'] },
  // German is the longest of the Latin-script locales.
  { name: 'German', args: ['NICHT MEHR ERHÄLTLICH', 'IM BESITZ', 'GERINGES VERTRAUEN', '2,09 $/Teil'] },
];

for (const { name, args } of CASES) {
  test(`catalog card badges do not overlap or overflow (${name})`, async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((html) => { document.body.innerHTML = html; }, MOUNT(...args));
    await page.waitForTimeout(120);

    const retired = await page.locator('.retired-tag').boundingBox();
    const owned = await page.locator('.owned-tag').boundingBox();
    expect(retired, 'retired badge should render').toBeTruthy();
    expect(owned, 'owned badge should render').toBeTruthy();

    expect(retired.x + retired.width, `${name}: RETIRED runs into OWNED`)
      .toBeLessThanOrEqual(owned.x);

    // Neither badge, nor the submeta row, may spill outside the card.
    const card = await page.locator('.set-card').boundingBox();
    for (const [label, box] of [['RETIRED', retired], ['OWNED', owned]]) {
      expect(box.x, `${name}: ${label} spills off the left of the card`)
        .toBeGreaterThanOrEqual(card.x - 0.5);
      expect(box.x + box.width, `${name}: ${label} spills off the right of the card`)
        .toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    const ppp = await page.locator('.ppp-badge').boundingBox();
    expect(ppp.x + ppp.width, `${name}: $/pc badge spills off the card`)
      .toBeLessThanOrEqual(card.x + card.width + 0.5);
  });
}
