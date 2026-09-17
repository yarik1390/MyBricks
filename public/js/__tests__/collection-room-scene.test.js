import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/collection-room-scene.js', import.meta.url), 'utf8');

test('room scene keeps physical surfaces and mobile aisle lighting readable', () => {
  assert.match(source, /toneMappingExposure = 1\.38/);
  assert.match(source, /MeshStandardMaterial/);
  assert.match(source, /const aisleLight = new THREE\.PointLight\(0xd9efff, 3\.2, 22, 1\.55\)/);
  assert.match(source, /const floor = material\(\{ color: 0x5c666b/);
  assert.match(source, /const shelfSteel = material\(\{ color: 0x5c686e/);
  assert.match(source, /new THREE\.CanvasTexture\(card\)/);
  assert.match(source, /const frontMaterial = new THREE\.MeshStandardMaterial\(\{ map: texture, roughness: 0\.72 \}\)/);
});

test('room entry uses a finite native door animation without changing the saved pose', () => {
  assert.match(source, /const DOOR_INTRO_DURATION_MS = 3600/);
  assert.match(source, /const DOOR_OPEN_ANGLE = Math\.PI \* 0\.5/);
  assert.match(source, /doorPivot\.rotation\.y = DOOR_OPEN_ANGLE \* eased/);
  assert.match(source, /doorWheel\.rotation\.z = -Math\.PI \* 1\.35/);
  assert.match(source, /const DOOR_INTRO_MAX_FRAME_STEP = 0\.12/);
  assert.match(source, /const elapsedProgress = Math\.max\(0, Math\.min\(1, \(time - introStartedAt\) \/ DOOR_INTRO_DURATION_MS\)\)/);
  assert.match(source, /Math\.min\(elapsedProgress, introProgress \+ DOOR_INTRO_MAX_FRAME_STEP\)/);
  assert.doesNotMatch(source, /introProgress === 0 && elapsedProgress >= 1 \? 0\.5/);
  assert.match(source, /if \(introProgress < 1\) \{/);
  assert.match(source, /if \(introProgress >= 1\) updateCamera\(\)/);
  assert.match(source, /reconcileResidents\(true, !shouldPlayDoorIntro\)/);
  assert.match(source, /const introZ = -3\.15 \+ approach \* 1\.75 \+ enter \* \(pose\.z \+ 1\.4\)/);
  assert.match(source, /stage\.dataset\.introThreshold = introZ >= 0 \? 'inside' : 'outside'/);
  assert.match(source, /camera\.updateMatrixWorld\(\)/);
  assert.match(source, /introProgress < 1 \|\| hasMovement\(\)/);
  assert.doesNotMatch(source, /pose\.yaw\s*=.*introYaw/);
});

test('box pickup is finite, eased, and returns before normal room control resumes', () => {
  assert.match(source, /const PICKUP_DURATION_MS = 480/);
  assert.match(source, /const PICKUP_RETURN_DURATION_MS = 360/);
  assert.match(source, /const amount = activePickup\.returning \? 1 - eased : eased/);
  assert.match(source, /const PICKUP_VIEW_DISTANCE = 2\.2/);
  assert.match(source, /const PICKUP_VIEW_SCALE = 0\.72/);
  assert.match(source, /const viewX = pose\.x \+ forwardX \* PICKUP_VIEW_DISTANCE/);
  assert.match(source, /const viewY = ROOM_LAYOUT\.eyeHeight - 0\.22/);
  assert.match(source, /origX \+ \(viewX - origX\) \* amount/);
  assert.match(source, /mesh\.scale\.set\(origScaleX \* scale, origScaleY \* scale, origScaleZ \* scale\)/);
  assert.match(source, /if \(progress < 1\) pickupFrame = requestAnimationFrame\(pickupAnimationFrame\)/);
  assert.match(source, /activePickup\.onSettled\(\)/);
  assert.match(source, /restoreBoxPickup\(\{ immediate: true \}\)/);
  assert.doesNotMatch(source, /mesh\.position\.y \+= 0\.22/);
});

test('procedural cartons have neutral sides, readable thickness, and shared edge geometry', () => {
  assert.match(source, /const boxSide = material\(\{ color: 0xb79d77, roughness: 0\.9 \}\)/);
  assert.match(source, /const boxEdgeGeometry = new THREE\.EdgesGeometry\(boxGeometry\)/);
  assert.match(source, /const edges = new THREE\.LineSegments\(boxEdgeGeometry, boxEdge\)/);
  assert.match(source, /edges\.scale\.setScalar\(1\.006\)/);
  assert.doesNotMatch(source, /boxSide.*map:/);
});

test('door intro respects reduced motion and is cancelled by lifecycle boundaries', () => {
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /const shouldPlayDoorIntro = !options\.initialPose && !reducedMotion/);
  assert.match(source, /function beginModalTransition\(\) \{\s*cancelDoorIntro\(\{ finish: true \}\)/);
  assert.match(source, /if \(document\.hidden\) \{\s*cancelDoorIntro\(\{ finish: true \}\);\s*restoreBoxPickup\(\{ immediate: true \}\)/);
  assert.match(source, /function pick\([\s\S]*?cancelDoorIntro\(\{ finish: true \}\);\s*updateCamera\(\);/);
  assert.match(source, /if \(document\.hidden\) \{\s*cancelDoorIntro\(\{ finish: true \}\)/);
  assert.match(source, /destroyed = true;\s*cancelDoorIntro\(\)/);
});
