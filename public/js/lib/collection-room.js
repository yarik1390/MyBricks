import { canonicalSetNum } from './subcollections.js';

export const ROOM_LAYOUT = Object.freeze({
  aisleHalfWidth: 3.75,
  boxDepth: 0.34,
  boxHeight: 1.22,
  boxWidth: 1.36,
  boxesPerShelf: 12,
  ceilingHeight: 6.2,
  eyeHeight: 1.65,
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
    const item = {
      set_num: setNum,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : setNum,
      theme: typeof row.theme === 'string' ? row.theme.trim() : '',
      image_url: roomImageUrl(row.image_url),
      quantity,
    };
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
        const box = {
          ...item,
          index: boxes.length,
          row,
          shelfIndex,
          side,
          x: side * ROOM_LAYOUT.shelfCenterX,
          y: 1.02 + row * 1.58,
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
  const spawn = Object.freeze({ pitch: 0.08, x: 0, yaw: -0.2, z: 0.85 });
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
