import { canonicalSetNum } from './subcollections.js';

export const ROOM_LAYOUT = Object.freeze({
  aisleHalfWidth: 3.75,
  // Display cartons are scaled against the 1.32–1.58 m shelf spacing below;
  // they are not person-height blocks. Depth remains visible from the aisle.
  // Maximum display-carton envelope. Individual cartons derive bounded
  // dimensions from measured Brickset packaging data or catalog facts.
  boxDepth: 0.42,
  boxHeight: 0.86,
  boxWidth: 1.42,
  boxesPerShelf: 12,
  ceilingHeight: 6.2,
  eyeHeight: 1.68,
  movementSpeed: 4.2,
  playerRadius: 0.32,
  roomHalfWidth: 5.25,
  segmentLength: 7.2,
  shelfCenterX: 4.08,
});

export const ROOM_RESIDENT_BOX_LIMIT = 100;
export const ROOM_TEXTURE_LIMIT = 60;

const MAX_FRAME_SECONDS = 0.2;
const MAX_COLLISION_STEP = 0.08;
const MAX_PITCH = Math.PI * 0.44;

// This view uses catalog facts only. Never copy costs, notes or account IDs
// into scene objects, textures or links.
export function roomImageUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\\]/.test(value)) return '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : '';
  } catch {
    return '';
  }
}

function optionalInteger(value, minimum, maximum) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null;
}

function dimensionNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function measuredDimensions(value) {
  try {
    const dimensions = typeof value === 'string' ? JSON.parse(value) : value;
    if (!dimensions || typeof dimensions !== 'object') return null;
    const width = dimensionNumber(dimensions.width);
    const height = dimensionNumber(dimensions.height);
    const depth = dimensionNumber(dimensions.depth);
    if (!width || !height || !depth) return null;
    return { width, height, depth };
  } catch {
    return null;
  }
}

export function displayCartonDimensions(item) {
  const measured = measuredDimensions(item.brickset_dimensions);
  let aspectWidth;
  let aspectHeight;
  let aspectDepth;
  let basis;
  if (measured) {
    aspectWidth = measured.width;
    aspectHeight = measured.height;
    aspectDepth = measured.depth;
    basis = 'measured';
  } else {
    // Catalog product imagery is not treated as a package scan. When physical
    // measurements are absent, piece count and packaging type only choose one
    // of a few bounded, deterministic display silhouettes.
    const pieces = optionalInteger(item.pieces ?? item.num_parts, 0, 1_000_000) ?? 0;
    const packaging = String(item.packaging_type || '').trim().toLowerCase();
    if (/polybag|foil|paper bag|plastic bag/.test(packaging)) {
      [aspectWidth, aspectHeight, aspectDepth] = [1.0, 1.18, 0.14];
    } else if (/tin|canister|tub/.test(packaging)) {
      [aspectWidth, aspectHeight, aspectDepth] = [0.9, 1.0, 0.66];
    } else if (pieces > 1800) {
      [aspectWidth, aspectHeight, aspectDepth] = [1.8, 0.86, 0.48];
    } else if (pieces > 750) {
      [aspectWidth, aspectHeight, aspectDepth] = [1.55, 0.88, 0.4];
    } else if (pieces > 250) {
      [aspectWidth, aspectHeight, aspectDepth] = [1.32, 0.9, 0.34];
    } else {
      [aspectWidth, aspectHeight, aspectDepth] = [0.92, 1.0, 0.28];
    }
    basis = 'estimated';
  }
  const scale = Math.min(
    ROOM_LAYOUT.boxWidth / aspectWidth,
    ROOM_LAYOUT.boxHeight / aspectHeight,
    ROOM_LAYOUT.boxDepth / aspectDepth,
  );
  return {
    boxWidth: aspectWidth * scale,
    boxHeight: aspectHeight * scale,
    boxDepth: aspectDepth * scale,
    dimensionBasis: basis,
  };
}

const BOX_ARTWORK_KINDS = new Set(['flat-package-face', 'package-photo', 'product-image', 'composite']);

function bricksetImageUrls(value) {
  try {
    const urls = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(urls) ? urls.map(roomImageUrl).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const CALIBRATED_FRONT_QUADS = Object.freeze({
  '76419-1': [[0.1464, 0.4326], [0.7536, 0.213], [0.8609, 0.6304], [0.2609, 0.8587]],
  '75258-1': [[0.0986, 0.1831], [0.7884, 0.0901], [0.9043, 0.8023], [0.213, 0.9012]],
  '10179-1': [[0.0449, 0.0508], [0.9551, 0.0938], [0.9551, 0.9414], [0.0449, 0.8945]],
  '4000020-1': [[0.0493, 0.0615], [0.9493, 0.0615], [0.9493, 0.9345], [0.0493, 0.9345]],
});

export function getBoxFrontQuad(setNum) {
  const key = canonicalSetNum(setNum);
  return CALIBRATED_FRONT_QUADS[key] || null;
}

export function solveLinear8x8(A, B) {
  const n = 8;
  const M = A.map((row, i) => [...row, B[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r;
    }
    const temp = M[i];
    M[i] = M[maxRow];
    M[maxRow] = temp;
    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-10) continue;
    for (let j = i; j <= n; j++) M[i][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r !== i) {
        const factor = M[r][i];
        for (let j = i; j <= n; j++) M[r][j] -= factor * M[i][j];
      }
    }
  }
  return M.map(row => row[n]);
}

export function unwarpQuadToCanvas(srcImage, normQuad, targetCanvas) {
  if (!srcImage || !targetCanvas || !Array.isArray(normQuad) || normQuad.length !== 4) return false;
  const srcW = srcImage.naturalWidth || srcImage.width;
  const srcH = srcImage.naturalHeight || srcImage.height;
  const dstW = targetCanvas.width;
  const dstH = targetCanvas.height;
  if (!srcW || !srcH || !dstW || !dstH) return false;

  const offscreen = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!offscreen) return false;
  offscreen.width = srcW;
  offscreen.height = srcH;
  const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
  if (!offCtx) return false;
  offCtx.drawImage(srcImage, 0, 0);

  let srcImageData;
  try {
    srcImageData = offCtx.getImageData(0, 0, srcW, srcH);
  } catch {
    return false;
  }
  const srcPixels = srcImageData.data;

  const srcQuad = normQuad.map(([nx, ny]) => [nx * srcW, ny * srcH]);
  const dstQuad = [[0, 0], [dstW, 0], [dstW, dstH], [0, dstH]];

  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dstQuad[i];
    const [u, v] = srcQuad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }

  const coeffs = solveLinear8x8(A, B);
  const [c0, c1, c2, c3, c4, c5, c6, c7] = coeffs;

  const targetCtx = targetCanvas.getContext('2d');
  if (!targetCtx) return false;
  const targetImageData = targetCtx.createImageData(dstW, dstH);
  const dstPixels = targetImageData.data;

  for (let dy = 0; dy < dstH; dy++) {
    const dyOffset = dy * dstW * 4;
    for (let dx = 0; dx < dstW; dx++) {
      const denom = c6 * dx + c7 * dy + 1;
      if (Math.abs(denom) < 1e-10) continue;
      const su = (c0 * dx + c1 * dy + c2) / denom;
      const sv = (c3 * dx + c4 * dy + c5) / denom;

      const u0 = Math.floor(su);
      const v0 = Math.floor(sv);
      const u1 = u0 + 1;
      const v1 = v0 + 1;

      if (u0 >= 0 && u1 < srcW && v0 >= 0 && v1 < srcH) {
        const fu = su - u0;
        const fv = sv - v0;
        const w00 = (1 - fu) * (1 - fv);
        const w10 = fu * (1 - fv);
        const w01 = (1 - fu) * fv;
        const w11 = fu * fv;

        const idx00 = (v0 * srcW + u0) * 4;
        const idx10 = (v0 * srcW + u1) * 4;
        const idx01 = (v1 * srcW + u0) * 4;
        const idx11 = (v1 * srcW + u1) * 4;

        const outIdx = dyOffset + dx * 4;
        dstPixels[outIdx]     = w00 * srcPixels[idx00]     + w10 * srcPixels[idx10]     + w01 * srcPixels[idx01]     + w11 * srcPixels[idx11];
        dstPixels[outIdx + 1] = w00 * srcPixels[idx00 + 1] + w10 * srcPixels[idx10 + 1] + w01 * srcPixels[idx01 + 1] + w11 * srcPixels[idx11 + 1];
        dstPixels[outIdx + 2] = w00 * srcPixels[idx00 + 2] + w10 * srcPixels[idx10 + 2] + w01 * srcPixels[idx01 + 2] + w11 * srcPixels[idx11 + 2];
        dstPixels[outIdx + 3] = 255;
      }
    }
  }

  targetCtx.putImageData(targetImageData, 0, 0);
  return true;
}

export function classifyBoxArtworkUrl(value, { packaging = true } = {}) {
  const url = roomImageUrl(value);
  if (!url) return '';
  if (/boxprod/i.test(url)) return 'composite';
  if (!packaging) return 'product-image';
  if (/(?:box[_-]?front|boxfront|[_-]front)(?:[._-]|$)/i.test(url)) return 'flat-package-face';
  // BrickLink ON and Brickset box photographs are useful packaging evidence,
  // but they are commonly angled. They must not be stretched or described as
  // a normalized front face without source-provided corner metadata.
  return 'package-photo';
}

export function boxArtworkPresentation(row, { useProductFallback = true } = {}) {
  if (!row) return { url: '', kind: '', fit: 'contain' };
  const boxUrl = roomImageUrl(row.box_image_url);
  const declaredKind = BOX_ARTWORK_KINDS.has(row.box_image_kind) ? row.box_image_kind : '';
  const classifiedKind = classifyBoxArtworkUrl(boxUrl);
  if (boxUrl && classifiedKind !== 'composite' && declaredKind !== 'composite') {
    return { url: boxUrl, kind: declaredKind || classifiedKind, fit: 'contain' };
  }
  const productUrl = useProductFallback ? roomImageUrl(row.image_url) : '';
  return { url: productUrl, kind: productUrl ? 'product-image' : '', fit: 'contain' };
}

export function resolveBoxArtwork(row) {
  if (!row) return { url: '', kind: '' };
  const explicitUrl = roomImageUrl(row.box_image_url);
  const explicitKind = classifyBoxArtworkUrl(explicitUrl);
  if (explicitUrl && explicitKind !== 'composite') return { url: explicitUrl, kind: explicitKind };

  const additional = bricksetImageUrls(row.brickset_image_urls);
  const flatFace = additional.find(url => classifyBoxArtworkUrl(url) === 'flat-package-face');
  if (flatFace) return { url: flatFace, kind: 'flat-package-face' };

  // boxprod assets are composites (typically a model render plus a small box),
  // not package faces. Prefer an actual box photograph, otherwise use the
  // existing BrickLink packaging photo fallback.
  const boxPhoto = additional.find(url => classifyBoxArtworkUrl(url) === 'package-photo' && /(?:box1|[_-]box(?:[._-]|$))/i.test(url));
  if (boxPhoto) return { url: boxPhoto, kind: 'package-photo' };

  const setNum = canonicalSetNum(row.set_num);
  if (setNum) return { url: `https://img.bricklink.com/ItemImage/ON/0/${setNum}.png`, kind: 'package-photo' };
  const productUrl = roomImageUrl(row.image_url);
  return { url: productUrl, kind: productUrl ? 'product-image' : '' };
}

export function resolveBoxImageUrl(row) {
  return resolveBoxArtwork(row).url;
}

export function resolveBoxBackImageUrl(row) {
  if (!row) return '';
  if (typeof row.box_back_url === 'string' && row.box_back_url) {
    return roomImageUrl(row.box_back_url);
  }
  if (row.brickset_image_urls) {
    try {
      const urls = typeof row.brickset_image_urls === 'string' ? JSON.parse(row.brickset_image_urls) : row.brickset_image_urls;
      if (Array.isArray(urls)) {
        const match = urls.find(u => typeof u === 'string' && /(box_back|_back\b|Back[A-Z]|box5)/i.test(u));
        if (match) return roomImageUrl(match);
      }
    } catch {}
  }
  return '';
}

export function collectionRoomCatalog(holdings = []) {
  const distinct = new Map();
  for (const row of Array.isArray(holdings) ? holdings : []) {
    if (!row || row.deleted_at || row._pendingCollectionNew) continue;
    const quantity = Number(row.quantity ?? 1);
    const setNum = canonicalSetNum(row.set_num);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(setNum)) continue;
    const existing = distinct.get(setNum);
    if (existing) {
      const combinedQuantity = existing.quantity + quantity;
      if (Number.isSafeInteger(combinedQuantity)) existing.quantity = combinedQuantity;
      continue;
    }
    const artwork = resolveBoxArtwork(row);
    const item = {
      set_num: setNum,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : setNum,
      theme: typeof row.theme === 'string' ? row.theme.trim() : '',
      image_url: roomImageUrl(row.image_url),
      box_image_url: artwork.url,
      box_image_kind: artwork.kind,
      packaging_type: typeof row.packaging_type === 'string' ? row.packaging_type.trim() : '',
      quantity,
    };
    const dimensions = measuredDimensions(row.brickset_dimensions);
    if (dimensions) item.brickset_dimensions = dimensions;
    const backUrl = resolveBoxBackImageUrl(row);
    if (backUrl) item.box_back_url = backUrl;
    const year = optionalInteger(row.year, 1932, 2200);
    const pieces = optionalInteger(row.pieces ?? row.num_parts, 0, 1_000_000);
    if (year !== null) item.year = year;
    if (pieces !== null) item.pieces = pieces;
    distinct.set(setNum, item);
  }
  return [...distinct.values()].sort(
    (a, b) => a.theme.localeCompare(b.theme) || a.name.localeCompare(b.name) || a.set_num.localeCompare(b.set_num),
  );
}

function themeKey(item) {
  return item.theme || '';
}

export function createRoomLayout(catalog = []) {
  const source = Array.isArray(catalog) ? catalog : [];
  const shelves = [];
  const boxes = [];
  const colliders = [];
  const setIndex = new Map();
  let cursor = 0;
  let shelfIndex = 0;

  while (cursor < source.length) {
    const theme = themeKey(source[cursor]);
    let end = cursor + 1;
    while (end < source.length && themeKey(source[end]) === theme) end++;
    for (let themeOffset = cursor; themeOffset < end; themeOffset += ROOM_LAYOUT.boxesPerShelf) {
      const segmentIndex = Math.floor(shelfIndex / 2);
      const side = shelfIndex % 2 === 0 ? -1 : 1;
      const centerZ = (segmentIndex + 0.5) * ROOM_LAYOUT.segmentLength;
      const shelf = {
        centerZ,
        index: shelfIndex,
        itemIndices: [],
        segmentIndex,
        side,
        theme,
      };
      const shelfEnd = Math.min(end, themeOffset + ROOM_LAYOUT.boxesPerShelf);
      for (let itemIndex = themeOffset; itemIndex < shelfEnd; itemIndex++) {
        const slot = itemIndex - themeOffset;
        const column = slot % 4;
        const row = Math.floor(slot / 4);
        const item = source[itemIndex];
        const dimensions = displayCartonDimensions(item);
        const box = {
          ...item,
          ...dimensions,
          index: boxes.length,
          row,
          shelfIndex,
          side,
          x: side * ROOM_LAYOUT.shelfCenterX,
          // Centers sit on the structural shelf decks at 0.35/1.67/3.25 m,
          // with a small clearance. This keeps cartons grounded and leaves
          // believable air above them instead of filling each bay wall-to-wall.
          y: 0.35 + dimensions.boxHeight / 2 + 0.08 + row * 1.58,
          z: centerZ + (column - 1.5) * 1.55,
        };
        setIndex.set(item.set_num, box.index);
        shelf.itemIndices.push(box.index);
        boxes.push(box);
      }
      shelves.push(shelf);
      colliders.push({
        maxX: side < 0 ? -ROOM_LAYOUT.aisleHalfWidth : ROOM_LAYOUT.roomHalfWidth,
        maxZ: (segmentIndex + 1) * ROOM_LAYOUT.segmentLength - 0.14,
        minX: side < 0 ? -ROOM_LAYOUT.roomHalfWidth : ROOM_LAYOUT.aisleHalfWidth,
        minZ: segmentIndex * ROOM_LAYOUT.segmentLength + 0.14,
      });
      shelfIndex++;
    }
    cursor = end;
  }

  const segmentCount = Math.max(2, Math.ceil(Math.max(1, shelves.length) / 2));
  const bounds = Object.freeze({
    maxX: ROOM_LAYOUT.roomHalfWidth,
    maxZ: segmentCount * ROOM_LAYOUT.segmentLength,
    minX: -ROOM_LAYOUT.roomHalfWidth,
    minZ: 0,
  });
  // Face the first actual display, including collections with a single set.
  // Looking down the empty aisle leaves the first shelf outside a phone's FOV.
  const firstBox = boxes[0];
  const spawnZ = 1.2;
  const spawn = Object.freeze({
    x: 0, z: spawnZ,
    yaw: firstBox ? Math.atan2(firstBox.x, firstBox.z - spawnZ) : 0,
    pitch: firstBox ? Math.atan2(firstBox.y - ROOM_LAYOUT.eyeHeight, Math.hypot(firstBox.x, firstBox.z - spawnZ)) : 0,
  });
  return { bounds, boxes, colliders, segmentCount, setIndex, shelves, spawn };
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function finitePose(value) {
  return value && [value.x, value.z, value.yaw, value.pitch].every(Number.isFinite);
}

export function isRoomPoseWalkable(layout, value) {
  if (!finitePose(value)) return false;
  const radius = ROOM_LAYOUT.playerRadius;
  if (
    value.x < layout.bounds.minX + radius ||
    value.x > layout.bounds.maxX - radius ||
    value.z < layout.bounds.minZ + radius ||
    value.z > layout.bounds.maxZ - radius
  ) return false;
  return !layout.colliders.some(
    collider =>
      value.x > collider.minX - radius &&
      value.x < collider.maxX + radius &&
      value.z > collider.minZ - radius &&
      value.z < collider.maxZ + radius,
  );
}

export function normalizeRoomPose(layout, value) {
  if (!finitePose(value) || Math.abs(value.pitch) > MAX_PITCH || !isRoomPoseWalkable(layout, value)) return { ...layout.spawn };
  return { pitch: value.pitch, x: value.x, yaw: wrapAngle(value.yaw), z: value.z };
}

function tryMove(layout, pose, x, z) {
  const candidate = { ...pose, x, z };
  return isRoomPoseWalkable(layout, candidate) ? candidate : pose;
}

export function moveRoomPose(layout, pose, input, elapsedSeconds) {
  if (!finitePose(pose)) return { ...layout.spawn };
  const forward = Number.isFinite(input?.forward) ? input.forward : 0;
  const strafe = Number.isFinite(input?.strafe) ? input.strafe : 0;
  const magnitude = Math.hypot(forward, strafe);
  const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, Number(elapsedSeconds) || 0));
  if (!magnitude || !seconds) return { ...pose };
  const scale = Math.min(1, 1 / magnitude) * ROOM_LAYOUT.movementSpeed * seconds;
  const dx = (Math.sin(pose.yaw) * forward - Math.cos(pose.yaw) * strafe) * scale;
  const dz = (Math.cos(pose.yaw) * forward + Math.sin(pose.yaw) * strafe) * scale;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MAX_COLLISION_STEP));
  let next = { ...pose };
  for (let step = 0; step < steps; step++) {
    next = tryMove(layout, next, next.x + dx / steps, next.z);
    next = tryMove(layout, next, next.x, next.z + dz / steps);
  }
  return next;
}

export function roomPoseForSet(layout, setNum) {
  const index = layout.setIndex.get(canonicalSetNum(setNum));
  const box = Number.isInteger(index) ? layout.boxes[index] : null;
  if (!box) return null;
  const x = box.side * (ROOM_LAYOUT.aisleHalfWidth - 0.9);
  const pose = {
    pitch: Math.atan2(box.y - ROOM_LAYOUT.eyeHeight, Math.abs(box.x - x)),
    x,
    yaw: box.side < 0 ? -Math.PI / 2 : Math.PI / 2,
    z: box.z,
  };
  return isRoomPoseWalkable(layout, pose) ? pose : null;
}

export function selectRoomResidents(layout, pose, limit = ROOM_RESIDENT_BOX_LIMIT) {
  const budget = Math.max(0, Math.min(ROOM_RESIDENT_BOX_LIMIT, Number.isSafeInteger(limit) ? limit : ROOM_RESIDENT_BOX_LIMIT));
  if (!budget || !layout.boxes.length) return [];
  return layout.boxes
    .map(box => ({ box, distance: (box.x - pose.x) ** 2 + (box.z - pose.z) ** 2 }))
    .sort((a, b) => a.distance - b.distance || a.box.index - b.box.index)
    .slice(0, budget)
    .map(entry => entry.box);
}
