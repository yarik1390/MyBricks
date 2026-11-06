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
  // Contact details are refused before the swap is accepted.
  await page.locator('#swapNote').fill('Discord: mum#1');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByText('Keep contact details out until the swap is accepted.', { exact: false })).toBeVisible();
  expect(sent).toBeNull();
  await page.locator('#swapNote').fill('Box is sealed');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect.poll(() => sent).toEqual({ to: 'ann', give: ['10497-1'], get: ['6086-1'], message: 'Box is sealed' });
});

const acceptedRequest = {
  id: 7, direction: 'outgoing', status: 'accepted', with_handle: 'vladus', with_name: 'vladus',
  i_give: [], i_get: [{ set_num: '30735-1', name: 'Hot Rod Car' }], message: null, reply: 'A',
  unread: 1, can_chat: true, i_marked_done: false, they_marked_done: false, with_swaps_done: 2,
};

test('swaps: chat on an accepted swap, warn before sharing contact details, then delete it', async ({ page }) => {
  let deleted = false;
  const posts = [];
  await page.route('**/api/swaps', route => route.fulfill({ json: {
    open: true, has_handle: true, for_trade: [], matches: [], hidden: [],
    requests: deleted ? [] : [acceptedRequest],
  } }));
  await page.route('**/api/swaps/requests/7/messages', route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posts.push(body);
      return route.fulfill({ status: 201, json: { ok: true, message: { id: 2 + posts.length, mine: true, body: body.body, created_at: '2026-11-06 21:00:00' } } });
    }
    return route.fulfill({ json: { id: 7, status: 'accepted', with_handle: 'vladus', with_name: 'vladus', can_send: true, blocked: false,
      messages: [{ id: 1, mine: false, body: 'Hi! Still have the Hot Rod?', created_at: '2026-11-06 20:00:00' }] } });
  });
  await page.route('**/api/swaps/requests/7', route => { deleted = route.request().method() === 'DELETE'; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/#/swaps');
  const sw = page.locator('#swapsPage');
  await expect(sw.locator('.bv-swaps__req')).toContainText('2 swaps done');
  await sw.getByRole('button', { name: 'Chat (1)' }).click();
  await expect(page.locator('#swapChatLog')).toContainText('Still have the Hot Rod?');
  await page.locator('#swapChatText').fill('Yes, sealed');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('#swapChatLog')).toContainText('Yes, sealed');
  await page.locator('#swapChatText').fill('my email is me@example.com');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Share contact details?')).toBeVisible();
  await page.getByRole('button', { name: 'Send anyway' }).click();
  await expect.poll(() => posts).toEqual([{ body: 'Yes, sealed' }, { body: 'my email is me@example.com', confirm_contact: true }]);
  await page.locator('[data-bv-sheet-close]').first().click();
  await sw.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('button', { name: 'Delete from my list' }).click();
  await expect(page.getByText('This calls off the swap for both of you')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deleted).toBe(true);
  await expect(sw.locator('.bv-swaps__req')).toHaveCount(0);
});
