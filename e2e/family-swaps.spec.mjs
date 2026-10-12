import { test, expect } from './fixtures.mjs';

test.use({ viewport: { width: 390, height: 844 } });

const familyView = {
  household: { name: 'The Smiths', role: 'owner', invite_code: 'ABCD2345', max_members: 8 },
  members: [
    { member_id: 1, name: 'You', role: 'owner', is_me: true, sets: 2, value: 1000 },
    { member_id: 2, name: 'Alex', role: 'member', is_me: false, sets: 3, value: 450 },
  ],
  vault: {
    total_sets: 5, total_value: 1450, shared: 1,
    sets: [
      { set_num: '75313-1', name: 'AT-AT', quantity: 1, value: 900, owners: [{ name: 'You', quantity: 1 }] },
      { set_num: '10497-1', name: 'Galaxy Explorer', quantity: 3, value: 300, owners: [{ name: 'You', quantity: 1 }, { name: 'Alex', quantity: 2 }] },
    ],
  },
};

test('family vault: join with a code, then see the combined vault and filter shared sets', async ({ page }) => {
  let joined = false;
  await page.route('**/api/family', route => route.fulfill({ json: joined ? familyView : { household: null } }));
  await page.route('**/api/family/join', route => { joined = true; return route.fulfill({ json: familyView }); });
  await page.goto('/#/family');
  const fam = page.locator('#familyPage');
  await fam.locator('#famCode').fill('abcd2345');
  await fam.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(fam.getByRole('heading', { name: 'The Smiths' })).toBeVisible();
  await expect(fam.locator('.bv-family__member')).toHaveCount(2);
  await expect(fam.locator('#famInvite')).toHaveText('ABCD2345');
  await expect(fam.locator('.bv-family__set')).toHaveCount(2);
  await fam.getByRole('button', { name: 'Owned by more than one of you' }).click();
  await expect(page.locator('.bv-family__set')).toHaveCount(1);
  await expect(page.locator('.bv-family__set')).toContainText('You, Alex ×2');
});

test('swaps: a match leads to a swap request with both sides and a note', async ({ page }) => {
  await page.route('**/api/swaps', route => route.fulfill({ json: {
    open: true, has_handle: true,
    for_trade: [{ set_num: '10497-1', name: 'Galaxy Explorer' }],
    matches: [{ handle: 'ann', name: 'Ann', they_have: [{ set_num: '6086-1', name: 'Black Knight Castle' }], they_want: [{ set_num: '10497-1', name: 'Galaxy Explorer' }] }],
    requests: [],
  } }));
  let sent = null;
  await page.route('**/api/swaps/requests', route => { sent = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ok: true, id: 1 } }); });
  await page.goto('/#/swaps');
  const sw = page.locator('#swapsPage');
  await expect(sw.locator('.bv-swaps__match')).toContainText('Both ways');
  await sw.getByRole('button', { name: 'Propose a swap' }).click();
  await page.locator('#swapNote').fill('Discord: mum#1');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect.poll(() => sent).toEqual({ to: 'ann', give: ['10497-1'], get: ['6086-1'], message: 'Discord: mum#1' });
});
