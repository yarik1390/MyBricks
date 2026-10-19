import { test, expect } from './fixtures.mjs';

// Empty Vault shelf scene: brick stack, "+" slot for the first set, waving
// minifig. The card must hug the scene (no blank band from the old 3D stage).

async function mockEmptyVault(page) {
  await page.route('**/api/collection', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { items: [], total_value: 0, total_paid: 0, count: 0 } })
    : route.fallback());
}

for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
  test.describe(name, () => {
    test.use({ viewport });

    test('empty shelf card hugs the scene and the slot opens Add', async ({ page }) => {
      await mockEmptyVault(page);
      await page.goto('/#/');
      const card = page.locator('.vault-empty');
      await expect(card.locator('.vault-empty__scene')).toBeVisible();
      await expect(card.locator('.vault-empty__fig')).toBeVisible();
      // Same floating Scan button as a full Vault, never the advisor in its place.
      await expect(page.locator('#bvFab')).toBeVisible();
      await expect(page.locator('#advisorFab')).toBeHidden();
      // Scene + title + body: well under the old ~800px card.
      expect((await card.boundingBox()).height).toBeLessThan(380);

      const brick = card.locator('.vault-empty__brick--1');
      await brick.dispatchEvent('pointerdown');
      await expect(brick).toHaveClass(/is-hop/);

      await card.getByRole('button', { name: 'Your first set' }).click();
      await expect(page).toHaveURL(/#\/add/);
    });
  });
}

test.describe('long labels', () => {
  test.use({ locale: 'uk-UA', viewport: { width: 360, height: 780 } });

  test('translated slot label stays inside the slot', async ({ page }) => {
    await mockEmptyVault(page);
    await page.goto('/#/');
    const slot = page.locator('.vault-empty__slot');
    await expect(slot).toContainText('Ваш перший набір');
    const fits = await slot.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
    expect(fits).toBe(true);
  });
});
