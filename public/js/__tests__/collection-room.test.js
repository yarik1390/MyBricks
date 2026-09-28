import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROOM_LAYOUT,
  artworkContentBounds,
  artworkEdgePalette,
  detectBoxFaces,
  displayCartonDimensions,
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
  getBoxFrontQuad,
  solveLinear8x8,
  unwarpQuadToCanvas,
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

test('homography unwarping solves linear systems and exposes calibrated packaging quads', () => {
  assert.ok(getBoxFrontQuad('76419-1'));
  assert.ok(getBoxFrontQuad('75258-1'));
  assert.ok(getBoxFrontQuad('10179-1'));
  assert.ok(getBoxFrontQuad('4000020-1'));
  assert.ok(getBoxFrontQuad('71016-1'));
  assert.ok(getBoxFrontQuad('72537-1'));
  assert.equal(getBoxFrontQuad('99999-1'), null);

  // Identity mapping check on 8x8 linear system:
  // mapping [0,0]->[0,0], [1,0]->[1,0], [1,1]->[1,1], [0,1]->[0,1]
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = pts[i];
    const [u, v] = pts[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  const coeffs = solveLinear8x8(A, B);
  assert.equal(coeffs.length, 8);
  assert.ok(Math.abs(coeffs[0] - 1) < 1e-4); // c0 ≈ 1
  assert.ok(Math.abs(coeffs[4] - 1) < 1e-4); // c4 ≈ 1
  assert.ok(Math.abs(coeffs[2]) < 1e-4);      // c2 ≈ 0
  assert.ok(Math.abs(coeffs[5]) < 1e-4);      // c5 ≈ 0

  // Gracefully handles non-canvas environment or invalid inputs
  assert.equal(unwarpQuadToCanvas(null, null, null), false);
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

function paintedImage(width, height, paint) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      const index = (y * width + x) * 4;
      pixels.set([r, g, b, 255], index);
    }
  }
  return pixels;
}

test('artwork bounds crop a studio backdrop, including three-quarter corner wedges', () => {
  // A 40x40 photo: white backdrop, dark carton at x 5..34, y 8..31.
  const flat = paintedImage(40, 40, (x, y) => (x >= 5 && x < 35 && y >= 8 && y < 32 ? [20, 30, 40] : [255, 255, 255]));
  assert.deepEqual(artworkContentBounds(flat, 40, 40), { x0: 5 / 40, y0: 8 / 40, x1: 35 / 40, y1: 32 / 40 });

  // Clip the top-left corner diagonally like an angled box photo: the inner
  // rectangle moves right/down so no backdrop wedge is printed on the face.
  const angled = paintedImage(40, 40, (x, y) => (x >= 5 && x < 35 && y >= 8 && y < 32 && x + y >= 17 ? [20, 30, 40] : [255, 255, 255]));
  const bounds = artworkContentBounds(angled, 40, 40);
  assert.ok(bounds.x0 > 5 / 40 && bounds.y0 > 8 / 40);
  assert.equal(bounds.x1, 35 / 40);
  assert.equal(bounds.y1, 32 / 40);
});

test('artwork bounds keep the full frame for full-bleed art and tiny product renders', () => {
  const fullBleed = paintedImage(20, 20, (x, y) => (x < 10 ? [200, 20, 20] : [20, 20, 200]));
  assert.deepEqual(artworkContentBounds(fullBleed, 20, 20), { x0: 0, y0: 0, x1: 1, y1: 1 });
  const tiny = paintedImage(40, 40, (x, y) => (x >= 18 && x < 22 && y >= 18 && y < 22 ? [0, 0, 0] : [250, 250, 250]));
  assert.deepEqual(artworkContentBounds(tiny, 40, 40), { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.deepEqual(artworkContentBounds(null, 0, 0), { x0: 0, y0: 0, x1: 1, y1: 1 });
});

test('edge palette follows the artwork colours down the fold and flags light prints', () => {
  const split = paintedImage(20, 20, (x, y) => (y < 10 ? [200, 30, 30] : [30, 30, 200]));
  const palette = artworkEdgePalette(split, 20, 20, { x0: 0, y0: 0, x1: 1, y1: 1 }, 2);
  assert.deepEqual(palette.bands, [[200, 30, 30], [30, 30, 200]]);
  assert.equal(palette.light, false);
  const white = paintedImage(10, 10, () => [240, 240, 240]);
  assert.equal(artworkEdgePalette(white, 10, 10).light, true);
  assert.equal(artworkEdgePalette(null, 0, 0).bands.length, 6);
});

function threeQuarterBox(width, height, { mirrored = false } = {}) {
  // White backdrop; a front face (x 30..110, y 20..70) whose bottom edge rises
  // gently to the right, and an end panel (x 10..30) whose bottom rises
  // steeply toward its back edge, like a LEGO three-quarter box render.
  return paintedImage(width, height, (px, y) => {
    const x = mirrored ? width - 1 - px : px;
    const frontBottom = 70 - (x - 30) * 0.05;
    const sideBottom = 60 + (x - 10) * 0.5;
    const inFront = x >= 30 && x <= 110 && y >= 20 - (x - 30) * 0.02 && y <= frontBottom;
    const inSide = x >= 10 && x < 30 && y >= 12 + (x - 10) * 0.4 && y <= sideBottom;
    return inFront || inSide ? [30, 40, 90] : [255, 255, 255];
  });
}

test('box face detection finds the front and end panel of a three-quarter photo', () => {
  const faces = detectBoxFaces(threeQuarterBox(128, 90), 128, 90);
  assert.ok(faces);
  const [topLeft, topRight, bottomRight, bottomLeft] = faces.front;
  // Front-bottom-left sits at the kink, not at the silhouette's outer edge.
  assert.ok(Math.abs(bottomLeft[0] * 128 - 30) <= 3, `bottomLeft ${bottomLeft}`);
  assert.ok(Math.abs(bottomRight[0] * 128 - 111) <= 3, `bottomRight ${bottomRight}`);
  assert.ok(topLeft[0] > 0.18 && topRight[0] > 0.8 && topRight[1] < bottomRight[1]);
  assert.ok(faces.side);
  assert.ok(faces.side[0][0] < bottomLeft[0]);

  const mirrored = detectBoxFaces(threeQuarterBox(128, 90, { mirrored: true }), 128, 90);
  assert.ok(mirrored);
  // Mirrored photos keep TL, TR, BR, BL order in image space.
  assert.ok(mirrored.front[0][0] < mirrored.front[1][0]);
  assert.ok(Math.abs(mirrored.front[2][0] * 128 - (128 - 30)) <= 3);
});

test('box face detection declines straight-on art, full-bleed images and missing data', () => {
  const straight = paintedImage(128, 90, (x, y) => (x >= 10 && x < 118 && y >= 10 && y < 80 ? [30, 40, 90] : [255, 255, 255]));
  assert.equal(detectBoxFaces(straight, 128, 90), null);
  const fullBleed = paintedImage(64, 64, x => (x < 32 ? [200, 20, 20] : [20, 20, 200]));
  assert.equal(detectBoxFaces(fullBleed, 64, 64), null);
  assert.equal(detectBoxFaces(null, 0, 0), null);
});

test('measured packaging dimensions win over photo-calibrated ratios', () => {
  const measured = displayCartonDimensions({ set_num: '72537-1', brickset_dimensions: { width: 38, height: 26, depth: 7 } });
  assert.equal(measured.dimensionBasis, 'measured');
  assert.ok(Math.abs(measured.boxWidth / measured.boxHeight - 38 / 26) < 1e-6);
});

test('box face detection separates an opaque black box from a transparent backdrop', () => {
  const opaque = threeQuarterBox(128, 90);
  for (let i = 0; i < opaque.length; i += 4) {
    const backdrop = opaque[i] === 255;
    opaque.set(backdrop ? [0, 0, 0, 0] : [0, 0, 0, 255], i);
  }
  const faces = detectBoxFaces(opaque, 128, 90);
  assert.ok(faces);
  assert.ok(Math.abs(faces.front[3][0] * 128 - 30) <= 3);
  const bounds = artworkContentBounds(opaque, 128, 90);
  assert.ok(bounds.x0 > 0.05 && bounds.x1 < 0.9, `bounds ${JSON.stringify(bounds)}`);
});
