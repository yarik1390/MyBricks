import {
  ROOM_LAYOUT,
  ROOM_RESIDENT_BOX_LIMIT,
  ROOM_TEXTURE_LIMIT,
  artworkContentBounds,
  artworkEdgePalette,
  detectBoxFaces,
  boxArtworkPresentation,
  createRoomLayout,
  getBoxFrontQuad,
  moveRoomPose,
  normalizeRoomPose,
  roomPoseForSet,
  selectRoomResidents,
  unwarpQuadToCanvas,
} from '../lib/collection-room.js';

const DOOR_INTRO_DURATION_MS = 3600;
const DOOR_INTRO_MAX_FRAME_STEP = 0.12;
const PICKUP_DURATION_MS = 480;
const PICKUP_RETURN_DURATION_MS = 360;
const PICKUP_VIEW_DISTANCE = 2.2;
const PICKUP_VIEW_SCALE = 0.72;
// Swing toward the vestibule, away from the room spawn/navigation path.
const DOOR_OPEN_ANGLE = Math.PI * 0.5;
const IMAGE_TEXTURE_LIMIT = ROOM_TEXTURE_LIMIT;
const LOOK_SPEED = 0.0032;
const RESIDENT_SEGMENT_RADIUS = 4;
// Carton end/top panels are small; this keeps 60 textured boxes near 6 MB.
const SIDE_PANEL_WIDTH = 96;
const SIDE_PANEL_HEIGHT = 256;
const ARTWORK_SAMPLE_SIZE = 128;

function smoothstep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function themeColor(theme) {
  let hash = 2166136261;
  for (const character of String(theme)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const colors = [0x9a5b4b, 0x446b62, 0x556a8a, 0x8a6a43, 0x6e597c, 0x7a6847];
  return colors[Math.abs(hash) % colors.length];
}

function shorten(context, value, width) {
  let text = String(value || '');
  if (context.measureText(text).width <= width) return text;
  while (text.length && context.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}

function isTypingTarget(target) {
  return target instanceof Element && (target.matches('input, textarea, select') || target.isContentEditable);
}

export async function createCollectionRoom(stage, catalog, options = {}) {
  if (Number(navigator.deviceMemory || 0) > 0 && navigator.deviceMemory <= 2) throw new Error('Low memory');
  const THREE = await import('../vendor/three-0.185.1.min.js');
  const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : () => {};
  const onUnavailable = typeof options.onUnavailable === 'function' ? options.onUnavailable : () => {};
  const onInspectionRotate = typeof options.onInspectionRotate === 'function' ? options.onInspectionRotate : () => {};
  if (!stage?.isConnected || !isCurrent()) return null;

  const layout = createRoomLayout(catalog);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.display = 'block';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.width = '100%';

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, canvas, powerPreference: 'low-power' });
  } catch (error) {
    canvas.remove();
    throw error;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.setClearColor(0x1d2124);
  stage.append(canvas);
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy?.() || 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2124);
  scene.fog = new THREE.Fog(0x1d2124, 26, 50);
  // A tiny prefiltered studio environment gives coated cartons, painted steel
  // and the sealed floor real reflections. It is painted as a 64x32 panorama
  // (two warm ceiling strips over a dim shell) so the one-off PMREM bake stays
  // cheap even under software WebGL; walking still costs no extra lights.
  let environmentTarget = null;
  try {
    const panorama = document.createElement('canvas');
    panorama.width = 64;
    panorama.height = 32;
    const context = panorama.getContext('2d');
    if (!context) throw new Error('canvas-2d');
    const shell = context.createLinearGradient(0, 0, 0, 32);
    shell.addColorStop(0, '#6a6660');
    shell.addColorStop(0.5, '#3a3d40');
    shell.addColorStop(1, '#4a4540');
    context.fillStyle = shell;
    context.fillRect(0, 0, 64, 32);
    context.fillStyle = '#fff6e8';
    for (const x of [6, 26, 38, 58]) context.fillRect(x - 2, 1, 4, 7);
    const studio = new THREE.CanvasTexture(panorama);
    studio.mapping = THREE.EquirectangularReflectionMapping;
    studio.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    environmentTarget = pmrem.fromEquirectangular(studio);
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.75;
    studio.dispose();
    pmrem.dispose();
  } catch {
    environmentTarget = null;
  }
  const camera = new THREE.PerspectiveCamera(58, 1, 0.08, 46);
  const raycaster = new THREE.Raycaster();
  // Keep boxes selectable from the aisle and from the room entrance. The
  // visible card remains the target; this only avoids forcing a close approach.
  raycaster.far = 30;
  const abort = new AbortController();
  const residentBoxes = new Map();
  const residentSegments = new Map();
  const pickTargets = new Set();
  const sharedGeometries = new Set();
  const sharedMaterials = new Set();
  const keys = new Set();
  const joystick = options.joystick instanceof Element ? options.joystick : null;
  const knob = joystick?.querySelector('.showroom-stick-knob') || null;
  const previousJoystickTouchAction = joystick?.style.touchAction || '';
  let joystickPointer = null;
  let joystickVector = { forward: 0, strafe: 0 };
  let drag = null;
  const pendingTextureLoads = new Set();
  let textureLoadScheduled = false;
  let textureRenderTimer = 0;
  let textureLoadPaused = false;
  let destroyed = false;
  let contextLost = false;
  let unavailableNotified = false;
  let manuallyPaused = false;
  let frame = 0;
  let lastFrameTime = 0;
  let introFrame = 0;
  let introStartedAt = 0;
  let introProgress = 1;
  let pickupFrame = 0;
  let pickupStartedAt = 0;
  let doorPivot = null;
  let doorWheel = null;
  let residentSegment = -1;
  let resizeObserver;
  let removalObserver;
  let pose = normalizeRoomPose(layout, options.initialPose);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  const doorIntroMode = options.doorIntroMode || 'native';
  const shouldPlayDoorIntro = !options.initialPose && !reducedMotion && doorIntroMode !== 'none';
  const deferDoorIntro = shouldPlayDoorIntro && doorIntroMode === 'deferred';
  introProgress = shouldPlayDoorIntro ? 0 : 1;
  let inspecting = false;
  let activePickup = null;

  const textureLoader = new THREE.TextureLoader();
  const loadVaultTexture = (url, repeatX = 1, repeatY = 1) => {
    try {
      const tex = textureLoader.load(url, () => {
        if (!inspecting && !manuallyPaused && introProgress >= 1) renderNow();
      });
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      return tex;
    } catch {
      return null;
    }
  };
  const steelTexture = loadVaultTexture('/img/vault-steel.webp', 2, 4);
  const floorTexture = loadVaultTexture('/img/vault-floor.webp', 3, 10);
  if (floorTexture) floorTexture.anisotropy = anisotropy;
  const doorTexture = loadVaultTexture('/img/vault-door.webp', 1, 1);

  const material = parameters => {
    const value = new THREE.MeshStandardMaterial(parameters);
    sharedMaterials.add(value);
    return value;
  };
  const wallSteel = material({ color: 0x7b858a, map: steelTexture, metalness: 0.38, roughness: 0.56 });
  const ceiling = material({ color: 0x6c757a, map: steelTexture, metalness: 0.3, roughness: 0.66 });
  // Sealed concrete: low metalness with enough gloss to catch the ceiling panels.
  const floor = material({ color: 0x5c666b, map: floorTexture, metalness: 0.04, roughness: 0.46 });
  const aisle = material({ color: 0x2e3338, roughness: 0.94, metalness: 0 });
  const shelfSteel = material({ color: 0x5c686e, map: steelTexture, metalness: 0.5, roughness: 0.4 });
  const shelfEdge = material({ color: 0x3e474c, metalness: 0.66, roughness: 0.42 });
  const shelfBack = material({ color: 0x6d675f, metalness: 0.05, roughness: 0.82 });
  const lightPanel = material({ color: 0xfff1dc, emissive: 0xfff1dc, emissiveIntensity: 1.6, roughness: 1 });
  const ledStrip = material({ color: 0xffe2b8, emissive: 0xffe2b8, emissiveIntensity: 1.4, roughness: 1 });
  // Printed carton board: untextured cartons keep a neutral coated shell; the
  // textured window swaps in per-box panels sampled from the front artwork.
  const boxSide = material({ color: 0x3a4046, roughness: 0.42, metalness: 0 });
  const boxFront = material({ color: 0x2a2f35, roughness: 0.3, metalness: 0 });
  const shadowTexture = softShadowTexture();
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, map: shadowTexture, transparent: true, opacity: 0.72, depthWrite: false });
  sharedMaterials.add(shadowMaterial);
  const accentMaterials = new Map();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const shadowGeometry = new THREE.PlaneGeometry(1, 1);
  shadowGeometry.rotateX(-Math.PI / 2);
  sharedGeometries.add(boxGeometry);
  sharedGeometries.add(shadowGeometry);

  scene.add(new THREE.HemisphereLight(0xf3eee6, 0x3b3530, 1.55));
  const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.9);
  keyLight.position.set(-3, 5.8, 4);
  scene.add(keyLight);
  const warmLight = new THREE.PointLight(0xffd9a6, 4.2, 24, 1.45);
  warmLight.position.set(0, 4.7, pose.z + 1);
  scene.add(warmLight);
  const aisleLight = new THREE.PointLight(0xd9efff, 3.2, 22, 1.55);
  aisleLight.position.set(0, 3.2, pose.z + 6);
  scene.add(aisleLight);

  function softShadowTexture() {
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const context = shadowCanvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(32, 32, 10, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(shadowCanvas);
    // The map drives alpha only; black material colour keeps it a shadow.
    return texture;
  }

  function accent(theme) {
    const color = themeColor(theme);
    if (!accentMaterials.has(color)) accentMaterials.set(color, material({ color, roughness: 0.78 }));
    return accentMaterials.get(color);
  }

  function meshBox(group, size, position, meshMaterial, selectable = false) {
    const geometry = new THREE.BoxGeometry(...size);
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    mesh.position.set(...position);
    group.add(mesh);
    if (selectable) pickTargets.add(mesh);
    return mesh;
  }

  function disposeGroup(group) {
    group.traverse(object => {
      pickTargets.delete(object);
      if (object.geometry && !sharedGeometries.has(object.geometry)) object.geometry.dispose();
      if (object.userData.themeSign) {
        object.material.map.dispose();
        object.material.dispose();
      }
    });
    group.removeFromParent();
  }

  function addSegment(index) {
    const start = index * ROOM_LAYOUT.segmentLength;
    const center = start + ROOM_LAYOUT.segmentLength / 2;
    const group = new THREE.Group();
    group.userData.segment = index;
    scene.add(group);
    meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, 0.16, ROOM_LAYOUT.segmentLength], [0, -0.08, center], floor, true);
    meshBox(group, [ROOM_LAYOUT.aisleHalfWidth * 1.65, 0.018, ROOM_LAYOUT.segmentLength - 0.2], [0, 0.012, center], aisle, true);
    meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, 0.16, ROOM_LAYOUT.segmentLength], [0, ROOM_LAYOUT.ceilingHeight, center], ceiling, true);
    meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, ROOM_LAYOUT.segmentLength], [-ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, center], wallSteel, true);
    meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, ROOM_LAYOUT.segmentLength], [ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, center], wallSteel, true);
    // Shallow ribs and floor rails make each steel bay read at walking speed
    // without extra textures, shadows, or a continuous render loop.
    for (const z of [start + 0.08, start + ROOM_LAYOUT.segmentLength - 0.08]) {
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2 - 0.24, 0.055, 0.055], [0, 0.04, z], shelfEdge, true);
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2 - 0.24, 0.045, 0.045], [0, ROOM_LAYOUT.ceilingHeight - 0.04, z], shelfEdge, true);
    }
    // Recessed ceiling panels give the bay a visible light source that the
    // baked environment reflections line up with.
    for (const x of [-2.4, 2.4]) {
      meshBox(group, [1.1, 0.03, ROOM_LAYOUT.segmentLength - 1.4], [x, ROOM_LAYOUT.ceilingHeight - 0.085, center], lightPanel);
    }

    for (const shelf of layout.shelves.filter(entry => entry.segmentIndex === index)) {
      const side = shelf.side;
      const shelfX = side * 4.48;
      const shelfMaterial = accent(shelf.theme);
      meshBox(group, [0.18, 5.22, ROOM_LAYOUT.segmentLength - 0.34], [side * 4.9, 2.61, center], shelfBack, true);
      // Decks follow the carton rows (0.35 m + 1.58 m pitch) so every carton
      // rests on steel instead of hovering above the middle and upper decks.
      for (const y of [0.35, 1.93, 3.51, 4.83]) {
        meshBox(group, [1.25, 0.13, ROOM_LAYOUT.segmentLength - 0.34], [shelfX, y, center], shelfSteel, true);
        // Warm LED strip tucked under each deck's front lip washes the
        // cartons below, like a retail display shelf.
        if (y > 1) meshBox(group, [0.05, 0.018, ROOM_LAYOUT.segmentLength - 0.6], [shelfX - side * 0.56, y - 0.074, center], ledStrip);
      }
      for (const z of [start + 0.18, start + ROOM_LAYOUT.segmentLength - 0.18]) {
        meshBox(group, [1.16, 4.62, 0.12], [shelfX, 2.59, z], shelfEdge, true);
      }
      meshBox(group, [1.18, 0.36, ROOM_LAYOUT.segmentLength - 0.5], [shelfX, 5.08, center], shelfMaterial, true);
      const signCanvas = document.createElement('canvas');
      signCanvas.width = 1024;
      signCanvas.height = 80;
      const context = signCanvas.getContext('2d');
      if (context) {
        context.fillStyle = '#fff7e9';
        context.font = '600 48px system-ui, sans-serif';
        context.textAlign = 'center';
        context.fillText(shorten(context, shelf.theme, 960), 512, 57);
        const texture = new THREE.CanvasTexture(signCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 0.46), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
        sign.position.set(side * 3.88, 5.08, center);
        sign.rotation.y = -side * Math.PI / 2;
        sign.userData.themeSign = true;
        group.add(sign);
      }
    }
    if (index === 0) {
      const vestibuleDepth = 14;
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, 0.16, vestibuleDepth], [0, -0.08, -vestibuleDepth / 2], floor, true);
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, 0.16, vestibuleDepth], [0, ROOM_LAYOUT.ceilingHeight, -vestibuleDepth / 2], ceiling, true);
      meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, vestibuleDepth], [-ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, -vestibuleDepth / 2], wallSteel, true);
      meshBox(group, [0.18, ROOM_LAYOUT.ceilingHeight, vestibuleDepth], [ROOM_LAYOUT.roomHalfWidth, ROOM_LAYOUT.ceilingHeight / 2, -vestibuleDepth / 2], wallSteel, true);
      // Leave a real aperture behind the moving leaf; the former solid wall
      // meant an "open" door could never reveal or admit the room.
      meshBox(group, [3.1, ROOM_LAYOUT.ceilingHeight, 0.18], [-3.7, ROOM_LAYOUT.ceilingHeight / 2, 0], wallSteel, true);
      meshBox(group, [3.1, ROOM_LAYOUT.ceilingHeight, 0.18], [3.7, ROOM_LAYOUT.ceilingHeight / 2, 0], wallSteel, true);
      meshBox(group, [4.3, 0.85, 0.18], [0, ROOM_LAYOUT.ceilingHeight - 0.425, 0], wallSteel, true);
      // An open torus reads as a frame without occluding the doorway.
      const frameOuter = new THREE.Mesh(new THREE.TorusGeometry(2.38, 0.22, 12, 40), shelfEdge);
      frameOuter.position.set(0, 2.64, 0.16);
      group.add(frameOuter);

      // The door pivots as one native Three.js assembly around its left hinge.
      doorPivot = new THREE.Group();
      doorPivot.position.set(-2.02, 2.64, 0.18);
      group.add(doorPivot);
      const doorMaterials = [shelfSteel, material({ map: doorTexture, color: 0xdde4e8, metalness: 0.46, roughness: 0.48 }), shelfSteel];
      const door = new THREE.Mesh(new THREE.CylinderGeometry(2.14, 2.14, 0.26, 32), doorMaterials);
      door.rotation.x = Math.PI / 2;
      door.position.x = 2.02;
      doorPivot.add(door);

      // Heavy hinges stay fixed to the frame.
      const hingeTop = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.52, 16), shelfEdge);
      hingeTop.position.set(-2.02, 3.4, 0.2);
      group.add(hingeTop);
      const hingeBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.52, 16), shelfEdge);
      hingeBottom.position.set(-2.02, 1.88, 0.2);
      group.add(hingeBottom);

      // Radial locking bolts stay attached to the moving door leaf.
      for (let a = 0; a < 6; a++) {
        const angle = (a * Math.PI) / 3;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.44, 12), shelfEdge);
        bolt.rotation.z = angle;
        bolt.position.set(2.02 + Math.cos(angle) * 2.06, Math.sin(angle) * 2.06, -0.13);
        doorPivot.add(bolt);
      }

      // Central locking wheel follows the door leaf during the opening.
      doorWheel = new THREE.Group();
      doorWheel.position.x = 2.02;
      doorPivot.add(doorWheel);
      meshBox(doorWheel, [1.8, 0.08, 0.12], [0, 0, -0.13], shelfEdge, true);
      meshBox(doorWheel, [0.08, 1.8, 0.12], [0, 0, -0.13], shelfEdge, true);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 24), shelfEdge);
      hub.rotation.x = Math.PI / 2;
      hub.position.z = -0.2;
      doorWheel.add(hub);
      doorPivot.rotation.y = DOOR_OPEN_ANGLE * smoothstep(introProgress);
    }
    if (index === layout.segmentCount - 1) {
      meshBox(group, [ROOM_LAYOUT.roomHalfWidth * 2, ROOM_LAYOUT.ceilingHeight, 0.18], [0, ROOM_LAYOUT.ceilingHeight / 2, layout.bounds.maxZ], wallSteel, true);
    }
    residentSegments.set(index, group);
  }

  function removeBox(record) {
    if (record.image) {
      record.image.onload = null;
      record.image.onerror = null;
      record.image.removeAttribute('src');
    }
    record.texture?.dispose();
    record.frontMaterial?.dispose();
    record.sideTexture?.dispose();
    record.sideMaterial?.dispose();
    record.lidMaterial?.dispose();
    record.backTexture?.dispose();
    record.backMaterial?.dispose();
    record.shadow?.removeFromParent();
    pickTargets.delete(record.body);
    record.body.removeFromParent();
  }

  function sampleArtwork(image) {
    // Analyse a thumbnail rather than the full photograph: 128 px is enough to
    // find a studio backdrop and the carton's corners within a pixel or two.
    const sample = document.createElement('canvas');
    const aspect = image.naturalWidth / image.naturalHeight;
    sample.width = aspect >= 1 ? ARTWORK_SAMPLE_SIZE : Math.max(4, Math.round(ARTWORK_SAMPLE_SIZE * aspect));
    sample.height = aspect >= 1 ? Math.max(4, Math.round(ARTWORK_SAMPLE_SIZE / aspect)) : ARTWORK_SAMPLE_SIZE;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    try {
      context.drawImage(image, 0, 0, sample.width, sample.height);
      const { data } = context.getImageData(0, 0, sample.width, sample.height);
      return {
        bounds: artworkContentBounds(data, sample.width, sample.height),
        faces: detectBoxFaces(data, sample.width, sample.height),
      };
    } catch {
      return null;
    }
  }

  function cardPalette(card) {
    // Side panels without photographed art take their colours from the
    // finished front, so they match whichever path drew it.
    const sample = document.createElement('canvas');
    sample.width = 32;
    sample.height = Math.max(8, Math.round((32 * card.height) / card.width));
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    try {
      context.drawImage(card, 0, 0, sample.width, sample.height);
      return artworkEdgePalette(context.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
    } catch {
      return null;
    }
  }

  function applyFrontProportions(record, quad, image) {
    // Estimated cartons borrow their width:height from the straightened
    // front, so the print is not stretched. Measured cartons keep their data.
    const { box, body } = record;
    if (box.dimensionBasis === 'measured') return;
    // A held box is restored to its original scale when it goes back on the
    // shelf, so apply the new proportions once it is resting again.
    if (activePickup?.mesh === body) {
      body.userData.pendingProportions = () => applyFrontProportions(record, quad, image);
      return;
    }
    body.userData.pendingProportions = null;
    const [topLeft, topRight, , bottomLeft] = quad;
    const faceWidth = Math.hypot((topRight[0] - topLeft[0]) * image.naturalWidth, (topRight[1] - topLeft[1]) * image.naturalHeight);
    const faceHeight = Math.hypot((bottomLeft[0] - topLeft[0]) * image.naturalWidth, (bottomLeft[1] - topLeft[1]) * image.naturalHeight);
    const aspect = faceWidth / Math.max(1, faceHeight);
    if (!Number.isFinite(aspect) || aspect < 0.5 || aspect > 3) return;
    const area = box.boxWidth * box.boxHeight;
    let height = Math.sqrt(area / aspect);
    let width = height * aspect;
    const fit = Math.min(1, ROOM_LAYOUT.boxWidth / width, ROOM_LAYOUT.boxHeight / height);
    height *= fit;
    width *= fit;
    const bottomY = box.y - box.boxHeight / 2;
    body.scale.set(box.boxDepth, height, width);
    record.frontSize = { width, height };
    body.position.y = bottomY + height / 2;
    record.shadow?.scale.set(box.boxDepth * 1.3, 1, width * 1.12);
  }

  function drawProductFace(context, w, h, image, box) {
    // A model render is not packaging. Print it on a carton-style face: a
    // theme-coloured backdrop, the model contained with a soft shadow, and a
    // name band, instead of stretching a photo of bricks across the box.
    const base = `#${themeColor(box.theme).toString(16).padStart(6, '0')}`;
    const backdrop = context.createLinearGradient(0, 0, 0, h);
    backdrop.addColorStop(0, base);
    backdrop.addColorStop(1, '#111418');
    context.fillStyle = backdrop;
    context.fillRect(0, 0, w, h);
    const glow = context.createRadialGradient(w * 0.55, h * 0.45, 0, w * 0.55, h * 0.45, w * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,0.28)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, w, h);
    const band = Math.round(h * 0.16);
    const areaW = w * 0.86;
    const areaH = (h - band) * 0.84;
    const scale = Math.min(areaW / image.naturalWidth, areaH / image.naturalHeight);
    const imgW = image.naturalWidth * scale;
    const imgH = image.naturalHeight * scale;
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.45)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
    context.drawImage(image, (w - imgW) / 2, (h - band - imgH) / 2 + h * 0.02, imgW, imgH);
    context.restore();
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.fillRect(0, h - band, w, band);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.font = `800 ${Math.round(band * 0.46)}px system-ui, sans-serif`;
    const number = String(box.set_num).replace(/-1$/, '');
    context.fillText(number, w * 0.04, h - band / 2);
    const numberWidth = context.measureText(number).width;
    context.font = `600 ${Math.round(band * 0.3)}px system-ui, sans-serif`;
    context.fillStyle = 'rgba(255,255,255,0.8)';
    context.textAlign = 'right';
    context.fillText(shorten(context, box.name, w * 0.9 - numberWidth - w * 0.06), w * 0.96, h - band / 2);
  }

  function loadArtwork(url) {
    return new Promise(resolve => {
      if (!url) {
        resolve(null);
        return;
      }
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image.naturalWidth ? image : null);
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  function studioCorners(image) {
    // How many corners sit on a near-white studio backdrop.
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 16;
    const context = probe.getContext('2d', { willReadFrequently: true });
    if (!context) return 0;
    try {
      context.drawImage(image, 0, 0, 16, 16);
      const { data } = context.getImageData(0, 0, 16, 16);
      return [0, 15, 240, 255].filter(pixel => Math.min(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]) > 232).length;
    } catch {
      return 0;
    }
  }

  async function paintBackCanvas(box, width, height, lid, backUrl, modelUrl) {
    // The back of a LEGO carton shows the model again. Use the photographed
    // back (straightened like the front when it is an angled shot), else the
    // model render on a carton-style face, else the lid colour with the name.
    const back = document.createElement('canvas');
    back.width = width;
    back.height = height;
    const context = back.getContext('2d');
    if (!context) return null;
    const w = back.width;
    const h = back.height;
    let drawn = false;
    const photo = await loadArtwork(backUrl);
    if (photo) {
      const sample = sampleArtwork(photo);
      if (sample?.faces) drawn = unwarpQuadToCanvas(photo, sample.faces.front, back);
      const bounds = sample?.bounds || { x0: 0, y0: 0, x1: 1, y1: 1 };
      if (!drawn && ((bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0) < 0.98 || studioCorners(photo) >= 2)) {
        // A render on a studio backdrop (often the model from behind), not a
        // scan of the carton: present it like a model render.
        drawProductFace(context, w, h, photo, box);
        drawn = true;
      }
      if (!drawn) {
        const sw = Math.max(1, (bounds.x1 - bounds.x0) * photo.naturalWidth);
        const sh = Math.max(1, (bounds.y1 - bounds.y0) * photo.naturalHeight);
        const scale = Math.max(w / sw, h / sh);
        context.drawImage(photo, bounds.x0 * photo.naturalWidth, bounds.y0 * photo.naturalHeight, sw, sh, (w - sw * scale) / 2, (h - sh * scale) / 2, sw * scale, sh * scale);
        drawn = true;
      }
    }
    if (!drawn) {
      const model = await loadArtwork(modelUrl);
      if (model) {
        drawProductFace(context, w, h, model, box);
        drawn = true;
      }
    }
    if (!drawn) {
      context.fillStyle = lid || '#1c2025';
      context.fillRect(0, 0, w, h);
      context.fillStyle = 'rgba(255,255,255,0.86)';
      context.font = '700 26px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(shorten(context, box.name, w - 64), w / 2, h / 2 - 14);
      context.font = '600 18px system-ui, sans-serif';
      context.fillStyle = 'rgba(255,255,255,0.6)';
      context.fillText(box.set_num, w / 2, h / 2 + 20);
    }
    drawFoldHighlights(context, w, h, 1.5);
    return back;
  }

  function lidColor(record) {
    return record.lidMaterial ? `#${record.lidMaterial.color.getHexString(THREE.SRGBColorSpace)}` : '';
  }

  async function paintBack(record, backUrl, modelUrl) {
    const { box, canvas: card } = record;
    const back = await paintBackCanvas(box, card.width, card.height, lidColor(record), backUrl, modelUrl);
    if (!back) return null;
    if (destroyed || residentBoxes.get(box.index) !== record || !record.texture) return back;
    // Print it on the carton too, so turning the held box shows the same back.
    const texture = new THREE.CanvasTexture(back);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    record.backTexture = texture;
    record.backMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.28, metalness: 0 });
    const backIndex = record.frontIndex ^ 1;
    record.body.material = record.body.material.map((material, index) => (index === backIndex ? record.backMaterial : material));
    requestTextureRender();
    return back;
  }

  function drawFoldHighlights(context, w, h, scale = 1) {
    // Carton folds are slightly rounded and catch the ceiling light; the
    // bottom fold sits in shadow. A few pixels sell the bevel without geometry.
    context.fillStyle = 'rgba(255,255,255,0.32)';
    context.fillRect(0, 0, w, 2 * scale);
    context.fillStyle = 'rgba(255,255,255,0.14)';
    context.fillRect(0, 0, 2 * scale, h);
    context.fillRect(w - 2 * scale, 0, 2 * scale, h);
    context.fillStyle = 'rgba(0,0,0,0.28)';
    context.fillRect(0, h - 2 * scale, w, 2 * scale);
  }

  function drawSidePanel(record, palette, sideArt = null) {
    const { box, sideContext: context, sideCanvas } = record;
    if (!context) return;
    const w = SIDE_PANEL_WIDTH;
    const h = SIDE_PANEL_HEIGHT;
    // The photographed end panel is the real print; use it when the photo
    // showed one clearly enough to straighten.
    if (sideArt && unwarpQuadToCanvas(sideArt.image, sideArt.quad, sideCanvas)) {
      drawFoldHighlights(context, w, h);
      record.sideTexture.needsUpdate = true;
      return;
    }
    const colors = palette?.bands?.length ? palette.bands : [[58, 64, 72]];
    const gradient = context.createLinearGradient(0, 0, 0, h);
    colors.forEach((color, index) => gradient.addColorStop(colors.length === 1 ? 0 : index / (colors.length - 1), `rgb(${color.join(',')})`));
    context.fillStyle = gradient;
    context.fillRect(0, 0, w, h);
    // Printed end panels carry the set number and name, running up the fold.
    const light = Boolean(palette?.light);
    context.save();
    context.translate(w / 2, h / 2);
    context.rotate(-Math.PI / 2);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = light ? 'rgba(20,22,26,0.88)' : 'rgba(255,255,255,0.92)';
    context.font = '800 30px system-ui, sans-serif';
    context.fillText(shorten(context, String(box.set_num).replace(/-1$/, ''), h - 24), 0, -18);
    context.font = '600 15px system-ui, sans-serif';
    context.fillStyle = light ? 'rgba(20,22,26,0.7)' : 'rgba(255,255,255,0.74)';
    context.fillText(shorten(context, box.name, h - 24), 0, 16);
    context.restore();
    drawFoldHighlights(context, w, h);
    record.sideTexture.needsUpdate = true;
  }

  function drawCard(record, image = null, isPackage = true) {
    const { box, context, canvas: card } = record;
    const w = card.width;
    const h = card.height;

    // Neutral backing for source artwork and unavailable-image labels.
    context.fillStyle = '#1e2226';
    context.fillRect(0, 0, w, h);

    let sideArt = null;
    if (image?.naturalWidth && image?.naturalHeight) {
      const artwork = boxArtworkPresentation(box);
      const productOnly = !isPackage || artwork.kind === 'product-image';
      const sample = productOnly ? null : sampleArtwork(image);
      let unwarped = false;
      // Three-quarter packaging photos: straighten the front face found in
      // this very image so the end panel and lid no longer squeeze onto the
      // front. Hand-calibrated quads only describe one historical photo, so
      // they are the fallback when the silhouette is not a clear 3/4 view.
      if (sample?.faces && artwork.kind !== 'flat-package-face') {
        unwarped = unwarpQuadToCanvas(image, sample.faces.front, card);
        if (unwarped) {
          applyFrontProportions(record, sample.faces.front, image);
          if (sample.faces.side) sideArt = { image, quad: sample.faces.side };
        }
      }
      const quad = unwarped || productOnly ? null : getBoxFrontQuad(box.set_num);
      if (quad) unwarped = unwarpQuadToCanvas(image, quad, card);

      if (productOnly) {
        drawProductFace(context, w, h, image, box);
      } else if (!unwarped) {
        // Crop the studio backdrop so the print runs to every fold.
        const bounds = sample?.bounds || { x0: 0, y0: 0, x1: 1, y1: 1 };
        const sx = bounds.x0 * image.naturalWidth;
        const sy = bounds.y0 * image.naturalHeight;
        const sw = Math.max(1, (bounds.x1 - bounds.x0) * image.naturalWidth);
        const sh = Math.max(1, (bounds.y1 - bounds.y0) * image.naturalHeight);
        if (artwork.kind === 'flat-package-face') {
          context.drawImage(image, sx, sy, sw, sh, 0, 0, w, h);
        } else {
          // Fill edge to edge to avoid framed picture card effect
          const scale = Math.max(w / sw, h / sh);
          const imgW = Math.round(sw * scale);
          const imgH = Math.round(sh * scale);
          const imgX = Math.round((w - imgW) / 2);
          const imgY = Math.round((h - imgH) / 2);
          context.drawImage(image, sx, sy, sw, sh, imgX, imgY, imgW, imgH);
        }
      }
      drawFoldHighlights(context, w, h, 1.5);
    } else {
      context.fillStyle = '#1c2025';
      context.fillRect(16, 16, w - 32, h - 32);
      context.fillStyle = '#e5e7eb';
      context.font = '600 22px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.fillText(shorten(context, box.name, w - 64), w / 2, h / 2 + 10);
      context.font = '500 16px system-ui, sans-serif';
      context.fillStyle = '#9ca3af';
      context.fillText(box.set_num, w / 2, h / 2 + 38);
    }
    const palette = image ? cardPalette(card) : null;
    drawSidePanel(record, palette, sideArt);
    if (record.lidMaterial && palette) record.lidMaterial.color.setRGB(...palette.average.map(value => value / 255), THREE.SRGBColorSpace);
    record.texture.needsUpdate = true;
  }

  function addTexture(record) {
    if (record.texture) return;
    const card = document.createElement('canvas');
    const boxAspect = (record.box.boxWidth && record.box.boxHeight)
      ? (record.box.boxWidth / record.box.boxHeight)
      : 1.35;
    const cardW = 512;
    const cardH = Math.max(256, Math.min(1024, Math.round(cardW / boxAspect)));
    card.width = cardW;
    card.height = cardH;
    const context = card.getContext('2d');
    if (!context) return;
    const side = document.createElement('canvas');
    side.width = SIDE_PANEL_WIDTH;
    side.height = SIDE_PANEL_HEIGHT;
    const sideContext = side.getContext('2d');
    const texture = new THREE.CanvasTexture(card);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    const frontMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.28,
      metalness: 0,
    });
    record.canvas = card;
    record.context = context;
    record.frontMaterial = frontMaterial;
    record.texture = texture;
    if (sideContext) {
      const sideTexture = new THREE.CanvasTexture(side);
      sideTexture.colorSpace = THREE.SRGBColorSpace;
      sideTexture.anisotropy = anisotropy;
      record.sideCanvas = side;
      record.sideContext = sideContext;
      record.sideTexture = sideTexture;
      record.sideMaterial = new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 0.36, metalness: 0 });
    }
    // Lid, base and back take one printed colour from the front; the end
    // panels (+z/-z) carry the photographed or generated side print.
    record.lidMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.4, metalness: 0 });
    record.body.material = record.body.material.map((_, index) => {
      if (index === record.frontIndex) return frontMaterial;
      return index >= 4 ? record.sideMaterial || boxSide : record.lidMaterial;
    });
    drawCard(record);

    const artwork = boxArtworkPresentation(record.box);
    const boxUrl = artwork.kind === 'product-image' ? '' : artwork.url;
    const modelUrl = artwork.kind === 'product-image' ? artwork.url : record.box.image_url;
    const primaryUrl = artwork.url || modelUrl;

    if (primaryUrl) {
      const image = new Image();
      record.image = image;
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (destroyed || residentBoxes.get(record.box.index) !== record) return;
        drawCard(record, image, Boolean(boxUrl));
        requestTextureRender();
      };
      image.onerror = () => {
        if (boxUrl && modelUrl && boxUrl !== modelUrl) {
          const fallback = new Image();
          record.image = fallback;
          fallback.crossOrigin = 'anonymous';
          fallback.onload = () => {
            if (destroyed || residentBoxes.get(record.box.index) !== record) return;
            drawCard(record, fallback, false);
            requestTextureRender();
          };
          fallback.src = modelUrl;
        }
      };
      image.src = primaryUrl;
    }
  }

  function removeTexture(record) {
    if (!record.texture) return;
    if (record.image) {
      record.image.onload = null;
      record.image.onerror = null;
      record.image.removeAttribute('src');
    }
    record.image = null;
    record.texture.dispose();
    record.frontMaterial.dispose();
    record.sideTexture?.dispose();
    record.sideMaterial?.dispose();
    record.lidMaterial?.dispose();
    record.backTexture?.dispose();
    record.backMaterial?.dispose();
    record.lidMaterial = null;
    record.sideCanvas = null;
    record.backPromise = null;
    record.backTexture = null;
    record.backMaterial = null;
    record.texture = null;
    record.frontMaterial = null;
    record.sideTexture = null;
    record.sideMaterial = null;
    record.sideContext = null;
    record.canvas = null;
    record.context = null;
    pendingTextureLoads.delete(record.box.index);
    record.body.material = record.body.material.map((_, index) => (index === record.frontIndex ? boxFront : boxSide));
  }

  function requestTextureRender() {
    // Image completions can arrive as separate tasks. Keep their GPU uploads out
    // of the intro, then debounce them into one trailing idle render afterward.
    if (destroyed || textureLoadPaused || introProgress < 1 || hasMovement()) return;
    if (textureRenderTimer) clearTimeout(textureRenderTimer);
    textureRenderTimer = window.setTimeout(() => {
      textureRenderTimer = 0;
      if (!destroyed && !textureLoadPaused && !hasMovement()) renderNow();
    }, 50);
  }

  function scheduleTextureLoads(records) {
    pendingTextureLoads.clear();
    for (const record of records) if (!record.texture) pendingTextureLoads.add(record.box.index);
    if (textureLoadScheduled || textureLoadPaused || introProgress < 1 || hasMovement() || !pendingTextureLoads.size) return;
    textureLoadScheduled = true;
    const pump = deadline => {
      // Build cards in bounded idle slices. Rendering each card individually
      // uploaded the whole scene 60 times and delayed input by several seconds
      // under software WebGL. A single deferred render uploads the completed
      // batch while yielding whenever input begins.
      if (destroyed || textureLoadPaused || hasMovement() || !active()) {
        textureLoadScheduled = false;
        return;
      }
      const started = performance.now();
      do {
        const next = pendingTextureLoads.values().next().value;
        if (next === undefined) break;
        pendingTextureLoads.delete(next);
        const record = residentBoxes.get(next);
        if (record) addTexture(record);
      } while (pendingTextureLoads.size && performance.now() - started < 4 && (!deadline || deadline.timeRemaining() > 1));
      if (pendingTextureLoads.size) scheduleIdle(pump);
      else {
        textureLoadScheduled = false;
        requestTextureRender();
      }
    };
    scheduleIdle(pump);
  }

  function scheduleIdle(callback) {
    if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 100 });
    else window.setTimeout(() => callback(null), 0);
  }

  function addBox(box) {
    const frontIndex = box.side < 0 ? 0 : 1;
    const materials = [boxSide, boxSide, boxSide, boxSide, boxSide, boxSide];
    materials[frontIndex] = boxFront;
    const body = new THREE.Mesh(boxGeometry, materials);
    body.position.set(box.x, box.y, box.z);
    body.scale.set(box.boxDepth, box.boxHeight, box.boxWidth);
    body.userData.setNum = box.set_num;
    body.userData.dimensionBasis = box.dimensionBasis;

    // Soft contact shadow anchoring the carton to the shelf deck. It stays on
    // the shelf when the box is lifted, like the real footprint would.
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.scale.set(box.boxDepth * 1.3, 1, box.boxWidth * 1.12);
    shadow.position.set(box.x, box.y - box.boxHeight / 2 + 0.006, box.z);
    shadow.renderOrder = 1;
    scene.add(shadow);

    scene.add(body);
    pickTargets.add(body);
    const record = { body, box, frontIndex, frontMaterial: null, image: null, shadow, sideMaterial: null, sideTexture: null, texture: null };
    residentBoxes.set(box.index, record);
    return record;
  }

  function reconcileResidents(force = false, includeTextures = true) {
    const segment = Math.max(0, Math.min(layout.segmentCount - 1, Math.floor(pose.z / ROOM_LAYOUT.segmentLength)));
    if (!force && segment === residentSegment) return;
    residentSegment = segment;
    const selectionPose = { ...pose, x: 0, z: (segment + 0.5) * ROOM_LAYOUT.segmentLength };
    const selected = selectRoomResidents(layout, selectionPose, ROOM_RESIDENT_BOX_LIMIT);
    const desired = new Set(selected.map(box => box.index));
    for (const [index, record] of residentBoxes) {
      if (!desired.has(index)) {
        removeBox(record);
        residentBoxes.delete(index);
      }
    }
    for (const box of selected) if (!residentBoxes.has(box.index)) addBox(box);
    const textured = includeTextures ? selected.slice(0, IMAGE_TEXTURE_LIMIT).map(box => residentBoxes.get(box.index)).filter(Boolean) : [];
    const texturedIndexes = new Set(textured.map(record => record.box.index));
    for (const [index, record] of residentBoxes) if (!texturedIndexes.has(index)) removeTexture(record);
    if (includeTextures) scheduleTextureLoads(textured);

    const minimumSegment = Math.max(0, segment - RESIDENT_SEGMENT_RADIUS);
    const maximumSegment = Math.min(layout.segmentCount - 1, segment + RESIDENT_SEGMENT_RADIUS);
    for (const [index, group] of residentSegments) {
      if (index < minimumSegment || index > maximumSegment) {
        disposeGroup(group);
        residentSegments.delete(index);
      }
    }
    for (let index = minimumSegment; index <= maximumSegment; index++) {
      if (!residentSegments.has(index)) addSegment(index);
    }
    stage.dataset.residentBoxes = String(residentBoxes.size);
  }

  function active() {
    if (destroyed) return false;
    if (!stage.isConnected || !isCurrent()) {
      controller.destroy();
      return false;
    }
    return !manuallyPaused && !document.hidden;
  }

  function updateCamera() {
    const horizontal = Math.cos(pose.pitch);
    camera.position.set(pose.x, ROOM_LAYOUT.eyeHeight, pose.z);
    camera.lookAt(
      pose.x + Math.sin(pose.yaw) * horizontal,
      ROOM_LAYOUT.eyeHeight + Math.sin(pose.pitch),
      pose.z + Math.cos(pose.yaw) * horizontal,
    );
    warmLight.position.set(pose.x * 0.2, 4.7, pose.z + 1.5);
    aisleLight.position.set(pose.x * 0.12, 3.2, pose.z + 6);
    stage.dataset.cameraX = pose.x.toFixed(3);
    stage.dataset.cameraZ = pose.z.toFixed(3);
    stage.dataset.cameraYaw = pose.yaw.toFixed(5);
    stage.dataset.cameraPitch = pose.pitch.toFixed(5);
  }

  function scheduleCurrentResidentTextures() {
    const selected = selectRoomResidents(layout, pose, IMAGE_TEXTURE_LIMIT);
    scheduleTextureLoads(selected.map(box => residentBoxes.get(box.index)).filter(Boolean));
  }

  function renderNow() {
    if (!active()) return;
    reconcileResidents();
    if (introProgress >= 1) updateCamera();
    renderer.render(scene, camera);
  }

  function updateDoorIntro(progress) {
    introProgress = Math.max(0, Math.min(1, progress));
    // Finish the leaf's full sweep before the camera approaches it. This keeps
    // the entrance readable as a door opening, rather than a panel crossing
    // directly in front of the viewer on narrow portrait canvases.
    const doorProgress = Math.min(1, introProgress / 0.68);
    const eased = smoothstep(doorProgress);
    if (doorPivot) doorPivot.rotation.y = DOOR_OPEN_ANGLE * eased;
    if (doorWheel) doorWheel.rotation.z = -Math.PI * 1.35 * Math.min(1, introProgress / 0.36);
    stage.dataset.doorAnimation = 'native-three-time';
    stage.dataset.doorProgress = introProgress.toFixed(3);
    stage.dataset.doorAngle = (DOOR_OPEN_ANGLE * eased).toFixed(5);
    stage.dataset.doorState = introProgress >= 1 ? 'open' : 'opening';
  }

  function cancelDoorIntro({ finish = false } = {}) {
    if (introFrame) cancelAnimationFrame(introFrame);
    introFrame = 0;
    introStartedAt = 0;
    if (finish && introProgress < 1) {
      updateDoorIntro(1);
      scheduleCurrentResidentTextures();
      if (!document.hidden && !manuallyPaused && !destroyed) renderNow();
    }
  }

  function introDoorCameraZ() {
    // Fit the entire door plus the leaf's swept width inside the *actual*
    // canvas aspect. Portrait phones need much more distance than desktop: the
    // open leaf reaches about 2.3 m left of the ring and must retain real wall
    // around it rather than merely touching the viewport edge.
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const halfSweptWidth = 4.9;
    const halfFramedHeight = 3.35;
    const safeHalfWidth = Math.tan(horizontalFov / 2) * 0.9;
    const safeHalfHeight = Math.tan(verticalFov / 2) * 0.9;
    return -Math.max(7.2, halfSweptWidth / safeHalfWidth, halfFramedHeight / safeHalfHeight);
  }

  function applyIntroCamera(progress) {
    const startZ = introDoorCameraZ();
    // Hold the wide exterior establishing view until the leaf has completed
    // its sweep. Then approach the clear aperture; only the final beat crosses
    // the threshold and blends into the user's saved/navigation camera.
    const approach = smoothstep(Math.max(0, (progress - 0.7) / 0.2));
    const enter = smoothstep(Math.max(0, (progress - 0.9) / 0.1));
    const introZ = startZ + approach * (-1.6 - startZ) + enter * (pose.z + 1.6);
    const introPitch = pose.pitch * enter;
    const centerY = 2.64 - 0.18 * (1 - enter);
    camera.position.set(0, centerY, introZ);
    camera.lookAt(
      Math.sin(pose.yaw) * Math.cos(introPitch) * enter,
      centerY + Math.sin(introPitch) * enter,
      camera.position.z + Math.cos(pose.yaw) * Math.cos(introPitch),
    );
    camera.updateMatrixWorld();
    stage.dataset.introCameraZ = introZ.toFixed(3);
    stage.dataset.introThreshold = introZ >= 0 ? 'inside' : 'outside';
    // Expose the unchanged navigation pose without ever rendering it before the
    // intro camera. Movement/lifecycle tests and controls read these values.
    stage.dataset.cameraX = pose.x.toFixed(3);
    stage.dataset.cameraZ = pose.z.toFixed(3);
    stage.dataset.cameraYaw = pose.yaw.toFixed(5);
    stage.dataset.cameraPitch = pose.pitch.toFixed(5);
  }

  function doorIntroFrame(time) {
    introFrame = 0;
    if (!active()) return;
    if (!introStartedAt) introStartedAt = time;
    const elapsedProgress = Math.max(0, Math.min(1, (time - introStartedAt) / DOOR_INTRO_DURATION_MS));
    // Cap each rendered step so a long software-WebGL frame still advances
    // through genuine door and camera poses rather than jumping to completion.
    updateDoorIntro(Math.min(elapsedProgress, introProgress + DOOR_INTRO_MAX_FRAME_STEP));

    applyIntroCamera(introProgress);
    renderer.render(scene, camera);
    if (introProgress < 1) {
      introFrame = requestAnimationFrame(doorIntroFrame);
    } else {
      updateCamera();
      scheduleCurrentResidentTextures();
    }
  }

  function startDoorIntro() {
    updateDoorIntro(shouldPlayDoorIntro ? 0 : 1);
    if (shouldPlayDoorIntro && !deferDoorIntro && !document.hidden && !manuallyPaused) introFrame = requestAnimationFrame(doorIntroFrame);
  }

  function finishDoorIntro() {
    cancelDoorIntro({ finish: true });
    reconcileResidents(false, false);
    renderNow();
    scheduleCurrentResidentTextures();
  }

  function playDoorIntro() {
    if (destroyed || !shouldPlayDoorIntro || introFrame || introProgress >= 1) return false;
    introStartedAt = 0;
    if (!document.hidden && !manuallyPaused) introFrame = requestAnimationFrame(doorIntroFrame);
    return true;
  }

  function beginModalTransition() {
    cancelDoorIntro({ finish: true });
    textureLoadPaused = true;
    pendingTextureLoads.clear();
    if (textureRenderTimer) clearTimeout(textureRenderTimer);
    textureRenderTimer = 0;
  }

  function resumeAfterModal() {
    if (destroyed) return;
    textureLoadPaused = false;
    manuallyPaused = false;
    resetInputs();
    const resumeScene = () => {
      if (document.hidden || destroyed) return;
      reconcileResidents(false, false);
      updateCamera();
      renderer.render(scene, camera);
      const segment = Math.max(0, Math.min(layout.segmentCount - 1, Math.floor(pose.z / ROOM_LAYOUT.segmentLength)));
      const selected = selectRoomResidents(layout, { ...pose, x: 0, z: (segment + 0.5) * ROOM_LAYOUT.segmentLength }, IMAGE_TEXTURE_LIMIT);
      scheduleTextureLoads(selected.map(box => residentBoxes.get(box.index)).filter(Boolean));
    };
    if (restoreBoxPickup({ onComplete: resumeScene })) return;
    resumeScene();
  }

  function keyInput() {
    const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    const strafe = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    return { forward: forward + joystickVector.forward, strafe: strafe + joystickVector.strafe };
  }

  function hasMovement() {
    const input = keyInput();
    return Math.abs(input.forward) > 0.01 || Math.abs(input.strafe) > 0.01;
  }

  function cancelFrame() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrameTime = 0;
  }

  function movementFrame(time) {
    frame = 0;
    if (!active() || !hasMovement()) {
      lastFrameTime = 0;
      return;
    }
    pose = moveRoomPose(layout, pose, keyInput(), (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    renderNow();
    frame = requestAnimationFrame(movementFrame);
  }

  function flushMovement(time = performance.now()) {
    if (!lastFrameTime || !active() || !hasMovement()) return;
    pose = moveRoomPose(layout, pose, keyInput(), (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    renderNow();
  }

  function beginMovement() {
    cancelDoorIntro({ finish: true });
    if (!active() || !hasMovement() || frame) return;
    if (textureRenderTimer) clearTimeout(textureRenderTimer);
    textureRenderTimer = 0;
    // Starting from rest otherwise spends the first RAF only establishing a
    // timestamp. Commit one bounded step immediately, then retain the event
    // timestamp so keyup can flush elapsed input if rendering delays every RAF.
    pose = moveRoomPose(layout, pose, keyInput(), 1 / 60);
    lastFrameTime = performance.now();
    renderNow();
    frame = requestAnimationFrame(movementFrame);
  }

  function resetInputs() {
    flushMovement();
    keys.clear();
    joystickPointer = null;
    joystickVector = { forward: 0, strafe: 0 };
    drag = null;
    if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
    cancelFrame();
  }

  function look(dx, dy) {
    cancelDoorIntro({ finish: true });
    pose.yaw = Math.atan2(Math.sin(pose.yaw - dx * LOOK_SPEED), Math.cos(pose.yaw - dx * LOOK_SPEED));
    pose.pitch = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, pose.pitch - dy * LOOK_SPEED));
    renderNow();
  }

  function cancelPickupFrame() {
    if (pickupFrame) cancelAnimationFrame(pickupFrame);
    pickupFrame = 0;
    pickupStartedAt = 0;
  }

  function pickupAnimationFrame(time) {
    pickupFrame = 0;
    if (!activePickup || destroyed || document.hidden) return;
    if (!pickupStartedAt) pickupStartedAt = time;
    const duration = activePickup.returning ? PICKUP_RETURN_DURATION_MS : PICKUP_DURATION_MS;
    const progress = Math.min(1, Math.max(0, (time - pickupStartedAt) / duration));
    const eased = smoothstep(progress);
    const amount = activePickup.returning ? 1 - eased : eased;
    const { mesh, origX, origY, origZ, origRotX, origRotY, origScaleX, origScaleY, origScaleZ, viewX, viewY, viewZ, viewRotY } = activePickup;
    mesh.position.set(
      origX + (viewX - origX) * amount,
      origY + (viewY - origY) * amount,
      origZ + (viewZ - origZ) * amount,
    );
    mesh.rotation.x = origRotX - 0.08 * amount;
    mesh.rotation.y = origRotY + (viewRotY - origRotY) * amount;
    const scale = 1 + (PICKUP_VIEW_SCALE - 1) * amount;
    mesh.scale.set(origScaleX * scale, origScaleY * scale, origScaleZ * scale);
    stage.dataset.pickupProgress = amount.toFixed(3);
    stage.dataset.pickupTransform = [mesh.position.x, mesh.position.y, mesh.position.z, mesh.rotation.x]
      .map(value => value.toFixed(5))
      .join(',');
    stage.dataset.pickupState = activePickup.returning ? 'returning' : progress >= 1 ? 'held' : 'lifting';
    renderer.render(scene, camera);
    if (progress < 1) pickupFrame = requestAnimationFrame(pickupAnimationFrame);
    else if (activePickup.returning) {
      const onComplete = activePickup.onReturnComplete;
      const { mesh } = activePickup;
      activePickup = null;
      mesh.userData.pendingProportions?.();
      stage.dataset.pickupState = 'idle';
      delete stage.dataset.pickupSet;
      onComplete?.();
    } else {
      // Do not interrupt the physical action with an unrelated sheet. The DOM
      // inspector remains the accessible detailed view after the lift settles.
      activePickup.onSettled();
    }
  }

  function animateBoxPickup(mesh, onSettled) {
    restoreBoxPickup({ immediate: true });
    const forwardX = Math.sin(pose.yaw);
    const forwardZ = Math.cos(pose.yaw);
    const viewX = pose.x + forwardX * PICKUP_VIEW_DISTANCE;
    const viewZ = pose.z + forwardZ * PICKUP_VIEW_DISTANCE;
    const viewY = ROOM_LAYOUT.eyeHeight - 0.22;
    activePickup = {
      mesh,
      onSettled,
      origX: mesh.position.x,
      origY: mesh.position.y,
      origZ: mesh.position.z,
      origRotX: mesh.rotation.x,
      origRotY: mesh.rotation.y,
      origScaleX: mesh.scale.x,
      origScaleY: mesh.scale.y,
      origScaleZ: mesh.scale.z,
      viewX,
      viewY,
      viewZ,
      viewRotY: Math.atan2(pose.x - viewX, pose.z - viewZ),
      returning: false,
    };
    stage.dataset.pickupOrigin = [activePickup.origX, activePickup.origY, activePickup.origZ, activePickup.origRotX]
      .map(value => value.toFixed(5))
      .join(',');
    stage.dataset.pickupSet = mesh.userData.setNum;
    stage.dataset.pickupState = 'lifting';
    stage.dataset.pickupProgress = '0.000';
    pickupStartedAt = 0;
    pickupFrame = requestAnimationFrame(pickupAnimationFrame);
  }

  function restoreBoxPickup({ immediate = false, onComplete } = {}) {
    if (!activePickup?.mesh) return false;
    cancelPickupFrame();
    if (immediate || reducedMotion) {
      activePickup.mesh.position.set(activePickup.origX, activePickup.origY, activePickup.origZ);
      activePickup.mesh.rotation.x = activePickup.origRotX;
      activePickup.mesh.rotation.y = activePickup.origRotY;
      activePickup.mesh.scale.set(activePickup.origScaleX, activePickup.origScaleY, activePickup.origScaleZ);
      stage.dataset.pickupTransform = stage.dataset.pickupOrigin;
      const { mesh } = activePickup;
      activePickup = null;
      mesh.userData.pendingProportions?.();
      stage.dataset.pickupState = 'idle';
      stage.dataset.pickupProgress = '0.000';
      delete stage.dataset.pickupSet;
      renderNow();
      onComplete?.();
      return false;
    }
    activePickup.returning = true;
    activePickup.onReturnComplete = onComplete;
    stage.dataset.pickupState = 'returning';
    stage.dataset.pickupProgress = '0.999';
    pickupStartedAt = performance.now();
    pickupFrame = requestAnimationFrame(pickupAnimationFrame);
    return true;
  }

  function pick(clientX, clientY, center = false) {
    if (!active()) return;
    // A click during the entrance reveal should use the navigation camera the
    // user is about to control, not the intro-only camera transform left by the
    // latest animation frame. Finishing first also renders that same matrix, so
    // selection and the visible post-click scene cannot disagree.
    cancelDoorIntro({ finish: true });
    updateCamera();
    const bounds = canvas.getBoundingClientRect();
    const x = center ? 0 : ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
    const y = center ? 0 : -((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
    const targets = [...pickTargets];

    let selectedSetNum = null;
    let selectedMesh = null;

    // 1. Direct raycast
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const directHit = raycaster.intersectObjects(targets, false)[0];
    if (directHit?.object.userData.setNum) {
      selectedSetNum = directHit.object.userData.setNum;
      selectedMesh = directHit.object;
    }

    // 2. Multi-ring search if direct miss (forgiving touch target)
    if (!selectedSetNum) {
      const ringPixels = [14, 28, 44];
      for (const px of ringPixels) {
        const tolX = px / Math.max(1, bounds.width);
        const tolY = px / Math.max(1, bounds.height);
        const offsets = [
          [-tolX, 0], [tolX, 0], [0, -tolY], [0, tolY],
          [-tolX * 0.7, -tolY * 0.7], [tolX * 0.7, -tolY * 0.7],
          [-tolX * 0.7, tolY * 0.7], [tolX * 0.7, -tolY * 0.7]
        ];
        for (const [offsetX, offsetY] of offsets) {
          raycaster.setFromCamera(new THREE.Vector2(x + offsetX, y + offsetY), camera);
          const hit = raycaster.intersectObjects(targets, false)[0];
          if (hit?.object.userData.setNum) {
            selectedSetNum = hit.object.userData.setNum;
            selectedMesh = hit.object;
            break;
          }
        }
        if (selectedSetNum) break;
      }
    }

    // 3. Screen-space proximity fallback for mobile touch
    if (!selectedSetNum && residentBoxes.size > 0 && !center) {
      let closestDist = 52; // generous 52px touch radius
      const v = new THREE.Vector3();
      for (const record of residentBoxes.values()) {
        const body = record.body;
        if (!body.userData.setNum) continue;
        v.setFromMatrixPosition(body.matrixWorld);
        v.project(camera);
        if (v.z > 0 && v.z < 1) {
          const sx = ((v.x + 1) / 2) * bounds.width + bounds.left;
          const sy = ((-v.y + 1) / 2) * bounds.height + bounds.top;
          const dist = Math.hypot(clientX - sx, clientY - sy);
          if (dist < closestDist) {
            closestDist = dist;
            selectedSetNum = body.userData.setNum;
            selectedMesh = body;
          }
        }
      }
    }

    if (selectedSetNum) {
      resetInputs();
      inspecting = true;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      const settle = () => onSelect(selectedSetNum);
      if (selectedMesh && !reducedMotion) animateBoxPickup(selectedMesh, settle);
      else settle();
      return;
    }
  }

  function updateJoystick(event) {
    if (!joystick) return;
    const bounds = joystick.getBoundingClientRect();
    const radius = Math.max(1, Math.min(bounds.width, bounds.height) / 2 - 22);
    let dx = event.clientX - (bounds.left + bounds.width / 2);
    let dy = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = dx / distance * radius;
      dy = dy / distance * radius;
    }
    joystickVector = { forward: -dy / radius, strafe: dx / radius };
    if (knob) knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    beginMovement();
  }

  const controller = {
    async capturePointer() {
      if (!active()) return;
      if (!canvas.requestPointerLock) throw new Error('Pointer capture unavailable');
      await canvas.requestPointerLock();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelDoorIntro();
      cancelPickupFrame();
      if (activePickup?.mesh) {
        activePickup.mesh.position.set(activePickup.origX, activePickup.origY, activePickup.origZ);
        activePickup.mesh.rotation.x = activePickup.origRotX;
        activePickup.mesh.rotation.y = activePickup.origRotY;
        activePickup.mesh.scale.set(activePickup.origScaleX, activePickup.origScaleY, activePickup.origScaleZ);
        activePickup = null;
      }
      steelTexture?.dispose();
      floorTexture?.dispose();
      doorTexture?.dispose();
      shadowTexture?.dispose();
      environmentTarget?.dispose();
      if (textureRenderTimer) clearTimeout(textureRenderTimer);
      textureRenderTimer = 0;
      resetInputs();
      abort.abort();
      resizeObserver?.disconnect();
      removalObserver?.disconnect();
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      for (const record of residentBoxes.values()) removeBox(record);
      residentBoxes.clear();
      for (const group of residentSegments.values()) disposeGroup(group);
      residentSegments.clear();
      for (const geometry of sharedGeometries) geometry.dispose();
      for (const meshMaterial of sharedMaterials) meshMaterial.dispose();
      renderer.dispose();
      // Calling forceContextLoss() from inside a real context-lost callback can
      // deadlock Chromium's GPU process. The context is already gone there.
      if (!contextLost) renderer.forceContextLoss();
      if (joystick) joystick.style.touchAction = previousJoystickTouchAction;
      if (knob) knob.style.transform = '';
      canvas.remove();
    },
    getPose() {
      return { pitch: pose.pitch, x: pose.x, yaw: pose.yaw, z: pose.z };
    },
    finishDoorIntro,
    playDoorIntro,
    reset() {
      if (destroyed) return;
      cancelDoorIntro({ finish: true });
      resetInputs();
      pose = { ...layout.spawn };
      reconcileResidents(true);
      renderNow();
    },
    setInspecting(value) {
      const next = Boolean(value);
      if (inspecting === next) return;
      inspecting = next;
      manuallyPaused = inspecting;
      resetInputs();
      if (inspecting && document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!inspecting) {
        restoreBoxPickup();
        renderNow();
      }
    },
    boxArtwork(setNum) {
      // The inspection sheet shows the same printed carton as the shelf: the
      // straightened front, the end-panel print, the lid colour and the
      // proportions the room settled on.
      const record = [...residentBoxes.values()].find(entry => entry.box.set_num === setNum && entry.canvas);
      if (!record) return null;
      const { box } = record;
      const { width, height } = record.frontSize || { width: box.boxWidth, height: box.boxHeight };
      return {
        front: record.canvas,
        side: record.sideCanvas || null,
        lid: lidColor(record),
        aspect: width / height,
        depthRatio: box.boxDepth / width,
      };
    },
    boxBack(setNum, { backUrl = '', modelUrl = '', box = null, aspect = 1.35 } = {}) {
      const record = [...residentBoxes.values()].find(entry => entry.box.set_num === setNum && entry.canvas);
      if (!record) {
        // Not on a resident shelf yet (opened from the list, or its texture is
        // still unallocated): print a standalone back from the catalogue row.
        if (!box) return Promise.resolve(null);
        const height = Math.max(256, Math.min(1024, Math.round(512 / Math.max(0.2, aspect))));
        return paintBackCanvas({ set_num: setNum, name: box.name || setNum, theme: box.theme || '' }, 512, height, '', backUrl, modelUrl).catch(() => null);
      }
      record.backPromise ||= paintBack(record, backUrl, modelUrl).catch(() => null);
      return record.backPromise;
    },
    rotateInspection(delta) {
      if (!inspecting || !Number.isFinite(delta)) return;
      onInspectionRotate(delta);
    },
    beginModalTransition,
    resumeAfterModal,
    setPaused(value, { render = true } = {}) {
      manuallyPaused = Boolean(value);
      if (manuallyPaused) cancelDoorIntro({ finish: true });
      resetInputs();
      if (manuallyPaused && document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (!manuallyPaused && render) renderNow();
    },
    teleportToSet(setNum) {
      if (destroyed) return false;
      const destination = roomPoseForSet(layout, setNum);
      if (!destination) return false;
      resetInputs();
      pose = destination;
      // A search result may be hundreds of bays away. Rebuilding and uploading
      // the resident window synchronously inside the sheet's click task can
      // starve assistive-state/focus updates in software WebGL. Commit the pose
      // immediately and let the sheet-close resume render reconcile the bay.
      residentSegment = -1;
      updateCamera();
      return true;
    },
  };

  try {
    if (joystick) joystick.style.touchAction = 'none';
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.pointerLockElement === canvas) {
        document.exitPointerLock?.();
        return;
      }
      if (!active() || isTypingTarget(event.target) || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
      event.preventDefault();
      keys.add(event.code);
      beginMovement();
    }, { signal: abort.signal });
    window.addEventListener('keyup', event => {
      if (!keys.has(event.code)) return;
      flushMovement();
      keys.delete(event.code);
      if (!hasMovement()) cancelFrame();
    }, { signal: abort.signal });
    window.addEventListener('blur', resetInputs, { signal: abort.signal });
    let skipFirstPointerLockMove = false;
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas) resetInputs();
      else skipFirstPointerLockMove = true;
    }, { signal: abort.signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelDoorIntro({ finish: true });
        restoreBoxPickup({ immediate: true });
        resetInputs();
      }
    }, { signal: abort.signal });
    // Pointer lock guarantees mouse events; some platforms do not dispatch the
    // corresponding pointer events. Handle the completed click while still
    // locked, before releasing the cursor to show the details panel.
    document.addEventListener('mousemove', event => {
      if (document.pointerLockElement === canvas && active()) {
        if (skipFirstPointerLockMove) {
          skipFirstPointerLockMove = false;
          return;
        }
        look(event.movementX, event.movementY);
      }
    }, { signal: abort.signal });
    // Locked mouse input is completed at mouseup. Chromium on Linux may
    // retarget the later click to an overlay after the detail sheet unlocks
    // the cursor, so consume that trailing click before it reaches controls.
    let consumedLockedRelease = false;
    document.addEventListener('mouseup', event => {
      if (document.pointerLockElement !== canvas || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      consumedLockedRelease = true;
      requestAnimationFrame(() => { consumedLockedRelease = false; });
      pick(0, 0, true);
    }, { capture: true, signal: abort.signal });
    document.addEventListener('click', event => {
      if (event.button !== 0 || (!consumedLockedRelease && document.pointerLockElement !== canvas)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Do not select twice on platforms that send both mouseup and click.
      if (!consumedLockedRelease) pick(0, 0, true);
      consumedLockedRelease = false;
    }, { capture: true, signal: abort.signal });
    canvas.addEventListener('pointerdown', event => {
      if (!active() || drag || event.button !== 0 || document.pointerLockElement === canvas) return;
      event.preventDefault();
      drag = {
        id: event.pointerId,
        moved: false,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        startTime: performance.now(),
        pointerType: event.pointerType || 'mouse'
      };
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }, { signal: abort.signal });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId || document.pointerLockElement === canvas) return;
      const totalDist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      const threshold = drag.pointerType === 'touch' ? 10 : 3;
      if (totalDist > threshold) drag.moved = true;
      if (drag.moved) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        look(dx, dy);
      }
    }, { signal: abort.signal });
    canvas.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const totalDist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      const duration = performance.now() - drag.startTime;
      const isTouchTap = drag.pointerType === 'touch' && totalDist < 16 && duration < 500;
      const isClick = !drag.moved || isTouchTap;
      const clickX = event.clientX;
      const clickY = event.clientY;
      drag = null;
      if (isClick) pick(clickX, clickY, document.pointerLockElement === canvas);
    }, { signal: abort.signal });
    canvas.addEventListener('pointercancel', () => { drag = null; }, { signal: abort.signal });
    canvas.addEventListener('dblclick', () => { void controller.capturePointer().catch(() => {}); }, { signal: abort.signal });
    joystick?.addEventListener('pointerdown', event => {
      if (!active() || joystickPointer !== null || event.button !== 0) return;
      event.preventDefault();
      joystickPointer = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      updateJoystick(event);
    }, { signal: abort.signal });
    joystick?.addEventListener('pointermove', event => {
      if (joystickPointer === event.pointerId) updateJoystick(event);
    }, { signal: abort.signal });
    const releaseJoystick = event => {
      if (joystickPointer !== event.pointerId) return;
      joystickPointer = null;
      joystickVector = { forward: 0, strafe: 0 };
      if (knob) knob.style.transform = 'translate3d(0, 0, 0)';
      if (!hasMovement()) cancelFrame();
    };
    joystick?.addEventListener('pointerup', releaseJoystick, { signal: abort.signal });
    joystick?.addEventListener('pointercancel', releaseJoystick, { signal: abort.signal });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      contextLost = true;
      if (!unavailableNotified) {
        unavailableNotified = true;
        controller.destroy();
        onUnavailable();
      }
    }, { signal: abort.signal });
    const checkRoute = () => {
      if (!destroyed && (!stage.isConnected || !isCurrent())) controller.destroy();
    };
    window.addEventListener('hashchange', checkRoute, { signal: abort.signal });
    window.addEventListener('popstate', checkRoute, { signal: abort.signal });
    window.addEventListener('pagehide', () => controller.destroy(), { signal: abort.signal });
    resizeObserver = new ResizeObserver(() => {
      if (destroyed) return;
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (introProgress < 1) {
        applyIntroCamera(introProgress);
        renderer.render(scene, camera);
      } else renderNow();
    });
    resizeObserver.observe(stage);
    removalObserver = new MutationObserver(checkRoute);
    removalObserver.observe(document.body, { childList: true, subtree: true });
    reconcileResidents(true, !shouldPlayDoorIntro);
    renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), false);
    camera.aspect = Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight);
    camera.updateProjectionMatrix();
    if (shouldPlayDoorIntro) applyIntroCamera(0);
    else updateCamera();
    renderer.render(scene, camera);
    startDoorIntro();
    return controller;
  } catch (error) {
    controller.destroy();
    throw error;
  }
}
