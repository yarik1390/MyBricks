import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_LAYOUT,
  collectionRoomCatalog,
  createRoomLayout,
  isRoomPoseWalkable,
  moveRoomPose,
  normalizeRoomPose,
  roomImageUrl,
  roomPoseForSet,
  selectRoomResidents,
} from '../lib/collection-room.js';

test('room catalog groups active identities and keeps only safe display facts', () => {
  const rows = collectionRoomCatalog([
    {
      set_num: '123', quantity: 2, name: '<ship>', theme: 'Space', year: '2024', num_parts: '810',
      purchase_price: 50, notes: 'private', user_id: 'owner',
    },
    { set_num: '123-1', quantity: 1 },
    { set_num: '456', deleted_at: '2026-01-01' },
    { set_num: '789', _pendingCollectionNew: true },
    { set_num: '999', quantity: 0 },
    { set_num: '666', quantity: 'bad' },
    { set_num: 'bad/../link' },
    null,
  ]);
  assert.deepEqual(rows, [{
    set_num: '123-1', quantity: 3, name: '<ship>', theme: 'Space', image_url: '', year: 2024, pieces: 810,
  }]);
  assert.equal(JSON.stringify(rows).includes('private'), false);
  assert.equal(JSON.stringify(rows).includes('owner'), false);
});

test('image URLs exclude active schemes, credentials and ambiguous relative URLs', () => {
  for (const value of [
    'javascript:alert(1)', 'data:image/svg+xml,x', '//external/image', '/\\external/image',
    'https://user:secret@host/image', ' https://host/image', null,
  ]) assert.equal(roomImageUrl(value), '');
  assert.equal(roomImageUrl('/brand-brick-transparent.png'), '/brand-brick-transparent.png');
  assert.equal(roomImageUrl('https://cdn.example/image.png'), 'https://cdn.example/image.png');
});

test('layout is deterministic, theme-grouped and keeps thousands of sets reachable', () => {
  const catalog = collectionRoomCatalog(Array.from({ length: 2400 }, (_, index) => ({
    name: `Set ${String(index).padStart(4, '0')}`,
    set_num: `${index + 1}-1`,
    theme: `Theme ${Math.floor(index / 37)}`,
  })));
  const first = createRoomLayout(catalog);
  const second = createRoomLayout(catalog);
  assert.deepEqual(first, second);
  assert.equal(first.boxes.length, 2400);
  assert.ok(first.segmentCount > 2);
  assert.ok(first.shelves.every(shelf => shelf.itemIndices.every(index => first.boxes[index].theme === shelf.theme)));
  for (const box of first.boxes) {
    const pose = roomPoseForSet(first, box.set_num);
    assert.ok(pose, `missing reachable pose for ${box.set_num}`);
    assert.equal(isRoomPoseWalkable(first, pose), true);
  }
});

test('teleport poses aim at every shelf row on both sides and survive pose validation', () => {
  const layout = createRoomLayout(Array.from({ length: 24 }, (_, index) => ({
    image_url: '', name: `Set ${index}`, quantity: 1, set_num: `${index + 1}-1`, theme: 'City',
  })));
  for (const box of layout.boxes) {
    const pose = roomPoseForSet(layout, box.set_num);
    assert.deepEqual(normalizeRoomPose(layout, pose), pose);
    const horizontal = Math.abs(box.x - pose.x);
    assert.ok(Math.abs(Math.tan(pose.pitch) - (box.y - ROOM_LAYOUT.eyeHeight) / horizontal) < 1e-10);
    assert.equal(Math.sign(Math.sin(pose.yaw)), box.side);
    assert.equal(pose.z, box.z);
  }
});

test('elapsed movement slides along shelves without tunneling on huge frame deltas', () => {
  const catalog = collectionRoomCatalog(Array.from({ length: 48 }, (_, index) => ({
    set_num: `${index + 1}-1`, theme: 'Space',
  })));
  const layout = createRoomLayout(catalog);
  const start = { pitch: 0, x: -3.3, yaw: 0, z: 2.5 };
  assert.equal(isRoomPoseWalkable(layout, start), true);
  const moved = moveRoomPose(layout, start, { forward: 1, strafe: 1 }, 60 * 60);
  assert.equal(isRoomPoseWalkable(layout, moved), true);
  assert.ok(moved.x >= -ROOM_LAYOUT.aisleHalfWidth + ROOM_LAYOUT.playerRadius);
  assert.ok(moved.z > start.z, 'blocked sideways motion should still slide forward');

  const end = { pitch: 0, x: 0, yaw: 0, z: layout.bounds.maxZ - ROOM_LAYOUT.playerRadius - 0.01 };
  const stopped = moveRoomPose(layout, end, { forward: 1, strafe: 0 }, 10_000);
  assert.equal(isRoomPoseWalkable(layout, stopped), true);
  assert.ok(stopped.z <= layout.bounds.maxZ - ROOM_LAYOUT.playerRadius);
});

test('resident selection is deterministic, nearest-first and never exceeds its budget', () => {
  const layout = createRoomLayout(Array.from({ length: 3000 }, (_, index) => ({
    image_url: '', name: `Set ${index}`, quantity: 1, set_num: `${index + 1}-1`, theme: 'City',
  })));
  const pose = roomPoseForSet(layout, '1500-1');
  const first = selectRoomResidents(layout, pose, 100);
  const second = selectRoomResidents(layout, pose, 100);
  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(new Set(first.map(box => box.index)).size, first.length);
  assert.ok(first.some(box => box.set_num === '1500-1'));
  assert.deepEqual(selectRoomResidents(layout, pose, 0), []);
});

test('right strafe follows camera right for both aisle directions', () => {
  const layout = createRoomLayout([]);
  for (const yaw of [0, Math.PI]) {
    const start = { x: 0, z: 5, pitch: 0, yaw };
    const right = moveRoomPose(layout, start, { strafe: 1 }, 0.1);
    assert.ok((right.x - start.x) * -Math.cos(yaw) > 0);
  }
});
