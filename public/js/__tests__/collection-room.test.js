import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_LAYOUT,
  boxArtworkPresentation,
  classifyBoxArtworkUrl,
  collectionRoomCatalog,
  createRoomLayout,
  isRoomPoseWalkable,
  moveRoomPose,
  normalizeRoomPose,
  roomImageUrl,
  roomPoseForSet,
  selectRoomResidents,
} from '../lib/collection-room.js';

test('room geometry keeps cartons proportional to shelf bays and standing eye height', () => {
  assert.ok(ROOM_LAYOUT.boxHeight < ROOM_LAYOUT.eyeHeight);
  const layout = createRoomLayout([{ set_num: '100-1', name: 'Scale check', theme: 'City', quantity: 1 }]);
  assert.ok(Math.abs(layout.boxes[0].y - (0.43 + layout.boxes[0].boxHeight / 2)) < 1e-9);
});

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
    set_num: '123-1', quantity: 3, name: '<ship>', theme: 'Space', image_url: '', box_image_url: 'https://img.bricklink.com/ItemImage/ON/0/123-1.png', box_image_kind: 'package-photo', packaging_type: '', year: 2024, pieces: 810,
  }]);
  assert.equal(JSON.stringify(rows).includes('private'), false);
  assert.equal(JSON.stringify(rows).includes('owner'), false);
});

test('box artwork rejects boxprod composites and classifies only explicit front assets as flat', () => {
  const row = collectionRoomCatalog([{
    set_num: '72537-1',
    name: 'Composite regression',
    quantity: 1,
    image_url: 'https://images.example/72537-model.png',
    brickset_image_urls: JSON.stringify([
      'https://images.brickset.com/sets/AdditionalImages/72537-1/72537_boxprod_v39.jpg',
      'https://images.brickset.com/sets/AdditionalImages/72537-1/72537_box1_na.jpg',
    ]),
  }])[0];
  assert.equal(row.box_image_url, 'https://images.brickset.com/sets/AdditionalImages/72537-1/72537_box1_na.jpg');
  assert.equal(row.box_image_kind, 'package-photo');
  assert.equal(classifyBoxArtworkUrl('https://images.example/72537_boxprod_v39.jpg'), 'composite');
  assert.equal(classifyBoxArtworkUrl('https://images.example/72537_box_front.jpg'), 'flat-package-face');
  assert.equal(classifyBoxArtworkUrl('https://images.example/not-bricklink.jpg'), 'package-photo');
});

test('shelf and inspect share the catalog artwork classification and contain mapping', () => {
  const [item] = collectionRoomCatalog([{
    set_num: '21061-1',
    name: 'Angled carton',
    quantity: 1,
    image_url: 'https://images.example/model.png',
  }]);
  assert.deepEqual(boxArtworkPresentation(item), {
    url: 'https://img.bricklink.com/ItemImage/ON/0/21061-1.png',
    kind: 'package-photo',
    fit: 'contain',
  });
  assert.deepEqual(boxArtworkPresentation({
    box_image_url: 'https://images.example/composite_boxprod.jpg',
    image_url: 'https://images.example/model.png',
  }), {
    url: 'https://images.example/model.png',
    kind: 'product-image',
    fit: 'contain',
  });
  assert.deepEqual(boxArtworkPresentation({
    box_image_url: 'https://images.example/unlabelled.jpg',
    box_image_kind: 'composite',
    image_url: 'https://images.example/model.png',
  }), {
    url: 'https://images.example/model.png',
    kind: 'product-image',
    fit: 'contain',
  });
});

test('image URLs exclude active schemes, credentials and ambiguous relative URLs', () => {
  for (const value of [
    'javascript:alert(1)', 'data:image/svg+xml,x', '//external/image', '/\\external/image',
    'https://user:secret@host/image', ' https://host/image', null,
  ]) assert.equal(roomImageUrl(value), '');
  assert.equal(roomImageUrl('/brand-brick-transparent.png'), '/brand-brick-transparent.png');
  assert.equal(roomImageUrl('https://cdn.example/image.png'), 'https://cdn.example/image.png');
});

test('layout uses measured packaging dimensions and deterministic bounded estimates', () => {
  const catalog = collectionRoomCatalog([
    { set_num: '1-1', name: 'Wide measured', theme: 'City', pieces: 900, packaging_type: 'Box', brickset_dimensions: JSON.stringify({ width: 58, height: 37, depth: 8.7 }) },
    { set_num: '2-1', name: 'Small estimate', theme: 'City', pieces: 90, packaging_type: 'Box' },
    { set_num: '3-1', name: 'Large estimate', theme: 'City', pieces: 2200, packaging_type: 'Box' },
  ]);
  const layout = createRoomLayout(catalog);
  const measured = layout.boxes.find(box => box.set_num === '1-1');
  const small = layout.boxes.find(box => box.set_num === '2-1');
  const large = layout.boxes.find(box => box.set_num === '3-1');
  assert.equal(measured.dimensionBasis, 'measured');
  assert.equal(small.dimensionBasis, 'estimated');
  assert.equal(large.dimensionBasis, 'estimated');
  assert.ok(measured.boxWidth > measured.boxHeight * 1.5);
  assert.notDeepEqual(
    [small.boxWidth, small.boxHeight, small.boxDepth],
    [large.boxWidth, large.boxHeight, large.boxDepth],
  );
  for (const box of layout.boxes) {
    assert.ok(box.boxWidth <= ROOM_LAYOUT.boxWidth + 1e-9);
    assert.ok(box.boxHeight <= ROOM_LAYOUT.boxHeight + 1e-9);
    assert.ok(box.boxDepth <= ROOM_LAYOUT.boxDepth + 1e-9);
    assert.ok(Math.abs((box.y - box.boxHeight / 2) - 0.43) < 1e-9);
  }
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
