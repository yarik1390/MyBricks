import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

test('lot checker finds sets in a pasted listing and gives a verdict', async ({ page }) => {
  await page.route('**/api/lot/parse', route => route.fulfill({ json: { sets: [
    { set_num: '75313-1', name: 'AT-AT', year: 2021, image_url: null },
    { set_num: '6086-1', name: 'Black Knight Castle', year: 1992, image_url: null },
  ] } }));
  let sent = null;
  await page.route('**/api/lot/value', route => {
    sent = route.request().postDataJSON();
    return route.fulfill({ json: {
      items: [
        { set_num: '75313-1', condition: 'sealed', qty: 1, value: 900 },
        { set_num: '6086-1', condition: 'used', qty: 1, value: 300 },
      ],
      total: 1200, resale_keep: 1044, unpriced: 0, asking_usd: 500, verdict: 'great', margin: 544,
    } });
  });
  await page.goto('/#/lot');
  const lot = page.locator('#lotPage');
  await lot.locator('#lotText').fill('LEGO lot: 75313 AT-AT and castle 6086, $500');
  await lot.getByRole('button', { name: 'Find sets in the text' }).click();
  await expect(lot.locator('.bv-lot__item')).toHaveCount(2);
  await lot.locator('.bv-lot__item').nth(1).locator('[data-lot-cond]').selectOption('used');
  await lot.locator('#lotAsking').fill('500');
  await lot.getByRole('button', { name: 'Check this lot' }).click();
  await expect(page.locator('#lotResult')).toContainText('Great deal');
  await expect(page.locator('#lotResult')).toContainText('$1,044');
  expect(sent.items).toEqual([
    { set_num: '75313-1', condition: 'sealed', qty: 1 },
    { set_num: '6086-1', condition: 'used', qty: 1 },
  ]);
  expect(sent.asking_usd).toBe(500);
});
