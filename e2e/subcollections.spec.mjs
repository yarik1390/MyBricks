import { test, expect } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';

const id = '11111111-1111-4111-8111-111111111111';
const holdings = [
  { id: 1, set_num: '123-1', name: 'Display ship', quantity: 3, purchase_price: 0, purchased_at: '2025-01-01', is_complete: true },
  { id: 2, set_num: '456-1', name: 'Winter train', quantity: 1, purchase_price: null, purchased_at: null, is_complete: false },
];
async function stubLists(page, rows = []) {
  await page.route('**/api/collection', route => route.fulfill({ json: { items: holdings, count: 2 } }));
  let fail = false;
  let conflict = false;
  await page.route('**/api/subcollections**', route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: { subcollections: rows } });
    if (fail || conflict) return route.fulfill({ status: conflict ? 409 : 500, json: { error: 'failed' } });
    const key = new URL(route.request().url()).pathname.split('/').pop();
    if (method === 'DELETE') { rows = rows.filter(row => row.id !== key); return route.fulfill({ json: { ok: true } }); }
    const body = route.request().postDataJSON();
    const row = { ...body, id: key, revision: body.revision + 1 };
    rows = [...rows.filter(row => row.id !== key), row];
    return route.fulfill({ json: { subcollection: row } });
  });
  return { setFail: value => { fail = value; }, setConflict: value => { conflict = value; } };
}

test('named lists save, deduplicate, link missing records, export, retain failed drafts, and delete only the list', async ({ page }) => {
  const server = await stubLists(page);
  await page.goto('/#/');
  await page.getByRole('link', { name: 'Collections & insights' }).click();
  await expect(page.getByText('Missing purchase cost: 1', { exact: true })).toBeVisible();
  await page.getByText('Missing purchase cost: 1', { exact: true }).click();
  await expect(page.locator('.collection-insights a').first()).toHaveAttribute('href', '#/set/456-1');
  await page.locator('#collectionCreate').click();
  await page.locator('#collectionName').fill('Space <display>');
  await page.locator('#collectionOwnedSet').selectOption('123-1');
  await expect(page.locator('#collectionTargets')).toHaveValue('123-1');
  await page.locator('#collectionTargets').fill('123, 123-1, 999');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#collectionLists')).toContainText('1 of 2 sets owned');
  await expect(page.locator('#collectionLists display')).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.locator('#collectionExport').click();
  const data = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(data.subcollections[0].set_nums).toEqual(['123-1', '999-1']);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#collectionName').fill('Revised');
  server.setConflict(true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#collectionFormError')).toContainText('changed elsewhere');
  await expect(page.locator('#collectionName')).toHaveValue('Revised');
  server.setConflict(false);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#collectionLists h2')).toHaveText('Revised');
  await page.reload();
  await expect(page.locator('#collectionLists h2')).toHaveText('Revised');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('#collectionDelete').click();
  server.setFail(true);
  await page.locator('#collectionConfirmDelete').click();
  await expect(page.locator('#collectionFormError')).toContainText('Could not');
  await expect(page.locator('#collectionLists h2')).toHaveText('Revised');
  server.setFail(false);
  await page.locator('#collectionConfirmDelete').click();
  await expect(page.locator('#collectionLists')).toContainText('first list');
  await expect(page.getByText('2 distinct sets owned', { exact: true })).toBeVisible();
});

test('guest lists persist without network writes and storage failures preserve the previous list', async ({ page }) => {
  await page.addInitScript(rows => {
    localStorage.removeItem('bv_session');
    localStorage.setItem('bv_guest_collection', JSON.stringify(rows));
    localStorage.setItem('bv_guest_backfill_v', '2');
  }, holdings);
  let requests = 0;
  await page.route('**/api/subcollections**', route => { requests++; return route.abort(); });
  await page.goto('/#/collections');
  await page.locator('#collectionCreate').click();
  await page.locator('#collectionName').fill('My shelf');
  await page.locator('#collectionAddOwned').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#collectionLists')).toContainText('2 of 2 sets owned');
  await page.reload();
  await expect(page.locator('#collectionLists h2')).toHaveText('My shelf');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'bv_guest_subcollections') throw new Error('full');
      return original.call(this, key, value);
    };
  });
  await page.locator('#collectionName').fill('Unsaved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#collectionFormError')).toContainText('Could not');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bv_guest_subcollections'))[0].name)).toBe('My shelf');
  expect(requests).toBe(0);
});

test('mobile organizer fits the viewport and delayed saves cannot paint after an account switch', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubLists(page, [{ id, name: 'Space shelf', set_nums: ['123-1', '999-1'], revision: 1 }]);
  await page.goto('/#/collections');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'audit/subcollections-mobile.png', fullPage: true });
  await page.locator('#collectionName').blur();
  let release;
  await page.route(`**/api/subcollections/${id}`, async route => {
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { subcollection: { id, name: 'Private', set_nums: [], revision: 2 } } });
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#collectionName')).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  await page.evaluate(async () => {
    const { saveSession } = await import('/js/api.js');
    saveSession({ access_token: `x.${btoa(JSON.stringify({ sub: 'new-account' }))}.x` });
  });
  release();
  await expect(page.locator('#subcollectionsPage')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Private');
});
