import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../components/collection-room-scene.js', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../views/collection-room.js', import.meta.url), 'utf8');

test('room scene keeps physical surfaces and mobile aisle lighting readable', () => {
  assert.match(source, /toneMappingExposure = 1\.38/);
  assert.match(source, /MeshStandardMaterial/);
  assert.match(source, /const aisleLight = new THREE\.PointLight\(0xd9efff, 3\.2, 22, 1\.55\)/);
  assert.match(source, /const floor = material\(\{ color: 0x5c666b/);
  assert.match(source, /const shelfSteel = material\(\{ color: 0x5c686e/);
  assert.match(source, /new THREE\.CanvasTexture\(card\)/);
  assert.match(source, /const frontMaterial = new THREE\.MeshStandardMaterial\(\{[\s\S]*?map: texture,[\s\S]*?roughness: 0\.28/);
});

test('room scene shares box artwork classification and preserves source photography', () => {
  assert.match(source, /boxArtworkPresentation/);
  assert.match(source, /artwork\.kind === 'flat-package-face'/);
  assert.match(source, /const scale = Math\.max\(w \/ image\.naturalWidth, h \/ image\.naturalHeight\)/);
  assert.doesNotMatch(source, /!\/ItemImage\\\/ON\\\/0/);
  assert.doesNotMatch(source, /Authentic LEGO Collector Edition packaging design/);
  assert.doesNotMatch(source, /Official LEGO logo emblem/);
  assert.doesNotMatch(source, /drawLegoSquare/);
  assert.match(viewSource, /const artwork = boxArtworkPresentation\(item\)/);
  assert.match(viewSource, /artwork\.kind === 'flat-package-face' \? 'is-flat-package-face' : 'is-source-photo'/);
  assert.doesNotMatch(viewSource, /Official Licensed Product|LEGO System A\/S|inspect-lego-badge/);
});

test('room entry uses a finite native door animation without changing the saved pose', () => {
  assert.match(source, /const DOOR_INTRO_DURATION_MS = 3600/);
  assert.match(source, /const DOOR_OPEN_ANGLE = Math\.PI \* 0\.5/);
  assert.match(source, /const doorProgress = Math\.min\(1, introProgress \/ 0\.68\)/);
  assert.match(source, /doorPivot\.rotation\.y = DOOR_OPEN_ANGLE \* eased/);
  assert.match(source, /doorWheel\.rotation\.z = -Math\.PI \* 1\.35/);
  assert.match(source, /const DOOR_INTRO_MAX_FRAME_STEP = 0\.12/);
  assert.match(source, /const doorIntroMode = options\.doorIntroMode \|\| 'native'/);
  assert.match(source, /const deferDoorIntro = shouldPlayDoorIntro && doorIntroMode === 'deferred'/);
  assert.match(source, /function finishDoorIntro\(\)/);
  assert.match(source, /function playDoorIntro\(\)/);
  assert.match(source, /const elapsedProgress = Math\.max\(0, Math\.min\(1, \(time - introStartedAt\) \/ DOOR_INTRO_DURATION_MS\)\)/);
  assert.match(source, /Math\.min\(elapsedProgress, introProgress \+ DOOR_INTRO_MAX_FRAME_STEP\)/);
  assert.doesNotMatch(source, /introProgress === 0 && elapsedProgress >= 1 \? 0\.5/);
  assert.match(source, /if \(introProgress < 1\) \{/);
  assert.match(source, /if \(introProgress >= 1\) updateCamera\(\)/);
  assert.match(source, /body\.scale\.set\(box\.boxDepth, box\.boxHeight, box\.boxWidth\)/);
  assert.match(source, /activePickup\.mesh\.scale\.set\(activePickup\.origScaleX, activePickup\.origScaleY, activePickup\.origScaleZ\)/);
  assert.match(source, /function introDoorCameraZ\(\)/);
  assert.match(source, /const horizontalFov = 2 \* Math\.atan/);
  assert.match(source, /const halfSweptWidth = 4\.9/);
  assert.match(source, /return -Math\.max\(7\.2, halfSweptWidth \/ safeHalfWidth, halfFramedHeight \/ safeHalfHeight\)/);
  assert.match(source, /const approach = smoothstep\(Math\.max\(0, \(progress - 0\.7\) \/ 0\.2\)\)/);
  assert.match(source, /const enter = smoothstep\(Math\.max\(0, \(progress - 0\.9\) \/ 0\.1\)\)/);
  assert.match(source, /if \(shouldPlayDoorIntro\) applyIntroCamera\(0\)/);
  assert.match(source, /reconcileResidents\(true, !shouldPlayDoorIntro\)/);
  assert.match(source, /const introZ = startZ \+ approach \* \(-1\.6 - startZ\) \+ enter \* \(pose\.z \+ 1\.6\)/);
  assert.match(source, /stage\.dataset\.introThreshold = introZ >= 0 \? 'inside' : 'outside'/);
  assert.match(source, /camera\.updateMatrixWorld\(\)/);
  assert.match(source, /const centerY = 2\.64 - 0\.18 \* \(1 - enter\)/);
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
  assert.match(source, /const boxSide = material\(\{ color: 0x22262a, roughness: 0\.42, metalness: 0\.12 \}\)/);
  assert.match(source, /const boxEdgeGeometry = new THREE\.EdgesGeometry\(boxGeometry\)/);
  assert.match(source, /const edges = new THREE\.LineSegments\(boxEdgeGeometry, boxEdge\)/);
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
