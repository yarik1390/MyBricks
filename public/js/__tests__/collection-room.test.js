import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRoomCatalog, collectionRoomPage, roomImageUrl } from '../lib/collection-room.js';

test('room groups active set identities without exposing private holding fields', () => {
  const rows = collectionRoomCatalog([
    { set_num: '123', quantity: 2, name: '<ship>', theme: 'Space', purchase_price: 50, notes: 'private', user_id: 'owner' },
    { set_num: '123-1', quantity: 1 },
    { set_num: '456', deleted_at: '2026-01-01' },
    { set_num: '789', _pendingCollectionNew: true },
    { set_num: '999', quantity: 0 },
    { set_num: '666', quantity: 'bad' },
    { set_num: 'bad/../link' }, null,
  ]);
  assert.deepEqual(rows, [{ set_num: '123-1', quantity: 3, name: '<ship>', theme: 'Space', image_url: '' }]);
});

test('all theme shelves remain reachable with at most twelve images on a page', () => {
  const rows = collectionRoomCatalog(Array.from({ length: 70 }, (_, i) => ({ set_num: String(i + 1), theme: `Theme ${i % 7}` })));
  const first = collectionRoomPage(rows);
  const seen = [];
  for (let page = 0; page < first.pages; page++) {
    const result = collectionRoomPage(rows, null, page);
    assert.ok(result.shelves.length <= 3);
    for (const shelf of result.shelves) {
      assert.ok(shelf.items.length <= 4);
      assert.ok(shelf.items.every(item => item.theme === shelf.theme));
      seen.push(...shelf.items.map(item => item.set_num));
    }
  }
  assert.equal(new Set(seen).size, 70);
  assert.equal(collectionRoomPage(rows, 'Theme 1', 999).page, 0);
  assert.equal(collectionRoomPage(rows, 'missing').count, 0);
});

test('image URLs exclude active schemes, credentials and ambiguous relative URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,x', '//external/image', '/\\external/image', 'https://user:secret@host/image', ' https://host/image', null]) assert.equal(roomImageUrl(value), '');
  assert.equal(roomImageUrl('/brand-brick-transparent.png'), '/brand-brick-transparent.png');
  assert.equal(roomImageUrl('https://cdn.example/image.png'), 'https://cdn.example/image.png');
});
